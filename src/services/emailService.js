import config from '../config/index.js';
import { defaults } from '../config/defaults.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export class EmailService {
  constructor(options = {}) {
    this.resendApiKey = options.resendApiKey ?? config.resendApiKey;
    this.fromEmail = options.fromEmail ?? config.fromEmail ?? defaults.fromEmail;
  }

  get enabled() {
    return Boolean(this.resendApiKey);
  }

  async send({ to, subject, html }) {
    if (!this.enabled) {
      return { sentVia: 'local', id: null };
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      })
    });

    const text = await response.text();

    if (!response.ok) {
      let isSandboxRestriction = false;
      try {
        const parsed = JSON.parse(text);
        isSandboxRestriction = Boolean(
          parsed.statusCode === 403 ||
            parsed.statusCode === 422 ||
            (parsed.message && (
              parsed.message.includes('You can only send testing emails') ||
              parsed.message.includes('testing email address')
            ))
        );
      } catch (e) {}
      if (isSandboxRestriction || this.fromEmail.includes('resend.dev')) {
        return { sentVia: 'sandbox', id: null, notice: 'Resend Sandbox Mode (only delivered to account owner)' };
      }
      throw new Error(`Resend email delivery failed (${response.status}): ${text}`);
    }

    let id = null;
    try {
      id = JSON.parse(text).id;
    } catch (e) {}
    return { sentVia: 'resend', id };
  }
}

export default EmailService;
