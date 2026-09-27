// feedCard.js — Podany FeedCard
// Renders a single subscribed-feed card (artwork, description, recent-episode
// widget) and its unsubscribe/play interactions.

import { escapeHtml, formatDurationCompact } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../config.js';

export class FeedCard {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
    }

    renderFeedCard(id) {
        const meta = this.state.feedMetadata[id] || {};
        const url = this.state.feedUrlById[id] || '';
        const card = document.createElement('div');
        card.className = 'feed-card';
        card.dataset.feedId = id;

        const rawDesc = meta.description || '';
        const plainDesc = rawDesc.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

        const allForFeed = this.state.allEpisodes
            .filter(e => e.subscriptionId === id)
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const inProgressEps = allForFeed.filter(ep => {
            const pos = this.state.playbackPositions[ep.id];
            return pos && !pos.completed && pos.position > 2;
        });

        const unplayedEps = allForFeed.filter(ep => {
            const pos = this.state.playbackPositions[ep.id];
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
        if (this.state.downloadingFeeds.has(id)) {
            recentWidgetHtml = `
        <div class="feed-downloading-hint">
          <div class="spinner" style="margin: 0 auto 0.75rem auto; width: 28px; height: 28px; border: 3px solid var(--border-light); border-top-color: var(--text-primary); border-radius: 50%;"></div>
          <p class="feed-downloading-text">... downloading episodes</p>
        </div>
      `;
        } else if (feedEpisodes.length > 0) {
            recentWidgetHtml = `
        <div class="feed-recent-widget">
          <div class="feed-recent-header">${widgetHeader}</div>
          <div class="feed-recent-list">
            ${feedEpisodes.map(ep => {
                const isCurrent = this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid;
                const isEpPlaying = isCurrent && this.state.playbackStatus === 'playing';
                const pos = this.state.playbackPositions[ep.id];
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
        <img class="feed-art" src="${artworkUrl(meta.image, 'large')}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
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
            this.app.feeds.openFeedDetail(id);
        });

        card.querySelector('.btn-feed-unsubscribe')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.feeds.promptRemoveFeed(id);
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
