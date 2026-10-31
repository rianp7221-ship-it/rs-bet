// Adaptadores de gateway PIX. Para trocar de gateway: implemente PaymentProvider, registre em PROVIDERS
// e defina o secret PAYMENT_PROVIDER com o nome do adaptador (padrão: mercadopago).

export type Charge = { id: string; qr_code: string; qr_base64: string | null; ticket_url: string | null; expires_at: string };
export type PaymentInfo = {
  id: string; status: "approved" | "pending" | "failed" | "refunded"; amount: number; reference: string | null;
  detail: string; charge: Omit<Charge, "id" | "expires_at"> | null;
};
export type CreatePix = { reference: string; amount: number; description: string; email: string; expiresAt: Date; notifyUrl: string };

export interface PaymentProvider {
  name: string;
  createPix(p: CreatePix): Promise<Charge>;
  getPayment(id: string): Promise<PaymentInfo>;
  // Valida a notificação e devolve o id do pagamento (ou null se não for de pagamento).
  webhookPaymentId(req: Request, url: URL, body: Record<string, unknown> | null): Promise<string | null>;
}

// ---------- Mercado Pago (API de pagamentos v1) ----------
type MpPayment = {
  id: number; status: string; status_detail?: string; transaction_amount: number; external_reference?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
};

const brIso = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().replace("Z", "-03:00");

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mercadoPago(token: string, webhookSecret?: string): PaymentProvider {
  const API = "https://api.mercadopago.com/v1/payments";
  const call = async (url: string, init: RequestInit = {}): Promise<MpPayment> => {
    const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${body?.message ?? "erro"}`);
    return body;
  };
  const charge = (p: MpPayment) => {
    const t = p.point_of_interaction?.transaction_data;
    return t?.qr_code ? { qr_code: t.qr_code, qr_base64: t.qr_code_base64 ?? null, ticket_url: t.ticket_url ?? null } : null;
  };
  return {
    name: "mercadopago",
    async createPix(c) {
      const p = await call(API, {
        method: "POST",
        headers: { "X-Idempotency-Key": `rs-deposit-${c.reference}` },
        body: JSON.stringify({
          transaction_amount: c.amount, description: c.description, payment_method_id: "pix",
          payer: { email: c.email }, external_reference: c.reference, notification_url: c.notifyUrl,
          date_of_expiration: brIso(c.expiresAt),
        }),
      });
      const ch = charge(p);
      if (!ch) throw new Error("Mercado Pago não devolveu o código PIX");
      return { id: String(p.id), ...ch, expires_at: p.date_of_expiration ?? c.expiresAt.toISOString() };
    },
    async getPayment(id) {
      const p = await call(`${API}/${encodeURIComponent(id)}`);
      const s = p.status;
      return {
        id: String(p.id), amount: Number(p.transaction_amount), reference: p.external_reference ?? null,
        status: s === "approved" ? "approved" : ["refunded", "charged_back"].includes(s) ? "refunded"
          : ["rejected", "cancelled"].includes(s) ? "failed" : "pending",
        detail: `${s}${p.status_detail ? "/" + p.status_detail : ""}`, charge: charge(p),
      };
    },
    async webhookPaymentId(req, url, body) {
      const data = body?.data as { id?: string | number } | undefined;
      const type = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? (body?.type as string | undefined);
      const id = url.searchParams.get("data.id") ?? (data?.id != null ? String(data.id) : null) ?? url.searchParams.get("id");
      if (type !== "payment" || !id || !/^\d+$/.test(id)) return null;
      // Se o segredo de webhook estiver salvo e a notificação vier assinada, confere a assinatura.
      // De qualquer forma o pagamento é sempre consultado na API antes de creditar.
      const sig = req.headers.get("x-signature");
      if (webhookSecret && sig) {
        const parts = Object.fromEntries(sig.split(",").map((kv) => kv.trim().split("=", 2)));
        const manifest = `id:${id};request-id:${req.headers.get("x-request-id") ?? ""};ts:${parts.ts};`;
        if (!parts.v1 || (await hmacHex(webhookSecret, manifest)) !== parts.v1) throw new Error("assinatura inválida");
      }
      return id;
    },
  };
}

const PROVIDERS: Record<string, () => PaymentProvider> = {
  mercadopago: () => {
    const t = Deno.env.get("MP_ACCESS_TOKEN");
    if (!t) throw new Error("Gateway PIX não configurado (secret MP_ACCESS_TOKEN)");
    return mercadoPago(t, Deno.env.get("MP_WEBHOOK_SECRET") ?? undefined);
  },
};

export function paymentProvider(): PaymentProvider {
  const name = Deno.env.get("PAYMENT_PROVIDER") ?? "mercadopago";
  const make = PROVIDERS[name];
  if (!make) throw new Error(`Gateway PIX desconhecido: ${name}`);
  return make();
}

// ---------- Envio de PIX (saque automático) ----------
// Para ligar: implemente PayoutProvider, registre em PAYOUTS e defina o secret PAYOUT_PROVIDER com o nome.
// Sem PAYOUT_PROVIDER, os saques automáticos ficam na fila até um gateway ser configurado.
export type SendPix = { reference: string; amount: number; key: string; keyType: string; description: string };
export type PayoutResult = { id: string | null; ok: boolean; detail: string };
export interface PayoutProvider {
  name: string;
  sendPix(p: SendPix): Promise<PayoutResult>;
}

const PAYOUTS: Record<string, () => PayoutProvider> = {};

export function payoutProvider(): PayoutProvider | null {
  const name = Deno.env.get("PAYOUT_PROVIDER");
  if (!name) return null;
  const make = PAYOUTS[name];
  if (!make) throw new Error(`Gateway de saque desconhecido: ${name}`);
  return make();
}
