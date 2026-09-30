// timeline.js — Podany TimelineService
// Episode-card rendering, filtering/sorting, continue shelf, show notes, and
// progress-scrubbing interactivity.

import { parseDurationSeconds } from '../utils.js';

export class TimelineService {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.audio = app.dom.audio;
        this.config = app.config;
        this._lastShelfOrder = null;
    }

    openShowNotes(targetEp) {
        if (this.app && this.app.showNotes && typeof this.app.showNotes.openShowNotes === 'function') {
            this.app.showNotes.openShowNotes(targetEp);
        }
    }

    closeShowNotes() {
        if (this.app && this.app.showNotes && typeof this.app.showNotes.closeShowNotes === 'function') {
            this.app.showNotes.closeShowNotes();
        }
    }

    // ── Filtering & sorting ─────────────────────────────────────────────────

    processAndSortEpisodes() {
        let list = [...this.state.allEpisodes];

        if (this.state.searchQuery) {
            const q = this.state.searchQuery.toLowerCase();
            list = list.filter(ep =>
                ep.title.toLowerCase().includes(q) ||
                ep.podcastTitle.toLowerCase().includes(q) ||
                (ep.description && ep.description.toLowerCase().includes(q))
            );
        }

        const currentGuid = this.state.currentEpisode ? this.state.currentEpisode.guid : null;

        if (this.state.filterMode === 'continue') {
            list = list.filter(ep => {
                const pos = this.state.playbackPositions[ep.id];
                const isCurrent = currentGuid && ep.guid === currentGuid;
                return (!pos || !pos.completed) && (isCurrent || (pos && pos.position > 2));
            });
            this._pushCurrentToFront(list, currentGuid);
        } else if (this.state.filterMode === 'unplayed') {
            list = list.filter(ep => {
                const pos = this.state.playbackPositions[ep.id];
                const isCurrent = currentGuid && ep.guid === currentGuid;
                if (isCurrent) return false;
                return !pos || (!pos.completed && (!pos.position || pos.position <= 2));
            });
        } else if (this.state.filterMode === 'played') {
            list = list.filter(ep => {
                const pos = this.state.playbackPositions[ep.id];
                return pos && (pos.completed === 1 || pos.completed === true);
            });
        }

        if (this.state.filterMode === 'continue') {
            list.sort((a, b) => {
                const posA = this.state.playbackPositions[a.id];
                const posB = this.state.playbackPositions[b.id];
                const timeA = (posA && posA.lastListenedAt) || (a.timestamp ? a.timestamp / 1000 : 0);
                const timeB = (posB && posB.lastListenedAt) || (b.timestamp ? b.timestamp / 1000 : 0);
                return timeB - timeA;
            });
            this._pushCurrentToFront(list, currentGuid);
        } else if (this.state.sortOrder === 'newest') {
            list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } else if (this.state.sortOrder === 'oldest') {
            list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        } else if (this.state.sortOrder === 'title-asc') {
            list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        } else if (this.state.sortOrder === 'title-desc') {
            list.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        } else if (this.state.sortOrder === 'podcast-asc') {
            list.sort((a, b) => {
                const comp = (a.podcastTitle || '').localeCompare(b.podcastTitle || '');
                return comp !== 0 ? comp : (b.timestamp || 0) - (a.timestamp || 0);
            });
        } else if (this.state.sortOrder === 'duration-asc') {
            list.sort((a, b) => parseDurationSeconds(a.duration) - parseDurationSeconds(b.duration));
        } else if (this.state.sortOrder === 'duration-desc') {
            list.sort((a, b) => parseDurationSeconds(b.duration) - parseDurationSeconds(a.duration));
        }

        this.state.filteredEpisodes = list;
        this.state.timelinePage = 1;
        this.state.notify('filteredEpisodes');
        this.state.notify('timelinePage');
    }

    // ── Dock actions (pure logic, no DOM — R2) ──────────────────────────────

    setFilter(mode) {
        this.state.filterMode = mode;
        this.state.notify('filterMode');
        this.processAndSortEpisodes();
    }

    setSort(order) {
        this.state.sortOrder = order;
        this.state.notify('sortOrder');
        this.processAndSortEpisodes();
    }

    search(query) {
        this.state.searchQuery = query;
        this.state.notify('searchQuery');
        this.processAndSortEpisodes();
        if (this.app.feeds && typeof this.app.feeds.renderFeedsGrid === 'function') {
            this.app.feeds.renderFeedsGrid();
        }
        if (this.state.activeFeedDetailId && this.app.feeds && typeof this.app.feeds.renderFeedDetail === 'function') {
            this.app.feeds.renderFeedDetail(this.state.activeFeedDetailId);
        }
    }

    computeCounts() {
        const currentGuid = this.state.currentEpisode ? this.state.currentEpisode.guid : null;
        const inProgress = this.state.allEpisodes.filter(ep => {
            const pos = this.state.playbackPositions[ep.id];
            const isCurrent = currentGuid && ep.guid === currentGuid;
            return (!pos || !pos.completed) && (isCurrent || (pos && pos.position > 2));
        }).length;
        const played = this.state.allEpisodes.filter(ep => {
            const pos = this.state.playbackPositions[ep.id];
            return pos && (pos.completed === 1 || pos.completed === true);
        }).length;
        return { inProgress, played };
    }

    _pushCurrentToFront(list, currentGuid) {
        if (currentGuid) {
            const curIdx = list.findIndex(e => e.guid === currentGuid);
            if (curIdx > 0) {
                const cur = list.splice(curIdx, 1)[0];
                list.unshift(cur);
            }
        }
    }

    // Pure logic (no DOM): the episodes that can be continued. The shelf itself
    // is rendered by TimelineView via its AppState subscriptions (§7.3).
    computeContinueEpisodes() {
        const currentGuid = this.state.currentEpisode ? this.state.currentEpisode.guid : null;

        let inProgressEps = this.state.allEpisodes.filter(ep => {
            const pos = this.state.playbackPositions[ep.id];
            const isCurrent = currentGuid && ep.guid === currentGuid;
            return (!pos || !pos.completed) && (isCurrent || (pos && pos.position > 2));
        });

        inProgressEps.sort((a, b) => {
            const posA = this.state.playbackPositions[a.id];
            const posB = this.state.playbackPositions[b.id];
            const timeA = (posA && posA.lastListenedAt) || (a.timestamp ? a.timestamp / 1000 : 0);
            const timeB = (posB && posB.lastListenedAt) || (b.timestamp ? b.timestamp / 1000 : 0);
            return timeB - timeA;
        });

        this._pushCurrentToFront(inProgressEps, currentGuid);
        return inProgressEps;
    }

    // ── Continue shelf (pure logic only — DOM rendering lives in TimelineView) ─

    getContinueRowCapacity() {
        const w = window.innerWidth;
        if (w >= 1400) return 5;
        if (w >= 1150) return 4;
        if (w >= 880) return 3;
        return 2;
    }

    // Pure logic (no DOM). Kept for callers that react to a position change; the
    // visual shelf is driven by TimelineView's AppState subscriptions.
    refreshContinueShelfAfterPositionChange() {
        const inProgressEps = this.computeContinueEpisodes();
        const signature = inProgressEps.map(ep => ep.id).join('|');
        if (signature !== this._lastShelfOrder) {
            this._lastShelfOrder = signature;
        }
    }

    // ── Timeline rendering ──────────────────────────────────────────────────

    // The episode list is rendered by TimelineView (a BaseComponent that
    // subscribes to filteredEpisodes); this service is DOM-free. Retained as a
    // no-op for existing callers.
    renderTimeline() { }

    // ── Episode cards ───────────────────────────────────────────────────────

    toggleMarkPlayed(ep) {
        const current = this.state.playbackPositions[ep.id];
        const isCompleted = current && (current.completed === 1 || current.completed === true);
        if (isCompleted) {
            this.app.sync.savePlaybackPositionToServer(ep.id, 0, false);
        } else {
            this.app.sync.savePlaybackPositionToServer(ep.id, 0, true);
            if (this.app.queue.isEpisodeQueued(ep.id)) {
                this.app.queue.removeFromQueue(ep.id);
            }
        }
        // Project the new mark state onto every card (TimelineView shelf, feed
        // detail, ...) via the AppState subscription — no DOM access here.
        this.state.notify('playbackPositions');

        if (this.state.filterMode === 'unplayed' || this.state.filterMode === 'continue' || this.state.filterMode === 'played') {
            this.processAndSortEpisodes();
            this.renderTimeline();
        }
    }

    // ── Event wiring ────────────────────────────────────────────────────────

    // Show-notes wiring (player "Notes" button, track-info click, close button,
    // modal overlay) is owned by ShowNotesComponent (R5). This service is
    // DOM-free; the wiring is a no-op kept for backward compatibility.
    wireEvents() { }
}

export default TimelineService;
