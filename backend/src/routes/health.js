import { Router } from 'express';
import { pool } from '../db/pool.js';

export const healthRouter = Router();

// Liveness + DB readiness. Used by docker-compose and the hosting platform health check.
healthRouter.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});
