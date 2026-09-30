// FeedDetailEpisodesComponent.js — Podany FeedDetailEpisodes (Feature Component part)
// Episode list of a feed-detail view with search filter. Emits play/queue/mark/notes/
// feed actions via delegated events -> services. See spec §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import { escapeHtml } from '../utils.js';
import EpisodeCardComponent from './EpisodeCardComponent.js';

export class FeedDetailEpisodesComponent extends BaseComponent {
    constructor(app, { target }) {
        super(app, { target });
        this.target = target;
        this.cards = new Map();
    }

    render() {
        this.el = this.createElement('div', { class: 'feed-detail-episodes feeds-grid' });
        return this.el;
    }

    onMount() {
        this.subscribe('allEpisodes', () => this._render());
        this.subscribe('searchQuery', () => this._render());
        this.subscribe('feedMetadata', () => this._render());

        this.on(this.el, ['play-requested', 'resume-requested', 'seek-requested', 'queue-toggled', 'mark-played', 'open-notes', 'open-feed'], (e) => {
            const detail = e.detail || {};
            if (e.type === 'play-requested' && detail.episode) this.app.playback.toggleEpisodePlayback(detail.episode);
            else if (e.type === 'resume-requested' && detail.episode) this.app.playback.toggleEpisodePlayback(detail.episode);
            else if (e.type === 'seek-requested' && detail.episode) this.app.playback.playEpisode(detail.episode, detail.time || 0);
            else if (e.type === 'queue-toggled' && detail.episode) this.app.queue.toggleEpisodeQueue(detail.episode);
            else if (e.type === 'mark-played' && detail.episode) this.app.timeline.toggleMarkPlayed(detail.episode);
            else if (e.type === 'open-notes' && detail.episode) this.app.timeline.openShowNotes(detail.episode);
            else if (e.type === 'open-feed' && detail.feedId) this.app.router.navigate(`/feed/${detail.feedId}`);
        });

        this._render();
    }

    _compute() {
        const isSubbed = this.state.feeds.includes(this.target);
        const base = isSubbed
            ? this.state.allEpisodes.filter(e => e.subscriptionId === this.target)
            : this.state.allEpisodes.filter(e => e.feedUrl === this.target);
        const q = (this.state.searchQuery || '').trim().toLowerCase();
        const episodes = q
            ? base.filter(ep => (ep.title || '').toLowerCase().includes(q) || (ep.description || '').toLowerCase().includes(q))
            : base;
        return { isSubbed, totalCount: base.length, episodes };
    }

    async _render() {
        if (!this._mounted) return;
        this._clearCards();
        const { isSubbed, totalCount, episodes } = this._compute();

        if (totalCount === 0) {
            this.el.appendChild(this._stateBox('No episodes found for this podcast'));
            return;
        }

        if (episodes.length === 0) {
            this.el.appendChild(this._stateBox('No matching episodes', `No episodes in this podcast match "${escapeHtml(this.state.searchQuery)}".`));
            return;
        }

        episodes.forEach(ep => {
            const card = new EpisodeCardComponent(this.app, { episode: ep });
            card.mount(this.el);
            this.cards.set(String(ep.id), card);
        });
    }

    _clearCards() {
        for (const [id, card] of this.cards) {
            if (card && typeof card.unmount === 'function') card.unmount();
            this.cards.delete(id);
        }
    }

    _stateBox(title, msg = null) {
        const box = this.createElement('div', { class: 'empty-state' });
        const h3 = this.createElement('h3', { text: title });
        box.appendChild(h3);
        if (msg) {
            const p = this.createElement('p', { text: msg });
            box.appendChild(p);
        }
        return box;
    }

    unmount() {
        this._clearCards();
        super.unmount();
    }
}

export default FeedDetailEpisodesComponent;
