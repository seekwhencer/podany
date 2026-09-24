export class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? 10 * 60 * 1000;
    this.limit = options.limit ?? 5;
    this._hits = new Map();
  }

  check(key) {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this._hits.get(key) || []).filter((t) => t > cutoff);

    if (timestamps.length >= this.limit) {
      const retryAfterMs = timestamps[timestamps.length - 1] + this.windowMs - now;
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    timestamps.push(now);
    this._hits.set(key, timestamps);
    return { allowed: true, remaining: this.limit - timestamps.length, retryAfterMs: 0 };
  }

  reset(key) {
    this._hits.delete(key);
  }

  get size() {
    return this._hits.size;
  }
}

export default RateLimiter;
