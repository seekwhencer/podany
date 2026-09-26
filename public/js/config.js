// config.js — Podany Frontend Configuration & Constants
// Holds app-wide constants, storage keys, card icons, and derives the API
// base URL from the current origin (no hard-coded URLs).

export const STORAGE_KEYS = {
  FEEDS: 'podany_feeds',
  SESSION: 'podany_session_token',
  CACHED_EPISODES: 'podany_cached_episodes',
  CACHED_METADATA: 'podany_cached_metadata',
  POSITIONS: 'podany_playback_positions',
  THEME: 'podany_theme',
  QUEUE: 'podany_playback_queue'
};

export const CARD_ICONS = {
  PLAY: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>',
  PAUSE: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>',
  SPINNER: '<svg class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"></circle><path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"></path></svg>',
  CHECK: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="16 9 11 14 8 11"></polyline></svg>',
  CHECK_FILLED: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
  QUEUE: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h7"></path><path d="M18 15v6M15 18h6"></path></svg>',
  QUEUE_ADDED: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h10M4 18h7"></path><polyline points="15 18 18 21 23 15"></polyline></svg>'
};

export const FALLBACK_ARTWORK = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22100%22%20height=%22100%22%3E%3Crect%20width=%22100%25%22%20height=%22100%25%22%20fill=%22%2318181b%22/%3E%3C/svg%3E';

// Leitet den gehaschten Bildnamen (episode.image / feed image) auf die
// serverseitige Image-Route ab. Liefert FALLBACK_ARTWORK, wenn kein Hash vorliegt.
export function artworkUrl(image, size = 'full') {
  if (!image) return FALLBACK_ARTWORK;
  return `/images/${image}-${size}.jpg`;
}

export const DEFAULT_STARTER_FEEDS = [
  'https://changelog.com/podcast/feed',
  'https://feeds.feedburner.com/syntaxfm'
];

export const DIR_PAGE_SIZE = 12;

export const APP_CACHE_NAME = 'podany-v2';

// Session cookie name must match the backend default (server/config/defaults.js).
export const SESSION_COOKIE_NAME = 'podcast_session';

export class Config {
  constructor() {
    this.origin = window.location.origin;
    // All API calls are relative to the current origin; no hard-coded URLs.
    this.apiBase = '';
    this.maxCacheEpisodes = 2000;
    this.pageSize = 30;
    this.theme = 'system';
    this.cardIcons = CARD_ICONS;
    this.fallbackArtwork = FALLBACK_ARTWORK;
    this.starterFeeds = DEFAULT_STARTER_FEEDS;
  }

  get storageKeys() {
    return STORAGE_KEYS;
  }
}

export default Config;
