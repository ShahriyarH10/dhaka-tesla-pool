import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFare, estimateFare } from '../src/domain/fare.js';
import { distanceMeters } from '../src/domain/zones.js';
import { startTestServer, stopTestServer, api } from './helpers.js';

before(startTestServer);
after(stopTestServer);

// Hand calculation (README "Fare model"): base 4000 paisa, 1500 paisa/km, 20% pool discount.
test('Nusrat Banani->Mohakhali (2.0 km): solo 7000, pooled 5600 paisa', () => {
  const solo = calculateFare({ pickup: 'banani', destination: 'mohakhali', seats: 1, pooled: false });
  assert.equal(solo.distanceCharge, 3000); // 2.0 km * 1500
  assert.equal(solo.total, 7000); // 4000 + 3000
  const pooled = calculateFare({ pickup: 'banani', destination: 'mohakhali', seats: 1, pooled: true });
  assert.equal(pooled.poolDiscount, 1400); // 20% of 7000
  assert.equal(pooled.total, 5600);
});

test('Rafiq Banani->Gulshan 1 (3.0 km): solo 8500, pooled 6800 paisa', () => {
  const pooled = calculateFare({ pickup: 'banani', destination: 'gulshan-1', seats: 1, pooled: true });
  assert.equal(pooled.gross, 8500); // 4000 + 3.0 * 1500
  assert.equal(pooled.poolDiscount, 1700);
  assert.equal(pooled.total, 6800);
});

test('seats multiply the gross fare before the discount', () => {
  const f = calculateFare({ pickup: 'banani', destination: 'mohakhali', seats: 2, pooled: true });
  assert.equal(f.gross, 14000);
  assert.equal(f.total, 14000 - 2800);
});

test('discount rounds down (floor) and every amount is an integer', () => {
  // banani->farmgate 4.0 km: 4000 + 6000 = 10000; all pairs: totals stay integers
  for (const a of ['banani', 'gulshan-1', 'uttara']) {
    for (const b of ['mohakhali', 'dhanmondi', 'farmgate']) {
      const f = calculateFare({ pickup: a, destination: b, seats: 3, pooled: true });
      assert.ok(Number.isInteger(f.total) && Number.isInteger(f.poolDiscount));
      assert.equal(f.total + f.poolDiscount, f.gross, 'no paisa created or lost');
    }
  }
});

test('distance table is symmetric and same-zone is rejected for fares', () => {
  assert.equal(distanceMeters('banani', 'gulshan-1'), distanceMeters('gulshan-1', 'banani'));
  assert.throws(() => calculateFare({ pickup: 'banani', destination: 'banani', seats: 1 }));
});

test('GET /api/fare/estimate returns solo and pooled totals, and validates input', async () => {
  const ok = await api('GET', '/api/fare/estimate?pickup=banani&destination=mohakhali&seats=1');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.soloTotal, 7000);
  assert.equal(ok.body.pooledTotal, 5600);
  assert.equal((await api('GET', '/api/fare/estimate?pickup=banani&destination=banani')).status, 400);
  assert.equal((await api('GET', '/api/fare/estimate?pickup=atlantis&destination=banani')).status, 400);
  const zones = await api('GET', '/api/zones');
  assert.ok(zones.body.zones.some((z) => z.id === 'gulshan-1'));
});

test('estimateFare exposes both variants', () => {
  const e = estimateFare({ pickup: 'banani', destination: 'gulshan-1', seats: 1 });
  assert.equal(e.soloTotal, 8500);
  assert.equal(e.pooledTotal, 6800);
});
