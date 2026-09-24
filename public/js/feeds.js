// feeds.js — Podany FeedsManager
// Feed fetching (new /api/feed/fetch endpoint), podcast directory search,
// feeds grid + feed detail, feed add/remove, and OPML import/export.

import { escapeHtml, formatCompactDate, formatDurationCompact } from './utils.js';
import { FALLBACK_ARTWORK, AUDIO_CACHE_NAME, DIR_PAGE_SIZE } from './config.js';

export class FeedsManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.config = app.config;
    this.api = app.api;
    this.storage = app.storage;
    this.feedsSearchDebounceTimer = null;
    this.previewLoadingSet = new Set();
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
    const isDetailActive = !!this.state.activeFeedDetailUrl;
    const hasFeeds = this.state.feeds && this.state.feeds.length > 0;

    if (isTimelineActive && !isDetailActive && hasFeeds) {
      this.elements.bottomActionDock.classList.remove('dock-hidden');
    } else {
      this.elements.bottomActionDock.classList.add('dock-hidden');
    }
  }

  // ── Fetching ────────────────────────────────────────────────────────────

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
      this.renderSkeletonTimeline();
    }

    this.app.modal.showStatus('Updating feeds...');
    const incomingEpisodes = [];
    const updatedMetadata = { ...this.state.feedMetadata };

    const fetchPromises = this.state.feeds.map(url => this.fetchSingleFeed(url, incomingEpisodes, updatedMetadata));
    await Promise.allSettled(fetchPromises);

    if (incomingEpisodes.length > 0) {
      const epMap = new Map();
      incomingEpisodes.forEach(ep => {
        if (ep && ep.guid) epMap.set(ep.guid, ep);
      });
      this.state.allEpisodes.forEach(ep => {
        if (ep && ep.guid && !epMap.has(ep.guid) && this.state.feeds.includes(ep.feedUrl)) {
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

  async fetchSingleFeed(url, incomingEpisodes, updatedMetadata) {
    try {
      const feedData = await this.api.fetchFeed(url);
      if (feedData && feedData.error) {
        if (!updatedMetadata[url]) {
          updatedMetadata[url] = {
            title: feedData.title || 'Unavailable Feed',
            artwork: '',
            episodesCount: 0,
            error: feedData.error
          };
        }
        return null;
      }

      updatedMetadata[url] = {
        title: feedData.title,
        artwork: feedData.artwork,
        episodesCount: feedData.episodesCount,
        description: feedData.description
      };

      if (Array.isArray(feedData.episodes)) {
        incomingEpisodes.push(...feedData.episodes);
      }

      return feedData;
    } catch (err) {
      if (!updatedMetadata[url]) {
        updatedMetadata[url] = {
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
      const isSubbed = this.state.feeds.includes(item.feedUrl);
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

  addFeed(url, title = '', artwork = '') {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;

    if (!this.state.feeds.includes(cleanUrl)) {
      this.state.feeds.push(cleanUrl);
      this.storage.saveFeeds(this.state.feeds);
      this.app.sync.saveFeedToServer(cleanUrl, title, artwork);
      this.refreshAllFeeds();
      if (this.elements.feedUrlInput && this.elements.feedUrlInput.value.trim() === cleanUrl) {
        this.elements.feedUrlInput.value = '';
      }
    } else {
      alert('This feed is already in your subscriptions.');
    }
  }

  promptRemoveFeed(url) {
    this.state.feedToDelete = url;
    const meta = this.state.feedMetadata[url] || {};
    const title = meta.title || 'this podcast';
    if (this.elements.confirmModalMsg) {
      this.elements.confirmModalMsg.textContent = `Do you want to unsubscribe from "${title}"?`;
    }
    if (this.elements.confirmModal) {
      this.elements.confirmModal.classList.remove('hidden');
    }
  }

  removeFeed(url) {
    if (this.state.activeFeedDetailUrl === url) {
      this.state.activeFeedDetailUrl = null;
      if (this.elements.panelFeedDetail) this.elements.panelFeedDetail.classList.remove('active');
      const feedsTab = document.getElementById('tab-feeds');
      const feedsPanel = document.getElementById('panel-feeds');
      this.elements.tabs.forEach(t => t.classList.remove('active'));
      this.elements.panels.forEach(p => p.classList.remove('active'));
      if (feedsTab) feedsTab.classList.add('active');
      if (feedsPanel) feedsPanel.classList.add('active');
    }

    const epsToRemove = this.state.allEpisodes.filter(ep => ep.feedUrl === url);
    const guidsToRemove = new Set(epsToRemove.map(ep => ep.guid));
    let downloadsChanged = false;
    for (const [guid, dl] of Object.entries(this.state.downloadedEpisodes)) {
      if (guidsToRemove.has(guid) || dl.feedUrl === url) {
        if ('caches' in window) {
          try {
            caches.open(AUDIO_CACHE_NAME).then(cache => cache.delete(dl.audioUrl)).catch(() => {});
          } catch (e) {}
        }
        delete this.state.downloadedEpisodes[guid];
        downloadsChanged = true;
      }
    }
    if (downloadsChanged) {
      this.app.downloads.saveDownloads();
    }

    this.state.allEpisodes = this.state.allEpisodes.filter(ep => ep.feedUrl !== url);
    this.state.feeds = this.state.feeds.filter(f => f !== url);
    delete this.state.feedMetadata[url];
    this.storage.saveFeeds(this.state.feeds);
    this.app.sync.removeFeedFromServer(url);
    this.app.timeline.processAndSortEpisodes();
    this.app.timeline.renderTimeline();
    this.renderFeedsGrid();
  }

  // ── OPML ────────────────────────────────────────────────────────────────

  importOpml(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const xmlText = e.target.result;
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const outlines = doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]');

      let addedCount = 0;
      outlines.forEach(node => {
        const feedUrl = node.getAttribute('xmlUrl') || node.getAttribute('xmlurl');
        if (feedUrl && !this.state.feeds.includes(feedUrl)) {
          this.state.feeds.push(feedUrl);
          this.app.sync.saveFeedToServer(feedUrl, node.getAttribute('text') || '');
          addedCount++;
        }
      });

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

    this.state.feeds.forEach(url => {
      const meta = this.state.feedMetadata[url] || {};
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

  // ── Feeds grid ──────────────────────────────────────────────────────────

  wireFeedsEmptyStateEvents() {
    const quickForm = document.getElementById('feeds-empty-quick-form');
    const quickInput = document.getElementById('feeds-empty-quick-input');
    const quickSubmit = document.getElementById('btn-feeds-empty-quick-submit');
    const quickResults = document.getElementById('feeds-empty-quick-results');

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
            this.searchPodcastDirectory(val, quickResults);
          }
        }, 350);
      });

      quickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = quickInput.value.trim();
        if (!val) return;
        if (val.startsWith('http://') || val.startsWith('https://')) {
          if (quickSubmit) quickSubmit.textContent = 'Adding...';
          this.addFeed(val);
          quickInput.value = '';
          if (quickResults) quickResults.innerHTML = '';
        } else {
          if (this.feedsSearchDebounceTimer) clearTimeout(this.feedsSearchDebounceTimer);
          if (quickResults) {
            this.searchPodcastDirectory(val, quickResults);
          }
        }
      });
    }

    document.getElementById('btn-feeds-empty-opml')?.addEventListener('click', () => {
      this.elements.opmlFileInput?.click();
    });

    const chips = this.elements.feedsGrid.querySelectorAll('.starter-suggestion-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const feedUrl = chip.dataset.feed;
        if (!feedUrl) return;
        const addSpan = chip.querySelector('.starter-chip-add');
        if (addSpan) addSpan.textContent = 'Adding...';
        this.addFeed(feedUrl);
      });
    });
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
      feedsToRender = this.state.feeds.filter(url => {
        const meta = this.state.feedMetadata[url] || {};
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

    feedsToRender.forEach(url => {
      const meta = this.state.feedMetadata[url] || {};
      const card = document.createElement('div');
      card.className = 'feed-card';

      const rawDesc = meta.description || '';
      const plainDesc = rawDesc.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

      const allForFeed = this.state.allEpisodes
        .filter(e => e.feedUrl === url)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const inProgressEps = allForFeed.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        return pos && !pos.completed && pos.position > 2;
      });

      const unplayedEps = allForFeed.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        const isProg = inProgressEps.some(p => p.guid === ep.guid);
        return !isProg && (!pos || (!pos.completed && (!pos.position || pos.position <= 2)));
      });

      let feedEpisodes = [...inProgressEps, ...unplayedEps].slice(0, 3);
      const hasUnplayed = feedEpisodes.length > 0;
      if (feedEpisodes.length < 3) {
        const existingGuids = new Set(feedEpisodes.map(e => e.guid));
        const remaining = allForFeed.filter(e => !existingGuids.has(e.guid)).slice(0, 3 - feedEpisodes.length);
        feedEpisodes.push(...remaining);
      }

      const widgetHeader = hasUnplayed
        ? (inProgressEps.length > 0 ? 'Continue & up next' : 'Up next (unplayed)')
        : 'Caught up • Latest';

      let recentWidgetHtml = '';
      if (feedEpisodes.length > 0) {
        recentWidgetHtml = `
          <div class="feed-recent-widget">
            <div class="feed-recent-header">${widgetHeader}</div>
            <div class="feed-recent-list">
              ${feedEpisodes.map(ep => {
                const isCurrent = this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid;
                const isEpPlaying = isCurrent && this.state.playbackStatus === 'playing';
                const pos = this.state.playbackPositions[ep.guid];
                const isCompleted = pos && (pos.completed === 1 || pos.completed === true);
                const isInProgress = pos && !isCompleted && pos.position > 2;
                let durStr = ep.duration ? formatDurationCompact(ep.duration) : '';
                return `
                  <div class="recent-ep-row ${isCurrent ? 'active' : ''} ${isCompleted ? 'is-played' : ''} ${isInProgress ? 'is-in-progress' : ''}" data-guid="${escapeHtml(ep.guid)}" title="${escapeHtml(ep.title)}">
                    <button class="btn-recent-play ${isEpPlaying ? 'is-playing' : ''}" data-guid="${escapeHtml(ep.guid)}" aria-label="Play ${escapeHtml(ep.title)}">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">${isEpPlaying ? '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>' : '<polygon points="5 3 19 12 5 21 5 3"></polygon>'}</svg>
                    </button>
                    <span class="recent-ep-title">${escapeHtml(ep.title)}</span>
                    ${durStr ? `<span class="recent-ep-duration">${durStr}</span>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="feed-header">
          <img class="feed-art" src="${meta.artwork || FALLBACK_ARTWORK}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
          <div class="feed-info">
            <h4>${escapeHtml(meta.title || url)}</h4>
            <p>${meta.error ? `<span style="color: #ef4444;">${escapeHtml(meta.error)}</span>` : `${meta.episodesCount || feedEpisodes.length} episodes`}</p>
          </div>
          <button class="btn-feed-unsubscribe" title="Remove podcast" aria-label="Remove podcast">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
        ${plainDesc ? `<p class="feed-card-desc">${escapeHtml(plainDesc)}</p>` : ''}
        ${recentWidgetHtml}
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-feed-unsubscribe') || e.target.closest('.recent-ep-row')) return;
        this.openFeedDetail(url);
      });

      card.querySelector('.btn-feed-unsubscribe')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.promptRemoveFeed(url);
      });

      card.querySelectorAll('.recent-ep-row').forEach(row => {
        const guid = row.dataset.guid;
        const ep = feedEpisodes.find(item => item.guid === guid);
        if (!ep) return;
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          this.app.playback.toggleEpisodePlayback(ep);
        });
      });

      grid.appendChild(card);
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
          <div class="starter-suggestions-grid">
            <div class="starter-suggestion-chip" data-feed="https://feeds.megaphone.fm/NATIONALAERONAUTICSANDSPACEADMINISTRATION8162188566"><span class="starter-chip-name">NASA's Curious Universe</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://feeds.simplecast.com/EmVW7VGp"><span class="starter-chip-name">Radiolab</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://www.deutschlandfunk.de/forschung-aktuell-102.xml"><span class="starter-chip-name">Forschung aktuell (DLF)</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://www.ndr.de/nachrichten/info/podcast4696.xml"><span class="starter-chip-name">ARD Klima-Update</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://feeds.simplecast.com/NM3_bR51"><span class="starter-chip-name">ZEIT WISSEN</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://podcasts.files.bbci.co.uk/w13xtvb6.rss"><span class="starter-chip-name">The Climate Question (BBC)</span><span class="starter-chip-add">+ Follow</span></div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Feed detail ─────────────────────────────────────────────────────────

  openFeedDetail(feedUrl) {
    this.app.modal.navigateTo(null, feedUrl);
  }

  renderFeedDetail(feedUrl) {
    const isSubbed = this.state.feeds.includes(feedUrl);
    const meta = this.state.feedMetadata[feedUrl] || {};
    let episodes = this.state.allEpisodes.filter(e => e.feedUrl === feedUrl);
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

    if (header.dataset.feedUrl !== feedUrl) {
      header.dataset.feedUrl = feedUrl;
      const prevView = this.state.navHistory[this.state.navHistory.length - 1];
      const backLabel = prevView?.feedUrl
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
          <img class="feed-detail-art" src="${meta.artwork || FALLBACK_ARTWORK}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
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
          if (this.state.feeds.includes(feedUrl)) {
            this.promptRemoveFeed(feedUrl);
          } else {
            this.addFeed(feedUrl, meta.title, meta.artwork);
            actionBtn.textContent = 'Unsubscribe';
            actionBtn.classList.remove('btn-primary');
            actionBtn.classList.add('btn-secondary');
          }
        });
      }

      header.querySelector('#btn-copy-rss').addEventListener('click', () => {
        navigator.clipboard.writeText(feedUrl).then(() => {
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
      if (!isSubbed && !this.previewLoadingSet.has(feedUrl)) {
        this.previewLoadingSet.add(feedUrl);
        list.innerHTML = `
          <div class="empty-state">
            <div class="spinner" style="margin: 0 auto 1.25rem auto; width: 32px; height: 32px; border: 3px solid var(--border-light); border-top-color: var(--text-primary); border-radius: 50%;"></div>
            <h3>Loading episodes preview...</h3>
            <p>Fetching episodes so you can listen before adding.</p>
          </div>
        `;
        this.fetchSingleFeed(feedUrl, this.state.allEpisodes, this.state.feedMetadata).then(res => {
          this.previewLoadingSet.delete(feedUrl);
          if (res) {
            header.dataset.feedUrl = '';
            this.renderFeedDetail(feedUrl);
          } else {
            list.innerHTML = `<div class="empty-state"><h3>Unable to load preview</h3><p>Could not fetch RSS feed for this podcast.</p></div>`;
          }
        }).catch(() => {
          this.previewLoadingSet.delete(feedUrl);
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
      frag.appendChild(this.app.timeline.createEpisodeCard(ep));
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
              if (!this.state.feeds.includes(feedUrl)) {
                this.state.feeds.push(feedUrl);
                await this.app.sync.saveFeedToServer(feedUrl, data.results[0].collectionName, data.results[0].artworkUrl600);
              }
            }
          } catch (e) {}
        }
        this.storage.saveFeeds(this.state.feeds);
        this.app.modal.hideStatus();
        this.refreshAllFeeds();
      });
    }
  }
}

export default FeedsManager;
