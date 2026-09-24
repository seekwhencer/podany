import mysql from 'mysql2/promise';

let dbConfig = null;

export function configureDb(config) {
  dbConfig = config;
}

export class MySQLPool {
  constructor(options = {}) {
    const c = options.config ?? dbConfig;
    this.options = {
      host: options.host ?? c.dbHost,
      port: options.port ?? c.dbPort,
      user: options.user ?? c.dbUser,
      password: options.password ?? c.dbPassword,
      database: options.database ?? c.dbName,
      waitForConnections: true,
      connectionLimit: options.connectionLimit ?? c.dbPoolMax,
      queueLimit: 0,
      connectTimeout: options.connectTimeout ?? 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    };
    this.pool = mysql.createPool(this.options);
  }

  async query(sql, params = []) {
    return this.pool.query(sql, params);
  }

  async execute(sql, params = []) {
    return this.pool.execute(sql, params);
  }

  async rows(sql, params = []) {
    const [rows] = await this.pool.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  }

  async row(sql, params = []) {
    const [rows] = await this.pool.query(sql, params);
    if (Array.isArray(rows)) return rows[0] ?? null;
    return rows ?? null;
  }

  async firstColumn(sql, params = []) {
    const [rows] = await this.pool.query(sql, params);
    if (Array.isArray(rows) && rows.length > 0 && rows[0]) {
      return Object.values(rows[0])[0] ?? null;
    }
    return null;
  }

  async run(sql, params = []) {
    const [result] = await this.pool.query(sql, params);
    return result;
  }

  async beginTransaction() {
    return this.pool.beginTransaction();
  }

  async getConnection() {
    return this.pool.getConnection();
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }

  async close() {
    await this.pool.end();
  }
}

let instance = null;

const db = new Proxy(
  {},
  {
    get(_target, prop) {
      if (instance === null) instance = new MySQLPool({ config: dbConfig });
      return instance[prop];
    }
  }
);

export default db;
