// PlaybackControls.js — Podany PlaybackControls (Atomic / UI component)
// The transport controls composed inside PlayerBarComponent: play/pause,
// prev/next, skip ±15s, skip-to-next, mark-as-listened, progress/seek scrubber,
// speed pill and sleep-timer button. It projects app.state (playbackStatus,
// livePlayback, playbackSpeed, sleepTimer) and drives the engine via
// app.playback (DI). See FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import { formatTime } from '../utils.js';

const SPEEDS = [1.0, 1.25, 1.5, 2.0, 0.8];

export class PlaybackControls extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.playback = app ? app.playback : null;
        this.elPlayBtn = null;
        this.elIconPlay = null;
        this.elIconPause = null;
        this.elIconSpinner = null;
        this.elPrev15 = null;
        this.elNext15 = null;
        this.elSkipNext = null;
        this.elMarkPlayed = null;
        this.elCurTime = null;
        this.elTotalTime = null;
        this.elSeek = null;
        this.elSpeed = null;
        this.elSpeedBadge = null;
        this.elSleepBtn = null;
        this.elSleepBadge = null;
    }

    render() {
        const el = this.createElement('div', { class: 'player-center-controls' });

        const controls = this.createElement('div', { class: 'control-buttons' });
        this.elPrev15 = this._iconButton('btn-icon btn-skip-back', 'Skip back 15s',
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 19l-9-7 9-7v14z"/><path d="M22 19l-9-7 9-7v14z"/></svg>');
        this.elSkipNext = this._iconButton('btn-icon btn-skip-forward', 'Skip to next episode',
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>');
        this.elPlayBtn = this.createElement('button', { class: 'btn-play-pause', 'aria-label': 'Play / Pause' });
        this.elIconPlay = this._polygonIcon('5 3 19 12 5 21 5 3');
        this.elIconPause = this._rectPairIcon();
        this.elIconPause.className += ' hidden';
        this.elIconSpinner = this._spinnerIcon();
        this.elIconSpinner.className += ' hidden spinner';
        this.elPlayBtn.append(this.elIconPlay, this.elIconPause, this.elIconSpinner);
        this.elNext15 = this._iconButton('btn-icon btn-skip-forward', 'Skip forward 15s',
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 19l9-7-9-7v14z"/><path d="M2 19l9-7-9-7v14z"/></svg>');
        this.elMarkPlayed = this._iconButton('btn-icon btn-player-mark-played', 'Mark as listened & play next',
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="16 9 11 14 8 11"/></svg>');
        controls.append(this.elPrev15, this.elSkipNext, this.elPlayBtn, this.elNext15, this.elMarkPlayed);

        const scrubber = this.createElement('div', { class: 'time-scrubber' });
        this.elCurTime = this.createElement('span', { class: 'time-label', text: '0:00' });
        this.elSeek = this.createElement('input', { class: 'seek-bar', type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Seek position' });
        this.elTotalTime = this.createElement('span', { class: 'time-label', text: '0:00' });
        scrubber.append(this.elCurTime, this.elSeek, this.elTotalTime);

        const extra = this.createElement('div', { class: 'control-extra' });
        this.elSpeed = this.createElement('button', { class: 'btn-pill btn-speed', title: 'Playback Speed' });
        this.elSpeedBadge = this.createElement('span', { class: 'badge hidden' });
        this.elSpeed.append(this.elSpeedBadge);
        this.elSleepBtn = this._iconButton('btn-icon btn-sleep', 'Sleep Timer',
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 15 15"/></svg>');
        this.elSleepBadge = this.createElement('span', { class: 'badge hidden' });
        this.elSleepBtn.append(this.elSleepBadge);
        extra.append(this.elSpeed, this.elSleepBtn);

        el.append(controls, scrubber, extra);

        this.on(this.elPlayBtn, 'click', () => this._toggle());
        this.on(this.elPrev15, 'click', () => this._skip(-15));
        this.on(this.elNext15, 'click', () => this._skip(15));
        this.on(this.elSkipNext, 'click', () => this._skipNext());
        this.on(this.elMarkPlayed, 'click', () => this._markPlayed());
        this.on(this.elSpeed, 'click', () => this._cycleSpeed());
        this.on(this.elSleepBtn, 'click', () => this._openSleep());
        this.on(this.elSeek, 'input', (e) => {
            const val = parseFloat(e.target.value) || 0;
            this.elSeek.style.setProperty('--seek-pct', `${val}%`);
            if (this.playback && typeof this.playback.seekToPct === 'function') this.playback.seekToPct(val);
        });

        return el;
    }

    onMount() {
        this._unsubs.push(this.subscribe('playbackStatus', () => this._renderStatus()));
        this._unsubs.push(this.subscribe('livePlayback', () => this._renderProgress()));
        this._unsubs.push(this.subscribe('playbackSpeed', () => this._renderSpeed()));
        this._unsubs.push(this.subscribe('sleepTimer', () => this._renderSleep()));
        this._renderStatus();
        this._renderProgress();
        this._renderSpeed();
        this._renderSleep();
    }

    _iconButton(className, title, innerHtml) {
        const btn = this.createElement('button', { class: className, title: title });
        btn.innerHTML = innerHtml;
        return btn;
    }

    _polygonIcon(points) {
        const svg = this.createElement('svg', { class: 'icon-play', width: '24', height: '24', viewBox: '0 0 24 24', fill: 'currentColor' });
        svg.setAttribute('d', `polygon points="${points}"`);
        return svg;
    }

    _rectPairIcon() {
        const svg = this.createElement('svg', { class: 'icon-pause', width: '24', height: '24', viewBox: '0 0 24 24', fill: 'currentColor' });
        svg.setAttribute('d', 'rect x="6" y="4" width="4" height="16" rect x="14" y="4" width="4" height="16"');
        return svg;
    }

    _spinnerIcon() {
        const svg = this.createElement('svg', { class: 'icon-spinner', width: '20', height: '20', viewBox: '0 0 24 24' });
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('d', '<circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>');
        return svg;
    }

    _toggle() {
        const pb = this.playback;
        const episode = this.state ? this.state.currentEpisode : null;
        if (pb && typeof pb.toggleEpisodePlayback === 'function' && episode) {
            pb.toggleEpisodePlayback(episode);
        } else if (pb && typeof pb.resumeCurrentEngine === 'function' && episode) {
            pb.resumeCurrentEngine();
        }
    }

    _skip(delta) {
        const pb = this.playback;
        if (pb && typeof pb.skipSeconds === 'function') {
            pb.skipSeconds(delta);
            return;
        }
        const audio = this.playback && this.playback.audio;
        if (audio && typeof audio.currentTime === 'number' && audio.seekable) {
            audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
        }
    }

    _skipNext() {
        const pb = this.playback;
        if (pb && typeof pb.playNextEpisode === 'function') {
            pb.playNextEpisode();
        }
    }

    _markPlayed() {
        const pb = this.playback;
        if (pb && typeof pb.skipToNextEpisode === 'function') {
            pb.skipToNextEpisode(true);
        }
    }

    _cycleSpeed() {
        const pb = this.playback;
        if (pb && typeof pb.cyclePlaybackSpeed === 'function') pb.cyclePlaybackSpeed();
    }

    _openSleep() {
        if (this.app && this.app.modal && typeof this.app.modal.openSleepTimer === 'function') {
            this.app.modal.openSleepTimer();
        }
    }

    _renderStatus() {
        if (!this.elPlayBtn) return;
        const status = this.state ? this.state.playbackStatus : 'idle';
        const playing = status === 'playing';
        const loading = status === 'loading';
        if (this.elIconPlay) this.elIconPlay.classList.toggle('hidden', !playing && !loading);
        if (this.elIconPause) this.elIconPause.classList.toggle('hidden', !playing);
        if (this.elIconSpinner) this.elIconSpinner.classList.toggle('hidden', !loading);
    }

    _renderProgress() {
        if (!this.elCurTime || !this.elTotalTime || !this.elSeek) return;
        const lp = this.state ? this.state.livePlayback : { currentTime: 0, duration: 0, progress: 0 };
        this.elCurTime.textContent = formatTime(lp.currentTime || 0);
        this.elTotalTime.textContent = formatTime(lp.duration || 0);
        const pct = lp.progress || 0;
        this.elSeek.style.setProperty('--seek-pct', `${pct}%`);
        if (document.activeElement !== this.elSeek) {
            this.elSeek.value = String(pct);
        }
    }

    _renderSpeed() {
        if (!this.elSpeed) return;
        const speed = this.state ? this.state.playbackSpeed : 1.0;
        this.elSpeed.textContent = `${speed}x`;
    }

    _renderSleep() {
        if (!this.elSleepBadge) return;
        const st = this.state ? this.state.sleepTimer : { active: false };
        this.elSleepBadge.classList.toggle('hidden', !st.active);
    }
}

export default PlaybackControls;
