import cors from 'cors';
import config from '../config/index.js';

export function createCors(options = {}) {
  const allowed = options.origin ?? config.corsOrigin;

  return cors({
    origin(req, cb) {
      if (allowed === '*' || allowed === true) {
        return cb(null, true);
      }
      const allowlist = Array.isArray(allowed) ? allowed : [allowed];
      const requestOrigin = typeof req === 'string' ? req : (req && req.headers ? req.headers.origin : undefined);
      cb(null, allowlist.indexOf(requestOrigin) !== -1 ? requestOrigin : false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'Range']
  });
}

const corsMiddleware = createCors();

export default corsMiddleware;
