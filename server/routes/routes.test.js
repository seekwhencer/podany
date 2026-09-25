import '../services/testEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ReadableStream } from 'node:stream/web';
import config from '../config/index.js';
import { createAppRouter } from './index.js';

const fakeAuth = {
  sentLinks: [],
  revoked: [],
  resolved: {},
  async sendLoginLink({ email, origin }) {
    this.sentLinks.push({ email, origin });
    return { success: true, sentVia: 'local', verifyUrl: `http://localhost/auth/verify/?token=abc-${email}` };
  },
  async verify(token) {
    return { success: true, sessionToken: token.split('=').pop(), user: { id: 'usr_1', email: 'user@example.com' } };
  },
  async login({ email }) {
    return { success: true, sessionToken: 'sess-1', user: { id: 'usr_1', email } };
  },
  async logout(token) {
    this.revoked.push(token);
    return { success: true };
  },
  async resolveUser(token) {
    return this.resolved[token] ?? null;
  }
};

const fakeSync = {
  calls: [],
  async listSubscriptions(userId) { this.calls.push(['listSubscriptions', userId]); return { feeds: [] }; },
  async addSubscription(args) { this.calls.push(['addSubscription', args]); return { success: true, feedUrl: args.feedUrl, id: 'sub_test' }; },
  async removeSubscription(userId, feedUrl) { this.calls.push(['removeSubscription', userId, feedUrl]); return { success: true, removed: feedUrl }; },
  async listPositions(userId) { this.calls.push(['listPositions', userId]); return { positions: {} }; },
  async savePosition(args) { this.calls.push(['savePosition', args]); return { success: true, episodeGuid: args.episodeGuid }; }
};

const fakeFeed = {
  async fetchFeeds(urls) { return [{ title: 'Feed A', feedUrl: urls[0], episodes: [] }]; }
};

const fakeAudioProxy = {
  async fetch({ url, range }) {
    const headers = new Headers({
      'content-type': 'audio/mpeg',
      'content-range': `bytes=${range || '0-100'}/200`,
      'accept-ranges': 'bytes',
      'content-length': '5'
    });
    return {
      status: 206,
      statusText: 'Partial Content',
      headers,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('audio'));
          controller.close();
        }
      })
    };
  }
};

const fakeDownloads = {
  records: {},
  async listByUser(userId) { return Object.values(this.records).filter((r) => r.user_id === userId); },
  async register(args) {
    const record = { id: 'dl_1', ...args, user_id: args.userId, status: 'pending', progress: 0 };
    this.records[record.id] = record;
    return record;
  },
  async findById(id) { return this.records[id] ?? null; },
  async startDownload(record) {
    record.status = 'completed';
    record.progress = 100;
    return record;
  },
  async remove(userId, episodeGuid) { return { success: true, removed: episodeGuid }; },
  async deleteById(id) { return { success: true, id } }
};

const fakeUser = {
  colors: {},
  async getOptions(userId) { return { color: this.colors[userId] ?? '#d8cdbe' }; },
  async updateOptions(userId, { color }) {
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      const err = new Error('color must be a valid hex color like #aabbcc.');
      err.status = 400;
      throw err;
    }
    this.colors[userId] = color;
    return { color: this.colors[userId] };
  }
};

function buildServer(deps) {
  const app = express();
  app.use(express.json());
  app.use('/api', createAppRouter({ ...deps, config }));
  const server = app.listen(0);
  return server;
}

async function request(server, method, path, { body, headers = {} } = {}) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    json = undefined;
  }
  return { status: res.status, setCookie: res.headers.getSetCookie?.() ?? res.headers.get('set-cookie'), body: json, raw };
}

test('auth send-link returns the local verify url', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/auth/send-link', { body: { email: 'new@example.com', origin: 'http://localhost:8788' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.sentVia, 'local');
  assert.match(res.body.verifyUrl, /token=abc-new@example\.com/);
  assert.equal(fakeAuth.sentLinks.length, 1);
});

test('auth verify sets the session cookie and returns the user', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/auth/verify', { body: { token: 'verify=deadbeef' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.user.id, 'usr_1');
  assert.ok(Array.isArray(res.setCookie));
  assert.ok(res.setCookie.some((c) => c.startsWith('podcast_session=')));
  assert.ok(res.setCookie.some((c) => /HttpOnly/.test(c)));
  assert.ok(res.setCookie.some((c) => /SameSite=Lax/.test(c)));
});

test('auth verify reads the token from the query string', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/auth/verify?token=verify=q1');
  assert.equal(res.status, 200);
  assert.equal(res.body.sessionToken, 'q1');
});

test('auth login issues a session and sets the cookie', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/auth/login', { body: { email: 'local@example.com' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.sessionToken, 'sess-1');
  assert.ok(res.setCookie.some((c) => c.startsWith('podcast_session=')));
});

test('auth logout revokes the token and clears the cookie', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/auth/logout', { headers: { cookie: 'podcast_session=xyz' } });
  assert.equal(res.status, 200);
  assert.deepEqual(fakeAuth.revoked, ['xyz']);
  assert.ok(res.setCookie.some((c) => /Max-Age=0/.test(c)));
});

test('sync subscriptions require an authenticated user (401 without token)', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  t.after(() => server.close());
  const res = await request(server, 'GET', '/api/sync/subscriptions');
  assert.equal(res.status, 401);
});

test('sync list subscriptions uses the authenticated user id', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  fakeAuth.resolved = { 'valid-token': { id: 'usr_42', email: 'x@example.com' } };
  t.after(() => server.close());
  const res = await request(server, 'GET', '/api/sync/subscriptions', { headers: { 'x-session-token': 'valid-token' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { feeds: [] });
  assert.deepEqual(fakeSync.calls, [['listSubscriptions', 'usr_42']]);
});

test('sync add subscription validates feedUrl and stores it', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const missing = await request(server, 'POST', '/api/sync/subscriptions', { headers: { 'x-session-token': 't' }, body: {} });
  assert.equal(missing.status, 400);

  const ok = await request(server, 'POST', '/api/sync/subscriptions', { headers: { 'x-session-token': 't' }, body: { feedUrl: 'https://example.com/rss', title: 'T' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.feedUrl, 'https://example.com/rss');
});

test('sync add subscription enqueues a download for each new episode', async (t) => {
  const registered = [];
  const downloadsFake = {
    records: {},
    async listByUser(userId) { return Object.values(this.records).filter((r) => r.user_id === userId); },
    async register(args) {
      const record = { id: `dl_${registered.length + 1}`, user_id: args.userId, episode_guid: args.episodeGuid, subscription_id: args.subscriptionId, audio_url: args.audioUrl, title: args.title || '', status: 'pending', progress: 0 };
      this.records[record.id] = record;
      registered.push(record);
      return record;
    },
    async findById(id) { return this.records[id] ?? null; },
    async startDownload(record) { record.status = 'completed'; record.progress = 100; return record; },
    async remove() { return { success: true, removed: null }; },
    async deleteById(id) { return { success: true, id } }
  };
  const feedFake = {
    async fetchFeeds(urls) {
      return [{
        title: 'Feed A',
        feedUrl: urls[0],
        episodes: [
          { guid: 'ep-1', title: 'One', audioUrl: 'https://cdn.example.com/1.mp3' },
          { guid: 'ep-2', title: 'Two', audioUrl: 'https://cdn.example.com/2.mp3' }
        ]
      }];
    }
  };
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: feedFake, downloads: downloadsFake } });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());

  const res = await request(server, 'POST', '/api/sync/subscriptions', { headers: { 'x-session-token': 't' }, body: { feedUrl: 'https://example.com/rss' } });
  assert.equal(res.status, 200);
  assert.equal(registered.length, 2);
  assert.deepEqual(registered.map((r) => r.episode_guid), ['ep-1', 'ep-2']);
  assert.equal(registered[0].title, 'One');
  assert.deepEqual(registered.map((r) => r.subscription_id), ['sub_test', 'sub_test']);
});

test('sync add subscription skips episodes that already have a download', async (t) => {
  const registered = [];
  const downloadsFake = {
    records: {},
    async listByUser(userId) { return Object.values(this.records).filter((r) => r.user_id === userId); },
    async register(args) {
      const record = { id: `dl_${registered.length + 1}`, user_id: args.userId, episode_guid: args.episodeGuid, subscription_id: args.subscriptionId, audio_url: args.audioUrl, title: args.title || '', status: 'pending', progress: 0 };
      this.records[record.id] = record;
      registered.push(record);
      return record;
    },
    async findById(id) { return this.records[id] ?? null; },
    async startDownload(record) { record.status = 'completed'; record.progress = 100; return record; },
    async remove() { return { success: true, removed: null }; },
    async deleteById(id) { return { success: true, id } }
  };
  downloadsFake.records['dl_existing'] = { id: 'dl_existing', user_id: 'usr_1', episode_guid: 'ep-1', status: 'completed' };
  const feedFake = {
    async fetchFeeds(urls) {
      return [{ title: 'Feed A', feedUrl: urls[0], episodes: [
        { guid: 'ep-1', title: 'One', audioUrl: 'https://cdn.example.com/1.mp3' },
        { guid: 'ep-2', title: 'Two', audioUrl: 'https://cdn.example.com/2.mp3' }
      ] }];
    }
  };
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: feedFake, downloads: downloadsFake } });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());

  const res = await request(server, 'POST', '/api/sync/subscriptions', { headers: { 'x-session-token': 't' }, body: { feedUrl: 'https://example.com/rss' } });
  assert.equal(res.status, 200);
  assert.deepEqual(registered.map((r) => r.episode_guid), ['ep-2']);
  assert.deepEqual(registered.map((r) => r.subscription_id), ['sub_test']);
});

test('sync save position coerces numeric fields', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/sync/positions', { headers: { 'x-session-token': 't' }, body: { episodeGuid: 'ep_9', positionSeconds: '12.5', completed: true } });
  assert.equal(res.status, 200);
  const call = fakeSync.calls.find((c) => c[0] === 'savePosition');
  assert.equal(call[1].positionSeconds, 12.5);
  assert.equal(call[1].completed, true);
});

test('feed fetch accepts a urls array and returns feeds', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/feed/fetch', { body: { urls: ['https://example.com/rss'] } });
  assert.equal(res.status, 200);
  assert.equal(res.body.feeds.length, 1);
  assert.equal(res.body.feeds[0].title, 'Feed A');
});

test('feed fetch rejects an empty url list', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/feed/fetch', { body: { urls: [] } });
  assert.equal(res.status, 400);
});

test('audio-proxy streams a ranged 206 response with forwarded headers and CORS', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/audio-proxy?url=https://audio.example.com/ep.mp3&range=bytes=0-100`);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes=0-100/200');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(buffer.toString(), 'audio');
});

test('audio-proxy rejects a missing url with 400', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  t.after(() => server.close());
  const res = await request(server, 'GET', '/api/audio-proxy');
  assert.equal(res.status, 400);
});

test('audio-proxy rejects an SSRF-disallowed url with 400', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/audio-proxy?url=${encodeURIComponent('http://localhost:9/internal')}`);
  assert.equal(res.status, 400);
});

test('downloads require authentication on the list endpoint', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  t.after(() => server.close());
  const res = await request(server, 'GET', '/api/downloads');
  assert.equal(res.status, 401);
});

test('downloads register requires episodeGuid and scopes to the user', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const missing = await request(server, 'POST', '/api/downloads', { headers: { 'x-session-token': 't' }, body: {} });
  assert.equal(missing.status, 400);

  const ok = await request(server, 'POST', '/api/downloads', { headers: { 'x-session-token': 't' }, body: { episodeGuid: 'ep_1', audioUrl: 'https://audio.example.com/x.mp3' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.download.id, 'dl_1');
  assert.equal(ok.body.download.user_id, 'usr_1');
});

test('downloads start returns 404 for an unknown id', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/downloads/missing/start', { headers: { 'x-session-token': 't' } });
  assert.equal(res.status, 404);
});

test('downloads delete by id succeeds for the owner', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: { feed: fakeFeed, audioProxy: fakeAudioProxy, downloads: fakeDownloads } });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const res = await request(server, 'DELETE', '/api/downloads/dl_1', { headers: { 'x-session-token': 't' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, id: 'dl_1' });
});

test('user options require authentication (401 without token)', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {}, userService: fakeUser });
  t.after(() => server.close());
  const res = await request(server, 'GET', '/api/user/options');
  assert.equal(res.status, 401);
});

test('user options GET returns the current color', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {}, userService: fakeUser });
  fakeUser.colors['usr_1'] = '#00ff80';
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const res = await request(server, 'GET', '/api/user/options', { headers: { 'x-session-token': 't' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { color: '#00ff80' });
});

test('user options PATCH updates the color', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {}, userService: fakeUser });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const res = await request(server, 'PATCH', '/api/user/options', { headers: { 'x-session-token': 't' }, body: { color: '#abcdef' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { color: '#abcdef' });
  assert.equal(fakeUser.colors['usr_1'], '#abcdef');
});

test('user options PATCH rejects an invalid color with 400', async (t) => {
  const server = buildServer({ auth: fakeAuth, sessions: new Map(), sync: fakeSync, feed: {}, userService: fakeUser });
  fakeAuth.resolved = { 't': { id: 'usr_1', email: 'x@example.com' } };
  t.after(() => server.close());
  const res = await request(server, 'PATCH', '/api/user/options', { headers: { 'x-session-token': 't' }, body: { color: 'not-a-color' } });
  assert.equal(res.status, 400);
});

test('auth login with a password calls loginWithPassword and sets the cookie', async (t) => {
  const passwordAuth = { ...fakeAuth };
  passwordAuth.loginWithPassword = async ({ email, password }) => ({
    success: true,
    sessionToken: `pw-${password}`,
    user: { id: 'usr_1', email }
  });
  const server = buildServer({ auth: passwordAuth, sessions: new Map(), sync: fakeSync, feed: {} });
  t.after(() => server.close());
  const res = await request(server, 'POST', '/api/auth/login', { body: { email: 'local@example.com', password: 'hunter2' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.sessionToken, 'pw-hunter2');
  assert.ok(res.setCookie.some((c) => c.startsWith('podcast_session=')));
});
