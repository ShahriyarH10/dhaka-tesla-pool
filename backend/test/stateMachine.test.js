import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTransition, canTransition, REQUEST_TRANSITIONS, POOL_TRANSITIONS } from '../src/domain/stateMachine.js';

test('happy path request lifecycle is allowed step by step', () => {
  const path = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED'];
  for (let i = 0; i < path.length - 1; i++) assert.ok(canTransition('REQUEST', path[i], path[i + 1]));
});

test('invalid request transitions are rejected with INVALID_TRANSITION', () => {
  for (const [from, to] of [
    ['REQUESTED', 'STARTED'], ['REQUESTED', 'COMPLETED'], ['MATCHED', 'STARTED'],
    ['STARTED', 'CANCELLED'], ['DRIVER_ARRIVED', 'CANCELLED'], ['COMPLETED', 'REQUESTED'], ['CANCELLED', 'MATCHED'],
  ]) {
    assert.throws(() => assertTransition('REQUEST', from, to), (e) => e.status === 409 && e.code === 'INVALID_TRANSITION');
  }
});

test('terminal states have no exits', () => {
  assert.deepEqual(REQUEST_TRANSITIONS.COMPLETED, []);
  assert.deepEqual(REQUEST_TRANSITIONS.CANCELLED, []);
  assert.deepEqual(POOL_TRANSITIONS.COMPLETED, []);
  assert.deepEqual(POOL_TRANSITIONS.CANCELLED, []);
});

test('pool cannot skip arrival or be cancelled once started', () => {
  assert.equal(canTransition('POOL', 'ACCEPTED', 'STARTED'), false);
  assert.equal(canTransition('POOL', 'STARTED', 'CANCELLED'), false);
  assert.equal(canTransition('POOL', 'DRIVER_ARRIVED', 'STARTED'), true);
});
