// pix-create — gera (ou reabre) a cobrança PIX de um depósito pendente do jogador logado.
// Body: { tx_id }. O valor vem do banco (request_deposit), nunca do navegador.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/auth.ts";
import { paymentProvider } from "../_shared/payments.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const userSb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return json({ error: "Faça login" }, 401);
  const txId = Number((await req.json().catch(() => ({})))?.tx_id);
  if (!Number.isInteger(txId) || txId <= 0) return json({ error: "Depósito inválido" }, 400);

  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: tx } = await sb.from("transactions").select("id, user_id, type, status, amount, gateway, provider_id, expires_at")
    .eq("id", txId).maybeSingle();
  if (!tx || tx.user_id !== user.id || tx.type !== "deposit") return json({ error: "Depósito não encontrado" }, 404);
  if (tx.status !== "pending") return json({ error: "Este depósito não está mais pendente" }, 409);

  try {
    const gw = paymentProvider();
    // já gerado: devolve o mesmo QR se ainda for válido
    if (tx.provider_id && tx.gateway === gw.name) {
      const p = await gw.getPayment(tx.provider_id);
      if (p.status === "pending" && p.charge && new Date(tx.expires_at ?? 0).getTime() > Date.now() + 60_000) {
        return json({ ...p.charge, expires_at: tx.expires_at });
      }
      return json({ error: "Este PIX expirou. Gere um novo depósito." }, 409);
    }
    const { data: s } = await sb.from("settings").select("value").eq("key", "pix_expire_minutes").maybeSingle();
    const minutes = Math.min(Math.max(Number(s?.value) || 30, 30), 1440);
    const c = await gw.createPix({
      reference: String(tx.id), amount: Number(tx.amount), description: `Depósito Real Sports #${tx.id}`,
      email: user.email ?? `${user.id}@realsports.online`, expiresAt: new Date(Date.now() + minutes * 60_000),
      notifyUrl: `${url}/functions/v1/pix-webhook`,
    });
    const { data: upd, error } = await sb.from("transactions")
      .update({ gateway: gw.name, provider_id: c.id, expires_at: c.expires_at, method: "PIX" })
      .eq("id", tx.id).is("provider_id", null).select("id");
    if (error || !upd?.length) return json({ error: "Depósito já tem um PIX gerado" }, 409);
    return json({ qr_code: c.qr_code, qr_base64: c.qr_base64, ticket_url: c.ticket_url, expires_at: c.expires_at });
  } catch (e) {
    console.error("pix-create", txId, (e as Error).message);
    return json({ error: "Não foi possível gerar o PIX agora. Tente de novo em instantes." }, 502);
  }
});
