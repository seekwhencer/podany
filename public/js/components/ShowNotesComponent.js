// ShowNotesComponent.js — Podany ShowNotes (Atomic / UI component)
// The episode show-notes overlay: artwork, podcast/episode title, meta, sanitized
// content with linkification and timestamp buttons. Owns its own DOM and projects
// the opened episode on demand (open/close). Timestamp seeks go through
// app.playback (engine control). See FRONTEND_REFACTORING_COMPONENTS.md §2, §7, §13.

import { BaseComponent } from '../BaseComponent.js';
import {
    escapeHtml,
    formatHumanRelativeDate,
    formatEpisodeDuration
} from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../Config.js';

export class ShowNotesComponent extends BaseComponent {
    constructor(app, props = {}) {
        super(app, props);
        this.elOverlay = null;
        this.elArtwork = null;
        this.elPodcastTitle = null;
        this.elEpisodeTitle = null;
        this.elMeta = null;
        this.elContent = null;
        this._open = false;
    }

    render() {
        const overlay = this.createElement('div', { class: 'modal-overlay show-notes-overlay hidden' });
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const card = this.createElement('div', { class: 'modal-card show-notes-modal-card' });

        const header = this.createElement('div', { class: 'modal-header' });
        this.elArtwork = this.createElement('img', { class: 'show-notes-artwork', src: '', alt: '' });
        const titleWrap = this.createElement('div', { class: 'show-notes-header-wrap' });
        this.elPodcastTitle = this.createElement('span', { class: 'show-notes-podcast-tag', text: 'Podcast Name' });
        this.elEpisodeTitle = this.createElement('h2', { class: 'show-notes-episode-title', text: 'Episode Title' });
        this.elMeta = this.createElement('div', { class: 'show-notes-meta' });
        titleWrap.append(this.elPodcastTitle, this.elEpisodeTitle, this.elMeta);
        const close = this.createElement('button', { class: 'btn-close', 'aria-label': 'Close Show Notes', text: '×' });
        header.append(this.elArtwork, titleWrap, close);

        const body = this.createElement('div', { class: 'modal-body show-notes-modal-body' });
        this.elContent = this.createElement('div', { class: 'show-notes-content' });
        body.append(this.elContent);

        card.append(header, body);
        overlay.append(card);

        this.elOverlay = overlay;

        this.on(close, 'click', () => this.close());
        this.on(overlay, 'click', (event) => {
            if (event.target === overlay) this.close();
        });

        return overlay;
    }

    onMount() {
        // Global Escape closes the overlay (tracked + cleaned in unmount §13.2).
        this._keydown = (e) => {
            if (e.key === 'Escape' && this._open) this.close();
        };
        document.addEventListener('keydown', this._keydown);
    }

    onUnmount() {
        if (this._keydown && typeof document.removeEventListener === 'function') {
            document.removeEventListener('keydown', this._keydown);
        }
        this._keydown = null;
        super.unmount();
    }

    open(episode) {
        const ep = episode || (this.state ? this.state.currentEpisode : null);
        if (!ep) return;

        if (this.elArtwork) {
            if (ep.image) {
                this.elArtwork.src = artworkUrl(ep.image, 'large');
                this.elArtwork.onerror = () => { this.elArtwork.onerror = null; this.elArtwork.src = FALLBACK_ARTWORK; };
            } else {
                this.elArtwork.src = FALLBACK_ARTWORK;
            }
        }
        if (this.elPodcastTitle) this.elPodcastTitle.textContent = ep.podcastTitle || 'Podcast';
        if (this.elEpisodeTitle) this.elEpisodeTitle.textContent = ep.title || 'Untitled Episode';
        if (this.elMeta) {
            const dStr = ep.timestamp ? formatHumanRelativeDate(ep.timestamp) : (ep.pubDate || '');
            const dur = ep.duration ? formatEpisodeDuration(ep.duration) : '';
            this.elMeta.textContent = [dStr, dur].filter(Boolean).join(' • ');
        }
        if (this.elContent) {
            this.elContent.textContent = '';
            const scratch = document.createElement('div');
            scratch.innerHTML = this.formatShowNotesHtml(ep.content || ep.description || '');
            const timestamps = Array.from(scratch.querySelectorAll('.note-timestamp'));
            while (scratch.firstChild) {
                this.elContent.appendChild(scratch.firstChild);
            }
            timestamps.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const sec = parseFloat(btn.dataset.seconds);
                    if (isNaN(sec)) return;
                    this._seekTimestamp(sec, ep);
                });
            });
        }

        this._open = true;
        this.elOverlay.classList.remove('hidden');
    }

    close() {
        this._open = false;
        this.elOverlay.classList.add('hidden');
    }

    // Backward-compatible aliases used by TimelineService.
    openShowNotes(episode) { this.open(episode); }
    closeShowNotes() { this.close(); }

    _seekTimestamp(sec, ep) {
        const pb = this.app && this.app.playback;
        if (!pb) return;
        const same = this.state && this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid;
        pb.seekToTime(sec);
        if (same) {
            if (this.state && this.state.playbackStatus !== 'playing') pb.resumeCurrentEngine();
        } else {
            pb.playEpisode(ep);
            this.setTimeout(() => {
                if (this._mounted) pb.seekToTime(sec);
            }, 300);
        }
    }

    // Pure HTML transform (sanitizing, linkification, timestamp buttons).
    formatShowNotesHtml(rawInput) {
        if (!rawInput) return '<p>No show notes available for this episode.</p>';

        let processed = rawInput;
        const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(processed);

        if (!hasHtmlTags) {
            processed = escapeHtml(processed);
            processed = processed.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
            processed = processed.split(/\r?\n\r?\n/).map(p => `<p>${p.replace(/\r?\n/g, '<br>')}</p>`).join('');
        } else {
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div>${processed}</div>`, 'text/html');
            const container = doc.body.firstElementChild || doc.body;

            const dangerous = container.querySelectorAll('script, style, iframe, object, embed, form, input, button');
            dangerous.forEach(el => el.remove());

            const links = container.querySelectorAll('a');
            links.forEach(a => {
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer');
            });

            processed = container.innerHTML;
        }

        processed = processed.replace(/\b(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/g, (match, h, m, s) => {
            const hours = h ? parseInt(h, 10) : 0;
            const mins = parseInt(m, 10);
            const secs = parseInt(s, 10);
            const totalSec = (hours * 3600) + (mins * 60) + secs;
            return `<button type="button" class="note-timestamp" data-seconds="${totalSec}">${match}</button>`;
        });

        return processed;
    }
}

export default ShowNotesComponent;
