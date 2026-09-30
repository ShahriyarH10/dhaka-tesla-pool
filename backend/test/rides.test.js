import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, resetDb, api, makePassenger, makeDriver, requestRide } from './helpers.js';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDb);

test('Nusrat requests Banani -> Mohakhali and sees her own estimated fare, status REQUESTED', async () => {
  const nusrat = await makePassenger('Nusrat');
  const res = await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' });
  assert.equal(res.status, 201);
  assert.equal(res.body.ride.status, 'REQUESTED');
  assert.equal(res.body.ride.farePaisa, 7000);
});

test('validation: same pickup/destination, unknown zone, bad seats', async () => {
  const nusrat = await makePassenger('Nusrat');
  assert.equal((await requestRide(nusrat, { pickup: 'banani', destination: 'banani' })).status, 400);
  assert.equal((await requestRide(nusrat, { pickup: 'atlantis', destination: 'banani' })).status, 400);
  assert.equal((await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali', seats: 0 })).status, 400);
});

test('a passenger cannot hold two active requests', async () => {
  const nusrat = await makePassenger('Nusrat');
  await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' });
  const second = await requestRide(nusrat, { pickup: 'banani', destination: 'gulshan-1' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'ACTIVE_RIDE_EXISTS');
});

test('drivers cannot request rides (role gate) and anonymous users get 401', async () => {
  const jashim = await makeDriver();
  assert.equal((await requestRide(jashim, { pickup: 'banani', destination: 'mohakhali' })).status, 403);
  assert.equal((await api('POST', '/api/rides', { body: {} })).status, 401);
});

test("users cannot view or cancel another user's ride", async () => {
  const nusrat = await makePassenger('Nusrat');
  const rafiq = await makePassenger('Rafiq');
  const ride = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  assert.equal((await api('GET', `/api/rides/${ride.id}`, { token: rafiq.token })).status, 404);
  assert.equal((await api('POST', `/api/rides/${ride.id}/cancel`, { token: rafiq.token })).status, 404);
  const still = await api('GET', `/api/rides/${ride.id}`, { token: nusrat.token });
  assert.equal(still.body.ride.status, 'REQUESTED', 'Rafiq must not have changed Nusrat\'s ride');
});

test('cancel while REQUESTED works, is recorded in history, and cannot be repeated', async () => {
  const nusrat = await makePassenger('Nusrat');
  const ride = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  const cancel = await api('POST', `/api/rides/${ride.id}/cancel`, { token: nusrat.token });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.ride.status, 'CANCELLED');
  const again = await api('POST', `/api/rides/${ride.id}/cancel`, { token: nusrat.token });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'INVALID_TRANSITION');
  const detail = await api('GET', `/api/rides/${ride.id}`, { token: nusrat.token });
  assert.deepEqual(detail.body.ride.events.map((e) => e.to), ['REQUESTED', 'CANCELLED']);
  // After cancelling she may request again.
  assert.equal((await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).status, 201);
});

test('history lists newest first', async () => {
  const nusrat = await makePassenger('Nusrat');
  const a = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  await api('POST', `/api/rides/${a.id}/cancel`, { token: nusrat.token });
  const b = (await requestRide(nusrat, { pickup: 'banani', destination: 'gulshan-1' })).body.ride;
  const list = await api('GET', '/api/rides', { token: nusrat.token });
  assert.deepEqual(list.body.rides.map((r) => r.id), [b.id, a.id]);
});

test('TeslaPay is refused when the wallet cannot cover the solo fare', async () => {
  const nusrat = await makePassenger('Nusrat');
  // Uttara -> Dhanmondi: 15 km => 4000 + 22500 = 26500 paisa, fits the 50000 signup wallet. Two seats does not.
  const ok = await requestRide(nusrat, { pickup: 'uttara', destination: 'dhanmondi', paymentMethod: 'TESLAPAY' });
  assert.equal(ok.status, 201);
  await api('POST', `/api/rides/${ok.body.ride.id}/cancel`, { token: nusrat.token });
  const no = await requestRide(nusrat, { pickup: 'uttara', destination: 'dhanmondi', seats: 2, paymentMethod: 'TESLAPAY' });
  assert.equal(no.status, 409);
  assert.equal(no.body.error.code, 'INSUFFICIENT_WALLET');
});
