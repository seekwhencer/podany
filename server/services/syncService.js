import { Subscription } from '../models/Subscription.js';
import { PlaybackState } from '../models/PlaybackState.js';

export class SyncService {
  constructor(deps = {}) {
    this.subscriptions = deps.subscriptions ?? new Subscription();
    this.playback = deps.playback ?? new PlaybackState();
  }

  async listSubscriptions(userId) {
    const feeds = await this.subscriptions.listByUser(userId);
    return { feeds };
  }

  async addSubscription({ userId, feedUrl, title = '', artwork = '' }) {
    const id = this.subscriptions.generateId('sub_');
    await this.subscriptions.upsert({ id, userId, feedUrl, title, artwork });
    return { success: true, feedUrl };
  }

  async removeSubscription(userId, feedUrl) {
    await this.subscriptions.remove(userId, feedUrl);
    return { success: true, removed: feedUrl };
  }

  async listPositions(userId) {
    const rows = await this.playback.listByUser(userId);
    const positions = {};
    rows.forEach((r) => {
      positions[r.episode_guid] = {
        position: r.position_seconds,
        completed: r.completed === 1,
        lastListenedAt: r.last_listened_at
      };
    });
    return { positions };
  }

  async savePosition({ userId, episodeGuid, positionSeconds = 0, completed = false }) {
    const id = this.playback.generateId('pos_');
    await this.playback.upsert({
      id,
      userId,
      episodeGuid,
      positionSeconds: typeof positionSeconds === 'number' ? positionSeconds : 0,
      completed: completed ? 1 : 0
    });
    return { success: true, episodeGuid, positionSeconds: typeof positionSeconds === 'number' ? positionSeconds : 0 };
  }
}

export default SyncService;
