// feedsGrid.js — Podany FeedGrid
// Feeds-grid rendering, empty-state onboarding, feed-count/dock visibility, and
// the timeline skeleton placeholder.

import { escapeHtml } from '../utils.js';
import FeedCard from './feedCard.js';

export class FeedGrid {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.feedsSearchDebounceTimer = null;
        this.feedCards = new Map();
    }

    updateFeedCountUI() {
        if (this.elements.feedCount) {
            this.elements.feedCount.textContent = this.state.feeds.length;
        }
        this.updateDockVisibility();
    }

    updateDockVisibility() {
        if (!this.elements.bottomActionDock) return;
        const isTimelineActive = this.elements.tabTimeline && this.elements.tabTimeline.classList.contains('active');
        const isDetailActive = !!this.state.activeFeedDetailId;
        const hasFeeds = this.state.feeds && this.state.feeds.length > 0;

        if (isTimelineActive && !isDetailActive && hasFeeds) {
            this.elements.bottomActionDock.classList.remove('dock-hidden');
        } else {
            this.elements.bottomActionDock.classList.add('dock-hidden');
        }
    }

    renderSkeletonTimeline() {
        const container = this.elements.timelineList;
        if (!container) return;
        let html = '';
        for (let i = 0; i < 4; i++) {
            html += `
        <div class="skeleton-card">
          <div class="skeleton-art"></div>
          <div class="skeleton-lines">
            <div class="skeleton-line" style="width: 35%;"></div>
            <div class="skeleton-line" style="width: 80%;"></div>
            <div class="skeleton-line" style="width: 60%;"></div>
          </div>
        </div>
      `;
        }
        container.innerHTML = html;
    }

    renderFeedsGrid() {
        this.updateDockVisibility();
        const grid = this.elements.feedsGrid;
        grid.innerHTML = '';

        if (this.state.feeds.length === 0) {
            grid.innerHTML = this._feedsEmptyOnboardingHtml();
            this.wireFeedsEmptyStateEvents();
            return;
        }

        let feedsToRender = this.state.feeds;
        if (this.state.searchQuery && this.elements.tabFeeds && this.elements.tabFeeds.classList.contains('active')) {
            const q = this.state.searchQuery.toLowerCase();
            feedsToRender = this.state.feeds.filter(id => {
                const meta = this.state.feedMetadata[id] || {};
                const url = this.state.feedUrlById[id] || '';
                return (meta.title && meta.title.toLowerCase().includes(q)) ||
                    (meta.author && meta.author.toLowerCase().includes(q)) ||
                    url.toLowerCase().includes(q);
            });
        }

        if (feedsToRender.length === 0) {
            grid.innerHTML = `
        <div class="empty-state">
          <h3>No matching podcasts</h3>
          <p>No podcasts in your library match "${escapeHtml(this.state.searchQuery)}".</p>
        </div>
      `;
            return;
        }

        this.feedCards.clear();
        feedsToRender.forEach(id => {
            const card = new FeedCard(this.app, id);
            this.feedCards.set(String(id), card);
            grid.appendChild(card.el);
        });
    }

    _feedsEmptyOnboardingHtml() {
        return `
      <div class="empty-state onboarding-card">
        <div class="empty-icon-wrap">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9"></path>
            <path d="M4 4a16 16 0 0 1 16 16"></path>
            <circle cx="5" cy="19" r="1"></circle>
          </svg>
        </div>
        <h3>Your podcast library is empty</h3>
        <p>Search any podcast by name, paste an RSS feed URL, or import an OPML backup to start listening.</p>
        <div class="empty-quick-add">
          <form id="feeds-empty-quick-form" class="quick-add-form" action="javascript:void(0);">
            <div class="quick-add-input-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="quick-add-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" id="feeds-empty-quick-input" placeholder="Search podcast name or paste RSS URL..." autocomplete="off">
              <button type="submit" class="btn btn-primary btn-quick-submit" id="btn-feeds-empty-quick-submit">Add</button>
            </div>
          </form>
          <div id="feeds-empty-quick-results" class="quick-results-container"></div>
        </div>
        <div class="empty-actions">
          <button class="btn btn-secondary" id="btn-feeds-empty-opml">Import OPML File</button>
        </div>
        <div class="starter-suggestions-section">
          <div class="starter-suggestions-title">Discover Science, Planet & Climate shows:</div>
          <div class="starter-suggestions-grid" id="feeds-empty-starter-grid"></div>
        </div>
      </div>
    `;
    }

    wireFeedsEmptyStateEvents() {
        const quickForm = this.elements.byId('feeds-empty-quick-form');
        const quickInput = this.elements.byId('feeds-empty-quick-input');
        const quickSubmit = this.elements.byId('btn-feeds-empty-quick-submit');
        const quickResults = this.elements.byId('feeds-empty-quick-results');

        if (quickInput && quickForm) {
            quickInput.addEventListener('input', () => {
                const val = quickInput.value.trim();
                if (quickSubmit) {
                    if (val.startsWith('http://') || val.startsWith('https://')) {
                        quickSubmit.textContent = 'Add Feed';
                    } else {
                        quickSubmit.textContent = 'Search';
                    }
                }
                if (this.feedsSearchDebounceTimer) clearTimeout(this.feedsSearchDebounceTimer);
                if (!val) {
                    if (quickResults) quickResults.innerHTML = '';
                    return;
                }
                if (val.startsWith('http://') || val.startsWith('https://')) {
                    if (quickResults) quickResults.innerHTML = '';
                    return;
                }
                this.feedsSearchDebounceTimer = setTimeout(() => {
                    if (quickResults) {
                        this.app.feeds.searchPodcastDirectory(val, quickResults);
                    }
                }, 350);
            });

            quickForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const val = quickInput.value.trim();
                if (!val) return;
                if (val.startsWith('http://') || val.startsWith('https://')) {
                    if (quickSubmit) quickSubmit.textContent = 'Adding...';
                    this.app.feeds.addFeed(val);
                    quickInput.value = '';
                    if (quickResults) quickResults.innerHTML = '';
                } else {
                    if (this.feedsSearchDebounceTimer) clearTimeout(this.feedsSearchDebounceTimer);
                    if (quickResults) {
                        this.app.feeds.searchPodcastDirectory(val, quickResults);
                    }
                }
            });
        }

        this.elements.byId('btn-feeds-empty-opml')?.addEventListener('click', () => {
            this.elements.opmlFileInput?.click();
        });

        const starterGrid = this.elements.byId('feeds-empty-starter-grid');
        if (starterGrid) {
            this._buildStarterChips().forEach(chip => starterGrid.appendChild(chip));
        }
    }

    _buildStarterChips() {
        const starters = [
            { feed: 'https://feeds.megaphone.fm/NATIONALAERONAUTICSANDSPACEADMINISTRATION8162188566', name: "NASA's Curious Universe" },
            { feed: 'https://feeds.simplecast.com/EmVW7VGp', name: 'Radiolab' },
            { feed: 'https://www.deutschlandfunk.de/forschung-aktuell-102.xml', name: 'Forschung aktuell (DLF)' },
            { feed: 'https://www.ndr.de/nachrichten/info/podcast4696.xml', name: 'ARD Klima-Update' },
            { feed: 'https://feeds.simplecast.com/NM3_bR51', name: 'ZEIT WISSEN' },
            { feed: 'https://podcasts.files.bbci.co.uk/w13xtvb6.rss', name: 'The Climate Question (BBC)' }
        ];
        return starters.map(item => {
            const chip = document.createElement('div');
            chip.className = 'starter-suggestion-chip';
            chip.dataset.feed = item.feed;
            chip.innerHTML = `<span class="starter-chip-name">${escapeHtml(item.name)}</span><span class="starter-chip-add">+ Follow</span>`;
            const els = {};
            els.addSpan = chip.querySelector('.starter-chip-add');
            chip.addEventListener('click', () => {
                const feedUrl = chip.dataset.feed;
                if (!feedUrl) return;
                if (els.addSpan) els.addSpan.textContent = 'Adding...';
                this.app.feeds.addFeed(feedUrl);
            });
            chip.__els = els;
            return chip;
        });
    }
}

export default FeedGrid;
