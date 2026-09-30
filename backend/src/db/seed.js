// Demo data using the Banani rush-hour cast. Idempotent: safe to run on every container start.
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

export const DEMO_PASSWORD = 'tesla-pool-demo';

const PASSENGERS = [
  { name: 'Nusrat', email: 'nusrat@teslapool.dev' },
  { name: 'Rafiq', email: 'rafiq@teslapool.dev' },
  { name: 'Shirin', email: 'shirin@teslapool.dev' },
];
const DRIVER = { name: 'Jashim', email: 'jashim@teslapool.dev', tesla: { name: 'Bullet', plate: 'DHAKA-METRO-TESLA-1', capacity: 3 } };

export async function seed({ log = console.log } = {}) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of PASSENGERS) {
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, wallet_balance_paisa)
         VALUES ($1,$2,$3,'PASSENGER',50000) ON CONFLICT (lower(email)) DO NOTHING`,
        [p.name, p.email, hash],
      );
    }
    const d = await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'DRIVER')
       ON CONFLICT (lower(email)) DO NOTHING RETURNING id`,
      [DRIVER.name, DRIVER.email, hash],
    );
    if (d.rowCount) {
      await client.query(`INSERT INTO teslas (driver_id, name, plate, capacity) VALUES ($1,$2,$3,$4)`, [
        d.rows[0].id, DRIVER.tesla.name, DRIVER.tesla.plate, DRIVER.tesla.capacity,
      ]);
    }
    await client.query('COMMIT');
    log(`seed ok: Jashim (Bullet, 3 seats), Nusrat, Rafiq, Shirin  - password "${DEMO_PASSWORD}"`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
