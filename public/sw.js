// Offline is the feature, not a nicety: a survey happens where there is no bar
// of signal, so the shell and the runtime both have to come from cache.
//
// Model weights are not handled here. transformers.js keeps them in its own
// Cache Storage ("transformers-cache"), which works even on a first visit this
// worker does not control yet. Caching them here as well stored every model
// twice, and the old clean-up below deleted the library's copy on each update.

const PREFIX = 'trailworthy-';
const SHELL = `${PREFIX}shell-v3`;

// Written by the build (see vite.config.js); missing in dev, which is fine.
async function precacheList() {
  try {
    const response = await fetch('./precache.json', { cache: 'no-store' });
    return response.ok ? await response.json() : [];
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // index.html is listed by hand: the build writes it after the manifest.
    const files = new Set(['./', './index.html', ...(await precacheList()).map((name) => `./${name}`)]);
    // One by one rather than addAll, so a single failed file does not leave
    // the whole app uncached.
    await Promise.allSettled([...files].map((file) => cache.add(new Request(file, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Only this app's own caches: earlier shells, and the weights cache an
      // earlier version kept. Anything else (transformers-cache) is not ours.
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(PREFIX) && key !== SHELL).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Used for everything this app ships itself. Cache-first is the obvious choice
// for an offline app and the wrong one here: it pins users to whatever build
// they first loaded, and a fix can never reach them. Going to the network first
// costs a little speed while online and still falls back to cache the moment
// there is no signal, which is the case that actually matters on a trail.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((hit) => hit ?? Response.error()))
    );
    return;
  }

  event.respondWith(networkFirst(request, SHELL));
});
