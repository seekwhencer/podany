// feeds.js — Podany FeedsManager
// Feed fetching (new /api/feed/fetch endpoint), podcast directory search,
// feeds grid + feed detail, feed add/remove, and OPML import/export.

import { escapeHtml, formatCompactDate } from './utils.js';
import { FALLBACK_ARTWORK, artworkUrl, DIR_PAGE_SIZE } from './config.js';
import FeedGrid from './components/feedsGrid.js';
import FeedCard from './components/feedCard.js';

export class FeedsManager {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.config = app.config;
        this.api = app.api;
        this.storage = app.storage;
        this.previewLoadingSet = new Set();
        this.grid = new FeedGrid(this.app);
        this.card = new FeedCard(this.app);
    }

    // ── UI delegators (implementations live in the FeedGrid component) ───────

    updateFeedCountUI() {
        this.grid.updateFeedCountUI();
    }

    updateDockVisibility() {
        this.grid.updateDockVisibility();
    }

    renderFeedsGrid() {
        this.grid.renderFeedsGrid();
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
        this.card.updateFeedCard(id);
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

    // ── Podcast directory search ────────────────────────────────────────────

    async searchPodcastDirectory(query, targetContainer = null) {
        const q = query.trim();
        const container = targetContainer || this.elements.searchDirectoryResults;
        if (!container) return;
        if (!q) {
            container._dirSearch = null;
            container.innerHTML = '';
            return;
        }

        container._dirSearch = null;
        container.innerHTML = `<p style="color: var(--text-muted); padding: 0.5rem;">Searching directory...</p>`;

        try {
            const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=podcast&limit=200`;
            const res = await fetch(searchUrl);
            if (!res.ok) throw new Error('Search failed');

            const data = await res.json();
            const results = (data.results || []).filter(item => Boolean(item.feedUrl));
            container.innerHTML = '';

            if (results.length === 0) {
                container.innerHTML = `<p style="color: var(--text-muted); padding: 0.5rem;">No podcasts found matching your query.</p>`;
                return;
            }

            const listEl = document.createElement('div');
            listEl.className = 'dir-search-list';
            listEl.style.display = 'flex';
            listEl.style.flexDirection = 'column';
            listEl.style.gap = '0.5rem';
            container.appendChild(listEl);

            container._dirSearch = { results, renderedCount: 0, listEl };

            this.renderNextDirectoryBatch(container);

            if (!container._hasDirScroll) {
                container._hasDirScroll = true;
                container.addEventListener('scroll', () => {
                    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 70) {
                        this.renderNextDirectoryBatch(container);
                    }
                }, { passive: true });
            }
        } catch (e) {
            container.innerHTML = `<p style="color: #fca5a5; padding: 0.5rem;">Error searching directory: ${escapeHtml(e.message)}</p>`;
        }
    }

    renderNextDirectoryBatch(container) {
        const s = container._dirSearch;
        if (!s || s.renderedCount >= s.results.length) return;

        const nextBatch = s.results.slice(s.renderedCount, s.renderedCount + DIR_PAGE_SIZE);
        s.renderedCount += nextBatch.length;

        nextBatch.forEach(item => {
            const candidateId = this.state.feedUrlById[item.feedUrl];
            const isSubbed = candidateId && this.state.feeds.includes(candidateId);
            const relDate = item.releaseDate ? formatCompactDate(item.releaseDate) : '';

            const card = document.createElement('div');
            card.className = 'dir-search-card';
            card.style.cursor = 'pointer';

            card.innerHTML = `
        <img src="${item.artworkUrl100 || item.artworkUrl600}" alt="" class="dir-search-art" loading="lazy">
        <div class="dir-search-info">
          <div class="dir-search-title">${escapeHtml(item.collectionName || item.trackName)}</div>
          <div class="dir-search-artist">${escapeHtml(item.artistName || '')}</div>
          <div class="dir-search-tags">
            ${item.primaryGenreName ? `<span class="dir-tag-genre">${escapeHtml(item.primaryGenreName)}</span>` : ''}
            ${item.trackCount ? `<span class="dir-tag-meta">${item.trackCount} eps</span>` : ''}
            ${relDate ? `<span class="dir-tag-meta">• ${relDate}</span>` : ''}
          </div>
        </div>
        <button class="btn ${isSubbed ? 'btn-secondary' : 'btn-primary'} btn-sm btn-sub-dir" style="flex-shrink: 0;" ${isSubbed ? 'disabled' : ''}>
          ${isSubbed ? 'Subscribed' : '+ Add'}
        </button>
      `;

            card.addEventListener('click', () => {
                if (this.elements.addModal && !this.elements.addModal.classList.contains('hidden')) {
                    this.app.modal.closeAddModal();
                }
                if (!this.state.feedMetadata[item.feedUrl]) {
                    this.state.feedMetadata[item.feedUrl] = {
                        title: item.collectionName || item.trackName,
                        author: item.artistName || '',
                        artwork: item.artworkUrl600 || item.artworkUrl100
                    };
                }
                this.openFeedDetail(item.feedUrl);
            });

            if (!isSubbed) {
                const subBtn = card.querySelector('.btn-sub-dir');
                subBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.addFeed(item.feedUrl, item.collectionName || item.trackName, item.artworkUrl600 || item.artworkUrl100);
                    subBtn.textContent = 'Subscribed';
                    subBtn.classList.remove('btn-primary');
                    subBtn.classList.add('btn-secondary');
                    subBtn.disabled = true;
                });
            }

            s.listEl.appendChild(card);
        });
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
            const feedsTab = document.getElementById('tab-feeds');
            const feedsPanel = document.getElementById('panel-feeds');
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

    // ── OPML ────────────────────────────────────────────────────────────────

    importOpml(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const xmlText = e.target.result;
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlText, 'text/xml');
            const outlines = doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]');

            let addedCount = 0;
            for (const node of outlines) {
                const feedUrl = node.getAttribute('xmlUrl') || node.getAttribute('xmlurl');
                if (!feedUrl) continue;
                const existingId = this.state.feedUrlById[feedUrl];
                if (existingId && this.state.feeds.includes(existingId)) continue;

                const result = await this.app.sync.saveFeedToServer(feedUrl, node.getAttribute('text') || '');
                const id = result && result.id;
                if (id) {
                    this.state.feeds.push(id);
                    this.state.feedUrlById = { ...this.state.feedUrlById, [id]: feedUrl };
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                this.storage.saveFeeds(this.state.feeds);
                this.refreshAllFeeds();
                alert(`Successfully imported ${addedCount} podcast feeds!`);
            } else {
                alert('No new podcast feeds found in this OPML file.');
            }
        };
        reader.readAsText(file);
    }

    exportOpml() {
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Podany Export</title>\n  </head>\n  <body>\n`;

        this.state.feeds.forEach(id => {
            const meta = this.state.feedMetadata[id] || {};
            const url = this.state.feedUrlById[id] || '';
            const title = meta.title ? escapeHtml(meta.title) : 'Podcast';
            xml += `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${escapeHtml(url)}"/>\n`;
        });

        xml += `  </body>\n</opml>`;

        const blob = new Blob([xml], { type: 'text/xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'podany_subscriptions.opml';
        a.click();
    }

    // ── Feed detail ─────────────────────────────────────────────────────────

    openFeedDetail(target) {
        this.app.modal.navigateTo(null, target);
    }

    renderFeedDetail(target) {
        const isSubbed = this.state.feeds.includes(target);
        const meta = this.state.feedMetadata[target] || {};
        let episodes = isSubbed
            ? this.state.allEpisodes.filter(e => e.subscriptionId === target)
            : this.state.allEpisodes.filter(e => e.feedUrl === target);
        const header = this.elements.feedDetailHeader;
        if (!header) return;

        const totalCount = episodes.length;
        const q = (this.state.searchQuery || '').trim().toLowerCase();
        if (q) {
            episodes = episodes.filter(ep => {
                const title = (ep.title || '').toLowerCase();
                const desc = (ep.description || '').toLowerCase();
                return title.includes(q) || desc.includes(q);
            });
        }

        if (header.dataset.feedTarget !== target) {
            header.dataset.feedTarget = target;
            const prevView = this.state.navHistory[this.state.navHistory.length - 1];
            const backLabel = prevView?.feedTarget
                ? '← Back'
                : prevView?.tab
                    ? `← ${prevView.tab.charAt(0).toUpperCase() + prevView.tab.slice(1)}`
                    : '← Back';

            header.innerHTML = `
        <div class="feed-detail-top-nav">
          <button class="btn-back-nav" id="btn-feed-back">${escapeHtml(backLabel)}</button>
          <button class="btn ${isSubbed ? 'btn-secondary' : 'btn-primary'} btn-sm" id="btn-feed-action">
            ${isSubbed ? 'Unsubscribe' : '+ Follow Podcast'}
          </button>
        </div>
        <div class="feed-detail-main">
          <img class="feed-detail-art" src="${artworkUrl(meta.image, 'large')}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
          <div class="feed-detail-info">
            <div class="feed-detail-title">${escapeHtml(meta.title || 'Untitled Podcast')}</div>
            <div class="feed-detail-author">${escapeHtml(meta.author || '')}</div>
            ${meta.description ? `<div class="feed-detail-desc">${escapeHtml(meta.description)}</div>` : ''}
            <div class="feed-detail-links">
              ${meta.link ? `<a href="${escapeHtml(meta.link)}" target="_blank" rel="noopener noreferrer" class="feed-link-badge">Website</a>` : ''}
              <button class="feed-link-badge" id="btn-copy-rss" title="Copy RSS Feed URL">Copy RSS</button>
              <span class="feed-link-badge" id="feed-episodes-badge" style="cursor: default;">${q ? `${episodes.length} / ${totalCount} episodes` : `${totalCount} episodes`}</span>
            </div>
          </div>
        </div>
      `;

            header.querySelector('#btn-feed-back').addEventListener('click', () => {
                this.app.modal.navigateBack();
            });

            const actionBtn = header.querySelector('#btn-feed-action');
            if (actionBtn) {
                actionBtn.addEventListener('click', () => {
                    if (this.state.feeds.includes(target)) {
                        this.promptRemoveFeed(target);
                    } else {
                        this.addFeed(target, meta.title, meta.artwork);
                        actionBtn.textContent = 'Unsubscribe';
                        actionBtn.classList.remove('btn-primary');
                        actionBtn.classList.add('btn-secondary');
                    }
                });
            }

            header.querySelector('#btn-copy-rss').addEventListener('click', () => {
                const rssUrl = this.state.feedUrlById[target] || target;
                navigator.clipboard.writeText(rssUrl).then(() => {
                    const btn = header.querySelector('#btn-copy-rss');
                    if (btn) btn.textContent = 'Copied!';
                    setTimeout(() => {
                        if (btn) btn.textContent = 'Copy RSS';
                    }, 2000);
                });
            });
        } else {
            const badge = header.querySelector('#feed-episodes-badge');
            if (badge) {
                badge.textContent = q ? `${episodes.length} / ${totalCount} episodes` : `${totalCount} episodes`;
            }
            const actionBtn = header.querySelector('#btn-feed-action');
            if (actionBtn) {
                actionBtn.textContent = isSubbed ? 'Unsubscribe' : '+ Follow Podcast';
                actionBtn.className = `btn ${isSubbed ? 'btn-secondary' : 'btn-primary'} btn-sm`;
            }
        }

        const list = this.elements.feedDetailEpisodes;
        if (!list) return;
        list.innerHTML = '';

        if (totalCount === 0) {
            // Preview is the only remaining URL-based fetch and is allowed solely for
            // feeds the user has NOT subscribed to yet. Subscribed feeds are read by DB
            // id (loadFeedById) via refreshAllFeeds; here we fall back to fetching the
            // RSS source so the user can listen before following.
            if (!isSubbed && !this.previewLoadingSet.has(target)) {
                this.previewLoadingSet.add(target);
                list.innerHTML = `
          <div class="empty-state">
            <div class="spinner" style="margin: 0 auto 1.25rem auto; width: 32px; height: 32px; border: 3px solid var(--border-light); border-top-color: var(--text-primary); border-radius: 50%;"></div>
            <h3>Loading episodes preview...</h3>
            <p>Fetching episodes so you can listen before adding.</p>
          </div>
        `;
                this.fetchSingleFeed(target, this.state.allEpisodes, this.state.feedMetadata).then(res => {
                    this.previewLoadingSet.delete(target);
                    if (res) {
                        header.dataset.feedTarget = '';
                        this.renderFeedDetail(target);
                    } else {
                        list.innerHTML = `<div class="empty-state"><h3>Unable to load preview</h3><p>Could not fetch RSS feed for this podcast.</p></div>`;
                    }
                }).catch(() => {
                    this.previewLoadingSet.delete(target);
                    list.innerHTML = `<div class="empty-state"><h3>Unable to load preview</h3><p>Could not fetch RSS feed for this podcast.</p></div>`;
                });
                return;
            }
            list.innerHTML = `<div class="empty-state"><h3>No episodes found for this podcast</h3></div>`;
            return;
        }

        if (episodes.length === 0) {
            list.innerHTML = `<div class="empty-state"><h3>No matching episodes</h3><p>No episodes in this podcast match "${escapeHtml(this.state.searchQuery)}".</p></div>`;
            return;
        }

        const frag = document.createDocumentFragment();
        episodes.forEach(ep => {
            frag.appendChild(this.app.timeline.episodeCard.createEpisodeCard(ep));
        });
        list.appendChild(frag);
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

        const modalCatChips = document.querySelectorAll('#modal-category-chips .category-chip');
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
