import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeedService } from './feedService.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Test Podcast</title>
    <description>A test feed</description>
    <link>https://example.com</link>
    <image><url>https://example.com/img.jpg</url></image>
    <item>
      <guid>ep-1</guid>
      <title>Episode One</title>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg" length="100"/>
      <itunes:duration>30:00</itunes:duration>
    </item>
    <item>
      <guid>ep-2</guid>
      <title>Episode Two</title>
      <pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep2.mp3" type="audio/mpeg" length="200"/>
    </item>
  </channel>
</rss>`;

function makeFetch(routes) {
  return async (url, init) => {
    const handler = routes(url, init);
    if (!handler) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    return handler;
  };
}

test('fetchFeed parses an RSS feed and sorts episodes newest first', async () => {
  const fetchImpl = makeFetch((url) => {
    if (!url.startsWith('http')) throw new Error('bad url');
    return { ok: true, status: 200, text: async () => RSS };
  });
  const service = new FeedService({ fetchImpl });
  const feed = await service.fetchFeed('https://cdn.example.com/feed.xml');
  assert.equal(feed.title, 'Test Podcast');
  assert.equal(feed.episodesCount, 2);
  assert.deepEqual(feed.episodes.map((e) => e.guid), ['ep-2', 'ep-1']);
  assert.equal(feed.episodes[0].audioUrl, 'https://cdn.example.com/ep2.mp3');
  assert.equal(feed.episodes[1].duration, '30:00');
  assert.equal(feed.episodes[0].artwork, 'https://example.com/img.jpg');
});

test('fetchFeed rejects SSRF / invalid urls', async () => {
  const service = new FeedService({ fetchImpl: async () => ({ ok: true, text: async () => '' }) });
  await assert.rejects(() => service.fetchFeed('http://localhost/secret'), /Invalid or disallowed/);
});

test('fetchFeed falls back to oembed for a youtube playlist with no entries', async () => {
  let rssCalls = 0;
  const fetchImpl = makeFetch((url) => {
    if (url.includes('/feeds/videos.xml')) {
      rssCalls += 1;
      return { ok: true, status: 200, text: async () => '<feed xmlns="http://www.w3.org/2005/Atom"></feed>' };
    }
    if (url.includes('/oembed')) {
      return { ok: true, status: 200, json: async () => ({ title: 'My Playlist', author_name: 'Creator', thumbnail_url: 'https://img/y.jpg' }) };
    }
    return null;
  });
  const service = new FeedService({ fetchImpl });
  const feed = await service.fetchFeed('https://www.youtube.com/playlist?list=ABC123');
  assert.equal(rssCalls, 1);
  assert.equal(feed.episodesCount, 1);
  assert.equal(feed.episodes[0].playlistId, 'ABC123');
  assert.equal(feed.episodes[0].isYouTubePlaylist, true);
  assert.equal(feed.title, 'My Playlist');
});

test('fetchFeeds filters invalid urls and drops failures', async () => {
  const calls = [];
  const fetchImpl = makeFetch((url) => {
    calls.push(url);
    if (url === 'https://good.example/feed.xml') return { ok: true, status: 200, text: async () => RSS };
    throw new Error('network down');
  });
  const service = new FeedService({ fetchImpl });
  const feeds = await service.fetchFeeds([
    'not a url',
    'https://good.example/feed.xml',
    'https://broken.example/feed.xml'
  ]);
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].title, 'Test Podcast');
});
