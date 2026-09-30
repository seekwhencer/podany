// Icon.js — Podany Icon (Atomic / UI component)
// Renders a small inline SVG by name from a local registry. Pure presentation,
// no dependencies on other components. See FRONTEND_REFACTORING_COMPONENTS.md §2, §3.2.

import { BaseComponent } from '../BaseComponent.js';

const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'];

// Path data for the viewBox "0 0 24 24". Names map 1:1 to CSS class modifiers
// (icon--<name> is not required; the registry is the single source of truth).
const ICONS = {
    play: 'polygon points="5 3 19 12 5 21 5 3"',
    pause: 'rect x="6" y="4" width="4" height="16" rect x="14" y="4" width="4" height="16"',
    playFilled: 'm12 3-1 9l5 3-5 3-1-9z',
    skipBack: 'M19 20L9 12l10-8v16zM5 19V5',
    skipForward: 'M5 4l10 8-10 8V4zM19 5v14',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    x: 'M18 6L6 18M6 6l12 12',
    close: 'M18 6L6 18M6 6l12 12',
    check: 'M20 6L9 17l-5-5',
    search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    settings: 'M10.3 3.2a1 1 0 011.4 0l.9.9a1 1 0 001 .3l1.1-.3a1 1 0 011.2.7l.3 1.2a1 1 0 00.6.6l1.2.3a1 1 0 01.7 1.2l-.3 1.1a1 1 0 00.3 1l.9.9a1 1 0 010 1.4l-.9.9a1 1 0 00-.3 1l.3 1.1a1 1 0 01-.7 1.2l-1.2.3a1 1 0 00-.6.6l-.3 1.2a1 1 0 01-1.2.7l-1.1-.3a1 1 0 00-1 .3l-.9.9a1 1 0 01-1.4 0l-.9-.9a1 1 0 00-1-.3l-1.1.3a1 1 0 01-1.2-.7l-.3-1.2a1 1 0 00-.6-.6l-1.2-.3a1 1 0 01-.7-1.2l.3-1.1a1 1 0 00-.3-1l-.9-.9a1 1 0 010-1.4l.9-.9a1 1 0 00.3-1l-.3-1.1a1 1 0 01.7-1.2l1.2-.3a1 1 0 00.6-.6l.3-1.2a1 1 0 011.2-.7l1.1.3a1 1 0 001-.3z',
    chevronDown: 'M6 9l6 6 6-6',
    chevronUp: 'M18 15l-6-6-6 6',
    chevronLeft: 'M15 18l-6-6 6-6',
    chevronRight: 'M9 18l6-6-6-6',
    arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
    arrowRight: 'M5 12h14M12 5l7 7-7 7',
    download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
    upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
    trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m4 0h6',
    edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18 3a2 2 0 012 2v6a2 2 0 01-2 2h-3l-3 3h3v-6',
    info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 10h.01M12 15v-4',
    alert: 'M10.3 3.8a2 2 0 013.4 0l7.5 13a2 2 0 01-1.7 3H4.5a2 2 0 01-1.7-3l7.5-13zM12 9v4M12 17h.01',
    more: 'M12 10h.01M7 10h.01M17 10h.01',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.6-3.6M20.5 15a9 9 0 01-14.6 3.6',
    link: 'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1',
    star: 'M12 2l3 6 6 1-4.5 4.3L17 22l-5-3-5 3 1.5-8.7L3 9l6-1z',
    heart: 'M20.8 5.6a5.5 5.5 0 00-7.8 0L12 6.6l-1-1a5.5 5.5 0 10-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 000-7.8z'
};

export class Icon extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elSvg = null;
    }

    render() {
        const { name = 'circle', size = 'md', label = null, className = '' } = this.props;
        const safeSize = SIZES.includes(size) ? size : 'md';
        const pathData = ICONS[name] || '';

        this.elSvg = this.createElement('svg', {
            class: `icon icon--${safeSize} ${className}`.trim(),
            viewBox: '0 0 24 24'
        });
        if (label) {
            this.elSvg.setAttribute('role', 'img');
            this.elSvg.setAttribute('aria-label', label);
        } else {
            this.elSvg.setAttribute('aria-hidden', 'true');
            this.elSvg.setAttribute('focusable', 'false');
        }
        if (pathData) this.elSvg.append(this.createElement('path', { d: pathData }));

        return this.elSvg;
    }
}

export default Icon;
