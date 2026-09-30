// FeedCardRecentComponent.js — Podany FeedCardRecent (Atomic / UI component)
// Builds the recent-episode section of a subscribed-feed card (continue / up
// next / caught-up ordering) and wires its play buttons. Emits play-requested
// upward via CustomEvent. Reads app.state via subscriptions for the active/
// playing highlight. See spec §2.D, §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import { formatDurationCompact } from '../utils.js';
import { CARD_ICONS } from '../Config.js';

export class FeedCardRecentComponent extends BaseComponent {
    constructor(app, { feedId } = {}) {
        super(app, { feedId: feedId ?? null });
        this.rows = new Map();   // guid -> { row, btn }
        this.el = null;
    }

    mount(parent) {
        if (this.el === null) this.el = this.render();
        // render() may leave this.el null (no recent episodes); skip attaching.
        if (this.el && parent && this.el.parentNode !== parent) parent.appendChild(this.el);
        this._mounted = true;
        this.onMount();
        return this.el;
    }

    collectEpisodes(id) {
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

        return { feedEpisodes, hasUnplayed, inProgressEps };
    }

    render() {
        const id = this.props.feedId;
        const collected = this.collectEpisodes(id);
        const { feedEpisodes, hasUnplayed, inProgressEps } = collected;

        if (this.state.downloadingFeeds.has(id)) {
            this.el = this._downloadingHint();
            return this.el;
        }

        if (feedEpisodes.length === 0) {
            this.el = null;
            return this.el;
        }

        const widgetHeader = hasUnplayed
            ? (inProgressEps.length > 0 ? 'Continue & up next' : 'Up next (unplayed)')
            : 'Caught up • Latest';

        const wrap = this.createElement('div', { class: 'feed-recent-section' });
        const header = this.createElement('div', { class: 'feed-recent-header', text: widgetHeader });
        wrap.appendChild(header);

        const list = this.createElement('div', { class: 'feed-recent-list' });
        feedEpisodes.forEach(ep => list.appendChild(this._buildRow(ep)));
        wrap.appendChild(list);

        this.el = wrap;
        return this.el;
    }

    _buildRow(ep) {
        const isCurrent = this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid;
        const isEpPlaying = isCurrent && this.state.playbackStatus === 'playing';

        const playBtn = this.createElement('button', { class: `btn-recent-play ${isEpPlaying ? 'is-playing' : ''}` });
        playBtn.dataset.guid = ep.guid;
        playBtn.setAttribute('aria-label', `Play ${ep.title}`);
        playBtn.innerHTML = isEpPlaying
            ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`
            : CARD_ICONS.PLAY;

        const titleSpan = this.createElement('span', { class: 'recent-ep-title', text: ep.title });

        const row = this.createElement('div', { class: 'recent-ep-row', title: ep.title });
        row.appendChild(playBtn);
        row.appendChild(titleSpan);

        if (ep.duration) {
            const durSpan = this.createElement('span', { class: 'recent-ep-duration', text: formatDurationCompact(ep.duration) });
            row.appendChild(durSpan);
        }

        this.on(playBtn, 'click', (e) => {
            e.stopPropagation();
            this.emit('play-requested', { episode: ep });
        });

        this.rows.set(ep.guid, { row, btn: playBtn });
        return row;
    }

    _downloadingHint() {
        const div = this.createElement('div', { class: 'feed-downloading-hint' });
        const spinner = this.createElement('div', { class: 'spinner' });
        spinner.style.cssText = 'margin: 0 auto 0.75rem auto; width: 28px; height: 28px; border: 3px solid var(--border-light); border-top-color: var(--text-primary); border-radius: 50%;';
        div.appendChild(spinner);
        const p = this.createElement('p', { class: 'feed-downloading-text', text: '... downloading episodes' });
        div.appendChild(p);
        const progress = this.createElement('div', { class: 'feed-downloading-progress' });
        div.appendChild(progress);
        return div;
    }

    onMount() {
        this.subscribe('currentEpisode', () => this._syncState());
        this.subscribe('playbackStatus', () => this._syncState());
        this._syncState();
    }

    // Highlight the active row and flip its play icon without a full re-render.
    _syncState() {
        if (!this._mounted) return;
        const cur = this.state.currentEpisode;
        for (const [guid, { row, btn }] of this.rows) {
            const isCurrent = cur && cur.guid === guid;
            row.classList.toggle('active', isCurrent);
            if (isCurrent && this.state.playbackStatus === 'playing') {
                btn.classList.add('is-playing');
                btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></svg>`;
            } else {
                btn.classList.remove('is-playing');
                btn.innerHTML = CARD_ICONS.PLAY;
            }
        }
    }
}

export default FeedCardRecentComponent;
