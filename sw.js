// Service worker for the static website. artifact/build.mjs fills in RELEASE and SHELL and writes it as sw.js.
//
// - The page itself: network first; from this release's cache when offline or the network stalls.
// - assets/ (content-hashed bundle): from this release's cache.
// - locked/**.bin (encrypted audio, PDFs, word lists and the payload; names change whenever the bytes do):
//   cached on first use and kept across releases, so a played episode opens again without the network.
// - locked/keys.json: network first, cached copy only when offline.
// - Everything else (version.json, the free episode's streamed audio, word pronunciations): the browser as usual.
const RELEASE = "556638212965";
/* global __SHELL__ */
const SHELL = ["./","assets/app.ce94ac9ce3.js","assets/app.bceb7a0807.css","favicon.svg","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","icons/apple-touch-icon.png"];
const SHELL_CACHE = `shiyin-shell-${RELEASE}`;
const CONTENT_CACHE = "shiyin-content";
/** How many cached files of each kind to keep (oldest dropped first). */
const LIMITS = { media: 16, vocab: 2, payload: 2 };

const scope = new URL(self.registration.scope);
const pathOf = (url) => url.pathname.slice(scope.pathname.length);
const home = new URL("./", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("shiyin-shell-") && name !== SHELL_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = pathOf(url);
  if (request.mode === "navigate") event.respondWith(page(request));
  else if (path.startsWith("assets/")) event.respondWith(cacheFirst(event, SHELL_CACHE, null));
  else if (path === "locked/keys.json") event.respondWith(networkFirst(request));
  else if (path.startsWith("locked/") && path.endsWith(".bin")) event.respondWith(cacheFirst(event, CONTENT_CACHE, kindOf(path)));
});

function kindOf(path) {
  if (!path.startsWith("locked/") || !path.endsWith(".bin")) return null;
  if (path.startsWith("locked/media/")) return "media";
  if (path.startsWith("locked/vocab/")) return "vocab";
  return "payload";
}

/** The page: whatever the network gives within a few seconds, else this release's copy. */
async function page(request) {
  const cached = caches.match(home, { cacheName: SHELL_CACHE });
  const network = fetch(request);
  network.catch(() => {});
  const stalled = new Promise((resolve) => setTimeout(resolve, 4000)).then(() => cached);
  try {
    return (await Promise.race([network, stalled])) ?? (await network);
  } catch {
    return (await cached) ?? Response.error();
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CONTENT_CACHE);
  const key = request.url.split("?")[0];
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) ?? Response.error();
  }
}

async function cacheFirst(event, cacheName, kind) {
  const cache = await caches.open(cacheName);
  const key = event.request.url.split("?")[0];
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.status === 200 && response.type === "basic") {
    event.waitUntil(cache.put(key, response.clone()).then(() => (kind ? trim(cache, kind) : undefined)).catch(() => {}));
  }
  return response;
}

async function trim(cache, kind) {
  const keys = (await cache.keys()).filter((request) => kindOf(pathOf(new URL(request.url))) === kind);
  for (const request of keys.slice(0, Math.max(0, keys.length - LIMITS[kind]))) await cache.delete(request);
}
