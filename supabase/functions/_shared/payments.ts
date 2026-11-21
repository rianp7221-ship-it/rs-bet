// Adaptadores de gateway PIX. Para trocar de gateway: implemente PaymentProvider, registre em PROVIDERS
// e defina o secret PAYMENT_PROVIDER com o nome do adaptador (padrão: mercadopago).

export type Charge = {
  id: string; qr_code: string; qr_base64: string | null; ticket_url: string | null; expires_at: string; customer_id?: string;
};
export type PaymentInfo = {
  id: string; status: "approved" | "pending" | "failed" | "refunded"; amount: number; reference: string | null;
  detail: string; charge: Omit<Charge, "id" | "expires_at"> | null;
};
export type CreatePix = {
  reference: string; amount: number; description: string; email: string; expiresAt: Date; notifyUrl: string;
  userId: string; cpf: string | null; name: string | null; customerId: string | null;
};

export interface PaymentProvider {
  name: string;
  requiresCpf?: boolean;
  createPix(p: CreatePix): Promise<Charge>;
  getPayment(id: string, withCharge?: boolean): Promise<PaymentInfo>;
  // Invalida um PIX vencido para que não possa mais ser pago (quando o gateway não expira sozinho).
  cancel?(id: string): Promise<void>;
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


// ---------- Asaas (API v3) ----------
const ASAAS_UA = "RealSports/1.0";
type AsaasPayment = {
  id: string; status: string; value: number; externalReference?: string | null; deleted?: boolean; invoiceUrl?: string | null;
};
type AsaasTransfer = {
  id: string; status: string; value: number; failReason?: string | null; authorized?: boolean; externalReference?: string | null;
  bankAccount?: { pixAddressKey?: string | null } | null;
};

function asaasClient(apiKey: string) {
  const base = (Deno.env.get("ASAAS_BASE_URL") ?? "https://api.asaas.com/v3").replace(/\/$/, "");
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const r = await fetch(base + path, {
      ...init, headers: { access_token: apiKey, "Content-Type": "application/json", "User-Agent": ASAAS_UA, ...init.headers },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (body?.errors as { description?: string }[] | undefined)?.map((e) => e.description).join("; ");
      throw new Error(`Asaas ${r.status}: ${msg || "erro"}`);
    }
    return body as T;
  };
}

const safeEq = (a: string | null, b: string | undefined) => !!a && !!b && a.length === b.length &&
  [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

function asaasToken(req: Request, token?: string) {
  if (!token) throw new Error("Webhook do Asaas sem token configurado (ASAAS_WEBHOOK_TOKEN)");
  if (!safeEq(req.headers.get("asaas-access-token"), token)) throw new Error("token inválido");
}

const brDate = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

function asaas(apiKey: string, webhookToken?: string): PaymentProvider {
  const call = asaasClient(apiKey);
  const customer = async (c: CreatePix) => {
    if (c.customerId) return c.customerId;
    const cpf = (c.cpf ?? "").replace(/\D/g, "");
    if (cpf.length !== 11 && cpf.length !== 14) throw new Error("CPF obrigatório para gerar o PIX");
    const found = await call<{ data: { id: string; deleted?: boolean }[] }>(`/customers?cpfCnpj=${cpf}&limit=1`);
    const hit = found.data?.find((x) => !x.deleted);
    if (hit) return hit.id;
    const made = await call<{ id: string }>("/customers", {
      method: "POST",
      body: JSON.stringify({ name: (c.name || c.email).slice(0, 100), cpfCnpj: cpf, email: c.email, externalReference: c.userId, notificationDisabled: true }),
    });
    return made.id;
  };
  const qr = async (id: string) => {
    const q = await call<{ payload: string; encodedImage?: string }>(`/payments/${encodeURIComponent(id)}/pixQrCode`);
    return q.payload ? { qr_code: q.payload, qr_base64: q.encodedImage ?? null } : null;
  };
  return {
    name: "asaas",
    requiresCpf: true,
    async createPix(c) {
      const cust = await customer(c);
      const p = await call<AsaasPayment>("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: cust, billingType: "PIX", value: c.amount, dueDate: brDate(c.expiresAt),
          description: c.description, externalReference: c.reference,
        }),
      });
      const q = await qr(p.id);
      if (!q) throw new Error("Asaas não devolveu o código PIX");
      return { id: p.id, ...q, ticket_url: p.invoiceUrl ?? null, expires_at: c.expiresAt.toISOString(), customer_id: cust };
    },
    async getPayment(id, withCharge = false) {
      const p = await call<AsaasPayment>(`/payments/${encodeURIComponent(id)}`);
      const s = p.status;
      const status: PaymentInfo["status"] = p.deleted ? "failed"
        : s === "RECEIVED" ? "approved"
        : s.startsWith("REFUND") || s.startsWith("CHARGEBACK") || s === "AWAITING_CHARGEBACK_REVERSAL" ? "refunded"
        : "pending";
      const q = withCharge && status === "pending" ? await qr(id) : null;
      return {
        id: p.id, amount: Number(p.value), reference: p.externalReference ?? null, status,
        detail: p.deleted ? `${s}/deleted` : s, charge: q ? { ...q, ticket_url: p.invoiceUrl ?? null } : null,
      };
    },
    async cancel(id) {
      await call(`/payments/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    webhookPaymentId(req, _url, body) {
      asaasToken(req, webhookToken);
      const id = (body?.payment as { id?: string } | undefined)?.id;
      return Promise.resolve(typeof id === "string" && /^pay_\w+$/.test(id) ? id : null);
    },
  };
}

const PROVIDERS: Record<string, () => PaymentProvider> = {
  mercadopago: () => {
    const t = Deno.env.get("MP_ACCESS_TOKEN");
    if (!t) throw new Error("Gateway PIX não configurado (secret MP_ACCESS_TOKEN)");
    return mercadoPago(t, Deno.env.get("MP_WEBHOOK_SECRET") ?? undefined);
  },
  asaas: () => {
    const k = Deno.env.get("ASAAS_API_KEY");
    if (!k) throw new Error("Gateway PIX não configurado (secret ASAAS_API_KEY)");
    return asaas(k, Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? undefined);
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
export type PayoutInfo = { id: string; status: "done" | "pending" | "failed"; amount: number; key: string | null; detail: string };
export interface PayoutProvider {
  name: string;
  sendPix(p: SendPix): Promise<PayoutResult>;
  getTransfer?(id: string): Promise<PayoutInfo>;
  // Notificação de status de um envio: valida e devolve o id (ou null se não for de envio).
  webhookTransferId?(req: Request, body: Record<string, unknown> | null): string | null;
  // Pedido de autorização do gateway antes de executar o envio (mecanismo de segurança de saque).
  authRequest?(req: Request, body: Record<string, unknown> | null): { id: string; amount: number; key: string | null } | null;
  authResponse?(ok: boolean, reason?: string): Record<string, unknown>;
}

export const pixKeyDigits = (key: string, type: string) => {
  if (!["cpf", "cnpj", "telefone"].includes(type)) return key.trim().toLowerCase();
  const d = key.replace(/\D/g, "");
  return type === "telefone" && d.length === 13 && d.startsWith("55") ? d.slice(2) : d;
};

const ASAAS_KEY_TYPES: Record<string, string> = { cpf: "CPF", cnpj: "CNPJ", email: "EMAIL", telefone: "PHONE", aleatoria: "EVP" };

function asaasPayout(apiKey: string, webhookToken?: string): PayoutProvider {
  const call = asaasClient(apiKey);
  const info = (t: AsaasTransfer): PayoutInfo => ({
    id: t.id, amount: Number(t.value), key: t.bankAccount?.pixAddressKey ?? null,
    status: t.status === "DONE" ? "done" : ["FAILED", "CANCELLED"].includes(t.status) ? "failed" : "pending",
    detail: `${t.status}${t.failReason ? ": " + t.failReason : ""}`,
  });
  return {
    name: "asaas",
    async sendPix(p) {
      const type = ASAAS_KEY_TYPES[p.keyType];
      if (!type) return { id: null, ok: false, detail: `Tipo de chave não suportado: ${p.keyType}` };
      const t = await call<AsaasTransfer>("/transfers", {
        method: "POST",
        body: JSON.stringify({
          value: p.amount, operationType: "PIX", pixAddressKey: pixKeyDigits(p.key, p.keyType), pixAddressKeyType: type,
          description: p.description, externalReference: p.reference,
        }),
      });
      const i = info(t);
      if (i.status === "failed") return { id: t.id, ok: false, detail: `Asaas: ${i.detail}` };
      if (t.authorized === false) return { id: t.id, ok: false, detail: "Asaas: aguardando autorização (token SMS) no painel do Asaas" };
      return { id: t.id, ok: true, detail: i.detail };
    },
    async getTransfer(id) {
      return info(await call<AsaasTransfer>(`/transfers/${encodeURIComponent(id)}`));
    },
    webhookTransferId(req, body) {
      const id = (body?.transfer as { id?: string } | undefined)?.id;
      if (typeof id !== "string" || !String(body?.event ?? "").startsWith("TRANSFER_")) return null;
      asaasToken(req, webhookToken);
      return id;
    },
    authRequest(req, body) {
      if (body?.type !== "TRANSFER") return null;
      asaasToken(req, webhookToken);
      const t = body.transfer as AsaasTransfer | undefined;
      return t?.id ? { id: t.id, amount: Number(t.value), key: t.bankAccount?.pixAddressKey ?? null } : null;
    },
    authResponse: (ok, reason) => (ok ? { status: "APPROVED" } : { status: "REFUSED", refuseReason: reason ?? "Operação não reconhecida" }),
  };
}

const PAYOUTS: Record<string, () => PayoutProvider> = {
  asaas: () => {
    const k = Deno.env.get("ASAAS_API_KEY");
    if (!k) throw new Error("Gateway de saque não configurado (secret ASAAS_API_KEY)");
    return asaasPayout(k, Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? undefined);
  },
};

export function payoutProvider(): PayoutProvider | null {
  const name = Deno.env.get("PAYOUT_PROVIDER");
  if (!name) return null;
  const make = PAYOUTS[name];
  if (!make) throw new Error(`Gateway de saque desconhecido: ${name}`);
  return make();
}
