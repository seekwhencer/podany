// Tab.js — Podany Tab (Atomic / UI component)
// A single selectable nav tab. Emits a bubbling 'select' CustomEvent when clicked
// (suppressed while disabled). Pure UI. See FRONTEND_REFACTORING_COMPONENTS.md §2, §3.2, §7.

import { BaseComponent } from '../BaseComponent.js';

export class Tab extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elTab = null;
    }

    render() {
        const { label = '', active = false, disabled = false, name = null } = this.props;

        const classes = ['tab'];
        if (active) classes.push('tab--active');
        if (disabled) classes.push('tab--disabled');

        this.elTab = this.createElement('button', {
            class: classes.join(' '),
            type: 'button',
            role: 'tab',
            'aria-selected': active ? 'true' : 'false'
        });
        if (name) this.elTab.dataset.tab = name;
        if (disabled) this.elTab.setAttribute('aria-disabled', 'true');

        this.elTab.textContent = label;
        return this.elTab;
    }

    mount(parent) {
        super.mount(parent);
        this.on(this.elTab, 'click', () => {
            if (this.elTab.disabled) return;
            this.emit('select', { name: this.props.name, label: this.props.label, active: true });
        });
    }

    update(newProps) {
        super.update(newProps);
        if (!this._mounted || !this.elTab) return;
        const { label, active, disabled, name } = this.props;

        const classes = ['tab'];
        if (active) classes.push('tab--active');
        if (disabled) classes.push('tab--disabled');
        this.elTab.className = classes.join(' ');
        this.elTab.textContent = label;
        this.elTab.setAttribute('aria-selected', active ? 'true' : 'false');
        if (name) this.elTab.dataset.tab = name;
        this.elTab.disabled = !!disabled;
        this.elTab.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
}

export default Tab;
