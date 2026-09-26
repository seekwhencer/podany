// downloads.js — Podany DownloadsManager
// Offline audio caching via the Cache API; episode/feed metadata lives in the
// in-memory AppState cache (state.allEpisodes / state.feedMetadata).
// Downloads fall back to the server audio-proxy on CORS failures.

import { escapeHtml, formatBytes } from './utils.js';
import { FALLBACK_ARTWORK, AUDIO_CACHE_NAME } from './config.js';

export class DownloadsManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.config = app.config;
    this.storage = app.storage;
    this.api = app.api;
  }

  async loadDownloads() {
    this.state.downloadedEpisodes = await this.storage.loadDownloads();
  }

  saveDownloads() {
    this.storage.saveDownloads(this.state.downloadedEpisodes);
  }

  formatBytes(bytes) {
    return formatBytes(bytes);
  }

  updateDownloadedCountUI() {
    const list = Object.values(this.state.downloadedEpisodes || {});
    const count = list.length;
    if (this.elements.downloadedCount) {
      this.elements.downloadedCount.textContent = count;
    }
    if (this.elements.downloadsTabCount) {
      this.elements.downloadsTabCount.textContent = count > 0 ? count : '';
    }
    if (this.elements.offlineStorageCount) {
      const totalBytes = list.reduce((sum, item) => sum + (item.size || 0), 0);
      this.elements.offlineStorageCount.textContent = `${count} ${count === 1 ? 'episode' : 'episodes'} (${this.formatBytes(totalBytes)})`;
    }
    this.renderOfflineStorageSettings();
  }

  renderOfflineStorageSettings() {
    if (!this.elements.offlineEpisodesList) return;
    this.purgeOrphanedDownloads();
    let list = Object.values(this.state.downloadedEpisodes || {});
    const q = (this.state.searchQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(item => {
        return (item.title || '').toLowerCase().includes(q) ||
          (item.podcastTitle || '').toLowerCase().includes(q);
      });
    }

    if (list.length === 0) {
      this.elements.offlineEpisodesList.innerHTML = q
        ? `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0;">No downloaded episodes match "${escapeHtml(this.state.searchQuery)}".</p>`
        : '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem 0;">No episodes downloaded for offline listening yet.</p>';
      return;
    }

    this.elements.offlineEpisodesList.innerHTML = list.map(item => `
      <div class="offline-ep-row" data-guid="${escapeHtml(item.guid)}">
        <div class="offline-ep-info">
          <div class="offline-ep-title">${escapeHtml(item.title || 'Untitled')}</div>
          <div class="offline-ep-sub">${escapeHtml(item.podcastTitle || '')} • ${this.formatBytes(item.size || 0)}</div>
        </div>
        <button class="btn-remove-download" data-guid="${escapeHtml(item.guid)}" title="Remove offline download">Remove</button>
      </div>
    `).join('');

    this.elements.offlineEpisodesList.querySelectorAll('.btn-remove-download').forEach(btn => {
      btn.addEventListener('click', () => {
        const guid = btn.dataset.guid;
        if (guid) this.removeDownloadedEpisode(guid);
      });
    });
  }

  async downloadEpisode(ep) {
    if (!ep || !ep.audioUrl) return;
    if (this.state.downloadingGuids.has(ep.guid)) return;

    this.state.downloadingGuids.add(ep.guid);
    this.updateEpisodeCardDownloadState(ep.guid);

    try {
      let response = null;
      try {
        response = await fetch(ep.audioUrl, { mode: 'cors' });
        if (!response.ok) response = null;
      } catch (e) {
        response = null;
      }

      if (!response) {
        const proxyUrl = this.api.audioProxyUrl(ep.audioUrl);
        response = await fetch(proxyUrl);
      }

      if (!response || !response.ok) {
        throw new Error('Unable to download audio stream');
      }

      const blob = await response.blob();
      const approxSize = blob.size || 0;

      if ('caches' in window) {
        const audioCache = await caches.open(AUDIO_CACHE_NAME);
        const headers = new Headers();
        headers.set('Content-Type', blob.type || 'audio/mpeg');
        headers.set('Content-Length', String(blob.size));
        headers.set('Accept-Ranges', 'bytes');
        const cacheResponse = new Response(blob, {
          status: 200,
          statusText: 'OK',
          headers: headers
        });
        await audioCache.put(ep.audioUrl, cacheResponse);
      }

      this.state.downloadedEpisodes[ep.guid] = {
        guid: ep.guid,
        feedUrl: ep.feedUrl,
        audioUrl: ep.audioUrl,
        title: ep.title,
        podcastTitle: ep.podcastTitle,
        artwork: ep.artwork,
        duration: ep.duration,
        timestamp: ep.timestamp,
        size: approxSize,
        downloadedAt: Date.now()
      };

      this.saveDownloads();
    } catch (err) {
      alert(`Download failed: ${err.message || 'Network error'}`);
    } finally {
      this.state.downloadingGuids.delete(ep.guid);
      this.updateEpisodeCardDownloadState(ep.guid);
      if (this.state.filterMode === 'downloaded') {
        this.app.timeline.processAndSortEpisodes();
        this.app.timeline.renderTimeline();
      }
    }
  }

  async removeDownloadedEpisode(guid) {
    const ep = this.state.downloadedEpisodes[guid];
    if (ep && 'caches' in window) {
      try {
        const audioCache = await caches.open(AUDIO_CACHE_NAME);
        await audioCache.delete(ep.audioUrl);
      } catch (e) {}
    }
    delete this.state.downloadedEpisodes[guid];
    this.saveDownloads();
    this.updateEpisodeCardDownloadState(guid);
    if (this.state.filterMode === 'downloaded') {
      this.app.timeline.processAndSortEpisodes();
      this.app.timeline.renderTimeline();
    }
  }

  async clearAllDownloads() {
    if ('caches' in window) {
      try {
        await caches.delete(AUDIO_CACHE_NAME);
      } catch (e) {}
    }
    this.state.downloadedEpisodes = {};
    this.saveDownloads();
    document.querySelectorAll('.btn-download-ep').forEach(btn => {
      btn.classList.remove('is-downloaded', 'is-downloading');
      btn.innerHTML = this.config.cardIcons.DOWNLOAD;
      btn.title = 'Download for offline';
    });
    if (this.state.filterMode === 'downloaded') {
      this.app.timeline.processAndSortEpisodes();
      this.app.timeline.renderTimeline();
    }
  }

  updateEpisodeCardDownloadState(guid) {
    const isDownloaded = !!this.state.downloadedEpisodes[guid];
    const isDownloading = this.state.downloadingGuids.has(guid);
    const cards = document.querySelectorAll(`.episode-card[data-guid="${guid}"]`);

    cards.forEach(card => {
      const btn = card.querySelector('.btn-download-ep');
      if (!btn) return;
      btn.classList.toggle('is-downloaded', isDownloaded);
      btn.classList.toggle('is-downloading', isDownloading);
      if (isDownloading) {
        btn.innerHTML = this.config.cardIcons.DOWNLOAD_SPINNER;
        btn.title = 'Downloading...';
      } else if (isDownloaded) {
        btn.innerHTML = this.config.cardIcons.DOWNLOADED;
        btn.title = 'Downloaded (Click to remove)';
      } else {
        btn.innerHTML = this.config.cardIcons.DOWNLOAD;
        btn.title = 'Download for offline';
      }
    });
  }

  wireEvents() {
    if (this.elements.btnClearDownloads) {
      this.elements.btnClearDownloads.addEventListener('click', () => {
        const count = Object.keys(this.state.downloadedEpisodes || {}).length;
        if (count === 0) return;
        if (confirm(`Remove all ${count} downloaded podcast episodes from this device?`)) {
          this.clearAllDownloads();
        }
      });
    }
  }

  purgeOrphanedDownloads() {
    if (!this.state.feeds || !this.state.downloadedEpisodes) return;
    const activeFeedSet = new Set(this.state.feeds);
    const activeGuidSet = new Set(this.state.allEpisodes.map(e => e.guid));
    let changed = false;
    for (const [guid, dl] of Object.entries(this.state.downloadedEpisodes)) {
      const isFeedMissing = dl.feedUrl && !activeFeedSet.has(dl.feedUrl);
      const isGuidMissing = this.state.allEpisodes.length > 0 && !activeGuidSet.has(guid);
      const isAllFeedsGone = this.state.feeds.length === 0;
      if (isAllFeedsGone || isFeedMissing || (!dl.feedUrl && isGuidMissing)) {
        if ('caches' in window) {
          try {
            caches.open(AUDIO_CACHE_NAME).then(cache => cache.delete(dl.audioUrl)).catch(() => {});
          } catch (e) {}
        }
        delete this.state.downloadedEpisodes[guid];
        changed = true;
      }
    }
    if (changed) {
      this.saveDownloads();
    }
  }
}

export default DownloadsManager;
