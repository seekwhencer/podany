import { Router } from 'express';
import { json } from '../utils/response.js';
import { FeedService } from '../services/feedService.js';

export class FeedRoutes {
  constructor(deps = {}) {
    this.feed = deps.feed ?? new FeedService(deps);
    this.requireAuth = deps.requireAuth;
  }

  getRouter() {
    const router = Router();

    router.post('/fetch', async (req, res, next) => {
      try {
        const body = req.body ?? {};
        let urls = body.urls;
        if (!urls && body.url) urls = [body.url];
        if (!Array.isArray(urls) || urls.length === 0) {
          return json(res, 400, { error: 'At least one feed URL is required.' });
        }
        const feeds = await this.feed.fetchFeeds(urls);
        return json(res, 200, { feeds });
      } catch (err) {
        return next(err);
      }
    });

    router.get('/:id', this.requireAuth, async (req, res, next) => {
      try {
        const id = req.params.id;
        if (typeof id !== 'string' || id.length === 0) {
          return json(res, 200, { feed: null, episodes: [] });
        }
        const result = await this.feed.getFeedById(req.user.id, id);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    return router;
  }
}

export default FeedRoutes;
