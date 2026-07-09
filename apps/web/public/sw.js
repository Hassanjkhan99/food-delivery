// Service worker: offline shell (precache), network-first navigation with offline
// fallback, cache-first static assets. The GraphQL API (POST + SSE) is never cached.
const SHELL_CACHE = "fd-shell-v1";
const SHELL_URLS = ["/offline", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/graphql")) return;

  // Navigations: network-first, offline shell as fallback.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets: cache-first with background fill.
  if (url.origin === self.location.origin && /\.(png|svg|webp|woff2|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ??
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
            return res;
          }),
      ),
    );
  }
});

// Web push stub — payloads render as a basic notification once VAPID is configured.
self.addEventListener("push", (event) => {
  const data = event.data?.json?.() ?? { title: "KhaanaDo", body: "Order update" };
  event.waitUntil(
    self.registration.showNotification(data.title ?? "KhaanaDo", {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
    }),
  );
});
