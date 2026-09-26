// api.js — Podany ApiClient
// Central fetch wrapper. Adds credentials + X-Session-Token auth header and
// routes every call through the self-hosted Express API. All endpoints match
// the new backend (server/routes/*): /api/auth, /api/sync, /api/feed, /api/audio-proxy.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ApiClient {
  constructor(config, state) {
    this.config = config;
    this.state = state;
  }

  _headers(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = this.state ? this.state.sessionToken : null;
    if (token) headers['X-Session-Token'] = token;
    return headers;
  }

  async request(path, { method = 'GET', body = null, headers = {} } = {}) {
    const res = await fetch(this.config.apiBase + path, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    });
    return res;
  }

  // Throws ApiError on non-ok responses so callers can detect auth failures.
  async requireJson(path, opts = {}) {
    const res = await this.request(path, opts);
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, res.status);
    }
    return res.json().catch(() => ({}));
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async sendLink({ email, origin }) {
    const res = await this.request('/api/auth/send-link', {
      method: 'POST',
      headers: this._headers(),
      body: { email, origin: origin || (window.location ? window.location.origin : '') }
    });
    return res.json().catch(() => ({}));
  }

  async verify(token) {
    const res = await this.request('/api/auth/verify', {
      method: 'POST',
      headers: this._headers(),
      body: { token }
    });
    return res.json().catch(() => ({}));
  }

  async login(email) {
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      headers: this._headers(),
      body: { email }
    });
    return res.json().catch(() => ({}));
  }

  async loginWithPassword({ email, password }) {
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      headers: this._headers(),
      body: { email, password }
    });
    return res.json().catch(() => ({}));
  }

  async logout(token) {
    const res = await this.request('/api/auth/logout', {
      method: 'POST',
      headers: this._headers(token ? { 'X-Session-Token': token } : {}),
      body: { sessionToken: token || (this.state ? this.state.sessionToken : '') }
    });
    return res.json().catch(() => ({}));
  }

  async me() {
    const data = await this.requireJson('/api/auth/me', { method: 'GET', headers: this._headers() });
    return data.user || null;
  }

  // ── Sync (subscriptions + playback positions) ───────────────────────────

  async listSubscriptions() {
    const data = await this.requireJson('/api/subscription/list', { method: 'GET', headers: this._headers() });
    return { feeds: Array.isArray(data.feeds) ? data.feeds : [] };
  }

  async addSubscription({ feedUrl, title = '', image = '' }) {
    const res = await this.request('/api/subscription', {
      method: 'POST',
      headers: this._headers(),
      body: { feedUrl, title, image }
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }

  async removeSubscription(feedUrl) {
    const res = await this.request('/api/subscription', {
      method: 'DELETE',
      headers: this._headers(),
      body: { feedUrl }
    });
    return res.ok;
  }

  async listPositions() {
    const data = await this.requireJson('/api/playback/positions', { method: 'GET', headers: this._headers() });
    return data.positions || {};
  }

  async savePosition(episodeGuid, positionSeconds, completed = false) {
    const res = await this.request('/api/playback/positions', {
      method: 'POST',
      headers: this._headers(),
      body: { episodeGuid, positionSeconds, completed }
    });
    return res.ok;
  }

  async removePosition(episodeGuid) {
    const res = await this.request('/api/playback/positions', {
      method: 'DELETE',
      headers: this._headers(),
      body: { episodeGuid }
    });
    return res.ok;
  }

  // ── Full boot load (multiple GETs, no server endpoint required) ──────────

  // Bundles the persistent reads for the async boot into one call site so the
  // start does not hang on many small awaits. Throws ApiError on auth failures
  // (401/403) so the boot can surface the auth modal.
  async loadAll() {
    const [feeds, positions] = await Promise.all([
      this.listSubscriptions(),
      this.listPositions()
    ]);
    return { feeds, positions };
  }

  // ── Feed reading (DB-ID based) ──────────────────────────────────────────

  // Reads an already-subscribed feed by its DB subscription id (`sub_...`).
  // Returns `{ feed, episodes }` with no network fetch/parse of the source.
  async loadFeedById(feedId) {
    if (!feedId) return { feed: null, episodes: [] };
    const res = await this.request(`/api/feed/${encodeURIComponent(feedId)}`, {
      method: 'GET',
      headers: this._headers()
    });
    if (!res.ok) return { feed: null, episodes: [] };
    const data = await res.json().catch(() => ({}));
    return {
      feed: data.feed || null,
      episodes: Array.isArray(data.episodes) ? data.episodes : []
    };
  }

  // ── Feed fetching (URL based, preview-only) ──────────────────────────────
  // The only remaining URL-based fetch. Used exclusively to preview episodes of
  // a feed the user has NOT subscribed to yet (FeedsManager preview path).
  // Subscribed feeds are always read by DB id via loadFeedById().

  async fetchFeed(url) {
    const res = await this.request('/api/feed/fetch', {
      method: 'POST',
      headers: this._headers(),
      body: { url }
    });
    if (res.status === 401) return { error: 'Unauthorized' };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    const feeds = Array.isArray(data.feeds) ? data.feeds : [];
    return feeds.length > 0 ? feeds[0] : { episodes: [], title: '' };
  }

}

export default ApiClient;
