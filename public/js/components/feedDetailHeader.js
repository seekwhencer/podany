// feedDetailHeader.js — Podany FeedDetailHeader
// Feed-detail header: artwork, metadata, follow/unsubscribe, copy RSS, and
// back navigation. Re-renders in place when the same feed is shown again.

import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../config.js';

export class FeedDetailHeader {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
    }

    render(target, ctx) {
        const { isSubbed, meta, totalCount, episodes } = ctx;
        const header = this.elements.feedDetailHeader;
        if (!header) return;

        const q = (this.state.searchQuery || '').trim().toLowerCase();

        if (header.dataset.feedTarget !== target) {
            header.dataset.feedTarget = target;
            this._buildHeader(header, target, isSubbed, meta, totalCount, episodes, q);
        } else {
            const els = header.__els;
            if (els && els.badge) {
                els.badge.textContent = q
                    ? `${episodes.length} / ${totalCount} episodes`
                    : `${totalCount} episodes`;
            }
            if (els && els.actionBtn) {
                els.actionBtn.textContent = isSubbed ? 'Unsubscribe' : '+ Follow Podcast';
                els.actionBtn.className = `btn ${isSubbed ? 'btn-secondary' : 'btn-primary'} btn-sm`;
            }
        }
    }

    _buildHeader(header, target, isSubbed, meta, totalCount, episodes, q) {
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

        const els = {};
        els.backBtn = header.querySelector('#btn-feed-back');
        els.actionBtn = header.querySelector('#btn-feed-action');
        els.copyRssBtn = header.querySelector('#btn-copy-rss');
        els.badge = header.querySelector('#feed-episodes-badge');

        if (els.backBtn) {
            els.backBtn.addEventListener('click', () => {
                this.app.modal.navigateBack();
            });
        }

        if (els.actionBtn) {
            els.actionBtn.addEventListener('click', () => {
                if (this.state.feeds.includes(target)) {
                    this.app.feeds.promptRemoveFeed(target);
                } else {
                    this.app.feeds.addFeed(target, meta.title, meta.artwork);
                    els.actionBtn.textContent = 'Unsubscribe';
                    els.actionBtn.classList.remove('btn-primary');
                    els.actionBtn.classList.add('btn-secondary');
                }
            });
        }

        if (els.copyRssBtn) {
            els.copyRssBtn.addEventListener('click', () => {
                const rssUrl = this.state.feedUrlById[target] || target;
                navigator.clipboard.writeText(rssUrl).then(() => {
                    els.copyRssBtn.textContent = 'Copied!';
                    setTimeout(() => {
                        els.copyRssBtn.textContent = 'Copy RSS';
                    }, 2000);
                });
            });
        }

        header.__els = els;
    }
}

export default FeedDetailHeader;
