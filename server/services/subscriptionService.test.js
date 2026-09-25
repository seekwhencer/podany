import './testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionService } from './subscriptionService.js';

class InMemorySubscriptions {
  constructor() {
    this.rows = [];
  }
  generateId(prefix = '') {
    return `${prefix}sub_${this.rows.length + 1}`;
  }
  async listByUser(userId) {
    return this.rows.filter((r) => r.user_id === userId);
  }
  async upsert({ id, userId, feedUrl, title = '', artwork = '' }) {
    const existing = this.rows.find((r) => r.user_id === userId && r.feed_url === feedUrl);
    if (existing) {
      existing.title = title;
      existing.artwork = artwork;
    } else {
      this.rows.push({ id, user_id: userId, feed_url: feedUrl, title, artwork, created_at: Math.floor(Date.now() / 1000), episodes_count: 3 });
    }
    return { affectedRows: 1 };
  }
  async remove(userId, feedUrl) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.user_id === userId && r.feed_url === feedUrl));
    return { affectedRows: before - this.rows.length };
  }
}

function buildSubscription(deps = {}) {
  const subscriptions = deps.subscriptions ?? new InMemorySubscriptions();
  return { service: new SubscriptionService({ subscriptions }), subscriptions };
}

test('listSubscriptions returns the feeds for a user only', async () => {
  const { service, subscriptions } = buildSubscription();
  await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml', title: 'A' });
  await service.addSubscription({ userId: 'u2', feedUrl: 'https://b.example/feed.xml', title: 'B' });
  const result = await service.listSubscriptions('u1');
  assert.equal(result.feeds.length, 1);
  assert.equal(result.feeds[0].feed_url, 'https://a.example/feed.xml');
  assert.equal(result.feeds[0].episodes_count, 3);
  assert.equal(subscriptions.rows.length, 2);
});

test('addSubscription upserts an existing feed instead of duplicating it', async () => {
  const { service, subscriptions } = buildSubscription();
  await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml', title: 'Old' });
  const result = await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml', title: 'New' });
  assert.equal(result.success, true);
  assert.equal(result.feedUrl, 'https://a.example/feed.xml');
  assert.equal(subscriptions.rows.length, 1);
  assert.equal(subscriptions.rows[0].title, 'New');
});

test('removeSubscription deletes the feed for the user', async () => {
  const { service, subscriptions } = buildSubscription();
  await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml' });
  const result = await service.removeSubscription('u1', 'https://a.example/feed.xml');
  assert.equal(result.success, true);
  assert.equal(result.removed, 'https://a.example/feed.xml');
  assert.equal(subscriptions.rows.length, 0);
});
