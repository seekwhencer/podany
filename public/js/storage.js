// storage.js — Podany Storage (API adapter)
// Thin adapter over ApiClient. Persistent data (feeds, playback positions,
// downloads, session token) is read/written via the server API; client-only
// preferences (theme, queue) and the episode/metadata cache live in memory
// (AppState). No localStorage / sessionStorage access remains.

export class Storage {
    constructor(config, api, state) {
        this.config = config;
        this.api = api;
        this.state = state;
        this._registeredGuids = new Set();
    }

    // ── Session token (server cookie + header; client mirrors it in state) ──
    // Synchronous: the token already lives in AppState and is not persisted in
    // the browser (Schritt 4). ApiClient sends it via X-Session-Token and the
    // session cookie is carried automatically with credentials: 'include'.

    loadSessionToken() {
        return (this.state && this.state.sessionToken) || '';
    }

    saveSessionToken(token) {
        if (this.state) {
            this.state.sessionToken = token ? String(token) : '';
        }
    }

    // ── Feeds (server: subscriptions) ───────────────────────────────────────

    async loadFeeds() {
        const res = await this.api.listSubscriptions();
        const feeds = Array.isArray(res.feeds) ? res.feeds : [];
        return feeds.map(f => (typeof f === 'string' ? f : f.feed_url)).filter(Boolean);
    }

    // Feed add/remove are persisted to the server by SyncManager
    // (saveFeedToServer / removeFeedFromServer). No bulk "replace subscriptions"
    // endpoint exists, so this stays a no-op that preserves the abstraction and
    // avoids double server writes.
    async saveFeeds(feeds) {
        return Array.isArray(feeds) ? feeds : [];
    }

    // ── Playback positions (server: playback_state, per episode) ────────────

    async loadPositions() {
        return await this.api.listPositions() || {};
    }

    // Individual positions are written to the server via ApiClient.savePosition
    // (SyncManager, wired through timeupdate / completion handlers). There is
    // no bulk positions endpoint, so persisting the whole map here would double
    // up with those per-episode writes.
    async savePositions(positions) {
        return positions && typeof positions === 'object' ? positions : {};
    }

    // ── Downloads (server: downloads) ───────────────────────────────────────

    async loadDownloads() {
        const items = await this.api.listDownloads();
        this._registeredGuids.clear();
        const map = {};
        items.forEach(d => {
            const guid = d.episode_guid;
            if (!guid) return;
            this._registeredGuids.add(guid);
            map[guid] = {
                guid,
                feedUrl: null,
                audioUrl: d.audio_url || '',
                title: d.title || '',
                podcastTitle: '',
                artwork: d.artwork || d.image || null,
                duration: '',
                timestamp: d.received_at || d.created_at || '',
                size: d.file_size || 0,
                downloadedAt: d.created_at || Date.now()
            };
        });
        if (this.state) this.state.downloadedEpisodes = map;
        return map;
    }

    async saveDownloads(downloads) {
        const map = downloads && typeof downloads === 'object' ? downloads : {};
        Object.values(map).forEach(ep => {
            if (!ep || !ep.guid || this._registeredGuids.has(ep.guid)) return;
            this._registeredGuids.add(ep.guid);
            this.api.registerDownload({
                episodeGuid: ep.guid,
                title: ep.title || '',
                audioUrl: ep.audioUrl || ''
            }).catch(() => {});
        });
        if (this.state) this.state.downloadedEpisodes = map;
    }

    // ── Episode + feed metadata cache (client memory only) ──────────────────
    // Synchronous: held in AppState, never persisted (Schritt 6).

    loadCache() {
        const s = this.state || {};
        return {
            episodes: Array.isArray(s.allEpisodes) && s.allEpisodes.length > 0 ? s.allEpisodes : null,
            metadata: s.feedMetadata && typeof s.feedMetadata === 'object' ? s.feedMetadata : null
        };
    }

    saveCache(episodes, metadata) {
        const s = this.state;
        if (!s) return;
        if (Array.isArray(episodes)) s.allEpisodes = episodes;
        if (metadata && typeof metadata === 'object') s.feedMetadata = metadata;
    }

    // ── Queue (client-only, transient memory) ───────────────────────────────
    // Synchronous: in-memory "Up Next" list, not persisted (Schritt 0).

    loadQueue() {
        return Array.isArray(this.state ? this.state.queue : null) ? this.state.queue : [];
    }

    saveQueue(queue) {
        if (this.state) {
            this.state.queue = Array.isArray(queue) ? queue : [];
        }
    }

    // ── Theme (client-only, transient memory) ───────────────────────────────
    // Synchronous: single non-persisting preference (Schritt 0).

    loadTheme() {
        return (this.state && this.state.theme) || 'system';
    }

    saveTheme(theme) {
        if (this.state) {
            this.state.theme = theme;
        }
    }

    // ── Reset (client-only transient state) ─────────────────────────────────
    // Server-side logout / destructive wipe is handled by callers (api.logout,
    // cookie clearing). This clears only the in-memory preferences.

    async clearAll() {
        if (this.state) {
            this.state.queue = [];
            this.state.theme = 'system';
        }
    }
}

export default Storage;
