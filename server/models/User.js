import BaseModel from './BaseModel.js';

const DEFAULT_COLOR = '#d8cdbe';

export class User extends BaseModel {
  constructor(pool) {
    super(pool);
    this.table = 'users';
  }

  defaultColor() {
    return DEFAULT_COLOR;
  }

  async findByEmail(email) {
    return this.findOne('SELECT id, email, color, created_at FROM users WHERE email = ?', [email]);
  }

  async findById(id) {
    return this.findOne('SELECT id, email, color, created_at FROM users WHERE id = ?', [id]);
  }

  async findByEmailWithPassword(email) {
    return this.findOne(
      'SELECT id, email, color, password_hash, created_at FROM users WHERE email = ?',
      [email]
    );
  }

  async create({ id, email, passwordHash = null, color = null }) {
    return this.execute(
      'INSERT INTO users (id, email, color, password_hash) VALUES (?, ?, ?, ?)',
      [id, email, color ?? this.defaultColor(), passwordHash]
    );
  }

  async updateColor(id, color) {
    return this.execute('UPDATE users SET color = ? WHERE id = ?', [color, id]);
  }

  async seedDefault({ id, email, passwordHash = null, color = null }) {
    const existing = await this.findById(id);
    if (existing) {
      return { seeded: false };
    }
    await this.create({ id, email, passwordHash, color });
    return { seeded: true };
  }

  async all() {
    return this.find('SELECT id, email, color, created_at FROM users ORDER BY created_at ASC');
  }

  async countCreatedAfter(cutoff) {
    const value = await this.firstColumn('SELECT COUNT(*) AS count FROM users WHERE created_at > ?', [cutoff]);
    return Number(value ?? 0);
  }
}

export default User;
