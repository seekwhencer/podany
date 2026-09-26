// state.js — Podany AppState
// Central mutable application state. Replaces the former top-level `state`
// object. All managers read/write through this single instance.

export class AppState {
  constructor() {
    this.sessionToken = '';
    this.userEmail = '';
    this.feeds = [];
    this.feedMetadata = {};
    this.feedIdByUrl = {};
    this.allEpisodes = [];
    this.filteredEpisodes = [];
    this.playbackPositions = {};
    this.currentEpisode = null;
    this.playbackSpeed = 1.0;
    this.sortOrder = 'newest';
    this.searchQuery = '';
    this.filterMode = 'unplayed';
    this.ytPlayer = null;
    this.ytReady = false;
    this.activeEngine = 'audio';
    this.playbackStatus = 'idle';
    this.timelinePage = 1;
    this.pageSize = 30;
    this.activeFeedDetailUrl = null;
    this.navHistory = [];          // stack of { tab, feedUrl } entries for back navigation
    this.continueCollapsed = true;
    this.playerCollapsed = false;
    this.queue = [];
    this.feedToDelete = null;
    this.pendingYouTubePlay = null;
    this.pendingStartTime = null;
    this.sleepTimer = {
      active: false,
      minutes: 0,
      endTime: null,
      intervalId: null,
      fadeout: true,
      initialVolume: 1.0
    };
  }

  reset() {
    this.sessionToken = '';
    this.userEmail = '';
    this.feeds = [];
    this.feedMetadata = {};
    this.feedIdByUrl = {};
    this.allEpisodes = [];
    this.filteredEpisodes = [];
    this.playbackPositions = {};
    this.currentEpisode = null;
    this.playbackStatus = 'idle';
    this.queue = [];
    this.activeFeedDetailUrl = null;
    this.navHistory = [];
    this.playerCollapsed = false;
    this.sleepTimer = {
      active: false,
      minutes: 0,
      endTime: null,
      intervalId: null,
      fadeout: true,
      initialVolume: 1.0
    };
  }
}

export default AppState;
