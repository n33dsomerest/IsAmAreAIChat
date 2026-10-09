/*
 * Service worker.
 *
 * Deliberately conservative: it never caches an authenticated response, and it
 * never serves a stale document over a fresh one. A cached chat page would show
 * another person's conversation on a shared device, which is worse than being
 * offline.
 *
 * Only same-origin, non-API GETs of static assets are handled.
 */

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const PRECACHE = ['/', '/login', '/register', '/pricing', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // `addAll` rejects the whole batch if one entry 404s; each is added
      // individually so a missing asset cannot block installation.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

const isCacheable = (url) =>
  url.origin === self.location.origin &&
  !url.pathname.startsWith('/api/') &&
  !url.pathname.startsWith('/auth/') &&
  !url.pathname.startsWith('/admin');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isCacheable(url)) return;

  // Navigations: network first, cached shell only when the network is gone.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match('/')),
      ),
    );
    return;
  }

  // Static assets: cache first — the hashed filenames make it safe.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});