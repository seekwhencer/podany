// main.js — Podany Frontend Entry Point
// Wires the modularized managers into a single app container and runs the boot
// sequence on DOMContentLoaded. Bundled with esbuild to public/dist/bundle.js.
//
// Managers (each receives the shared `app` container):
//   config, state, elements, api, storage — shared infrastructure
//   theme, modal, playerUI                — shell / UI helpers
//   auth, feeds, playback, queue, sync, timeline — features

import Config from './config.js';
import AppState from './state.js';
import Elements from './dom.js';
import { ApiClient, ApiError } from './api.js';
import Storage from './storage.js';
import ThemeManager from './ui/theme.js';
import ModalManager from './ui/modal.js';
import PlayerUI from './ui/player-ui.js';
import AuthManager from './auth.js';
import FeedsManager from './feeds.js';
import PlaybackManager from './playback.js';
import QueueManager from './queue.js';
import SyncManager from './sync.js';
import TimelineManager from './timeline.js';

const app = {};
app.config = new Config();
app.state = new AppState();
app.elements = new Elements();
app.api = new ApiClient(app.config, app.state);
app.storage = new Storage(app.config, app.api, app.state);
app.theme = new ThemeManager(app);
app.modal = new ModalManager(app);
app.playerUI = new PlayerUI(app);
app.auth = new AuthManager(app);
app.feeds = new FeedsManager(app);
app.playback = new PlaybackManager(app);
app.queue = new QueueManager(app);
app.sync = new SyncManager(app);
app.timeline = new TimelineManager(app);

// ── Boot sequence ───────────────────────────────────────────────────────────

// Boot error handler (Schritt 7): surface server errors instead of a silent
// empty state. Auth failures (401/403) re-trigger the auth flow; other errors
// (offline, 5xx, malformed response) are shown in the status banner.
function handleBootError(err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        app.state.sessionToken = '';
        app.storage.saveSessionToken('');
        app.auth.updateSyncStatusUI('Session Expired', '', false);
        app.auth.showAuthModal();
        return;
    }
    const detail = (err && err.message) ? err.message : String(err);
    console.error('Boot: could not load persistent data from server', detail);
    app.modal.showStatus(`Could not load data from the server (${detail}). Check your connection and try again.`);
}

// Auth-first async boot. Validates the session with the server first, then
// loads the persistent data (feeds, positions, downloads), populates the
// in-memory cache + transient queue, and finally renders the UI. A loading
// status is shown while the server calls are in flight.
async function initApp() {
    app.modal.showStatus('Starte Podany...');

    // 1. Session-/Token-Param aus der URL ziehen (Magic-Link): in den State,
    //    URL bereinigen. MUSS vor checkAuth laufen.
    app.auth.checkUrlSessionParam();

    // 2. Session vom Server validieren (auth-first). Bei erfolgreichem
    //    Login/Session werden Feeds + Positionen bereits syncronisiert.
    await app.auth.checkAuth();

    // 3. Persistente Daten vom Server laden (Feeds/Positionen).
    //    Fehler werden nicht verschluckt: 401/403 -> Auth-Flow, sonst
    //    Ladefehler an die UI statt eines stillen leeren Zustands (Schritt 7).
    app.modal.showStatus('Lade Feeds und Positionen...');
    try {
        app.state.feeds = await app.storage.loadFeeds();
        app.state.playbackPositions = await app.storage.loadPositions();
    } catch (err) {
        handleBootError(err);
        return;
    }

    // 4. Cache-Arbeitsspeicher befüllen (flüchtig) + Queue (client-only).
    const cache = app.storage.loadCache();
    if (cache.episodes) app.state.allEpisodes = cache.episodes;
    if (cache.metadata) app.state.feedMetadata = cache.metadata;
    app.queue.loadQueue();

    // 5. UI rendern.
    if (app.state.allEpisodes && app.state.allEpisodes.length > 0) {
        app.timeline.processAndSortEpisodes();
        app.timeline.renderTimeline();
        app.timeline.renderContinueShelf();
        app.feeds.renderFeedsGrid();
    }

    app.modal.hideStatus();
}

function wireAllEvents() {
    app.theme.wireThemeButtons();
    app.modal.init();
    app.playerUI.init();
    app.auth.wireEvents();
    app.feeds.wireEvents();
    app.queue.wireEvents();
    app.timeline.wireEvents();
}

function refreshStaticUI() {
    app.queue.updateQueueUI();
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

app.init = async function init() {
    app.theme.init();
    await initApp();
    wireAllEvents();
    app.playback.setupAudioEngines();
    setupNetworkListeners();
    refreshStaticUI();
    initServiceWorker();
    app.modal.initNavigationRoute();
};

// Wire the YouTube Iframe API callback (loaded as a classic <script> before the
// module bundle). Fires window.onYouTubeIframeAPIReady once the API is ready.
window.onYouTubeIframeAPIReady = () => app.playback.onYouTubeIframeAPIReady();
if (window.YT && window.YT.Player) {
    app.playback.initYouTubePlayer();
}

document.addEventListener('DOMContentLoaded', () => app.init());

export default app;
