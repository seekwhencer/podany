import { Router } from 'express';
import { AuthService } from '../services/authService.js';
import { getSessionToken } from '../middleware/auth.js';
import { json } from '../utils/response.js';

export function createAuthRoutes(deps = {}) {
  const router = Router();
  const config = deps.config;
  const cookieName = config?.sessionCookieName;
  const auth = deps.auth ?? new AuthService(deps);

  function cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: config?.cookieSecure,
      path: '/',
      maxAge: (config?.sessionTtlSeconds ?? 0) * 1000
    };
  }

  function setSessionCookie(res, token) {
    res.cookie(cookieName, token, cookieOptions());
  }

  function clearSessionCookie(res) {
    res.cookie(cookieName, '', { ...cookieOptions(), maxAge: 0 });
  }

  router.post('/send-link', async (req, res, next) => {
    try {
      if (!config?.magicLinkEnabled) {
        return json(res, 403, { error: 'Magic link login is not enabled.' });
      }
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
      const { email, password } = req.body ?? {};
      const hasPassword = password !== undefined && String(password).length > 0;
      const result = hasPassword
        ? await auth.loginWithPassword({ email, password })
        : await auth.login({ email });
      setSessionCookie(res, result.sessionToken);
      return json(res, 200, { success: true, user: result.user, sessionToken: result.sessionToken });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = getSessionToken(req, cookieName);
      await auth.logout(token);
      clearSessionCookie(res);
      return json(res, 200, { success: true });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const token = getSessionToken(req, cookieName);
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
