// ConfirmModalComponent.js — Podany ConfirmModal (Atomic / UI component)
// A confirmation dialog (title, message, confirm / cancel). Fires bubbling
// CustomEvents `confirm-confirmed` / `confirm-cancelled`; the caller (ModalService
// or a feature view) reacts. Drives app.feeds for the unsubscribe flow. See §2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';

export class ConfirmModalComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elOverlay = null;
        this.elTitle = null;
        this.elMessage = null;
        this.elConfirmBtn = null;
        this.elCancelBtn = null;
        this._open = false;
    }

    render() {
        const overlay = this.createElement('div', { class: 'modal-overlay confirm-modal hidden' });
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Confirmation');

        const card = this.createElement('div', { class: 'modal-card confirm-modal__card' });

        const header = this.createElement('div', { class: 'modal-header' });
        const title = this.createElement('h2', { class: 'confirm-modal__title', text: 'Are you sure?' });
        const close = this.createElement('button', { class: 'btn-close', 'aria-label': 'Close', text: '×' });
        header.append(title, close);

        this.elMessage = this.createElement('div', { class: 'confirm-modal__message' });

        const footer = this.createElement('div', { class: 'modal-footer confirm-modal__footer' });
        this.elCancelBtn = this.createElement('button', { class: 'btn btn--secondary confirm-modal__cancel', type: 'button', text: 'Cancel' });
        this.elConfirmBtn = this.createElement('button', { class: 'btn btn--primary confirm-modal__confirm', type: 'button', text: 'Confirm' });
        footer.append(this.elCancelBtn, this.elConfirmBtn);

        card.append(header, this.elMessage, footer);
        overlay.append(card);

        this.elOverlay = overlay;

        this.on(close, 'click', () => this.cancel());
        this.on(overlay, 'click', (event) => {
            if (event.target === overlay) this.cancel();
        });
        this.on(this.elCancelBtn, 'click', () => this.cancel());
        this.on(this.elConfirmBtn, 'click', () => this.confirm());

        return overlay;
    }

    onMount() {
        if (this.app && this.app.modal) this.app.modal.register('confirm', this);
    }

    // ── Open / close ─────────────────────────────────────────────────────────

    show(message, opts = {}) {
        if (this.elTitle) this.elTitle.textContent = opts.title || 'Are you sure?';
        if (this.elMessage) this.elMessage.textContent = message || '';
        if (this.elConfirmBtn) this.elConfirmBtn.textContent = opts.confirmLabel || 'Confirm';
        if (this.elCancelBtn) this.elCancelBtn.textContent = opts.cancelLabel || 'Cancel';
        if (this.elConfirmBtn) this.elConfirmBtn.classList.toggle('btn--danger', !!opts.danger);
        this._open = true;
        this.elOverlay.classList.remove('hidden');
        if (this.app && this.app.modal) this.app.modal.pushModal(this);
    }

    close() {
        // Closing via Escape (closeTopModal) must resolve the pending confirm as
        // "cancelled" so the awaiting caller is not left hanging.
        if (!this._open) return;
        this._open = false;
        this.emit('confirm-cancelled', { confirm: false });
        this.elOverlay.classList.add('hidden');
        if (this.app && this.app.modal) this.app.modal.popModal(this);
    }

    // ── Responses (fire CustomEvents, caller reacts) §2.D ─────────────────────

    confirm() {
        if (!this._open) return;
        this._open = false;
        this.emit('confirm-confirmed', { confirm: true });
        this.close();
    }

    cancel() {
        if (!this._open) return;
        this._open = false;
        this.emit('confirm-cancelled', { confirm: false });
        this.close();
    }
}

export default ConfirmModalComponent;
