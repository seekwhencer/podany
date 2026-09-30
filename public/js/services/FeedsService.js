// feeds.js — Podany FeedsService
// Feed fetching (new /api/feed/fetch endpoint), podcast directory search,
// feeds grid + feed detail, feed add/remove, and OPML import/export.

import PodcastDirectoryComponent from '../components/PodcastDirectoryComponent.js';

export class FeedsService {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.config = app.config;
        this.api = app.api;
        this.storage = app.storage;
        this.directory = new PodcastDirectoryComponent(this.app);
        this._refreshActive = false;
        this._refreshQueued = false;
    }

    // ── UI delegators ─────────────────────────────────────────────────────

    // Feed-count badge is projected live onto HeaderComponent from AppState;
    // retained as a no-op for existing callers (boot, live sync, logout).
    updateFeedCountUI() { }

    // Dock visibility is CSS-driven by body[data-active-view] (R2); no-op kept
    // for backward-compatible callers.
    updateDockVisibility() { }

    // The feeds grid is rendered by FeedsView/FeedsGridComponent on the
    // router-driven shell; no-op kept for existing callers.
    renderFeedsGrid() { }

    searchPodcastDirectory(query, targetContainer = null) {
        this.directory.searchPodcastDirectory(query, targetContainer);
    }

    // Opening a feed detail is a router navigation on the shell (§9), not a
    // direct render. Retained so AddFeedComponent can request it after a
    // directory selection.
    openFeedDetail(target) {
        if (this.app && this.app.router && typeof this.app.router.navigate === 'function') {
            this.app.router.navigate('/feed/' + encodeURIComponent(target));
        }
    }

    // Feed detail rendering is owned by FeedDetailView on the shell; no-op kept
    // for existing callers.
    renderFeedDetail(target) { }

    // ── Fetching ────────────────────────────────────────────────────────────

    async refreshAllFeeds() {
        if (this._refreshActive) {
            this._refreshQueued = true;
            return;
        }
        this._refreshActive = true;
        try {
            await this._refreshAllFeedsRun();
        } finally {
            this._refreshActive = false;
            if (this._refreshQueued) {
                this._refreshQueued = false;
                await this.refreshAllFeeds();
            }
        }
    }

    async _refreshAllFeedsRun() {
        if (this.state.feeds.length === 0) {
            this.state.allEpisodes = [];
            this.state.filteredEpisodes = [];
            this.state.feedMetadata = {};
            this.state.notify('allEpisodes');
            this.state.notify('filteredEpisodes');
            this.state.notify('feedMetadata');
            this.storage.saveCache([], this.state.feedMetadata, this.config.maxCacheEpisodes);
            this.updateFeedCountUI();
            this.app.timeline.renderTimeline();
            this.renderFeedsGrid();
            return;
        }

        if (this.state.allEpisodes.length === 0 && this.grid) {
            this.grid.renderSkeletonTimeline();
        }

        this.app.modal.showStatus('Updating feeds...');
        const incomingEpisodes = [];
        const updatedMetadata = { ...this.state.feedMetadata };

        const fetchPromises = this.state.feeds.map(id => this.fetchSingleFeed(id, incomingEpisodes, updatedMetadata));
        await Promise.allSettled(fetchPromises);

        const epMap = new Map();
        incomingEpisodes.forEach(ep => {
            if (ep && ep.guid) epMap.set(ep.guid, ep);
        });
        this.state.allEpisodes.forEach(ep => {
            if (ep && ep.guid && !epMap.has(ep.guid) && this.state.feeds.includes(ep.subscriptionId)) {
                epMap.set(ep.guid, ep);
            }
        });
        this.state.allEpisodes = Array.from(epMap.values());
        this.state.feedMetadata = updatedMetadata;
        this.state.notify('allEpisodes');
        this.state.notify('feedMetadata');
        this.storage.saveCache(this.state.allEpisodes, this.state.feedMetadata, this.config.maxCacheEpisodes);

        this.app.modal.hideStatus();
        this.app.timeline.processAndSortEpisodes();
        this.app.timeline.renderTimeline();
        this.renderFeedsGrid();
    }

    async refreshSingleFeed(id) {
        const incomingEpisodes = [];
        const updatedMetadata = { ...this.state.feedMetadata };

        await this.fetchSingleFeed(id, incomingEpisodes, updatedMetadata);

        const epMap = new Map();
        incomingEpisodes.forEach(ep => {
            if (ep && ep.guid) epMap.set(ep.guid, ep);
        });
        this.state.allEpisodes.forEach(ep => {
            if (ep && ep.guid && !epMap.has(ep.guid) && this.state.feeds.includes(ep.subscriptionId)) {
                epMap.set(ep.guid, ep);
            }
        });
        this.state.allEpisodes = Array.from(epMap.values());
        this.state.feedMetadata = updatedMetadata;
        this.state.notify('allEpisodes');
        this.state.notify('feedMetadata');
        this.storage.saveCache(this.state.allEpisodes, this.state.feedMetadata, this.config.maxCacheEpisodes);

        this.state.downloadingFeeds.delete(id);
        this.state.notify('downloadingFeeds');
        if (this.grid) this.grid.feedCards.get(String(id))?.update();
    }

    async fetchSingleFeed(target, incomingEpisodes, updatedMetadata) {
        try {
            // Subscribed feeds are always read by DB subscription id.
            const feedData = await this.api.loadFeedById(target);

            if (feedData && feedData.error) {
                if (!updatedMetadata[target]) {
                    updatedMetadata[target] = {
                        title: feedData.title || 'Unavailable Feed',
                        artwork: '',
                        episodesCount: 0,
                        error: feedData.error
                    };
                }
                return null;
            }

            const feedMeta = feedData && feedData.feed ? feedData.feed : feedData;
            if (!feedMeta) {
                return null;
            }

            const prior = updatedMetadata[target] || {};
            updatedMetadata[target] = {
                title: feedMeta.title || prior.title,
                artwork: feedMeta.artwork || prior.artwork,
                image: feedMeta.image || prior.image || prior.artwork,
                episodesCount: feedMeta.episodesCount,
                description: feedMeta.description
            };

            if (Array.isArray(feedData.episodes)) {
                incomingEpisodes.push(...feedData.episodes);
            }

            return feedData;
        } catch (err) {
            if (!updatedMetadata[target]) {
                updatedMetadata[target] = {
                    title: 'Error Loading Feed',
                    artwork: '',
                    episodesCount: 0,
                    error: err.message
                };
            }
            return null;
        }
    }

    // ── Feed management ─────────────────────────────────────────────────────

    async addFeed(url, title = '', artwork = '') {
        const cleanUrl = url.trim();
        if (!cleanUrl) return;

        const existingId = this.state.feedUrlById[cleanUrl];
        if (existingId && this.state.feeds.includes(existingId)) {
            alert('This feed is already in your subscriptions.');
            return;
        }

        const result = await this.app.sync.saveFeedToServer(cleanUrl, title, artwork);
        const id = result && result.id;
        if (id) {
            this.state.feeds.push(id);
            this.state.feedUrlById = { ...this.state.feedUrlById, [id]: cleanUrl };
            this.state.feedMetadata[id] = {
                title,
                artwork,
                image: artwork,
                episodesCount: 0,
                url: cleanUrl
            };
            this.state.downloadingFeeds.add(id);
            this.state.notify('feeds');
            this.state.notify('feedUrlById');
            this.state.notify('feedMetadata');
            this.state.notify('downloadingFeeds');
            this.refreshAllFeeds();
        }

        // The add-feed input is owned by AddFeedComponent (R5); clearing it here
        // was legacy static-DOM wiring and is dropped.
        return id || null;
    }

    // Prompt to unsubscribe via the shared ConfirmModalComponent (R5). The actual
    // removal only runs after the user confirms.
    async promptRemoveFeed(feedId) {
        const meta = this.state.feedMetadata[feedId] || {};
        const title = meta.title || 'this podcast';
        const result = await this.app.modal.showConfirm(`Do you want to unsubscribe from "${title}"?`, {
            confirmLabel: 'Unsubscribe',
            cancelLabel: 'Cancel',
            danger: true
        });
        this.state.feedToDelete = null;
        if (result === 'confirmed') {
            this.removeFeed(feedId);
        }
    }

    removeFeed(feedId) {
        if (this.state.activeFeedDetailId === feedId) {
            this.state.activeFeedDetailId = null;
            // Tab/panel activation is owned by the router-driven shell (R1/R3);
            // the legacy static tab wiring is dropped.
        }

        this.state.allEpisodes = this.state.allEpisodes.filter(ep => ep.subscriptionId !== feedId);
        this.state.feeds = this.state.feeds.filter(f => f !== feedId);
        delete this.state.feedMetadata[feedId];
        delete this.state.feedUrlById[feedId];
        this.state.notify('allEpisodes');
        this.state.notify('feeds');
        this.state.notify('feedMetadata');
        this.state.notify('feedUrlById');
        this.storage.saveFeeds(this.state.feeds);
        this.app.sync.removeFeedFromServer(feedId);
        this.app.timeline.processAndSortEpisodes();
        this.app.timeline.renderTimeline();
        this.renderFeedsGrid();
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    wireEvents() {
        // The dock "Refresh all" and the OPML controls (import/export/load
        // defaults) are owned by the active shell components (DockComponent R2,
        // AddFeedComponent R5, Settings). The legacy static-DOM event wiring is
        // dropped; the service methods themselves are retained for callers.
    }
}

export default FeedsService;
