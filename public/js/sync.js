// sync.js — Podany SyncManager

import { ApiError } from './api.js';

export class SyncManager {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.api = app.api;
        this.storage = app.storage;
    }

    showStatus(msg) { this.app.modal.showStatus(msg); }
    hideStatus() { this.app.modal.hideStatus(); }

    // ── Subscriptions ───────────────────────────────────────────────────────

    async syncFeedsWithServer() {
        this.showStatus('Syncing feeds & playback state with server...');
        try {
            const subs = await this.api.listSubscriptions();
            const remoteFeeds = Array.isArray(subs.feeds) ? subs.feeds : [];
            this.state.feeds = remoteFeeds.map(f => f.id);
            const urlById = {};
            remoteFeeds.forEach(f => { if (f && f.id && f.feed_url) urlById[f.id] = f.feed_url; });
            this.state.feedUrlById = urlById;
            this.storage.saveFeeds(this.state.feeds);
            this.app.auth.updateSyncStatusUI('Server Synced', this.state.userEmail, true);
            await this.loadPositionsFromServer();
            await this.app.feeds.refreshAllFeeds();
        } catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
                this.storage.saveSessionToken('');
                this.state.sessionToken = '';
                this.app.auth.updateSyncStatusUI('Session Expired', '', false);
                this.elements.authModal.classList.remove('hidden');
                return;
            }
            console.warn('Sync warning:', err);
        } finally {
            this.hideStatus();
        }
    }

    async saveFeedToServer(feedUrl, title = '', image = '') {
        try {
            return await this.api.addSubscription({ feedUrl, title, image });
        } catch (e) {
            return null;
        }
    }

    async removeFeedFromServer(feedId) {
        try {
            await this.api.removeSubscriptionById(feedId);
        } catch (e) { }
    }

    // ── Playback positions ──────────────────────────────────────────────────

    async loadPositionsFromServer() {
        try {
            const positions = await this.api.listPositions();
            this.state.playbackPositions = positions || {};
            this.storage.savePositions(this.state.playbackPositions);
        } catch (e) { }
        this.app.timeline.renderContinueShelf();
        this.app.timeline.updateFilterBadges();
    }

    savePlaybackPositionToServer(episodeId, positionSeconds, completed = false) {
        if (!episodeId) return;
        this.state.playbackPositions[episodeId] = {
            position: positionSeconds,
            completed: completed ? 1 : 0,
            lastListenedAt: Math.floor(Date.now() / 1000)
        };
        this.storage.savePositions(this.state.playbackPositions);
        this.app.timeline.refreshContinueShelfAfterPositionChange();
        this.savePlaybackPositionToServerAsync(episodeId, positionSeconds, completed);
    }

    async savePlaybackPositionToServerAsync(episodeId, positionSeconds, completed = false) {
        try {
            await this.api.savePosition(episodeId, positionSeconds, completed);
        } catch (e) { }
    }
}

export default SyncManager;
