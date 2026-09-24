import { randomUUID } from 'node:crypto';
import db from '../db/connection.js';

export class BaseModel {
  constructor(pool = db) {
    this.pool = pool;
    this.table = null;
  }

  generateId(prefix = '') {
    return `${prefix}${randomUUID()}`;
  }

  now() {
    return Math.floor(Date.now() / 1000);
  }

  async find(sql, params = []) {
    return this.pool.rows(sql, params);
  }

  async findOne(sql, params = []) {
    return this.pool.row(sql, params);
  }

  async firstColumn(sql, params = []) {
    return this.pool.firstColumn(sql, params);
  }

  async execute(sql, params = []) {
    return this.pool.run(sql, params);
  }
}

export default BaseModel;
