import { Router } from 'express';
import { AuthService } from '../services/authService.js';
import { SessionStore } from '../services/sessionStore.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createAuthRoutes } from './auth.routes.js';
import { createSyncRoutes } from './sync.routes.js';
import { createUserRoutes } from './user.routes.js';
import { createFeedRoutes, createAudioProxyRoutes, createDownloadsRoutes } from './feed.routes.js';

export function createAppRouter(deps = {}) {
  const router = Router();

  const config = deps.config;
  const authDeps = { ...deps.authDeps, config };
  const sessions = deps.sessions ?? new SessionStore(config?.sessionTtlSeconds);
  const auth = deps.auth ?? new AuthService({ ...authDeps, sessions });
  const requireAuth = createAuthMiddleware({ ...authDeps, sessions, auth });

  router.use('/auth', createAuthRoutes({ ...authDeps, sessions, auth }));
  router.use('/sync', requireAuth, createSyncRoutes({ sync: deps.sync }));
  router.use('/user', requireAuth, createUserRoutes({ userService: deps.userService }));
  router.use('/feed', createFeedRoutes({ ...(deps.feed ?? {}), config }));
  router.use('/audio-proxy', createAudioProxyRoutes({ ...(deps.feed ?? {}), config }));
  router.use('/downloads', createDownloadsRoutes({ ...(deps.feed ?? {}), config, authDeps, sessions, auth }));

  return router;
}

export default createAppRouter;
