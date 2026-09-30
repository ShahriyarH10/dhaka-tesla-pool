import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, stopTestServer, resetDb, api } from './helpers.js';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDb);

const nusrat = { role: 'PASSENGER', name: 'Nusrat', email: 'nusrat@example.com', password: 'banani-rush-8am' };
const jashim = {
  role: 'DRIVER', name: 'Jashim', email: 'jashim@example.com', password: 'bullet-three-seats',
  tesla: { name: 'Bullet', plate: 'DHAKA-METRO-TESLA-1', capacity: 3 },
};

test('passenger can register, receives a token, and /me works', async () => {
  const reg = await api('POST', '/api/auth/register', { body: nusrat });
  assert.equal(reg.status, 201);
  assert.ok(reg.body.token);
  assert.equal(reg.body.user.role, 'PASSENGER');
  assert.equal(reg.body.user.password_hash, undefined, 'password hash must never be returned');
  const me = await api('GET', '/api/auth/me', { token: reg.body.token });
  assert.equal(me.body.user.email, 'nusrat@example.com');
});

test('driver registration creates Bullet with fixed capacity', async () => {
  const reg = await api('POST', '/api/auth/register', { body: jashim });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.tesla.name, 'Bullet');
  assert.equal(reg.body.tesla.capacity, 3);
});

test('duplicate email (case-insensitive) is rejected with 409', async () => {
  await api('POST', '/api/auth/register', { body: nusrat });
  const dup = await api('POST', '/api/auth/register', { body: { ...nusrat, email: 'NUSRAT@example.com' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'EMAIL_TAKEN');
});

test('validation: short password and missing tesla for driver are 400', async () => {
  const a = await api('POST', '/api/auth/register', { body: { ...nusrat, password: 'short' } });
  assert.equal(a.status, 400);
  const b = await api('POST', '/api/auth/register', { body: { ...jashim, tesla: undefined } });
  assert.equal(b.status, 400);
});

test('login: correct password succeeds, wrong password and unknown email give the same 401', async () => {
  await api('POST', '/api/auth/register', { body: nusrat });
  const ok = await api('POST', '/api/auth/login', { body: { email: 'nusrat@example.com', password: nusrat.password } });
  assert.equal(ok.status, 200);
  const bad = await api('POST', '/api/auth/login', { body: { email: 'nusrat@example.com', password: 'wrong-password' } });
  const ghost = await api('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'whatever123' } });
  assert.equal(bad.status, 401);
  assert.equal(ghost.status, 401);
  assert.equal(bad.body.error.message, ghost.body.error.message);
});

test('protected routes reject missing and tampered tokens', async () => {
  assert.equal((await api('GET', '/api/auth/me')).status, 401);
  assert.equal((await api('GET', '/api/auth/me', { token: 'not.a.jwt' })).status, 401);
});
