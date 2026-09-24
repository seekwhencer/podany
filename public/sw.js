const CACHE_NAME = 'podany-v3';
const AUDIO_CACHE_NAME = 'podany-audio-v1';

const APP_SHELL = [
  '/',
  '/index.html',
   '/css/index.css',
  '/dist/bundle.js',
  '/manifest.webmanifest',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== AUDIO_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  const isAudioRequest = req.headers.get('range') ||
    url.pathname.endsWith('.mp3') ||
    url.pathname.endsWith('.m4a') ||
    url.pathname.endsWith('.aac') ||
    url.pathname.endsWith('.ogg') ||
    url.pathname.endsWith('.wav') ||
    req.destination === 'audio';

  if (isAudioRequest) {
    event.respondWith(handleAudioRequest(req));
    return;
  }

  event.respondWith(handleStaticRequest(req));
});

async function handleAudioRequest(req) {
  const audioCache = await caches.open(AUDIO_CACHE_NAME);
  const cachedResponse = await audioCache.match(req.url);

  if (cachedResponse) {
    const rangeHeader = req.headers.get('range');
    if (!rangeHeader) {
      return cachedResponse;
    }

    const buffer = await cachedResponse.arrayBuffer();
    const total = buffer.byteLength;
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10) || 0;
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const boundedEnd = Math.min(end, total - 1);
    const chunk = buffer.slice(start, boundedEnd + 1);

    return new Response(chunk, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Range': `bytes ${start}-${boundedEnd}/${total}`,
        'Content-Length': String(chunk.byteLength),
        'Accept-Ranges': 'bytes'
      }
    });
  }

  try {
    return await fetch(req);
  } catch (err) {
    return new Response(null, { status: 504, statusText: 'Gateway Timeout (Offline)' });
  }
}

async function handleStaticRequest(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  try {
    const networkResponse = await fetch(req);
    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
      cache.put(req, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('/') || await cache.match('/index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}
