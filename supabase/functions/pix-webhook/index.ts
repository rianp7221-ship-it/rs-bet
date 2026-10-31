// pix-webhook — recebe as notificações do gateway e concilia depósitos pendentes.
//   POST (gateway): confere o pagamento na API do gateway e credita via pix_confirm.
//   POST ?mode=reconcile com header x-cron-secret (pg_cron a cada 5 min): revisa os PIX pendentes.
// Publicar com --no-verify-jwt (o gateway não manda JWT).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/auth.ts";
import { type PaymentProvider, paymentProvider } from "../_shared/payments.ts";

async function settle(sb: SupabaseClient, gw: PaymentProvider, chargeId: string): Promise<string> {
  const { data: tx } = await sb.from("transactions").select("id, status, expires_at")
    .eq("gateway", gw.name).eq("provider_id", chargeId).eq("type", "deposit").maybeSingle();
  if (!tx) return "desconhecido";
  const p = await gw.getPayment(chargeId);
  if (p.reference && p.reference !== String(tx.id)) throw new Error(`referência ${p.reference} ≠ depósito ${tx.id}`);
  if (p.status === "approved") {
    const { data, error } = await sb.rpc("pix_confirm", { p_tx: tx.id, p_gateway: gw.name, p_charge: chargeId, p_amount: p.amount });
    if (error) throw new Error(error.message);
    return data as string;
  }
  if (p.status === "failed" && tx.status === "pending") {
    await sb.rpc("pix_fail", { p_tx: tx.id, p_reason: `PIX ${p.detail}` });
    return "cancelado";
  }
  if (p.status === "refunded" && tx.status === "done") {
    await sb.rpc("pix_refunded", { p_tx: tx.id, p_detail: p.detail });
    return "devolvido";
  }
  return p.status;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let gw: PaymentProvider;
  try { gw = paymentProvider(); } catch (e) { return json({ error: (e as Error).message }, 503); }

  if (url.searchParams.get("mode") === "reconcile") {
    const secret = Deno.env.get("CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Sem permissão" }, 401);
    const { data: rows } = await sb.from("transactions").select("provider_id").eq("type", "deposit").eq("status", "pending")
      .eq("gateway", gw.name).not("provider_id", "is", null)
      .gte("created_at", new Date(Date.now() - 3 * 86400_000).toISOString()).order("created_at").limit(100);
    const out: Record<string, number> = {};
    for (const r of rows ?? []) {
      try { const s = await settle(sb, gw, r.provider_id); out[s] = (out[s] ?? 0) + 1; }
      catch (e) { console.error("reconcile", r.provider_id, (e as Error).message); out.erro = (out.erro ?? 0) + 1; }
    }
    return json({ checked: rows?.length ?? 0, ...out });
  }

  const body = await req.json().catch(() => null);
  let id: string | null;
  try { id = await gw.webhookPaymentId(req, url, body); } catch (e) { return json({ error: (e as Error).message }, 401); }
  if (!id) return json({ ignored: true });
  try {
    return json({ result: await settle(sb, gw, id) });
  } catch (e) {
    console.error("webhook", id, (e as Error).message);
    return json({ error: "falha ao processar" }, 500); // gateway reenvia
  }
});
