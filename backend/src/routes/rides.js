import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isValidZone } from '../domain/zones.js';
import * as rides from '../services/rideService.js';

export const ridesRouter = Router();
ridesRouter.use(requireAuth, requireRole('PASSENGER'));

const zone = z.string().refine(isValidZone, 'unknown zone');

const createSchema = z
  .object({
    pickup: zone,
    destination: zone,
    seats: z.number().int().min(1).max(6).default(1),
    paymentMethod: z.enum(['CASH', 'TESLAPAY']).default('CASH'),
  })
  .refine((v) => v.pickup !== v.destination, { message: 'Pickup and destination must differ', path: ['destination'] });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

ridesRouter.post('/', validate(createSchema), wrap(async (req, res) => {
  res.status(201).json({ ride: await rides.createRideRequest(req.user.id, req.body) });
}));

ridesRouter.get('/', validate(listQuery, 'query'), wrap(async (req, res) => {
  res.json({ rides: await rides.listRides(req.user.id, req.query) });
}));

ridesRouter.get('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  res.json({ ride: await rides.getRide(req.user.id, req.params.id) });
}));

ridesRouter.post('/:id/cancel', validate(idParam, 'params'), wrap(async (req, res) => {
  res.json({ ride: await rides.cancelRide(req.user.id, req.params.id) });
}));
