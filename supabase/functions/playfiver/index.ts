// playfiver — cassino PlayFiver em carteira única (os jogos usam o saldo do site).
// Jogador logado: { action: "launch", game: "<casino_catalog.id>" } → { url }.
// Cron (x-cron-secret): { action: "inspect" } lista os jogos com rodadas grátis nativas (rounds_free).
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
      id: `pf-${p.id}`, name: p.name, kind: "agregador", image: p.image_url, active: p.status === 1 && cat(p.name) !== "ao_vivo" })));
    if (error) return json({ error: error.message }, 500);
  }
  const rows = games.filter((g) => pid.has(g.provider?.name) && g.game_code).map((g, i) => ({
    id: `pf:${pid.get(g.provider.name)}:${g.game_code}`.slice(0, 200), provider: pid.get(g.provider.name), name: g.name,
    category: cat(g.provider.name), pf_provider: g.provider.name, pf_code: String(g.game_code), pf_original: !!g.original,
    image: g.image_url, sort: 1000 + i, max_stake: 100000, active: g.status !== false, pf_free: g.rounds_free === true,
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

// rodadas grátis da roleta: libera o pacote no próprio jogo (aposta travada pelo jogo); depois que acaba o jogo volta pro saldo
async function grantFree(uid: string, g: any) {
  const { data: rw } = await sb.from("user_rewards").select("id,spins_left,pf_granted_at")
    .eq("user_id", uid).eq("kind", "freespins").eq("status", "em_uso").eq("game_id", g.id)
    .gt("spins_left", 0).gt("expires_at", new Date().toISOString()).order("id").limit(1).maybeSingle();
  if (!rw) return { free: 0, granted: false };
  if (rw.pf_granted_at) return { free: rw.spins_left, granted: false };
  // a PlayFiver não deixa escolher o valor da rodada (o jogo define); settings.freespin_native = false pausa a liberação nativa
  const { data: nat } = await sb.from("settings").select("value").eq("key", "freespin_native").maybeSingle();
  if (nat && [false, "false", '"false"'].includes(nat.value)) return { free: 0, granted: false, fallback: rw.spins_left };
  const r = await pf("/free_bonus", { agent_token: TOKEN, secret_key: SECRET, user_code: uid, game_code: g.pf_code, rounds: rw.spins_left });
  const ok = r.status < 300 && r.data?.status === true;
  const msg = (typeof r.data?.msg === "string" ? r.data.msg : "") || String(r.status);
  await sb.from("user_rewards").update(ok ? { pf_granted_at: new Date().toISOString(), pf_grant_msg: msg } : { pf_grant_msg: msg }).eq("id", rw.id).is("pf_granted_at", null);
  if (!ok) console.error("free_bonus", r.status, JSON.stringify(r.data).slice(0, 300));
  return ok ? { free: rw.spins_left, granted: true } : { free: 0, granted: false, fallback: rw.spins_left };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const body = await req.json().catch(() => ({}));
  if (!body?.action) return await webhook(body);
  if (body.action === "inspect") {
    const secret = Deno.env.get("CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Sem permissão" }, 401);
    const gm = await pf("/games");
    const games: any[] = gm.data?.data ?? [];
    const free = games.filter((g) => g.rounds_free === true && g.game_code).map((g) => [g.provider?.name, String(g.game_code)]);
    return json({ total: games.length, free });
  }

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

  const launch = () => pf("/game_launch", {
    agentToken: TOKEN, secretKey: SECRET, user_code: user.id, game_code: g.pf_code, provider: g.pf_provider,
    game_original: !!g.pf_original, user_balance: Number(prof?.balance ?? 0), lang: "pt",
  });
  let r = await launch();
  const fr = r.data?.launch_url ? await grantFree(user.id, g) : { free: 0, granted: false };
  if (fr.granted) r = await launch();
  if (!r.data?.launch_url) {
    console.error("game_launch", r.status, JSON.stringify(r.data).slice(0, 300));
    return json({ error: "Não foi possível abrir o jogo agora. Tente novamente.", detail: typeof r.data?.msg === "string" ? r.data.msg : r.status }, 502);
  }
  return json({ url: r.data.launch_url, name: g.name, free: fr.free, free_fallback: (fr as any).fallback ?? 0 });
});
