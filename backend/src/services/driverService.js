import { pool, withTransaction } from '../db/pool.js';
import { MATCH_REASONS, checkCompatibility } from '../domain/matching.js';
import { POOL_ACTIVE, POOL_OPEN } from '../domain/stateMachine.js';
import { conflict, notFound } from '../utils/errors.js';
import { listEvents, recordEvent } from './eventService.js';
import { activeMembers, tryJoinPool } from './poolService.js';

const ONE_POOL_PER_TESLA_INDEX = 'pools_one_active_per_tesla';

export const toTeslaView = (t) => ({
  id: t.id, name: t.name, plate: t.plate, capacity: t.capacity, isOnline: t.is_online,
});

export async function getTesla(db, driverId) {
  const { rows } = await db.query('SELECT * FROM teslas WHERE driver_id = $1', [driverId]);
  if (!rows[0]) throw notFound('No Tesla registered for this driver');
  return rows[0];
}

async function activePoolFor(db, teslaId) {
  const { rows } = await db.query('SELECT * FROM pools WHERE tesla_id = $1 AND status = ANY($2)', [teslaId, POOL_ACTIVE]);
  return rows[0] ?? null;
}

/** Driver's full view of a pool: who is in it, seats, fares, status, and (optionally) the audit trail. */
export async function getPoolView(db, poolId, { withEvents = false } = {}) {
  const { rows } = await db.query(
    `SELECT p.*, t.name AS tesla_name, t.plate FROM pools p JOIN teslas t ON t.id = p.tesla_id WHERE p.id = $1`,
    [poolId],
  );
  const p = rows[0];
  if (!p) throw notFound('Pool not found');
  const pax = await db.query(
    `SELECT m.request_id, m.seats, m.joined_at, m.left_at, m.left_reason,
            r.status, r.pickup_zone, r.destination_zone, r.fare_paisa, r.payment_method, u.name
       FROM pool_members m
       JOIN ride_requests r ON r.id = m.request_id
       JOIN users u ON u.id = r.passenger_id
      WHERE m.pool_id = $1 ORDER BY m.joined_at`,
    [poolId],
  );
  const view = {
    id: p.id,
    status: p.status,
    pickupZone: p.pickup_zone,
    capacity: p.capacity,
    seatsTaken: p.seats_taken,
    seatsFree: p.status === 'COMPLETED' || p.status === 'CANCELLED' ? 0 : p.capacity - p.seats_taken,
    tesla: { name: p.tesla_name, plate: p.plate },
    createdAt: p.created_at,
    arrivedAt: p.arrived_at,
    startedAt: p.started_at,
    completedAt: p.completed_at,
    cancelledAt: p.cancelled_at,
    passengers: pax.rows.map((r) => ({
      requestId: r.request_id,
      name: r.name,
      pickupZone: r.pickup_zone,
      destinationZone: r.destination_zone,
      seats: r.seats,
      status: r.status,
      farePaisa: r.fare_paisa,
      paymentMethod: r.payment_method,
      joinedAt: r.joined_at,
      leftAt: r.left_at,
      leftReason: r.left_reason,
      active: r.left_at === null,
    })),
  };
  if (withEvents) view.events = await listEvents(db, 'POOL', poolId);
  return view;
}

export async function getProfile(driverId) {
  const tesla = await getTesla(pool, driverId);
  const active = await activePoolFor(pool, tesla.id);
  return { tesla: toTeslaView(tesla), activePool: active ? await getPoolView(pool, active.id) : null };
}

export async function setAvailability(driverId, online) {
  return withTransaction(async (db) => {
    const tesla = (await db.query('SELECT * FROM teslas WHERE driver_id = $1 FOR UPDATE', [driverId])).rows[0];
    if (!tesla) throw notFound('No Tesla registered for this driver');
    if (!online && (await activePoolFor(db, tesla.id))) {
      throw conflict('ACTIVE_POOL', 'Finish or cancel your current pool before going offline');
    }
    const upd = await db.query('UPDATE teslas SET is_online = $2 WHERE id = $1 RETURNING *', [tesla.id, online]);
    return toTeslaView(upd.rows[0]);
  });
}

/**
 * "Relevant requests": with an open pool, only requests that could legally join it (same pickup, free seats,
 * destination on the corridor). With no pool, every waiting request that fits the Tesla. Oldest first.
 */
export async function listRelevantRequests(driverId, { zone } = {}) {
  const tesla = await getTesla(pool, driverId);
  if (!tesla.is_online) return { online: false, requests: [] };

  const active = await activePoolFor(pool, tesla.id);
  let rows;
  if (active && active.status === 'STARTED') {
    return { online: true, requests: [] };
  } else if (active) {
    const members = await activeMembers(pool, active.id);
    const dests = members.map((m) => m.destination_zone);
    const waiting = await pool.query(
      `SELECT r.*, u.name AS passenger_name FROM ride_requests r JOIN users u ON u.id = r.passenger_id
        WHERE r.status = 'REQUESTED' AND r.pickup_zone = $1 ORDER BY r.created_at LIMIT 50`,
      [active.pickup_zone],
    );
    rows = waiting.rows.filter((r) => checkCompatibility({ pool: active, request: r, memberDestinations: dests }).ok);
  } else {
    const waiting = await pool.query(
      `SELECT r.*, u.name AS passenger_name FROM ride_requests r JOIN users u ON u.id = r.passenger_id
        WHERE r.status = 'REQUESTED' AND r.seats <= $1 AND ($2::text IS NULL OR r.pickup_zone = $2)
        ORDER BY r.created_at LIMIT 50`,
      [tesla.capacity, zone ?? null],
    );
    rows = waiting.rows;
  }
  return {
    online: true,
    requests: rows.map((r) => ({
      id: r.id,
      passengerName: r.passenger_name,
      pickupZone: r.pickup_zone,
      destinationZone: r.destination_zone,
      seats: r.seats,
      paymentMethod: r.payment_method,
      waitingSince: r.created_at,
    })),
  };
}

/** Driver accepts a waiting request: starts a new pool, or adds it to the driver's open pool. */
export async function acceptRequest(driverId, requestId) {
  try {
    return await withTransaction(async (db) => {
      const tesla = await getTesla(db, driverId);
      if (!tesla.is_online) throw conflict('DRIVER_OFFLINE', 'Go online before accepting rides');

      const request = (await db.query('SELECT * FROM ride_requests WHERE id = $1', [requestId])).rows[0];
      if (!request) throw notFound('Ride request not found');
      if (request.seats > tesla.capacity) {
        throw conflict('EXCEEDS_CAPACITY', `This request needs ${request.seats} seats but ${tesla.name} only has ${tesla.capacity}`);
      }

      let poolRow = await activePoolFor(db, tesla.id);
      if (poolRow && !POOL_OPEN.includes(poolRow.status)) {
        throw conflict('POOL_IN_PROGRESS', 'Your Tesla is mid-trip; new passengers cannot join');
      }
      if (!poolRow) {
        poolRow = (
          await db.query(
            `INSERT INTO pools (tesla_id, pickup_zone, capacity) VALUES ($1,$2,$3) RETURNING *`,
            [tesla.id, request.pickup_zone, tesla.capacity],
          )
        ).rows[0];
        await recordEvent(db, { entityType: 'POOL', entityId: poolRow.id, to: 'ACCEPTED', actorId: driverId });
      }

      const res = await tryJoinPool(db, { poolId: poolRow.id, requestId, actorId: driverId, source: 'DRIVER_ACCEPT' });
      if (!res.ok) throw conflict(res.reason, MATCH_REASONS[res.reason] ?? 'Cannot add this request');
      return getPoolView(db, poolRow.id);
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === ONE_POOL_PER_TESLA_INDEX) {
      throw conflict('ACTIVE_POOL_EXISTS', 'Your Tesla already has an active pool. Please retry.');
    }
    throw err;
  }
}

/** Ride history for the driver's Tesla, newest first. */
export async function listPools(driverId, { limit, offset }) {
  const tesla = await getTesla(pool, driverId);
  const { rows } = await pool.query(
    'SELECT id FROM pools WHERE tesla_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [tesla.id, limit, offset],
  );
  return Promise.all(rows.map((r) => getPoolView(pool, r.id)));
}

/** One of the driver's own pools with the full audit trail ("explain exactly what happened"). */
export async function getOwnPool(driverId, poolId) {
  const tesla = await getTesla(pool, driverId);
  const { rows } = await pool.query('SELECT id FROM pools WHERE id = $1 AND tesla_id = $2', [poolId, tesla.id]);
  if (!rows[0]) throw notFound('Pool not found');
  return getPoolView(pool, poolId, { withEvents: true });
}
