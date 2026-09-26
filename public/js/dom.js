// dom.js — Podany Elements (DOM cache)
// Caches all getElementById / querySelector refs once at startup, grouped by
// feature area. Replaces the former top-level `elements` object.

export class Elements {
  constructor() {
    const g = (id) => document.getElementById(id);
    const q = (sel) => document.querySelector(sel);
    const qa = (sel) => document.querySelectorAll(sel);

    // Auth
    this.authModal = g('auth-modal');
    this.btnCloseAuth = g('btn-close-auth');
    this.btnCancelAuth = g('btn-cancel-auth');
    this.magicAuthForm = g('magic-auth-form');
    this.magicEmailInput = g('magic-email-input');
    this.btnSubmitMagic = g('btn-submit-magic');
    this.magicStatusMsg = g('magic-status-msg');
    this.authModalTitle = g('auth-modal-title');
    this.passwordAuthForm = g('password-auth-form');
    this.passwordEmailInput = g('password-email-input');
    this.passwordPasswordInput = g('password-password-input');
    this.btnSubmitPassword = g('btn-submit-password');
    this.passwordStatusMsg = g('password-status-msg');
    this.btnToggleLoginMode = g('btn-toggle-login-mode');
    this.userSyncStatus = g('user-sync-status');
    this.btnShowLogin = g('btn-show-login');
    this.userStatusPill = g('user-status-pill');
    this.statusIndicator = g('status-indicator');
    this.userEmailLabel = g('user-email-label');
    this.btnAccountToggle = g('btn-account-toggle');

    // Confirm modal
    this.confirmModal = g('confirm-modal');
    this.confirmModalMsg = g('confirm-modal-msg');
    this.btnConfirmCancel = g('btn-confirm-cancel');
    this.btnConfirmDelete = g('btn-confirm-delete');

    // Player transport (full bar)
    this.btnPrev15 = g('btn-prev-15');
    this.btnNext15 = g('btn-next-15');
    this.btnSkipEpisode = g('btn-skip-episode');
    this.btnPlayerMarkPlayed = g('btn-player-mark-played');

    // Tabs / panels
    this.tabs = qa('.nav-tab');
    this.panels = qa('.tab-panel');
    this.tabFeeds = g('tab-feeds');
    this.tabTimeline = g('tab-timeline');
    this.tabSettings = g('tab-settings');
    this.panelFeeds = g('panel-feeds');
    this.panelTimeline = g('panel-timeline');
    this.panelFeedDetail = g('panel-feed-detail');
    this.feedDetailHeader = g('feed-detail-header');
    this.feedDetailEpisodes = g('feed-detail-episodes');
    this.themeBtns = qa('.btn-theme');
    this.feedCount = g('feed-count');
    this.btnOpenSettings = g('btn-open-settings');

    // Header controls
    this.searchInput = g('search-input');
    this.sortOrderSelect = g('sort-order');
    this.btnOpenAddModal = g('btn-open-add-modal');
    this.btnRefreshAll = g('btn-refresh-all');
    this.statusBanner = g('status-banner');

    // Timeline / dock
    this.timelineList = g('timeline-list');
    this.feedsGrid = g('feeds-grid');
    this.continueShelf = g('continue-shelf');
    this.continueGrid = g('continue-grid');
    this.continueCount = g('continue-count');
    this.btnToggleContinue = g('btn-toggle-continue');
    this.continueToggleLabel = g('continue-toggle-label');
    this.playedCount = g('played-count');
    this.offlineBadge = g('offline-badge');
    this.filterChips = qa('.chip-filter');
    this.bottomActionDock = g('bottom-action-dock');

    // OPML / storage
    this.opmlFileInput = g('opml-file-input');
    this.btnExportOpml = g('btn-export-opml');
    this.btnLoadDefaults = g('btn-load-defaults');
    this.btnClearStorage = g('btn-clear-storage');

    // Add feed modal
    this.addModal = g('add-modal');
    this.podcastSearchQuery = g('podcast-search-query');
    this.btnSearchDirectory = g('btn-search-directory');
    this.searchDirectoryResults = g('search-directory-results');
    this.feedUrlInput = g('feed-url-input');
    this.btnCloseAdd = g('btn-close-add');
    this.btnCancelAdd = g('btn-cancel-add');
    this.btnSubmitFeed = g('btn-submit-feed');

    // Sleep timer modal
    this.sleepModal = g('sleep-modal');
    this.btnCloseSleep = g('btn-close-sleep');
    this.btnOpenSleep = g('btn-open-sleep');
    this.sleepBadge = g('sleep-badge');
    this.timerBtns = qa('.timer-btn');
    this.fadeoutCheck = g('fadeout-check');

    // Queue modal
    this.btnOpenQueue = g('btn-open-queue');
    this.btnCloseQueue = g('btn-close-queue');
    this.btnClearQueue = g('btn-clear-queue');
    this.queueModal = g('queue-modal');
    this.queueBadge = g('queue-badge');
    this.queueCountBadge = g('queue-count-badge');
    this.queueNowPlayingContainer = g('queue-now-playing-container');
    this.queueItemsContainer = g('queue-items-container');

    // Show notes modal
    this.showNotesModal = g('show-notes-modal');
    this.btnCloseNotes = g('btn-close-notes');
    this.showNotesPodcastTitle = g('show-notes-podcast-title');
    this.showNotesEpisodeTitle = g('show-notes-episode-title');
    this.showNotesMeta = g('show-notes-meta');
    this.showNotesContent = g('show-notes-content');

    // Audio engine + full player bar
    this.audio = g('audio-engine');
    this.playerBar = g('player-bar');
    this.playerTrackInfo = q('.player-track-info');
    this.playerArtwork = g('player-artwork');
    this.playerTitle = g('player-title');
    this.playerPodcast = g('player-podcast');
    this.btnPlayToggle = g('btn-play-toggle');
    this.iconPlay = q('.icon-play');
    this.iconPause = q('.icon-pause');
    this.iconSpinner = q('.icon-spinner');
    this.currentTimeLabel = g('current-time');
    this.totalDurationLabel = g('total-duration');
    this.seekBar = g('seek-bar');
    this.btnSpeedToggle = g('btn-speed-toggle');
    this.btnPlayerNotes = g('btn-player-notes');
    this.btnCollapsePlayer = g('btn-collapse-player');

    // Mini player
    this.playerMini = g('player-mini');
    this.miniExpandZone = g('mini-expand-zone');
    this.miniArtwork = g('mini-artwork');
    this.miniTitle = g('mini-title');
    this.miniPodcast = g('mini-podcast');
    this.miniPlayToggle = g('mini-play-toggle');
    this.miniIconPlay = q('.mini-icon-play');
    this.miniIconPause = q('.mini-icon-pause');
    this.miniIconSpinner = q('.mini-icon-spinner');
    this.miniToggle = g('mini-toggle');
    this.miniProgressFill = g('mini-progress-fill');
  }

  // Convenience: resolve a cached ref by id (used by dynamic lookups).
  byId(id) {
    return document.getElementById(id);
  }
}

export default Elements;
