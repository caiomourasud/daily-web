// The cache that makes the installed PWA open at once.
//
// Flutter used to generate this file. It does not any more: since 3.35 the
// worker it writes for `--pwa-strategy=offline-first` is a stub that
// unregisters itself (see the SDK's `flutter_service_worker.js`), and the
// loader only registers a worker when one is already registered. Caching a
// Flutter app on the web is now the app's job, so this is ours.
//
// It is cache-first over the whole build: an app that changed nothing since
// last launch should not download five megabytes to find that out. Freshness
// is bought back in two places — `BUILD` below, stamped into this file after
// every build by `tool/finish_web_build.dart`, and the check in `index.html`.

const BUILD = '215';

// Keyed by the build, so a deploy is an atomic swap rather than a merge: the
// new worker fills `daily-72` from scratch and drops `daily-71` whole. Mixing
// a `main.dart.js` from one build with the assets of another is the failure
// this avoids.
const CACHE = `daily-${BUILD}`;

// Everything is served relative to `--base-href`, which is this worker's
// scope.
const SHELL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.add(new Request(SHELL, {cache: 'reload'}));
      } catch (e) {
        // A shell that did not precache is a slow first paint, not a broken
        // app: the fetch handler puts it in the cache on the way past.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      // Claim the page that registered us, so the very first visit is cached
      // as it loads instead of only from the second one onwards.
      await self.clients.claim();
    })(),
  );
});

// What the page actually loaded, sent by index.html once it has painted.
//
// A worker only sees the requests it controls, and it takes control partway
// through the first load — so the launch that installs it caches the tail of
// itself and not `main.dart.js`. Without this, a deploy costs two slow
// launches instead of one: the page hands over its own resource list and the
// gap closes on the spot, off the browser's HTTP cache it just filled.
self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.type !== 'daily-cache') return;
  event.waitUntil(warm(message.urls || []));
});

async function warm(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(
    urls.map(async (href) => {
      let url;
      try {
        url = new URL(href, self.registration.scope);
      } catch (e) {
        return;
      }
      if (!url.href.startsWith(self.registration.scope)) return;
      if (url.pathname.endsWith('/version.json')) return;
      if (await cache.match(url.href)) return;
      try {
        const answer = await fetch(url.href);
        if (answer.status === 200 && answer.type === 'basic') {
          await cache.put(url.href, answer);
        }
      } catch (e) {
        // Next launch, then. The fetch handler catches it either way.
      }
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Firestore, Storage, anything signed in: not ours to cache, and a cached
  // answer to a live query would be worse than a slow one.
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(self.registration.scope)) return;
  // The freshness check in index.html reads this, and a cached copy of it
  // would tell the page it is up to date forever.
  if (url.pathname.endsWith('/version.json')) return;

  // A deep link (`/daily-web/week?post=p2`) is the app shell too — Pages
  // answers it with a copy of index.html, and with 404 attached. Serving the
  // shell ourselves gets the app back offline and drops the 404.
  if (request.mode === 'navigate') {
    event.respondWith(shell(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function shell(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(SHELL);
  if (hit) return hit;
  try {
    const answer = await fetch(SHELL, {cache: 'reload'});
    if (answer.ok) cache.put(SHELL, answer.clone());
    return answer;
  } catch (e) {
    return fetch(request);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const answer = await fetch(request);
  // `basic` is same-origin and readable; a 206 range response (video) must
  // never be stored as if it were the whole file.
  if (answer.status === 200 && answer.type === 'basic') {
    cache.put(request, answer.clone());
  }
  return answer;
}
