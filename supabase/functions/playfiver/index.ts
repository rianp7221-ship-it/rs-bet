// playfiver — cassino PlayFiver em carteira única (os jogos usam o saldo do site).
// Jogador logado: { action: "launch", game: "<casino_catalog.id>" } → { url }.
// Admin (casino.manage): { action: "sync" } importa provedores e jogos; { action: "status" } mostra agente e saldos.
// Sem Authorization: webhooks da PlayFiver (saldo e WinBet/Refund), cadastrados como
// https://<ref>.supabase.co/functions/v1/playfiver (aceita também /webhook e /api/webhook).
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/auth.ts";

const API = "https://api.playfivers.com/api/v2";
// a PlayFiver só aceita IP cadastrado; as chamadas passam pelo proxy de IP fixo (VPS)
const PROXY = (Deno.env.get("PLAYFIVER_PROXY_URL") ?? "").replace(/\/$/, "");
const PROXY_KEY = Deno.env.get("PLAYFIVER_PROXY_KEY") ?? "";
const TOKEN = Deno.env.get("PLAYFIVER_AGENT_TOKEN") ?? "";
const SECRET = Deno.env.get("PLAYFIVER_SECRET_KEY") ?? "";
const url = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const pf = async (path: string, body?: unknown) => {
  const base = PROXY ? PROXY + "/api/v2" : API;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (PROXY) headers["X-Proxy-Key"] = PROXY_KEY;
  const r = await fetch(base + path, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const cat = (p: string) => /LIVE|EVOLUTION|EZUGI|DREAMGAMING|QUEENMAKER|PP_LIVE/i.test(p) ? "ao_vivo" : /CRASH|SPRIBE|AVIATRIX|TURBO|JETX/i.test(p) ? "crash" : "slots";

async function webhook(b: any) {
  if (b?.type === "WinBet" || b?.type === "Refund") {
    if (!SECRET || b.agent_secret !== SECRET) return json({ msg: "INVALID_AGENT" }, 401);
    const { data, error } = await sb.rpc("pf_tx", { p: b });
    if (error) {
      const m = error.message;
      return json({ msg: m }, /Saldo insuficiente|limite|Limite|pausa|autoexclus/i.test(m) ? 400 : /não encontrado/.test(m) ? 404 : 500);
    }
    return json({ msg: "SUCCESS", balance: Number(data) });
  }
  const { data } = await sb.rpc("pf_balance", { p_user: String(b?.user_code ?? "") });
  if (data === null || data === undefined) return json({ msg: "INVALID_USER" }, 404);
  return json({ msg: "SUCCESS", balance: Number(data) });
}

async function sync() {
  const [pv, gm] = await Promise.all([pf("/providers"), pf("/games")]);
  const provs: any[] = pv.data?.data ?? [], games: any[] = gm.data?.data ?? [];
  if (!games.length) return json({ error: "A PlayFiver não devolveu jogos" }, 502);
  const pid = new Map(provs.map((p) => [p.name, `pf-${p.id}`]));
  const { data: old } = await sb.from("casino_providers").select("id").like("id", "pf-%");
  const known = new Set((old ?? []).map((x) => x.id));
  const newProvs = provs.filter((p) => !known.has(`pf-${p.id}`));
  if (newProvs.length) {
    const { error } = await sb.from("casino_providers").insert(newProvs.map((p) => ({
      id: `pf-${p.id}`, name: p.name, kind: "agregador", image: p.image_url, active: p.status === 1 })));
    if (error) return json({ error: error.message }, 500);
  }
  const rows = games.filter((g) => pid.has(g.provider?.name) && g.game_code).map((g, i) => ({
    id: `pf:${pid.get(g.provider.name)}:${g.game_code}`.slice(0, 200), provider: pid.get(g.provider.name), name: g.name,
    category: cat(g.provider.name), pf_provider: g.provider.name, pf_code: String(g.game_code), pf_original: !!g.original,
    image: g.image_url, sort: 1000 + i, max_stake: 100000, active: g.status !== false,
  }));
  const uniq = [...new Map(rows.map((r) => [r.id, r])).values()];
  const { data: ex } = await sb.from("casino_catalog").select("id").like("id", "pf:%").range(0, 49999);
  const have = new Set((ex ?? []).map((x) => x.id));
  for (let i = 0; i < uniq.length; i += 1000) {
    // jogo já importado mantém o liga/desliga do admin
    const part = uniq.slice(i, i + 1000).map((r) => have.has(r.id) ? (({ active: _a, ...x }) => x)(r) : r);
    const { error } = await sb.from("casino_catalog").upsert(part, { onConflict: "id" });
    if (error) return json({ error: error.message }, 500);
  }
  return json({ providers: provs.length, games: uniq.length, new: uniq.filter((r) => !have.has(r.id)).length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const body = await req.json().catch(() => ({}));
  if (!body?.action) return await webhook(body);

  const userSb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userSb.auth.getUser();
  if (!user) return json({ error: "Faça login para jogar" }, 401);
  if (!TOKEN || !SECRET) return json({ error: "Cassino em configuração" }, 503);

  if (body.action === "sync") {
    const { data: ok } = await userSb.rpc("has_perm", { p_perm: "casino.manage" });
    return ok ? await sync() : json({ error: "Sem permissão" }, 403);
  }
  if (body.action === "status") {
    const { data: ok } = await userSb.rpc("has_perm", { p_perm: "casino.manage" });
    if (!ok) return json({ error: "Sem permissão" }, 403);
    const q = `?agentToken=${encodeURIComponent(TOKEN)}&secretKey=${encodeURIComponent(SECRET)}`;
    const [a, b] = await Promise.all([pf("/agent" + q), pf("/balances" + q)]);
    return json({ agent: a.data, balances: b.data });
  }
  if (body.action !== "launch") return json({ error: "Ação inválida" }, 400);

  const { data: g } = await sb.from("casino_catalog").select("id,name,active,pf_code,pf_provider,pf_original,provider").eq("id", String(body.game ?? "")).maybeSingle();
  const [{ data: p }, { data: s }, { data: prof }] = await Promise.all([
    sb.from("casino_providers").select("active").eq("id", g?.provider ?? "").maybeSingle(),
    sb.from("settings").select("value").eq("key", "casino_enabled").maybeSingle(),
    sb.from("profiles").select("balance").eq("id", user.id).maybeSingle(),
  ]);
  if (!g?.pf_code || !g.active || !p?.active || !["true", '"true"', true].includes(s?.value ?? "true"))
    return json({ error: "Este jogo está temporariamente indisponível" }, 409);

  const r = await pf("/game_launch", {
    agentToken: TOKEN, secretKey: SECRET, user_code: user.id, game_code: g.pf_code, provider: g.pf_provider,
    game_original: !!g.pf_original, user_balance: Number(prof?.balance ?? 0), lang: "pt",
  });
  if (!r.data?.launch_url) {
    console.error("game_launch", r.status, JSON.stringify(r.data).slice(0, 300));
    return json({ error: "Não foi possível abrir o jogo agora. Tente novamente.", detail: typeof r.data?.msg === "string" ? r.data.msg : r.status }, 502);
  }
  return json({ url: r.data.launch_url, name: g.name });
});
