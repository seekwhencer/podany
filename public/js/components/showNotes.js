// showNotes.js — Podany ShowNotes
// Opens/closes the show-notes modal, formats episode content (HTML sanitizing,
// linkification, timestamp buttons), and seeks the active engine to a given time.

import {
    escapeHtml,
    formatTime,
    formatHumanRelativeDate,
    formatEpisodeDuration,
    parseDurationSeconds
} from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../config.js';

export class ShowNotes {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.config = app.config;
    }

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

    seekToExactTime(seconds) {
        if (this.state.activeEngine === 'audio' && this.elements.audio) {
            this.elements.audio.currentTime = seconds;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.seekTo) {
            this.state.ytPlayer.seekTo(seconds, true);
        }
        this.app.playback.updateProgress();
    }

    openShowNotes(targetEp) {
        const ep = targetEp || this.state.currentEpisode;
        if (!ep || !this.elements.showNotesModal) return;

        if (this.elements.showNotesArtwork) {
            if (ep.image) {
                this.elements.showNotesArtwork.src = artworkUrl(ep.image, 'large');
                this.elements.showNotesArtwork.onerror = () => {
                    this.elements.showNotesArtwork.src = FALLBACK_ARTWORK;
                };
                this.elements.showNotesArtwork.style.display = '';
            } else {
                this.elements.showNotesArtwork.style.display = 'none';
            }
        }

        if (this.elements.showNotesPodcastTitle) {
            this.elements.showNotesPodcastTitle.textContent = ep.podcastTitle || 'Podcast';
        }
        if (this.elements.showNotesEpisodeTitle) {
            this.elements.showNotesEpisodeTitle.textContent = ep.title || 'Untitled Episode';
        }
        if (this.elements.showNotesMeta) {
            const dStr = ep.timestamp ? formatHumanRelativeDate(ep.timestamp) : (ep.pubDate || '');
            const dur = ep.duration ? formatEpisodeDuration(ep.duration) : '';
            this.elements.showNotesMeta.textContent = [dStr, dur].filter(Boolean).join(' • ');
        }
        if (this.elements.showNotesContent) {
            const rawContent = ep.content || ep.description || '';
            const html = this.formatShowNotesHtml(rawContent);

            const scratch = document.createElement('div');
            scratch.innerHTML = html;
            const timestamps = Array.from(scratch.querySelectorAll('.note-timestamp'));
            while (scratch.firstChild) {
                this.elements.showNotesContent.appendChild(scratch.firstChild);
            }

            timestamps.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const sec = parseFloat(btn.dataset.seconds);
                    if (isNaN(sec)) return;
                    if (this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid) {
                        this.seekToExactTime(sec);
                        if (this.state.playbackStatus !== 'playing') {
                            this.app.playback.resumeCurrentEngine();
                        }
                    } else {
                        this.app.playback.playEpisode(ep);
                        setTimeout(() => {
                            this.seekToExactTime(sec);
                        }, 300);
                    }
                });
            });
        }

        this.elements.showNotesModal.classList.remove('hidden');
        window.history.pushState({ modal: 'showNotes' }, '', window.location.hash);
    }

    closeShowNotes() {
        if (window.history.state && window.history.state.modal) {
            window.history.back();
        } else if (this.elements.showNotesModal) {
            this.elements.showNotesModal.classList.add('hidden');
        }
    }
}

export default ShowNotes;
