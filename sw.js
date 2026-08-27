// Due strategie, per due tipi di risorsa molto diversi.
//
// File dell'app (piccoli, cambiano a ogni deploy) -> rete per prima, cache come
//   riserva. Vedi sempre l'ultima versione, e offline funziona lo stesso.
// Pyodide dal CDN (~12 MB, URL con versione fissa) -> cache per prima. Scaricarlo
//   una volta sola e' il vero motivo per cui questo service worker esiste.

const VERSIONE = "v1";
const SHELL = "shell-" + VERSIONE;
const RUNTIME = "runtime-" + VERSIONE;

const PRECACHE = [
  "./",
  "index.html",
  "manifest.json",
  "icon.svg",
  "css/style.css",
  "js/app.js",
  "js/runner.js",
  "js/scheduler.js",
  "js/storage.js",
  "js/md.js",
  "content/index.json",
  "content/m01-creazione.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // addAll fallisce tutto se un file manca: qui li aggiungo uno a uno cosi
      // un contenuto rinominato non impedisce l'installazione.
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((k) => Promise.all(k.filter((n) => !n.endsWith(VERSIONE)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(cacheFirst(request));
  } else if (url.origin === location.origin) {
    e.respondWith(networkFirst(request));
  }
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw err;
  }
}
