// Service worker mínimo: deixa o site instalável. Sempre busca na rede (odds e saldo não podem vir de cache).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;text-align:center;padding:40px;background:#ff4d00;color:#fff"><h2>Sem conexão</h2><p>Verifique sua internet e tente de novo.</p></body>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
