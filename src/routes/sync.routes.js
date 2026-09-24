import { Router } from 'express';
import { SyncService } from '../services/syncService.js';
import { json } from '../utils/response.js';

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function createSyncRoutes(deps = {}) {
  const router = Router();
  const sync = deps.sync ?? new SyncService(deps);

  router.get('/subscriptions', async (req, res, next) => {
    try {
      const result = await sync.listSubscriptions(req.user.id);
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/subscriptions', async (req, res, next) => {
    try {
      const { feedUrl, title, artwork } = req.body ?? {};
      if (!isString(feedUrl)) {
        return json(res, 400, { error: 'feedUrl is required.' });
      }
      const result = await sync.addSubscription({ userId: req.user.id, feedUrl, title, artwork });
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/subscriptions', async (req, res, next) => {
    try {
      const { feedUrl } = req.body ?? {};
      if (!isString(feedUrl)) {
        return json(res, 400, { error: 'feedUrl is required.' });
      }
      const result = await sync.removeSubscription(req.user.id, feedUrl);
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/positions', async (req, res, next) => {
    try {
      const result = await sync.listPositions(req.user.id);
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/positions', async (req, res, next) => {
    try {
      const { episodeGuid, positionSeconds, completed } = req.body ?? {};
      if (!isString(episodeGuid)) {
        return json(res, 400, { error: 'episodeGuid is required.' });
      }
      const result = await sync.savePosition({
        userId: req.user.id,
        episodeGuid,
        positionSeconds: Number.isFinite(Number(positionSeconds)) ? Number(positionSeconds) : 0,
        completed: Boolean(completed)
      });
      return json(res, 200, result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

export default createSyncRoutes;
