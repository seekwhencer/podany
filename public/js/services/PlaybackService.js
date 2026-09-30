// playback.js — Podany PlaybackService
// Audio + YouTube engines, playback control, progress/duration tracking,
// player-UI sync, and the sleep timer.

import { formatTime } from '../utils.js';
import { FALLBACK_ARTWORK, artworkUrl } from '../Config.js';

export class PlaybackService {
    constructor(app) {
        this.app = app;
        this.state = app.state;
        // Audio + YouTube engines are PlaybackService-owned resources (§5). The
        // handles are passed in via app.dom (fetched once in main.js); this
        // service stays DOM-free and never queries the global document.
        this.audio = app.dom.audio;
        this.ytPlayerContainer = app.dom.ytPlayerContainer;
        this.ytPlayerEl = app.dom.ytPlayer;
        this.config = app.config;
        this.storage = app.storage;
        this.state.ytScriptTagAdded = false;
    }

    // ── YouTube ─────────────────────────────────────────────────────────────

    handleYouTubeStateChange(event) {
        if (this.state.activeEngine === 'youtube') {
            const ytBuffering = window.YT ? YT.PlayerState.BUFFERING : 3;
            const ytPlaying = window.YT ? YT.PlayerState.PLAYING : 1;
            const ytPaused = window.YT ? YT.PlayerState.PAUSED : 2;
            const ytEnded = window.YT ? YT.PlayerState.ENDED : 0;
            if (event.data === ytBuffering) {
                this._setStatus('loading');
            } else if (event.data === ytPlaying) {
                this._setStatus('playing');
            } else if (event.data === ytPaused) {
                this._setStatus('paused');
            } else if (event.data === ytEnded) {
                this._setStatus('idle');
                this.onEpisodeEnded();
            }
        }
    }

    initYouTubePlayer() {
        if (this.state.ytPlayer || !window.YT || !window.YT.Player) return;
        const playerTarget = this.ytPlayerEl;
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
                    this.state.notify('ytReady');
                    if (this.state.pendingYouTubePlay) {
                        const pending = this.state.pendingYouTubePlay;
                        this.state.pendingYouTubePlay = null;
                        this.state.notify('pendingYouTubePlay');
                        this.playEpisode(pending.episode, pending.startTime);
                    }
                },
                onStateChange: this.handleYouTubeStateChange.bind(this),
                onError: () => {
                    this._setStatus('paused');
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
        const audio = this.audio;

        const applyPendingAudioSeek = () => {
            if (this.state.pendingStartTime === null || this.state.pendingStartTime === undefined || this.state.pendingStartTime <= 0) return;
            const target = this.state.pendingStartTime;
            try {
                if (audio.seekable && audio.seekable.length > 0) {
                    audio.currentTime = target;
                    this.state.pendingStartTime = null;
                    this.state.notify('pendingStartTime');
                } else if (audio.duration && audio.duration > 0 && isFinite(audio.duration)) {
                    audio.currentTime = Math.min(target, audio.duration);
                    this.state.pendingStartTime = null;
                    this.state.notify('pendingStartTime');
                } else if (audio.readyState >= 1) {
                    audio.currentTime = target;
                    this.state.pendingStartTime = null;
                    this.state.notify('pendingStartTime');
                }
            } catch (_) { }
        };

        audio.addEventListener('timeupdate', () => {
            if (this.state.activeEngine === 'audio') this._updateLivePlayback();
        });
        audio.addEventListener('loadedmetadata', () => {
            applyPendingAudioSeek();
            if (this.state.activeEngine === 'audio') this._updateLivePlayback();
        });
        audio.addEventListener('ended', () => {
            if (this.state.activeEngine === 'audio') {
                this._setStatus('idle');
                this.onEpisodeEnded();
            }
        });
        audio.addEventListener('loadstart', () => {
            if (this.state.activeEngine === 'audio' && !audio.paused) {
                this._setStatus('loading');
            }
        });
        audio.addEventListener('waiting', () => {
            if (this.state.activeEngine === 'audio') {
                this._setStatus('loading');
            }
        });
        audio.addEventListener('canplay', () => {
            applyPendingAudioSeek();
            if (this.state.activeEngine === 'audio' && !audio.paused) {
                this._setStatus('playing');
            }
        });
        audio.addEventListener('playing', () => {
            applyPendingAudioSeek();
            if (this.state.activeEngine === 'audio') {
                this._setStatus('playing');
            }
        });
        audio.addEventListener('play', () => {
            if (this.state.activeEngine === 'audio') {
                if (this.state.playbackStatus !== 'playing') {
                    this._setStatus('loading');
                }
            }
        });
        audio.addEventListener('pause', () => {
            if (this.state.activeEngine === 'audio') {
                this._setStatus('paused');
            }
        });
        audio.addEventListener('error', () => {
            if (this.state.activeEngine === 'audio') {
                if (this.state.currentEpisode && this.state.currentEpisode.locallyAvailable) {
                    this._setStatus('paused');
                    return;
                }
                if (this.state.currentEpisode && !audio.src.includes('/api/audio-proxy')) {
                    const proxySrc = `/api/audio-proxy?url=${encodeURIComponent(this.state.currentEpisode.audioUrl)}`;
                    audio.src = proxySrc;
                    audio.play().catch(() => { });
                    return;
                }
                this._setStatus('paused');
            }
        });

        // NOTE: transport controls (play/pause, skip ±15s, speed, seek, collapse)
        // are now owned by PlayerBarComponent / PlaybackControls, which drive the
        // engine via the DOM-free service methods (skipSeconds / seekToPct /
        // cyclePlaybackSpeed). The legacy static player bar is hidden (Phase 6) so
        // its button wiring is intentionally removed here.

        setInterval(() => {
            if (this.state.currentEpisode && this.isEnginePlaying()) {
                let currentPos = 0;
                if (this.state.activeEngine === 'audio') {
                    currentPos = this.audio.currentTime || 0;
                } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
                    currentPos = this.state.ytPlayer.getCurrentTime() || 0;
                }
                if (currentPos > 3) {
                    this.app.sync.savePlaybackPositionToServer(this.state.currentEpisode.id, currentPos);
                }
            }
        }, 8000);

        setInterval(() => {
            if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
                this._updateLivePlayback();
            }
        }, 500);

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
            return !this.audio.paused;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getPlayerState) {
            return this.state.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
        }
        return false;
    }

    playCurrentEngine() {
        if (this.state.activeEngine === 'audio') {
            this.audio.play();
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer) {
            this.state.ytPlayer.playVideo();
        }
    }

    resumeCurrentEngine() {
        this.playCurrentEngine();
    }

    pauseCurrentEngine() {
        if (this.state.activeEngine === 'audio') {
            this.audio.pause();
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer) {
            this.state.ytPlayer.pauseVideo();
        }
    }

    // Engine control used by PlaybackControls (skip ±N seconds). No DOM access.
    skipSeconds(delta) {
        if (this.state.activeEngine === 'audio') {
            this.audio.currentTime = Math.max(0, (this.audio.currentTime || 0) + delta);
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
            const cur = this.state.ytPlayer.getCurrentTime();
            if (this.state.ytPlayer.getDuration) {
                const dur = this.state.ytPlayer.getDuration();
                this.state.ytPlayer.seekTo(Math.max(0, Math.min(dur, cur + delta)), true);
            } else {
                this.state.ytPlayer.seekTo(Math.max(0, cur + delta), true);
            }
        }
    }

    // Engine control used by PlaybackControls (scrub to a percentage 0..100).
    seekToPct(pct) {
        const clamped = Math.max(0, Math.min(100, pct));
        if (this.state.activeEngine === 'audio' && this.audio) {
            const dur = this.audio.duration;
            if (dur && isFinite(dur)) this.audio.currentTime = (clamped / 100) * dur;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getDuration) {
            const dur = this.state.ytPlayer.getDuration();
            if (dur) this.state.ytPlayer.seekTo((clamped / 100) * dur, true);
        }
    }

    // Engine control used by ShowNotesComponent (jump to an exact timestamp).
    seekToTime(seconds) {
        const t = Math.max(0, seconds);
        if (this.state.activeEngine === 'audio' && this.audio) {
            this.audio.currentTime = t;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.seekTo) {
            this.state.ytPlayer.seekTo(t, true);
        }
    }

    toggleEpisodePlayback(episode) {
        if (this.state.currentEpisode && this.state.currentEpisode.guid === episode.guid) {
            if (this.state.playbackStatus === 'playing') {
                this._setStatus('paused');
                this.syncPlaybackButtons();
                this.pauseCurrentEngine();
            } else {
                this._setStatus('loading');
                this.syncPlaybackButtons();
                this.playCurrentEngine();
            }
        } else {
            this.state.currentEpisode = episode;
            this.state.notify('currentEpisode');
            this._setStatus('loading');
            this.syncPlaybackButtons();
            this.playEpisode(episode);
        }
    }

    playEpisode(episode, overrideStartTime) {
        this.state.currentEpisode = episode;
        this.state.notify('currentEpisode');
        this._setStatus('loading');
        this.syncPlaybackButtons();

        this.audio.pause();
        if (this.state.ytPlayer && this.state.ytPlayer.stopVideo) {
            this.state.ytPlayer.stopVideo();
        }

        const savedPos = this.state.playbackPositions[episode.id];
        let startTime = 0;
        if (typeof overrideStartTime === 'number') {
            startTime = overrideStartTime;
        } else {
            startTime = (savedPos && savedPos.position > 1) ? savedPos.position : 0;
        }

        this.state.playbackPositions[episode.id] = {
            position: startTime || 2,
            completed: false,
            lastListenedAt: Math.floor(Date.now() / 1000)
        };
        this.state.notify('playbackPositions');
        this.storage.savePositions(this.state.playbackPositions);

        if (this.app.queue.isEpisodeQueued(episode.id)) {
            this.state.queue = this.state.queue.filter(q => q.id !== episode.id);
            this.state.notify('queue');
            this.app.queue.saveQueue();
            this.app.queue.updateQueueUI();
        }

        if (this.state.filterMode === 'unplayed' || this.state.filterMode === 'continue') {
            this.app.timeline.processAndSortEpisodes();
            this.app.timeline.renderTimeline();
        }

        if (episode.isYouTube || episode.videoId || episode.playlistId) {
            this.state.activeEngine = 'youtube';
            this.state.notify('activeEngine');
            if (this.state.ytPlayer && typeof this.state.ytPlayer.loadVideoById === 'function') {
                if (episode.isYouTubePlaylist && episode.playlistId) {
                    this.state.ytPlayer.loadPlaylist({ list: episode.playlistId, listType: 'playlist' });
                } else if (episode.videoId) {
                    this.state.ytPlayer.loadVideoById({ videoId: episode.videoId, startSeconds: startTime || 0 });
                }
                if (this.state.ytPlayer.playVideo) this.state.ytPlayer.playVideo();
                if (this.state.ytPlayer.setPlaybackRate) this.state.ytPlayer.setPlaybackRate(this.state.playbackSpeed);
            } else if (window.YT && window.YT.Player) {
                const container = this.ytPlayerContainer;
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
                            this.state.notify('ytReady');
                            if (startTime > 0 && event.target.seekTo) {
                                event.target.seekTo(startTime, true);
                            }
                            if (event.target.playVideo) event.target.playVideo();
                            if (event.target.setPlaybackRate) event.target.setPlaybackRate(this.state.playbackSpeed);
                        },
                        onStateChange: this.handleYouTubeStateChange.bind(this),
                        onError: () => {
                            this._setStatus('paused');
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
                this.state.notify('pendingYouTubePlay');
                if (!this.state.ytScriptTagAdded) {
                    const s = document.createElement('script');
                    s.src = 'https://www.youtube.com/iframe_api';
                    document.head.appendChild(s);
                    this.state.ytScriptTagAdded = true;
                }
            }
        } else {
            this.state.activeEngine = 'audio';
            this.state.notify('activeEngine');
            let streamUrl;
            if (episode.locallyAvailable) {
                streamUrl = `/api/downloads/serve/${encodeURIComponent(episode.id)}`;
            } else if (window.location.protocol === 'https:' && episode.audioUrl.startsWith('http://')) {
                streamUrl = `/api/audio-proxy?url=${encodeURIComponent(episode.audioUrl)}`;
            } else {
                streamUrl = episode.audioUrl;
            }
            this.audio.src = streamUrl;
            this.audio.playbackRate = this.state.playbackSpeed;
            this.state.pendingStartTime = startTime > 0 ? startTime : null;
            this.state.notify('pendingStartTime');
            if (startTime > 0) {
                try {
                    this.audio.currentTime = startTime;
                } catch (_) { }
            }
            this.audio.play().catch(e => {
                this._setStatus('paused');
                this.syncPlaybackButtons();
            });
        }

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: episode.title,
                artist: episode.podcastTitle,
                artwork: episode.image ? [{ src: artworkUrl(episode.image, 'full'), sizes: '512x512', type: 'image/jpeg' }] : []
            });
        }

        // Player visibility / collapse are projected by PlayerBarComponent + AppShell
        // from app.state (currentEpisode / playerCollapsed); this service stays
        // DOM-free and only controls the audio/YouTube engine here.
    }

    // Compute live playback position/duration/progress and push it into
    // app.state.livePlayback so PlayerBarComponent / PlaybackControls can project
    // the live fill. Runs on audio 'timeupdate' and the YouTube poll interval.
    // The sleep-timer fade-out (volume) is engine control and stays here.
    _updateLivePlayback() {
        let current = 0;
        let total = 0;

        if (this.state.activeEngine === 'audio') {
            current = this.audio.currentTime || 0;
            total = this.audio.duration || 0;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
            current = this.state.ytPlayer.getCurrentTime() || 0;
            total = this.state.ytPlayer.getDuration() || 0;
        }

        const progress = total > 0 ? (current / total) * 100 : 0;
        this.state.livePlayback = { currentTime: current, duration: total, progress };
        this.state.notify('livePlayback');

        if (this.state.sleepTimer.active && this.state.sleepTimer.fadeout && this.state.sleepTimer.endTime) {
            const remainingSec = Math.max(0, (this.state.sleepTimer.endTime - Date.now()) / 1000);
            if (remainingSec <= 30 && remainingSec > 0) {
                if (this.state.activeEngine === 'audio') {
                    this.audio.volume = Math.max(0, (remainingSec / 30) * this.state.sleepTimer.initialVolume);
                } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer) {
                    this.state.ytPlayer.setVolume(Math.max(0, (remainingSec / 30) * 100));
                }
            }
        }
    }

    // Duration is projected by the PlayerBar from app.state.livePlayback.duration.
    // This only refreshes the episode.duration data field used by cards.
    updateDuration() {
        let dur = 0;
        if (this.state.activeEngine === 'audio') {
            dur = this.audio.duration;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getDuration) {
            dur = this.state.ytPlayer.getDuration();
        }
        if (dur && isFinite(dur) && dur > 0) {
            const formatted = formatTime(dur);
            if (this.state.currentEpisode) {
                this.state.currentEpisode.duration = formatted;
                const matchAll = this.state.allEpisodes.find(e => e.guid === this.state.currentEpisode.guid);
                if (matchAll) matchAll.duration = formatted;
                const matchFiltered = this.state.filteredEpisodes.find(e => e.guid === this.state.currentEpisode.guid);
                if (matchFiltered) matchFiltered.duration = formatted;
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
                const pos = this.state.playbackPositions[ep.id];
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
            if (this.state.activeFeedDetailId) {
                this.app.feeds.renderFeedDetail(this.state.activeFeedDetailId);
            }
        } else {
            this._setStatus('idle');
            this.syncPlaybackButtons();
        }
    }

    onEpisodeEnded() {
        if (this.state.currentEpisode) {
            this.app.sync.savePlaybackPositionToServer(this.state.currentEpisode.id, 0, true);
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
            this.app.sync.savePlaybackPositionToServer(curEp.id, 0, true);
            if (this.app.queue.isEpisodeQueued(curEp.id)) {
                this.app.queue.removeFromQueue(curEp.id);
            }
        } else {
            let curPos = 0;
            if (this.state.activeEngine === 'audio' && this.audio) {
                curPos = this.audio.currentTime || 0;
            } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.getCurrentTime) {
                curPos = this.state.ytPlayer.getCurrentTime() || 0;
            }
            if (curPos > 2) {
                this.app.sync.savePlaybackPositionToServer(curEp.id, curPos, false);
            }
        }
        this.playNextEpisode();
    }

    // ── Player UI sync ──────────────────────────────────────────────────────

    // Set playback status and notify subscribers (§7.3) so the PlayerBar
    // component (and any Phase-5 subscriber) projects the change. The legacy
    // player bar is still driven by syncPlaybackButtons() in parallel (Phase 5).
    _setStatus(status) {
        this.state.playbackStatus = status;
        this.state.notify('playbackStatus');
    }

    // DOM-free no-op. Episode cards, feed cards and the PlayerBar project the
    // play/pause/loading state themselves from app.state (currentEpisode +
    // playbackStatus subscriptions). Kept for backward compatibility with legacy
    // callers (auth, modal reset, timeline) so they do not break.
    syncPlaybackButtons() {
        // intentionally empty — state projection is owned by the components
    }

    updatePlayerUI(isPlaying) {
        this._setStatus(isPlaying ? 'playing' : 'paused');
        this.syncPlaybackButtons();
    }

    setPlayerCollapsed(collapsed, save = true) {
        // Body class management (has-mini-player / has-full-player) is owned by
        // AppShell from app.state.playerCollapsed; this service only mutates state.
        if (save) {
            this.state.playerCollapsed = collapsed;
            this.state.notify('playerCollapsed');
        }
    }

    cyclePlaybackSpeed() {
        const speeds = [1.0, 1.25, 1.5, 2.0, 0.8];
        let nextIdx = speeds.indexOf(this.state.playbackSpeed) + 1;
        if (nextIdx >= speeds.length) nextIdx = 0;

        this.state.playbackSpeed = speeds[nextIdx];
        this.state.notify('playbackSpeed');

        if (this.state.activeEngine === 'audio') {
            this.audio.playbackRate = this.state.playbackSpeed;
        } else if (this.state.activeEngine === 'youtube' && this.state.ytPlayer && this.state.ytPlayer.setPlaybackRate) {
            this.state.ytPlayer.setPlaybackRate(this.state.playbackSpeed);
        }
    }

    // ── Sleep timer ─────────────────────────────────────────────────────────

    startSleepTimer(minutes) {
        this.stopSleepTimer();
        if (minutes === 0) return;

        this.state.sleepTimer.active = true;
        this.state.sleepTimer.minutes = minutes;
        this.state.sleepTimer.initialVolume = this.audio.volume || 1.0;

        if (minutes !== 'end' && minutes !== 'end-queue') {
            const ms = minutes * 60 * 1000;
            this.state.sleepTimer.endTime = Date.now() + ms;

            this.state.sleepTimer.intervalId = setInterval(() => {
                const remaining = Math.max(0, this.state.sleepTimer.endTime - Date.now());
                if (remaining <= 0) {
                    this.pauseCurrentEngine();
                    this.audio.volume = this.state.sleepTimer.initialVolume;
                    this.stopSleepTimer();
                }
            }, 1000);
        }

        this.state.notify('sleepTimer');
        this.app.modal.closeSleepTimer();
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
        this.state.notify('sleepTimer');
        this.app.modal.closeSleepTimer();
    }

    // Full engine reset for the global "clear all" flow (ModalService.resetAll):
    // pause audio, clear its source and stop the YouTube player. Kept here because
    // the audio/YouTube engines are PlaybackService-owned resources.
    resetEngines() {
        try { this.audio.pause(); } catch (e) { }
        if (this.audio) this.audio.src = '';
        if (this.state.ytPlayer && this.state.ytPlayer.stopVideo) {
            try { this.state.ytPlayer.stopVideo(); } catch (e) { }
        }
        this.state.playbackStatus = 'idle';
        this.state.notify('playbackStatus');
    }
}

export default PlaybackService;
