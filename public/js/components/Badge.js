// Badge.js — Podany Badge (Atomic / UI component)
// Small text chip with optional variant/size/pill and an extra state class.
// Pure presentation, emits nothing. See FRONTEND_REFACTORING_COMPONENTS.md §2, §3.2.

import { BaseComponent } from '../BaseComponent.js';

const VARIANTS = ['default', 'primary', 'info', 'success', 'warning', 'danger'];
const SIZES = ['sm', 'md', 'lg'];

export class Badge extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elBadge = null;
    }

    render() {
        const { text = '', variant = 'default', size = 'md', pill = false, state = '' } = this.props;
        const safeVariant = VARIANTS.includes(variant) ? variant : 'default';
        const safeSize = SIZES.includes(size) ? size : 'md';

        const classes = ['badge', `badge--${safeVariant}`, `badge--${safeSize}`];
        if (pill) classes.push('badge--pill');
        if (state) classes.push(state);

        this.elBadge = this.createElement('span', { class: classes.join(' '), text });
        return this.elBadge;
    }

    update(newProps) {
        super.update(newProps);
        if (!this._mounted || !this.elBadge) return;
        const { text, variant, size, pill, state } = this.props;
        const safeVariant = VARIANTS.includes(variant) ? variant : 'default';
        const safeSize = SIZES.includes(size) ? size : 'md';

        const classes = ['badge', `badge--${safeVariant}`, `badge--${safeSize}`];
        if (pill) classes.push('badge--pill');
        if (state) classes.push(state);
        this.elBadge.className = classes.join(' ');
        this.elBadge.textContent = text;
    }
}

export default Badge;
