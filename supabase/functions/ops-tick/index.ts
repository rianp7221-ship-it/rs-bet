// ops-tick — chamado pelo pg_cron a cada minuto (header x-cron-secret).
//   1. Envia os e-mails da fila (alerta de aposta alta) pelo Resend, se RESEND_API_KEY estiver salvo.
//   2. Envia os saques automáticos pelo gateway de PIX (PAYOUT_PROVIDER), se configurado.
// Publicar com --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/auth.ts";
import { payoutProvider } from "../_shared/payments.ts";

type Email = { id: number; to_email: string; subject: string; body: string };
type Tx = { id: number; amount: number; pix_key: string; pix_key_type: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Sem permissão" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const email = { configured: false, sent: 0, failed: 0 };
  const key = Deno.env.get("RESEND_API_KEY");
  if (key) {
    email.configured = true;
    const from = Deno.env.get("RESEND_FROM") ?? "Real Sports <alertas@realsports.online>";
    const { data } = await sb.rpc("email_claim", { p_limit: 20 });
    for (const e of (data ?? []) as Email[]) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `rs-email-${e.id}` },
          body: JSON.stringify({ from, to: e.to_email.split(",").map((x) => x.trim()).filter(Boolean), subject: e.subject, text: e.body }),
        });
        if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
        await sb.rpc("email_result", { p_id: e.id, p_ok: true, p_error: null });
        email.sent++;
      } catch (err) {
        await sb.rpc("email_result", { p_id: e.id, p_ok: false, p_error: (err as Error).message });
        email.failed++;
      }
    }
  }

  const payout: { provider: string | null; sent: number; failed: number; error?: string } = { provider: null, sent: 0, failed: 0 };
  try {
    const gw = payoutProvider();
    if (gw) {
      payout.provider = gw.name;
      const { data } = await sb.rpc("payout_claim", { p_limit: 10 });
      for (const t of (data ?? []) as Tx[]) {
        try {
          const r = await gw.sendPix({ reference: `rs-withdraw-${t.id}`, amount: Math.abs(Number(t.amount)), key: t.pix_key,
            keyType: t.pix_key_type, description: `Saque Real Sports #${t.id}` });
          await sb.rpc("payout_result", { p_tx: t.id, p_ok: r.ok, p_id: r.id, p_error: r.ok ? null : r.detail });
          r.ok ? payout.sent++ : payout.failed++;
        } catch (err) {
          await sb.rpc("payout_result", { p_tx: t.id, p_ok: false, p_id: null, p_error: (err as Error).message });
          payout.failed++;
        }
      }
    }
  } catch (err) {
    payout.error = (err as Error).message;
  }

  await sb.from("ops_status").upsert([
    { key: "email", value: email, updated_at: new Date().toISOString() },
    { key: "payout", value: payout, updated_at: new Date().toISOString() },
  ]);
  return json({ email, payout });
});
