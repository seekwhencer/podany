// main.js — Podany Frontend Entry Point
// Wires the modularized managers into a single app container and runs the boot
// sequence on DOMContentLoaded. Bundled with esbuild to public/dist/bundle.js.
//
// Managers (each receives the shared `app` container):
//   config, state, elements, api, storage — shared infrastructure
//   theme, modal, playerUI                — shell / UI helpers
//   auth, feeds, playback, queue, sync, downloads, timeline — features

import Config from './config.js';
import AppState from './state.js';
import Elements from './dom.js';
import ApiClient from './api.js';
import Storage from './storage.js';
import ThemeManager from './ui/theme.js';
import ModalManager from './ui/modal.js';
import PlayerUI from './ui/player-ui.js';
import AuthManager from './auth.js';
import FeedsManager from './feeds.js';
import PlaybackManager from './playback.js';
import QueueManager from './queue.js';
import SyncManager from './sync.js';
import DownloadsManager from './downloads.js';
import TimelineManager from './timeline.js';

const app = {};
app.config = new Config();
app.state = new AppState();
app.elements = new Elements();
app.api = new ApiClient(app.config, app.state);
app.storage = new Storage(app.config);
app.theme = new ThemeManager(app);
app.modal = new ModalManager(app);
app.playerUI = new PlayerUI(app);
app.auth = new AuthManager(app);
app.feeds = new FeedsManager(app);
app.playback = new PlaybackManager(app);
app.queue = new QueueManager(app);
app.sync = new SyncManager(app);
app.downloads = new DownloadsManager(app);
app.timeline = new TimelineManager(app);

// ── Boot sequence ───────────────────────────────────────────────────────────

function loadPersistedState() {
    app.state.playbackPositions = app.storage.loadPositions();
    app.state.feeds = app.storage.loadFeeds();

    console.log(app.state.feeds);

    app.auth.checkUrlSessionParam();

    const cache = app.storage.loadCache();
    if (cache.episodes) app.state.allEpisodes = cache.episodes;
    if (cache.metadata) app.state.feedMetadata = cache.metadata;

    app.queue.loadQueue();
    app.downloads.loadDownloads();

    if (app.state.allEpisodes && app.state.allEpisodes.length > 0) {
        app.timeline.processAndSortEpisodes();
        app.timeline.renderTimeline();
        app.timeline.renderContinueShelf();
        app.feeds.renderFeedsGrid();
    }
}

function wireAllEvents() {
    app.theme.wireThemeButtons();
    app.modal.init();
    app.playerUI.init();
    app.auth.wireEvents();
    app.feeds.wireEvents();
    app.queue.wireEvents();
    app.downloads.wireEvents();
    app.timeline.wireEvents();
}

function refreshStaticUI() {
    app.queue.updateQueueUI();
    app.downloads.updateDownloadedCountUI();
    app.feeds.updateFeedCountUI();
    app.feeds.updateDockVisibility();
}

function setupNetworkListeners() {
    const updateStatus = () => {
        if (!app.elements.offlineBadge) return;
        app.elements.offlineBadge.classList.toggle('hidden', navigator.onLine);
    };
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    window.addEventListener('resize', () => {
        if (app.state.continueCollapsed && app.state.allEpisodes.length > 0) {
            app.timeline.renderContinueShelf();
        }
    });
    updateStatus();
}

function initServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => { });
    }
}

app.init = function init() {
    app.theme.init();
    loadPersistedState();
    wireAllEvents();
    app.playback.setupAudioEngines();
    setupNetworkListeners();
    refreshStaticUI();
    initServiceWorker();
    app.modal.initNavigationRoute();
    app.auth.checkAuth();
};

// Wire the YouTube Iframe API callback (loaded as a classic <script> before the
// module bundle). Fires window.onYouTubeIframeAPIReady once the API is ready.
window.onYouTubeIframeAPIReady = () => app.playback.onYouTubeIframeAPIReady();
if (window.YT && window.YT.Player) {
    app.playback.initYouTubePlayer();
}

document.addEventListener('DOMContentLoaded', () => app.init());

export default app;
