// Deixa a EDNA abrir sem internet e recebe os avisos de pedido (Web Push).
// Rede primeiro (para atualização chegar logo), cache como reserva.
const CACHE = "edna-v2";
const ARQUIVOS = ["./", "./app.js", "./datas.js", "./amor.js", "./manifest.webmanifest", "./icone-192.png", "./icone-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Chegou pedido: mostra a notificação mesmo com o app fechado.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.titulo || "EDNA", {
    body: d.corpo || "",
    tag: d.tag || "edna",
    renotify: true,
    icon: "icone-192.png",
    badge: "icone-192.png",
    data: { url: d.url || "./" },
  }));
});

// Tocar na notificação abre (ou traz para a frente) o app.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data && e.notification.data.url || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
    for (const j of janelas) if (j.url.startsWith(self.registration.scope) && "focus" in j) return j.focus();
    return clients.openWindow(alvo);
  }));
});
