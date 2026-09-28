// feedCard.js — Podany FeedCard
// Renders a single subscribed-feed card (artwork, description, recent-episode
// section) and its unsubscribe/play interactions.

import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../config.js';
import FeedCardRecent from './feedCardRecent.js';

export class FeedCard {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.recent = new FeedCardRecent(this.app);
    }

    renderFeedCard(id) {
        const meta = this.state.feedMetadata[id] || {};
        const url = this.state.feedUrlById[id] || '';
        const card = document.createElement('div');
        card.className = 'feed-card';
        card.dataset.feedId = id;

        const rawDesc = meta.description || '';
        const plainDesc = rawDesc.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

        const recentData = this.recent.collectEpisodes(id);

        card.innerHTML = `
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
        if (recentSection) card.appendChild(recentSection);

        card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-feed-unsubscribe') || e.target.closest('.recent-ep-row')) return;
            this.app.feeds.openFeedDetail(id);
        });

        const els = {};
        els.unsubBtn = card.querySelector('.btn-feed-unsubscribe');
        els.recentRows = Array.from(card.querySelectorAll('.recent-ep-row'));

        if (els.unsubBtn) {
            els.unsubBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.feeds.promptRemoveFeed(id);
            });
        }

        card.__els = els;

        return card;
    }

    updateFeedCard(id) {
        const grid = this.elements.feedsGrid;
        if (!grid) return;
        const existing = grid.querySelector(`[data-feed-id="${CSS.escape(String(id))}"]`);
        if (!existing) return;
        existing.replaceWith(this.renderFeedCard(id));
        this.app.feeds.grid.updateFeedCountUI();
    }
}

export default FeedCard;
