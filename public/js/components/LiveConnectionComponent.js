// LiveConnectionComponent.js — Podany LiveConnection (Atomic / UI component)
// Visualizes the live WebSocket connection status (connected / connecting /
// offline) and in-flight download progress. Driven entirely by app.state
// (liveStatus, downloadStatus) and drives the engine via app.live / app.sync
// (DI). See FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';

export class LiveConnectionComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.live = app ? app.live : null;
        this.elBadge = null;
        this.elLabel = null;
        this.elReconnect = null;
        this.elDisconnect = null;
        this.elDownloads = null;
    }

    render() {
        const el = this.createElement('div', { class: 'live-connection' });

        this.elBadge = this.createElement('span', { class: 'live-badge' });
        this.elLabel = this.createElement('span', { class: 'live-label', text: 'Offline' });
        const head = this.createElement('div', { class: 'live-head' });
        head.append(this.elBadge, this.elLabel);

        const actions = this.createElement('div', { class: 'live-actions' });
        this.elReconnect = this.createElement('button', { class: 'btn btn-secondary btn-sm', text: 'Reconnect' });
        this.elDisconnect = this.createElement('button', { class: 'btn btn-secondary btn-sm', text: 'Disconnect' });
        actions.append(this.elReconnect, this.elDisconnect);

        this.elDownloads = this.createElement('div', { class: 'live-downloads' });

        el.append(head, actions, this.elDownloads);

        this.on(this.elReconnect, 'click', () => this._reconnect());
        this.on(this.elDisconnect, 'click', () => this._disconnect());

        return el;
    }

    onMount() {
        this._unsubs.push(this.subscribe('liveStatus', () => this._renderStatus()));
        this._unsubs.push(this.subscribe('downloadStatus', () => this._renderDownloads()));
        this._renderStatus();
        this._renderDownloads();
    }

    _reconnect() {
        if (this.live && typeof this.live.forceReconnect === 'function') {
            this.live.forceReconnect();
        } else if (this.live && typeof this.live.connect === 'function') {
            this.live.connect();
        }
    }

    _disconnect() {
        if (this.live && typeof this.live.close === 'function') {
            this.live.close();
        }
    }

    _renderStatus() {
        if (!this.elBadge || !this.elLabel) return;
        const s = this.state ? this.state.liveStatus : { connected: false, connecting: false, failures: 0 };
        this.elBadge.className = 'live-badge';
        if (s.connected) {
            this.elBadge.classList.add('status-online');
            this.elLabel.textContent = 'Connected';
        } else if (s.connecting) {
            this.elBadge.classList.add('status-connecting');
            this.elLabel.textContent = 'Connecting…';
        } else {
            this.elBadge.classList.add('status-offline');
            this.elLabel.textContent = 'Offline';
        }
    }

    _renderDownloads() {
        if (!this.elDownloads) return;
        this.elDownloads.innerHTML = '';
        const downloads = this.state ? this.state.downloadStatus : {};
        const keys = Object.keys(downloads || {});
        if (keys.length === 0) return;

        keys.forEach(id => {
            const d = downloads[id] || {};
            if (d.status === 'completed') return;
            const row = this.createElement('div', { class: 'download-row' });
            const info = this.createElement('div', { class: 'download-info' });
            const title = this.createElement('div', { class: 'download-title', text: d.title || `Episode ${id}` });
            const pct = Math.min(100, Math.max(0, typeof d.progress === 'number' ? d.progress : 0));
            const meta = this.createElement('div', { class: 'download-meta', text: `${Math.round(pct)}%` });
            info.append(title, meta);
            const bar = this.createElement('div', { class: 'download-bar' });
            const fill = this.createElement('div', { class: 'download-fill' });
            fill.style.setProperty('--p', `${pct}%`);
            bar.append(fill);
            row.append(info, bar);
            this.elDownloads.appendChild(row);
        });
    }
}

export default LiveConnectionComponent;
