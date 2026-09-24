import { RateLimiter } from '../services/rateLimiter.js';
import { error } from '../utils/response.js';

function defaultKey(req) {
  return req.ip || req.socket?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
}

export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  const limit = options.limit ?? 60;
  const keyBy = options.keyBy ?? defaultKey;
  const limiter = new RateLimiter({ windowMs, limit });

  return function rateLimit(req, res, next) {
    const result = limiter.check(keyBy(req));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return error(res, 429, 'Too many requests. Please try again later.');
    }
    next();
  };
}

export default createRateLimiter;
