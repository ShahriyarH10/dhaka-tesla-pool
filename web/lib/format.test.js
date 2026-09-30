import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, describeEvent } from './format.js';

test('formatMoney shows whole taka without decimals and keeps paisa exact', () => {
  assert.equal(formatMoney(5600), '৳56');
  assert.equal(formatMoney(6850), '৳68.50');
  assert.equal(formatMoney(5), '৳0.05');
});

test('describeEvent explains fare changes in plain language', () => {
  const text = describeEvent({ from: 'MATCHED', to: 'MATCHED', metadata: { type: 'FARE_RECALCULATED', fromPaisa: 7000, toPaisa: 5600 } });
  assert.equal(text, 'Fare updated from ৳70 to ৳56');
});
