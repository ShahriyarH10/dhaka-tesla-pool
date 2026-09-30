import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { metaRouter } from './routes/meta.js';
import { ridesRouter } from './routes/rides.js';
import { driverRouter } from './routes/driver.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Vercel/nginx: correct client IP for rate limiting
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '50kb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', metaRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api/driver', driverRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
