// QueueItemComponent.js — Podany QueueItem (Atomic / UI component)
// A single "Up Next" queue row (drag handle, index, artwork, meta, play now,
// remove). Emits queue-item-play / queue-item-remove upward via CustomEvent. See
// spec §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../Config.js';

export class QueueItemComponent extends BaseComponent {
    constructor(app, { episode, index }) {
        super(app, { episode, index });
        this.episode = episode || null;
        this.elArtwork = null;
        this.elPlayBtn = null;
        this.elRemoveBtn = null;
    }

    render() {
        const ep = this.episode;
        this.el = this.createElement('div', { class: 'queue-item-row' });
        this.el.dataset.guid = ep.guid;
        this.el.dataset.index = this.props.index;
        this.el.draggable = true;

        const handle = this.createElement('span', { class: 'queue-drag-handle', title: 'Drag to reorder' });
        handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>`;

        const idx = this.createElement('span', { class: 'queue-item-index', text: String(this.props.index + 1) });

        const art = this.createElement('img', { class: 'queue-item-artwork', src: artworkUrl(ep.image, 'thumb'), alt: '' });
        art.onerror = () => { art.onerror = null; art.src = FALLBACK_ARTWORK; };
        this.elArtwork = art;

        const title = this.createElement('div', { class: 'queue-item-title', text: escapeHtml(ep.title) });
        const meta = this.createElement('div', { class: 'queue-item-meta', text: `${escapeHtml(ep.podcastTitle)}${ep.duration ? ' ' + escapeHtml(ep.duration) : ''}` });
        const info = this.createElement('div', { class: 'queue-item-info' });
        info.append(title, meta);

        const playBtn = this.createElement('button', { class: 'btn-queue-item-play', title: 'Play Now' });
        playBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`;
        const removeBtn = this.createElement('button', { class: 'btn-queue-item-remove', title: 'Remove from Queue' });
        removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        const actions = this.createElement('div', { class: 'queue-item-actions' });
        actions.append(playBtn, removeBtn);

        this.el.append(handle, idx, art, info, actions);
        this.elPlayBtn = playBtn;
        this.elRemoveBtn = removeBtn;
        return this.el;
    }

    onMount() {
        this.on(this.elPlayBtn, 'click', (e) => { e.stopPropagation(); this.emit('queue-item-play', { episode: this.episode }); });
        this.on(this.elRemoveBtn, 'click', (e) => { e.stopPropagation(); this.emit('queue-item-remove', { id: this.episode.id }); });
    }
}

export default QueueItemComponent;
