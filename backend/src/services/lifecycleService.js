// Driver-driven pool lifecycle: ACCEPTED -> DRIVER_ARRIVED -> STARTED -> COMPLETED, or CANCELLED before start.
// One pool transition moves every member request together, inside one transaction, under the pool lock
// (lock order: pool -> requests ordered by id, same as poolService).
import { withTransaction } from '../db/pool.js';
import { calculateFare } from '../domain/fare.js';
import { assertTransition } from '../domain/stateMachine.js';
import { conflict, notFound } from '../utils/errors.js';
import { recordEvent } from './eventService.js';
import { getPoolView } from './driverService.js';
import { recomputeFares, removeMember } from './poolService.js';

async function lockOwnedPool(db, poolId, driverId) {
  const { rows } = await db.query(
    `SELECT p.* FROM pools p JOIN teslas t ON t.id = p.tesla_id
      WHERE p.id = $1 AND t.driver_id = $2 FOR UPDATE OF p`,
    [poolId, driverId],
  ); // another driver's pool looks exactly like a missing pool: 404
  if (!rows[0]) throw notFound('Pool not found');
  return rows[0];
}

async function lockMemberRequests(db, poolId) {
  const { rows } = await db.query(
    `SELECT r.* FROM ride_requests r JOIN pool_members m ON m.request_id = r.id
      WHERE m.pool_id = $1 AND m.left_at IS NULL ORDER BY r.id FOR UPDATE OF r`,
    [poolId],
  );
  return rows;
}

async function setPoolStatus(db, pool, to, driverId, timestampColumn) {
  assertTransition('POOL', pool.status, to);
  await db.query(`UPDATE pools SET status = $2, ${timestampColumn} = now() WHERE id = $1`, [pool.id, to]);
  await recordEvent(db, { entityType: 'POOL', entityId: pool.id, from: pool.status, to, actorId: driverId });
}

async function setRequestStatus(db, request, to, driverId, { lockFare = false, fare = null, metadata = {} } = {}) {
  assertTransition('REQUEST', request.status, to);
  await db.query(
    `UPDATE ride_requests
        SET status = $2, updated_at = now(),
            fare_locked = fare_locked OR $3,
            fare_paisa = COALESCE($4, fare_paisa),
            fare_breakdown = COALESCE($5::jsonb, fare_breakdown)
      WHERE id = $1`,
    [request.id, to, lockFare, fare ? fare.total : null, fare ? JSON.stringify(fare) : null],
  );
  await recordEvent(db, { entityType: 'REQUEST', entityId: request.id, from: request.status, to, actorId: driverId, metadata });
}

function requireMembers(members) {
  if (members.length === 0) throw conflict('POOL_EMPTY', 'This pool has no passengers yet');
}

export function markArrived(driverId, poolId) {
  return withTransaction(async (db) => {
    const pool = await lockOwnedPool(db, poolId, driverId);
    assertTransition('POOL', pool.status, 'DRIVER_ARRIVED');
    const members = await lockMemberRequests(db, poolId);
    requireMembers(members);
    await setPoolStatus(db, pool, 'DRIVER_ARRIVED', driverId, 'arrived_at');
    for (const r of members) await setRequestStatus(db, r, 'DRIVER_ARRIVED', driverId);
    return getPoolView(db, poolId);
  });
}

export function startTrip(driverId, poolId) {
  return withTransaction(async (db) => {
    const pool = await lockOwnedPool(db, poolId, driverId);
    assertTransition('POOL', pool.status, 'STARTED');
    const members = await lockMemberRequests(db, poolId);
    requireMembers(members);
    await recomputeFares(db, poolId, driverId); // final answer before it is frozen
    await setPoolStatus(db, pool, 'STARTED', driverId, 'started_at');
    for (const r of members) await setRequestStatus(db, r, 'STARTED', driverId, { lockFare: true });
    return getPoolView(db, poolId);
  });
}

export function completeTrip(driverId, poolId) {
  return withTransaction(async (db) => {
    const pool = await lockOwnedPool(db, poolId, driverId);
    assertTransition('POOL', pool.status, 'COMPLETED');
    const members = await lockMemberRequests(db, poolId);
    await setPoolStatus(db, pool, 'COMPLETED', driverId, 'completed_at');

    for (const r of members) {
      await setRequestStatus(db, r, 'COMPLETED', driverId);
      // Payments: exactly one row per request (UNIQUE request_id makes completion idempotent).
      await db.query(
        `INSERT INTO payments (request_id, passenger_id, driver_id, method, amount_paisa) VALUES ($1,$2,$3,$4,$5)`,
        [r.id, r.passenger_id, driverId, r.payment_method, r.fare_paisa],
      );
      if (r.payment_method === 'TESLAPAY') {
        const debit = await db.query(
          `UPDATE users SET wallet_balance_paisa = wallet_balance_paisa - $2
            WHERE id = $1 AND wallet_balance_paisa >= $2 RETURNING id`,
          [r.passenger_id, r.fare_paisa],
        );
        if (debit.rowCount === 0) {
          throw conflict('WALLET_INSUFFICIENT', 'A passenger\'s TeslaPay balance no longer covers the fare', { requestId: r.id });
        }
        await db.query('UPDATE users SET wallet_balance_paisa = wallet_balance_paisa + $2 WHERE id = $1', [driverId, r.fare_paisa]);
      } // CASH: the driver collected it in person, nothing moves in the wallet
      await removeMember(db, { poolId, requestId: r.id, reason: 'COMPLETED' });
    }
    // removeMember decrements seats_taken; restore the final occupancy for history.
    await db.query('UPDATE pools SET seats_taken = $2 WHERE id = $1', [poolId, members.reduce((n, r) => n + r.seats, 0)]);
    return getPoolView(db, poolId);
  });
}

export function cancelPool(driverId, poolId) {
  return withTransaction(async (db) => {
    const pool = await lockOwnedPool(db, poolId, driverId);
    assertTransition('POOL', pool.status, 'CANCELLED'); // not allowed once STARTED
    const members = await lockMemberRequests(db, poolId);
    await setPoolStatus(db, pool, 'CANCELLED', driverId, 'cancelled_at');
    for (const r of members) {
      await removeMember(db, { poolId, requestId: r.id, reason: 'DRIVER_CANCELLED' });
      // Passengers are not punished: back to the waiting queue at the solo fare.
      const solo = calculateFare({ pickup: r.pickup_zone, destination: r.destination_zone, seats: r.seats, pooled: false });
      await setRequestStatus(db, r, 'REQUESTED', driverId, {
        fare: solo,
        metadata: { poolId, reason: 'DRIVER_CANCELLED' },
      });
    }
    return getPoolView(db, poolId);
  });
}
