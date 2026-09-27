// feedDetail.js — Podany FeedDetail
// Feed-detail panel: header (artwork, metadata, follow/unsubscribe, copy RSS),
// episode list with search filter, and URL-based preview fetch for unsubscribed
// feeds.

import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../config.js';

export class FeedDetail {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.previewLoadingSet = new Set();
    }

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
                        this.app.feeds.promptRemoveFeed(target);
                    } else {
                        this.app.feeds.addFeed(target, meta.title, meta.artwork);
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
                this.app.feeds.fetchSingleFeed(target, this.state.allEpisodes, this.state.feedMetadata).then(res => {
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
}

export default FeedDetail;
