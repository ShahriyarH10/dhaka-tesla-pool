/** Operational error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'VALIDATION_ERROR', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Not allowed') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (code, msg, details) => new AppError(409, code, msg, details);
