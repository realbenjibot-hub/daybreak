/* Daybreak service worker — offline support + instant loads.
   Strategy: network-first for the page (so online opens get the latest),
   stale-while-revalidate for fonts/icon/static (instant, refresh in background). */
var CACHE = "daybreak-v1";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-512.png"];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // The app page: network-first, fall back to cache when offline.
  if (req.mode === "navigate" || (url.origin === location.origin && url.pathname.indexOf("index.html") !== -1)) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("./index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("./index.html").then(function (r) { return r || caches.match("./"); });
      })
    );
    return;
  }

  // Fonts + same-origin assets: serve from cache fast, update in the background.
  var isFont = url.host.indexOf("fonts.googleapis.com") !== -1 || url.host.indexOf("fonts.gstatic.com") !== -1;
  if (url.origin === location.origin || isFont) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
  }
});
