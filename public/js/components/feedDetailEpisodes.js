// feedDetailEpisodes.js — Podany FeedDetailEpisodes
// Feed-detail episode list with search filter, and URL-based preview fetch for
// unsubscribed feeds.

import { escapeHtml } from '../utils.js';

export class FeedDetailEpisodesRenderer {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.previewLoadingSet = new Set();
        this.cards = new Map();
    }

    render(target, ctx) {
        const { isSubbed, totalCount, episodes } = ctx;
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
                this.app.feeds.fetchSingleFeed(target, this.state.allEpisodes, this.state.feedMetadata).then(res => {
                    this.previewLoadingSet.delete(target);
                    if (res) {
                        const header = this.elements.feedDetailHeader;
                        if (header) header.dataset.feedTarget = '';
                        this.app.feeds.renderFeedDetail(target);
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

        this.cards.clear();
        const frag = document.createDocumentFragment();
        episodes.forEach(ep => {
            const card = this.app.timeline.episodeCardRenderer.createEpisodeCard(ep);
            if (!ep.image) {
                const art = card.__els?.artwork;
                if (art) art.remove();
            }
            this.cards.set(String(ep.id), { el: card, els: card.__els });
            frag.appendChild(card);
        });
        list.appendChild(frag);
    }
}

export default FeedDetailEpisodesRenderer;
