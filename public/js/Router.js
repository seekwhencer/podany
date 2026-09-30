// router.js — Podany RouterService
// Hash-based router and single source of truth for the current location. It
// REQUESTS navigation and never mutates the DOM directly: navigate() updates the
// hash and fires a bubbling 'routechange' CustomEvent; AppShell reacts to that
// event to swap views. See FRONTEND_REFACTORING_COMPONENTS.md §9.
//
//   match(pathname) -> { route, params } | null     // :id -> params
//   navigate(path)                          -> requests a forward navigation
//   window 'hashchange'                     -> refreshes current, no push
//   app.state.navHistory                    -> stack of route names (forward only)

export const ROUTES = [
    { name: 'timeline',  path: '/',         view: 'TimelineView' },
    { name: 'feeds',     path: '/feeds',    view: 'FeedsView' },
    { name: 'feed',      path: '/feed/:id', view: 'FeedDetailView' },
    { name: 'queue',     path: '/queue',    view: 'QueueView' },
    { name: 'settings',  path: '/settings', view: 'SettingsView' }
];

export class RouterService {
    constructor(app) {
        this.app = app;
        this.state = app ? app.state : null;
        this.routes = ROUTES;
        this.current = null;       // { route, params } of the current location
        this._fromNavigate = false; // suppresses duplicate handling of our own hash writes

        if (this.state && !Array.isArray(this.state.navHistory)) {
            this.state.navHistory = [];
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('hashchange', this._onHashChange);
            this._matchCurrent(false); // seed current without pushing history
        }
    }

    // Tear down listeners. Call once when the app is torn down.
    destroy() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('hashchange', this._onHashChange);
        }
    }

    // ── Matching (§9.1) ────────────────────────────────────────────────────

    // Match a pathname against the ROUTES table, resolving ':param' segments
    // into params. Returns { route, params } or null.
    match(pathname) {
        const norm = this._normalizePathname(pathname);
        for (const route of this.routes) {
            const params = this._matchPattern(route.path, norm);
            if (params) return { route, params };
        }
        return null;
    }

    _matchPattern(pattern, pathname) {
        const patternParts = pattern.split('/').filter(Boolean);
        const pathParts = pathname.split('/').filter(Boolean);
        if (patternParts.length !== pathParts.length) return null;
        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            const seg = patternParts[i];
            if (seg[0] === ':') {
                params[seg.slice(1)] = decodeURIComponent(pathParts[i]);
            } else if (seg !== pathParts[i]) {
                return null;
            }
        }
        return params;
    }

    // ── Navigation (§9.3 / §9.5) ───────────────────────────────────────────

    // Request a forward navigation. Updates the hash, records the route on the
    // navHistory stack, refreshes current, and fires a routechange event. Never
    // touches the DOM directly.
    navigate(path) {
        const hash = this._toHash(path);
        const matched = this.match(this._pathname(hash));
        if (matched) this._pushHistory(matched.route.name);

        this.current = matched;
        this._fromNavigate = true;
        if (typeof window !== 'undefined') {
            window.location.hash = hash;
        }
        // Emit so AppShell swaps the view. _onHashChange returns early for our own
        // hash write (fromNavigate), so navigate() is the single emitter here.
        this._emitRouteChange(matched);
    }

    _onHashChange = () => {
        const fromNavigate = this._fromNavigate;
        this._fromNavigate = false;

        const matched = this.match(this._currentPathname());
        const prev = this.current;
        this.current = matched;

        if (fromNavigate) {
            // Our own navigate() already pushed + will emit routechange.
            return;
        }

        // Triggered by popstate (browser back/forward): reduce the stack instead
        // of pushing, then notify so the view can follow.
        if (prev && matched && prev.route && matched.route && prev.route.name !== matched.route.name) {
            this._popHistory();
        }
        this._emitRouteChange(matched);
    };

    // ── History stack (§9.5) ───────────────────────────────────────────────

    _pushHistory(routeName) {
        if (!this.state) return;
        if (!Array.isArray(this.state.navHistory)) this.state.navHistory = [];
        const last = this.state.navHistory[this.state.navHistory.length - 1];
        if (last !== routeName) this.state.navHistory.push(routeName);
    }

    _popHistory() {
        if (this.state && Array.isArray(this.state.navHistory) && this.state.navHistory.length > 0) {
            this.state.navHistory.pop();
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _currentPathname() {
        return this._pathname(window.location.hash);
    }

    _pathname(hash) {
        const h = typeof hash === 'string' ? hash : (window.location ? window.location.hash : '');
        let path = h.replace(/^#/, '');
        if (!path) path = '/';
        path = path.split('?')[0];
        // Tolerate the legacy ModalService hash formats so a reload after boot
        // (e.g. #timeline, #feed=<id>) still resolves to a router route.
        if (path.startsWith('feed=')) {
            return '/feed/' + decodeURIComponent(path.slice(5));
        }
        const legacyMap = { timeline: '/', feeds: '/feeds', settings: '/settings', downloads: '/' };
        if (Object.prototype.hasOwnProperty.call(legacyMap, path)) return legacyMap[path];
        return path;
    }

    _normalizePathname(pathname) {
        const p = typeof pathname === 'string' ? pathname : '';
        return p.split('?')[0];
    }

    _toHash(path) {
        const p = String(path || '/');
        if (p.startsWith('#')) return p;
        return '#' + (p.startsWith('/') ? p : '/' + p);
    }

    _matchCurrent(push) {
        const matched = this.match(this._currentPathname());
        if (push && matched) this._pushHistory(matched.route.name);
        this.current = matched;
        return matched;
    }

    // ── Event channel (§4) ─────────────────────────────────────────────────
    // Notify listeners of the new route. Dispatched on document so a mounted
    // AppShell can catch it as it bubbles up.
    _emitRouteChange(matched) {
        const detail = matched
            ? { route: matched.route, params: matched.params }
            : { route: null, params: {} };
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent('routechange', { bubbles: true, detail }));
        }
    }
}

export default RouterService;
