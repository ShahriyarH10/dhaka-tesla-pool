// Explicit transition tables. Every status change in the codebase goes through assertTransition(),
// so "what can happen next" lives in exactly one place and is unit-tested.
import { conflict } from '../utils/errors.js';

export const REQUEST_ACTIVE = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'];

export const REQUEST_TRANSITIONS = {
  REQUESTED: ['MATCHED', 'CANCELLED'],
  MATCHED: ['DRIVER_ARRIVED', 'CANCELLED', 'REQUESTED'], // REQUESTED = driver cancelled the pool, re-queued
  DRIVER_ARRIVED: ['STARTED', 'REQUESTED'], // no passenger cancel once the Tesla has arrived
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const POOL_ACTIVE = ['ACCEPTED', 'DRIVER_ARRIVED', 'STARTED'];
export const POOL_OPEN = ['ACCEPTED', 'DRIVER_ARRIVED']; // can still take passengers / be cancelled

export const POOL_TRANSITIONS = {
  ACCEPTED: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['STARTED', 'CANCELLED'],
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

const TABLES = { REQUEST: REQUEST_TRANSITIONS, POOL: POOL_TRANSITIONS };

export function canTransition(kind, from, to) {
  return TABLES[kind][from]?.includes(to) ?? false;
}

/** Throws 409 INVALID_TRANSITION when the move is not allowed. */
export function assertTransition(kind, from, to) {
  if (!canTransition(kind, from, to)) {
    throw conflict('INVALID_TRANSITION', `Cannot move ${kind.toLowerCase()} from ${from} to ${to}`, { from, to });
  }
}
