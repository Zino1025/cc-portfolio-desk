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
