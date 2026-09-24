import BaseModel from './BaseModel.js';

export class AuthToken extends BaseModel {
  constructor(pool) {
    super(pool);
    this.table = 'auth_tokens';
  }

  async create({ tokenHash, userId, expiresAt }) {
    return this.execute(
      'INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [tokenHash, userId, expiresAt]
    );
  }

  async findByHash(hash) {
    return this.findOne(
      'SELECT token_hash, user_id, expires_at, used, created_at FROM auth_tokens WHERE token_hash = ?',
      [hash]
    );
  }

  async consume(hash) {
    const now = this.now();
    const result = await this.execute(
      'UPDATE auth_tokens SET used = 1 WHERE token_hash = ? AND used = 0 AND expires_at > ?',
      [hash, now]
    );
    if (result.affectedRows > 0) {
      const row = await this.findOne('SELECT user_id FROM auth_tokens WHERE token_hash = ?', [hash]);
      return row ? row.user_id : null;
    }
    const existing = await this.findOne('SELECT user_id, expires_at FROM auth_tokens WHERE token_hash = ?', [hash]);
    if (existing && existing.expires_at > now) {
      return existing.user_id;
    }
    return null;
  }

  async countCreatedAfterForUser(userId, cutoff) {
    const value = await this.firstColumn(
      'SELECT COUNT(*) AS count FROM auth_tokens WHERE user_id = ? AND created_at > ?',
      [userId, cutoff]
    );
    return Number(value ?? 0);
  }

  async deleteExpired() {
    return this.execute('DELETE FROM auth_tokens WHERE expires_at <= ?', [this.now()]);
  }
}

export default AuthToken;
