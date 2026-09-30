// Input.js — Podany Input (Atomic / UI component)
// Labeled text input primitive. Emits bubbling 'input' (per keystroke) and
// 'change' (on blur / Enter) CustomEvents carrying the current value. Pure UI.
// See FRONTEND_REFACTORING_COMPONENTS.md §2, §3.2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';

export class Input extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elInput = null;
        this.elMessage = null;
    }

    render() {
        const {
            label = '',
            value = '',
            placeholder = '',
            type = 'text',
            name = null,
            id = null,
            required = false,
            readonly = false,
            disabled = false,
            error = null,
            hint = null,
            ariaLabel = null
        } = this.props;

        const wrapper = this.createElement('label', {
            class: 'input-field' + (error ? ' input-field--error' : '')
        });
        if (id) wrapper.setAttribute('for', id);

        if (label) {
            const elLabel = this.createElement('span', { class: 'input-label', text: label });
            wrapper.setAttribute('data-has-label', 'true');
            wrapper.append(elLabel);
        }

        this.elInput = this.createElement('input', { class: 'input-control', type, value, placeholder });
        if (name) this.elInput.setAttribute('name', name);
        if (id) this.elInput.setAttribute('id', id);
        if (ariaLabel) this.elInput.setAttribute('aria-label', ariaLabel);
        else if (label) this.elInput.setAttribute('aria-label', label);
        if (required) this.elInput.setAttribute('required', 'required');
        if (readonly) this.elInput.readOnly = true;
        if (disabled) this.elInput.disabled = true;

        wrapper.append(this.elInput);

        const message = error != null ? error : hint;
        if (message) {
            this.elMessage = this.createElement('span', {
                class: 'input-field__message ' + (error != null ? 'input-error' : 'input-hint')
            });
            this.elMessage.textContent = message;
            wrapper.append(this.elMessage);
        }

        return wrapper;
    }

    mount(parent) {
        super.mount(parent);
        this.on(this.elInput, 'input', () => {
            this.emit('input', { value: this.elInput.value, name: this.props.name });
        });
        this.on(this.elInput, 'change', () => {
            this.emit('change', { value: this.elInput.value, name: this.props.name });
        });
        this.on(this.elInput, 'keydown', (event) => {
            if (event.key === 'Enter') this.elInput.blur();
        });
    }

    get value() {
        return this.elInput ? this.elInput.value : (this.props.value || '');
    }

    focus() {
        if (this.elInput && this._mounted) this.elInput.focus();
    }

    setError(error) { this.update({ error }); }

    update(newProps) {
        super.update(newProps);
        if (!this._mounted || !this.elInput) return;
        const { value, error, hint, type, placeholder, disabled, readonly, required } = this.props;

        if (value != null && this.elInput.value !== String(value)) this.elInput.value = String(value);
        if (placeholder !== undefined) this.elInput.placeholder = placeholder;
        if (type !== undefined) this.elInput.type = type;
        this.elInput.disabled = !!disabled;
        this.elInput.readOnly = !!readonly;
        if (required) this.elInput.setAttribute('required', 'required');
        else this.elInput.removeAttribute('required');

        this.el.classList.toggle('input-field--error', error != null);

        const message = error != null ? error : hint;
        if (message) {
            if (!this.elMessage) {
                this.elMessage = this.createElement('span', { class: 'input-field__message' });
                if (this.elInput.parentNode) this.elInput.parentNode.append(this.elMessage);
            }
            this.elMessage.textContent = message;
            this.elMessage.className = 'input-field__message ' + (error != null ? 'input-error' : 'input-hint');
        } else if (this.elMessage) {
            this.elMessage.remove();
            this.elMessage = null;
        }
    }
}

export default Input;
