// SleepTimerComponent.js — Podany SleepTimer (Atomic / UI component)
// The sleep-timer modal: pick a duration (minutes, "end of episode", "end of
// queue"), toggle volume fade-out, and see a live countdown. Drives
// app.playback for start/stop. The countdown ticker is a self-cleared timer
// (§13.2) that stops when the timer is no longer active. See §2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';

export class SleepTimerComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elOverlay = null;
        this.elCountdown = null;
        this.elFadeout = null;
        this.elStatus = null;
        this._tickId = null;
        this._open = false;
    }

    render() {
        const overlay = this.createElement('div', { class: 'modal-overlay sleep-timer hidden' });
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Sleep timer');

        const card = this.createElement('div', { class: 'modal-card sleep-timer__card' });

        const header = this.createElement('div', { class: 'modal-header' });
        const title = this.createElement('h2', { class: 'sleep-timer__title', text: 'Sleep timer' });
        const close = this.createElement('button', { class: 'btn-close', 'aria-label': 'Close', text: '×' });
        header.append(title, close);

        this.elStatus = this.createElement('div', { class: 'sleep-timer__status help-text' });

        const grid = this.createElement('div', { class: 'timer-grid sleep-timer__grid' });
        const options = [
            { minutes: 5, label: '5 min' },
            { minutes: 15, label: '15 min' },
            { minutes: 30, label: '30 min' },
            { minutes: 45, label: '45 min' },
            { minutes: 60, label: '60 min' },
            { minutes: 90, label: '90 min' },
            { minutes: 'end', label: 'End of episode' },
            { minutes: 'end-queue', label: 'End of queue' }
        ];
        options.forEach(opt => {
            const btn = this.createElement('button', {
                type: 'button',
                class: 'timer-btn sleep-timer__btn',
                'data-minutes': String(opt.minutes),
                text: opt.label
            });
            this.on(btn, 'click', () => this._setTimer(opt.minutes));
            grid.append(btn);
        });

        this.elFadeout = this.createElement('input', { type: 'checkbox', class: 'sleep-timer__fadeout-input' });
        const fadeoutLabel = this.createElement('label', { class: 'fade-toggle sleep-timer__fadeout' });
        fadeoutLabel.append(this.elFadeout, this.createElement('span', { text: 'Fade out volume' }));

        this.elCountdown = this.createElement('div', { class: 'sleep-timer__countdown' });

        card.append(header, this.elStatus, grid, this.elCountdown, fadeoutLabel);
        overlay.append(card);

        this.elOverlay = overlay;

        this.on(close, 'click', () => this.close());
        this.on(overlay, 'click', (event) => {
            if (event.target === overlay) this.close();
        });

        return overlay;
    }

    onMount() {
        if (this.app && this.app.modal) this.app.modal.register('sleepTimer', this);
        this._unsubs.push(this.subscribe('sleepTimer', () => this._onSleepTimer()));
        this._onSleepTimer();
    }

    onUnmount() {
        this._clearTick();
        super.unmount();
    }

    // ── Open / close ─────────────────────────────────────────────────────────

    open() {
        this._syncFadeoutFromState();
        this._open = true;
        this.elOverlay.classList.remove('hidden');
        this._applyActiveButton();
        this.setTimeout(() => { if (this._mounted) this._focusFirst(); }, 0);
    }

    close() {
        this._open = false;
        this.elOverlay.classList.add('hidden');
        if (this.app && this.app.modal) this.app.modal.popModal(this);
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    _setTimer(minutes) {
        const pb = this.app && this.app.playback;
        if (pb && typeof pb.startSleepTimer === 'function') {
            pb.startSleepTimer(minutes);
        }
        this.close();
    }

    _stop() {
        const pb = this.app && this.app.playback;
        if (pb && typeof pb.stopSleepTimer === 'function') {
            pb.stopSleepTimer();
        }
    }

    _syncFadeoutFromState() {
        const fadeout = this.state && this.state.sleepTimer && this.state.sleepTimer.fadeout;
        if (this.elFadeout) this.elFadeout.checked = !!fadeout;
    }

    // ── Countdown ticker (§13.2, self-cleared) ───────────────────────────────

    _onSleepTimer() {
        this._syncFadeoutFromState();
        this._applyActiveButton();
        const active = !!(this.state && this.state.sleepTimer && this.state.sleepTimer.active);
        if (active && this._mounted) {
            this._tick();
        } else {
            this._clearTick();
            if (this.elStatus) {
                this.elStatus.textContent = this.state && this.state.sleepTimer && this.state.sleepTimer.minutes
                    ? 'Timer set — tap a duration to change it.'
                    : '';
            }
        }
    }

    _tick() {
        this._clearTick();
        const st = this.state ? this.state.sleepTimer : null;
        if (!st || !st.active || !st.endTime || !this._mounted) {
            this._renderCountdown(null);
            return;
        }
        const remaining = Math.max(0, Math.round((st.endTime - Date.now()) / 1000));
        this._renderCountdown(remaining);
        this._tickId = this.setTimeout(() => this._tick(), 1000);
    }

    _renderCountdown(seconds) {
        if (!this.elCountdown) return;
        if (seconds == null) {
            this.elCountdown.textContent = '';
            return;
        }
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        this.elCountdown.textContent = h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${m}:${String(s).padStart(2, '0')}`;
    }

    _clearTick() {
        if (this._tickId !== null) {
            clearTimeout(this._tickId);
            this._tickId = null;
        }
    }

    _applyActiveButton() {
        const st = this.state ? this.state.sleepTimer : null;
        const grid = this.elOverlay;
        if (!grid) return;
        const buttons = grid.querySelectorAll('.sleep-timer__btn');
        buttons.forEach(btn => {
            const val = btn.dataset.minutes;
            const isActive = st && st.active && this._buttonMatches(st, val);
            btn.classList.toggle('is-active', !!isActive);
        });
    }

    _buttonMatches(st, val) {
        if (val === 'end') return st.minutes === 'end';
        if (val === 'end-queue') return st.minutes === 'end-queue';
        return Number(st.minutes) === Number(val);
    }

    _focusFirst() {
        const first = this.elOverlay.querySelector('.sleep-timer__btn');
        if (first) first.focus();
    }
}

export default SleepTimerComponent;
