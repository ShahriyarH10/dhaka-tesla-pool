import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isValidZone } from '../domain/zones.js';
import * as driver from '../services/driverService.js';

export const driverRouter = Router();
driverRouter.use(requireAuth, requireRole('DRIVER'));

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const idParam = z.object({ id: z.string().uuid() });

driverRouter.get('/me', wrap(async (req, res) => {
  res.json(await driver.getProfile(req.user.id));
}));

driverRouter.patch('/availability', validate(z.object({ online: z.boolean() })), wrap(async (req, res) => {
  res.json({ tesla: await driver.setAvailability(req.user.id, req.body.online) });
}));

const requestsQuery = z.object({ zone: z.string().refine(isValidZone, 'unknown zone').optional() });

driverRouter.get('/requests', validate(requestsQuery, 'query'), wrap(async (req, res) => {
  res.json(await driver.listRelevantRequests(req.user.id, req.query));
}));

driverRouter.post('/requests/:id/accept', validate(idParam, 'params'), wrap(async (req, res) => {
  res.json({ pool: await driver.acceptRequest(req.user.id, req.params.id) });
}));
