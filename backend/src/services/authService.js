import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../db/pool.js';
import { AppError, conflict, unauthorized } from '../utils/errors.js';

const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 10;

// Precomputed hash used to burn the same CPU time when the email does not exist (no user-enumeration timing leak).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  walletBalancePaisa: u.wallet_balance_paisa,
});

// Signup bonus for the simulated TeslaPay wallet (paisa): 500 BDT, so the demo works out of the box.
const SIGNUP_WALLET_PAISA = 50000;

export async function register({ name, email, password, role, tesla }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    return await withTransaction(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash, role, wallet_balance_paisa)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name, email, passwordHash, role, role === 'PASSENGER' ? SIGNUP_WALLET_PAISA : 0],
      );
      const user = rows[0];
      let teslaRow = null;
      if (role === 'DRIVER') {
        const t = await db.query(
          `INSERT INTO teslas (driver_id, name, plate, capacity) VALUES ($1,$2,$3,$4) RETURNING *`,
          [user.id, tesla.name, tesla.plate, tesla.capacity],
        );
        teslaRow = t.rows[0];
      }
      return { user, tesla: teslaRow };
    });
  } catch (err) {
    if (err.code === '23505') {
      const what = err.constraint?.includes('plate') ? 'plate' : 'email';
      throw conflict(what === 'plate' ? 'PLATE_TAKEN' : 'EMAIL_TAKEN', `That ${what} is already registered`);
    }
    throw err;
  }
}

export async function login({ email, password }) {
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password'); // same message for both cases
  return user;
}

export async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');
  return rows[0];
}
