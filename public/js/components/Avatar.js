// Avatar.js — Podany Avatar (Atomic / UI component)
// Circular user/episode avatar: shows an image when `src` is given, otherwise
// derives initials from `name`. Pure UI. See FRONTEND_REFACTORING_COMPONENTS.md §2, §3.2.

import { BaseComponent } from '../BaseComponent.js';

const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'];

export class Avatar extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elAvatar = null;
        this.elImg = null;
        this.elInitials = null;
    }

    render() {
        const { src = '', alt = '', initials = '', size = 'md', rounded = true, name = '' } = this.props;
        const safeSize = SIZES.includes(size) ? size : 'md';

        const classes = ['avatar', `avatar--${safeSize}` + (rounded ? ' avatar--rounded' : '')];
        this.elAvatar = this.createElement('span', { class: classes.join(' '), title: name || alt });

        if (src) {
            this.elImg = this.createElement('img', { class: 'avatar__img', src, alt: alt || name || 'Avatar' });
            this.elAvatar.append(this.elImg);
        } else {
            this.elInitials = this.createElement('span', { class: 'avatar__initials', text: initials || this._computeInitials(name) });
            this.elAvatar.append(this.elInitials);
        }

        return this.elAvatar;
    }

    _computeInitials(name) {
        if (!name) return '?';
        const parts = String(name).trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return '?';
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    update(newProps) {
        super.update(newProps);
        if (!this._mounted || !this.elAvatar) return;
        const { src, alt, initials, size, name, rounded } = this.props;
        const safeSize = SIZES.includes(size) ? size : 'md';

        const classes = ['avatar', `avatar--${safeSize}` + (rounded ? ' avatar--rounded' : '')];
        this.elAvatar.className = classes.join(' ');
        this.elAvatar.title = name || alt;

        if (src) {
            if (!this.elImg) {
                this.elImg = this.createElement('img', { class: 'avatar__img' });
                this.elAvatar.replaceChildren(this.elImg);
            }
            this.elImg.src = src;
            this.elImg.alt = alt || name || 'Avatar';
            if (this.elInitials) { this.elInitials.remove(); this.elInitials = null; }
        } else {
            const text = initials || this._computeInitials(name);
            if (!this.elInitials) {
                this.elInitials = this.createElement('span', { class: 'avatar__initials' });
                this.elAvatar.replaceChildren(this.elInitials);
            }
            this.elInitials.textContent = text;
            if (this.elImg) { this.elImg.remove(); this.elImg = null; }
        }
    }
}

export default Avatar;
