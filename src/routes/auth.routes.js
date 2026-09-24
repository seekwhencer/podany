import { Router } from 'express';
import { AuthService } from '../services/authService.js';
import config from '../config/index.js';
import { getSessionToken } from '../middleware/auth.js';
import { json } from '../utils/response.js';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlSeconds * 1000
  };
}

function setSessionCookie(res, token) {
  res.cookie(config.sessionCookieName, token, cookieOptions());
}

function clearSessionCookie(res) {
  res.cookie(config.sessionCookieName, '', { ...cookieOptions(), maxAge: 0 });
}

export function createAuthRoutes(deps = {}) {
  const router = Router();
  const auth = deps.auth ?? new AuthService(deps);

  router.post('/send-link', async (req, res, next) => {
    try {
      const { email, origin } = req.body ?? {};
      const result = await auth.sendLoginLink({ email, origin });
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/verify', async (req, res, next) => {
    try {
      const token = (req.body && req.body.token) || req.query?.token;
      const result = await auth.verify(token);
      setSessionCookie(res, result.sessionToken);
      return json(res, 200, { success: true, user: result.user, sessionToken: result.sessionToken });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { email } = req.body ?? {};
      const result = await auth.login({ email });
      setSessionCookie(res, result.sessionToken);
      return json(res, 200, { success: true, user: result.user, sessionToken: result.sessionToken });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = getSessionToken(req);
      await auth.logout(token);
      clearSessionCookie(res);
      return json(res, 200, { success: true });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const token = getSessionToken(req);
      if (!token) {
        return json(res, 401, { error: 'Not authenticated' });
      }
      const user = await auth.resolveUser(token);
      if (!user) {
        return json(res, 401, { error: 'Invalid or expired session' });
      }
      return json(res, 200, { success: true, user });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createAuthRoutes;
