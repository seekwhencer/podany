// episodeCard.js — Podany EpisodeCard
// Renders a single episode card (artwork, meta, progress track, play/queue/marked
// actions) and wires its interactivity. Shared by TimelineManager and FeedsManager.

import {
    escapeHtml,
    formatTime,
    parseDurationSeconds,
    formatHumanRelativeDate,
    formatEpisodeDuration
} from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../config.js';

export class EpisodeCard {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.elements = app.elements;
        this.config = app.config;
    }

    createEpisodeCard(ep) {
        const isCurrentlyActive = this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid;
        const isPlaying = isCurrentlyActive && this.state.playbackStatus === 'playing';
        const isLoading = isCurrentlyActive && this.state.playbackStatus === 'loading';
        const isQueued = this.app.queue.isEpisodeQueued(ep.id);

        const savedPos = this.state.playbackPositions[ep.id];
        const isCompleted = savedPos && (savedPos.completed === 1 || savedPos.completed === true);
        const hasProgress = (isCurrentlyActive || (savedPos && savedPos.position > 2)) && !isCompleted;
        const curPos = isCurrentlyActive
            ? ((this.state.activeEngine === 'audio' ? this.elements.audio.currentTime : (this.state.ytPlayer && this.state.ytPlayer.getCurrentTime ? this.state.ytPlayer.getCurrentTime() : 0)) || (savedPos ? savedPos.position : 0))
            : (savedPos ? savedPos.position : 0);
        const resumeTimeStr = hasProgress ? `Resumes at ${formatTime(curPos)}` : '';

        let progressTrackHtml = '';
        if (hasProgress) {
            let durSec = 0;
            if (isCurrentlyActive) {
                if (this.state.activeEngine === 'audio' && this.elements.audio.duration && !isNaN(this.elements.audio.duration) && isFinite(this.elements.audio.duration)) {
                    durSec = this.elements.audio.duration;
                } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getDuration) {
                    durSec = this.state.ytPlayer.getDuration();
                }
            }
            if (!durSec && ep.duration) {
                durSec = parseDurationSeconds(ep.duration);
            }
            let progressPct = 0;
            if (durSec > 0) {
                progressPct = Math.min(100, Math.max(1, Math.round((curPos / durSec) * 100)));
            } else {
                progressPct = 5;
            }
            progressTrackHtml = `<div class="ep-progress-track" title="Click or scrub to resume at any point"><div class="ep-progress-fill" style="width: ${progressPct}%"></div></div>`;
        }

        const card = document.createElement('div');
        card.className = `episode-card ${isCurrentlyActive ? 'playing' : ''} ${isCompleted ? 'is-played' : ''}`;
        card.dataset.id = ep.id ?? '';

        const dateInput = ep.timestamp || ep.pubDate;
        const humanDate = dateInput ? formatHumanRelativeDate(dateInput) : 'Unknown date';
        const fullDate = dateInput ? new Date(dateInput).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const humanTime = dateInput ? new Date(dateInput).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
        const formattedDuration = ep.duration ? formatEpisodeDuration(ep.duration) : '';

        let btnHtml = this.config.cardIcons.PLAY;
        let btnTitle = 'Play';
        if (isLoading) {
            btnHtml = this.config.cardIcons.SPINNER;
            btnTitle = 'Loading...';
        } else if (isPlaying) {
            btnHtml = this.config.cardIcons.PAUSE;
            btnTitle = 'Pause';
        }

        card.innerHTML = `
      <div class="episode-card-top">
        <img class="episode-artwork" src="${artworkUrl(ep.image, 'thumb')}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
        <div class="episode-header-info">
          <div class="episode-podcast-name">${ep.isYouTube ? 'YOUTUBE' : escapeHtml(ep.podcastTitle)}</div>
          <div class="episode-title">${escapeHtml(ep.title)}</div>
        </div>
      </div>
      ${ep.description ? `<div class="episode-desc">${escapeHtml(ep.description)} <span class="episode-desc-link">Notes & links →</span></div>` : ''}
      ${progressTrackHtml}
      <div class="episode-footer">
        <div class="episode-meta">
          <span title="${escapeHtml(fullDate)}" class="date-line" style="display:block;">${escapeHtml(humanDate)}</span>
<span class="time-line" style="display:block;">${escapeHtml(humanTime)}</span>
          ${formattedDuration ? `<span>${escapeHtml(formattedDuration)}</span>` : ''}
          ${resumeTimeStr ? `<span class="ep-resume-time" title="Click to resume playback">• ${resumeTimeStr}</span>` : ''}
        </div>
        <div class="episode-card-actions" style="display:flex; gap:4px; flex-wrap:nowrap;">
          <button class="btn-queue-ep ${isQueued ? 'is-queued' : ''}" title="${isQueued ? 'Remove from Up Next' : 'Add to Up Next'}">
            ${isQueued ? this.config.cardIcons.QUEUE_ADDED : this.config.cardIcons.QUEUE}
          </button>
          <button class="btn-mark-played ${isCompleted ? 'is-completed' : ''}" title="${isCompleted ? 'Mark as Unplayed' : 'Mark as Played'}">
            ${isCompleted ? this.config.cardIcons.CHECK_FILLED : this.config.cardIcons.CHECK}
          </button>
          <button class="btn-play-ep" title="${btnTitle}">
            ${btnHtml}
          </button>
        </div>
      </div>
    `;

        const els = {};
        els.artwork = card.querySelector('.episode-artwork');
        els.desc = card.querySelector('.episode-desc');
        els.title = card.querySelector('.episode-title');
        els.podName = card.querySelector('.episode-podcast-name');
        els.playBtn = card.querySelector('.btn-play-ep');
        els.queueBtn = card.querySelector('.btn-queue-ep');
        els.markBtn = card.querySelector('.btn-mark-played');
        els.progressTrack = card.querySelector('.ep-progress-track');
        els.fill = els.progressTrack ? els.progressTrack.querySelector('.ep-progress-fill') : null;
        els.resumeBadge = card.querySelector('.ep-resume-time');
        els.episodeFooter = card.querySelector('.episode-footer');
        els.episodeMeta = card.querySelector('.episode-meta');

        if (els.desc) {
            els.desc.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.timeline.openShowNotes(ep);
            });
        }

        if (els.title) {
            els.title.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.timeline.openShowNotes(ep);
            });
        }

        if (els.podName) {
            els.podName.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.feeds.openFeedDetail(ep.subscriptionId || ep.feedUrl);
            });
        }

        els.playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.playback.toggleEpisodePlayback(ep);
        });

        els.queueBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.queue.toggleEpisodeQueue(ep);
        });

        els.markBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.timeline.toggleMarkPlayed(ep);
        });

        if (els.progressTrack) {
            this.app.timeline.setupProgressTrackInteractivity(els.progressTrack, card, ep);
        }

        if (els.resumeBadge) {
            els.resumeBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                this.app.playback.toggleEpisodePlayback(ep);
            });
        }

        card.__els = els;

        return card;
    }
}

export default EpisodeCard;
