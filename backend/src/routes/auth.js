import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import * as auth from '../services/authService.js';
import { config } from '../config.js';

export const authRouter = Router();

// Brute-force guard on credential endpoints (disabled under test so suites can log in freely).
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(72); // bcrypt truncates at 72 bytes

const registerSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('PASSENGER'), name: z.string().trim().min(1).max(100), email, password }),
  z.object({
    role: z.literal('DRIVER'),
    name: z.string().trim().min(1).max(100),
    email,
    password,
    tesla: z.object({
      name: z.string().trim().min(1).max(50),
      plate: z.string().trim().toUpperCase().min(3).max(20),
      capacity: z.number().int().min(1).max(6),
    }),
  }),
]);

authRouter.post('/register', limiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { user, tesla } = await auth.register(req.body);
    res.status(201).json({ token: signToken(user), user: auth.publicUser(user), tesla });
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  '/login',
  limiter,
  validate(z.object({ email, password: z.string().min(1).max(72) })),
  async (req, res, next) => {
    try {
      const user = await auth.login(req.body);
      res.json({ token: signToken(user), user: auth.publicUser(user) });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({ user: auth.publicUser(await auth.getUserById(req.user.id)) });
  } catch (err) {
    next(err);
  }
});
