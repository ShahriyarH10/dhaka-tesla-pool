// Pool membership, seat accounting and per-passenger fares.
//
// CONCURRENCY RULES (see docs/ARCHITECTURE.md section 5):
//   * Lock order is always  pool row  ->  request rows (ordered by id). Never the other way round,
//     otherwise a join and a cancel could deadlock.
//   * Seat claims are a conditional UPDATE guarded by CHECK (seats_taken <= capacity) as a backstop.
//   * Every function here expects to run INSIDE a transaction supplied by the caller.
import { calculateFare } from '../domain/fare.js';
import { checkCompatibility } from '../domain/matching.js';
import { notFound } from '../utils/errors.js';
import { recordEvent } from './eventService.js';

/** Lock a pool row for the rest of the transaction. */
export async function lockPool(db, poolId) {
  const { rows } = await db.query('SELECT * FROM pools WHERE id = $1 FOR UPDATE', [poolId]);
  if (!rows[0]) throw notFound('Pool not found');
  return rows[0];
}

export async function activeMembers(db, poolId) {
  const { rows } = await db.query(
    `SELECT m.id AS member_id, m.seats AS member_seats, r.*
       FROM pool_members m JOIN ride_requests r ON r.id = m.request_id
      WHERE m.pool_id = $1 AND m.left_at IS NULL ORDER BY r.id`,
    [poolId],
  );
  return rows;
}

/**
 * Recalculate every unlocked member's fare. Pooled = 2+ active passengers.
 * Called after every join/leave, so the first passenger's fare drops when a second one joins
 * and rises again if that second passenger cancels.
 */
export async function recomputeFares(db, poolId, actorId = null) {
  const { rows } = await db.query(
    `SELECT r.* FROM ride_requests r JOIN pool_members m ON m.request_id = r.id
      WHERE m.pool_id = $1 AND m.left_at IS NULL ORDER BY r.id FOR UPDATE OF r`,
    [poolId],
  );
  const pooled = rows.length >= 2;
  for (const r of rows) {
    if (r.fare_locked) continue;
    const fare = calculateFare({ pickup: r.pickup_zone, destination: r.destination_zone, seats: r.seats, pooled });
    if (fare.total === r.fare_paisa && r.fare_breakdown?.pooled === fare.pooled) continue;
    await db.query(
      `UPDATE ride_requests SET fare_paisa = $2, fare_breakdown = $3, updated_at = now() WHERE id = $1`,
      [r.id, fare.total, JSON.stringify(fare)],
    );
    await recordEvent(db, {
      entityType: 'REQUEST', entityId: r.id, from: r.status, to: r.status, actorId,
      metadata: { type: 'FARE_RECALCULATED', fromPaisa: r.fare_paisa, toPaisa: fare.total, pooled },
    });
  }
}

/**
 * Try to put a waiting request into a pool. Never throws for "not compatible" outcomes,
 * returns { ok:false, reason } instead, so callers can skip to the next candidate pool.
 */
export async function tryJoinPool(db, { poolId, requestId, actorId, source }) {
  const pool = await lockPool(db, poolId);

  const reqRes = await db.query('SELECT * FROM ride_requests WHERE id = $1', [requestId]);
  const request = reqRes.rows[0];
  if (!request || request.status !== 'REQUESTED') return { ok: false, reason: 'REQUEST_NOT_WAITING' };

  const members = await activeMembers(db, poolId);
  const verdict = checkCompatibility({
    pool,
    request,
    memberDestinations: members.map((m) => m.destination_zone),
  });
  if (!verdict.ok) return verdict;

  // 1) claim the request: only one transaction can move it REQUESTED -> MATCHED
  const claim = await db.query(
    `UPDATE ride_requests SET status = 'MATCHED', updated_at = now()
      WHERE id = $1 AND status = 'REQUESTED' RETURNING id`,
    [requestId],
  );
  if (claim.rowCount === 0) return { ok: false, reason: 'REQUEST_NOT_WAITING' };

  // 2) claim the seats: conditional UPDATE, the row lock + predicate make this atomic
  const seat = await db.query(
    `UPDATE pools SET seats_taken = seats_taken + $2
      WHERE id = $1 AND status IN ('ACCEPTED','DRIVER_ARRIVED') AND seats_taken + $2 <= capacity
      RETURNING *`,
    [poolId, request.seats],
  );
  if (seat.rowCount === 0) {
    // Cannot happen while we hold the pool lock and checkCompatibility passed, but never trust "cannot happen":
    await db.query(`UPDATE ride_requests SET status = 'REQUESTED' WHERE id = $1`, [requestId]);
    return { ok: false, reason: 'NO_SEATS' };
  }

  await db.query('INSERT INTO pool_members (pool_id, request_id, seats) VALUES ($1,$2,$3)', [
    poolId, requestId, request.seats,
  ]);
  await recordEvent(db, {
    entityType: 'REQUEST', entityId: requestId, from: 'REQUESTED', to: 'MATCHED', actorId,
    metadata: { poolId, source },
  });
  await recomputeFares(db, poolId, actorId);
  return { ok: true, poolId };
}

/** Remove an active member and free its seats. Caller has already locked the pool. */
export async function removeMember(db, { poolId, requestId, reason }) {
  const left = await db.query(
    `UPDATE pool_members SET left_at = now(), left_reason = $3
      WHERE pool_id = $1 AND request_id = $2 AND left_at IS NULL RETURNING seats`,
    [poolId, requestId, reason],
  );
  if (left.rowCount === 0) return false;
  await db.query('UPDATE pools SET seats_taken = seats_taken - $2 WHERE id = $1', [poolId, left.rows[0].seats]);
  return true;
}
