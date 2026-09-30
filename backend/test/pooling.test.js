import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, resetDb, pool, api,
  makePassenger, makeDriver, requestRide, goOnline, accept, getRide, assertPoolInvariants,
} from './helpers.js';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDb);

// The Banani rush-hour story from the brief.
async function cast() {
  const [jashim, nusrat, rafiq, shirin] = [await makeDriver('Jashim'), ...(await Promise.all(['Nusrat', 'Rafiq', 'Shirin'].map(makePassenger)))];
  await goOnline(jashim);
  return { jashim, nusrat, rafiq, shirin };
}

test('Nusrat + Rafiq share Bullet: individual pooled fares 5600 and 6800 paisa', async () => {
  const { jashim, nusrat, rafiq } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  assert.equal(n.farePaisa, 7000, 'alone she pays the solo fare');

  const pool1 = await accept(jashim, n.id);
  assert.equal(pool1.status, 200);
  assert.equal(pool1.body.pool.seatsTaken, 1);

  // Two minutes later Rafiq books: the app matches him into Bullet immediately.
  const r = (await requestRide(rafiq, { pickup: 'banani', destination: 'gulshan-1' })).body.ride;
  assert.equal(r.status, 'MATCHED');
  assert.equal(r.farePaisa, 6800);
  assert.equal(r.pool.teslaName, 'Bullet');
  assert.equal(r.pool.coPassengers, 1);

  // Nusrat's fare dropped because the pool formed, and she sees only her own numbers.
  const nAfter = (await getRide(nusrat, n.id)).body.ride;
  assert.equal(nAfter.farePaisa, 5600);
  assert.equal(nAfter.fareBreakdown.poolDiscount, 1400);
  assert.equal(nAfter.pool.coPassengers, 1);
  assert.equal(nAfter.pool.capacity, 3, 'passenger UI needs the seat count to draw the strip');
  assert.doesNotMatch(JSON.stringify(nAfter), /Rafiq|6800/, "Nusrat must not see Rafiq's name or fare");
  assert.ok(nAfter.events.some((e) => e.metadata.type === 'FARE_RECALCULATED'), 'fare change is auditable');

  const view = (await api('GET', '/api/driver/me', { token: jashim.token })).body.activePool;
  assert.equal(view.seatsTaken, 2);
  assert.equal(view.seatsFree, 1);
  assert.deepEqual(view.passengers.map((p) => p.name).sort(), ['Nusrat', 'Rafiq']);
  await assertPoolInvariants();
});

test('matching rule: different pickup or destination too far does NOT pool', async () => {
  const { jashim, nusrat, shirin, rafiq } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  await accept(jashim, n.id);

  const farDest = (await requestRide(shirin, { pickup: 'banani', destination: 'dhanmondi' })).body.ride; // 6.5 km from Mohakhali
  assert.equal(farDest.status, 'REQUESTED');
  const otherPickup = (await requestRide(rafiq, { pickup: 'uttara', destination: 'mohakhali' })).body.ride;
  assert.equal(otherPickup.status, 'REQUESTED');

  // Driver is also refused if they try to force it.
  const forced = await accept(jashim, farDest.id);
  assert.equal(forced.status, 409);
  assert.equal(forced.body.error.code, 'DESTINATION_TOO_FAR');
  const forced2 = await accept(jashim, otherPickup.id);
  assert.equal(forced2.body.error.code, 'PICKUP_MISMATCH');
  await assertPoolInvariants();
});

test("Bullet's capacity is never exceeded: a 2-seat request cannot join with 1 seat left", async () => {
  const { jashim, nusrat, rafiq, shirin } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali', seats: 2 })).body.ride;
  await accept(jashim, n.id);
  const r = (await requestRide(rafiq, { pickup: 'banani', destination: 'mohakhali' })).body.ride; // 3/3 full
  assert.equal(r.status, 'MATCHED');
  const s = (await requestRide(shirin, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  assert.equal(s.status, 'REQUESTED', 'Bullet is full; Shirin waits');
  const forced = await accept(jashim, s.id);
  assert.equal(forced.status, 409);
  assert.equal(forced.body.error.code, 'NO_SEATS');
  await assertPoolInvariants();
});

test('a request needing more seats than the Tesla has cannot be accepted', async () => {
  const { jashim, nusrat } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali', seats: 4 })).body.ride;
  const res = await accept(jashim, n.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EXCEEDS_CAPACITY');
});

test('offline drivers cannot accept; going offline mid-pool is refused', async () => {
  const { jashim, nusrat } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  await goOnline(jashim, false);
  assert.equal((await accept(jashim, n.id)).body.error.code, 'DRIVER_OFFLINE');
  await goOnline(jashim, true);
  await accept(jashim, n.id);
  const off = await goOnline(jashim, false);
  assert.equal(off.status, 409);
  assert.equal(off.body.error.code, 'ACTIVE_POOL');
});

test('cancellation by a matched passenger frees the seat and restores the survivor\'s solo fare', async () => {
  const { jashim, nusrat, rafiq } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  await accept(jashim, n.id);
  const r = (await requestRide(rafiq, { pickup: 'banani', destination: 'gulshan-1' })).body.ride;
  assert.equal((await getRide(nusrat, n.id)).body.ride.farePaisa, 5600);

  const cancel = await api('POST', `/api/rides/${r.id}/cancel`, { token: rafiq.token });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.ride.status, 'CANCELLED');

  assert.equal((await getRide(nusrat, n.id)).body.ride.farePaisa, 7000, 'discount disappears when alone again');
  const view = (await api('GET', '/api/driver/me', { token: jashim.token })).body.activePool;
  assert.equal(view.seatsTaken, 1);
  const rafiqRow = view.passengers.find((p) => p.name === 'Rafiq');
  assert.equal(rafiqRow.leftReason, 'PASSENGER_CANCELLED', 'history keeps who left and why');
  await assertPoolInvariants();
});

test('driver sees only compatible requests once a pool is open', async () => {
  const { jashim, nusrat, rafiq, shirin } = await cast();
  const far = (await requestRide(shirin, { pickup: 'banani', destination: 'dhanmondi' })).body.ride;
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  const before = (await api('GET', '/api/driver/requests', { token: jashim.token })).body.requests;
  assert.equal(before.length, 2, 'with no pool, every waiting request that fits is relevant');
  await accept(jashim, n.id);
  const after = (await api('GET', '/api/driver/requests', { token: jashim.token })).body.requests;
  assert.equal(after.length, 0, 'Shirin to Dhanmondi no longer fits the open pool');
  assert.ok(far.id);
  void rafiq;
});

// ---------------- CONCURRENCY ----------------

test('CONCURRENCY: Bullet has 1 seat left, Nusrat and Shirin claim it at the same instant -> exactly one wins', async () => {
  const { jashim, nusrat, rafiq, shirin } = await cast();
  // Rafiq (2 seats) is accepted first, leaving exactly one seat on Bullet.
  const r = (await requestRide(rafiq, { pickup: 'banani', destination: 'gulshan-1', seats: 2 })).body.ride;
  await accept(jashim, r.id);

  const [a, b] = await Promise.all([
    requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' }),
    requestRide(shirin, { pickup: 'banani', destination: 'mohakhali' }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const statuses = [a.body.ride.status, b.body.ride.status].sort();
  assert.deepEqual(statuses, ['MATCHED', 'REQUESTED'], 'one gets the seat, the other keeps waiting');

  const view = (await api('GET', '/api/driver/me', { token: jashim.token })).body.activePool;
  assert.equal(view.seatsTaken, 3);
  assert.equal(view.passengers.filter((p) => p.active).length, 2);
  await assertPoolInvariants();
});

test('CONCURRENCY: 12 passengers race for 1 remaining seat -> capacity holds, exactly one MATCHED', async () => {
  const jashim = await makeDriver('Jashim');
  await goOnline(jashim);
  const seed = await makePassenger('Rafiq');
  const r = (await requestRide(seed, { pickup: 'banani', destination: 'gulshan-1', seats: 2 })).body.ride;
  await accept(jashim, r.id);

  const crowd = await Promise.all(Array.from({ length: 12 }, (_, i) => makePassenger(`Commuter${i}`)));
  const results = await Promise.all(crowd.map((p) => requestRide(p, { pickup: 'banani', destination: 'mohakhali' })));
  assert.ok(results.every((x) => x.status === 201));
  assert.equal(results.filter((x) => x.body.ride.status === 'MATCHED').length, 1);
  assert.equal(results.filter((x) => x.body.ride.status === 'REQUESTED').length, 11);
  await assertPoolInvariants();
});

test('CONCURRENCY: driver double-accepts two waiting requests for the last seat -> one 200, one 409 NO_SEATS', async () => {
  const { jashim, nusrat, rafiq, shirin } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride; // waiting
  const s = (await requestRide(shirin, { pickup: 'banani', destination: 'mohakhali' })).body.ride; // waiting
  const r = (await requestRide(rafiq, { pickup: 'banani', destination: 'gulshan-1', seats: 2 })).body.ride; // waiting
  assert.equal((await accept(jashim, r.id)).status, 200); // 2/3, Nusrat and Shirin still waiting

  const [x, y] = await Promise.all([accept(jashim, n.id), accept(jashim, s.id)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const loser = x.status === 409 ? x : y;
  assert.equal(loser.body.error.code, 'NO_SEATS');
  await assertPoolInvariants();
});

test('CONCURRENCY: two drivers accept the same request -> only one gets it', async () => {
  const jashim = await makeDriver('Jashim');
  const kalam = await makeDriver('Kalam');
  await goOnline(jashim);
  await goOnline(kalam);
  const nusrat = await makePassenger('Nusrat');
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  const [x, y] = await Promise.all([accept(jashim, n.id), accept(kalam, n.id)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM pool_members WHERE request_id = $1 AND left_at IS NULL', [n.id]);
  assert.equal(rows[0].n, 1);
  await assertPoolInvariants();
});

test('CONCURRENCY: passenger cancels while the driver accepts -> consistent outcome, no deadlock, no ghost seat', async () => {
  for (let i = 0; i < 15; i++) {
    await resetDb();
    const { jashim, nusrat } = await cast();
    const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
    const [acc, can] = await Promise.all([accept(jashim, n.id), api('POST', `/api/rides/${n.id}/cancel`, { token: nusrat.token })]);
    assert.ok([200, 409].includes(acc.status), `accept status ${acc.status}`);
    assert.ok([200, 409].includes(can.status), `cancel status ${can.status}`);
    const final = (await getRide(nusrat, n.id)).body.ride;
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM pool_members WHERE request_id = $1 AND left_at IS NULL', [n.id]);
    if (final.status === 'CANCELLED') assert.equal(rows[0].n, 0, 'cancelled rides hold no seat');
    else assert.equal(rows[0].n, 1);
    await assertPoolInvariants();
  }
});

test('DB BACKSTOP: even raw SQL cannot overbook a Tesla (CHECK constraint)', async () => {
  const { jashim, nusrat } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  const view = (await accept(jashim, n.id)).body.pool;
  await assert.rejects(
    pool.query('UPDATE pools SET seats_taken = capacity + 1 WHERE id = $1', [view.id]),
    (e) => e.code === '23514',
  );
});

test('DB BACKSTOP: a Tesla cannot run two active pools', async () => {
  const { jashim, nusrat } = await cast();
  const n = (await requestRide(nusrat, { pickup: 'banani', destination: 'mohakhali' })).body.ride;
  const p1 = (await accept(jashim, n.id)).body.pool;
  await assert.rejects(
    pool.query(`INSERT INTO pools (tesla_id, pickup_zone, capacity) SELECT tesla_id, pickup_zone, capacity FROM pools WHERE id = $1`, [p1.id]),
    (e) => e.code === '23505',
  );
});
