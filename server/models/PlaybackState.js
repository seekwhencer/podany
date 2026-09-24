import BaseModel from './BaseModel.js';

export class PlaybackState extends BaseModel {
  constructor(pool) {
    super(pool);
    this.table = 'playback_state';
  }

  async listByUser(userId) {
    return this.find(
      'SELECT episode_guid, position_seconds, completed, last_listened_at FROM playback_state WHERE user_id = ?',
      [userId]
    );
  }

  async findByEpisode(userId, episodeGuid) {
    return this.findOne(
      'SELECT id, episode_guid, position_seconds, completed, last_listened_at FROM playback_state WHERE user_id = ? AND episode_guid = ?',
      [userId, episodeGuid]
    );
  }

  async upsert({ id, userId, episodeGuid, positionSeconds = 0, completed = 0 }) {
    return this.execute(
      `INSERT INTO playback_state (id, user_id, episode_guid, position_seconds, completed, last_listened_at)
        VALUES (?, ?, ?, ?, ?, UNIX_TIMESTAMP())
        ON DUPLICATE KEY UPDATE
          position_seconds = VALUES(position_seconds),
          completed = VALUES(completed),
          last_listened_at = UNIX_TIMESTAMP()`,
      [id, userId, episodeGuid, positionSeconds, completed]
    );
  }

  async remove(userId, episodeGuid) {
    return this.execute('DELETE FROM playback_state WHERE user_id = ? AND episode_guid = ?', [userId, episodeGuid]);
  }
}

export default PlaybackState;
