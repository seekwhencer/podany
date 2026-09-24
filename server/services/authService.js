import { User } from '../models/User.js';
import { AuthToken } from '../models/AuthToken.js';
import { EmailService } from './emailService.js';
import { SessionStore } from './sessionStore.js';
import { RateLimiter } from './rateLimiter.js';
import { hashToken, generateToken } from '../utils/crypto.js';
import { verifyPassword } from '../utils/password.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_SECONDS = 15 * 60;
const REGISTRATION_WINDOW_SECONDS = 600;
const MAX_REGISTRATIONS = 30;
const LINKS_PER_USER_WINDOW_SECONDS = 600;
const MAX_LINKS_PER_USER = 5;

export class AuthError extends Error {
  constructor(message, status = 500, retryAfterMs = 0) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function buildMagicEmailHtml(verifyUrl) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0a09; color: #f5f5f4; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: #1c1917; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 32px; text-align: center;">
    <h1 style="color: #ffffff; font-size: 22px; margin-bottom: 12px; font-weight: 700;">Sign in to Podany</h1>
    <p style="color: #a8a29e; font-size: 15px; line-height: 1.5; margin-bottom: 28px;">Click the button below to complete your sign in. This magic link is valid for 15 minutes.</p>
    <a href="${verifyUrl}" style="display: inline-block; background: #d8cdbe; color: #141414; font-weight: 600; font-size: 15px; padding: 13px 28px; border-radius: 8px; text-decoration: none;">Sign In to Podany</a>
    <p style="color: #78716c; font-size: 12px; margin-top: 32px; word-break: break-all;">Link not working? Paste this URL into your browser:<br><a href="${verifyUrl}" style="color: #d8cdbe;">${verifyUrl}</a></p>
  </div>
</body>
</html>`;
}

export class AuthService {
  constructor(deps = {}) {
    this.config = deps.config;
    this.users = deps.users ?? new User();
    this.tokens = deps.tokens ?? new AuthToken();
    this.email = deps.email ?? new EmailService({ config: this.config });
    this.sessions = deps.sessions ?? new SessionStore(this.config?.sessionTtlSeconds);
    this.rateLimiter = deps.rateLimiter ?? new RateLimiter({
      windowMs: LINKS_PER_USER_WINDOW_SECONDS * 1000,
      limit: MAX_LINKS_PER_USER
    });
    this.localLoginEnabled = deps.localLoginEnabled ?? this.config?.localLoginEnabled;
    this.magicLinkEnabled = deps.magicLinkEnabled ?? this.config?.magicLinkEnabled;
  }

  async sendLoginLink({ email: rawEmail, origin }) {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || email.length > 120 || !EMAIL_RE.test(email)) {
      throw new AuthError('Valid email address required.', 400);
    }

    const rate = this.rateLimiter.check(`link:${email}`);
    if (!rate.allowed) {
      throw new AuthError(
        'Too many login attempts. Please wait a few minutes before trying again.',
        429,
        rate.retryAfterMs
      );
    }

    let user = await this.users.findByEmail(email);

    if (user) {
      const recent = await this.tokens.countCreatedAfterForUser(
        user.id,
        Math.floor(Date.now() / 1000) - LINKS_PER_USER_WINDOW_SECONDS
      );
      if (recent >= MAX_LINKS_PER_USER) {
        throw new AuthError('Too many login attempts. Please wait a few minutes before trying again.', 429);
      }
    } else {
      const newUsers = await this.users.countCreatedAfter(
        Math.floor(Date.now() / 1000) - REGISTRATION_WINDOW_SECONDS
      );
      if (newUsers >= MAX_REGISTRATIONS) {
        throw new AuthError('Registration rate limit reached. Please wait a few minutes before trying again.', 429);
      }
      const newUserId = this.users.generateId('usr_');
      await this.users.create({ id: newUserId, email });
      user = { id: newUserId, email };
    }

    const raw = generateToken(32);
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    await this.tokens.create({ tokenHash: hashToken(raw), userId: user.id, expiresAt });

    const appUrl = this.resolveAppUrl(origin);
    const verifyUrl = `${appUrl}/auth/verify/?token=${raw}`;

    if (!this.email.enabled) {
      return { success: true, sentVia: 'local', verifyUrl };
    }

    await this.email.send({ to: email, subject: 'Podany Magic Login Link', html: buildMagicEmailHtml(verifyUrl) });
    return { success: true, sentVia: 'resend' };
  }

  async verify(token) {
    const value = String(token || '').trim();
    if (!value) {
      throw new AuthError('Token is required', 400);
    }

    const userId = await this.tokens.consume(hashToken(value));
    if (!userId) {
      throw new AuthError('Invalid or expired token', 401);
    }

    const { raw } = this.sessions.issue(userId);
    const user = await this.users.findById(userId);
    return { success: true, sessionToken: raw, user };
  }

  async login({ email: rawEmail }) {
    if (!this.localLoginEnabled) {
      throw new AuthError('Local login is not enabled.', 403);
    }

    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      throw new AuthError('Valid email address required.', 400);
    }

    let user = await this.users.findByEmail(email);
    if (!user) {
      const newUserId = this.users.generateId('usr_');
      await this.users.create({ id: newUserId, email });
      user = { id: newUserId, email };
    }

    const { raw } = this.sessions.issue(user.id);
    return { success: true, sessionToken: raw, user };
  }

  async loginWithPassword({ email: rawEmail, password }) {
    if (!this.localLoginEnabled) {
      throw new AuthError('Local login is not enabled.', 403);
    }

    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      throw new AuthError('Valid email address required.', 400);
    }
    if (!password || String(password).length === 0) {
      throw new AuthError('Password is required.', 400);
    }

    const user = await this.users.findByEmailWithPassword(email);
    if (!user || !user.password_hash) {
      throw new AuthError('Invalid email or password.', 401);
    }
    if (!verifyPassword(String(password), user.password_hash)) {
      throw new AuthError('Invalid email or password.', 401);
    }

    const { raw } = this.sessions.issue(user.id);
    return { success: true, sessionToken: raw, user };
  }

  async logout(rawToken) {
    if (rawToken) {
      this.sessions.revoke(hashToken(String(rawToken).trim()));
    }
    return { success: true };
  }

  async resolveUser(rawToken) {
    const value = String(rawToken || '').trim();
    if (!value) return null;
    const userId = this.sessions.resolve(hashToken(value));
    if (!userId) return null;
    return this.users.findById(userId);
  }

  resolveAppUrl(origin) {
    if (origin && typeof origin === 'string') {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          return parsed.origin;
        }
      } catch (e) {}
    }
    return this.config.appUrl;
  }
}

export default AuthService;
