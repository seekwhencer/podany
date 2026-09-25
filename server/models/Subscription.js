import BaseModel from './BaseModel.js';

export class Subscription extends BaseModel {
  constructor(pool) {
    super(pool);
    this.table = 'subscriptions';
  }

  async listByUser(userId) {
    return this.find(
      'SELECT feed_url, title, image, created_at FROM subscriptions WHERE user_id = ? ORDER BY created_at ASC',
      [userId]
    );
  }

  async upsert({ id, userId, feedUrl, title = '', image = '' }) {
    return this.execute(
      `INSERT INTO subscriptions (id, user_id, feed_url, title, image)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), image = VALUES(image)`,
      [id, userId, feedUrl, title, image]
    );
  }

  async exists(userId, feedUrl) {
    const value = await this.firstColumn(
      'SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ? AND feed_url = ?',
      [userId, feedUrl]
    );
    return Number(value ?? 0) > 0;
  }

  async remove(userId, feedUrl) {
    return this.execute('DELETE FROM subscriptions WHERE user_id = ? AND feed_url = ?', [userId, feedUrl]);
  }
}

export default Subscription;
