import { pool, withTransaction } from '../db/pool.js';
import { estimateFare } from '../domain/fare.js';
import { assertTransition } from '../domain/stateMachine.js';
import { conflict, notFound } from '../utils/errors.js';
import { listEvents, recordEvent } from './eventService.js';

const ACTIVE_RIDE_INDEX = 'ride_requests_one_active_per_passenger';

/** Shape returned to a passenger: ONLY their own fare and status. */
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...extra,
  };
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
      return toPassengerView(request);
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
  return rows.map((r) => toPassengerView(r));
}

export async function getRide(passengerId, requestId) {
  const { rows } = await pool.query('SELECT * FROM ride_requests WHERE id = $1 AND passenger_id = $2', [
    requestId,
    passengerId,
  ]);
  // 404 (not 403) for someone else's ride: do not confirm that the id exists.
  if (!rows[0]) throw notFound('Ride not found');
  return toPassengerView(rows[0], { events: await listEvents(pool, 'REQUEST', requestId) });
}

export async function cancelRide(passengerId, requestId) {
  return withTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM ride_requests WHERE id = $1 AND passenger_id = $2 FOR UPDATE', [
      requestId,
      passengerId,
    ]);
    const r = rows[0];
    if (!r) throw notFound('Ride not found');
    assertTransition('REQUEST', r.status, 'CANCELLED');
    const upd = await db.query(
      `UPDATE ride_requests SET status = 'CANCELLED', cancelled_reason = 'PASSENGER_CANCELLED', updated_at = now()
        WHERE id = $1 RETURNING *`,
      [requestId],
    );
    await recordEvent(db, {
      entityType: 'REQUEST', entityId: requestId, from: r.status, to: 'CANCELLED', actorId: passengerId,
    });
    return toPassengerView(upd.rows[0]);
  });
}
