import './testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncService } from './syncService.js';

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
      this.rows.push({ id, user_id: userId, feed_url: feedUrl, title, artwork, created_at: Math.floor(Date.now() / 1000) });
    }
    return { affectedRows: 1 };
  }
  async remove(userId, feedUrl) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.user_id === userId && r.feed_url === feedUrl));
    return { affectedRows: before - this.rows.length };
  }
}

class InMemoryPlayback {
  constructor() {
    this.rows = [];
  }
  generateId(prefix = '') {
    return `${prefix}pos_${this.rows.length + 1}`;
  }
  async listByUser(userId) {
    return this.rows.filter((r) => r.user_id === userId);
  }
  async upsert({ id, userId, episodeGuid, positionSeconds = 0, completed = 0 }) {
    const existing = this.rows.find((r) => r.user_id === userId && r.episode_guid === episodeGuid);
    if (existing) {
      existing.position_seconds = positionSeconds;
      existing.completed = completed;
      existing.last_listened_at = Math.floor(Date.now() / 1000);
    } else {
      this.rows.push({
        id,
        user_id: userId,
        episode_guid: episodeGuid,
        position_seconds: positionSeconds,
        completed,
        last_listened_at: Math.floor(Date.now() / 1000)
      });
    }
    return { affectedRows: 1 };
  }
}

function buildSync(deps = {}) {
  const subscriptions = deps.subscriptions ?? new InMemorySubscriptions();
  const playback = deps.playback ?? new InMemoryPlayback();
  return { service: new SyncService({ subscriptions, playback }), subscriptions, playback };
}

test('listSubscriptions returns the feeds for a user only', async () => {
  const { service, subscriptions } = buildSync();
  await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml', title: 'A' });
  await service.addSubscription({ userId: 'u2', feedUrl: 'https://b.example/feed.xml', title: 'B' });
  const result = await service.listSubscriptions('u1');
  assert.equal(result.feeds.length, 1);
  assert.equal(result.feeds[0].feed_url, 'https://a.example/feed.xml');
  assert.equal(subscriptions.rows.length, 2);
});

test('addSubscription upserts an existing feed instead of duplicating it', async () => {
  const { service, subscriptions } = buildSync();
  await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml', title: 'Old' });
  const result = await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml', title: 'New' });
  assert.equal(result.success, true);
  assert.equal(result.feedUrl, 'https://a.example/feed.xml');
  assert.equal(subscriptions.rows.length, 1);
  assert.equal(subscriptions.rows[0].title, 'New');
});

test('removeSubscription deletes the feed for the user', async () => {
  const { service, subscriptions } = buildSync();
  await service.addSubscription({ userId: 'u1', feedUrl: 'https://a.example/feed.xml' });
  const result = await service.removeSubscription('u1', 'https://a.example/feed.xml');
  assert.equal(result.success, true);
  assert.equal(result.removed, 'https://a.example/feed.xml');
  assert.equal(subscriptions.rows.length, 0);
});

test('listPositions maps rows to a positions object keyed by episode guid', async () => {
  const { service } = buildSync();
  await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 42, completed: false });
  await service.savePosition({ userId: 'u1', episodeGuid: 'ep-2', positionSeconds: 900, completed: true });
  const result = await service.listPositions('u1');
  assert.deepEqual(Object.keys(result.positions).sort(), ['ep-1', 'ep-2']);
  assert.equal(result.positions['ep-1'].position, 42);
  assert.equal(result.positions['ep-1'].completed, false);
  assert.equal(result.positions['ep-2'].completed, true);
});

test('savePosition upserts the same episode without duplicating rows', async () => {
  const { service, playback } = buildSync();
  await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 10 });
  const result = await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 20, completed: true });
  assert.equal(result.success, true);
  assert.equal(result.positionSeconds, 20);
  assert.equal(playback.rows.length, 1);
  assert.equal(playback.rows[0].position_seconds, 20);
  assert.equal(playback.rows[0].completed, 1);
});

test('savePosition coerces a non-number position to zero', async () => {
  const { service } = buildSync();
  const result = await service.savePosition({ userId: 'u1', episodeGuid: 'ep-1', positionSeconds: 'garbage' });
  assert.equal(result.positionSeconds, 0);
});
