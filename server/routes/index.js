import { Router } from 'express';
import { AuthService } from '../services/authService.js';
import { SessionStore } from '../services/sessionStore.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { AuthRoutes } from './AuthRoutes.js';
import { SubscriptionRoutes } from './SubscriptionRoutes.js';
import { PlaybackRoutes } from './PlaybackRoutes.js';
import { UserRoutes } from './UserRoutes.js';
import { FeedRoutes } from './FeedRoutes.js';
import { AudioProxyRoutes } from './AudioProxyRoutes.js';
import { DownloadsRoutes } from './DownloadRoutes.js';

export function createAppRouter(deps = {}) {
  const router = Router();

  const config = deps.config;
  const authDeps = { ...deps.authDeps, config };
  const sessions = deps.sessions ?? new SessionStore(config?.sessionTtlSeconds);
  const auth = deps.auth ?? new AuthService({ ...authDeps, sessions });
  const requireAuth = createAuthMiddleware({ ...authDeps, sessions, auth });

  router.use('/auth', new AuthRoutes({ ...authDeps, sessions, auth }).getRouter());
  router.use('/subscription', requireAuth, new SubscriptionRoutes({ ...(deps.feed ?? {}), config, subscriptions: deps.subscriptions ?? deps.sync }).getRouter());
  router.use('/playback', requireAuth, new PlaybackRoutes({ ...(deps.feed ?? {}), playback: deps.playback ?? deps.sync }).getRouter());
  router.use('/user', requireAuth, new UserRoutes({ userService: deps.userService }).getRouter());
  router.use('/feed', new FeedRoutes({ ...(deps.feed ?? {}), config, requireAuth, subscriptions: deps.subscriptions ?? deps.sync, downloads: deps.downloads }).getRouter());
  router.use('/audio-proxy', new AudioProxyRoutes({ ...(deps.feed ?? {}), config }).getRouter());
  router.use('/downloads', new DownloadsRoutes({ ...(deps.feed ?? {}), config, authDeps, sessions, auth }).getRouter());

  return router;
}

export default createAppRouter;
