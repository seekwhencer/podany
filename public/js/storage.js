// storage.js — Podany Storage wrapper
// Thin persistence layer over localStorage. Pure read/write helpers; no UI
// side effects. Managers call these and then refresh their own views.

export class Storage {
  constructor(config) {
    this.config = config;
  }

  _keys() {
    return this.config.storageKeys;
  }

  _legacy(key) {
    return this.config.legacyKey(key);
  }

  get(key) {
    try {
      const val = localStorage.getItem(this._keys()[key]);
      if (val !== null) return val;
    } catch (e) {}
    try {
      const legacy = this._legacy(key);
      if (legacy) {
        const val = localStorage.getItem(legacy);
        if (val !== null) return val;
      }
    } catch (e) {}
    return null;
  }

  set(key, value) {
    try {
      localStorage.setItem(this._keys()[key], value);
    } catch (e) {}
  }

  remove(key) {
    try { localStorage.removeItem(this._keys()[key]); } catch (e) {}
    const legacy = this._legacy(key);
    if (legacy) {
      try { localStorage.removeItem(legacy); } catch (e) {}
    }
  }

  // Session token
  loadSessionToken() {
    return this.get('SESSION') || '';
  }

  saveSessionToken(token) {
    if (token) this.set('SESSION', token);
    else this.remove('SESSION');
  }

  // Feeds
  loadFeeds() {
    const saved = this.get('FEEDS');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  }

  saveFeeds(feeds) {
    this.set('FEEDS', JSON.stringify(feeds));
  }

  // Playback positions
  loadPositions() {
    const saved = this.get('POSITIONS');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {};
  }

  savePositions(positions) {
    this.set('POSITIONS', JSON.stringify(positions));
  }

  // Cached episodes + feed metadata
  loadCache() {
    const eps = this.get('CACHED_EPISODES');
    const meta = this.get('CACHED_METADATA');
    return {
      episodes: eps ? safeParse(eps) : null,
      metadata: meta ? safeParse(meta) : null
    };
  }

  saveCache(episodes, metadata, maxEpisodes = 2000) {
    if (episodes && episodes.length > 0) {
      this.set('CACHED_EPISODES', JSON.stringify(episodes.slice(0, maxEpisodes)));
    }
    if (metadata) {
      this.set('CACHED_METADATA', JSON.stringify(metadata));
    }
  }

  // Queue (minimal serialization)
  loadQueue() {
    const stored = this.get('QUEUE');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {}
    }
    return [];
  }

  minimalQueueItem(ep) {
    return {
      guid: ep.guid,
      title: ep.title,
      podcastTitle: ep.podcastTitle,
      audioUrl: ep.audioUrl,
      artwork: ep.artwork,
      duration: ep.duration,
      isYouTube: !!ep.isYouTube,
      videoId: ep.videoId,
      playlistId: ep.playlistId,
      feedUrl: ep.feedUrl,
      timestamp: ep.timestamp
    };
  }

  saveQueue(queue) {
    const minimal = (Array.isArray(queue) ? queue : []).map(ep => this.minimalQueueItem(ep));
    this.set('QUEUE', JSON.stringify(minimal));
  }

  // Downloads metadata
  loadDownloads() {
    const stored = this.get('DOWNLOADS');
    if (stored) {
      try { return JSON.parse(stored); } catch (e) {}
    }
    return {};
  }

  saveDownloads(downloads) {
    this.set('DOWNLOADS', JSON.stringify(downloads));
  }

  // Theme
  loadTheme() {
    return this.get('THEME') || 'system';
  }

  saveTheme(theme) {
    this.set('THEME', theme);
  }

  clearAll() {
    Object.keys(this._keys()).forEach(key => this.remove(key));
    try { localStorage.clear(); } catch (e) {}
  }
}

function safeParse(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

export default Storage;
