import BaseModel from './BaseModel.js';

export class User extends BaseModel {
  constructor(pool) {
    super(pool);
    this.table = 'users';
  }

  async findByEmail(email) {
    return this.findOne('SELECT id, email, created_at FROM users WHERE email = ?', [email]);
  }

  async findById(id) {
    return this.findOne('SELECT id, email, created_at FROM users WHERE id = ?', [id]);
  }

  async create({ id, email }) {
    return this.execute('INSERT INTO users (id, email) VALUES (?, ?)', [id, email]);
  }

  async all() {
    return this.find('SELECT id, email, created_at FROM users ORDER BY created_at ASC');
  }

  async countCreatedAfter(cutoff) {
    const value = await this.firstColumn('SELECT COUNT(*) AS count FROM users WHERE created_at > ?', [cutoff]);
    return Number(value ?? 0);
  }
}

export default User;
