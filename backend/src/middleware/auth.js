import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Require a valid Bearer token. Sets req.user = { id, role }. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

/** Role gate: requireRole('DRIVER') after requireAuth. */
export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role ? next() : next(forbidden(`This action is for ${role.toLowerCase()}s only`));
