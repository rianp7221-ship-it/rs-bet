// push-send — envia a fila push_outbox (mensagens/promoções do admin) como notificação no celular (Web Push).
// Chamado na hora por admin_send_notification (pg_net) e, se ficar algo pendente, pelo ops-tick.
// Publicar com --no-verify-jwt. Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { cors, json } from "../_shared/auth.ts";

type Msg = { id: number; user_id: string | null; title: string; body: string | null };
type Sub = { endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Sem permissão" }, 401);
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return json({ error: "VAPID não configurado" }, 500);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:realsports062@gmail.com", pub, priv);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const out: { id: number; sent: number; failed: number }[] = [];
  const { data: msgs } = await sb.rpc("push_claim", { p_limit: 5 });
  for (const m of (msgs ?? []) as Msg[]) {
    const { data: subs, error } = await sb.rpc("push_targets", { p_user: m.user_id });
    if (error) continue; // fica reservada e volta para a fila em 5 min (push_claim)
    // o push tem limite de ~4 KB; o texto completo continua no sino do site
    const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
    const payload = JSON.stringify({ title: cut(m.title, 120), body: cut(m.body ?? "", 900), url: "/index.html", tag: `rs-msg-${m.id}` });
    const gone: string[] = [];
    let sent = 0, failed = 0;
    const list = (subs ?? []) as Sub[];
    for (let i = 0; i < list.length; i += 25) {
      await Promise.all(list.slice(i, i + 25).map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "normal" });
          sent++;
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.push(s.endpoint);
          failed++;
        }
      }));
    }
    if (gone.length) await sb.from("push_subscriptions").delete().in("endpoint", gone);
    await sb.from("push_outbox").update({ done_at: new Date().toISOString(), sent, failed }).eq("id", m.id);
    out.push({ id: m.id, sent, failed });
  }
  return json({ messages: out });
});
