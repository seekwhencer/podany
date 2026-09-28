// feedCardRecent.js — Podany FeedCardRecent
// Builds the recent-episode section of a subscribed-feed card (continue / up
// next / caught-up ordering) and wires its play buttons.

import { formatDurationCompact } from '../utils.js';

export class FeedCardRecent {
    constructor(app) {
        this.app = app;
        this.state = app.state;
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

    renderRecentSection(id, collected) {
        const { feedEpisodes, hasUnplayed, inProgressEps } = collected || this.collectEpisodes(id);

        if (this.state.downloadingFeeds.has(id)) {
            return this._downloadingHint();
        }

        if (feedEpisodes.length === 0) {
            return '';
        }

        const widgetHeader = hasUnplayed
            ? (inProgressEps.length > 0 ? 'Continue & up next' : 'Up next (unplayed)')
            : 'Caught up • Latest';

        const wrap = document.createElement('div');
        wrap.className = 'feed-recent-section';

        const header = document.createElement('div');
        header.className = 'feed-recent-header';
        header.textContent = widgetHeader;
        wrap.appendChild(header);

        const list = document.createElement('div');
        list.className = 'feed-recent-list';
        feedEpisodes.forEach(ep => list.appendChild(this._buildRow(ep)));
        wrap.appendChild(list);

        return wrap;
    }

    _buildRow(ep) {
        const isCurrent = this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid;
        const isEpPlaying = isCurrent && this.state.playbackStatus === 'playing';
        const pos = this.state.playbackPositions[ep.id];
        const isCompleted = pos && (pos.completed === 1 || pos.completed === true);
        const isInProgress = pos && !isCompleted && pos.position > 2;

        const row = document.createElement('div');
        row.className = `recent-ep-row ${isCurrent ? 'active' : ''} ${isCompleted ? 'is-played' : ''} ${isInProgress ? 'is-in-progress' : ''}`;
        row.dataset.guid = ep.guid;
        row.title = ep.title;

        const playBtn = document.createElement('button');
        playBtn.className = `btn-recent-play ${isEpPlaying ? 'is-playing' : ''}`;
        playBtn.dataset.guid = ep.guid;
        playBtn.setAttribute('aria-label', `Play ${ep.title}`);
        playBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">${isEpPlaying ? '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>' : '<polygon points="5 3 19 12 5 21 5 3"></polygon>'}</svg>`;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'recent-ep-title';
        titleSpan.textContent = ep.title;

        row.appendChild(playBtn);
        row.appendChild(titleSpan);

        if (ep.duration) {
            const durSpan = document.createElement('span');
            durSpan.className = 'recent-ep-duration';
            durSpan.textContent = formatDurationCompact(ep.duration);
            row.appendChild(durSpan);
        }

        row.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.playback.toggleEpisodePlayback(ep);
        });

        return row;
    }

    _downloadingHint() {
        const div = document.createElement('div');
        div.className = 'feed-downloading-hint';
        div.innerHTML = `
          <div class="spinner" style="margin: 0 auto 0.75rem auto; width: 28px; height: 28px; border: 3px solid var(--border-light); border-top-color: var(--text-primary); border-radius: 50%;"></div>
          <p class="feed-downloading-text">... downloading episodes</p>
        `;
        return div;
    }
}

export default FeedCardRecent;
