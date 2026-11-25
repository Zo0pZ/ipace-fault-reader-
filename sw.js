/* Offline cache. Bump CACHE when files change (it follows the app version). */
const CACHE = "ipace-diag-v1.1.0";
const SHELL = ["./","index.html","css/app.css","manifest.webmanifest","icons/icon.svg","icons/icon-192.png","icons/icon-512.png",
  "js/app.js","js/version.js","js/safety.js","js/data.js","js/decode.js","js/elm.js","js/transport.js","js/diag.js","js/report.js"];
self.addEventListener("install", e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener("activate", e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", e=>{
  const req=e.request; if (req.method!=="GET") return;
  const url=new URL(req.url);
  if (url.origin===location.origin){
    /* network first so updates arrive, cache when offline */
    e.respondWith(fetch(req).then(r=>{ const copy=r.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); return r; }).catch(()=>caches.match(req,{ignoreSearch:true})));
  } else if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")){
    e.respondWith(caches.match(req).then(hit=>hit || fetch(req).then(r=>{ const copy=r.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); return r; })));
  }
});
