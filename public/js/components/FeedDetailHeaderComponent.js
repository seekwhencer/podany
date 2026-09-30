// FeedDetailHeaderComponent.js — Podany FeedDetailHeader (Feature Component part)
// Feed-detail header: artwork, metadata, follow/unsubscribe, copy RSS, and back
// navigation. Emits back-clicked / action-clicked / copy-rss upward. Re-renders in
// place when the same feed is shown again (badge count follows search). See spec
// §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../Config.js';

export class FeedDetailHeaderComponent extends BaseComponent {
    constructor(app, { target }) {
        super(app, { target });
        this.target = target;
        this.ctx = null;
        this._lastIsSubbed = undefined;
        this.elArtwork = null;
        this.elTitle = null;
        this.elAuthor = null;
        this.elDesc = null;
        this.elBadge = null;
        this.elActionBtn = null;
        this.elBackBtn = null;
        this.elCopyRss = null;
    }

    setCtx(ctx) {
        this.ctx = ctx;
        if (this._mounted) {
            const subbedChanged = this.ctx.isSubbed !== this._lastIsSubbed;
            this._lastIsSubbed = this.ctx.isSubbed;
            if (ctx && ctx.target !== this.target) this._refresh();
            else if (subbedChanged) this._refresh();
            else this._updateBadge();
        }
    }

    render() {
        const meta = this.ctx && this.ctx.meta ? this.ctx.meta : {};
        const totalCount = this.ctx && this.ctx.totalCount != null ? this.ctx.totalCount : 0;
        const isSubbed = this.ctx && this.ctx.isSubbed ? true : false;
        const q = (this.state.searchQuery || '').trim().toLowerCase();

        this.el = this.createElement('div', { class: 'feed-detail-header' });

        const backLabel = this._backLabel();
        this.elBackBtn = this.createElement('button', { class: 'btn-back-nav', text: escapeHtml(backLabel) });
        const actionBtn = this.createElement('button', { class: `btn ${isSubbed ? 'btn-secondary' : 'btn-primary'} btn-sm`, text: isSubbed ? 'Unsubscribe' : '+ Follow Podcast' });
        const topNav = this.createElement('div', { class: 'feed-detail-top-nav' });
        topNav.append(this.elBackBtn, actionBtn);
        this.el.appendChild(topNav);
        this.elActionBtn = actionBtn;

        const art = this.createElement('img', { class: 'feed-detail-art', src: artworkUrl(meta.image, 'large'), alt: '' });
        art.onerror = () => { art.onerror = null; art.src = FALLBACK_ARTWORK; };

        this.elTitle = this.createElement('div', { class: 'feed-detail-title', text: escapeHtml(meta.title || 'Untitled Podcast' + (isSubbed ? '' : ' (preview)')) });
        this.elAuthor = this.createElement('div', { class: 'feed-detail-author', text: escapeHtml(meta.author || '') });

        let descEl = null;
        if (meta.description) {
            descEl = this.createElement('div', { class: 'feed-detail-desc', text: escapeHtml(meta.description) });
        }

        const info = this.createElement('div', { class: 'feed-detail-info' });
        info.append(this.elTitle, this.elAuthor);
        if (descEl) info.appendChild(descEl);
        this.elDesc = descEl;

        const badgeText = q ? `${this.ctx && this.ctx.episodes ? this.ctx.episodes.length : totalCount} / ${totalCount} episodes` : `${totalCount} episodes`;
        this.elBadge = this.createElement('span', { class: 'feed-link-badge', style: 'cursor: default;', text: badgeText });

        const links = this.createElement('div', { class: 'feed-detail-links' });
        if (meta.link) {
            const site = this.createElement('a', { class: 'feed-link-badge', href: meta.link, target: '_blank', rel: 'noopener noreferrer', text: 'Website' });
            links.appendChild(site);
        }
        this.elCopyRss = this.createElement('button', { class: 'feed-link-badge', title: 'Copy RSS Feed URL', text: 'Copy RSS' });
        links.appendChild(this.elCopyRss);
        links.appendChild(this.elBadge);
        info.appendChild(links);

        const main = this.createElement('div', { class: 'feed-detail-main' });
        main.append(art, info);
        this.el.appendChild(main);
        this.elArtwork = art;

        return this.el;
    }

    onMount() {
        this.on(this.elBackBtn, 'click', (e) => { e.stopPropagation(); this.emit('back-clicked', {}); });
        this.on(this.elActionBtn, 'click', (e) => { e.stopPropagation(); this.emit('action-clicked', { target: this.target }); });
        this.on(this.elCopyRss, 'click', (e) => {
            e.stopPropagation();
            const rssUrl = this.state.feedUrlById[this.target] || this.target;
            const btn = this.elCopyRss;
            navigator.clipboard.writeText(rssUrl).then(() => {
                btn.textContent = 'Copied!';
                this.setTimeout(() => { if (this._mounted) btn.textContent = 'Copy RSS'; }, 2000);
            }).catch(() => { });
        });

        this.subscribe('searchQuery', () => this._updateBadge());
        this.subscribe('allEpisodes', () => this._updateBadge());
    }

    _refresh() {
        const existing = this.el;
        const newEl = this.render();
        if (existing && existing.parentNode) existing.parentNode.replaceChild(newEl, existing);
        this.on(this.elBackBtn, 'click', (e) => { e.stopPropagation(); this.emit('back-clicked', {}); });
        this.on(this.elActionBtn, 'click', (e) => { e.stopPropagation(); this.emit('action-clicked', { target: this.target }); });
        this.on(this.elCopyRss, 'click', (e) => {
            e.stopPropagation();
            const rssUrl = this.state.feedUrlById[this.target] || this.target;
            const btn = this.elCopyRss;
            navigator.clipboard.writeText(rssUrl).then(() => {
                btn.textContent = 'Copied!';
                this.setTimeout(() => { if (this._mounted) btn.textContent = 'Copy RSS'; }, 2000);
            }).catch(() => { });
        });
    }

    _updateBadge() {
        if (!this.elBadge || !this.ctx) return;
        const totalCount = this.ctx.totalCount;
        const q = (this.state.searchQuery || '').trim().toLowerCase();
        const shown = q && this.ctx.episodes ? this.ctx.episodes.length : totalCount;
        this.elBadge.textContent = q && this.ctx.episodes ? `${shown} / ${totalCount} episodes` : `${totalCount} episodes`;
    }

    _backLabel() {
        const prevView = this.state.navHistory[this.state.navHistory.length - 1];
        if (prevView && prevView.feedTarget) return '← Back';
        if (prevView && prevView.tab) return `← ${prevView.tab.charAt(0).toUpperCase() + prevView.tab.slice(1)}`;
        return '← Back';
    }
}

export default FeedDetailHeaderComponent;
