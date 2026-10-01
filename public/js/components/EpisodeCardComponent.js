// EpisodeCardComponent.js — Podany EpisodeCard (Atomic / UI component)
// Renders a single episode card (artwork, meta, progress track, play/queue/marked
// actions) and communicates user actions upward via bubbling CustomEvents. It
// never touches the global DOM registry or sibling trees; it only reads app.state (via
// subscriptions) and triggers services through emitted events. See spec §2.D, §7,
// §13. Behaviour mirrors the former EpisodeCardRenderer, with live scrubbing
// simplified to click-to-resume (Phase 5).

import { BaseComponent } from '../BaseComponent.js';
import {
    escapeHtml,
    formatTime,
    parseDurationSeconds,
    formatHumanRelativeDate,
    formatEpisodeDuration
} from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../Config.js';

export class EpisodeCardComponent extends BaseComponent {
    constructor(app, { episode }) {
        super(app, { episode });
        this.config = app ? app.config : null;
        this.episode = episode || null;
        this.elCard = null;
        this.elArtwork = null;
        this.elTitle = null;
        this.elDesc = null;
        this.elPodName = null;
        this.elPlayBtn = null;
        this.elQueueBtn = null;
        this.elMarkBtn = null;
        this.elProgressTrack = null;
        this.elFill = null;
        this.elResumeBadge = null;
        this.elMeta = null;
    }

    render() {
        const ep = this.episode;
        if (!ep) {
            this.el = this.createElement('div', { class: 'episode-card episode-card--empty' });
            return this.el;
        }

        const savedPos = this.state.playbackPositions[ep.id];
        const isCompleted = savedPos && (savedPos.completed === 1 || savedPos.completed === true);
        const hasProgress = this._hasProgress(savedPos);
        const curPos = this._currentPos(savedPos);
        const resumeTimeStr = hasProgress ? `Resumes at ${formatTime(curPos)}` : '';

        const dateInput = ep.timestamp || ep.pubDate;
        const humanDate = dateInput ? formatHumanRelativeDate(dateInput) : 'Unknown date';
        const fullDate = dateInput ? new Date(dateInput).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const humanTime = dateInput ? new Date(dateInput).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
        const formattedDuration = ep.duration ? formatEpisodeDuration(ep.duration) : '';

        this.elCard = this.createElement('div', {
            class: `episode-card ${this._isActive() ? 'playing' : ''} ${isCompleted ? 'is-played' : ''}`
        });
        this.elCard.dataset.id = ep.id ?? '';

        const artwork = this.createElement('img', {
            class: 'episode-artwork',
            src: artworkUrl(ep.image, 'thumb'),
            alt: ''
        });
        artwork.loading = 'lazy';
        artwork.onerror = () => { artwork.onerror = null; artwork.src = FALLBACK_ARTWORK; };

        const podName = this.createElement('div', { class: 'episode-podcast-name', text: ep.isYouTube ? 'YOUTUBE' : escapeHtml(ep.podcastTitle) });
        const title = this.createElement('div', { class: 'episode-title', text: escapeHtml(ep.title) });
        const headerInfo = this.createElement('div', { class: 'episode-header-info' });
        headerInfo.append(podName, title);

        const top = this.createElement('div', { class: 'episode-card-top' });
        top.append(artwork, headerInfo);
        this.elCard.appendChild(top);
        this.elArtwork = artwork;
        this.elPodName = podName;
        this.elTitle = title;

        if (ep.description) {
            const desc = this.createElement('div', { class: 'episode-desc' });
            desc.textContent = escapeHtml(ep.description);
            const link = this.createElement('span', { class: 'episode-desc-link', text: 'Notes & links →' });
            desc.appendChild(link);
            this.elCard.appendChild(desc);
            this.elDesc = desc;
        }

        if (hasProgress) {
            this._buildProgressTrack();
        }

        const playBtn = this._buildActionBtn('btn-play-ep', this._playIconKey(), this._playTitle());
        const markBtn = this._buildActionBtn('btn-mark-played', isCompleted ? this.config.cardIcons.CHECK_FILLED : this.config.cardIcons.CHECK, isCompleted ? 'Mark as Unplayed' : 'Mark as Played');
        if (isCompleted) markBtn.classList.add('is-completed');
        const queueBtn = this._buildActionBtn('btn-queue-ep', this.config.cardIcons.QUEUE, 'Add to Up Next');

        const actions = this.createElement('div', { class: 'episode-card-actions' });
        actions.append(playBtn, markBtn, queueBtn);

        const metaSpans = [
            this.createElement('span', { class: 'date-line', style: 'display:block;', title: escapeHtml(fullDate), text: escapeHtml(humanDate) }),
            this.createElement('span', { class: 'time-line', style: 'display:block;', text: escapeHtml(humanTime) })
        ];
        if (formattedDuration) metaSpans.push(this.createElement('span', { text: escapeHtml(formattedDuration) }));
        if (resumeTimeStr) {
            const resume = this.createElement('span', { class: 'ep-resume-time', title: 'Click to resume playback', text: resumeTimeStr });
            metaSpans.push(resume);
            this.elResumeBadge = resume;
        }
        const meta = this.createElement('div', { class: 'episode-meta' });
        metaSpans.forEach(s => meta.appendChild(s));
        this.elMeta = meta;

        const footer = this.createElement('div', { class: 'episode-footer' });
        footer.append(actions, meta);
        this.elCard.appendChild(footer);

        this.elPlayBtn = playBtn;
        this.elQueueBtn = queueBtn;
        this.elMarkBtn = markBtn;

        return this.elCard;
    }

    _buildActionBtn(className, innerHtml, title) {
        const btn = this.createElement('button', { class: className });
        btn.innerHTML = innerHtml;
        btn.title = title;
        return btn;
    }

    onMount() {
        if (!this.elCard) return;
        this.on(this.elPlayBtn, 'click', (e) => { e.stopPropagation(); this.emit('play-requested', { episode: this.episode }); });
        this.on(this.elQueueBtn, 'click', (e) => { e.stopPropagation(); this.emit('queue-toggled', { episode: this.episode }); });
        this.on(this.elMarkBtn, 'click', (e) => { e.stopPropagation(); this.emit('mark-played', { episode: this.episode }); });
        this.on(this.elResumeBadge, 'click', (e) => { e.stopPropagation(); this.emit('resume-requested', { episode: this.episode }); });
        if (this.elDesc) this.on(this.elDesc, 'click', (e) => { e.stopPropagation(); this.emit('open-notes', { episode: this.episode }); });
        if (this.elTitle) this.on(this.elTitle, 'click', (e) => { e.stopPropagation(); this.emit('open-notes', { episode: this.episode }); });
        if (this.elPodName) this.on(this.elPodName, 'click', (e) => { e.stopPropagation(); this.emit('open-feed', { feedId: this.episode.subscriptionId || this.episode.feedUrl }); });
        if (this.elProgressTrack) {
            this.on(this.elProgressTrack, 'click', (e) => {
                e.stopPropagation();
                const rect = this.elProgressTrack.getBoundingClientRect();
                if (rect.width <= 0) return;
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const time = ratio * this._durationSeconds(this.episode);
                this.emit('seek-requested', { episode: this.episode, time: Math.round(time * 10) / 10 });
            });
        }

        this.subscribe('currentEpisode', () => this._syncState());
        this.subscribe('playbackStatus', () => this._syncState());
        this.subscribe('queue', () => this._syncState());
        this.subscribe('playbackPositions', () => this._syncState());
        this.subscribe('livePlayback', () => this._syncState());
        this._syncState();
    }

    _isActive() {
        return !!(this.state.currentEpisode && this.state.currentEpisode.guid === this.episode.guid);
    }

    _isPlaying() {
        return this._isActive() && this.state.playbackStatus === 'playing';
    }

    _isLoading() {
        return this._isActive() && this.state.playbackStatus === 'loading';
    }

    _hasProgress(savedPos) {
        if (this._isActive() && !savedPos) return true;
        return !!(savedPos && savedPos.position > 2);
    }

    _currentPos(savedPos) {
        return (savedPos && savedPos.position) || 0;
    }

    _durationSeconds(ep) {
        if (ep.duration) return parseDurationSeconds(ep.duration);
        return 0;
    }

    _buildProgressTrack() {
        if (this.elProgressTrack) return this.elProgressTrack;

        const ep = this.episode;
        const savedPos = this.state.playbackPositions[ep.id];
        const pos = this._currentPos(savedPos);
        const durSec = this._durationSeconds(ep);
        let progressPct = 0;
        if (durSec > 0) progressPct = Math.min(100, Math.max(1, Math.round((pos / durSec) * 100)));
        else progressPct = 5;

        const fill = this.createElement('div', { class: 'ep-progress-fill' });
        fill.style.width = `${progressPct}%`;
        const track = this.createElement('div', { class: 'ep-progress-track', title: 'Click or scrub to resume at any point' });
        track.appendChild(fill);

        const footer = this.elCard.querySelector('.episode-footer');
        if (footer) {
            this.elCard.insertBefore(track, footer);
        } else {
            this.elCard.appendChild(track);
        }

        this.elProgressTrack = track;
        this.elFill = fill;
        return track;
    }

    _buildResumeBadge() {
        const badge = this.createElement('span', { class: 'ep-resume-time', title: 'Click to resume playback' });
        if (this.elMeta) this.elMeta.appendChild(badge);
        this.elResumeBadge = badge;
    }

    _syncProgress() {
        const ep = this.episode;
        if (!ep) return;

        const isActive = this._isActive();
        const live = this.state.livePlayback || { currentTime: 0, progress: 0 };
        const savedPos = this.state.playbackPositions[ep.id];

        let pos = 0;
        if (isActive) {
            pos = live.currentTime || 0;
        } else if (savedPos) {
            pos = savedPos.position || 0;
        }

        const hasProgress = isActive || pos > 2;
        if (!hasProgress) {
            if (this.elProgressTrack) {
                this.elProgressTrack.remove();
                this.elProgressTrack = null;
                this.elFill = null;
            }
            return;
        }

        if (!this.elProgressTrack) {
            this._buildProgressTrack();
        }

        if (this.elFill) {
            const durSec = this._durationSeconds(ep);
            let pct = 0;
            if (durSec > 0) pct = Math.min(100, Math.max(1, Math.round((pos / durSec) * 100)));
            else pct = live.progress || 5;
            this.elFill.style.width = `${pct}%`;
        }
    }

    _playIconKey() {
        if (this._isLoading()) return this.config.cardIcons.SPINNER;
        if (this._isPlaying()) return this.config.cardIcons.PAUSE;
        return this.config.cardIcons.PLAY;
    }

    _playTitle() {
        if (this._isLoading()) return 'Loading...';
        if (this._isPlaying()) return 'Pause';
        return 'Play';
    }

    // Update this card's live state (play icon, playing class, queue/mark modifiers)
    // without a full re-render. Called from subscriptions (§7.3).
    _syncState() {
        if (!this._mounted || !this.elCard) return;

        this.elCard.classList.toggle('playing', this._isActive());

        this._syncProgress();

        if (!this.elResumeBadge && this._isActive()) {
            this._buildResumeBadge();
        }

        if (this.elResumeBadge) {
            const ep = this.episode;
            const savedPos = this.state.playbackPositions[ep.id];
            const isActive = this._isActive();
            const pos = isActive ? (this.state.livePlayback?.currentTime || 0) : (savedPos?.position || 0);
            if (isActive || pos > 2) {
                this.elResumeBadge.textContent = `Resumes at ${formatTime(pos)}`;
            }
        }

        if (this.elPlayBtn) {
            this.elPlayBtn.innerHTML = this._playIconKey();
            this.elPlayBtn.title = this._playTitle();
        }

        if (this.elQueueBtn) {
            const queued = this.app.queue.isEpisodeQueued(this.episode.id);
            this.elQueueBtn.classList.toggle('is-queued', queued);
            this.elQueueBtn.innerHTML = queued ? this.config.cardIcons.QUEUE_ADDED : this.config.cardIcons.QUEUE;
            this.elQueueBtn.title = queued ? 'Remove from Up Next' : 'Add to Up Next';
        }

        if (this.elMarkBtn) {
            const savedPos = this.state.playbackPositions[this.episode.id];
            const completed = savedPos && (savedPos.completed === 1 || savedPos.completed === true);
            this.elMarkBtn.classList.toggle('is-completed', completed);
            this.elMarkBtn.innerHTML = completed ? this.config.cardIcons.CHECK_FILLED : this.config.cardIcons.CHECK;
            this.elMarkBtn.title = completed ? 'Mark as Unplayed' : 'Mark as Played';
        }
    }

    unmount() {
        super.unmount();
    }
}

export default EpisodeCardComponent;
