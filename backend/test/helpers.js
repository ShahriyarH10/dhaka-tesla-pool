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

// ---- story cast factories (Jashim/Bullet, Nusrat, Rafiq, Shirin) ----
let counter = 0;
export async function makePassenger(name) {
  const res = await api('POST', '/api/auth/register', {
    body: { role: 'PASSENGER', name, email: `${name.toLowerCase()}${++counter}@example.com`, password: 'dhaka-rush-hour-9' },
  });
  return { token: res.body.token, id: res.body.user.id, name };
}

export async function makeDriver(name = 'Jashim', tesla = { name: 'Bullet', plate: `DHAKA-TESLA-${++counter}`, capacity: 3 }) {
  const res = await api('POST', '/api/auth/register', {
    body: { role: 'DRIVER', name, email: `${name.toLowerCase()}${++counter}@example.com`, password: 'dhaka-rush-hour-9', tesla },
  });
  return { token: res.body.token, id: res.body.user.id, name, tesla: res.body.tesla };
}

export const requestRide = (p, body) =>
  api('POST', '/api/rides', { token: p.token, body: { seats: 1, paymentMethod: 'CASH', ...body } });

export const goOnline = (d, online = true) => api('PATCH', '/api/driver/availability', { token: d.token, body: { online } });
export const accept = (d, rideId) => api('POST', `/api/driver/requests/${rideId}/accept`, { token: d.token });
export const getRide = (p, id) => api('GET', `/api/rides/${id}`, { token: p.token });

/** The pooling invariants that must hold after ANY sequence of operations. */
export async function assertPoolInvariants() {
  const { rows } = await pool.query(`
    SELECT p.id, p.capacity, p.seats_taken, p.status,
           COALESCE((SELECT sum(seats) FROM pool_members m WHERE m.pool_id = p.id AND m.left_at IS NULL), 0)::int AS active_seats
      FROM pools p`);
  for (const r of rows) {
    if (r.seats_taken > r.capacity) throw new Error(`pool ${r.id} overbooked: ${r.seats_taken}/${r.capacity}`);
    if (['ACCEPTED', 'DRIVER_ARRIVED', 'STARTED'].includes(r.status) && r.seats_taken !== r.active_seats) {
      throw new Error(`pool ${r.id} counter drift: seats_taken=${r.seats_taken} but active member seats=${r.active_seats}`);
    }
  }
}
