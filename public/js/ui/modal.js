// modal.js — Podany ModalManager
// Shell layer for navigation history + modal open/close + status banner.
// Owns the browser-hash aware navigation stack, the add/sleep/confirm/auth
// modals, the Escape key handler, and cross-manager triggers (tab clicks,
// gear icon, sleep-timer buttons). Feature-specific logic stays in the
// respective managers; this class only coordinates shell concerns.

export class ModalManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.navHistory = [];
  }

  // ── Navigation stack ────────────────────────────────────────────────────

  _currentView() {
    if (this.state.activeFeedDetailUrl) return { tab: null, feedUrl: this.state.activeFeedDetailUrl };
    const activeTab = this.elements.tabs ?
      document.querySelector('.nav-tab.active')?.dataset.tab || 'timeline' : 'timeline';
    return { tab: activeTab, feedUrl: null };
  }

  _applyView({ tab, feedUrl }) {
    if (this.elements.tabs) this.elements.tabs.forEach(t => t.classList.remove('active'));
    if (this.elements.panels) this.elements.panels.forEach(p => p.classList.remove('active'));
    if (this.elements.btnOpenSettings) this.elements.btnOpenSettings.classList.remove('is-active');

    if (feedUrl) {
      this.state.activeFeedDetailUrl = feedUrl;
      if (this.elements.panelFeedDetail) this.elements.panelFeedDetail.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const meta = this.state.feedMetadata[feedUrl] || {};
      if (this.elements.searchInput) {
        this.elements.searchInput.placeholder = `Search in ${meta.title || 'podcast'}...`;
      }
      this.app.feeds.renderFeedDetail(feedUrl);
    } else {
      this.state.activeFeedDetailUrl = null;
      if (this.elements.panelFeedDetail) this.elements.panelFeedDetail.classList.remove('active');
      const targetTab = tab || 'timeline';
      const tabEl = document.getElementById(`tab-${targetTab}`);
      if (tabEl) tabEl.classList.add('active');
      const panelEl = document.getElementById(`panel-${targetTab}`);
      if (panelEl) panelEl.classList.add('active');
      if (targetTab === 'settings' && this.elements.btnOpenSettings) {
        this.elements.btnOpenSettings.classList.add('is-active');
      }
      if (targetTab === 'feeds') {
        if (this.elements.searchInput) this.elements.searchInput.placeholder = 'Search subscribed podcasts...';
        this.app.feeds.renderFeedsGrid();
      } else if (targetTab === 'timeline') {
        if (this.elements.searchInput) this.elements.searchInput.placeholder = 'Search loaded episodes...';
        this.app.timeline.renderTimeline();
      } else if (targetTab === 'downloads') {
        if (this.elements.searchInput) this.elements.searchInput.placeholder = 'Search downloaded episodes...';
        this.app.downloads.updateDownloadedCountUI();
      }
    }
    this.app.feeds.updateDockVisibility();
  }

  navigateTo(tab, feedUrl, pushBrowser = true) {
    const cur = this._currentView();
    if (cur.tab === tab && cur.feedUrl === feedUrl) return;
    this.state.navHistory.push(cur);

    if (pushBrowser) {
      const hash = feedUrl ? `feed=${encodeURIComponent(feedUrl)}` : (tab || 'timeline');
      window.history.pushState({ tab, feedUrl }, '', '#' + hash);
    }
    this._applyView({ tab, feedUrl });
  }

  navigateBack() {
    const openModal = [
      this.elements.showNotesModal, this.elements.queueModal, this.elements.addModal,
      this.elements.sleepModal, this.elements.confirmModal
    ].find(m => m && !m.classList.contains('hidden'));
    if (openModal) {
      openModal.classList.add('hidden');
      return true;
    }

    if (window.history.length > 1) {
      window.history.back();
      return true;
    }
    if (this.state.navHistory.length > 0) {
      const prev = this.state.navHistory.pop();
      this._applyView(prev);
      return true;
    }
    this._applyView({ tab: 'timeline', feedUrl: null });
    return false;
  }

  initNavigationRoute() {
    window.addEventListener('popstate', (e) => {
      let modalClosed = false;
      const modals = [
        this.elements.showNotesModal, this.elements.queueModal, this.elements.addModal,
        this.elements.sleepModal, this.elements.confirmModal
      ];
      for (const m of modals) {
        if (m && !m.classList.contains('hidden')) {
          m.classList.add('hidden');
          modalClosed = true;
        }
      }
      if (modalClosed) return;

      if (e.state && (e.state.tab !== undefined || e.state.feedUrl !== undefined)) {
        this._applyView(e.state);
      } else if (window.location.hash) {
        const raw = window.location.hash.slice(1);
        if (raw.startsWith('feed=')) {
          this._applyView({ tab: null, feedUrl: decodeURIComponent(raw.slice(5)) });
        } else if (['timeline', 'feeds', 'downloads', 'settings'].includes(raw)) {
          this._applyView({ tab: raw, feedUrl: null });
        } else {
          this._applyView({ tab: 'timeline', feedUrl: null });
        }
      } else {
        this._applyView({ tab: 'timeline', feedUrl: null });
      }
    });

    const hash = window.location.hash ? window.location.hash.slice(1) : '';
    if (hash.startsWith('feed=')) {
      const feedUrl = decodeURIComponent(hash.slice(5));
      this._applyView({ tab: null, feedUrl });
      window.history.replaceState({ tab: null, feedUrl }, '', '#' + hash);
    } else if (['timeline', 'feeds', 'downloads', 'settings'].includes(hash)) {
      this._applyView({ tab: hash, feedUrl: null });
      window.history.replaceState({ tab: hash, feedUrl: null }, '', '#' + hash);
    } else {
      window.history.replaceState({ tab: 'timeline', feedUrl: null }, '', '#timeline');
    }
  }

  wireTabs() {
    if (!this.elements.tabs) return;
    this.elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        this.navigateTo(targetTab);
      });
    });
    if (this.elements.btnOpenSettings) {
      this.elements.btnOpenSettings.addEventListener('click', () => this.navigateTo('settings'));
    }
  }

  // ── Modal open/close ────────────────────────────────────────────────────

  openAddModal() {
    if (this.elements.addModal) this.elements.addModal.classList.remove('hidden');
    if (this.elements.podcastSearchQuery) this.elements.podcastSearchQuery.focus();
    window.history.pushState({ modal: 'add' }, '', window.location.hash);
  }

  closeAddModal() {
    if (this.elements.podcastSearchQuery) this.elements.podcastSearchQuery.value = '';
    if (this.elements.searchDirectoryResults) this.elements.searchDirectoryResults.innerHTML = '';
    if (this.elements.feedUrlInput) this.elements.feedUrlInput.value = '';
    if (window.history.state && window.history.state.modal) {
      window.history.back();
    } else if (this.elements.addModal) {
      this.elements.addModal.classList.add('hidden');
    }
  }

  openSleepModal() {
    if (this.elements.sleepModal) this.elements.sleepModal.classList.remove('hidden');
    window.history.pushState({ modal: 'sleep' }, '', window.location.hash);
  }

  closeSleepModal() {
    if (window.history.state && window.history.state.modal) {
      window.history.back();
    } else if (this.elements.sleepModal) {
      this.elements.sleepModal.classList.add('hidden');
    }
  }

  showAuthModal() {
    if (this.elements.authModal) this.elements.authModal.classList.remove('hidden');
  }

  closeAuthModal() {
    if (this.elements.authModal) this.elements.authModal.classList.add('hidden');
  }

  showConfirm(message) {
    if (this.elements.confirmModalMsg && message) {
      this.elements.confirmModalMsg.textContent = message;
    }
    if (this.elements.confirmModal) this.elements.confirmModal.classList.remove('hidden');
  }

  closeConfirm() {
    this.state.feedToDelete = null;
    if (this.elements.confirmModal) this.elements.confirmModal.classList.add('hidden');
  }

  // ── Status banner ───────────────────────────────────────────────────────

  showStatus(msg) {
    if (this.elements.statusBanner) {
      this.elements.statusBanner.textContent = msg;
      this.elements.statusBanner.classList.remove('hidden');
    }
  }

  hideStatus() {
    if (this.elements.statusBanner) this.elements.statusBanner.classList.add('hidden');
  }

  // ── Sleep timer buttons (live in the sleep modal) ───────────────────────

  wireSleepTimerButtons() {
    if (this.elements.btnOpenSleep) {
      this.elements.btnOpenSleep.addEventListener('click', () => this.openSleepModal());
    }
    if (this.elements.btnCloseSleep) {
      this.elements.btnCloseSleep.addEventListener('click', () => this.closeSleepModal());
    }
    if (this.elements.timerBtns) {
      this.elements.timerBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.minutes;
          this.app.playback.startSleepTimer(val === 'end' || val === 'end-queue' ? val : parseInt(val, 10));
        });
      });
    }
    if (this.elements.fadeoutCheck) {
      this.elements.fadeoutCheck.addEventListener('change', (e) => {
        this.state.sleepTimer.fadeout = e.target.checked;
      });
    }
  }

  // ── Add-feed modal buttons ──────────────────────────────────────────────

  wireAddModalButtons() {
    if (this.elements.btnOpenAddModal) {
      this.elements.btnOpenAddModal.addEventListener('click', () => this.openAddModal());
    }
    const close = () => this.closeAddModal();
    if (this.elements.btnCloseAdd) this.elements.btnCloseAdd.addEventListener('click', close);
    if (this.elements.btnCancelAdd) this.elements.btnCancelAdd.addEventListener('click', close);
  }

  // ── Confirm modal buttons ───────────────────────────────────────────────

  wireConfirmModal() {
    if (this.elements.btnConfirmCancel) {
      this.elements.btnConfirmCancel.addEventListener('click', () => this.closeConfirm());
    }
    if (this.elements.btnConfirmDelete) {
      this.elements.btnConfirmDelete.addEventListener('click', () => {
        if (this.state.feedToDelete) {
          this.app.feeds.removeFeed(this.state.feedToDelete);
        }
        this.closeConfirm();
      });
    }
  }

  // ── Global reset (settings: clear all storage) ──────────────────────────

  async resetAll() {
    const feedUrls = [...this.state.feeds];
    const positionGuids = Object.keys(this.state.playbackPositions);
    const downloadGuids = Object.keys(this.state.downloadedEpisodes);

    // Persisted data lives on the server; delete it there instead of clearing
    // browser storage. A pure client-state reset would leave server rows behind.
    for (const url of feedUrls) {
      try { await this.app.api.removeSubscription(url); } catch (e) {}
    }
    for (const guid of positionGuids) {
      try { await this.app.api.removePosition(guid); } catch (e) {}
    }
    for (const guid of downloadGuids) {
      try { await this.app.api.removeDownload(guid); } catch (e) {}
    }

    if ('caches' in window) {
      caches.delete('podany-audio-v1').catch(() => {});
    }
    this.state.reset();
    this.state.pageSize = this.app.config.pageSize;
    document.body.classList.remove('has-active-episode', 'has-mini-player', 'has-full-player');
    if (this.elements.audio) {
      this.elements.audio.pause();
      this.elements.audio.src = '';
    }
    if (this.state.ytPlayer && this.state.ytPlayer.stopVideo) {
      this.state.ytPlayer.stopVideo();
    }
    this.app.playback.syncPlaybackButtons();
    this.app.feeds.updateFeedCountUI();
    this.app.queue.updateQueueUI();
    this.app.downloads.updateDownloadedCountUI();
    this.app.timeline.renderContinueShelf();
    this.app.timeline.renderTimeline();
    this.app.feeds.renderFeedsGrid();
  }

  wireClearStorage() {
    if (this.elements.btnClearStorage) {
      this.elements.btnClearStorage.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all feeds and state?')) {
          this.resetAll();
        }
      });
    }
  }

  // ── Escape key ──────────────────────────────────────────────────────────

  wireEscapeKey() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.elements.showNotesModal && !this.elements.showNotesModal.classList.contains('hidden')) {
        this.app.timeline.closeShowNotes();
      } else if (this.elements.queueModal && !this.elements.queueModal.classList.contains('hidden')) {
        this.app.queue.closeQueueModal();
      } else if (this.elements.sleepModal && !this.elements.sleepModal.classList.contains('hidden')) {
        this.closeSleepModal();
      } else if (this.elements.addModal && !this.elements.addModal.classList.contains('hidden')) {
        this.closeAddModal();
      } else if (this.elements.confirmModal && !this.elements.confirmModal.classList.contains('hidden')) {
        this.closeConfirm();
      }
    });
  }

  init() {
    this.wireTabs();
    this.wireAddModalButtons();
    this.wireConfirmModal();
    this.wireSleepTimerButtons();
    this.wireClearStorage();
    this.wireEscapeKey();
  }
}

export default ModalManager;
