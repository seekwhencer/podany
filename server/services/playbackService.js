import { PlaybackState } from '../models/PlaybackState.js';
import { Downloads } from '../models/Downloads.js';

export class PlaybackService {
  constructor(deps = {}) {
    this.playback = deps.playback ?? new PlaybackState();
    this.downloads = deps.downloads ?? new Downloads();
  }

  async listPositions(userId) {
    const rows = await this.playback.listByUser(userId);
    const positions = {};
    rows.forEach((r) => {
      positions[r.episode_id] = {
        position: r.position_seconds,
        completed: r.completed === 1,
        lastListenedAt: r.last_listened_at
      };
    });
    return { positions };
  }

  async _resolveEpisodeId(userId, episodeId) {
    const byId = await this.downloads.findByIdAndUser(userId, episodeId);
    if (byId) return episodeId;
    const byGuid = await this.downloads.findByEpisode(userId, episodeId);
    if (byGuid) return byGuid.id;
    const anchorId = this.downloads.generateId('dl_');
    await this.downloads.create({
      id: anchorId,
      userId,
      episodeGuid: episodeId,
      status: 'pending'
    });
    return anchorId;
  }

  async savePosition({ userId, episodeId, positionSeconds = 0, completed = false }) {
    const resolvedId = await this._resolveEpisodeId(userId, episodeId);
    const id = this.playback.generateId('pos_');
    await this.playback.upsert({
      id,
      userId,
      episodeId: resolvedId,
      positionSeconds: typeof positionSeconds === 'number' ? positionSeconds : 0,
      completed: completed ? 1 : 0
    });
    return { success: true, episodeId: resolvedId, positionSeconds: typeof positionSeconds === 'number' ? positionSeconds : 0 };
  }

  async removePosition(userId, episodeId) {
    await this.playback.remove(userId, episodeId);
    return { success: true, episodeId };
  }
}

export default PlaybackService;
