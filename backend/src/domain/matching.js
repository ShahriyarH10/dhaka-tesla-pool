// Matching rule (documented assumption, see docs/ARCHITECTURE.md section 3). Pure function, no DB access.
//
// A waiting request can join an open pool iff:
//   1. the pool is still open (ACCEPTED or DRIVER_ARRIVED);
//   2. same pickup zone;
//   3. enough free seats;
//   4. its destination is within MAX_DESTINATION_GAP_M of EVERY current member's destination
//      (checking every member, not just the first, stops the route "drifting" away from early passengers).
import { distanceMeters } from './zones.js';
import { POOL_OPEN } from './stateMachine.js';

export const MAX_DESTINATION_GAP_M = 4000;

export const MATCH_REASONS = {
  POOL_CLOSED: 'This Tesla is no longer accepting passengers',
  PICKUP_MISMATCH: 'Pickup zone differs from the pool pickup zone',
  NO_SEATS: 'Not enough free seats',
  DESTINATION_TOO_FAR: 'Destination is too far from the other passengers\' destinations',
  REQUEST_NOT_WAITING: 'This request is no longer waiting for a Tesla',
};

/**
 * @param pool    { status, pickup_zone, capacity, seats_taken }
 * @param request { pickup_zone, destination_zone, seats }
 * @param memberDestinations string[] zone ids of current active members
 */
export function checkCompatibility({ pool, request, memberDestinations }) {
  if (!POOL_OPEN.includes(pool.status)) return { ok: false, reason: 'POOL_CLOSED' };
  if (request.pickup_zone !== pool.pickup_zone) return { ok: false, reason: 'PICKUP_MISMATCH' };
  if (request.seats > pool.capacity - pool.seats_taken) return { ok: false, reason: 'NO_SEATS' };
  for (const dest of memberDestinations) {
    if (distanceMeters(dest, request.destination_zone) > MAX_DESTINATION_GAP_M) {
      return { ok: false, reason: 'DESTINATION_TOO_FAR' };
    }
  }
  return { ok: true };
}
