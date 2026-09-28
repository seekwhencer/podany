// podcastDirectory.js — Podany PodcastDirectory
// iTunes podcast directory search with lazy-paginated results and per-card
// follow/open interactions.

import { escapeHtml, formatCompactDate } from '../utils.js';
import { DIR_PAGE_SIZE } from '../config.js';

export class PodcastDirectory {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
    }

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
                this.app.feeds.openFeedDetail(item.feedUrl);
            });

            const els = {};
            if (!isSubbed) {
                els.subBtn = card.querySelector('.btn-sub-dir');
                if (els.subBtn) {
                    els.subBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.app.feeds.addFeed(item.feedUrl, item.collectionName || item.trackName, item.artworkUrl600 || item.artworkUrl100);
                        els.subBtn.textContent = 'Subscribed';
                        els.subBtn.classList.remove('btn-primary');
                        els.subBtn.classList.add('btn-secondary');
                        els.subBtn.disabled = true;
                    });
                }
            }

            card.__els = els;

            s.listEl.appendChild(card);
        });
    }
}

export default PodcastDirectory;
