import { Router } from 'express';
import { FeedService } from '../services/feedService.js';

export class FeedRoutes {
  constructor(deps = {}) {
    this.feed = deps.feed ?? new FeedService(deps);
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

    return router;
  }
}

export default FeedRoutes;
