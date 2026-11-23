// Service worker mínimo: deixa o site instalável. Sempre busca na rede (odds e saldo não podem vir de cache).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;text-align:center;padding:40px;background:#ff4d00;color:#fff"><h2>Sem conexão</h2><p>Verifique sua internet e tente de novo.</p></body>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

// notificação no celular (mensagens/promoções do admin, migration 095)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Real Sports", {
    body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.tag, data: { url: d.url || "/index.html" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/index.html", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.location.origin));
    return w ? w.focus() : self.clients.openWindow(url); // não recarrega a aba aberta (perderia o bilhete em andamento)
  }));
});
