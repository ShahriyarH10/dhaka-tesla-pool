import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, api } from './helpers.js';

before(startTestServer);
after(stopTestServer);

test('GET /api/health reports db up', async () => {
  const { status, body } = await api('GET', '/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok', db: 'up' });
});

test('unknown routes return a JSON 404, not an HTML page', async () => {
  const { status, body } = await api('GET', '/api/nope');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});
