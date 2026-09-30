// ThemeComponent.js — Podany Theme (Layout / UI component)
// Controls global theme-relevant CSS variables via the `data-theme` attribute on
// <html> (:root tokens in variables.css). Preserves the legacy behaviour: load
// the saved theme on boot, apply it, and follow the system preference when the
// saved choice is 'system'. See FRONTEND_REFACTORING_COMPONENTS.md §14.
//
// The component itself has no visible chrome (theming lives on :root); it owns
// the apply/set logic. The static theme buttons in the settings panel are still
// wired by the legacy ThemeService until Phase 4; once activated, those buttons
// should call themeComponent.set(theme) instead.

import { BaseComponent } from '../BaseComponent.js';

export class ThemeComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.storage = app ? app.storage : null;
        this._mediaQuery = null;
    }

    render() {
        // No visible chrome; theming is applied to :root. A detached node keeps
        // the BaseComponent lifecycle intact.
        return this.createElement('div', { class: 'theme-controller', hidden: true });
    }

    onMount() {
        const saved = this.storage && typeof this.storage.loadTheme === 'function'
            ? this.storage.loadTheme()
            : 'system';
        this.apply(saved);
        if (typeof window !== 'undefined' && window.matchMedia) {
            this._mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            this._mediaQuery.addEventListener('change', this._onSystemChange);
        }
    }

    onUnmount() {
        if (this._mediaQuery && typeof this._mediaQuery.removeEventListener === 'function' && this._onSystemChange) {
            this._mediaQuery.removeEventListener('change', this._onSystemChange);
        }
        this._mediaQuery = null;
    }

    _onSystemChange = () => {
        const current = this.storage && typeof this.storage.loadTheme === 'function'
            ? this.storage.loadTheme()
            : 'system';
        if (current === 'system') {
            this.apply('system');
        }
    };

    apply(theme) {
        if (typeof document === 'undefined' || !document.documentElement) return;
        if (theme === 'system') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }

    set(theme) {
        if (this.storage && typeof this.storage.saveTheme === 'function') {
            this.storage.saveTheme(theme);
        }
        this.state.theme = theme;
        this.state.notify('theme');
        this.apply(theme);
        this.emit('theme-changed', { theme });
    }
}

export default ThemeComponent;
