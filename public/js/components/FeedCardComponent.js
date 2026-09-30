// FeedCardComponent.js — Podany FeedCard (Atomic / UI component)
// A single subscribed-feed card (one stable instance owns this.el). Composes the
// recent-episode section via FeedCardRecentComponent. Emits open-feed and
// unsubscribe upward via CustomEvent; never touches the global DOM registry or sibling trees.
// See spec §2.C, §2.D, §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../Config.js';
import FeedCardRecentComponent from './FeedCardRecentComponent.js';

export class FeedCardComponent extends BaseComponent {
    constructor(app, { feedId } = {}) {
        super(app, { feedId: feedId ?? null });
        this.id = feedId ?? null;
        this.recent = null;
        this.elArtwork = null;
        this.elTitle = null;
        this.elDesc = null;
        this.elUnsubBtn = null;
        this.elRecentHost = null;
    }

    render() {
        const id = this.id;
        const meta = this.state.feedMetadata[id] || {};
        const url = this.state.feedUrlById[id] || '';
        const plainDesc = (meta.description || '').replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();

        this.el = this.createElement('div', { class: 'feed-card' });
        this.el.dataset.feedId = id;

        const art = this.createElement('img', { class: 'feed-art', src: artworkUrl(meta.image, 'large'), alt: '' });
        art.onerror = () => { art.onerror = null; art.src = FALLBACK_ARTWORK; };

        const title = this.createElement('h4', { text: escapeHtml(meta.title || url) });
        const count = meta.error ? (meta.episodesCount || 0) : (meta.episodesCount || 0);
        const subtitle = this.createElement('p', { text: `${count} episodes` });
        const info = this.createElement('div', { class: 'feed-info' });
        info.append(title, subtitle);

        const top = this.createElement('div', { class: 'feed-header' });
        top.append(art, info);

        const unsubBtn = this.createElement('button', { class: 'btn-feed-unsubscribe', title: 'Remove podcast', ariaLabel: 'Remove podcast' });
        unsubBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

        top.appendChild(unsubBtn);
        this.el.appendChild(top);
        this.elArtwork = art;
        this.elTitle = title;
        this.elUnsubBtn = unsubBtn;

        if (plainDesc) {
            const desc = this.createElement('p', { class: 'feed-card-desc', text: escapeHtml(plainDesc) });
            this.el.appendChild(desc);
            this.elDesc = desc;
        }

        this.elRecentHost = this.createElement('div', { class: 'feed-card-recent-host' });
        this.el.appendChild(this.elRecentHost);

        return this.el;
    }

    mount(parent) {
        if (this.el === null) this.el = this.render();
        if (parent && this.el.parentNode !== parent) parent.appendChild(this.el);
        this._mounted = true;

        this.recent = new FeedCardRecentComponent(this.app, { feedId: this.id });
        this.recent.mount(this.elRecentHost);

        this.on(this.el, 'click', (e) => {
            if (e.target.closest('.btn-feed-unsubscribe')) {
                e.stopPropagation();
                this.emit('unsubscribe-requested', { feedId: this.id });
                return;
            }
            if (e.target.closest('.recent-ep-row')) return;
            this.emit('open-feed', { feedId: this.id });
        });

        this.onMount();
        return this.el;
    }

    unmount() {
        if (this.recent) this.recent.unmount();
        super.unmount();
    }
}

export default FeedCardComponent;
