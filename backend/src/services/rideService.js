import { pool, withTransaction } from '../db/pool.js';
import { estimateFare } from '../domain/fare.js';
import { POOL_OPEN, assertTransition } from '../domain/stateMachine.js';
import { AppError, conflict, notFound } from '../utils/errors.js';
import { listEvents, recordEvent } from './eventService.js';
import { lockPool, recomputeFares, removeMember, tryJoinPool } from './poolService.js';

const ACTIVE_RIDE_INDEX = 'ride_requests_one_active_per_passenger';

/** Shape returned to a passenger: ONLY their own fare and status. Co-passengers appear as a count, never by name/fare. */
export function toPassengerView(r, extra = {}) {
  return {
    id: r.id,
    status: r.status,
    pickupZone: r.pickup_zone,
    destinationZone: r.destination_zone,
    seats: r.seats,
    paymentMethod: r.payment_method,
    farePaisa: r.fare_paisa,
    fareBreakdown: r.fare_breakdown,
    fareLocked: r.fare_locked,
    estimatedPooledFarePaisa: estimateFare({ pickup: r.pickup_zone, destination: r.destination_zone, seats: r.seats }).pooledTotal,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pool: null,
    ...extra,
  };
}

/** Current/final pool info for a batch of requests (one query, no N+1). */
async function poolInfoFor(db, requestIds) {
  if (requestIds.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (m.request_id)
            m.request_id, p.id AS pool_id, p.status AS pool_status, t.name AS tesla_name, t.plate, u.name AS driver_name,
            (SELECT count(*) FROM pool_members m2
              WHERE m2.pool_id = p.id AND m2.request_id <> m.request_id
                AND (m2.left_at IS NULL OR m2.left_reason = 'COMPLETED')) AS co_passengers
       FROM pool_members m
       JOIN pools p ON p.id = m.pool_id
       JOIN teslas t ON t.id = p.tesla_id
       JOIN users u ON u.id = t.driver_id
      WHERE m.request_id = ANY($1) AND (m.left_at IS NULL OR m.left_reason = 'COMPLETED')
      ORDER BY m.request_id, m.joined_at DESC`,
    [requestIds],
  );
  return new Map(
    rows.map((r) => [
      r.request_id,
      { id: r.pool_id, status: r.pool_status, teslaName: r.tesla_name, plate: r.plate, driverName: r.driver_name, coPassengers: r.co_passengers },
    ]),
  );
}

async function viewById(db, requestId, withEvents = false, viewerId = null) {
  const { rows } = await db.query('SELECT * FROM ride_requests WHERE id = $1', [requestId]);
  const info = await poolInfoFor(db, [requestId]);
  const extra = { pool: info.get(requestId) ?? null };
  if (withEvents) extra.events = await listEvents(db, 'REQUEST', requestId, { viewerId });
  return toPassengerView(rows[0], extra);
}

/** Try open pools in a fixed global order (created_at, id) so concurrent matchers lock pools in the same order. */
async function autoMatch(db, request, actorId) {
  const { rows } = await db.query(
    `SELECT id FROM pools
      WHERE status = ANY($1) AND pickup_zone = $2 AND seats_taken + $3 <= capacity
      ORDER BY created_at, id`,
    [POOL_OPEN, request.pickup_zone, request.seats],
  );
  for (const candidate of rows) {
    const res = await tryJoinPool(db, { poolId: candidate.id, requestId: request.id, actorId, source: 'AUTO_MATCH' });
    if (res.ok) return res;
  }
  return null;
}

export async function createRideRequest(passengerId, { pickup, destination, seats, paymentMethod }) {
  const estimate = estimateFare({ pickup, destination, seats });

  if (paymentMethod === 'TESLAPAY') {
    // The solo fare is the maximum this ride can cost (pooling only lowers it), so checking it is sufficient.
    const { rows } = await pool.query('SELECT wallet_balance_paisa FROM users WHERE id = $1', [passengerId]);
    if (rows[0].wallet_balance_paisa < estimate.soloTotal) {
      throw conflict('INSUFFICIENT_WALLET', 'TeslaPay balance is too low for this ride. Choose cash or a shorter trip.', {
        required: estimate.soloTotal,
        available: rows[0].wallet_balance_paisa,
      });
    }
  }

  try {
    return await withTransaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO ride_requests
           (passenger_id, pickup_zone, destination_zone, seats, payment_method, fare_paisa, fare_breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [passengerId, pickup, destination, seats, paymentMethod, estimate.soloTotal, JSON.stringify(estimate.solo)],
      );
      const request = rows[0];
      await recordEvent(db, { entityType: 'REQUEST', entityId: request.id, to: 'REQUESTED', actorId: passengerId });
      await autoMatch(db, request, passengerId); // "in about a second": join a compatible open Tesla if there is one
      return viewById(db, request.id);
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === ACTIVE_RIDE_INDEX) {
      throw conflict('ACTIVE_RIDE_EXISTS', 'You already have a ride in progress. Finish or cancel it first.');
    }
    throw err;
  }
}

export async function listRides(passengerId, { limit, offset }) {
  const { rows } = await pool.query(
    `SELECT * FROM ride_requests WHERE passenger_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [passengerId, limit, offset],
  );
  const info = await poolInfoFor(pool, rows.map((r) => r.id));
  return rows.map((r) => toPassengerView(r, { pool: info.get(r.id) ?? null }));
}

export async function getRide(passengerId, requestId) {
  const { rows } = await pool.query('SELECT id FROM ride_requests WHERE id = $1 AND passenger_id = $2', [
    requestId,
    passengerId,
  ]);
  // 404 (not 403) for someone else's ride: do not confirm that the id exists.
  if (!rows[0]) throw notFound('Ride not found');
  return viewById(pool, requestId, true, passengerId);
}

const RETRY = Symbol('retry');

async function cancelOnce(db, passengerId, requestId) {
  // Lock order: pool first, then request. We do not know the pool until we peek at the membership.
  const peek = await db.query('SELECT id, passenger_id FROM ride_requests WHERE id = $1', [requestId]);
  if (!peek.rows[0] || peek.rows[0].passenger_id !== passengerId) throw notFound('Ride not found');

  const m0 = (await db.query('SELECT pool_id FROM pool_members WHERE request_id = $1 AND left_at IS NULL', [requestId])).rows[0];
  if (m0) await lockPool(db, m0.pool_id);

  const r = (await db.query('SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE', [requestId])).rows[0];
  const m = (await db.query('SELECT pool_id FROM pool_members WHERE request_id = $1 AND left_at IS NULL', [requestId])).rows[0];
  if ((m?.pool_id ?? null) !== (m0?.pool_id ?? null)) throw RETRY; // membership changed between peek and lock

  assertTransition('REQUEST', r.status, 'CANCELLED'); // only REQUESTED or MATCHED are cancellable

  if (m) await removeMember(db, { poolId: m.pool_id, requestId, reason: 'PASSENGER_CANCELLED' });
  await db.query(
    `UPDATE ride_requests SET status = 'CANCELLED', cancelled_reason = 'PASSENGER_CANCELLED', updated_at = now() WHERE id = $1`,
    [requestId],
  );
  await recordEvent(db, {
    entityType: 'REQUEST', entityId: requestId, from: r.status, to: 'CANCELLED', actorId: passengerId,
    metadata: m ? { poolId: m.pool_id, seatsReleased: r.seats } : {},
  });
  if (m) await recomputeFares(db, m.pool_id, passengerId); // remaining passenger loses the pool discount if alone
  return viewById(db, requestId);
}

export async function cancelRide(passengerId, requestId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTransaction((db) => cancelOnce(db, passengerId, requestId));
    } catch (err) {
      if (err !== RETRY) throw err;
    }
  }
  throw new AppError(409, 'CONCURRENT_UPDATE', 'Your ride changed while cancelling. Please try again.');
}
