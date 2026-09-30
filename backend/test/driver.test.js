import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDb, pool, api,
  makePassenger, makeDriver, requestRide, goOnline, accept, getRide, assertPoolInvariants,
} from './helpers.js';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDb);

const act = (d, poolId, action) => api('POST', `/api/driver/pools/${poolId}/${action}`, { token: d.token });

/** Jashim is online with Nusrat (cash, Banani->Mohakhali) and Rafiq (TeslaPay, Banani->Gulshan 1) in Bullet. */
async function pooledBullet() {
  const jashim = await makeDriver('Jashim');
  const nusrat = await makePassenger('Nusrat');
  const rafiq = await makePassenger('Rafiq');
  await goOnline(jashim);
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  const poolId = (await accept(jashim, n.id)).body.pool.id;
  const r = (await requestRide(rafiq, { pickup: 'banani', destination: 'gulshan-1', paymentMethod: 'TESLAPAY' })).body.ride;
  return { jashim, nusrat, rafiq, n, r, poolId };
}

test('full happy path: arrive -> start -> complete, statuses mirror to passengers, payments settle', async () => {
  const { jashim, nusrat, rafiq, n, r, poolId } = await pooledBullet();

  assert.equal((await act(jashim, poolId, 'arrive')).body.pool.status, 'DRIVER_ARRIVED');
  assert.equal((await getRide(nusrat, n.id)).body.ride.status, 'DRIVER_ARRIVED');

  const started = await act(jashim, poolId, 'start');
  assert.equal(started.body.pool.status, 'STARTED');
  const nStarted = (await getRide(nusrat, n.id)).body.ride;
  assert.equal(nStarted.status, 'STARTED');
  assert.equal(nStarted.fareLocked, true);
  assert.equal(nStarted.farePaisa, 5600);

  const done = await act(jashim, poolId, 'complete');
  assert.equal(done.status, 200);
  assert.equal(done.body.pool.status, 'COMPLETED');
  assert.equal(done.body.pool.seatsTaken, 2, 'history keeps final occupancy');
  assert.equal((await getRide(nusrat, n.id)).body.ride.status, 'COMPLETED');
  assert.equal((await getRide(rafiq, r.id)).body.ride.status, 'COMPLETED');

  // Money: Rafiq paid 6800 via TeslaPay (500 BDT signup wallet = 50000), Nusrat paid cash => wallet untouched.
  const wallets = Object.fromEntries((await pool.query('SELECT name, wallet_balance_paisa FROM users')).rows.map((x) => [x.name, x.wallet_balance_paisa]));
  assert.equal(wallets.Rafiq, 50000 - 6800);
  assert.equal(wallets.Nusrat, 50000);
  assert.equal(wallets.Jashim, 6800, 'driver credited only for the TeslaPay fare');
  const pays = (await pool.query('SELECT method, amount_paisa FROM payments ORDER BY amount_paisa')).rows;
  assert.deepEqual(pays, [{ method: 'CASH', amount_paisa: 5600 }, { method: 'TESLAPAY', amount_paisa: 6800 }]);
  await assertPoolInvariants();
});

test('history explains exactly what happened: ordered events with actors', async () => {
  const { jashim, poolId } = await pooledBullet();
  for (const a of ['arrive', 'start', 'complete']) await act(jashim, poolId, a);
  const detail = (await api('GET', `/api/driver/pools/${poolId}`, { token: jashim.token })).body.pool;
  assert.deepEqual(detail.events.map((e) => e.to), ['ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED']);
  assert.ok(detail.events.every((e) => e.actor?.name === 'Jashim'));
  const list = (await api('GET', '/api/driver/pools', { token: jashim.token })).body.pools;
  assert.equal(list.length, 1);
  assert.equal(list[0].passengers.length, 2);
});

test('invalid transitions are rejected with 409 INVALID_TRANSITION', async () => {
  const { jashim, poolId } = await pooledBullet();
  for (const action of ['start', 'complete']) {
    const res = await act(jashim, poolId, action);
    assert.equal(res.status, 409, `${action} from ACCEPTED`);
    assert.equal(res.body.error.code, 'INVALID_TRANSITION');
  }
  await act(jashim, poolId, 'arrive');
  assert.equal((await act(jashim, poolId, 'arrive')).body.error.code, 'INVALID_TRANSITION');
  assert.equal((await act(jashim, poolId, 'complete')).body.error.code, 'INVALID_TRANSITION');
  await act(jashim, poolId, 'start');
  assert.equal((await act(jashim, poolId, 'cancel')).body.error.code, 'INVALID_TRANSITION', 'cannot cancel a moving Tesla');
  await act(jashim, poolId, 'complete');
  assert.equal((await act(jashim, poolId, 'complete')).status, 409, 'completing twice must not pay twice');
  assert.equal((await pool.query('SELECT count(*)::int n FROM payments')).rows[0].n, 2);
});

test('cancellation rules: passenger can cancel when MATCHED but not after the Tesla arrived or started', async () => {
  const { jashim, nusrat, rafiq, n, r, poolId } = await pooledBullet();
  await act(jashim, poolId, 'arrive');
  const late = await api('POST', `/api/rides/${n.id}/cancel`, { token: nusrat.token });
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, 'INVALID_TRANSITION');
  await act(jashim, poolId, 'start');
  assert.equal((await api('POST', `/api/rides/${r.id}/cancel`, { token: rafiq.token })).status, 409);
});

test('a started Tesla takes no more passengers and its fares no longer change', async () => {
  const { jashim, nusrat, poolId } = await pooledBullet();
  const shirin = await makePassenger('Shirin');
  await act(jashim, poolId, 'arrive');
  await act(jashim, poolId, 'start');
  const s = (await requestRide(shirin, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  assert.equal(s.status, 'REQUESTED', 'Shirin cannot hop onto a moving Tesla');
  assert.equal((await accept(jashim, s.id)).body.error.code, 'POOL_IN_PROGRESS');
  assert.equal((await getRide(nusrat, (await pool.query(`SELECT id FROM ride_requests WHERE status='STARTED' AND passenger_id=$1`, [nusrat.id])).rows[0].id)).body.ride.farePaisa, 5600);
});

test("users cannot operate another driver's pool", async () => {
  const { poolId } = await pooledBullet();
  const kalam = await makeDriver('Kalam');
  for (const action of ['arrive', 'start', 'complete', 'cancel']) {
    assert.equal((await act(kalam, poolId, action)).status, 404, action);
  }
  assert.equal((await api('GET', `/api/driver/pools/${poolId}`, { token: kalam.token })).status, 404);
  const nusrat = await makePassenger('Shirin');
  assert.equal((await api('POST', `/api/driver/pools/${poolId}/start`, { token: nusrat.token })).status, 403, 'passengers cannot drive');
});

test('driver cancelling a pool re-queues passengers at the solo fare and frees Bullet', async () => {
  const { jashim, nusrat, rafiq, n, r, poolId } = await pooledBullet();
  const res = await act(jashim, poolId, 'cancel');
  assert.equal(res.status, 200);
  assert.equal(res.body.pool.status, 'CANCELLED');
  const nAfter = (await getRide(nusrat, n.id)).body.ride;
  assert.equal(nAfter.status, 'REQUESTED');
  assert.equal(nAfter.farePaisa, 7000, 'back to the solo fare');
  assert.equal(nAfter.pool, null);
  assert.equal((await getRide(rafiq, r.id)).body.ride.farePaisa, 8500);
  // Jashim is free to accept again; a fresh pool is created.
  const again = await accept(jashim, n.id);
  assert.equal(again.status, 200);
  assert.notEqual(again.body.pool.id, poolId);
  await assertPoolInvariants();
});

test('cannot depart with an empty pool (every passenger cancelled while MATCHED)', async () => {
  const jashim = await makeDriver('Jashim');
  const nusrat = await makePassenger('Nusrat');
  await goOnline(jashim);
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  const poolId = (await accept(jashim, n.id)).body.pool.id;
  assert.equal((await api('POST', `/api/rides/${n.id}/cancel`, { token: nusrat.token })).status, 200);

  const res = await act(jashim, poolId, 'arrive');
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'POOL_EMPTY');
  // The empty pool can still be cancelled, which frees Bullet.
  assert.equal((await act(jashim, poolId, 'cancel')).status, 200);
  await assertPoolInvariants();
});
