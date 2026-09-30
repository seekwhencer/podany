// ModalComponent.js — Podany Modal (Atomic / UI component)
// Pure overlay: shows/hides a modal overlay and emits events ('close',
// 'confirm', 'cancel'). All navigation logic has been removed (FRONTEND_REFACTORING_COMPONENTS.md
// §5 / §2.4) — this component only coordinates the overlay and reports user
// choices upward via bubbling CustomEvents. It does not touch the router or the
// browser history.
//
// In Phase 2 it is instantiated on `app` but not mounted; the legacy
// ModalService still drives the static modals. Phase 4/5 mounts this overlay and
// routes its events to the services.

import { BaseComponent } from '../BaseComponent.js';

export class ModalComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elOverlay = null;
        this.elTitle = null;
        this.elMessage = null;
        this.elCancel = null;
        this.elConfirm = null;
        this._open = false;
    }

    render() {
        const overlay = this.createElement('div', { class: 'modal-overlay' });
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const card = this.createElement('div', { class: 'modal-card' });

        const header = this.createElement('div', { class: 'modal-header' });
        this.elTitle = this.createElement('h2', { class: 'modal-title' });
        const close = this.createElement('button', { class: 'btn-close', text: '×' });
        close.setAttribute('aria-label', 'Close');
        header.append(this.elTitle, close);

        const body = this.createElement('div', { class: 'modal-body' });
        this.elMessage = this.createElement('p', { class: 'modal-msg' });
        body.append(this.elMessage);

        const footer = this.createElement('div', { class: 'modal-footer' });
        this.elCancel = this.createElement('button', { class: 'btn btn-secondary', text: 'Cancel' });
        this.elConfirm = this.createElement('button', { class: 'btn btn-primary', text: 'Confirm' });
        footer.append(this.elCancel, this.elConfirm);

        card.append(header, body, footer);
        overlay.append(card);

        this.elOverlay = overlay;

        this.on(close, 'click', () => this._emit('close'));
        this.on(this.elCancel, 'click', () => this._emit('close'));
        this.on(this.elConfirm, 'click', () => this._emit('confirm'));
        this.on(overlay, 'click', (event) => {
            if (event.target === overlay) this._emit('close');
        });

        return overlay;
    }

    // ── Overlay control (no navigation) ──────────────────────────────────────

    show({ title, message, confirmLabel, cancelLabel } = {}) {
        if (this.elTitle && title != null) this.elTitle.textContent = title;
        if (this.elMessage && message != null) this.elMessage.textContent = message;
        if (this.elConfirm && confirmLabel != null) this.elConfirm.textContent = confirmLabel;
        if (this.elCancel && cancelLabel != null) this.elCancel.textContent = cancelLabel;
        this.elOverlay.classList.remove('hidden');
        this._open = true;
        this.emit('open', { title, message });
    }

    hide() {
        this.elOverlay.classList.add('hidden');
        this._open = false;
        this.emit('hide', {});
    }

    isOpen() {
        return this._open;
    }

    _emit(type) {
        this.emit(type, {});
    }
}

export default ModalComponent;
