import { Router } from 'express';
import { Readable } from 'node:stream';
import { FeedService } from '../services/feedService.js';
import { AudioProxyService } from '../services/audioProxyService.js';
import { DownloadsService } from '../services/downloadsService.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { isValidExternalUrl } from '../utils/url.js';
import { json } from '../utils/response.js';

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function createFeedRoutes(deps = {}) {
  const router = Router();
  const feed = deps.feed ?? new FeedService(deps);

  router.post('/fetch', async (req, res, next) => {
    try {
      const body = req.body ?? {};
      let urls = body.urls;
      if (!urls && body.url) urls = [body.url];
      if (!Array.isArray(urls) || urls.length === 0) {
        return json(res, 400, { error: 'At least one feed URL is required.' });
      }
      const feeds = await feed.fetchFeeds(urls);
      return json(res, 200, { feeds });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export function createAudioProxyRoutes(deps = {}) {
  const router = Router();
  const config = deps.config;
  const audioProxy = deps.audioProxy ?? new AudioProxyService(deps);

  router.get('/', async (req, res, next) => {
    try {
      const url = req.query?.url;
      if (!url || typeof url !== 'string') {
        return json(res, 400, { error: 'url parameter is required.' });
      }
      if (!isValidExternalUrl(url)) {
        return json(res, 400, { error: 'Invalid or disallowed url parameter.' });
      }
      const range = req.headers.range;
      const result = await audioProxy.fetch({ url, method: 'GET', range });
      res.status(result.status);
      result.headers.forEach((value, key) => res.set(key, value));
      res.set('access-control-allow-origin', config.corsOrigin);
      res.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
      res.set('access-control-allow-headers', 'Range, Content-Type, X-Session-Token');
      res.set('access-control-expose-headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
      const stream = Readable.fromWeb(result.body);
      stream.on('error', (err) => next(err));
      stream.pipe(res);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export function createDownloadsRoutes(deps = {}) {
  const router = Router();
  const downloads = deps.downloads ?? new DownloadsService(deps);
  const authDeps = deps.authDeps ?? {};
  const sessions = deps.sessions;
  const requireAuth = createAuthMiddleware({ ...authDeps, sessions, auth: deps.auth });
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const items = await downloads.listByUser(req.user.id);
      return json(res, 200, { downloads: items });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { episodeGuid, title, audioUrl } = req.body ?? {};
      if (!isString(episodeGuid)) {
        return json(res, 400, { error: 'episodeGuid is required.' });
      }
      const record = await downloads.register({ userId: req.user.id, episodeGuid, title, audioUrl });
      return json(res, 200, { success: true, download: record });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/:id/start', async (req, res, next) => {
    try {
      const record = await downloads.findById(req.params.id);
      if (!record || record.user_id !== req.user.id) {
        return json(res, 404, { error: 'Download not found.' });
      }
      const updated = await downloads.startDownload(record);
      return json(res, 200, { success: true, download: updated });
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/', async (req, res, next) => {
    try {
      const { episodeGuid } = req.body ?? {};
      if (!isString(episodeGuid)) {
        return json(res, 400, { error: 'episodeGuid is required.' });
      }
      const result = await downloads.remove(req.user.id, episodeGuid);
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await downloads.deleteById(req.params.id);
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createFeedRoutes;
