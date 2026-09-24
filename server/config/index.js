import 'dotenv/config';
import path from 'node:path';
import { defaults } from './defaults.js';

const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'APP_URL', 'SESSION_SECRET'];
const AUTH_MODES = ['magic', 'local', 'mixed'];

function toInt(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Expected an integer but got "${value}".`);
  return n;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new Error(`Expected a boolean but got "${value}".`);
}

class Config {
  constructor(env = process.env) {
    this.port = toInt(env.PORT, defaults.port);
    this.host = env.HOST || defaults.host;

    this.downloadStorageDir = path.resolve(env.DOWNLOADS_DIR || defaults.downloadStorageDir);

    this.dbHost = this._require(env.DB_HOST, 'DB_HOST');
    this.dbPort = toInt(env.DB_PORT, defaults.dbPort);
    this.dbName = this._require(env.DB_NAME, 'DB_NAME');
    this.dbUser = this._require(env.DB_USER, 'DB_USER');
    this.dbPassword = this._require(env.DB_PASSWORD, 'DB_PASSWORD');
    this.dbPoolMax = Math.max(1, toInt(env.DB_POOL_MAX, defaults.dbPoolMax));

    this.appUrl = this._require(env.APP_URL, 'APP_URL').replace(/\/$/, '');
    this.fromEmail = env.FROM_EMAIL || defaults.fromEmail;
    this.resendApiKey = env.RESEND_API_KEY || null;

    this.sessionSecret = this._require(env.SESSION_SECRET, 'SESSION_SECRET');
    this.cookieSecure = toBool(env.COOKIE_SECURE, defaults.cookieSecure);
    this.sessionCookieName = defaults.sessionCookieName;
    this.sessionTtlSeconds = defaults.sessionTtlSeconds;

    this.rateLimitLinksPerHour = Math.max(0, toInt(env.RATE_LIMIT_LINKS_PER_HOUR, defaults.rateLimitLinksPerHour));
    this.corsOrigin = env.CORS_ORIGIN || defaults.corsOrigin;

    this.defaultUserEmail = env.DEFAULT_USER_EMAIL || null;
    this.defaultUserPassword = env.DEFAULT_USER_PASSWORD || null;
    this.defaultUserColor = env.DEFAULT_USER_COLOR || defaults.defaultUserColor;
    this.defaultUserEnabled = Boolean(this.defaultUserEmail);

    this.environment = (env.ENVIRONMENT || defaults.environment).toLowerCase();

    this.authMode = (env.AUTH_MODE || defaults.authMode).toLowerCase();
    if (!AUTH_MODES.includes(this.authMode)) {
      throw new Error(`AUTH_MODE must be one of ${AUTH_MODES.join(', ')}, got "${this.authMode}".`);
    }

    this.resendEnabled = Boolean(this.resendApiKey);
    this.localLoginEnabled = this.authMode === 'local' || this.authMode === 'mixed';
    this.magicLinkEnabled = toBool(env.MAGIC_LINK_ENABLED, defaults.magicLinkEnabled)
      && (this.authMode === 'magic' || this.authMode === 'mixed');
  }

  _require(value, name) {
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return String(value);
  }

  get isDev() {
    return this.resendEnabled === false;
  }
}

let instance = null;

const config = new Proxy(
  {},
  {
    get(_target, prop, receiver) {
      if (instance === null) instance = new Config();
      return Reflect.get(instance, prop, receiver);
    },
    has(_target, prop) {
      if (instance === null) instance = new Config();
      return prop in instance;
    }
  }
);

export { Config };
export default config;
