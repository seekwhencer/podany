// OnlineOfflineBadge.js — Podany Online/Offline status indicator (Atomic / UI)
// Reflects connection status. Source of truth is navigator.onLine (optionally
// overridden by the `online` prop). Listens to window 'online'/'offline' events
// and emits a minimal bubbling 'change' CustomEvent. Listeners are cleaned in
// unmount() via the BaseComponent listener registry (§13.2). See §3.2, §13.

import { BaseComponent } from '../BaseComponent.js';

export class OnlineOfflineBadge extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elDot = null;
        this.elLabel = null;
        this._online = null;
    }

    render() {
        const { labelOnline = 'Online', labelOffline = 'Offline', showLabel = true } = this.props;

        const el = this.createElement('span', { class: 'online-offline-badge' });
        this.elDot = this.createElement('span', { class: 'online-offline-badge__dot' });
        this.elLabel = showLabel
            ? this.createElement('span', { class: 'online-offline-badge__label', text: labelOnline })
            : null;
        el.append(this.elDot, this.elLabel);

        return el;
    }

    onMount() {
        this._online = this.props.online != null
            ? !!this.props.online
            : (typeof navigator !== 'undefined' ? navigator.onLine : true);
        this._apply();
        // Reflect real connection changes; both are removed in unmount() (§13.2).
        this.on(window, 'online', () => this._setOnline(true));
        this.on(window, 'offline', () => this._setOnline(false));
    }

    _setOnline(online) {
        this._online = online;
        this._apply();
        this.emit('change', { online });
    }

    _apply() {
        const online = !!this._online;
        this.el.classList.toggle('is-online', online);
        this.el.classList.toggle('is-offline', !online);
        if (this.elDot) this.elDot.classList.toggle('is-online', online);
        if (this.elLabel) {
            this.elLabel.textContent = online
                ? (this.props.labelOnline || 'Online')
                : (this.props.labelOffline || 'Offline');
        }
    }

    update(newProps) {
        super.update(newProps);
        if (this.props.online != null) this._setOnline(!!this.props.online);
        if (this._mounted) this._apply();
    }
}

export default OnlineOfflineBadge;
