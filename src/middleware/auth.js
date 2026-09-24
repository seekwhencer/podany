import config from '../config/index.js';
import { AuthService } from '../services/authService.js';
import { error } from '../utils/response.js';

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

export function getSessionToken(req) {
  const header = req.headers['x-session-token'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader) return fromHeader;
  const cookies = req.cookies || parseCookies(req.headers.cookie);
  return cookies[config.sessionCookieName] || null;
}

export function createAuthMiddleware(deps = {}) {
  const auth = deps.auth ?? new AuthService(deps);

  return async function requireAuth(req, res, next) {
    const token = getSessionToken(req);
    if (!token) {
      return error(res, 401, 'Authentication required.');
    }
    try {
      const user = await auth.resolveUser(token);
      if (!user) {
        return error(res, 401, 'Invalid or expired session.');
      }
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

const requireAuth = createAuthMiddleware();

export default requireAuth;
