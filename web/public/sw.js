const CACHE = "homehub-v0.22.2";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(r => r || caches.match("/"))));
});
self.addEventListener("push", (event) => {
  let data = { title: "HomeHub", body: "Új értesítés", url: "/#actions", tag: "homehub" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { if (event.data) data.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(data.title || "HomeHub", {
    body: data.body || "Új értesítés",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "homehub",
    data: { url: data.url || "/#actions" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/#actions";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) { if ("focus" in client) { client.navigate(url); return client.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
