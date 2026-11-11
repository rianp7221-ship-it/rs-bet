// sync-odds — jogos, odds, placares e resultados da API configurada (_shared/providers.ts)
// Secrets: ODDS_PROVIDER (theoddsapi | apifootball | betsapi), ODDS_API_KEY / API_FOOTBALL_KEY / BETSAPI_TOKEN, ODDS_SPORTS (opcional), CRON_SECRET (cron).
// Body: { mode: "full" } (padrão: todos os esportes), { mode: "live" } (só esportes com jogo em andamento)
// ou { mode: "basket" } / { mode: "basket_live" } (basquete pela 365Scores com odds da Bet365, ver runBasket e runBasketLive).
// No full com muitas ligas, a função chama a si mesma com { mode: "full", leagues: [...] } em grupos (limite de CPU por execução).
import { adminClient, cors, json } from "../_shared/auth.ts";
import { getProvider, type Markets } from "../_shared/providers.ts";
import { BK_EXT, bkDone, bkLeague, bkLeagueLogo, bkLines, bkList, bkScore, bkTeamLogo, bkVoid, type List365 } from "../_shared/basket.ts";
import { adjustMarkets, adjustOdds, capMarkets, capOdds, overCap, type Adjust } from "../_shared/adjust.ts";
import { coverage365, type MatchRef, stats365 } from "../_shared/stats365.ts";

type Odds = { home: number | null; draw?: number | null; away: number | null };
// margem da casa: tira a margem do mercado (probabilidade justa) e aplica a margem configurada
function applyMargin(o: Odds, marginPct: number): Odds {
  if (!(marginPct > 0)) return o;
  const prices = [o.home, o.draw, o.away].filter((x): x is number => !!x && x > 1);
  const book = prices.reduce((a, x) => a + 1 / x, 0);
  const adj = (x?: number | null) => (x && x > 1 ? Math.max(1.01, Math.floor((x * book / (1 + marginPct / 100)) * 100) / 100) : x ?? null);
  return { home: adj(o.home), draw: adj(o.draw), away: adj(o.away) };
}

// mesma margem nos mercados extras; na Chance Dupla cada resultado cobre 2 de 3, então a soma justa das probabilidades é 2
// grava escanteios, cartões e chutes finais antes de liquidar (c1x2/coNN/kNN/s1x2/sNNN/t1x2/tNNN); sem o dado as seleções são anuladas.
// A API principal não tem estatísticas de muitas ligas: aí vale o 365Scores. Devolve false se faltou algum grupo de estatística.
type FeedStats = { home: number; away: number; cards: { home: number; away: number }; shots: { home: number; away: number }; sot: { home: number; away: number } };
// deno-lint-ignore no-explicit-any
async function saveStats(sb: any, feed: { corners?: (id: string) => Promise<FeedStats | null> }, m: Started, fixture: string): Promise<boolean> {
  const c = feed.corners ? await feed.corners(fixture).catch(() => null) : null;
  if (c) {
    await sb.from("matches").update({ corners_home: c.home, corners_away: c.away, cards_home: c.cards.home, cards_away: c.cards.away,
      shots_home: c.shots.home, shots_away: c.shots.away, sot_home: c.sot.home, sot_away: c.sot.away }).eq("id", m.id);
    return true;
  }
  const r = await stats365(m).catch(() => null);
  if (!r) return false;
  const { corners, cards, shots, sot } = r.stats;
  await sb.from("matches").update({ ext365_id: r.id, corners_home: corners?.home ?? null, corners_away: corners?.away ?? null,
    cards_home: cards?.home ?? null, cards_away: cards?.away ?? null, shots_home: shots?.home ?? null, shots_away: shots?.away ?? null,
    sot_home: sot?.home ?? null, sot_away: sot?.away ?? null }).eq("id", m.id);
  return !!(corners && cards && shots && sot);
}
// mercados liquidados por escanteios, cartões ou chutes (também como perna do Criar Aposta)
const STAT_RE = /^(c1x2|co\d+|k\d+|s(\d+|1x2)|t(\d+|1x2)|(ch|ca|kh|ka|sh|sa)\d+)$/;
// sem estatística e com aposta pendente que depende dela: espera até STATS_WAIT_MS do início do jogo, tentando a cada STATS_RETRY_MS
const STATS_WAIT_MS = 4 * 3600_000, STATS_RETRY_MS = 10 * 60_000, STATS_WAIT = "Aguardando estatísticas";
// deno-lint-ignore no-explicit-any
async function waitStats(sb: any, m: Started): Promise<boolean> {
  if (Date.now() - Date.parse(m.starts_at) > STATS_WAIT_MS) return false;
  const { data } = await sb.from("bet_selections").select("market, pick").eq("match_id", m.id).eq("status", "pending");
  const need = ((data ?? []) as { market: string; pick: string }[]).some((s) =>
    s.market === "bb" ? s.pick.split("|").some((l) => STAT_RE.test(l.split(":")[0])) : STAT_RE.test(s.market));
  if (need) await sb.from("matches").update({ suspended_until: new Date(Date.now() + STATS_RETRY_MS).toISOString(), suspend_reason: STATS_WAIT }).eq("id", m.id);
  return need;
}
// jogo adiado ou cancelado na fonte: seleções viram odd 1 (devolvidas) e o resto do bilhete segue
// deno-lint-ignore no-explicit-any
async function voidMatch(sb: any, id: number): Promise<string | null> {
  const { error } = await sb.rpc("admin_void_match", { p_match: id, p_reason: "Jogo adiado ou cancelado (fonte de dados)" });
  return error?.message ?? null;
}

// liquida o jogo encerrado; false = ainda esperando as estatísticas
// deno-lint-ignore no-explicit-any
// liga só oferece escanteios/cartões/chutes se alguma fonte tem o dado dela (365Scores nos últimos jogos do campeonato,
// ou 90% dos jogos liquidados aqui nos últimos 30 dias); a trigger a0_stat_markets tira os mercados das ligas sem (tabela league_stats)
const COVER_TTL_MS = 12 * 3600_000, COVER_MAX = 8;
async function refreshCoverage(sb: Admin, cand: Map<string, MatchRef[]>): Promise<void> {
  if (!cand.size) return;
  const names = [...cand.keys()];
  const { data: known } = await sb.from("league_stats").select("league, checked_at").in("league", names);
  const fresh = new Set((known ?? []).filter((k: { checked_at: string }) => Date.now() - Date.parse(k.checked_at) < COVER_TTL_MS).map((k: { league: string }) => k.league));
  const todo = names.filter((n) => !fresh.has(n)).slice(0, COVER_MAX);
  if (!todo.length) return;
  type H = { league: string; home: string; away: string; starts_at: string; corners_home: number | null; cards_home: number | null; shots_home: number | null; sot_home: number | null };
  const { data: hist } = await sb.from("matches").select("league, home, away, starts_at, corners_home, cards_home, shots_home, sot_home")
    .eq("status", "settled").in("league", todo).gte("starts_at", new Date(Date.now() - 30 * 86400_000).toISOString()).order("starts_at");
  const at = new Date().toISOString();
  const rows = await Promise.all(todo.map(async (league) => {
    const h = ((hist ?? []) as H[]).filter((x) => x.league === league);
    // o 365Scores lista os jogos já encerrados de forma mais completa que os próximos: tenta primeiro os liquidados
    let c = null;
    for (const m of [...h.slice(-3), ...cand.get(league)!]) if ((c = await coverage365(m).catch(() => null))) break;
    const ok = (k: keyof H) => h.length >= 5 && h.filter((x) => x[k] != null).length >= 0.9 * h.length;
    return { league, corners: !!c?.corners || ok("corners_home"), cards: !!c?.cards || ok("cards_home"),
      shots: !!c?.shots || (ok("shots_home") && ok("sot_home")), checked_at: at };
  }));
  await sb.from("league_stats").upsert(rows);
}
async function settleFinished(sb: any, feed: { corners?: (id: string) => Promise<FeedStats | null> }, m: Started, fixture: string, result: string): Promise<{ error?: string; waiting?: boolean }> {
  if (m.suspend_reason === STATS_WAIT && Date.parse(m.suspended_until ?? "") > Date.now()) return { waiting: true };
  if (!(await saveStats(sb, feed, m, fixture)) && (await waitStats(sb, m))) return { waiting: true };
  const { error } = await sb.rpc("settle_match", { p_match: m.id, p_result: result });
  return { error: error?.message };
}

function marginMarkets(mk: Markets | null | undefined, marginPct: number): Markets | null {
  if (!mk) return null;
  if (!(marginPct > 0)) return mk;
  return Object.fromEntries(Object.entries(mk).map(([k, o]) => {
    const book = Object.values(o).reduce((a, x) => a + 1 / x, 0) / (k === "dc" ? 2 : 1);
    return [k, Object.fromEntries(Object.entries(o).map(([p, x]) => [p, Math.max(1.01, Math.floor((x * book / (1 + marginPct / 100)) * 100) / 100)]))];
  }));
}

// escudos: copiados da API para o Storage do site (bucket público "logos"); o site nunca carrega a imagem da API direto
const LOGO_RE = /^https:\/\/media\.api-sports\.io\/(football|basketball)\/(teams|leagues)\/(\d+)\.png$/;
const mirrored = new Set<string>();
// deno-lint-ignore no-explicit-any
async function mirrorLogo(sb: any, url?: string | null): Promise<string | null> {
  if (!url) return null;
  const m = url.match(LOGO_RE);
  if (!m) return url;
  const path = `${m[1] === "football" ? "" : m[1] + "/"}${m[2]}/${m[3]}.png`;
  const pub = sb.storage.from("logos").getPublicUrl(path).data.publicUrl as string;
  if (mirrored.has(path)) return pub;
  const head = await fetch(pub, { method: "HEAD" }).catch(() => null);
  if (head?.ok) { mirrored.add(path); return pub; }
  try {
    const img = await fetch(url);
    if (!img.ok) return url;
    const { error } = await sb.storage.from("logos").upload(path, await img.arrayBuffer(), { contentType: "image/png", upsert: true, cacheControl: "31536000" });
    if (error) return url;
    mirrored.add(path);
    return pub;
  } catch { return url; }
}

type Started = { id: number; external_id: string; home: string; away: string; score_home: number | null; score_away: number | null; suspended_until: string | null;
  odd_home: number | null; odd_draw: number | null; odd_away: number | null; home_logo?: string | null; cashout_odds?: Record<string, number> | null;
  suspend_reason?: string | null; odds_at?: string | null; odds_seen_at?: string | null; period?: string | null; starts_at: string; ext365_id?: number | null };
// odd que salta de uma leitura para a outra costuma ser lance (gol, pênalti, expulsão) antes de o placar chegar.
// Mede em pontos de probabilidade (1/odd): zebra subindo 8 → 9,5 no fim do jogo (12,5% → 10,5%) não trava; gol (2,0 → 1,4 = 50% → 71%) trava.
const JUMP_LOCK_MS = 45_000;
const oddsJump = (m: Started, o: { home?: number | null; draw?: number | null; away?: number | null }, pts: number) =>
  pts > 0 && (["home", "draw", "away"] as const).some((k) => {
    const a = Number(m[`odd_${k}`]), b = Number(o[k]);
    return a > 1 && b > 1 && Math.abs(1 / b - 1 / a) * 100 >= pts;
  });
// placar mudou desde a última leitura = gol (o evento de gol da API às vezes chega depois do placar)
const GOAL_LOCK_MS = 90_000;
// busca completa: ligas com jogo dentro deste prazo atualizam a cada rodada, as demais 1 vez por hora
const NEAR_MS = 6 * 3600_000;
// o /odds/live da API-Football às vezes vem parcial (uma leitura sem parte dos jogos, ~60 s): segura as últimas odds por até este prazo
const ODDS_GAP_MS = 120_000;
const SOURCE_LOCKS = ["Mercado suspenso nas casas", "Mercado travado na fonte", "Odds desatualizadas na fonte"];
const scoreChanged = (m: Started, home?: number | null, away?: number | null) =>
  home != null && away != null && m.score_home != null && m.score_away != null && (home !== m.score_home || away !== m.score_away);

// ao vivo tem prioridade: a busca completa para com 20% da cota e o ao vivo só para perto de zerar
const fullReserve = (limit: number) => Math.max(20, Math.floor(limit * 0.2));
const liveReserve = (limit: number) => Math.max(20, Math.floor(limit * 0.005));
// saldo lido nesta hora e no mesmo dia UTC (a cota da API reinicia à meia-noite UTC)
const freshRemaining = (at: string) => Date.now() - Date.parse(at) < 3600_000 && new Date(at).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = await adminClient(req);
  if (sb instanceof Response) return sb;
  const body: { mode?: string; leagues?: unknown[] } | null = await req.json().catch(() => ({}));
  // full do cron roda em segundo plano: a chamada do pg_net fecha na hora e não segura o ao vivo e o goal-guard (~2 min a cada 15)
  if (body?.mode === "basket") return runBasket(sb);
  if (body?.mode === "basket_live") return runBasketLive(sb);
  if (body?.mode !== "live" && !Array.isArray(body?.leagues) && req.headers.get("x-cron-secret")) {
    EdgeRuntime.waitUntil(run(req, sb, body).catch((e) => console.error("sync-odds full", e)));
    return json({ modo: "full", segundo_plano: true }, 202);
  }
  return run(req, sb, body);
});

type Admin = Exclude<Awaited<ReturnType<typeof adminClient>>, Response>;
async function run(req: Request, sb: Admin, body: { mode?: string; leagues?: unknown[] } | null): Promise<Response> {
  let feed;
  try { feed = getProvider(); } catch (e) { return json({ error: (e as Error).message }); }
  const mode = body?.mode === "live" ? "live" : "full";
  const only: string[] | null = mode === "full" && Array.isArray(body?.leagues) ? body.leagues.map(String) : null;
  // jogos de fontes antigas saem do catálogo e são liquidados pelo mesmo jogo da fonte atual
  if (feed.prefix && !only) await sb.rpc("sync_orphan_matches", { p_prefix: feed.prefix });

  // jogos já iniciados e ainda não liquidados (ao vivo)
  const { data: started } = await sb.from("matches").select("id, external_id, home, away, score_home, score_away, suspended_until, odd_home, odd_draw, odd_away, home_logo, cashout_odds, suspend_reason, odds_at, odds_seen_at, period, starts_at, ext365_id")
    .in("status", ["open", "live"]).lt("starts_at", new Date().toISOString()).not("external_id", "is", null);
  const startedBySport = new Map<string, Started[]>();
  const sportOf = (ext: string) => {
    const k = ext.split(":")[0];
    return k.startsWith(feed.prefix) ? k.slice(feed.prefix.length) : null;
  };
  for (const m of started ?? []) {
    const sport = sportOf(m.external_id);
    if (!sport) continue;
    if (!startedBySport.has(sport)) startedBySport.set(sport, []);
    startedBySport.get(sport)!.push(m);
  }
  let sports = mode === "live"
    ? [...startedBySport.keys()]
    : only ?? (Deno.env.get("ODDS_SPORTS") || feed.defaultSports).split(",").map((s) => s.trim()).filter(Boolean);
  const { data: cfg } = await sb.from("settings").select("key, value, updated_at")
    .in("key", ["odds_margin_pre", "odds_margin_live", "feed_remaining", "feed_limit", "odds_jump_pct", "odds_adjust", "live_odd_max", "odds_extra_pct", "odd_max", "feed_cache"]);
  feed.cache?.load(cfg?.find((c) => c.key === "feed_cache")?.value);
  const margin = (k: string) => Number(cfg?.find((c) => c.key === k)?.value ?? 0) || 0;
  // teto por palpite em todos os mercados (odd_max); ao vivo vale o menor entre ele e o live_odd_max
  const preCap = margin("odd_max");
  const liveCap = [preCap, margin("live_odd_max")].filter((x) => x > 1).reduce((x, y) => Math.min(x, y), Infinity);
  const adjust = cfg?.find((c) => c.key === "odds_adjust")?.value as Adjust | undefined;
  const errors: string[] = [];
  let updated = 0, settled = 0, waiting = 0;
  const saveRemaining = async () => {
    const left = feed.remaining();
    const at = new Date().toISOString();
    if (left != null) await sb.from("settings").upsert({ key: "feed_remaining", value: Number(left), label: "Consultas restantes hoje na API de odds", updated_at: at });
    const lim = feed.limit?.();
    if (lim) await sb.from("settings").upsert({ key: "feed_limit", value: lim, label: "Cota da API de odds (por dia ou por hora, conforme o plano)", updated_at: at });
  };

  const rem = cfg?.find((c) => c.key === "feed_remaining");
  const lim = Number(cfg?.find((c) => c.key === "feed_limit")?.value) || 7500;

  // ao vivo com feed próprio: 1 rodada para todos os jogos (placar, odds, suspensão e resultado)
  if (mode === "live" && feed.live) {
    const ids = [...startedBySport.values()].flat();
    if (!ids.length) return json({ modo: mode, jogos_atualizados: 0, jogos_liquidados: 0, creditos_restantes: null, errors });
    if (rem && Number(rem.value) < liveReserve(lim) && freshRemaining(rem.updated_at)) {
      return json({ modo: mode, pulado: "cota diária da API quase no fim", creditos_restantes: rem.value, errors });
    }
    const byId = new Map(ids.map((m) => [m.external_id.split(":")[1], m]));
    try {
      // jogos que ainda não começaram ou foram adiados: entram no "ao vivo" quando começam; por id só 1 vez por minuto
      const idle = new Set(ids.filter((m) => !m.period || ["NS", "TBD", "PST"].includes(m.period)).map((m) => m.external_id.split(":")[1]));
      for (const u of await feed.live([...byId.keys()], idle)) {
        const m = byId.get(u.id);
        if (!m) continue;
        const patch: Record<string, unknown> = { synced_at: new Date().toISOString() };
        if (u.home != null && u.away != null) { patch.score_home = u.home; patch.score_away = u.away; }
        if (u.ht) { patch.ht_home = u.ht.home; patch.ht_away = u.ht.away; }
        if (!u.completed && !u.cancelled) patch.status = "live";
        if (u.minute != null) patch.minute = u.minute;
        if (u.period !== undefined) patch.period = u.period;
        if (u.home_logo && !m.home_logo?.includes("/storage/v1/object/public/logos/")) { patch.home_logo = await mirrorLogo(sb, u.home_logo); patch.away_logo = await mirrorLogo(sb, u.away_logo); patch.league_logo = await mirrorLogo(sb, u.league_logo); }
        // uma suspensão nova nunca encurta a que já está valendo (ex.: 90 s do gol)
        const lockedUntil = Date.parse(m.suspended_until ?? "") || 0;
        let jumped = false;
        const seen = Date.parse(m.odds_seen_at ?? "") || 0;
        const bridged = !!u.absent && !u.suspended && !u.completed && !u.cancelled && m.odd_home != null && Date.now() - seen < ODDS_GAP_MS;
        if (bridged) { u.markets = undefined; patch.odds_at = patch.synced_at; }
        const co: Record<string, number> = { ...(m.cashout_odds ?? {}) };
        if (u.odds) {
          // ao vivo: odds da fonte sem o ajuste do Gerenciar odds (igual ao realsports.top), com teto
          const raw = applyMargin(u.odds, margin("odds_margin_live"));
          const o = capOdds(raw, liveCap);
          for (const k of Object.keys(co)) if (k.startsWith("1x2:")) delete co[k];
          Object.assign(co, overCap(raw, null, liveCap));
          // odds paradas há mais de 20 s (mercado estava fora): a diferença acumulou, não é salto
          jumped = Date.now() - seen < 20_000 && oddsJump(m, o, margin("odds_jump_pct"));
          patch.odd_home = o.home; patch.odd_draw = o.draw; patch.odd_away = o.away;
          patch.odds_at = patch.synced_at; patch.odds_seen_at = patch.synced_at;
        }
        if (u.markets !== undefined) {
          const raw = marginMarkets(u.markets, margin("odds_margin_live"));
          patch.markets = capMarkets(raw, liveCap);
          for (const k of Object.keys(co)) if (!k.startsWith("1x2:")) delete co[k];
          Object.assign(co, overCap(null, raw, liveCap));
        }
        if (u.odds || u.markets !== undefined) patch.cashout_odds = Object.keys(co).length ? co : null;
        if (scoreChanged(m, u.home, u.away) && !u.completed) {
          patch.suspended_until = new Date(Date.now() + GOAL_LOCK_MS).toISOString(); patch.suspend_reason = "Gol";
        } else if (u.cancelled || u.voided) { patch.suspended_until = new Date(Date.now() + 600_000).toISOString(); patch.suspend_reason = "Jogo adiado ou cancelado"; }
        else if (jumped && !u.completed && lockedUntil < Date.now() + JUMP_LOCK_MS) {
          patch.suspended_until = new Date(Date.now() + JUMP_LOCK_MS).toISOString(); patch.suspend_reason = "Odds em movimento brusco";
        }
        // trava que veio da fonte (mercado fora/travado): libera assim que as odds voltam
        else if (u.odds && !u.suspended && lockedUntil > Date.now() && SOURCE_LOCKS.includes(m.suspend_reason ?? "")) patch.suspended_until = new Date().toISOString();
        else if (lockedUntil > Date.now() + 30_000) { /* mantém a suspensão mais longa */ }
        else if (u.suspended) { patch.suspended_until = new Date(Date.now() + 30_000).toISOString(); patch.suspend_reason = u.suspended; }
        else if (!u.odds && !u.completed && !bridged) { patch.suspended_until = new Date(Date.now() + 30_000).toISOString(); patch.suspend_reason = "Mercado suspenso nas casas"; }
        const { error } = await sb.from("matches").update(patch).eq("id", m.id);
        if (error) { errors.push(`${m.home} x ${m.away}: ${error.message}`); continue; }
        updated++;
        if (u.voided || u.cancelled) {
          // a suspensão de 10 min acima fica só como reserva se a anulação falhar
          const e2 = await voidMatch(sb, m.id);
          if (e2) errors.push(`${m.home} x ${m.away}: ${e2}`); else settled++;
        } else if (u.completed && u.home != null && u.away != null) {
          const result = u.home > u.away ? "home" : u.home < u.away ? "away" : "draw";
          const r = await settleFinished(sb, feed, m, u.id, result);
          if (r.error) errors.push(`${m.home} x ${m.away}: ${r.error}`); else if (r.waiting) waiting++; else settled++;
        }
      }
    } catch (e) {
      errors.push(`ao vivo: ${(e as Error).message}`);
    }
    await saveRemaining();
    return json({ modo: mode, jogos_atualizados: updated, jogos_liquidados: settled, aguardando_estatisticas: waiting, creditos_restantes: feed.remaining(), errors });
  }

  if (rem && Number(rem.value) < fullReserve(lim) && freshRemaining(rem.updated_at)) {
    return json({ modo: mode, pulado: "cota diária da API reservada para o ao vivo", creditos_restantes: rem.value, errors });
  }

  // além da lista fixa, todas as ligas que têm odds na fonte
  if (mode === "full" && !only && feed.discover) {
    try { sports = [...new Set([...sports, ...(await feed.discover())])]; } catch (e) { errors.push(`ligas extras: ${(e as Error).message}`); }
  }

  // ligas sem jogo nas próximas 6 h só na rodada do começo de cada hora; as com jogo perto, em toda rodada (15 min)
  // sábado e domingo (horário de Brasília): varredura completa só nas horas pares, pra sobrar cota pro ao vivo
  const br = new Date(Date.now() - 3 * 3600_000);
  const weekendOddHour = [0, 6].includes(br.getUTCDay()) && br.getUTCHours() % 2 === 1;
  if (mode === "full" && !only && (new Date().getUTCMinutes() >= 10 || weekendOddHour)) {
    const { data: soon } = await sb.from("matches").select("external_id").eq("status", "open").not("external_id", "is", null)
      .gte("starts_at", new Date().toISOString()).lt("starts_at", new Date(Date.now() + NEAR_MS).toISOString());
    const near = new Set((soon ?? []).map((m) => sportOf(m.external_id)));
    sports = sports.filter((s) => near.has(s));
  }

  // 1) jogos e odds; com muitas ligas, cada grupo roda numa execução separada da função
  const GROUP = 8;
  const fanOut = mode === "full" && !only && sports.length > GROUP;
  if (fanOut) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-odds`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    for (const h of ["x-cron-secret", "authorization", "apikey"]) { const v = req.headers.get(h); if (v) headers[h] = v; }
    const groups = Array.from({ length: Math.ceil(sports.length / GROUP) }, (_, i) => sports.slice(i * GROUP, (i + 1) * GROUP));
    // 4 grupos por vez; o get() espera quando o limite por minuto da API está perto
    const runGroup = async (leagues: string[]) => {
      try {
        const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ mode: "full", leagues }) });
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        if (!r.ok || j.error) errors.push(`ligas ${leagues.join(",")}: ${j.error ?? j.message ?? r.status}`);
        updated += Number(j.jogos_atualizados) || 0;
        settled += Number(j.jogos_liquidados) || 0;
        errors.push(...(j.errors ?? []));
      } catch (e) {
        errors.push(`ligas ${leagues.join(",")}: ${(e as Error).message}`);
      }
    };
    for (let i = 0; i < groups.length; i += 4) await Promise.all(groups.slice(i, i + 4).map(runGroup));
  }
  const statCand = new Map<string, MatchRef[]>();
  const syncLeague = async (sport: string) => {
    try {
      const events = await feed.odds(sport);
      const ext = (id: string) => `${feed.prefix}${sport}:${id}`;
      const { data: existing } = await sb.from("matches").select("id, external_id, status")
        .in("external_id", events.map((e) => ext(e.id)));
      const byExt = new Map((existing ?? []).map((m) => [m.external_id, m]));
      const now = Date.now();
      const priced = new Set<string>();
      for (const ev of events) {
        if (!ev.odds) continue;
        if (ev.markets && Object.keys(ev.markets).some((k) => STAT_RE.test(k))) {
          const c = statCand.get(ev.league) ?? [];
          if (c.length < 3) statCand.set(ev.league, [...c, { home: ev.home, away: ev.away, starts_at: ev.commence_time }]);
        }
        const isLive = new Date(ev.commence_time).getTime() <= now;
        const odds = isLive ? capOdds(applyMargin(ev.odds, margin("odds_margin_live")), liveCap)
          : capOdds(adjustOdds(applyMargin(ev.odds, margin("odds_margin_pre")), adjust), preCap);
        const row = {
          external_id: ext(ev.id), sport: ev.sport, league: ev.league, home: ev.home, away: ev.away,
          starts_at: ev.commence_time, odd_home: odds.home, odd_draw: odds.draw, odd_away: odds.away,
          status: isLive ? "live" : "open",
          ...(ev.markets !== undefined ? { markets: isLive ? capMarkets(marginMarkets(ev.markets, margin("odds_margin_live")), liveCap)
            : capMarkets(adjustMarkets(marginMarkets(ev.markets, margin("odds_margin_pre")), adjust, margin("odds_extra_pct")), preCap) } : {}),
          ...(ev.home_logo ? { home_logo: await mirrorLogo(sb, ev.home_logo), away_logo: await mirrorLogo(sb, ev.away_logo), league_logo: await mirrorLogo(sb, ev.league_logo) } : {}),
          synced_at: new Date().toISOString(),
        };
        // feed sem ao vivo (The Odds API): o /odds já traz as odds em jogo
        if (isLive && !feed.live) {
          const co = overCap(applyMargin(ev.odds, margin("odds_margin_live")), ev.markets ? marginMarkets(ev.markets, margin("odds_margin_live")) : null, liveCap);
          Object.assign(row, { odds_at: row.synced_at, cashout_odds: Object.keys(co).length ? co : null });
        }
        priced.add(row.external_id);
        const cur = byExt.get(row.external_id);
        if (cur && !["open", "live"].includes(cur.status)) continue;
        // jogo já começou: odds só do feed ao vivo; o /odds de pré-jogo segue mandando as odds de antes do jogo
        if (cur && isLive && feed.live) continue;
        const { error } = cur
          ? await sb.from("matches").update(row).eq("id", cur.id)
          : await sb.from("matches").insert(row);
        if (error) errors.push(`${ev.home} x ${ev.away}: ${error.message}`);
        else updated++;
      }
      // jogo ao vivo sem odds nas casas = mercado suspenso lá (lance perigoso, VAR...) => suspende aqui também
      const gone = feed.live ? [] : (startedBySport.get(sport) ?? []).filter((m) => !priced.has(m.external_id)).map((m) => m.id);
      if (gone.length) {
        await sb.from("matches").update({
          suspended_until: new Date(now + 60_000).toISOString(), suspend_reason: "Mercado suspenso nas casas",
        }).in("id", gone);
      }
    } catch (e) {
      errors.push(`${sport}: ${(e as Error).message}`);
    }
  };
  if (!fanOut) for (const sport of sports) await syncLeague(sport);
  await refreshCoverage(sb, statCand).catch((e) => errors.push(`cobertura de estatísticas: ${(e as Error).message}`));

  // 2) placar e resultados
  for (const [sport, list] of startedBySport) {
    // cada grupo liquida as próprias ligas; a execução principal só as que estão fora da lista
    if (only ? !only.includes(sport) : fanOut && sports.includes(sport)) continue;
    try {
      const byExt = new Map((await feed.scores(sport, list.map((m) => m.external_id.split(":")[1]))).map((s) => [`${feed.prefix}${sport}:${s.id}`, s]));
      for (const m of list) {
        const s = byExt.get(m.external_id);
        if (!s) continue;
        if (s.voided) {
          const e2 = await voidMatch(sb, m.id);
          if (e2) errors.push(`${m.home} x ${m.away}: ${e2}`); else settled++;
          continue;
        }
        const goal = !s.completed && scoreChanged(m, s.home, s.away)
          ? { suspended_until: new Date(Date.now() + GOAL_LOCK_MS).toISOString(), suspend_reason: "Gol" } : {};
        await sb.from("matches").update({ score_home: s.home, score_away: s.away, ...(s.ht ? { ht_home: s.ht.home, ht_away: s.ht.away } : {}), ...goal, ...(s.completed ? {} : { status: "live" }) }).eq("id", m.id);
        if (!s.completed) continue;
        const result = s.home > s.away ? "home" : s.home < s.away ? "away" : "draw";
        const r = await settleFinished(sb, feed, m, s.id, result);
        if (r.error) errors.push(`${m.home} x ${m.away}: ${r.error}`); else if (r.waiting) waiting++; else settled++;
      }
    } catch (e) {
      errors.push(`resultados ${sport}: ${(e as Error).message}`);
    }
  }

  const cache = feed.cache?.dump();
  if (cache) {
    // grupos rodam em paralelo: junta com o que já está salvo
    const { data: cur } = await sb.from("settings").select("value").eq("key", "feed_cache").maybeSingle();
    const old = (cur?.value ?? {}) as Record<string, Record<string, unknown>>;
    const merged = Object.fromEntries(Object.entries(cache).map(([k, v]) => [k, { ...(old[k] ?? {}), ...(v as Record<string, unknown>) }]));
    await sb.from("settings").upsert({ key: "feed_cache", value: { ...old, ...merged }, label: "Cache interno da API de odds (temporada das ligas) — não editar", updated_at: new Date().toISOString() });
  }
  await saveRemaining();
  return json({ modo: mode, ligas: sports.length, jogos_atualizados: updated, jogos_liquidados: settled, aguardando_estatisticas: waiting, creditos_restantes: feed.remaining(), fonte: feed.info?.() ?? null, errors });
}

// ---------- basquete (cron sync-odds-basket a cada 15 min) ----------
// Basquete pela 365Scores (odds da Bet365, ver _shared/basket.ts). Pré-jogo a cada 5 min: lista dos próximos 2 dias e
// linhas de cada jogo (jogo a mais de 6 h só a cada 30 min). Ao vivo a cada 10 s: placar, quarto, odds e resultado.
const BK_AHEAD_MS = 48 * 3600_000, BK_FAR_MS = 6 * 3600_000, BK_FAR_EVERY = 30 * 60_000, BK_NEAR_EVERY = 4 * 60_000;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function bkCfg(sb: Admin) {
  const { data: cfg } = await sb.from("settings").select("key, value")
    .in("key", ["odds_margin_pre", "odds_margin_live", "odds_adjust", "odd_max", "live_odd_max", "odds_extra_pct", "odds_jump_pct"]);
  const num = (k: string) => Number(cfg?.find((c) => c.key === k)?.value ?? 0) || 0;
  const preCap = num("odd_max");
  const liveCap = [preCap, num("live_odd_max")].filter((x) => x > 1).reduce((x, y) => Math.min(x, y), Infinity);
  return { num, preCap, liveCap, adjust: cfg?.find((c) => c.key === "odds_adjust")?.value as Adjust | undefined };
}

async function runBasket(sb: Admin): Promise<Response> {
  const { num, preCap, adjust } = await bkCfg(sb);
  const errors: string[] = [];
  let updated = 0, voided = 0, calls = 0;
  const now = Date.now();
  let list: List365;
  try { list = await bkList(new Date(now - 86400_000), new Date(now + BK_AHEAD_MS)); } catch (e) { return json({ modo: "basket", errors: [(e as Error).message] }); }
  const { data: rows } = await sb.from("matches").select("id, external_id, status, odds_at").like("external_id", `${BK_EXT}%`).in("status", ["open", "live"]);
  const byExt = new Map((rows ?? []).map((m) => [m.external_id as string, m]));
  for (const g of list.games) {
    const cur = byExt.get(BK_EXT + g.id);
    if (!cur || !bkVoid(g)) continue;
    const e = await voidMatch(sb, cur.id);
    if (e) errors.push(`${g.homeCompetitor.name} x ${g.awayCompetitor.name}: ${e}`); else voided++;
  }
  const due = list.games.filter((g) => {
    const start = Date.parse(g.startTime);
    if (g.statusGroup !== 2 || g.odds?.bookmakerId == null || start <= now || start > now + BK_AHEAD_MS) return false;
    const cur = byExt.get(BK_EXT + g.id);
    if (!cur) return true;
    return cur.status === "open" && now - (Date.parse(cur.odds_at ?? "") || 0) > (start - now > BK_FAR_MS ? BK_FAR_EVERY : BK_NEAR_EVERY);
  });
  await pool(due, 6, async (g) => {
    try {
      calls++;
      const { odds, markets } = await bkLines(g.id);
      if (!odds) return;
      const o = capOdds(adjustOdds(applyMargin(odds, num("odds_margin_pre")), adjust), preCap);
      const at = new Date().toISOString(), cur = byExt.get(BK_EXT + g.id);
      const row = {
        external_id: BK_EXT + g.id, ext365_id: g.id, sport: "Basquete", league: bkLeague(g, list), home: g.homeCompetitor.name, away: g.awayCompetitor.name,
        starts_at: new Date(g.startTime).toISOString(), odd_home: o.home, odd_draw: null, odd_away: o.away, status: "open",
        markets: capMarkets(adjustMarkets(marginMarkets(markets, num("odds_margin_pre")), adjust, num("odds_extra_pct")), preCap),
        home_logo: bkTeamLogo(g.homeCompetitor), away_logo: bkTeamLogo(g.awayCompetitor), league_logo: bkLeagueLogo(g.competitionId),
        synced_at: at, odds_at: at,
      };
      const { error } = cur ? await sb.from("matches").update(row).eq("id", cur.id) : await sb.from("matches").insert(row);
      if (error) errors.push(`${row.home} x ${row.away}: ${error.message}`); else updated++;
    } catch (e) {
      errors.push(`${g.homeCompetitor.name} x ${g.awayCompetitor.name}: ${(e as Error).message}`);
    }
  });
  return json({ modo: "basket", jogos_na_lista: list.games.length, consultas_de_odds: calls, jogos_atualizados: updated, jogos_anulados: voided, errors });
}

async function runBasketLive(sb: Admin): Promise<Response> {
  const { num, liveCap } = await bkCfg(sb);
  const errors: string[] = [];
  let updated = 0, settled = 0;
  const { data: rows } = await sb.from("matches").select("id, external_id, home, away, score_home, score_away, suspended_until, suspend_reason, odd_home, odd_draw, odd_away, cashout_odds, odds_seen_at, starts_at")
    .like("external_id", `${BK_EXT}%`).in("status", ["open", "live"]).lte("starts_at", new Date().toISOString());
  await pool((rows ?? []) as Started[], 8, async (m) => {
    try {
      const { game: g, odds, markets } = await bkLines(Number(m.external_id.slice(BK_EXT.length)));
      if (!g) return; // sem atualização: _suspension trava depois de live_stale_secs
      if (bkVoid(g)) {
        const e = await voidMatch(sb, m.id);
        if (e) errors.push(`${m.home} x ${m.away}: ${e}`); else settled++;
        return;
      }
      const at = new Date().toISOString(), h = bkScore(g.homeCompetitor), a = bkScore(g.awayCompetitor);
      const patch: Record<string, unknown> = { synced_at: at };
      if (h != null && a != null && g.statusGroup !== 2) { patch.score_home = h; patch.score_away = a; }
      if (g.statusGroup === 3) { patch.status = "live"; patch.period = [g.statusText, g.gameTimeDisplay].filter(Boolean).join(" "); }
      if (bkDone(g)) {
        patch.period = g.statusText;
        await sb.from("matches").update(patch).eq("id", m.id);
        if (h == null || a == null || h === a) { errors.push(`${m.home} x ${m.away}: placar final indefinido`); return; }
        const { error } = await sb.rpc("settle_match", { p_match: m.id, p_result: h > a ? "home" : "away" });
        if (error) errors.push(`${m.home} x ${m.away}: ${error.message}`); else settled++;
        return;
      }
      const lockedUntil = Date.parse(m.suspended_until ?? "") || 0;
      if (odds) {
        const raw = applyMargin(odds, num("odds_margin_live")), rawMk = marginMarkets(markets, num("odds_margin_live"));
        const o = capOdds(raw, liveCap);
        const seen = Date.parse(m.odds_seen_at ?? "") || 0;
        const jumped = Date.now() - seen < 20_000 && oddsJump(m, o, num("odds_jump_pct"));
        const co = overCap(raw, rawMk, liveCap);
        Object.assign(patch, { odd_home: o.home, odd_draw: null, odd_away: o.away, markets: capMarkets(rawMk, liveCap), odds_at: at, odds_seen_at: at, cashout_odds: Object.keys(co).length ? co : null });
        if (jumped && lockedUntil < Date.now() + JUMP_LOCK_MS) Object.assign(patch, { suspended_until: new Date(Date.now() + JUMP_LOCK_MS).toISOString(), suspend_reason: "Odds em movimento brusco" });
        else if (lockedUntil > Date.now() && SOURCE_LOCKS.includes(m.suspend_reason ?? "")) patch.suspended_until = at;
      } else if (lockedUntil < Date.now() + 30_000) {
        Object.assign(patch, { suspended_until: new Date(Date.now() + 30_000).toISOString(), suspend_reason: "Mercado suspenso nas casas" });
      }
      const { error } = await sb.from("matches").update(patch).eq("id", m.id);
      if (error) errors.push(`${m.home} x ${m.away}: ${error.message}`); else updated++;
    } catch (e) {
      errors.push(`${m.home} x ${m.away}: ${(e as Error).message}`);
    }
  });
  return json({ modo: "basket_live", jogos_atualizados: updated, jogos_liquidados: settled, errors });
}
