// StatusComponent.js — Podany Status (Atomic / UI component)
// A transient status banner / toast for short-lived feedback (sync, add-feed,
// boot errors). Shows a message, auto-dismisses after a timeout, and is fully
// cleaned up in unmount(). See §2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';

export class StatusComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elBanner = null;
        this.elText = null;
        this._dismissId = null;
        this._visible = false;
    }

    render() {
        this.elBanner = this.createElement('div', { class: 'status-banner hidden' });
        this.elBanner.setAttribute('role', 'status');
        this.elBanner.setAttribute('aria-live', 'polite');
        this.elText = this.createElement('span', { class: 'status-banner__text' });
        this.elBanner.append(this.elText);
        return this.elBanner;
    }

    onMount() {
        if (this.app && this.app.modal) this.app.modal.register('status', this);
    }

    onUnmount() {
        this._clearDismiss();
        this._queue = [];
        super.unmount();
    }

    // ── Public API (driven by ModalService.showStatus / hideStatus) ───────────

    show(message, timeout = 3200) {
        if (!message) {
            this.hide();
            return;
        }
        this.elText.textContent = message;
        this.elBanner.classList.remove('hidden');
        this.elBanner.classList.remove('is-success', 'is-error');
        this._visible = true;
        this._clearDismiss();
        this._dismissId = this.setTimeout(() => this.hide(), Math.max(1500, timeout));
    }

    setStatusClass(kind) {
        if (!this.elBanner) return;
        this.elBanner.classList.remove('is-success', 'is-error');
        if (kind === 'success' || kind === 'error') {
            this.elBanner.classList.add(`is-${kind}`);
        }
    }

    hide() {
        this._clearDismiss();
        if (this.elBanner) this.elBanner.classList.add('hidden');
        this._visible = false;
    }

    _clearDismiss() {
        if (this._dismissId !== null) {
            clearTimeout(this._dismissId);
            this._dismissId = null;
        }
    }
}

export default StatusComponent;
