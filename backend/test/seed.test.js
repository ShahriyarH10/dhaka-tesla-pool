import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, resetDb, api } from './helpers.js';

const { seed, DEMO_PASSWORD } = await import('../src/db/seed.js');

before(startTestServer);
after(stopTestServer);
beforeEach(resetDb);

test('seed creates the story cast, is idempotent, and demo logins work', async () => {
  await seed({ log: () => {} });
  await seed({ log: () => {} }); // second run must not throw or duplicate
  const jashim = await api('POST', '/api/auth/login', { body: { email: 'jashim@teslapool.dev', password: DEMO_PASSWORD } });
  assert.equal(jashim.status, 200);
  assert.equal(jashim.body.user.role, 'DRIVER');
  for (const who of ['nusrat', 'rafiq', 'shirin']) {
    const res = await api('POST', '/api/auth/login', { body: { email: `${who}@teslapool.dev`, password: DEMO_PASSWORD } });
    assert.equal(res.status, 200, who);
  }
});
