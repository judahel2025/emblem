// Minimal service worker — enables install + an offline shell fallback.
// API calls always hit the network (we want live data); only the app shell is cached.
const CACHE = "veyra-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).pathname.startsWith("/api")) return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put("/", res.clone())); return res; })
        .catch(() => caches.match("/"))
    );
  }
});
