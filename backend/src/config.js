// Central place for environment configuration. Fail fast on missing/unsafe values in production.
const env = process.env;

export const config = {
  nodeEnv: env.NODE_ENV || 'development',
  port: Number(env.PORT || 4000),
  databaseUrl: env.DATABASE_URL || 'postgres://tesla:tesla@localhost:5432/tesla_pool',
  databaseSsl: env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:3000',
  logLevel: env.LOG_LEVEL || 'info',
  seedDemoData: env.SEED_DEMO_DATA === 'true',
};

if (config.nodeEnv === 'production' && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
