import { Subscription } from '../models/Subscription.js';

export class SubscriptionService {
  constructor(deps = {}) {
    this.subscriptions = deps.subscriptions ?? new Subscription();
  }

  async listSubscriptions(userId) {
    const feeds = await this.subscriptions.listByUser(userId);
    return { feeds };
  }

  async addSubscription({ userId, feedUrl, title = '' }) {
    const id = this.subscriptions.generateId('sub_');

    // here the image converter
    // create the image field
    



    await this.subscriptions.upsert({ id, userId, feedUrl, title });
    return { success: true, feedUrl, id };
  }

  async removeSubscription(userId, feedUrl) {
    await this.subscriptions.remove(userId, feedUrl);
    return { success: true, removed: feedUrl };
  }
}

export default SubscriptionService;
