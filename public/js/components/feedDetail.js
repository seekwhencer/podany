// feedDetail.js — Podany FeedDetail
// Feed-detail panel orchestrator: composes the header (artwork, metadata,
// follow/unsubscribe, copy RSS) and the episode list (search filter + preview
// fetch for unsubscribed feeds).

import FeedDetailHeaderRenderer from './feedDetailHeader.js';
import FeedDetailEpisodesRenderer from './feedDetailEpisodes.js';

export class FeedDetail {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.header = new FeedDetailHeaderRenderer(app);
        this.episodes = new FeedDetailEpisodesRenderer(app);
    }

    openFeedDetail(target) {
        this.app.modal.navigateTo(null, target);
    }

    renderFeedDetail(target) {
        const isSubbed = this.state.feeds.includes(target);
        const meta = this.state.feedMetadata[target] || {};
        const baseEpisodes = isSubbed
            ? this.state.allEpisodes.filter(e => e.subscriptionId === target)
            : this.state.allEpisodes.filter(e => e.feedUrl === target);
        const q = (this.state.searchQuery || '').trim().toLowerCase();
        const episodes = q
            ? baseEpisodes.filter(ep => {
                const title = (ep.title || '').toLowerCase();
                const desc = (ep.description || '').toLowerCase();
                return title.includes(q) || desc.includes(q);
            })
            : baseEpisodes;

        this.header.render(target, { isSubbed, meta, totalCount: baseEpisodes.length, episodes });
        this.episodes.render(target, { isSubbed, meta, totalCount: baseEpisodes.length, episodes });
    }
}

export default FeedDetail;
