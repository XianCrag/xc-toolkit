/**
 * Service worker — cache-then-network (stale-while-revalidate).
 * Same-origin: serve cache immediately, refresh in background.
 * Cross-origin (CDN): network-first with cache fallback.
 */

const CACHE_VERSION = "xc-toolkit-v9";
const PRECACHE = [
  "./",
  "./index.html",
  "./xiancrag-ui.css",
  "./manifest.webmanifest",
  "./pwa-register.js",
  "./chart-fit.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./market-temp/index.html",
  "./market-temp/styles.css",
  "./market-temp/app.js",
  "./market-temp/engine.js",
  "./touch-odds/index.html",
  "./touch-odds/styles.css",
  "./touch-odds/app.js",
  "./touch-odds/engine.js",
  "./rolling-bond/index.html",
  "./rolling-bond/styles.css",
  "./rolling-bond/script.js",
  "./rolling-bond/simulation.js",
  "./scaling-in/index.html",
  "./scaling-in/styles.css",
  "./scaling-in/app.js",
  "./scaling-in/engine.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            /* skip missing optional assets */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Match a request, including directory → index.html for offline nav.
 * @param {Cache} cache
 * @param {Request} request
 */
async function matchCached(cache, request) {
  const direct = await cache.match(request);
  if (direct) return direct;

  // Ignore cache-busting query strings (e.g. styles.css?v=25)
  const url = new URL(request.url);
  if (url.search) {
    const noSearch = new Request(url.origin + url.pathname + url.hash, request);
    const stripped = await cache.match(noSearch);
    if (stripped) return stripped;
    const byPath = await cache.match("." + url.pathname);
    if (byPath) return byPath;
  }

  if (request.mode === "navigate" || url.pathname.endsWith("/")) {
    const withIndex = new URL(url.origin + url.pathname.replace(/\/?$/, "/index.html"));
    const indexed = await cache.match(withIndex.href);
    if (indexed) return indexed;
    const relIndex = "." + withIndex.pathname;
    const byRel = await cache.match(relIndex);
    if (byRel) return byRel;
  }

  // Relative precache keys like "./scaling-in/index.html"
  const rel = "." + (url.pathname.endsWith("/")
    ? url.pathname + "index.html"
    : url.pathname);
  const byPath = await cache.match(rel);
  if (byPath) return byPath;

  return null;
}

/**
 * @param {Request} request
 * @param {Cache} cache
 */
async function cacheThenNetwork(request, cache) {
  const cached = await matchCached(cache, request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;

  if (request.mode === "navigate") {
    const home = await cache.match("./index.html");
    if (home) return home;
  }
  return Response.error();
}

/**
 * @param {Request} request
 * @param {Cache} cache
 */
async function networkFirst(request, cache) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await matchCached(cache, request);
    if (cached) return cached;
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) => {
      if (url.origin === self.location.origin) {
        return cacheThenNetwork(request, cache);
      }
      return networkFirst(request, cache);
    }),
  );
});
