import { badRequest } from '../utils/errors.js';

/** Validate req[source] against a zod schema; replaces it with the parsed (trimmed/coerced) value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(badRequest('Invalid request', details));
  }
  req[source] = result.data;
  next();
};
