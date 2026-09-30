// LiveClient.js — Podany WebSocket client for live events over `/live`.
// Opens a connection on the same origin/port as Express, dispatches server
// events to the responsible managers, and rebuilds the link with exponential
// backoff after a drop. No token in the URL — the session cookie / header is
// verified by the server during the upgrade handshake.

import { FALLBACK_ARTWORK, artworkUrl, WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS, WS_RECONNECT_MAX_FAILURES } from './Config.js';

export class LiveClient {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.config = app.config;
        this.api = app.api;
        this.auth = app.auth;

        this._ws = null;
        this._connecting = false;
        this._didOpen = false;
        this._closed = false;
        this._connected = false;
        this._reconnectTimer = null;
        this._attempts = 0;
        this._connectFailures = 0;
    }

    get url() {
        const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
        return `${proto}://${location.host}/live`;
    }

    get isConnected() {
        return this._connected && this._ws && this._ws.readyState === WebSocket.OPEN;
    }

    get isActive() {
        return !this._closed && (this._connected || this._connecting);
    }

    // ── Connection lifecycle ────────────────────────────────────────────────

    async connect() {
        return new Promise((resolve, reject) => {
            if (this._ws || this._connecting) return;
            if (!this.state.sessionToken) return;

            this._connecting = true;
            this._didOpen = false;
            this._pushLiveStatus();

            this.connectTimeout = setTimeout(() => reject('timeout'), 10000);

            let ws;
            try {
                ws = new WebSocket(this.url);
            } catch (err) {
                this._connecting = false;
                this._scheduleReconnect();
                return;
            }

            this._ws = ws;

            ws.onopen = () => {
                this._connecting = false;
                this._didOpen = true;
                this._connectFailures = 0;
                this._attempts = 0;
                this._closed = false;
                this._connected = true;
                this._onOpen();
                resolve(true);
            };

            ws.onerror = (err) => {
                this._connecting = false;
                this._onError(err);
                reject(err);
            };

            ws.onclose = () => {
                this._connecting = false;
                this._ws = null;
                if (!this._didOpen && !this._closed) {
                    this._connectFailures += 1;
                    if (this._connectFailures >= WS_RECONNECT_MAX_FAILURES) {
                        this._permanentAuthFailure();
                        return;
                    }
                }
                this._didOpen = false;
                this._onClose();
            };

            ws.onmessage = (ev) => this._onMessage(ev);


        });
    }

    _onOpen() {
        console.log('[live] connected');
        clearTimeout(this.connectTimeout);
        this._pushLiveStatus();
    }

    _onClose() {
        this._connected = false;
        clearTimeout(this.connectTimeout);

        if (this._closed) return;
        this._pushLiveStatus();
        this._scheduleReconnect();
    }

    _onError(err) {
        console.error('[live] connection error', err && err.message ? err.message : err);
        this._pushLiveStatus();
    }

    // Push connection state into app.state so LiveConnectionComponent can project
    // it. Keeps the service DOM-free; the component only reads app.state.
    _pushLiveStatus() {
        this.state.liveStatus = {
            connected: this._connected && !this._connecting,
            connecting: this._connecting,
            failures: this._connectFailures
        };
        this.state.notify('liveStatus');
    }

    _permanentAuthFailure() {
        this._closed = true;
        this._stopReconnectTimer();
        this._connected = false;
        console.warn('[live] connection repeatedly rejected — assuming session invalid');
        if (this.auth && typeof this.auth.showAuthModal === 'function') {
            this.auth.showAuthModal();
        }
    }

    _scheduleReconnect() {
        if (this._closed || this._reconnectTimer) return;
        const exp = Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * Math.pow(2, this._attempts));
        const jitter = Math.random() * (exp / 4);
        const delay = Math.floor(exp + jitter);
        this._attempts += 1;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this.connect();
        }, delay);
    }

    _stopReconnectTimer() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    // Force a fresh connection (used when coming back online).
    async forceReconnect() {
        this._closed = false;
        this._connectFailures = 0;
        this._stopReconnectTimer();
        if (this._ws) {
            try { this._ws.onclose = null; this._ws.onerror = null; this._ws.close(); } catch (_) { }
            this._ws = null;
        }
        await this.connect();
    }

    // Intentional shutdown: stops reconnect and closes the socket.
    close() {
        this._closed = true;
        this._connected = false;
        this._stopReconnectTimer();
        if (this._ws) {
            try { this._ws.onclose = null; this._ws.onerror = null; this._ws.close(); } catch (_) { }
            this._ws = null;
        }
    }

    _send(msg) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            try { this._ws.send(msg); } catch (_) { }
        }
    }

    // ── Message handling ────────────────────────────────────────────────────

    _onMessage(ev) {
        const raw = typeof ev.data === 'string' ? ev.data : null;
        if (!raw) return;
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (err) {
            return;
        }
        if (!msg || typeof msg.type !== 'string') return;

        const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};

        //console.log('>>> WS', msg);

        //return;

        switch (msg.type) {

            case 'connection:hello':
                this._connected = true;
                break;

            case 'ping':
                this._send('pong');
                break;

            case 'download:progress':
            case 'download:completed':
            case 'download:failed':
                this._handleDownload(msg);
                break;

            case 'image:completed':
            case 'thumbnail:ready':
                this._handleArtwork(payload);
                break;

            case 'subscription:added':
            case 'subscription:removed':
                this._handleSubscription(payload);
                break;

            case 'download:all-subscription-downloads-completed':
                this._handleAllSubscriptionDownloadsComplete(payload);
                break;

            case 'playback:position-updated':
                this._handlePlayback(payload);
                break;
            case 'session:closed':
                this._handleSessionClosed(payload);
                break;

            case 'error':
                console.log('[live] server error', payload);
                break;

            default:
                break;

        }
    }

    // ── Event dispatch to managers ──────────────────────────────────────────

    _handleDownload(msg = null) {
        if (msg === null)
            return;

        const event = msg?.type || false;
        const payload = msg?.payload || false;

        if (event === false)
            return;


        switch (event) {
            case 'download:progress':
                console.log('>>> DOWNLOAD STARTED:', payload.id);
                this._addDownloadingSpan(payload);
                break;

            case 'download:completed':
                console.log('>>> DOWNLOAD COMPLETE:', payload.id);
                this._markDownloaded(payload);
                break;
        }

        if (!this.state.downloadStatus) this.state.downloadStatus = {};
        const status = payload.status || (payload.progress !== undefined ? 'progress' : 'completed');
        this.state.downloadStatus[payload.episodeId] = {
            status,
            progress: typeof payload.progress === 'number' ? payload.progress : undefined,
            title: payload.title,
            at: Date.now()
        };
        this.state.notify('downloadStatus');
    }

    _feedCard(feedId) {
        const grid = this.app.feeds?.grid?.feedCards;
        if (!grid) return null;
        const card = grid.get(String(feedId));
        return card && card.el ? card : null;
    }

    _addDownloadingSpan(payload) {
        const feedId = payload.subscriptionId;
        if (!feedId || !payload.episodeId) return;
        const card = this._feedCard(feedId);
        if (!card) return;
        const progress = card.el.querySelector('.feed-downloading-progress');
        if (!progress) return;
        if (progress.querySelector(`.download-progress-item[data-episode-id="${payload.episodeId}"]`)) return;

        const span = document.createElement('span');
        span.className = 'download-progress-item';
        span.dataset.episodeId = String(payload.episodeId);
        //span.textContent = payload.title || `Episode ${payload.episodeId}`;
        span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star preview-icon"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';
        progress.appendChild(span);
    }

    _markDownloaded(payload) {
        const feedId = payload.subscriptionId;
        if (!feedId || !payload.episodeId) return;
        const card = this._feedCard(feedId);
        if (!card) return;
        const span = card.el.querySelector(`.feed-downloading-progress .download-progress-item[data-episode-id="${payload.episodeId}"]`);
        if (span) span.classList.add('is-downloaded');
    }

    _handleArtwork(payload) {
        return;

        const episodeId = payload.episodeId;
        const image = payload.image;
        if (!episodeId || !image) return;

        const episodes = this.state.allEpisodes;
        if (Array.isArray(episodes)) {
            episodes.forEach(ep => {
                if (ep && String(ep.id) === String(episodeId) && ep.image !== image) ep.image = image;
            });
        }

        const cur = this.state.currentEpisode;
        if (cur && String(cur.id) === String(episodeId)) {
            // Player/mini artwork projection is owned by PlayerBarComponent; the
            // LiveService only pushes state (see _handleArtwork's early return).
        }
    }

    _handleSubscription(payload) {
        const feeds = this.app.feeds;
        if (!feeds) return;
        if (typeof feeds.updateFeedCountUI === 'function') feeds.updateFeedCountUI();
        if (typeof feeds.renderFeedsGrid === 'function') feeds.renderFeedsGrid();
    }

    _handlePlayback(payload) {
        return;

        const episodeId = payload.episodeId;
        if (episodeId && this.state.playbackPositions) {
            const existing = this.state.playbackPositions[episodeId];
            this.state.playbackPositions[episodeId] = {
                position: typeof payload.positionSeconds === 'number'
                    ? payload.positionSeconds
                    : (existing ? existing.position : 0),
                completed: payload.completed === true || payload.completed === 1,
                lastListenedAt: Math.floor(Date.now() / 1000)
            };
        }

        const playback = this.app.playback;
        if (playback && typeof playback.syncPlaybackButtons === 'function') {
            playback.syncPlaybackButtons();
        }
    }

    _handleSessionClosed(payload) {
        console.log('[live] session closed on server', payload && payload.reason);
        this._closed = true;
        this._connected = false;
        this._stopReconnectTimer();
        if (this._ws) {
            try { this._ws.onclose = null; this._ws.close(); } catch (_) { }
            this._ws = null;
        }
        if (this.auth && typeof this.auth.handleLogout === 'function') {
            this.auth.handleLogout();
        }
    }

    async _handleAllSubscriptionDownloadsComplete(payload) {
        const ids = Array.isArray(payload.id) ? payload.id : (payload.id != null ? [payload.id] : []);
        const feeds = this.app.feeds;
        if (!feeds) return;

        for (const id of ids) {
            if (typeof feeds.refreshSingleFeed === 'function') {
                await feeds.refreshSingleFeed(id);
            }
        }
    }
}

export default LiveClient;
