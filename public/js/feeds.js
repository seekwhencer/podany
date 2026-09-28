// feeds.js — Podany FeedsManager
// Feed fetching (new /api/feed/fetch endpoint), podcast directory search,
// feeds grid + feed detail, feed add/remove, and OPML import/export.

import FeedGrid from './components/feedsGrid.js';
import PodcastDirectory from './components/podcastDirectory.js';
import FeedDetail from './components/feedDetail.js';
import Opml from './components/opml.js';

export class FeedsManager {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.config = app.config;
        this.api = app.api;
        this.storage = app.storage;
        this.grid = new FeedGrid(this.app);
        this.directory = new PodcastDirectory(this.app);
        this.detail = new FeedDetail(this.app);
        this.opml = new Opml(this.app);
    }

    // ── UI delegators (implementations live in the sub-components) ──────────

    updateFeedCountUI() {
        this.grid.updateFeedCountUI();
    }

    updateDockVisibility() {
        this.grid.updateDockVisibility();
    }

    renderFeedsGrid() {
        this.grid.renderFeedsGrid();
    }

    searchPodcastDirectory(query, targetContainer = null) {
        this.directory.searchPodcastDirectory(query, targetContainer);
    }

    openFeedDetail(target) {
        this.detail.openFeedDetail(target);
    }

    renderFeedDetail(target) {
        this.detail.renderFeedDetail(target);
    }

    importOpml(file) {
        this.opml.importOpml(file);
    }

    exportOpml() {
        this.opml.exportOpml();
    }

    // ── Fetching ────────────────────────────────────────────────────────────

    async refreshAllFeeds() {
        if (this.state.feeds.length === 0) {
            this.state.allEpisodes = [];
            this.state.filteredEpisodes = [];
            this.state.feedMetadata = {};
            this.storage.saveCache([], this.state.feedMetadata, this.config.maxCacheEpisodes);
            this.updateFeedCountUI();
            this.app.timeline.renderContinueShelf();
            this.app.timeline.renderTimeline();
            this.renderFeedsGrid();
            return;
        }

        if (this.state.allEpisodes.length === 0) {
            this.grid.renderSkeletonTimeline();
        }

        this.app.modal.showStatus('Updating feeds...');
        const incomingEpisodes = [];
        const updatedMetadata = { ...this.state.feedMetadata };

        const fetchPromises = this.state.feeds.map(id => this.fetchSingleFeed(id, incomingEpisodes, updatedMetadata, true));
        await Promise.allSettled(fetchPromises);

        if (incomingEpisodes.length > 0) {
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
            this.storage.saveCache(this.state.allEpisodes, this.state.feedMetadata, this.config.maxCacheEpisodes);
        }

        this.app.modal.hideStatus();
        this.app.timeline.processAndSortEpisodes();
        this.app.timeline.renderTimeline();
        this.renderFeedsGrid();
    }

    async refreshSingleFeed(id) {
        const incomingEpisodes = [];
        const updatedMetadata = { ...this.state.feedMetadata };

        await this.fetchSingleFeed(id, incomingEpisodes, updatedMetadata, true);

        if (incomingEpisodes.length > 0) {
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
            this.storage.saveCache(this.state.allEpisodes, this.state.feedMetadata, this.config.maxCacheEpisodes);
        }

        this.state.downloadingFeeds.delete(id);
        this.grid.feedCards.get(String(id))?.update();
    }

    async fetchSingleFeed(target, incomingEpisodes, updatedMetadata, isId = false) {
        try {
            // Subscribed feeds are read by DB subscription id; preview of an
            // unsubscribed feed still fetches the RSS source by URL.
            const feedData = isId ? await this.api.loadFeedById(target) : await this.api.fetchFeed(target);

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

            updatedMetadata[target] = {
                title: feedMeta.title,
                artwork: feedMeta.artwork,
                image: feedMeta.image,
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
                title: title || 'Unknown Podcast',
                artwork,
                image: artwork,
                episodesCount: 0,
                url: cleanUrl
            };
            this.state.downloadingFeeds.add(id);
            this.refreshAllFeeds();
        }

        if (this.elements.feedUrlInput && this.elements.feedUrlInput.value.trim() === cleanUrl) {
            this.elements.feedUrlInput.value = '';
        }
    }

    promptRemoveFeed(feedId) {
        this.state.feedToDelete = feedId;
        const meta = this.state.feedMetadata[feedId] || {};
        const title = meta.title || 'this podcast';
        if (this.elements.confirmModalMsg) {
            this.elements.confirmModalMsg.textContent = `Do you want to unsubscribe from "${title}"?`;
        }
        if (this.elements.confirmModal) {
            this.elements.confirmModal.classList.remove('hidden');
        }
    }

    removeFeed(feedId) {
        if (this.state.activeFeedDetailId === feedId) {
            this.state.activeFeedDetailId = null;
            if (this.elements.panelFeedDetail) this.elements.panelFeedDetail.classList.remove('active');
            const feedsTab = this.elements.tabFeeds;
            const feedsPanel = this.elements.panelFeeds;
            this.elements.tabs.forEach(t => t.classList.remove('active'));
            this.elements.panels.forEach(p => p.classList.remove('active'));
            if (feedsTab) feedsTab.classList.add('active');
            if (feedsPanel) feedsPanel.classList.add('active');
        }

        this.state.allEpisodes = this.state.allEpisodes.filter(ep => ep.subscriptionId !== feedId);
        this.state.feeds = this.state.feeds.filter(f => f !== feedId);
        delete this.state.feedMetadata[feedId];
        delete this.state.feedUrlById[feedId];
        this.storage.saveFeeds(this.state.feeds);
        this.app.sync.removeFeedFromServer(feedId);
        this.app.timeline.processAndSortEpisodes();
        this.app.timeline.renderTimeline();
        this.renderFeedsGrid();
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    wireEvents() {
        const runSearch = () => this.searchPodcastDirectory(this.elements.podcastSearchQuery.value);
        if (this.elements.btnSearchDirectory) {
            this.elements.btnSearchDirectory.addEventListener('click', runSearch);
        }
        if (this.elements.podcastSearchQuery) {
            this.elements.podcastSearchQuery.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    runSearch();
                }
            });
        }

        const modalCatChips = this.elements.modalCategoryChips.querySelectorAll('.category-chip');
        modalCatChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const cat = chip.dataset.category;
                if (this.elements.podcastSearchQuery) {
                    this.elements.podcastSearchQuery.value = cat;
                    this.searchPodcastDirectory(cat);
                }
            });
        });

        if (this.elements.btnSubmitFeed) {
            this.elements.btnSubmitFeed.addEventListener('click', () => {
                if (this.elements.feedUrlInput.value) {
                    this.addFeed(this.elements.feedUrlInput.value);
                    const origText = this.elements.btnSubmitFeed.textContent;
                    this.elements.btnSubmitFeed.textContent = 'Subscribed!';
                    setTimeout(() => { this.elements.btnSubmitFeed.textContent = origText; }, 2000);
                    this.app.modal.closeAddModal();
                }
            });
        }
        if (this.elements.feedUrlInput) {
            this.elements.feedUrlInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (this.elements.feedUrlInput.value) {
                        this.addFeed(this.elements.feedUrlInput.value);
                        const origText = this.elements.btnSubmitFeed.textContent;
                        this.elements.btnSubmitFeed.textContent = 'Subscribed!';
                        setTimeout(() => { this.elements.btnSubmitFeed.textContent = origText; }, 2000);
                    }
                }
            });
        }

        if (this.elements.btnRefreshAll) {
            this.elements.btnRefreshAll.addEventListener('click', () => this.refreshAllFeeds());
        }

        if (this.elements.opmlFileInput) {
            this.elements.opmlFileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) this.importOpml(e.target.files[0]);
            });
        }
        if (this.elements.btnExportOpml) {
            this.elements.btnExportOpml.addEventListener('click', () => this.exportOpml());
        }

        if (this.elements.btnLoadDefaults) {
            this.elements.btnLoadDefaults.addEventListener('click', async () => {
                this.app.modal.showStatus('Adding recommended starter feeds...');
                const searchTerms = ['ZEIT Geschichte', 'ZEIT WISSEN', 'Weltspiegel Podcast', 'Syntax Podcast'];
                for (const term of searchTerms) {
                    try {
                        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=podcast&limit=1`);
                        const data = await res.json();
                        if (data.results && data.results[0] && data.results[0].feedUrl) {
                            const feedUrl = data.results[0].feedUrl;
                            const existingId = this.state.feedUrlById[feedUrl];
                            if (existingId && this.state.feeds.includes(existingId)) continue;
                            const result = await this.app.sync.saveFeedToServer(feedUrl, data.results[0].collectionName, data.results[0].artworkUrl600);
                            if (result && result.id) {
                                this.state.feeds.push(result.id);
                                this.state.feedUrlById = { ...this.state.feedUrlById, [result.id]: feedUrl };
                            }
                        }
                    } catch (e) { }
                }
                this.storage.saveFeeds(this.state.feeds);
                this.app.modal.hideStatus();
                this.refreshAllFeeds();
            });
        }
    }
}

export default FeedsManager;
