// playback.js — Podany PlaybackManager
// Audio + YouTube engines, playback control, progress/duration tracking,
// player-UI sync, and the sleep timer.

import { formatTime } from './utils.js';
import { FALLBACK_ARTWORK } from './config.js';

export class PlaybackManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.config = app.config;
    this.storage = app.storage;
  }

  // ── YouTube ─────────────────────────────────────────────────────────────

  handleYouTubeStateChange(event) {
    if (this.state.activeEngine === 'youtube') {
      const ytBuffering = window.YT ? YT.PlayerState.BUFFERING : 3;
      const ytPlaying = window.YT ? YT.PlayerState.PLAYING : 1;
      const ytPaused = window.YT ? YT.PlayerState.PAUSED : 2;
      const ytEnded = window.YT ? YT.PlayerState.ENDED : 0;
      if (event.data === ytBuffering) {
        this.state.playbackStatus = 'loading';
        this.syncPlaybackButtons();
      } else if (event.data === ytPlaying) {
        this.state.playbackStatus = 'playing';
        this.syncPlaybackButtons();
      } else if (event.data === ytPaused) {
        this.state.playbackStatus = 'paused';
        this.syncPlaybackButtons();
      } else if (event.data === ytEnded) {
        this.state.playbackStatus = 'idle';
        this.syncPlaybackButtons();
        this.onEpisodeEnded();
      }
    }
  }

  initYouTubePlayer() {
    if (this.state.ytPlayer || !window.YT || !window.YT.Player) return;
    const playerTarget = document.getElementById('yt-player');
    if (!playerTarget) return;

    this.state.ytPlayer = new YT.Player('yt-player', {
      height: '180',
      width: '320',
      playerVars: {
        autoplay: 0,
        controls: 0,
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin
      },
      events: {
        onReady: (event) => {
          this.state.ytReady = true;
          if (this.state.pendingYouTubePlay) {
            const pending = this.state.pendingYouTubePlay;
            this.state.pendingYouTubePlay = null;
            this.playEpisode(pending.episode, pending.startTime);
          }
        },
        onStateChange: this.handleYouTubeStateChange.bind(this),
        onError: () => {
          this.state.playbackStatus = 'paused';
          this.syncPlaybackButtons();
        }
      }
    });
  }

  onYouTubeIframeAPIReady() {
    this.initYouTubePlayer();
  }

  // ── Audio engine wiring ─────────────────────────────────────────────────

  setupAudioEngines() {
    const audio = this.elements.audio;

    const applyPendingAudioSeek = () => {
      if (this.state.pendingStartTime === null || this.state.pendingStartTime === undefined || this.state.pendingStartTime <= 0) return;
      const target = this.state.pendingStartTime;
      try {
        if (audio.seekable && audio.seekable.length > 0) {
          audio.currentTime = target;
          this.state.pendingStartTime = null;
        } else if (audio.duration && audio.duration > 0 && isFinite(audio.duration)) {
          audio.currentTime = Math.min(target, audio.duration);
          this.state.pendingStartTime = null;
        } else if (audio.readyState >= 1) {
          audio.currentTime = target;
          this.state.pendingStartTime = null;
        }
      } catch (_) {}
    };

    audio.addEventListener('timeupdate', () => {
      if (this.state.activeEngine === 'audio') this.updateProgress();
    });
    audio.addEventListener('loadedmetadata', () => {
      applyPendingAudioSeek();
      if (this.state.activeEngine === 'audio') this.updateDuration();
    });
    audio.addEventListener('ended', () => {
      if (this.state.activeEngine === 'audio') {
        this.state.playbackStatus = 'idle';
        this.syncPlaybackButtons();
        this.onEpisodeEnded();
      }
    });
    audio.addEventListener('loadstart', () => {
      if (this.state.activeEngine === 'audio' && !audio.paused) {
        this.state.playbackStatus = 'loading';
        this.syncPlaybackButtons();
      }
    });
    audio.addEventListener('waiting', () => {
      if (this.state.activeEngine === 'audio') {
        this.state.playbackStatus = 'loading';
        this.syncPlaybackButtons();
      }
    });
    audio.addEventListener('canplay', () => {
      applyPendingAudioSeek();
      if (this.state.activeEngine === 'audio' && !audio.paused) {
        this.state.playbackStatus = 'playing';
        this.syncPlaybackButtons();
      }
    });
    audio.addEventListener('playing', () => {
      applyPendingAudioSeek();
      if (this.state.activeEngine === 'audio') {
        this.state.playbackStatus = 'playing';
        this.syncPlaybackButtons();
      }
    });
    audio.addEventListener('play', () => {
      if (this.state.activeEngine === 'audio') {
        if (this.state.playbackStatus !== 'playing') {
          this.state.playbackStatus = 'loading';
        }
        this.syncPlaybackButtons();
      }
    });
    audio.addEventListener('pause', () => {
      if (this.state.activeEngine === 'audio') {
        this.state.playbackStatus = 'paused';
        this.syncPlaybackButtons();
      }
    });
    audio.addEventListener('error', () => {
      if (this.state.activeEngine === 'audio') {
        if (this.state.currentEpisode && !audio.src.includes('/api/audio-proxy')) {
          const proxySrc = `/api/audio-proxy?url=${encodeURIComponent(this.state.currentEpisode.audioUrl)}`;
          audio.src = proxySrc;
          audio.play().catch(() => {});
          return;
        }
        this.state.playbackStatus = 'paused';
        this.syncPlaybackButtons();
      }
    });

    const handleSeekBarChange = () => {
      const pct = this.elements.seekBar.value / 100;
      this.elements.seekBar.style.setProperty('--seek-pct', `${this.elements.seekBar.value}%`);
      if (this.state.activeEngine === 'audio' && audio.duration && isFinite(audio.duration)) {
        audio.currentTime = pct * audio.duration;
      } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getDuration) {
        const dur = this.state.ytPlayer.getDuration();
        if (dur) this.state.ytPlayer.seekTo(pct * dur, true);
      }
    };
    this.elements.seekBar.addEventListener('input', handleSeekBarChange);
    this.elements.seekBar.addEventListener('change', handleSeekBarChange);

    setInterval(() => {
      if (this.state.currentEpisode && this.isEnginePlaying()) {
        let currentPos = 0;
        if (this.state.activeEngine === 'audio') {
          currentPos = this.elements.audio.currentTime || 0;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
          currentPos = this.state.ytPlayer.getCurrentTime() || 0;
        }
        if (currentPos > 3) {
          this.app.sync.savePlaybackPositionToServer(this.state.currentEpisode.guid, currentPos);
        }
      }
    }, 8000);

    setInterval(() => {
      if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
        this.updateProgress();
        this.updateDuration();
      }
    }, 500);

    this.elements.btnPlayToggle.addEventListener('click', () => {
      if (!this.state.currentEpisode) {
        if (this.state.filteredEpisodes.length > 0) {
          this.toggleEpisodePlayback(this.state.filteredEpisodes[0]);
        }
        return;
      }
      this.toggleEpisodePlayback(this.state.currentEpisode);
    });

    this.elements.btnPrev15.addEventListener('click', () => {
      if (this.state.activeEngine === 'audio') {
        audio.currentTime = Math.max(0, audio.currentTime - 15);
      } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
        const cur = this.state.ytPlayer.getCurrentTime();
        this.state.ytPlayer.seekTo(Math.max(0, cur - 15), true);
      }
    });

    this.elements.btnNext15.addEventListener('click', () => {
      if (this.state.activeEngine === 'audio' && audio.duration) {
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
      } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
        const cur = this.state.ytPlayer.getCurrentTime();
        const dur = this.state.ytPlayer.getDuration();
        this.state.ytPlayer.seekTo(Math.min(dur, cur + 15), true);
      }
    });

    this.elements.btnSpeedToggle.addEventListener('click', () => this.cyclePlaybackSpeed());

    if (this.elements.btnSkipEpisode) {
      this.elements.btnSkipEpisode.addEventListener('click', () => this.skipToNextEpisode(false));
    }
    if (this.elements.btnPlayerMarkPlayed) {
      this.elements.btnPlayerMarkPlayed.addEventListener('click', () => this.skipToNextEpisode(true));
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => this.playCurrentEngine());
      navigator.mediaSession.setActionHandler('pause', () => this.pauseCurrentEngine());
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        if (this.state.activeEngine === 'audio') audio.currentTime = Math.max(0, audio.currentTime - 15);
      });
      navigator.mediaSession.setActionHandler('seekforward', () => {
        if (this.state.activeEngine === 'audio' && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => this.onEpisodeEnded());
    }
  }

  // ── Playback control ────────────────────────────────────────────────────

  isEnginePlaying() {
    if (this.state.activeEngine === 'audio') {
      return !this.elements.audio.paused;
    } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getPlayerState) {
      return this.state.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
    }
    return false;
  }

  playCurrentEngine() {
    if (this.state.activeEngine === 'audio') {
      this.elements.audio.play();
    } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer) {
      this.state.ytPlayer.playVideo();
    }
  }

  resumeCurrentEngine() {
    this.playCurrentEngine();
  }

  pauseCurrentEngine() {
    if (this.state.activeEngine === 'audio') {
      this.elements.audio.pause();
    } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer) {
      this.state.ytPlayer.pauseVideo();
    }
  }

  toggleEpisodePlayback(episode) {
    if (this.state.currentEpisode && this.state.currentEpisode.guid === episode.guid) {
      if (this.state.playbackStatus === 'playing') {
        this.state.playbackStatus = 'paused';
        this.syncPlaybackButtons();
        this.pauseCurrentEngine();
      } else {
        this.state.playbackStatus = 'loading';
        this.syncPlaybackButtons();
        this.playCurrentEngine();
      }
    } else {
      this.state.currentEpisode = episode;
      this.state.playbackStatus = 'loading';
      this.syncPlaybackButtons();
      this.playEpisode(episode);
    }
  }

  playEpisode(episode, overrideStartTime) {
    this.state.currentEpisode = episode;
    this.state.playbackStatus = 'loading';
    this.syncPlaybackButtons();

    this.elements.audio.pause();
    if (this.state.ytPlayer && this.state.ytPlayer.stopVideo) {
      this.state.ytPlayer.stopVideo();
    }

    const savedPos = this.state.playbackPositions[episode.guid];
    let startTime = 0;
    if (typeof overrideStartTime === 'number') {
      startTime = overrideStartTime;
    } else {
      startTime = (savedPos && savedPos.position > 1) ? savedPos.position : 0;
    }

    this.state.playbackPositions[episode.guid] = {
      position: startTime || 2,
      completed: false,
      lastListenedAt: Math.floor(Date.now() / 1000)
    };
    this.storage.savePositions(this.state.playbackPositions);

    if (this.app.queue.isEpisodeQueued(episode.guid)) {
      this.state.queue = this.state.queue.filter(q => q.guid !== episode.guid);
      this.app.queue.saveQueue();
      this.app.queue.updateQueueUI();
    }

    this.app.timeline.renderContinueShelf();
    this.app.timeline.updateFilterBadges();

    if (this.state.filterMode === 'unplayed' || this.state.filterMode === 'continue') {
      this.app.timeline.processAndSortEpisodes();
      this.app.timeline.renderTimeline();
    }

    if (episode.isYouTube || episode.videoId || episode.playlistId) {
      this.state.activeEngine = 'youtube';
      if (this.state.ytPlayer && typeof this.state.ytPlayer.loadVideoById === 'function') {
        if (episode.isYouTubePlaylist && episode.playlistId) {
          this.state.ytPlayer.loadPlaylist({ list: episode.playlistId, listType: 'playlist' });
        } else if (episode.videoId) {
          this.state.ytPlayer.loadVideoById({ videoId: episode.videoId, startSeconds: startTime || 0 });
        }
        if (this.state.ytPlayer.playVideo) this.state.ytPlayer.playVideo();
        if (this.state.ytPlayer.setPlaybackRate) this.state.ytPlayer.setPlaybackRate(this.state.playbackSpeed);
      } else if (window.YT && window.YT.Player) {
        const container = document.getElementById('yt-player-container');
        if (container) {
          container.innerHTML = '<div id="yt-player"></div>';
        }
        const playerConfig = {
          height: '180',
          width: '320',
          playerVars: {
            autoplay: 1,
            controls: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin
          },
          events: {
            onReady: (event) => {
              this.state.ytReady = true;
              if (startTime > 0 && event.target.seekTo) {
                event.target.seekTo(startTime, true);
              }
              if (event.target.playVideo) event.target.playVideo();
              if (event.target.setPlaybackRate) event.target.setPlaybackRate(this.state.playbackSpeed);
            },
            onStateChange: this.handleYouTubeStateChange.bind(this),
            onError: () => {
              this.state.playbackStatus = 'paused';
              this.syncPlaybackButtons();
            }
          }
        };
        if (episode.isYouTubePlaylist && episode.playlistId) {
          playerConfig.playerVars.listType = 'playlist';
          playerConfig.playerVars.list = episode.playlistId;
        } else if (episode.videoId) {
          playerConfig.videoId = episode.videoId;
          if (startTime > 0) {
            playerConfig.playerVars.start = Math.floor(startTime);
          }
        }
        this.state.ytPlayer = new YT.Player('yt-player', playerConfig);
      } else {
        this.state.pendingYouTubePlay = { episode, startTime };
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          document.head.appendChild(s);
        }
      }
    } else {
      this.state.activeEngine = 'audio';
      let streamUrl = episode.audioUrl;
      if (window.location.protocol === 'https:' && streamUrl.startsWith('http://')) {
        streamUrl = `/api/audio-proxy?url=${encodeURIComponent(streamUrl)}`;
      }
      this.elements.audio.src = streamUrl;
      this.elements.audio.playbackRate = this.state.playbackSpeed;
      this.state.pendingStartTime = startTime > 0 ? startTime : null;
      if (startTime > 0) {
        try {
          this.elements.audio.currentTime = startTime;
        } catch (_) {}
      }
      this.elements.audio.play().catch(e => {
        this.state.playbackStatus = 'paused';
        this.syncPlaybackButtons();
      });
    }

    this.elements.playerTitle.textContent = episode.title;
    this.elements.playerPodcast.textContent = episode.podcastTitle;
    this.elements.playerArtwork.src = episode.artwork || FALLBACK_ARTWORK;
    this.elements.playerArtwork.onerror = () => {
      this.elements.playerArtwork.onerror = null;
      this.elements.playerArtwork.src = FALLBACK_ARTWORK;
    };

    if (this.elements.miniTitle) this.elements.miniTitle.textContent = episode.title;
    if (this.elements.miniPodcast) this.elements.miniPodcast.textContent = episode.podcastTitle;
    if (this.elements.miniArtwork) {
      this.elements.miniArtwork.src = episode.artwork || FALLBACK_ARTWORK;
      this.elements.miniArtwork.onerror = () => {
        this.elements.miniArtwork.onerror = null;
        this.elements.miniArtwork.src = FALLBACK_ARTWORK;
      };
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: episode.title,
        artist: episode.podcastTitle,
        artwork: episode.artwork ? [{ src: episode.artwork, sizes: '512x512', type: 'image/png' }] : []
      });
    }

    if (this.elements.playerBar) {
      this.elements.playerBar.classList.add('active-episode');
    }
    document.body.classList.add('has-active-episode');

    const shouldCollapse = localStorage.getItem('podany_player_collapsed') === 'true';
    this.setPlayerCollapsed(shouldCollapse, false);

    this.syncPlaybackButtons();
  }

  updateProgress() {
    let current = 0;
    let total = 0;

    if (this.state.activeEngine === 'audio') {
      current = this.elements.audio.currentTime || 0;
      total = this.elements.audio.duration || 0;
    } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
      current = this.state.ytPlayer.getCurrentTime() || 0;
      total = this.state.ytPlayer.getDuration() || 0;
    }

    this.elements.currentTimeLabel.textContent = formatTime(current);
    if (total > 0) {
      const pct = (current / total) * 100;
      this.elements.seekBar.value = pct;
      this.elements.seekBar.style.setProperty('--seek-pct', `${pct}%`);
      if (this.elements.miniProgressFill) {
        this.elements.miniProgressFill.style.width = `${pct}%`;
      }

      if (this.state.currentEpisode) {
        const activeCards = document.querySelectorAll(`.episode-card[data-guid="${CSS.escape(this.state.currentEpisode.guid)}"]`);
        activeCards.forEach(card => {
          let track = card.querySelector('.ep-progress-track');
          let fill = card.querySelector('.ep-progress-fill');
          if (!track && current > 2) {
            track = document.createElement('div');
            track.className = 'ep-progress-track';
            track.title = 'Click or scrub to resume at any point';
            fill = document.createElement('div');
            fill.className = 'ep-progress-fill';
            track.appendChild(fill);
            const footer = card.querySelector('.episode-footer');
            if (footer) {
              card.insertBefore(track, footer);
              this.app.timeline.setupProgressTrackInteractivity(track, card, this.state.currentEpisode);
            }
          }
          if (fill) {
            fill.style.width = `${Math.min(100, Math.max(1, pct))}%`;
          }
          let resumeBadge = card.querySelector('.ep-resume-time');
          if (!resumeBadge && current > 2) {
            const meta = card.querySelector('.episode-meta');
            if (meta) {
              resumeBadge = document.createElement('span');
              resumeBadge.className = 'ep-resume-time';
              resumeBadge.title = 'Click to resume playback';
              meta.appendChild(resumeBadge);
              resumeBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleEpisodePlayback(this.state.currentEpisode);
              });
            }
          }
          if (resumeBadge) {
            resumeBadge.textContent = `• Resumes at ${formatTime(current)}`;
          }
        });
      }
    }

    if (this.state.sleepTimer.active && this.state.sleepTimer.fadeout && this.state.sleepTimer.endTime) {
      const remainingSec = Math.max(0, (this.state.sleepTimer.endTime - Date.now()) / 1000);
      if (remainingSec <= 30 && remainingSec > 0) {
        if (this.state.activeEngine === 'audio') {
          this.elements.audio.volume = Math.max(0, (remainingSec / 30) * this.state.sleepTimer.initialVolume);
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer) {
          this.state.ytPlayer.setVolume(Math.max(0, (remainingSec / 30) * 100));
        }
      }
    }
  }

  updateDuration() {
    let dur = 0;
    if (this.state.activeEngine === 'audio') {
      dur = this.elements.audio.duration;
    } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getDuration) {
      dur = this.state.ytPlayer.getDuration();
    }
    if (dur && isFinite(dur) && dur > 0) {
      const formatted = formatTime(dur);
      this.elements.totalDurationLabel.textContent = formatted;
      if (this.state.currentEpisode) {
        this.state.currentEpisode.duration = formatted;
        const matchAll = this.state.allEpisodes.find(e => e.guid === this.state.currentEpisode.guid);
        if (matchAll) matchAll.duration = formatted;
        const matchFiltered = this.state.filteredEpisodes.find(e => e.guid === this.state.currentEpisode.guid);
        if (matchFiltered) matchFiltered.duration = formatted;
        const card = document.querySelector(`.episode-card[data-guid="${CSS.escape(this.state.currentEpisode.guid)}"]`);
        if (card) {
          const durBadge = card.querySelector('.episode-duration');
          if (durBadge && (!durBadge.textContent || durBadge.textContent === '0:00')) {
            durBadge.textContent = formatted;
          }
        }
      }
    }
  }

  playNextEpisode() {
    let nextEp = null;
    const currentGuid = this.state.currentEpisode ? this.state.currentEpisode.guid : null;

    if (this.state.queue && this.state.queue.length > 0) {
      nextEp = this.state.queue.shift();
      this.app.queue.saveQueue();
      this.app.queue.updateQueueUI();
    }

    if (!nextEp && this.state.filterMode === 'continue') {
      const continueList = this.state.allEpisodes.filter(ep => {
        const pos = this.state.playbackPositions[ep.guid];
        return (!pos || !pos.completed) && (pos && pos.position > 2);
      });
      const idx = continueList.findIndex(e => e.guid === currentGuid);
      if (idx !== -1 && idx + 1 < continueList.length) {
        nextEp = continueList[idx + 1];
      } else if (continueList.length > 0) {
        nextEp = continueList[0];
      }
    }

    if (!nextEp && this.state.filteredEpisodes.length > 0) {
      const idx = this.state.filteredEpisodes.findIndex(e => e.guid === currentGuid);
      if (idx !== -1 && idx + 1 < this.state.filteredEpisodes.length) {
        nextEp = this.state.filteredEpisodes[idx + 1];
      } else if (idx === -1) {
        nextEp = this.state.filteredEpisodes[0];
      }
    }

    if (!nextEp) {
      const allIdx = this.state.allEpisodes.findIndex(e => e.guid === currentGuid);
      if (allIdx !== -1 && allIdx + 1 < this.state.allEpisodes.length) {
        nextEp = this.state.allEpisodes[allIdx + 1];
      } else if (this.state.allEpisodes.length > 0) {
        nextEp = this.state.allEpisodes[0];
      }
    }

    if (nextEp) {
      this.playEpisode(nextEp);
      this.app.timeline.processAndSortEpisodes();
      this.app.timeline.renderTimeline();
      this.app.timeline.renderContinueShelf();
      if (this.state.activeFeedDetailUrl) {
        this.app.feeds.renderFeedDetail(this.state.activeFeedDetailUrl);
      }
    } else {
      this.state.playbackStatus = 'idle';
      this.syncPlaybackButtons();
    }
  }

  onEpisodeEnded() {
    if (this.state.currentEpisode) {
      this.app.sync.savePlaybackPositionToServer(this.state.currentEpisode.guid, 0, true);
    }

    if (this.state.sleepTimer.active) {
      if (this.state.sleepTimer.minutes === 'end') {
        this.stopSleepTimer();
        this.pauseCurrentEngine();
        return;
      }
      if (this.state.sleepTimer.minutes === 'end-queue') {
        if (!this.state.queue || this.state.queue.length === 0) {
          this.stopSleepTimer();
          this.pauseCurrentEngine();
          return;
        }
      }
    }

    this.playNextEpisode();
  }

  skipToNextEpisode(markCompleted = false) {
    if (!this.state.currentEpisode) return;
    const curEp = this.state.currentEpisode;
    if (markCompleted) {
      this.app.sync.savePlaybackPositionToServer(curEp.guid, 0, true);
      if (this.app.queue.isEpisodeQueued(curEp.guid)) {
        this.app.queue.removeFromQueue(curEp.guid);
      }
    } else {
      let curPos = 0;
      if (this.state.activeEngine === 'audio' && this.elements.audio) {
        curPos = this.elements.audio.currentTime || 0;
      } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
        curPos = this.state.ytPlayer.getCurrentTime() || 0;
      }
      if (curPos > 2) {
        this.app.sync.savePlaybackPositionToServer(curEp.guid, curPos, false);
      }
    }
    this.app.timeline.renderContinueShelf();
    this.playNextEpisode();
  }

  // ── Player UI sync ──────────────────────────────────────────────────────

  syncPlaybackButtons() {
    const isPlaying = this.state.playbackStatus === 'playing';
    const isLoading = this.state.playbackStatus === 'loading';

    if (this.elements.iconPlay && this.elements.iconPause && this.elements.iconSpinner) {
      if (isLoading) {
        this.elements.iconPlay.classList.add('hidden');
        this.elements.iconPause.classList.add('hidden');
        this.elements.iconSpinner.classList.remove('hidden');
      } else if (isPlaying) {
        this.elements.iconPlay.classList.add('hidden');
        this.elements.iconPause.classList.remove('hidden');
        this.elements.iconSpinner.classList.add('hidden');
      } else {
        this.elements.iconPlay.classList.remove('hidden');
        this.elements.iconPause.classList.add('hidden');
        this.elements.iconSpinner.classList.add('hidden');
      }
    }

    if (this.elements.miniIconPlay && this.elements.miniIconPause && this.elements.miniIconSpinner) {
      if (isLoading) {
        this.elements.miniIconPlay.classList.add('hidden');
        this.elements.miniIconPause.classList.add('hidden');
        this.elements.miniIconSpinner.classList.remove('hidden');
      } else if (isPlaying) {
        this.elements.miniIconPlay.classList.add('hidden');
        this.elements.miniIconPause.classList.remove('hidden');
        this.elements.miniIconSpinner.classList.add('hidden');
      } else {
        this.elements.miniIconPlay.classList.remove('hidden');
        this.elements.miniIconPause.classList.add('hidden');
        this.elements.miniIconSpinner.classList.add('hidden');
      }
    }

    const cards = document.querySelectorAll('.episode-card');
    cards.forEach(card => {
      const guid = card.dataset.guid;
      const btn = card.querySelector('.btn-play-ep');
      if (!btn) return;
      if (this.state.currentEpisode && this.state.currentEpisode.guid === guid) {
        card.classList.add('playing');
        if (isLoading) {
          btn.innerHTML = this.config.cardIcons.SPINNER;
          btn.title = 'Loading...';
        } else if (isPlaying) {
          btn.innerHTML = this.config.cardIcons.PAUSE;
          btn.title = 'Pause';
        } else {
          btn.innerHTML = this.config.cardIcons.PLAY;
          btn.title = 'Play';
        }
      } else {
        card.classList.remove('playing');
        btn.innerHTML = this.config.cardIcons.PLAY;
        btn.title = 'Play';
      }
    });

    const recentRows = document.querySelectorAll('.recent-ep-row');
    recentRows.forEach(row => {
      const guid = row.dataset.guid;
      const btn = row.querySelector('.btn-recent-play');
      if (!btn) return;
      if (this.state.currentEpisode && this.state.currentEpisode.guid === guid) {
        row.classList.add('active');
        if (isLoading) {
          btn.innerHTML = `<span class="spinner" style="width: 10px; height: 10px;"></span>`;
          btn.classList.remove('is-playing');
        } else if (isPlaying) {
          btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
          btn.classList.add('is-playing');
        } else {
          btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
          btn.classList.remove('is-playing');
        }
      } else {
        row.classList.remove('active');
        btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
        btn.classList.remove('is-playing');
      }
    });
  }

  updatePlayerUI(isPlaying) {
    this.state.playbackStatus = isPlaying ? 'playing' : 'paused';
    this.syncPlaybackButtons();
  }

  setPlayerCollapsed(collapsed, save = true) {
    if (collapsed) {
      document.body.classList.add('has-mini-player');
      document.body.classList.remove('has-full-player');
      if (this.elements.btnCollapsePlayer) this.elements.btnCollapsePlayer.setAttribute('aria-expanded', 'false');
      if (this.elements.miniToggle) this.elements.miniToggle.setAttribute('aria-expanded', 'false');
    } else {
      document.body.classList.remove('has-mini-player');
      document.body.classList.add('has-full-player');
      if (this.elements.btnCollapsePlayer) this.elements.btnCollapsePlayer.setAttribute('aria-expanded', 'true');
      if (this.elements.miniToggle) this.elements.miniToggle.setAttribute('aria-expanded', 'true');
    }
    if (save) {
      try {
        localStorage.setItem('podany_player_collapsed', collapsed ? 'true' : 'false');
      } catch (e) {}
    }
  }

  cyclePlaybackSpeed() {
    const speeds = [1.0, 1.25, 1.5, 2.0, 0.8];
    let nextIdx = speeds.indexOf(this.state.playbackSpeed) + 1;
    if (nextIdx >= speeds.length) nextIdx = 0;

    this.state.playbackSpeed = speeds[nextIdx];

    if (this.state.activeEngine === 'audio') {
      this.elements.audio.playbackRate = this.state.playbackSpeed;
    } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.setPlaybackRate) {
      this.state.ytPlayer.setPlaybackRate(this.state.playbackSpeed);
    }

    this.elements.btnSpeedToggle.textContent = `${this.state.playbackSpeed}x`;
  }

  // ── Sleep timer ─────────────────────────────────────────────────────────

  startSleepTimer(minutes) {
    this.stopSleepTimer();
    if (minutes === 0) return;

    this.state.sleepTimer.active = true;
    this.state.sleepTimer.minutes = minutes;
    this.state.sleepTimer.initialVolume = this.elements.audio.volume || 1.0;

    if (minutes !== 'end' && minutes !== 'end-queue') {
      const ms = minutes * 60 * 1000;
      this.state.sleepTimer.endTime = Date.now() + ms;

      this.state.sleepTimer.intervalId = setInterval(() => {
        const remaining = Math.max(0, this.state.sleepTimer.endTime - Date.now());
        if (remaining <= 0) {
          this.pauseCurrentEngine();
          this.elements.audio.volume = this.state.sleepTimer.initialVolume;
          this.stopSleepTimer();
        }
      }, 1000);
    }

    this.elements.sleepBadge.classList.remove('hidden');
    this.app.modal.closeSleepModal();
  }

  stopSleepTimer() {
    if (this.state.sleepTimer.intervalId) {
      clearInterval(this.state.sleepTimer.intervalId);
    }
    this.state.sleepTimer = {
      active: false,
      minutes: 0,
      endTime: null,
      intervalId: null,
      fadeout: true,
      initialVolume: 1.0
    };
    this.elements.sleepBadge.classList.add('hidden');
    this.app.modal.closeSleepModal();
  }
}

export default PlaybackManager;
