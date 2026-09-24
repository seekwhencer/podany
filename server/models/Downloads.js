import BaseModel from './BaseModel.js';

const UPDATABLE = ['subscription_id', 'title', 'audio_url', 'file_path', 'file_size', 'status', 'progress', 'error', 'received_at', 'updated_at'];

export class Downloads extends BaseModel {
  constructor(pool) {
    super(pool);
    this.table = 'downloads';
  }

  async create({
    id,
    userId,
    episodeGuid,
    subscriptionId = null,
    title = '',
    audioUrl = null,
    filePath = null,
    fileSize = 0,
    status = 'pending',
    progress = 0
  }) {
    return this.execute(
      `INSERT INTO downloads (id, user_id, episode_guid, subscription_id, title, audio_url, file_path, file_size, status, progress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, episodeGuid, subscriptionId, title, audioUrl, filePath, fileSize, status, progress]
    );
  }

  async findById(id) {
    return this.findOne('SELECT * FROM downloads WHERE id = ?', [id]);
  }

  async findByEpisode(userId, episodeGuid) {
    return this.findOne('SELECT * FROM downloads WHERE user_id = ? AND episode_guid = ?', [userId, episodeGuid]);
  }

  async update(id, fields = {}) {
    const set = [];
    const values = [];
    for (const key of UPDATABLE) {
      if (fields[key] !== undefined) {
        set.push(`${key} = ?`);
        values.push(fields[key]);
      }
    }
    if (fields.updated_at === undefined) {
      set.push('updated_at = ?');
      values.push(this.now());
    }
    values.push(id);
    return this.execute(`UPDATE downloads SET ${set.join(', ')} WHERE id = ?`, values);
  }

  async listByUser(userId) {
    return this.find('SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at ASC', [userId]);
  }

  async listByStatus(status) {
    return this.find('SELECT * FROM downloads WHERE status = ? ORDER BY created_at ASC', [status]);
  }

  async remove(userId, episodeGuid) {
    return this.execute('DELETE FROM downloads WHERE user_id = ? AND episode_guid = ?', [userId, episodeGuid]);
  }

  async deleteById(id) {
    return this.execute('DELETE FROM downloads WHERE id = ?', [id]);
  }
}

export default Downloads;
