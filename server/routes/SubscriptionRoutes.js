import { Router } from 'express';
import { SubscriptionService } from '../services/subscriptionService.js';
import { FeedService } from '../services/feedService.js';
import { DownloadsService } from '../services/downloadsService.js';
import { isValidExternalUrl } from '../utils/url.js';
import { json } from '../utils/response.js';

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

export class SubscriptionRoutes {
  constructor(deps = {}) {
    this.subscriptions = deps.subscriptions ?? new SubscriptionService(deps);
    this.feed = deps.feed ?? new FeedService(deps);
    this.downloads = deps.downloads ?? new DownloadsService(deps);
  }

  async enqueueEpisodesForFeed(userId, feedUrl, subscriptionId) {
    let feeds;
    try {
      feeds = await this.feed.fetchFeeds([feedUrl]);
    } catch (err) {
      console.log(`[server] Could not fetch feed ${feedUrl} for auto-download: ${err.message}`);
      return;
    }
    const episodes = feeds.flatMap((f) => f.episodes ?? []);
    if (episodes.length === 0) return;

    let known = new Set();
    try {
      const existing = await this.downloads.listByUser(userId);
      known = new Set(existing.map((r) => r.episode_guid));
    } catch (err) {
      console.error('[server] Could not list existing downloads:', err.message);
    }

    for (const episode of episodes) {
      if (!episode || known.has(episode.guid)) continue;
      if (!isValidExternalUrl(episode.audioUrl)) continue;
      try {
        await this.downloads.register({
          userId,
          episodeGuid: episode.guid,
          title: episode.title || '',
          audioUrl: episode.audioUrl,
          subscriptionId
        });
      } catch (err) {
        console.error(`[server] Could not enqueue download for "${episode.title}":`, err.message);
      }
    }
  }

  getRouter() {
    const router = Router();

    router.get('/list', async (req, res, next) => {
      try {
        const result = await this.subscriptions.listSubscriptions(req.user.id);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    router.post('/', async (req, res, next) => {
      try {
        const { feedUrl, title } = req.body ?? {};
        if (!isString(feedUrl)) {
          return json(res, 400, { error: 'feedUrl is required.' });
        }
        const result = await this.subscriptions.addSubscription({ userId: req.user.id, feedUrl, title });
        void this.enqueueEpisodesForFeed(req.user.id, feedUrl, result.id);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    router.delete('/', async (req, res, next) => {
      try {
        const { feedUrl } = req.body ?? {};
        if (!isString(feedUrl)) {
          return json(res, 400, { error: 'feedUrl is required.' });
        }
        const result = await this.subscriptions.removeSubscription(req.user.id, feedUrl);
        return json(res, 200, result);
      } catch (err) {
        return next(err);
      }
    });

    return router;
  }
}

export default SubscriptionRoutes;
