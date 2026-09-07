// atelier — offline cache
//
// Precaches the gallery shell plus every app under apps/ (listed in
// apps-manifest.json) so the whole thing keeps working with no network
// after the first successful load. Cache-first for everything here:
// these are static, versioned-by-cache-name assets, not live data.

const CACHE_NAME = "atelier-v2";
const SHELL = ["./", "index.html", "gallery.css", "gallery.js", "manifest.json", "icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(SHELL);
      try {
        const res = await fetch("apps-manifest.json");
        const files = await res.json();
        await cache.addAll(files);
      } catch (err) {
        // Offline on first install with no prior cache: nothing to do,
        // apps will just fail to precache until a later online visit.
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (e.g. webfonts) hit the network normally

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const fresh = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, fresh.clone());
        return fresh;
      } catch (err) {
        if (event.request.mode === "navigate") {
          const fallback = await caches.match("index.html");
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
