// feedCard.js — Podany FeedCard
// A single subscribed-feed card (Muster A: one stable instance owns this.el).
// Composes the recent-episode section via FeedCardRecentRenderer.

import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../config.js';
import FeedCardRecentRenderer from './feedCardRecent.js';

export class FeedCard {
    constructor(app, id = null) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.config = app.config;
        this.api = app.api;
        this.storage = app.storage;
        this.id = id;
        this.recent = new FeedCardRecentRenderer(this.app);

        if (id != null) {
            this.el = document.createElement('div');
            this.el.className = 'feed-card';
            this.el.dataset.feedId = id;

            this.el.addEventListener('click', (e) => {
                if (e.target.closest('.btn-feed-unsubscribe')) {
                    e.stopPropagation();
                    this.app.feeds.promptRemoveFeed(this.id);
                    return;
                }
                if (e.target.closest('.recent-ep-row')) return;
                this.app.feeds.openFeedDetail(this.id);
            });

            this._build();
        }
    }

    _build() {
        const id = this.id;
        const meta = this.state.feedMetadata[id] || {};
        const url = this.state.feedUrlById[id] || '';
        const plainDesc = (meta.description || '').replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
        const recentData = this.recent.collectEpisodes(id);

        this.el.innerHTML = `
      <div class="feed-header">
        <img class="feed-art" src="${artworkUrl(meta.image, 'large')}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
        <div class="feed-info">
          <h4>${escapeHtml(meta.title || url)}</h4>
          <p>${meta.error ? `<span style="color: #ef4444;">${escapeHtml(meta.error)}</span>` : `${meta.episodesCount || recentData.feedEpisodes.length} episodes`}</p>
        </div>
        <button class="btn-feed-unsubscribe" title="Remove podcast" aria-label="Remove podcast">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
      ${plainDesc ? `<p class="feed-card-desc">${escapeHtml(plainDesc)}</p>` : ''}
    `;

        const recentSection = this.recent.renderRecentSection(id, recentData);
        if (recentSection) this.el.appendChild(recentSection);

        this.el.__els = {
            unsubBtn: this.el.querySelector('.btn-feed-unsubscribe'),
            recentRows: Array.from(this.el.querySelectorAll('.recent-ep-row'))
        };
        this.recentRows = this.el.__els.recentRows;
    }

    update() {
        this._build();
    }

    destroy() {
        this.el?.remove();
    }
}

export default FeedCard;
