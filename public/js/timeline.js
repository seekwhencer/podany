// timeline.js — Podany TimelineManager
// Episode-card rendering, filtering/sorting, continue shelf, show notes, and
// progress-scrubbing interactivity.

import {
  escapeHtml,
  formatTime,
  parseDurationSeconds,
  formatCompactDate,
  formatHumanRelativeDate,
  formatEpisodeDuration
} from './utils.js';
import { FALLBACK_ARTWORK } from './config.js';

export class TimelineManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.config = app.config;
    this.sentinelObserver = null;
    this.emptySearchDebounceTimer = null;
  }

  // ── Filtering & sorting ─────────────────────────────────────────────────

  updateFilterBadges() {
    const currentGuid = this.state.currentEpisode ? this.state.currentEpisode.guid : null;
    if (this.elements.continueCount) {
      const inProgressCount = this.state.allEpisodes.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        const isCurrent = currentGuid && ep.guid === currentGuid;
        return (!pos || !pos.completed) && (isCurrent || (pos && pos.position > 2));
      }).length;
      this.elements.continueCount.textContent = inProgressCount;
    }
    if (this.elements.playedCount) {
      const playedCount = this.state.allEpisodes.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        return pos && (pos.completed === 1 || pos.completed === true);
      }).length;
      this.elements.playedCount.textContent = playedCount;
    }
    if (this.elements.downloadedCount) {
      const dlCount = Object.keys(this.state.downloadedEpisodes || {}).length;
      this.elements.downloadedCount.textContent = dlCount;
    }
  }

  processAndSortEpisodes() {
    let list = [...this.state.allEpisodes];

    if (this.state.searchQuery) {
      const q = this.state.searchQuery.toLowerCase();
      list = list.filter(ep =>
        ep.title.toLowerCase().includes(q) ||
        ep.podcastTitle.toLowerCase().includes(q) ||
        (ep.description && ep.description.toLowerCase().includes(q))
      );
    }

    const currentGuid = this.state.currentEpisode ? this.state.currentEpisode.guid : null;

    if (this.state.filterMode === 'continue') {
      list = list.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        const isCurrent = currentGuid && ep.guid === currentGuid;
        return (!pos || !pos.completed) && (isCurrent || (pos && pos.position > 2));
      });
      this._pushCurrentToFront(list, currentGuid);
    } else if (this.state.filterMode === 'unplayed') {
      list = list.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        const isCurrent = currentGuid && ep.guid === currentGuid;
        if (isCurrent) return false;
        return !pos || (!pos.completed && (!pos.position || pos.position <= 2));
      });
    } else if (this.state.filterMode === 'played') {
      list = list.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        return pos && (pos.completed === 1 || pos.completed === true);
      });
    } else if (this.state.filterMode === 'downloaded') {
      list = list.filter(ep => !!this.state.downloadedEpisodes[ep.guid]);
    }

    if (this.state.filterMode === 'continue') {
      list.sort((a, b) => {
        const posA = this.state.playbackPositions[a.guid];
        const posB = this.state.playbackPositions[b.guid];
        const timeA = (posA && posA.lastListenedAt) || (a.timestamp ? a.timestamp / 1000 : 0);
        const timeB = (posB && posB.lastListenedAt) || (b.timestamp ? b.timestamp / 1000 : 0);
        return timeB - timeA;
      });
      this._pushCurrentToFront(list, currentGuid);
    } else if (this.state.sortOrder === 'newest') {
      list.sort((a, b) => b.timestamp - a.timestamp);
    } else if (this.state.sortOrder === 'oldest') {
      list.sort((a, b) => a.timestamp - b.timestamp);
    } else if (this.state.sortOrder === 'title-asc') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (this.state.sortOrder === 'title-desc') {
      list.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    } else if (this.state.sortOrder === 'podcast-asc') {
      list.sort((a, b) => {
        const comp = (a.podcastTitle || '').localeCompare(b.podcastTitle || '');
        return comp !== 0 ? comp : b.timestamp - a.timestamp;
      });
    } else if (this.state.sortOrder === 'duration-asc') {
      list.sort((a, b) => parseDurationSeconds(a.duration) - parseDurationSeconds(b.duration));
    } else if (this.state.sortOrder === 'duration-desc') {
      list.sort((a, b) => parseDurationSeconds(b.duration) - parseDurationSeconds(a.duration));
    }

    this.state.filteredEpisodes = list;
    this.state.timelinePage = 1;
    this.updateFilterBadges();
    this.renderContinueShelf();
  }

  _pushCurrentToFront(list, currentGuid) {
    if (currentGuid) {
      const curIdx = list.findIndex(e => e.guid === currentGuid);
      if (curIdx > 0) {
        const cur = list.splice(curIdx, 1)[0];
        list.unshift(cur);
      }
    }
  }

  // ── Continue shelf ──────────────────────────────────────────────────────

  getContinueRowCapacity() {
    const w = window.innerWidth;
    if (w >= 1400) return 5;
    if (w >= 1150) return 4;
    if (w >= 880) return 3;
    return 2;
  }

  renderContinueShelf() {
    if (!this.elements.continueShelf || !this.elements.continueGrid) return;

    const currentGuid = this.state.currentEpisode ? this.state.currentEpisode.guid : null;

    let inProgressEps = this.state.allEpisodes.filter(ep => {
      const pos = this.state.playbackPositions[ep.guid];
      const isCurrent = currentGuid && ep.guid === currentGuid;
      return (!pos || !pos.completed) && (isCurrent || (pos && pos.position > 2));
    });

    inProgressEps.sort((a, b) => {
      const posA = this.state.playbackPositions[a.guid];
      const posB = this.state.playbackPositions[b.guid];
      const timeA = (posA && posA.lastListenedAt) || (a.timestamp ? a.timestamp / 1000 : 0);
      const timeB = (posB && posB.lastListenedAt) || (b.timestamp ? b.timestamp / 1000 : 0);
      return timeB - timeA;
    });

    this._pushCurrentToFront(inProgressEps, currentGuid);

    if (this.elements.continueCount) {
      this.elements.continueCount.textContent = inProgressEps.length;
    }

    if (inProgressEps.length === 0 || this.state.filterMode === 'played') {
      this.elements.continueShelf.classList.add('hidden');
      return;
    }

    this.elements.continueShelf.classList.remove('hidden');
    this.elements.continueGrid.innerHTML = '';

    const capacity = this.getContinueRowCapacity();

    if (this.elements.btnToggleContinue && this.elements.continueToggleLabel) {
      if (inProgressEps.length <= capacity) {
        this.elements.btnToggleContinue.style.display = 'none';
      } else {
        this.elements.btnToggleContinue.style.display = 'inline-flex';
        if (this.state.continueCollapsed) {
          this.elements.continueToggleLabel.textContent = `Show all (${inProgressEps.length})`;
          this.elements.continueShelf.classList.remove('is-expanded');
        } else {
          this.elements.continueToggleLabel.textContent = 'Show less';
          this.elements.continueShelf.classList.add('is-expanded');
        }
      }
    }

    const visibleEps = this.state.continueCollapsed ? inProgressEps.slice(0, capacity) : inProgressEps;
    visibleEps.forEach(ep => {
      this.elements.continueGrid.appendChild(this.createEpisodeCard(ep));
    });
  }

  // ── Timeline rendering ──────────────────────────────────────────────────

  renderTimeline() {
    this.app.feeds.updateDockVisibility();
    const container = this.elements.timelineList;
    container.innerHTML = '';

    if (this.state.feeds.length === 0) {
      container.innerHTML = this._emptyOnboardingHtml();
      this.wireEmptyStateEvents();
      return;
    }

    if (this.state.filteredEpisodes.length === 0) {
      let emptyTitle = 'No episodes found';
      let emptyMsg = 'Try clearing your search query or refreshing your feeds.';
      if (this.state.filterMode === 'played') {
        emptyTitle = 'No played episodes';
        emptyMsg = 'Episodes you finish or mark as played will appear here.';
      } else if (this.state.filterMode === 'continue') {
        emptyTitle = 'No episodes in progress';
        emptyMsg = 'Episodes you start listening to will appear here.';
      } else if (this.state.filterMode === 'unplayed') {
        emptyTitle = 'All caught up';
        emptyMsg = 'You have listened to all episodes.';
      } else if (this.state.filterMode === 'downloaded') {
        emptyTitle = 'No downloaded episodes';
        emptyMsg = 'Episodes you download for offline listening will appear here.';
      }
      container.innerHTML = `
        <div class="empty-state">
          <h3>${emptyTitle}</h3>
          <p>${emptyMsg}</p>
        </div>
      `;
      return;
    }

    this.state.timelinePage = 1;
    this.appendTimelineBatch();
  }

  _emptyOnboardingHtml() {
    return `
      <div class="empty-state onboarding-card">
        <div class="empty-icon-wrap">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
        </div>
        <h3>No podcasts added yet</h3>
        <p>Search by podcast name, paste any RSS feed URL, or import your existing library.</p>
        <div class="empty-quick-add">
          <form id="empty-quick-form" class="quick-add-form" action="javascript:void(0);">
            <div class="quick-add-input-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="quick-add-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" id="empty-quick-input" placeholder="Search podcast or paste RSS URL..." autocomplete="off">
              <button type="submit" class="btn btn-primary btn-quick-submit" id="btn-empty-quick-submit">Add</button>
            </div>
          </form>
          <div class="empty-category-chips" id="empty-category-chips">
            <button type="button" class="category-chip" data-category="News">News</button>
            <button type="button" class="category-chip" data-category="Tech">Tech</button>
            <button type="button" class="category-chip" data-category="Wissen">Science</button>
            <button type="button" class="category-chip" data-category="Culture">Culture</button>
            <button type="button" class="category-chip" data-category="Music">Music</button>
          </div>
          <div id="empty-quick-results" class="quick-results-container"></div>
        </div>
        <div class="empty-actions">
          <button class="btn btn-secondary" id="btn-empty-opml-trigger">Import OPML File</button>
        </div>
        <div class="starter-suggestions-section">
          <div class="starter-suggestions-title">Discover Science, Planet & Climate shows:</div>
          <div class="starter-suggestions-grid">
            <div class="starter-suggestion-chip" data-feed="https://feeds.megaphone.fm/NATIONALAERONAUTICSANDSPACEADMINISTRATION8162188566"><span class="starter-chip-name">NASA's Curious Universe</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://feeds.simplecast.com/EmVW7VGp"><span class="starter-chip-name">Radiolab</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://www.deutschlandfunk.de/forschung-aktuell-102.xml"><span class="starter-chip-name">Forschung aktuell (DLF)</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://www.ndr.de/nachrichten/info/podcast4696.xml"><span class="starter-chip-name">ARD Klima-Update</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://feeds.simplecast.com/NM3_bR51"><span class="starter-chip-name">ZEIT WISSEN</span><span class="starter-chip-add">+ Follow</span></div>
            <div class="starter-suggestion-chip" data-feed="https://podcasts.files.bbci.co.uk/w13xtvb6.rss"><span class="starter-chip-name">The Climate Question (BBC)</span><span class="starter-chip-add">+ Follow</span></div>
          </div>
        </div>
      </div>
    `;
  }

  appendTimelineBatch() {
    const container = this.elements.timelineList;
    if (!container) return;

    const existingSentinel = document.getElementById('timeline-sentinel');
    if (existingSentinel) existingSentinel.remove();

    const start = (this.state.timelinePage - 1) * this.state.pageSize;
    const end = this.state.timelinePage * this.state.pageSize;
    const batch = this.state.filteredEpisodes.slice(start, end);

    const frag = document.createDocumentFragment();
    batch.forEach(ep => {
      frag.appendChild(this.createEpisodeCard(ep));
    });
    container.appendChild(frag);

    if (end < this.state.filteredEpisodes.length) {
      const sentinel = document.createElement('div');
      sentinel.id = 'timeline-sentinel';
      sentinel.className = 'timeline-sentinel';
      container.appendChild(sentinel);
      this.setupSentinelObserver(sentinel);
    }
  }

  setupSentinelObserver(sentinel) {
    if (this.sentinelObserver) this.sentinelObserver.disconnect();
    this.sentinelObserver = new IntersectionObserver((entries) => {
      if (entries[0] && entries[0].isIntersecting) {
        this.sentinelObserver.disconnect();
        this.state.timelinePage++;
        this.appendTimelineBatch();
      }
    }, { rootMargin: '400px' });
    this.sentinelObserver.observe(sentinel);
  }

  // ── Empty-state wiring ──────────────────────────────────────────────────

  wireEmptyStateEvents() {
    const quickForm = document.getElementById('empty-quick-form');
    const quickInput = document.getElementById('empty-quick-input');
    const quickSubmit = document.getElementById('btn-empty-quick-submit');
    const quickResults = document.getElementById('empty-quick-results');

    if (quickInput && quickForm) {
      quickInput.addEventListener('input', () => {
        const val = quickInput.value.trim();
        if (quickSubmit) {
          if (val.startsWith('http://') || val.startsWith('https://')) {
            quickSubmit.textContent = 'Add Feed';
          } else {
            quickSubmit.textContent = 'Search';
          }
        }
        if (this.emptySearchDebounceTimer) clearTimeout(this.emptySearchDebounceTimer);
        if (!val) {
          if (quickResults) quickResults.innerHTML = '';
          return;
        }
        if (val.startsWith('http://') || val.startsWith('https://')) {
          if (quickResults) quickResults.innerHTML = '';
          return;
        }
        this.emptySearchDebounceTimer = setTimeout(() => {
          if (quickResults) {
            this.app.feeds.searchPodcastDirectory(val, quickResults);
          }
        }, 350);
      });

      quickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = quickInput.value.trim();
        if (!val) return;
        if (val.startsWith('http://') || val.startsWith('https://')) {
          if (quickSubmit) quickSubmit.textContent = 'Adding...';
          this.app.feeds.addFeed(val);
          quickInput.value = '';
          if (quickResults) quickResults.innerHTML = '';
        } else {
          if (this.emptySearchDebounceTimer) clearTimeout(this.emptySearchDebounceTimer);
          if (quickResults) {
            this.app.feeds.searchPodcastDirectory(val, quickResults);
          }
        }
      });
    }

    document.getElementById('btn-empty-opml-trigger')?.addEventListener('click', () => {
      this.elements.opmlFileInput?.click();
    });

    const emptyCatChips = this.elements.timelineList?.querySelectorAll('#empty-category-chips .category-chip');
    if (emptyCatChips && quickInput && quickResults) {
      emptyCatChips.forEach(chip => {
        chip.addEventListener('click', () => {
          const cat = chip.dataset.category;
          quickInput.value = cat;
          if (quickSubmit) quickSubmit.textContent = 'Search';
          this.app.feeds.searchPodcastDirectory(cat, quickResults);
        });
      });
    }
  }

  // ── Episode cards ───────────────────────────────────────────────────────

  toggleMarkPlayed(ep) {
    const current = this.state.playbackPositions[ep.guid];
    const isCompleted = current && (current.completed === 1 || current.completed === true);
    if (isCompleted) {
      this.app.sync.savePlaybackPositionToServer(ep.guid, 0, false);
    } else {
      this.app.sync.savePlaybackPositionToServer(ep.guid, 0, true);
      if (this.app.queue.isEpisodeQueued(ep.guid)) {
        this.app.queue.removeFromQueue(ep.guid);
      }
    }
    this.renderContinueShelf();

    const cards = document.querySelectorAll(`.episode-card[data-guid="${ep.guid}"]`);
    cards.forEach(card => {
      card.classList.toggle('is-played', !isCompleted);
      const checkBtn = card.querySelector('.btn-mark-played');
      if (checkBtn) {
        checkBtn.classList.toggle('is-completed', !isCompleted);
        checkBtn.innerHTML = !isCompleted ? this.config.cardIcons.CHECK_FILLED : this.config.cardIcons.CHECK;
        checkBtn.title = !isCompleted ? 'Mark as Unplayed' : 'Mark as Played';
      }
    });

    if (this.state.filterMode === 'unplayed' || this.state.filterMode === 'continue' || this.state.filterMode === 'played') {
      this.processAndSortEpisodes();
      this.renderTimeline();
    }
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
      this.elements.showNotesContent.innerHTML = this.formatShowNotesHtml(rawContent);

      this.elements.showNotesContent.querySelectorAll('.note-timestamp').forEach(btn => {
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

  setupProgressTrackInteractivity(progressTrack, card, ep) {
    if (!progressTrack) return;
    let isDragging = false;

    const handleScrub = (clientX, commit) => {
      const rect = progressTrack.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const pct = Math.round(ratio * 100);
      const fillEl = progressTrack.querySelector('.ep-progress-fill');
      if (fillEl) fillEl.style.width = `${pct}%`;

      let totalDur = 0;
      if (this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid) {
        if (this.state.activeEngine === 'audio' && this.elements.audio.duration && !isNaN(this.elements.audio.duration) && isFinite(this.elements.audio.duration)) {
          totalDur = this.elements.audio.duration;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getDuration) {
          totalDur = this.state.ytPlayer.getDuration() || 0;
        }
      }
      if (!totalDur && ep.duration) {
        totalDur = parseDurationSeconds(ep.duration);
      }

      if (totalDur > 0) {
        const targetTime = Math.round(ratio * totalDur);
        const resumeBadge = card.querySelector('.ep-resume-time');
        if (resumeBadge) resumeBadge.textContent = `• Resumes at ${formatTime(targetTime)}`;

        if (commit) {
          this.state.playbackPositions[ep.guid] = {
            position: targetTime,
            completed: false,
            lastListenedAt: Math.floor(Date.now() / 1000)
          };
          this.app.storage.savePositions(this.state.playbackPositions);

          if (this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid) {
            if (this.state.activeEngine === 'audio') {
              this.elements.audio.currentTime = targetTime;
              if (this.elements.audio.paused) {
                this.elements.audio.play().catch(() => {});
                this.state.playbackStatus = 'playing';
                this.app.playback.syncPlaybackButtons();
              }
            } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.seekTo) {
              this.state.ytPlayer.seekTo(targetTime, true);
              this.state.ytPlayer.playVideo();
              this.state.playbackStatus = 'playing';
              this.app.playback.syncPlaybackButtons();
            }
          } else {
            this.app.playback.playEpisode(ep, targetTime);
          }
        }
      } else if (commit) {
        if (!this.state.currentEpisode || this.state.currentEpisode.guid !== ep.guid) {
          this.app.playback.playEpisode(ep);
        } else if (this.state.activeEngine === 'audio' && this.elements.audio.paused) {
          this.elements.audio.play().catch(() => {});
          this.state.playbackStatus = 'playing';
          this.app.playback.syncPlaybackButtons();
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.playVideo) {
          this.state.ytPlayer.playVideo();
          this.state.playbackStatus = 'playing';
          this.app.playback.syncPlaybackButtons();
        }
      }
    };

    progressTrack.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      isDragging = true;
      try { progressTrack.setPointerCapture(e.pointerId); } catch (_) {}
      handleScrub(e.clientX, false);
    });

    progressTrack.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      e.stopPropagation();
      handleScrub(e.clientX, false);
    });

    progressTrack.addEventListener('pointerup', (e) => {
      if (!isDragging) return;
      e.stopPropagation();
      isDragging = false;
      try { progressTrack.releasePointerCapture(e.pointerId); } catch (_) {}
      handleScrub(e.clientX, true);
    });

    progressTrack.addEventListener('pointercancel', (e) => {
      if (!isDragging) return;
      isDragging = false;
      try { progressTrack.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    progressTrack.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  createEpisodeCard(ep) {
    const isCurrentlyActive = this.state.currentEpisode && this.state.currentEpisode.guid === ep.guid;
    const isPlaying = isCurrentlyActive && this.state.playbackStatus === 'playing';
    const isLoading = isCurrentlyActive && this.state.playbackStatus === 'loading';
    const isQueued = this.app.queue.isEpisodeQueued(ep.guid);

    const savedPos = this.state.playbackPositions[ep.guid];
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
    card.dataset.guid = ep.guid;

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

    const isDownloaded = !!this.state.downloadedEpisodes[ep.guid];
    const isDownloading = this.state.downloadingGuids.has(ep.guid);
    let dlIcon = this.config.cardIcons.DOWNLOAD;
    let dlTitle = 'Download for offline';
    if (isDownloading) {
      dlIcon = this.config.cardIcons.DOWNLOAD_SPINNER;
      dlTitle = 'Downloading...';
    } else if (isDownloaded) {
      dlIcon = this.config.cardIcons.DOWNLOADED;
      dlTitle = 'Downloaded (Click to remove)';
    }

    const downloadBtnHtml = ep.isYouTube ? '' : `
      <button class="btn-download-ep ${isDownloaded ? 'is-downloaded' : ''} ${isDownloading ? 'is-downloading' : ''}" title="${dlTitle}">
        ${dlIcon}
      </button>
    `;

    card.innerHTML = `
      <div class="episode-card-top">
        <img class="episode-artwork" src="${ep.artwork || FALLBACK_ARTWORK}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_ARTWORK}';">
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
          ${downloadBtnHtml}
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

    const descEl = card.querySelector('.episode-desc');
    if (descEl) {
      descEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openShowNotes(ep);
      });
    }

    const titleEl = card.querySelector('.episode-title');
    if (titleEl) {
      titleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openShowNotes(ep);
      });
    }

    const podNameEl = card.querySelector('.episode-podcast-name');
    if (podNameEl && ep.feedUrl) {
      podNameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.feeds.openFeedDetail(ep.feedUrl);
      });
    }

    const dlBtn = card.querySelector('.btn-download-ep');
    if (dlBtn) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.state.downloadedEpisodes[ep.guid]) {
          this.app.downloads.removeDownloadedEpisode(ep.guid);
        } else {
          this.app.downloads.downloadEpisode(ep);
        }
      });
    }

    card.querySelector('.btn-play-ep').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.playback.toggleEpisodePlayback(ep);
    });

    card.querySelector('.btn-queue-ep').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.queue.toggleEpisodeQueue(ep);
    });

    card.querySelector('.btn-mark-played').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMarkPlayed(ep);
    });

    const progressTrack = card.querySelector('.ep-progress-track');
    if (progressTrack) {
      this.setupProgressTrackInteractivity(progressTrack, card, ep);
    }

    const resumeBadge = card.querySelector('.ep-resume-time');
    if (resumeBadge) {
      resumeBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.playback.toggleEpisodePlayback(ep);
      });
    }

    return card;
  }

  // ── Event wiring ────────────────────────────────────────────────────────

  wireEvents() {
    if (this.elements.filterChips) {
      this.elements.filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
          this.elements.filterChips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          this.state.filterMode = chip.dataset.filter || 'all';
          this.processAndSortEpisodes();
          this.renderTimeline();
        });
      });
    }

    if (this.elements.searchInput) {
      this.elements.searchInput.addEventListener('input', (e) => {
        this.state.searchQuery = e.target.value;
        this.processAndSortEpisodes();
        this.renderTimeline();
        this.app.feeds.renderFeedsGrid();
        if (this.state.activeFeedDetailUrl) {
          this.app.feeds.renderFeedDetail(this.state.activeFeedDetailUrl);
        }
        this.app.downloads.renderOfflineStorageSettings();
      });
    }

    if (this.elements.sortOrderSelect) {
      this.elements.sortOrderSelect.addEventListener('change', (e) => {
        this.state.sortOrder = e.target.value;
        this.processAndSortEpisodes();
        this.renderTimeline();
        if (this.state.activeFeedDetailUrl) {
          this.app.feeds.renderFeedDetail(this.state.activeFeedDetailUrl);
        }
      });
    }

    if (this.elements.btnToggleContinue) {
      this.elements.btnToggleContinue.addEventListener('click', () => {
        this.state.continueCollapsed = !this.state.continueCollapsed;
        this.renderContinueShelf();
      });
    }

    if (this.elements.btnPlayerNotes) {
      this.elements.btnPlayerNotes.addEventListener('click', () => this.openShowNotes());
    }
    if (this.elements.playerTrackInfo) {
      this.elements.playerTrackInfo.addEventListener('click', () => this.openShowNotes());
    }
    if (this.elements.btnCloseNotes) {
      this.elements.btnCloseNotes.addEventListener('click', () => this.closeShowNotes());
    }
    if (this.elements.showNotesModal) {
      this.elements.showNotesModal.addEventListener('click', (e) => {
        if (e.target === this.elements.showNotesModal) this.closeShowNotes();
      });
    }

    this.wireEmptyStateEvents();
  }
}

export default TimelineManager;
