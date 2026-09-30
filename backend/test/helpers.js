// Test harness: real Postgres (the point of the tests is DB-enforced invariants), real HTTP on an ephemeral port.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tesla:tesla@localhost:5432/tesla_pool_test';
process.env.JWT_SECRET = 'test-secret';

if (!/_test($|\?)/.test(process.env.DATABASE_URL)) {
  throw new Error('Refusing to run tests against a database whose name does not end in _test');
}

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');

export { pool };

let server;
let baseUrl;

export async function startTestServer() {
  await migrate({ log: () => {} });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

export async function stopTestServer() {
  await new Promise((r) => server.close(r));
  await pool.end();
}

export async function resetDb() {
  await pool.query(
    'TRUNCATE ride_events, payments, pool_members, pools, ride_requests, teslas, users RESTART IDENTITY CASCADE',
  );
}

/** Minimal fetch wrapper: returns { status, body }. */
export async function api(method, path, { token, body } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
