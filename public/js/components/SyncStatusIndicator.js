// SyncStatusIndicator.js — Podany Sync status indicator (Atomic / UI)
// Reflects sync state. Reads app.state via a subscription to the 'sync.status'
// path (convention: services set state.sync = { status } and call
// state.notify('sync'); mirrors the 'playback.current' pattern). Also accepts an
// explicit `status` prop / setStatus() for direct control. Emits a minimal
// bubbling 'change' CustomEvent. Subscription is resolved in unmount() (§13.2).
// See §3.2, §7.3, §13.

import { BaseComponent } from '../BaseComponent.js';

const STATUSES = ['idle', 'syncing', 'synced', 'error'];

export class SyncStatusIndicator extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elDot = null;
        this.elLabel = null;
        this._status = 'idle';
    }

    render() {
        const { status = 'idle' } = this.props;
        this._status = STATUSES.includes(status) ? status : 'idle';

        const el = this.createElement('span', { class: 'sync-status-indicator' });
        this.elDot = this.createElement('span', { class: 'sync-status-indicator__dot' });
        this.elLabel = this.createElement('span', {
            class: 'sync-status-indicator__label',
            text: this._currentLabel()
        });
        el.append(this.elDot, this.elLabel);
        el.classList.add(`is-${this._status}`);

        return el;
    }

    onMount() {
        // Live updates once a service publishes sync.status and notifies (§7.3).
        this._unsubs.push(this.subscribe('sync.status', (next) => {
            const value = (next && next.status != null) ? next.status : next;
            if (value != null) this.setStatus(value);
        }));
        this._apply();
    }

    _currentLabel() {
        switch (this._status) {
            case 'syncing': return this.props.labelSyncing || 'Syncing…';
            case 'synced': return this.props.labelSynced || 'Synced';
            case 'error': return this.props.labelError || 'Sync error';
            default: return this.props.labelIdle || 'Idle';
        }
    }

    setStatus(status) {
        this._status = STATUSES.includes(status) ? status : 'idle';
        this.el.classList.toggle('is-idle', this._status === 'idle');
        this.el.classList.toggle('is-syncing', this._status === 'syncing');
        this.el.classList.toggle('is-synced', this._status === 'synced');
        this.el.classList.toggle('is-error', this._status === 'error');
        if (this.elDot) {
            this.elDot.classList.toggle('is-syncing', this._status === 'syncing');
            this.elDot.classList.toggle('is-synced', this._status === 'synced');
            this.elDot.classList.toggle('is-error', this._status === 'error');
        }
        this._apply();
        this.emit('change', { status: this._status });
    }

    _apply() {
        if (this.elLabel) this.elLabel.textContent = this._currentLabel();
    }

    update(newProps) {
        super.update(newProps);
        if (this.props.status != null) this.setStatus(this.props.status);
        if (this._mounted) this._apply();
    }
}

export default SyncStatusIndicator;
