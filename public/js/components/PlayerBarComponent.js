// PlayerBarComponent.js — Podany PlayerBar (Layout Component)
// Persistent bottom layout component: the sole projector of playback. It owns the
// track-info (left), composes PlaybackControls (center transport + scrubber) and
// the right options (notes / queue / collapse). It projects app.state
// (currentEpisode, livePlayback, playerCollapsed, queue) and drives the engine via
// app.playback / app.timeline / app.router (DI). See
// FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §13.
//
// Live position/progress live in app.state.livePlayback (updated by PlaybackService
// on audio 'timeupdate' / YT poll); this component renders the live fill without any
// legacy playback.updateProgress call.

import { BaseComponent } from '../BaseComponent.js';
import PlaybackControls from './PlaybackControls.js';

const FALLBACK_ARTWORK = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22100%22%20height=%22100%22%3E%3Crect%20width=%22100%25%22%20height=%22100%25%22%20fill=%22%2318181b%22/%3E%3C/svg%3E';

export class PlayerBarComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.playback = app ? app.playback : null;
        this.elTrackInfo = null;
        this.elArtwork = null;
        this.elTitle = null;
        this.elPodcast = null;
        this.elRightOptions = null;
        this.elNotesBtn = null;
        this.elQueueBtn = null;
        this.elQueueBadge = null;
        this.elCollapseBtn = null;
        this.elExpandBtn = null;
        this.controls = null;
    }

    render() {
        const el = this.createElement('footer', { class: 'player-bar app-shell__player', 'aria-label': 'Player' });

        const track = this.createElement('div', { class: 'player-track-info' });
        const artwork = this.createElement('img');
        artwork.className = 'player-artwork';
        artwork.src = FALLBACK_ARTWORK;
        artwork.alt = 'Episode Artwork';
        const text = this.createElement('div', { class: 'track-text' });
        this.elTitle = this.createElement('div', { class: 'track-title', text: 'Select an episode to play' });
        this.elPodcast = this.createElement('div', { class: 'track-podcast', text: 'Podany' });
        this.elArtwork = artwork;
        text.append(this.elTitle, this.elPodcast);
        track.append(artwork, text);
        this.elTrackInfo = track;

        this.controls = new PlaybackControls(this.app);
        this.controls.mount(el);

        const options = this.createElement('div', { class: 'player-right-options' });
        this.elNotesBtn = this._iconButton('btn-icon btn-player-notes', 'Show Notes & Links',
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>');
        this.elQueueBtn = this._iconButton('btn-icon btn-open-queue', 'Up Next Queue',
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h7"/><path d="M18 15v6M15 18h6"/></svg>');
        this.elQueueBadge = this.createElement('span', { class: 'badge hidden' });
        this.elQueueBtn.append(this.elQueueBadge);
        this.elCollapseBtn = this._iconButton('btn-icon btn-collapse-player', 'Minimize Player',
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>');
        this.elExpandBtn = this._iconButton('btn-icon btn-expand-player', 'Expand Player',
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>');
        options.append(this.elNotesBtn, this.elQueueBtn, this.elCollapseBtn, this.elExpandBtn);

        el.append(track, this.controls.el, options);

        this.on(this.elCollapseBtn, 'click', () => this._setCollapsed(true));
        this.on(this.elExpandBtn, 'click', () => this._setCollapsed(false));
        this.on(this.elQueueBtn, 'click', () => this._openQueue());
        this.on(this.elNotesBtn, 'click', () => this._openNotes());
        this.on(this.elTrackInfo, 'click', () => this._openNotes());

        return el;
    }

    onMount() {
        // PlaybackControls is mounted during render() (see render()); its
        // subscriptions are already active here.
        this._unsubs.push(this.subscribe('currentEpisode', () => this._renderEpisode()));
        this._unsubs.push(this.subscribe('playerCollapsed', () => this._renderCollapsed()));
        this._unsubs.push(this.subscribe('queue', () => this._renderQueueBadge()));
        this._renderEpisode();
        this._renderCollapsed();
        this._renderQueueBadge();
    }

    unmount() {
        // Tear down the composed PlaybackControls child before this element detaches.
        if (this.controls && typeof this.controls.unmount === 'function') {
            this.controls.unmount();
        }
        super.unmount();
    }

    _iconButton(className, title, innerHtml) {
        const btn = this.createElement('button', { class: className, title: title });
        btn.innerHTML = innerHtml;
        return btn;
    }

    _setCollapsed(collapsed) {
        if (this.playback && typeof this.playback.setPlayerCollapsed === 'function') {
            this.playback.setPlayerCollapsed(collapsed);
        }
    }

    _openQueue() {
        if (this.app && this.app.router && typeof this.app.router.navigate === 'function') {
            this.app.router.navigate('/queue');
            return;
        }
        if (this.app && this.app.modal && typeof this.app.modal.openQueue === 'function') {
            this.app.modal.openQueue();
        }
    }

    _openNotes() {
        const tl = this.app && this.app.timeline;
        if (tl && typeof tl.openShowNotes === 'function') {
            tl.openShowNotes(this.state ? this.state.currentEpisode : null);
        }
    }

    _renderEpisode() {
        if (!this.elTitle) return;
        const episode = this.state ? this.state.currentEpisode : null;
        if (episode) {
            this.elTitle.textContent = episode.title || '';
            this.elPodcast.textContent = episode.podcastTitle || 'Podany';
            if (this.elArtwork && episode.image) this.elArtwork.src = episode.image;
            this.el.classList.remove('collapsed');
        } else {
            this.elTitle.textContent = 'Select an episode to play';
            this.elPodcast.textContent = 'Podany';
            if (this.elArtwork) this.elArtwork.src = FALLBACK_ARTWORK;
        }
        // The bar is interactive only while an episode is loaded.
        this.el.classList.toggle('active-episode', !!episode);
    }

    _renderCollapsed() {
        if (!this.el) return;
        const collapsed = this.state ? this.state.playerCollapsed === true : false;
        this.el.classList.toggle('collapsed', collapsed);
        if (this.elCollapseBtn) this.elCollapseBtn.classList.toggle('hidden', collapsed);
        if (this.elExpandBtn) this.elExpandBtn.classList.toggle('hidden', !collapsed);
    }

    _renderQueueBadge() {
        if (!this.elQueueBadge) return;
        const queue = this.state ? this.state.queue : [];
        const count = Array.isArray(queue) ? queue.length : 0;
        this.elQueueBadge.classList.toggle('hidden', count === 0);
    }
}

export default PlayerBarComponent;
