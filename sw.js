const CACHE = "name-dictionary-v1.6-20261107";
const FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./dictionary.js",
  "./document.js",
  "./styles.css",
  "./pwa.js",
  "./manifest.webmanifest",
  "./data/names.json",
  "./data/meta.json",
  "./data/dictionary.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];
// words.json / words.json.gz are NOT in the install precache so first paint
// stays around the ~10MB core dictionary. They are runtime-cached on first
// fetch (문서 tab or idle prefetch) and then work offline.

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k.startsWith("name-dictionary-") && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res && res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    } catch (err) {
      if (e.request.mode === "navigate") {
        const page = await caches.match("./index.html") || await caches.match("./");
        if (page) return page;
      }
      return Response.error();
    }
  })());
});
