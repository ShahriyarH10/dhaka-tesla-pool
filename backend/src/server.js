import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { logger } from './utils/logger.js';

const app = createApp();
const server = app.listen(config.port, () => logger.info(`Dhaka Tesla Pool API listening on :${config.port}`));

// Graceful shutdown so in-flight transactions finish before the container stops.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    logger.info(`${sig} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
