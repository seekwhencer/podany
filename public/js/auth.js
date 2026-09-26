// auth.js — Podany AuthManager
// Handles magic-link login, session detection, status UI, and logout/reset.
// Uses ApiClient for all auth + sync calls.

import { SESSION_COOKIE_NAME } from './config.js';

export class AuthManager {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.elements = app.elements;
    this.api = app.api;
    this.storage = app.storage;
    this.pendingToken = null;
  }

  // ── Session detection ───────────────────────────────────────────────────

  checkUrlSessionParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');
    const tokenParam = urlParams.get('token');
    if (sessionParam) {
      this.state.sessionToken = sessionParam;
      this.storage.saveSessionToken(sessionParam);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (tokenParam) {
      // Magic-link callback: exchange the one-time token for a session cookie.
      this.pendingToken = tokenParam;
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      const stored = this.storage.loadSessionToken();
      this.state.sessionToken = stored || '';
    }
  }

  async checkAuth() {
    if (this.pendingToken) {
      const token = this.pendingToken;
      this.pendingToken = null;
      try {
        const result = await this.api.verify(token);
        if (result && result.sessionToken) {
          this.state.sessionToken = result.sessionToken;
          this.storage.saveSessionToken(result.sessionToken);
          if (result.user) this.state.userEmail = result.user.email || '';
          this.elements.authModal.classList.add('hidden');
          this.updateSyncStatusUI('Authenticated via Magic Session (Server Synced)', this.state.userEmail, true);
          await this.app.sync.syncFeedsWithServer();
          return;
        }
      } catch (e) {
        // Invalid/expired token → fall through to guest flow below.
      }
    }

    if (this.state.sessionToken) {
      this.elements.authModal.classList.add('hidden');
      this.updateSyncStatusUI('Authenticated via Magic Session (Server Synced)');
      await this.app.sync.syncFeedsWithServer();
      return;
    }

    let user = null;
    try {
      user = await this.api.me();
    } catch (e) {
      user = null;
    }

    if (user) {
        this.elements.authModal.classList.add('hidden');
        this.state.userEmail = user.email || '';
        // syncFeedsWithServer populates feedIdByUrl (subscription id per feed URL),
        // which refreshAllFeeds needs to read episodes from the DB by id instead of
        // falling back to URL-based RSS preview. RSS-fetched episodes carry no
        // `image` hash, so skipping this yields placeholder artwork after a reload.
        await this.app.sync.syncFeedsWithServer();
        this.updateSyncStatusUI('Authenticated via Session Cookie (Server Synced)', this.state.userEmail, true);
        return;
    }

    this.elements.authModal.classList.remove('hidden');
    this.updateSyncStatusUI('Logged in as guest / local device storage');
    if (this.state.feeds.length > 0) {
      await this.app.feeds.refreshAllFeeds();
    } else {
      this.app.timeline.renderTimeline();
    }
  }

  updateSyncStatusUI(statusText, email = '', isConnected = false) {
    if (this.elements.userSyncStatus) {
      this.elements.userSyncStatus.textContent = statusText;
    }
    if (this.elements.statusIndicator) {
      if (isConnected) {
        this.elements.statusIndicator.classList.add('online');
      } else {
        this.elements.statusIndicator.classList.remove('online');
      }
    }
    if (this.elements.userEmailLabel) {
      this.elements.userEmailLabel.textContent = email || (isConnected ? 'Logged In' : 'Guest Mode');
    }
    if (this.elements.btnAccountToggle) {
      this.elements.btnAccountToggle.textContent = isConnected ? 'Sign Out' : 'Log In';
    }
  }

  // ── Magic link ──────────────────────────────────────────────────────────

  getWebmailProvider(email) {
    if (!email || !email.includes('@')) return null;
    const domain = email.split('@')[1].toLowerCase().trim();
    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      return { name: 'Gmail', url: 'https://mail.google.com/' };
    }
    if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.de'].includes(domain)) {
      return { name: 'Outlook', url: 'https://outlook.live.com/mail/' };
    }
    if (domain === 'ue-germany.de') {
      return { name: 'Outlook (UE Germany)', url: 'https://outlook.office.com/mail/' };
    }
    if (['yahoo.com', 'ymail.com', 'yahoo.de', 'yahoo.fr', 'yahoo.co.uk'].includes(domain)) {
      return { name: 'Yahoo Mail', url: 'https://mail.yahoo.com/' };
    }
    if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) {
      return { name: 'iCloud Mail', url: 'https://www.icloud.com/mail/' };
    }
    if (domain === 'proton.me' || domain === 'protonmail.com') {
      return { name: 'Proton Mail', url: 'https://mail.proton.me/' };
    }
    if (domain.startsWith('gmx.')) {
      return { name: 'GMX', url: 'https://www.gmx.net/' };
    }
    if (domain === 'web.de') {
      return { name: 'WEB.DE', url: 'https://web.de/' };
    }
    if (domain === 't-online.de') {
      return { name: 'Telekom Mail', url: 'https://email.t-online.de/' };
    }
    if (domain === 'posteo.de' || domain === 'posteo.net' || domain === 'posteo.org') {
      return { name: 'Posteo', url: 'https://posteo.de/' };
    }
    if (domain === 'mailbox.org') {
      return { name: 'mailbox.org', url: 'https://mailbox.org/' };
    }
    if (domain === 'freenet.de') {
      return { name: 'freenet Mail', url: 'https://email.freenet.de/' };
    }
    if (domain === 'zoho.com' || domain === 'zoho.eu') {
      return { name: 'Zoho Mail', url: 'https://mail.zoho.com/' };
    }
    if (domain === 'fastmail.com' || domain === 'fastmail.fm') {
      return { name: 'Fastmail', url: 'https://app.fastmail.com/' };
    }
    if (domain === 'ionos.de' || domain === 'ionos.com' || domain === 'online.de') {
      return { name: 'IONOS Webmail', url: 'https://mail.ionos.de/' };
    }
    return { name: domain, url: `https://${domain}` };
  }

  async submitMagicAuth() {
    const email = this.elements.magicEmailInput.value.trim();
    if (!email || !email.includes('@')) return;

    this.elements.magicStatusMsg.style.display = 'block';
    this.elements.magicStatusMsg.style.color = '#a5b4fc';
    this.elements.magicStatusMsg.textContent = 'Sending sign-in link...';

    try {
      const data = await this.api.sendLink({ email, origin: window.location.origin });
      if (!data.success) throw new Error(data.error || 'Failed to send link');

      const provider = this.getWebmailProvider(email);
      let content = '<div style="margin-top: 6px; line-height: 1.45;">';
      content += '<div style="color: #cbd5e1;">Sign-in link sent! Check your email inbox (and spam folder) to complete sign in.</div>';

      if (data.verifyUrl) {
        content += `<div style="margin-top: 10px;"><span style="color:#22c55e; font-weight: 600;">${escapeHtml(data.sandboxNotice || data.devNotice || 'Direct Login:')}</span> <a href="${escapeHtml(data.verifyUrl)}" style="color:#60a5fa; text-decoration:underline; font-weight: 500;">Click here to sign in instantly</a></div>`;
      }

      if (provider) {
        content += `<div style="margin-top: 12px;">
          <a href="${escapeHtml(provider.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; padding: 9px 16px; font-size: 0.9rem; border-radius: 8px; font-weight: 600;">
            <span>Open ${escapeHtml(provider.name)}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </a>
        </div>`;
      }
      content += '</div>';
      this.elements.magicStatusMsg.innerHTML = content;
    } catch (e) {
      this.elements.magicStatusMsg.style.color = '#ef4444';
      this.elements.magicStatusMsg.textContent = `Error: ${e.message}`;
    }
  }

  setFormStatus(el, color, text) {
    if (!el) return;
    el.style.display = 'block';
    el.style.color = color;
    el.textContent = text;
  }

  async submitPasswordAuth() {
    const email = this.elements.passwordEmailInput.value.trim();
    const password = String(this.elements.passwordPasswordInput.value || '');
    if (!email || !email.includes('@')) return;
    if (!password) {
      this.setFormStatus(this.elements.passwordStatusMsg, '#ef4444', 'Password is required.');
      return;
    }

    this.setFormStatus(this.elements.passwordStatusMsg, '#a5b4fc', 'Signing in...');

    try {
      const data = await this.api.loginWithPassword({ email, password });
      if (!data.success || !data.sessionToken) {
        throw new Error(data.error || 'Failed to sign in');
      }
      this.state.sessionToken = data.sessionToken;
      this.storage.saveSessionToken(data.sessionToken);
      if (data.user) this.state.userEmail = data.user.email || '';
      this.elements.authModal.classList.add('hidden');
      this.updateSyncStatusUI('Authenticated via Password Login (Server Synced)', this.state.userEmail, true);
      await this.app.sync.syncFeedsWithServer();
      this.app.feeds.updateFeedCountUI();
    } catch (e) {
      this.setFormStatus(this.elements.passwordStatusMsg, '#ef4444', `Error: ${e.message}`);
    }
  }

  toggleLoginMode() {
    const magicVisible = !this.elements.magicAuthForm.classList.contains('hidden');
    if (magicVisible) {
      this.elements.magicAuthForm.classList.add('hidden');
      this.elements.passwordAuthForm.classList.remove('hidden');
      if (this.elements.authModalTitle) this.elements.authModalTitle.textContent = 'Sign In with Password';
      if (this.elements.btnToggleLoginMode) this.elements.btnToggleLoginMode.textContent = 'Use magic link instead';
      if (this.elements.magicEmailInput && this.elements.magicEmailInput.value) {
        this.elements.passwordEmailInput.value = this.elements.magicEmailInput.value;
      }
      this.elements.passwordPasswordInput.focus();
    } else {
      this.elements.passwordAuthForm.classList.add('hidden');
      this.elements.magicAuthForm.classList.remove('hidden');
      if (this.elements.authModalTitle) this.elements.authModalTitle.textContent = 'Magic Email Login';
      if (this.elements.btnToggleLoginMode) this.elements.btnToggleLoginMode.textContent = 'Use password instead';
      this.elements.magicEmailInput.focus();
    }
  }

  // ── Logout / full reset ─────────────────────────────────────────────────

  async handleLogout() {
    const currentToken = this.state.sessionToken;
    try {
      await this.api.logout(currentToken);
    } catch (e) {}

    this.storage.clearAll();
    document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
    window.history.replaceState({}, document.title, window.location.pathname);

    this.state.reset();
    this.state.pageSize = this.app.config.pageSize;

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
    this.app.timeline.renderContinueShelf();
    this.app.timeline.renderTimeline();
    this.app.feeds.renderFeedsGrid();
    this.updateSyncStatusUI('Logged Out', '', false);
    this.elements.authModal.classList.remove('hidden');
  }

  handleAccountToggle() {
    if (this.elements.statusIndicator && this.elements.statusIndicator.classList.contains('online')) {
      this.handleLogout();
    } else {
      this.elements.authModal.classList.remove('hidden');
    }
  }

  showAuthModal() {
    this.elements.authModal.classList.remove('hidden');
  }

  hideAuthModal() {
    this.elements.authModal.classList.add('hidden');
  }

  // ── Event wiring ────────────────────────────────────────────────────────

  wireEvents() {
    if (this.elements.magicAuthForm) {
      this.elements.magicAuthForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitMagicAuth();
      });
    }
    if (this.elements.passwordAuthForm) {
      this.elements.passwordAuthForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitPasswordAuth();
      });
    }
    if (this.elements.btnToggleLoginMode) {
      this.elements.btnToggleLoginMode.addEventListener('click', () => this.toggleLoginMode());
    }
    const hideAuth = () => this.hideAuthModal();
    if (this.elements.btnCloseAuth) this.elements.btnCloseAuth.addEventListener('click', hideAuth);
    if (this.elements.btnCancelAuth) this.elements.btnCancelAuth.addEventListener('click', hideAuth);
    if (this.elements.btnShowLogin) {
      this.elements.btnShowLogin.addEventListener('click', () => this.showAuthModal());
    }
    if (this.elements.btnAccountToggle) {
      this.elements.btnAccountToggle.addEventListener('click', () => this.handleAccountToggle());
    }
    if (this.elements.userStatusPill) {
      this.elements.userStatusPill.addEventListener('click', (e) => {
        if (e.target.closest('#btn-account-toggle')) return;
        this.elements.userStatusPill.classList.toggle('is-expanded');
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest('#user-status-pill')) {
          this.elements.userStatusPill.classList.remove('is-expanded');
        }
      });
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default AuthManager;
