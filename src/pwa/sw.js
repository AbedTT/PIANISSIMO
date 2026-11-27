/* Pianissimo service worker: the editor, viewer and website work offline.
 *
 * Built by the `serviceWorker` plugin in vite.config.ts, which replaces __PRECACHE__ with
 * every file of the build (hashed assets, pages, manifest, icons) and __VERSION__ with a
 * hash of that list, so each new build installs a fresh cache and drops the old one.
 *
 * - Pages: network first, so a new version shows up as soon as you are online; the cached copy offline.
 * - Built assets: cache first (their names change whenever their content does).
 * - Instrument samples from the sound CDNs: cached the first time they play, so a sound you
 *   have heard once also plays offline. The built-in synths need nothing.
 * - The API (/server/…) is never cached: saving and sharing need the server.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `pianissimo-shell-${VERSION}`;
const SAMPLES = 'pianissimo-samples-v1';
const SAMPLE_HOSTS = ['tonejs.github.io', 'gleitz.github.io'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE.map((f) => new URL(f, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pianissimo-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    // the same page with any query (?s=…, ?template=…) is the same file
    const hit = (await cache.match(request, { ignoreVary: true })) ?? (await cache.match(request, { ignoreSearch: true, ignoreVary: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  // precached entries were fetched without the Origin header that module scripts send, and
  // servers answer with `Vary: Origin`: the file is the same, so ignore Vary
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/server/')) return; // the API: always live
    if (url.pathname.startsWith('/__')) return; // the desktop launcher's own routes (opened files): never cached
    if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
      event.respondWith(networkFirst(request));
    } else event.respondWith(cacheFirst(request, SHELL));
  } else if (SAMPLE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, SAMPLES));
  }
});
