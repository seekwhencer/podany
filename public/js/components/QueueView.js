// QueueView.js — Podany QueueView (Feature Component)
// The /queue view: "Up Next" list with now-playing card, drag-to-reorder, play-now
// and remove actions, plus empty state. Reads app.queue state and triggers actions
// via app.queue / app.playback. See spec §4, §13.

import { BaseComponent } from '../BaseComponent.js';
import { escapeHtml } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../Config.js';
import QueueItemComponent from './QueueItemComponent.js';

export class QueueView extends BaseComponent {
    constructor(app) {
        super(app, {});
        this.rows = new Map();   // guid -> { item, row }
        this.draggedIndex = null;
        this.elCount = null;
        this.elClear = null;
        this.elNowPlaying = null;
        this.elItems = null;
        this.elEmptyHost = null;
    }

    render() {
        this.el = this.createElement('div', { class: 'queue-view' });

        const header = this.createElement('div', { class: 'queue-modal-header' });
        const titleWrap = this.createElement('div', { class: 'queue-header-title-wrap' });
        const title = this.createElement('h2', { text: 'Up Next' });
        this.elCount = this.createElement('span', { class: 'queue-count-badge', text: '0 episodes' });
        titleWrap.append(title, this.elCount);

        this.elClear = this.createElement('button', { class: 'btn-text-subtle', text: 'Clear all' });
        header.append(titleWrap, this.elClear);
        this.el.appendChild(header);

        this.elNowPlaying = this.createElement('div', { class: 'queue-now-playing-container' });
        this.el.appendChild(this.elNowPlaying);

        const sectionHeader = this.createElement('div', { class: 'queue-section-header' });
        const subhead = this.createElement('span', { class: 'queue-subhead', text: 'Queue Order' });
        sectionHeader.appendChild(subhead);
        this.el.appendChild(sectionHeader);

        this.elItems = this.createElement('div', { class: 'queue-list' });
        this.el.appendChild(this.elItems);

        this.elEmptyHost = this.createElement('div', {});
        this.el.appendChild(this.elEmptyHost);

        return this.el;
    }

    onMount() {
        this.subscribe('queue', () => this._render());
        this.subscribe('currentEpisode', () => this._renderNowPlaying());

        this.on(this.elClear, 'click', () => this.app.queue.clearQueue());

        this.on(this.el, ['queue-item-play', 'queue-item-remove'], (e) => {
            const detail = e.detail || {};
            if (e.type === 'queue-item-play' && detail.episode) {
                this.app.queue.removeFromQueue(detail.episode.id);
                this.app.playback.playEpisode(detail.episode);
            } else if (e.type === 'queue-item-remove' && detail.id != null) {
                this.app.queue.removeFromQueue(detail.id);
            }
        });

        this._render();
    }

    _render() {
        this._clearRows();
        const queue = Array.isArray(this.state.queue) ? this.state.queue : [];
        const count = queue.length;

        this.elCount.textContent = count === 1 ? '1 episode' : `${count} episodes`;
        this.elClear.style.display = count > 0 ? 'inline' : 'none';

        this._renderNowPlaying();

        this.elEmptyHost.innerHTML = '';
        if (count === 0) {
            const box = this.createElement('div', { class: 'queue-empty-box' });
            const p = this.createElement('p', { text: 'Your queue is empty' });
            const span = this.createElement('span', { text: 'Click the queue icon on any episode to queue it up next.' });
            box.append(p, span);
            this.elEmptyHost.appendChild(box);
            return;
        }

        queue.forEach((ep, idx) => {
            const key = String(ep.guid);
            const existing = this.rows.get(key);
            if (existing) { this.elItems.appendChild(existing.row); return; }
            const item = new QueueItemComponent(this.app, { episode: ep, index: idx });
            item.mount(this.elItems);
            this.rows.set(key, { item, row: item.el });
            this._wireDrag(item.el, idx);
        });
    }

    _renderNowPlaying() {
        this.elNowPlaying.innerHTML = '';
        const cur = this.state.currentEpisode;
        if (!cur) return;
        const card = this.createElement('div', { class: 'queue-now-playing-card' });
        const label = this.createElement('div', { class: 'queue-now-playing-label', text: 'Now Playing' });
        const row = this.createElement('div', { class: 'queue-now-playing-row' });

        const art = this.createElement('img', { class: 'queue-item-artwork', src: artworkUrl(cur.image, 'thumb'), alt: '' });
        art.onerror = () => { art.onerror = null; art.src = FALLBACK_ARTWORK; };
        const title = this.createElement('div', { class: 'queue-item-title', text: escapeHtml(cur.title) });
        const meta = this.createElement('div', { class: 'queue-item-meta', text: cur.isYouTube ? 'YouTube' : escapeHtml(cur.podcastTitle) });
        const info = this.createElement('div', { class: 'queue-item-info' });
        info.append(title, meta);
        const indicator = this.createElement('div', { class: 'queue-now-playing-indicator' });
        indicator.append(this.createElement('span'), this.createElement('span'), this.createElement('span'));
        row.append(art, info, indicator);
        card.append(label, row);
        this.elNowPlaying.appendChild(card);
    }

    _clearRows() {
        for (const [key, entry] of this.rows) {
            if (entry.item && typeof entry.item.unmount === 'function') entry.item.unmount();
            this.rows.delete(key);
        }
    }

    // Desktop drag-to-reorder (§13.3 delegating per row). Mirrors the legacy
    // QueueService drag behaviour in reduced form.
    _wireDrag(row, idx) {
        this.on(row, 'dragstart', (e) => {
            this.draggedIndex = idx;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(idx));
            this.setTimeout(() => row.classList.add('is-dragging'), 0);
        });
        this.on(row, 'dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = row.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) { row.classList.add('drag-over-above'); row.classList.remove('drag-over-below'); }
            else { row.classList.add('drag-over-below'); row.classList.remove('drag-over-above'); }
        });
        this.on(row, 'dragleave', () => { row.classList.remove('drag-over-above', 'drag-over-below'); });
        this.on(row, 'drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over-above', 'drag-over-below');
            const fromIdx = this.draggedIndex !== null ? this.draggedIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
            const toIdx = idx;
            if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== toIdx) this._reorder(fromIdx, toIdx);
        });
        this.on(row, 'dragend', () => {
            row.classList.remove('is-dragging', 'drag-over-above', 'drag-over-below');
            this.draggedIndex = null;
        });
    }

    _reorder(fromIdx, toIdx) {
        const queue = this.state.queue.slice();
        const [item] = queue.splice(fromIdx, 1);
        queue.splice(toIdx, 0, item);
        this.state.queue = queue;
        this.state.notify('queue');
        this.app.queue.saveQueue();
        this._render();
    }

    unmount() {
        this._clearRows();
        super.unmount();
    }
}

export default QueueView;
