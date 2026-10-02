// state.js — Podany AppState
// Central mutable application state. Replaces the former top-level `state`
// object. All managers read/write through this single instance.

export class AppState {
    constructor() {
        this._subs = [];       // subscriptions registered via subscribe() (§7.3)
        this.sessionToken = '';
        this.userEmail = '';
        this.feeds = [];
        this.feedMetadata = {};
        this.feedUrlById = {};
        this.downloadingFeeds = new Set();
        this.allEpisodes = [];
        this.filteredEpisodes = [];
        this.playbackPositions = {};
        this.currentEpisode = null;
        this.playbackSpeed = 1.0;
        this.sortOrder = 'newest';
        this.searchQuery = '';
        this.filterMode = 'unplayed';
        this.ytPlayer = null;
        this.ytReady = false;
        this.activeEngine = 'audio';
        this.playbackStatus = 'idle';
        this.livePlayback = { currentTime: 0, duration: 0, progress: 0 };
        this.authModalOpen = false;
        this.liveStatus = { connected: false, connecting: false, failures: 0 };
        this.theme = 'system';
        this.timelinePage = 1;
        this.pageSize = 30;
        this.activeFeedDetailId = null;
        this.navHistory = [];          // stack of { tab, feedTarget } entries for back navigation
        this.continueCollapsed = true;
        this.playerCollapsed = false;
        this.queue = [];
        this.feedToDelete = null;
        this.pendingYouTubePlay = null;
        this.pendingStartTime = null;
        this.sleepTimer = {
            active: false,
            minutes: 0,
            endTime: null,
            intervalId: null,
            fadeout: true,
            initialVolume: 1.0
        };
    }

    reset() {
        this.sessionToken = '';
        this.userEmail = '';
        this.feeds = [];
        this.feedMetadata = {};
        this.feedUrlById = {};
        this.downloadingFeeds = new Set();
        this.allEpisodes = [];
        this.filteredEpisodes = [];
        this.playbackPositions = {};
        this.currentEpisode = null;
        this.playbackStatus = 'idle';
        this.livePlayback = { currentTime: 0, duration: 0, progress: 0 };
        this.authModalOpen = false;
        this.liveStatus = { connected: false, connecting: false, failures: 0 };
        this.theme = 'system';
        this.queue = [];
        this.activeFeedDetailId = null;
        this.navHistory = [];
        this.playerCollapsed = false;
        this.sleepTimer = {
            active: false,
            minutes: 0,
            endTime: null,
            intervalId: null,
            fadeout: true,
            initialVolume: 1.0
        };
    }

    // ── Subscription / observer model (§7.3) ─────────────────────────────────
    // Subscribe to a path. Fires `callback(value, previous)` only when the value
    // at that path actually changed (deep comparison). Path syntax:
    //   'playback.current'        nested property
    //   'feeds.0.downloading'     indexed path
    //   'feeds.*'                 every element of the array at 'feeds'
    //   '*'                       every change to the whole state
    // Returns an unsubscribe function. Always call it in component unmount().
    // Services should trigger notifications via notify(path) / update(patch)
    // after mutating state; direct property writes do not notify.

    subscribe(path, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('AppState.subscribe(path, callback): callback must be a function');
        }

        const wildcard = path !== '*' && path.endsWith('.*');
        const base = wildcard ? path.slice(0, -2) : path;
        const sub = {
            path,
            wildcard,
            base,
            // Immutable baseline captured at subscribe time. Comparing against a
            // snapshot (rather than the live reference) means both in-place mutation
            // and equal-valued replacements are detected correctly.
            snap: path === '*' ? this : this._deepClone(wildcard ? this._getByPath(base) : this._getByPath(path)),
            callback
        };

        const handler = () => {
            if (path === '*') {
                const prev = sub.snap;
                sub.snap = this;
                callback(this, prev);
                return;
            }

            const next = wildcard ? this._getByPath(base) : this._getByPath(path);

            if (wildcard) {
                const snap = sub.snap;
                const nextLen = Array.isArray(next) ? next.length : 0;
                const snapLen = Array.isArray(snap) ? snap.length : 0;
                let changed = false;
                const max = Math.max(nextLen, snapLen);
                for (let i = 0; i < max; i++) {
                    if (!this._deepEqual(snap && snap[i], next && next[i])) { changed = true; break; }
                }
                if (!changed) return;
                for (let i = 0; i < max; i++) {
                    if (!this._deepEqual(snap && snap[i], next && next[i])) {
                        callback(next && next[i], snap && snap[i]);
                    }
                }
                sub.snap = this._deepClone(next);
                return;
            }

            if (this._deepEqual(sub.snap, next)) return;
            const old = sub.snap;
            sub.snap = this._deepClone(next);
            callback(next, old);
        };

        handler._sub = sub;
        this._subs.push(handler);

        return () => {
            const idx = this._subs.indexOf(handler);
            if (idx !== -1) this._subs.splice(idx, 1);
        };
    }

    // Notify subscribers that the value at `path` changed. Also fires subscribers
    // of '*' and of any deeper path (e.g. notify('feeds') fires 'feeds.*' and
    // 'feeds.0.downloading'). Call after mutating state.
    notify(path) {
        for (const handler of this._subs.slice()) {
            if (this._affected(handler, path)) handler();
        }
    }

    // Batch setter: apply each key and notify its path. e.g.
    //   this.state.update({ currentEpisode: ep, playbackStatus: 'playing' });
    update(patch) {
        if (!patch || typeof patch !== 'object') return;
        for (const key of Object.keys(patch)) {
            this[key] = patch[key];
            this.notify(key);
        }
    }

    _affected(item, path) {
        const sub = item._sub;
        if (!sub) return false;
        if (sub.path === '*') return true;
        if (sub.path === path) return true;
        if (sub.wildcard) return sub.base === path;
        return sub.path.startsWith(path + '.');
    }

    _getByPath(path) {
        if (path === '*') return this;
        const parts = path.split('.');
        let node = this;
        for (const part of parts) {
            if (node == null) return undefined;
            node = node[part];
        }
        return node;
    }

    _deepEqual(a, b) {
        if (Object.is(a, b)) return true;
        if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
            return false;
        }
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (a instanceof Set && b instanceof Set) {
            if (a.size !== b.size) return false;
            for (const item of a) {
                if (!b.has(item)) return false;
            }
            return true;
        }
        if (a instanceof Map && b instanceof Map) {
            if (a.size !== b.size) return false;
            for (const [key, value] of a) {
                if (!b.has(key) || !this._deepEqual(value, b.get(key))) return false;
            }
            return true;
        }
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (!this._deepEqual(a[key], b[key])) return false;
        }
        return true;
    }

    // Immutable snapshot helper for subscription baselines. Handles the plain
    // data shapes AppState holds (primitives, arrays, plain objects, Sets, Dates);
    // any other value is passed through by reference.
    _deepClone(value) {
        if (value === null || typeof value !== 'object') return value;
        if (value instanceof Date) return new Date(value.getTime());
        if (value instanceof Set) {
            const out = new Set();
            for (const v of value) out.add(this._deepClone(v));
            return out;
        }
        if (Array.isArray(value)) return value.map(v => this._deepClone(v));
        const out = {};
        for (const key of Object.keys(value)) out[key] = this._deepClone(value[key]);
        return out;
    }
}

export default AppState;
