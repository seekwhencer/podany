const CACHE_NAME = 'podany-v3';

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
          if (key !== CACHE_NAME) {
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

  event.respondWith(handleStaticRequest(req));
});

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
