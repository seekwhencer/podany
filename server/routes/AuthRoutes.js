import { Router } from 'express';
import { AuthService } from '../services/authService.js';
import { getSessionToken } from '../middleware/auth.js';
import { json } from '../utils/response.js';

export class AuthRoutes {
  constructor(deps = {}) {
    this.config = deps.config;
    this.cookieName = this.config?.sessionCookieName;
    this.auth = deps.auth ?? new AuthService(deps);
  }

  cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config?.cookieSecure,
      path: '/',
      maxAge: (this.config?.sessionTtlSeconds ?? 0) * 1000
    };
  }

  setSessionCookie(res, token) {
    res.cookie(this.cookieName, token, this.cookieOptions());
  }

  clearSessionCookie(res) {
    res.cookie(this.cookieName, '', { ...this.cookieOptions(), maxAge: 0 });
  }

  getRouter() {
    const router = Router();

    router.post('/send-link', async (req, res, next) => {
      try {
        if (!this.config?.magicLinkEnabled) {
          return json(res, 403, { error: 'Magic link login is not enabled.' });
        }
        const { email, origin } = req.body ?? {};
        const result = await this.auth.sendLoginLink({ email, origin });
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    router.post('/verify', async (req, res, next) => {
      try {
        const token = (req.body && req.body.token) || req.query?.token;
        const result = await this.auth.verify(token);
        this.setSessionCookie(res, result.sessionToken);
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
          ? await this.auth.loginWithPassword({ email, password })
          : await this.auth.login({ email });
        this.setSessionCookie(res, result.sessionToken);
        return json(res, 200, { success: true, user: result.user, sessionToken: result.sessionToken });
      } catch (err) {
        return next(err);
      }
    });

    router.post('/logout', async (req, res, next) => {
      try {
        const token = getSessionToken(req, this.cookieName);
        await this.auth.logout(token);
        this.clearSessionCookie(res);
        return json(res, 200, { success: true });
      } catch (err) {
        return next(err);
      }
    });

    router.get('/me', async (req, res, next) => {
      try {
        const token = getSessionToken(req, this.cookieName);
        if (!token) {
          return json(res, 401, { error: 'Not authenticated' });
        }
        const user = await this.auth.resolveUser(token);
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
}

export default AuthRoutes;
