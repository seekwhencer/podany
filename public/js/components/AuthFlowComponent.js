// AuthFlowComponent.js — Podany AuthFlow (Atomic / UI component)
// Login / registration UI (magic-link form + password form + mode toggle) as a
// self-contained BaseComponent with its own DOM overlay. Projects
// state.authModalOpen and drives AuthService (app.auth) for all actions. Each
// form runs an explicit state machine idle -> loading -> success | error with a
// retry action; every async request is wrapped in an AbortController that is
// aborted in unmount(). See FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §10, §13.

import { BaseComponent } from '../BaseComponent.js';

export class AuthFlowComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        // Captured element references (own tree only, once at build time §7.2).
        this.elOverlay = null;
        this.elTitle = null;
        this.elClose = null;
        this.elMagicForm = null;
        this.elMagicEmail = null;
        this.elPasswordForm = null;
        this.elPasswordEmail = null;
        this.elPasswordPassword = null;
        this.elToggle = null;
        this.elToggleLink = null;
        this._statusRefs = {
            magic: { node: null, spinner: null, message: null, retry: null },
            password: { node: null, spinner: null, message: null, retry: null }
        };
        // Local UI state (not global §7.4).
        this._open = false;
        this._mode = 'magic'; // 'magic' | 'password'
        this._status = { magic: 'idle', password: 'idle' }; // idle|loading|success|error
    }

    render() {
        const overlay = this.createElement('div', { class: 'modal-overlay auth-flow hidden' });
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Sign in');

        const card = this.createElement('div', { class: 'auth-flow__card' });

        const header = this.createElement('div', { class: 'auth-flow__header' });
        this.elTitle = this.createElement('h2', { class: 'auth-flow__title', text: 'Sign in with a magic link' });
        this.elClose = this.createElement('button', { class: 'auth-flow__close', text: '×' });
        this.elClose.setAttribute('aria-label', 'Close');
        header.append(this.elTitle, this.elClose);

        const body = this.createElement('div', { class: 'auth-flow__body' });

        // Magic-link form (passwordless login).
        this.elMagicForm = this.createElement('form', { class: 'auth-flow__form' });
        this.elMagicForm.noValidate = true;
        this.elMagicEmail = this._input('auth-magic-email', 'Your email', 'you@example.com', 'email');
        this.elMagicStatus = this._statusNode('magic');
        this.elMagicSubmit = this._submitBtn('Send magic link');
        this.elMagicForm.append(
            this._field('Your email', this.elMagicEmail),
            this.elMagicStatus,
            this._submitRow(this.elMagicSubmit)
        );

        // Password form (sign in), hidden by default.
        this.elPasswordForm = this.createElement('form', { class: 'auth-flow__form auth-flow__form--password hidden' });
        this.elPasswordForm.noValidate = true;
        this.elPasswordEmail = this._input('auth-password-email', 'Email', 'you@example.com', 'email');
        this.elPasswordPassword = this._input('auth-password-password', 'Password', 'Password', 'password');
        this.elPasswordStatus = this._statusNode('password');
        this.elPasswordSubmit = this._submitBtn('Sign in');
        this.elPasswordForm.append(
            this._field('Email', this.elPasswordEmail),
            this._field('Password', this.elPasswordPassword),
            this.elPasswordStatus,
            this._submitRow(this.elPasswordSubmit)
        );

        this.elToggle = this.createElement('div', { class: 'auth-flow__toggle' });
        this.elToggleLink = this.createElement('button', { type: 'button', class: 'auth-flow__toggle-link', text: 'Sign in with a password instead' });
        this.elToggle.append(this.elToggleLink);

        body.append(this.elMagicForm, this.elPasswordForm, this.elToggle);
        card.append(header, body);
        overlay.append(card);

        this.elOverlay = overlay;

        // Listeners bound to this.el's own tree (§13.2, removed in unmount()).
        this.on(this.elClose, 'click', () => this.close());
        this.on(overlay, 'click', (event) => {
            if (event.target === overlay) this.close();
        });
        this.on(this.elMagicForm, 'submit', (e) => { e.preventDefault(); this._submitMagic(); });
        this.on(this.elPasswordForm, 'submit', (e) => { e.preventDefault(); this._submitPassword(); });
        this.on(this.elToggleLink, 'click', (e) => { e.preventDefault(); this._toggleMode(); });

        return overlay;
    }

    onMount() {
        this._unsubs.push(this.subscribe('authModalOpen', (open) => this._applyOpen(open)));
        // Apply current state on mount (subscription only fires on change).
        this._applyOpen(this.state ? this.state.authModalOpen : false);
    }

    onUnmount() {
        this._abort();
    }

    // ── Open / close ─────────────────────────────────────────────────────────

    _applyOpen(open) {
        this._open = !!open;
        if (this.elOverlay) this.elOverlay.classList.toggle('hidden', !this._open);
    }

    close() {
        if (this.app && this.app.auth && typeof this.app.auth.closeAuthModal === 'function') {
            this.app.auth.closeAuthModal();
        } else if (this.elOverlay) {
            this.elOverlay.classList.add('hidden');
            this._open = false;
        }
    }

    _toggleMode() {
        if (this._mode === 'magic') {
            this._mode = 'password';
            this.elMagicForm.classList.add('hidden');
            this.elPasswordForm.classList.remove('hidden');
            this.elTitle.textContent = 'Sign in with a password';
            this.elToggleLink.textContent = 'Use a magic link instead';
            if (this.elMagicEmail.value) this.elPasswordEmail.value = this.elMagicEmail.value;
            if (this.elPasswordPassword) this.elPasswordPassword.focus();
        } else {
            this._mode = 'magic';
            this.elPasswordForm.classList.add('hidden');
            this.elMagicForm.classList.remove('hidden');
            this.elTitle.textContent = 'Sign in with a magic link';
            this.elToggleLink.textContent = 'Sign in with a password instead';
            if (this.elMagicEmail) this.elMagicEmail.focus();
        }
        this._setStatus('magic', 'idle');
        this._setStatus('password', 'idle');
    }

    // ── Status machine (idle -> loading -> success | error) §10.1 ────────────

    _setStatus(form, status, message, result) {
        const refs = this._statusRefs[form];
        if (!refs || !refs.node) return;
        this._status[form] = status;

        refs.node.classList.remove(
            'auth-flow__status--active',
            'auth-flow__status--loading',
            'auth-flow__status--success',
            'auth-flow__status--error'
        );

        if (status === 'idle') return; // hidden

        refs.node.classList.add('auth-flow__status--active');

        if (status === 'loading') {
            refs.node.classList.add('auth-flow__status--loading');
            refs.message.textContent = message || 'Sending sign-in link…';
        } else if (status === 'success') {
            refs.node.classList.add('auth-flow__status--success');
            this._renderSuccess(refs, message, result);
        } else if (status === 'error') {
            refs.node.classList.add('auth-flow__status--error');
            refs.message.textContent = message || 'Something went wrong. Try again.';
        }
    }

    _renderSuccess(refs, message, result) {
        const data = result || {};
        refs.message.replaceChildren();
        refs.message.append(this.createElement('p', {
            class: 'auth-flow__message-text',
            text: data.message || message || 'Sign-in link sent!'
        }));
        if (data.verifyUrl) {
            refs.message.append(this.createElement('a', {
                class: 'auth-flow__verify',
                href: data.verifyUrl,
                text: data.verifyLabel || 'Sign in instantly'
            }));
        }
        if (data.provider) {
            refs.message.append(this.createElement('a', {
                class: 'auth-flow__btn auth-flow__btn--primary auth-flow__provider',
                href: data.provider.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: `Open ${data.provider.name}`
            }));
        }
    }

    // ── Submissions (async, abortable) §10.3 ─────────────────────────────────

    async _submitMagic() {
        if (this._status.magic === 'loading' || !this._mounted) return;
        const email = this.elMagicEmail ? this.elMagicEmail.value.trim() : '';
        if (!this._validEmail(email)) {
            this._setStatus('magic', 'error', 'Enter a valid email address.');
            return;
        }
        this._abort();
        const ctrl = new AbortController();
        this.abort = ctrl;
        this._setStatus('magic', 'loading', 'Sending sign-in link…');
        try {
            const res = await this.app.auth.submitMagic(email, { signal: ctrl.signal });
            if (ctrl.signal.aborted || !this._mounted) return;
            if (res && res.ok) {
                this._setStatus('magic', 'success', res.message, res);
            } else {
                this._setStatus('magic', 'error', res && res.error ? res.error : 'Could not send the link. Try again.');
            }
        } catch (e) {
            if (ctrl.signal.aborted || !this._mounted) return;
            this._setStatus('magic', 'error', e && e.message ? e.message : 'Something went wrong. Try again.');
        } finally {
            if (this.abort === ctrl) this.abort = null;
        }
    }

    async _submitPassword() {
        if (this._status.password === 'loading' || !this._mounted) return;
        const email = this.elPasswordEmail ? this.elPasswordEmail.value.trim() : '';
        const password = String(this.elPasswordPassword ? this.elPasswordPassword.value : '');
        this._abort();
        const ctrl = new AbortController();
        this.abort = ctrl;
        this._setStatus('password', 'loading', 'Signing in…');
        try {
            const res = await this.app.auth.submitPassword(email, password, { signal: ctrl.signal });
            if (ctrl.signal.aborted || !this._mounted) return;
            if (res && res.ok) {
                this._setStatus('password', 'success', 'Signed in — opening your library…');
            } else {
                this._setStatus('password', 'error', res && res.error ? res.error : 'Could not sign in. Try again.');
            }
        } catch (e) {
            if (ctrl.signal.aborted || !this._mounted) return;
            this._setStatus('password', 'error', e && e.message ? e.message : 'Something went wrong. Try again.');
        } finally {
            if (this.abort === ctrl) this.abort = null;
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _abort() {
        if (this.abort && typeof this.abort.abort === 'function') this.abort.abort();
        this.abort = null;
    }

    _validEmail(value) {
        return typeof value === 'string' && value.includes('@');
    }

    _input(id, placeholder, type) {
        return this.createElement('input', {
            type,
            id,
            class: 'auth-flow__input',
            placeholder,
            autocomplete: type === 'password' ? 'current-password' : 'email',
            required: 'required'
        });
    }

    _field(labelText, input) {
        const label = this.createElement('label', { class: 'auth-flow__label', for: input.id, text: labelText });
        const wrap = this.createElement('div', { class: 'auth-flow__field' });
        wrap.append(label, input);
        return wrap;
    }

    _submitRow(btn) {
        const row = this.createElement('div', { class: 'auth-flow__submit-row' });
        row.append(btn);
        return row;
    }

    _submitBtn(text) {
        return this.createElement('button', { class: 'auth-flow__btn auth-flow__btn--primary', type: 'submit', text });
    }

    _statusNode(form) {
        const refs = { node: null, spinner: null, message: null, retry: null };
        const node = this.createElement('div', { class: 'auth-flow__status' });
        const spinner = this.createElement('div', { class: 'auth-flow__spinner' });
        const message = this.createElement('p', { class: 'auth-flow__message' });
        const retry = this.createElement('button', { type: 'button', class: 'auth-flow__retry', text: 'Try again' });
        node.append(spinner, message, retry);
        this.on(retry, 'click', (e) => {
            e.preventDefault();
            if (form === 'magic') this._submitMagic();
            else this._submitPassword();
        });
        refs.node = node;
        refs.spinner = spinner;
        refs.message = message;
        refs.retry = retry;
        this._statusRefs[form] = refs;
        return node;
    }
}

export default AuthFlowComponent;
