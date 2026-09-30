import { Router } from 'express';
import { z } from 'zod';
import { ZONES, isValidZone } from '../domain/zones.js';
import { estimateFare, FARE_CONFIG } from '../domain/fare.js';
import { validate } from '../middleware/validate.js';
import { badRequest } from '../utils/errors.js';

export const metaRouter = Router();

metaRouter.get('/zones', (_req, res) => res.json({ zones: ZONES.map(({ id, name }) => ({ id, name })) }));

const estimateQuery = z.object({
  pickup: z.string().refine(isValidZone, 'unknown zone'),
  destination: z.string().refine(isValidZone, 'unknown zone'),
  seats: z.coerce.number().int().min(1).max(6).default(1),
});

// Public: anyone can see a price before signing up.
metaRouter.get('/fare/estimate', validate(estimateQuery, 'query'), (req, res, next) => {
  const { pickup, destination, seats } = req.query;
  if (pickup === destination) return next(badRequest('Pickup and destination must be different zones'));
  res.json({ config: FARE_CONFIG, ...estimateFare({ pickup, destination, seats }) });
});
