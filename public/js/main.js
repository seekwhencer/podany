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
import LiveClient from './live/LiveClient.js';

export class App {
    constructor() {
        this.config = new Config();
        this.state = new AppState();
        this.elements = new Elements();
        this.api = new ApiClient(this.config, this.state);
        this.storage = new Storage(this.config, this.api, this.state);
        this.theme = new ThemeManager(this);
        this.modal = new ModalManager(this);
        this.playerUI = new PlayerUI(this);
        this.auth = new AuthManager(this);
        this.feeds = new FeedsManager(this);
        this.playback = new PlaybackManager(this);
        this.queue = new QueueManager(this);
        this.sync = new SyncManager(this);
        this.timeline = new TimelineManager(this);
    }

    // Boot error handler (Schritt 7): surface server errors instead of a silent
    // empty state. Auth failures (401/403) re-trigger the auth flow; other errors
    // (offline, 5xx, malformed response) are shown in the status banner.
    handleBootError(err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            this.state.sessionToken = '';
            this.storage.saveSessionToken('');
            this.auth.updateSyncStatusUI('Session Expired', '', false);
            this.auth.showAuthModal();
            return;
        }
        const detail = (err && err.message) ? err.message : String(err);
        console.error('Boot: could not load persistent data from server', detail);
        this.modal.showStatus(`Could not load data from the server (${detail}). Check your connection and try again.`);
    }

    // Auth-first async boot. Validates the session with the server first, then
    // loads the persistent data (feeds, positions, downloads), populates the
    // in-memory cache + transient queue, and finally renders the UI. A loading
    // status is shown while the server calls are in flight.
    async initApp() {
        this.modal.showStatus('Starte Podany...');

        // 1. Session-/Token-Param aus der URL ziehen (Magic-Link): in den State,
        //    URL bereinigen. MUSS vor checkAuth laufen.
        this.auth.checkUrlSessionParam();

        // 2. Session vom Server validieren (auth-first). Bei erfolgreichem
        //    Login/Session werden Feeds + Positionen bereits syncronisiert.
        await this.auth.checkAuth();

        // 3. Persistente Daten vom Server laden (Feeds/Positionen).
        //    Fehler werden nicht verschluckt: 401/403 -> Auth-Flow, sonst
        //    Ladefehler an die UI statt eines stillen leeren Zustands (Schritt 7).
        this.modal.showStatus('Lade Feeds und Positionen...');
        try {
            this.state.feeds = await this.storage.loadFeeds();
            this.state.playbackPositions = await this.storage.loadPositions();
        } catch (err) {
            this.handleBootError(err);
            return;
        }

        // 4. Cache-Arbeitsspeicher befüllen (flüchtig) + Queue (client-only).
        const cache = this.storage.loadCache();
        if (cache.episodes) this.state.allEpisodes = cache.episodes;
        if (cache.metadata) this.state.feedMetadata = cache.metadata;
        this.queue.loadQueue();

        // 5. UI rendern.
        if (this.state.allEpisodes && this.state.allEpisodes.length > 0) {
            this.timeline.processAndSortEpisodes();
            this.timeline.renderTimeline();
            this.timeline.renderContinueShelf();
            this.feeds.renderFeedsGrid();
        }

        this.modal.hideStatus();
    }

    // Opens the live WebSocket once a session token is available (boot or after
    // login). Idempotent: reuses the existing LiveClient if one is already up.
    async ensureLiveConnection() {
        if (!this.state.sessionToken) return;
        if (this.live && this.live.isActive) return;
        if (this.live) {
            return this.live.forceReconnect();
        } else {
            this.live = new LiveClient(this);
            return this.live.connect();
        }
    }

    wireAllEvents() {
        this.theme.wireThemeButtons();
        this.modal.init();
        this.playerUI.init();
        this.auth.wireEvents();
        this.feeds.wireEvents();
        this.queue.wireEvents();
        this.timeline.wireEvents();
    }

    refreshStaticUI() {
        this.queue.updateQueueUI();
        this.feeds.updateFeedCountUI();
        this.feeds.updateDockVisibility();
    }

    setupNetworkListeners() {
        const updateStatus = () => {
            if (!this.elements.offlineBadge) return;
            this.elements.offlineBadge.classList.toggle('hidden', navigator.onLine);
        };
        window.addEventListener('online', () => {
            if (this.live && typeof this.live.forceReconnect === 'function') {
                this.live.forceReconnect();
            }
        });
        window.addEventListener('offline', updateStatus);
        window.addEventListener('resize', () => {
            if (this.state.continueCollapsed && this.state.allEpisodes.length > 0) {
                this.timeline.renderContinueShelf();
            }
        });
        updateStatus();
    }

    initServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => { });
        }
    }

    async init() {
        this.theme.init();
        await this.initApp();
        await this.ensureLiveConnection();
        this.wireAllEvents();
        this.playback.setupAudioEngines();
        this.setupNetworkListeners();
        this.refreshStaticUI();
        this.initServiceWorker();
        this.modal.initNavigationRoute();
    }
}

// Boot the single app instance once the DOM is ready.
const app = new App();

// Wire the YouTube Iframe API callback (loaded as a classic <script> before the
// module bundle). Fires window.onYouTubeIframeAPIReady once the API is ready.
window.onYouTubeIframeAPIReady = () => app.playback.onYouTubeIframeAPIReady();
if (window.YT && window.YT.Player) {
    app.playback.initYouTubePlayer();
}

document.addEventListener('DOMContentLoaded', () => app.init());

export default app;
