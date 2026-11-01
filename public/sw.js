/* Service worker — PWA installability only.
 *
 * CACHING POLICY (deliberate): this is a sensitive financial application, so no
 * financial responses, customer documents, receipts, API calls, or HTML pages
 * are ever cached. Only immutable static assets (self-hosted fonts, app icons,
 * the manifest) use a cache-first strategy. Navigations and API calls are
 * network-only, so private data is never served from a stale cache to a user
 * who has already logged out. Offline functionality is intentionally not
 * supported (per business requirements).
 */
const VERSION = "isa-pwa-v1";
const STATIC_CACHE = `${VERSION}-static`;
const STATIC_ASSETS = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable.png",
  "/fonts/Vazirmatn-Regular.woff2",
  "/fonts/Vazirmatn-Bold.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("isa-pwa-") && k !== STATIC_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isGet = event.request.method === "GET";

  // Documents, receipts, API and any authenticated/financial response are
  // network-only and never stored.
  if (
    !isGet ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_receipts") ||
    url.pathname.includes("/docs/") ||
    url.searchParams.has("download")
  ) {
    return; // fall through to network
  }

  const staticAsset = STATIC_ASSETS.includes(url.pathname) || /fonts\/[\w.-]+\.woff2$/.test(url.pathname) || /icon(-\d+)?(\.maskable)?\.png$/.test(url.pathname);
  if (staticAsset) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(event.request, clone));
        }
        return res;
      })),
    );
    return;
  }

  // Everything else (navigations, chunks, pages) is network-first, no caching.
});
