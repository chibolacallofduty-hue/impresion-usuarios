// service-worker.js
// Service Worker para "Pedir Impresiones en Línea"
// Nota: el manifest y los íconos ahora están EMBEBIDOS dentro de index.html
// (como data URIs), por eso ya no se listan como archivos aparte aquí.
// Estrategia:
//  - App shell (HTML + librerías CDN): cache-first con actualización en
//    segundo plano (stale-while-revalidate) para carga rápida.
//  - Peticiones a Firebase (datos dinámicos en tiempo real): siempre red
//    directa, sin interceptar, para no servir datos desactualizados.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `mi-impresion-cache-${CACHE_VERSION}`;

// Dominios/orígenes que NUNCA deben cachearse (datos dinámicos / tiempo real)
const NO_CACHE_HOSTS = [
  'firebaseio.com'
];

// Recursos del "app shell" que se precargan al instalar el Service Worker
const APP_SHELL = [
  './',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// ── INSTALL: precachear el app shell ─────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        APP_SHELL.map((url) => {
          // request individual para que un fallo (ej. CDN caído) no rompa
          // la instalación completa del Service Worker
          return cache.add(url).catch((err) => {
            console.warn('No se pudo precachear:', url, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés antiguas ────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia según tipo de recurso ──────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptamos peticiones GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Nunca interceptar/cachear llamadas a Firebase (datos en tiempo real)
  if (NO_CACHE_HOSTS.some((host) => url.hostname.includes(host))) {
    return; // deja pasar la petición directo a la red
  }

  // 2) Navegación (abrir/recargar la app): network-first con fallback a caché
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', resClone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 3) Resto de recursos del app shell (CSS/JS/CDN/íconos/manifest):
  //    stale-while-revalidate → responde rápido desde caché y actualiza
  //    en segundo plano cuando hay conexión.
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && (networkRes.ok || networkRes.type === 'opaque')) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(() => cachedRes);

      return cachedRes || fetchPromise;
    })
  );
});

// ── NOTIFICATIONCLICK: al tocar la notificación, abrir/enfocar la app ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

