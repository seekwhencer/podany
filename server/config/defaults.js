import path from 'node:path';

export const defaults = {
  port: 8788,
  downloadStorageDir: path.join(process.cwd(), 'downloads'),
  downloadConcurrency: 4,
  host: '0.0.0.0',
  dbPort: 3306,
  dbPoolMax: 10,
  fromEmail: 'onboarding@resend.dev',
  sessionCookieName: 'podcast_session',
  sessionTtlSeconds: 30 * 24 * 60 * 60,
  cookieSecure: true,
  rateLimitLinksPerHour: 60,
  corsOrigin: '*',
  authMode: 'local',
  environment: 'production',
  magicLinkEnabled: false,
  defaultUserColor: '#d8cdbe',
  defaultUserEmail: '',
  defaultUserPassword: '',
};

export default defaults;
