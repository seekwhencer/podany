import { Subscription } from '../models/Subscription.js';
import { ImageService } from './imageService.js';

export class SubscriptionService {
  constructor(deps = {}) {
    this.subscriptions = deps.subscriptions ?? new Subscription();
    this.images = deps.imageService ?? new ImageService(deps.config);
  }

  async listSubscriptions(userId) {
    const feeds = await this.subscriptions.listByUser(userId);
    return { feeds };
  }

  async addSubscription({ userId, feedUrl, title = '', artwork = '', description = '', category = '', language = '', pubDate = '' }) {
    const id = this.subscriptions.generateId('sub_');
    let image = '';
    if (artwork) {
      try {
        image = await this.images.downloadAndGenerate(artwork);
      } catch (err) {
        console.error(`[server] Could not generate artwork thumbnail for ${feedUrl}:`, err.message);
      }
    }

    await this.subscriptions.upsert({ id, userId, feedUrl, title, artwork, image, description, category, language, pubDate });
    return { success: true, feedUrl, id };
  }

  async removeSubscription(userId, feedUrl) {
    await this.subscriptions.remove(userId, feedUrl);
    return { success: true, removed: feedUrl };
  }
}

export default SubscriptionService;
