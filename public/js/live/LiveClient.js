// LiveClient.js — Podany WebSocket client for live events over `/live`.
// Opens a connection on the same origin/port as Express, dispatches server
// events to the responsible managers, and rebuilds the link with exponential
// backoff after a drop. No token in the URL — the session cookie / header is
// verified by the server during the upgrade handshake.

import { FALLBACK_ARTWORK, artworkUrl, WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS, WS_RECONNECT_MAX_FAILURES } from '../config.js';

export class LiveClient {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
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
    }

    _onClose() {
        this._connected = false;
        clearTimeout(this.connectTimeout);

        if (this._closed) return;
        this._scheduleReconnect();
    }

    _onError(err) {
        console.error('[live] connection error', err && err.message ? err.message : err);
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
                this._handleDownload(payload);
                break;
            case 'image:completed':
            case 'thumbnail:ready':
                this._handleArtwork(payload);
                break;
            case 'subscription:added':
            case 'subscription:removed':
                this._handleSubscription(payload);
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

    _handleDownload(payload) {
        const guid = payload.episodeGuid;
        if (!guid) return;
        if (!this.state.downloadStatus) this.state.downloadStatus = {};
        const status = payload.status || (payload.progress !== undefined ? 'progress' : 'completed');
        this.state.downloadStatus[guid] = {
            status,
            progress: typeof payload.progress === 'number' ? payload.progress : undefined,
            title: payload.title,
            at: Date.now()
        };

        const ep = (this.state.allEpisodes || []).find(e => e && e.guid === guid);
        const card = ep && ep.id ? document.querySelector(`.episode-card[data-id="${CSS.escape(String(ep.id))}"]`) : null;
        if (!card) return;
        const badge = card.querySelector('.ep-download-badge');
        if (!badge) return;
        const data = this.state.downloadStatus[guid];
        badge.dataset.status = data.status;
        if (data.status === 'completed') {
            badge.textContent = 'Downloaded';
        } else if (data.status === 'failed') {
            badge.textContent = 'Failed';
        } else {
            badge.textContent = `${Math.min(100, Math.max(0, Math.round(data.progress || 0)))}%`;
        }
    }

    _handleArtwork(payload) {
        const guid = payload.episodeGuid;
        const image = payload.image;
        if (!guid || !image) return;

        const episodes = this.state.allEpisodes;
        if (Array.isArray(episodes)) {
            episodes.forEach(ep => {
                if (ep && ep.guid === guid && ep.image !== image) ep.image = image;
            });
        }

        const targetEp = (this.state.allEpisodes || []).find(e => e && e.guid === guid);
        const targetId = targetEp ? String(targetEp.id) : null;
        const cards = document.querySelectorAll('.episode-card');
        cards.forEach(card => {
            if (targetId == null || card.dataset.id !== targetId) return;
            const img = card.querySelector('.episode-artwork');
            if (img) {
                img.src = artworkUrl(image, 'thumb');
                img.onerror = () => { img.onerror = null; img.src = FALLBACK_ARTWORK; };
            }
        });

        const cur = this.state.currentEpisode;
        if (cur && cur.guid === guid && this.elements) {
            const playerArt = this.elements.playerArtwork;
            if (playerArt) playerArt.src = artworkUrl(image, 'full');
            const miniArt = this.elements.miniArtwork;
            if (miniArt) miniArt.src = artworkUrl(image, 'large');
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
        const guid = payload.episodeGuid;
        if (guid && this.state.playbackPositions) {
            const existing = this.state.playbackPositions[guid];
            this.state.playbackPositions[guid] = {
                position: typeof payload.positionSeconds === 'number'
                    ? payload.positionSeconds
                    : (existing ? existing.position : 0),
                completed: payload.completed === true || payload.completed === 1,
                lastListenedAt: Math.floor(Date.now() / 1000)
            };
        }

        const tl = this.app.timeline;
        if (tl) {
            if (typeof tl.renderTimeline === 'function') tl.renderTimeline();
            if (typeof tl.renderContinueShelf === 'function') tl.renderContinueShelf();
            if (typeof tl.updateFilterBadges === 'function') tl.updateFilterBadges();
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
}

export default LiveClient;
