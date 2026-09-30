// Button.js — Podany Button (Atomic / UI component)
// Reusable button primitive: configurable label, variant/size, disabled state
// and an optional inline icon. Emits a bubbling 'click' CustomEvent (suppressed
// while disabled). Pure UI — no business logic, no sibling imports.
// See FRONTEND_REFACTORING_COMPONENTS.md §2, §3.2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';

const SIZES = ['sm', 'md', 'lg'];
const VARIANTS = ['primary', 'secondary', 'danger'];

export class Button extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elButton = null;
        this.elLabel = null;
        this.elIcon = null;
    }

    render() {
        const {
            label = '',
            variant = 'primary',
            size = 'md',
            disabled = false,
            type = 'button',
            icon = null,
            ariaLabel = null,
            title = null
        } = this.props;

        const safeVariant = VARIANTS.includes(variant) ? variant : 'primary';
        const safeSize = SIZES.includes(size) ? size : 'md';

        this.elButton = this.createElement('button', {
            class: `btn btn--${safeVariant} btn--${safeSize}`,
            type
        });
        if (ariaLabel) this.elButton.setAttribute('aria-label', ariaLabel);
        if (title) this.elButton.setAttribute('title', title);

        if (icon) {
            this.elIcon = this.createElement('svg', {
                class: 'btn__icon',
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'aria-hidden': 'true'
            });
            this.elIcon.append(this.createElement('path', { d: icon }));
            this.elButton.append(this.elIcon);
        }

        if (label) {
            this.elLabel = this.createElement('span', { class: 'btn__label', text: label });
            this.elButton.append(this.elLabel);
        }

        this.elButton.disabled = !!disabled;
        this.elButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');

        return this.elButton;
    }

    mount(parent) {
        super.mount(parent);
        this.on(this.elButton, 'click', () => {
            if (this.elButton.disabled) return;
            this.emit('click', { label: this.props.label, variant: this.props.variant });
        });
    }

    update(newProps) {
        super.update(newProps);
        if (!this._mounted || !this.elButton) return;
        const { label, variant, size, disabled, icon, ariaLabel, title } = this.props;
        const safeVariant = VARIANTS.includes(variant) ? variant : 'primary';
        const safeSize = SIZES.includes(size) ? size : 'md';
        this.elButton.className = `btn btn--${safeVariant} btn--${safeSize}`;
        if (this.elLabel) this.elLabel.textContent = label || '';
        this.elButton.disabled = !!disabled;
        this.elButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        if (ariaLabel) this.elButton.setAttribute('aria-label', ariaLabel);
        if (title) this.elButton.setAttribute('title', title);
        if (icon && this.elIcon) {
            const path = this.elIcon.firstElementChild;
            if (path) path.setAttribute('d', icon);
        }
    }

    setLabel(label) { this.update({ label }); }
    setDisabled(disabled) { this.update({ disabled }); }
}

export default Button;
