// FeedDetailView.js — Podany FeedDetailView (Feature Component)
// Main view for a single feed (/feed/:id). Composes the header (artwork, metadata,
// follow/unsubscribe, copy RSS, back) and the episode list (search filter + preview
// fetch for unsubscribed feeds). The :id may be a DB subscription id (subscribed) or
// an RSS URL (preview). See spec §4, §5, §10.

import { BaseComponent } from '../BaseComponent.js';
import FeedDetailHeaderComponent from './FeedDetailHeaderComponent.js';
import FeedDetailEpisodesComponent from './FeedDetailEpisodesComponent.js';

export class FeedDetailView extends BaseComponent {
    constructor(app, ctx = {}) {
        super(app, {});
        this.target = ctx && ctx.params ? ctx.params.id : null;
        this.header = null;
        this.episodes = null;
        this.elHeaderHost = null;
    }

    render() {
        this.el = this.createElement('div', { class: 'feed-detail-view' });
        this.elHeaderHost = this.createElement('div', { class: 'feed-detail-header-host' });
        this.el.appendChild(this.elHeaderHost);
        return this.el;
    }

    onMount() {
        this._build();

        this.subscribe('searchQuery', () => this._updateHeaderCtx());
        this.subscribe('allEpisodes', () => this._updateHeaderCtx());
        this.subscribe('feedMetadata', () => this._updateHeaderCtx());

        this.on(this.el, ['back-clicked', 'action-clicked'], (e) => {
            const detail = e.detail || {};
            if (e.type === 'back-clicked') this.app.router.navigate('/feeds');
            else if (e.type === 'action-clicked' && detail.target) {
                const target = detail.target;
                if (this.state.feeds.includes(target)) {
                    this.app.feeds.promptRemoveFeed(target);
                } else {
                    const meta = this.state.feedMetadata[target] || {};
                    this.app.feeds.addFeed(target, meta.title, meta.artwork);
                }
            }
        });
    }

    _build() {
        const data = this._compute();
        this.header = new FeedDetailHeaderComponent(this.app, { target: this.target });
        this.header.setCtx({ target: this.target, ...data });
        this.header.mount(this.elHeaderHost);

        this.episodes = new FeedDetailEpisodesComponent(this.app, { target: this.target });
        this.episodes.mount(this.el);
    }

    _compute() {
        const isSubbed = this.state.feeds.includes(this.target);
        const meta = this.state.feedMetadata[this.target] || {};
        const base = isSubbed
            ? this.state.allEpisodes.filter(e => e.subscriptionId === this.target)
            : this.state.allEpisodes.filter(e => e.feedUrl === this.target);
        const q = (this.state.searchQuery || '').trim().toLowerCase();
        const episodes = q
            ? base.filter(ep => (ep.title || '').toLowerCase().includes(q) || (ep.description || '').toLowerCase().includes(q))
            : base;
        return { isSubbed, meta, totalCount: base.length, episodes };
    }

    _updateHeaderCtx() {
        if (this.header) this.header.setCtx({ target: this.target, ...this._compute() });
    }

    unmount() {
        // Tear down the composed header + episodes children before the base
        // detaches, so their subscriptions/AbortController are resolved too (§13.2).
        if (this.header && typeof this.header.unmount === 'function') this.header.unmount();
        if (this.episodes && typeof this.episodes.unmount === 'function') this.episodes.unmount();
        super.unmount();
    }
}

export default FeedDetailView;
