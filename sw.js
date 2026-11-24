// Service worker: makes the Desk installable and quick to open.
// Pages: network first, last copy when offline. Versioned files (?v=, icons, pinned CDN libraries): cache first,
// safe because every change gets a new ?v= URL. Supabase and price APIs are never touched.
const C = "cc-desk-1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(C).then((x) => x.put("./", c)); return res; }).catch(() => caches.match("./")));
    return;
  }
  const own = u.origin === location.origin;
  if (own ? !(u.search.includes("v=") || u.pathname.includes("/icons/")) : !/^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)$/.test(u.host)) return;
  e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(C).then((x) => x.put(r, c)); } return res; })));
});

// App notifications. The icon badge starts from the app's unread count and goes up by one per ping until the app opens again.
// Stored in a cache entry because iOS stops the worker between pings.
const BADGE = "./__badge";
const setBadge = (n) => caches.open(C).then((x) => x.put(BADGE, new Response(String(n))));
self.addEventListener("message", (e) => { if (typeof e.data?.badge === "number") e.waitUntil(setBadge(e.data.badge)); });
self.addEventListener("push", (e) => {
  const d = e.data?.json() ?? {};
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || "CC Desk", { body: d.body || "", icon: "icons/icon-192.png", data: { go: d.go || "" } }),
    caches.match(BADGE).then((r) => (r ? r.text() : "0")).then((t) => { const n = (+t || 0) + 1; return Promise.all([setBadge(n), navigator.setAppBadge?.(n)]); }).catch(() => {}),
  ]));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(`./?go=${e.notification.data?.go || ""}`, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    const w = ws[0];
    return w ? w.navigate(url).then((x) => (x || w).focus()) : self.clients.openWindow(url);
  }));
});
