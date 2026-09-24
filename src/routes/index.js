import { Router } from 'express';
import config from '../config/index.js';
import { AuthService } from '../services/authService.js';
import { SessionStore } from '../services/sessionStore.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createAuthRoutes } from './auth.routes.js';
import { createSyncRoutes } from './sync.routes.js';
import { createFeedRoutes, createAudioProxyRoutes, createDownloadsRoutes } from './feed.routes.js';

export function createAppRouter(deps = {}) {
  const router = Router();

  const authDeps = deps.authDeps ?? {};
  const sessions = deps.sessions ?? new SessionStore(config.sessionTtlSeconds);
  const auth = deps.auth ?? new AuthService({ ...authDeps, sessions });
  const requireAuth = createAuthMiddleware({ ...authDeps, sessions, auth });

  router.use('/auth', createAuthRoutes({ ...authDeps, sessions, auth }));
  router.use('/sync', requireAuth, createSyncRoutes({ sync: deps.sync }));
  router.use('/feed', createFeedRoutes(deps.feed ?? {}));
  router.use('/audio-proxy', createAudioProxyRoutes(deps.feed ?? {}));
  router.use('/downloads', createDownloadsRoutes({ ...(deps.feed ?? {}), authDeps, sessions, auth }));

  return router;
}

export default createAppRouter;
