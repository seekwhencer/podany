import { PlaybackState } from '../models/PlaybackState.js';

export class PlaybackService {
  constructor(deps = {}) {
    this.playback = deps.playback ?? new PlaybackState();
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

  async removePosition(userId, episodeGuid) {
    await this.playback.remove(userId, episodeGuid);
    return { success: true, episodeGuid };
  }
}

export default PlaybackService;
