import { hashToken, generateToken } from '../utils/crypto.js';

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

export class SessionStore {
  constructor(ttlSeconds = DEFAULT_TTL_SECONDS) {
    this.ttlSeconds = ttlSeconds;
    this._store = new Map();
  }

  issue(userId) {
    const raw = generateToken(32);
    const hash = hashToken(raw);
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    this._store.set(hash, { userId, expiresAt });
    return { raw, hash };
  }

  resolve(hash) {
    if (!hash) return null;
    const entry = this._store.get(hash);
    if (!entry) return null;
    if (entry.expiresAt <= Math.floor(Date.now() / 1000)) {
      this._store.delete(hash);
      return null;
    }
    return entry.userId;
  }

  revoke(hash) {
    if (hash) this._store.delete(hash);
  }

  prune() {
    const now = Math.floor(Date.now() / 1000);
    for (const [hash, entry] of this._store) {
      if (entry.expiresAt <= now) this._store.delete(hash);
    }
  }

  get size() {
    return this._store.size;
  }
}

export default SessionStore;
