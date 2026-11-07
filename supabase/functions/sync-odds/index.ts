// sync-odds — jogos, odds, placares e resultados da API configurada (_shared/providers.ts)
// Secrets: ODDS_PROVIDER (theoddsapi | apifootball | betsapi), ODDS_API_KEY / API_FOOTBALL_KEY / BETSAPI_TOKEN, ODDS_SPORTS (opcional), CRON_SECRET (cron).
// Body: { mode: "full" } (padrão: todos os esportes) ou { mode: "live" } (só esportes com jogo em andamento).
// No full com muitas ligas, a função chama a si mesma com { mode: "full", leagues: [...] } em grupos (limite de CPU por execução).
import { adminClient, cors, json } from "../_shared/auth.ts";
import { getProvider, type Markets } from "../_shared/providers.ts";
import { adjustMarkets, adjustOdds, capMarkets, capOdds, overCap, type Adjust } from "../_shared/adjust.ts";

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
// grava escanteios, cartões e chutes finais antes de liquidar (c1x2/coNN/kNN/s1x2/sNNN/t1x2/tNNN); sem o dado as seleções são anuladas
// deno-lint-ignore no-explicit-any
async function saveCorners(sb: any, feed: { corners?: (id: string) => Promise<{ home: number; away: number; cards: { home: number; away: number }; shots: { home: number; away: number }; sot: { home: number; away: number } } | null> }, matchId: number, fixture: string) {
  if (!feed.corners) return;
  const c = await feed.corners(fixture).catch(() => null);
  if (c) await sb.from("matches").update({ corners_home: c.home, corners_away: c.away, cards_home: c.cards.home, cards_away: c.cards.away,
    shots_home: c.shots.home, shots_away: c.shots.away, sot_home: c.sot.home, sot_away: c.sot.away }).eq("id", matchId);
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
const LOGO_RE = /^https:\/\/media\.api-sports\.io\/football\/(teams|leagues)\/(\d+)\.png$/;
const mirrored = new Set<string>();
// deno-lint-ignore no-explicit-any
async function mirrorLogo(sb: any, url?: string | null): Promise<string | null> {
  if (!url) return null;
  const m = url.match(LOGO_RE);
  if (!m) return url;
  const path = `${m[1]}/${m[2]}.png`;
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
  suspend_reason?: string | null; odds_at?: string | null };
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
  const { data: started } = await sb.from("matches").select("id, external_id, home, away, score_home, score_away, suspended_until, odd_home, odd_draw, odd_away, home_logo, cashout_odds, suspend_reason, odds_at")
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
  const sports = mode === "live"
    ? [...startedBySport.keys()]
    : only ?? (Deno.env.get("ODDS_SPORTS") || feed.defaultSports).split(",").map((s) => s.trim()).filter(Boolean);
  const { data: cfg } = await sb.from("settings").select("key, value, updated_at")
    .in("key", ["odds_margin_pre", "odds_margin_live", "feed_remaining", "feed_limit", "odds_jump_pct", "odds_adjust", "live_odd_max", "odds_extra_pct", "odd_max"]);
  const margin = (k: string) => Number(cfg?.find((c) => c.key === k)?.value ?? 0) || 0;
  // teto por palpite em todos os mercados (odd_max); ao vivo vale o menor entre ele e o live_odd_max
  const preCap = margin("odd_max");
  const liveCap = [preCap, margin("live_odd_max")].filter((x) => x > 1).reduce((x, y) => Math.min(x, y), Infinity);
  const adjust = cfg?.find((c) => c.key === "odds_adjust")?.value as Adjust | undefined;
  const errors: string[] = [];
  let updated = 0, settled = 0;
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
      for (const u of await feed.live([...byId.keys()])) {
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
        const co: Record<string, number> = { ...(m.cashout_odds ?? {}) };
        if (u.odds) {
          // ao vivo: odds da fonte sem o ajuste do Gerenciar odds (igual ao realsports.top), com teto
          const raw = applyMargin(u.odds, margin("odds_margin_live"));
          const o = capOdds(raw, liveCap);
          for (const k of Object.keys(co)) if (k.startsWith("1x2:")) delete co[k];
          Object.assign(co, overCap(raw, null, liveCap));
          // odds paradas há mais de 20 s (mercado estava fora): a diferença acumulou, não é salto
          jumped = Date.now() - (Date.parse(m.odds_at ?? "") || 0) < 20_000 && oddsJump(m, o, margin("odds_jump_pct"));
          patch.odd_home = o.home; patch.odd_draw = o.draw; patch.odd_away = o.away;
          patch.odds_at = patch.synced_at;
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
        } else if (u.cancelled) { patch.suspended_until = new Date(Date.now() + 600_000).toISOString(); patch.suspend_reason = "Jogo adiado ou cancelado"; }
        else if (jumped && !u.completed && lockedUntil < Date.now() + JUMP_LOCK_MS) {
          patch.suspended_until = new Date(Date.now() + JUMP_LOCK_MS).toISOString(); patch.suspend_reason = "Odds em movimento brusco";
        }
        // trava que veio da fonte (mercado fora/travado): libera assim que as odds voltam
        else if (u.odds && !u.suspended && lockedUntil > Date.now() && SOURCE_LOCKS.includes(m.suspend_reason ?? "")) patch.suspended_until = new Date().toISOString();
        else if (lockedUntil > Date.now() + 30_000) { /* mantém a suspensão mais longa */ }
        else if (u.suspended) { patch.suspended_until = new Date(Date.now() + 30_000).toISOString(); patch.suspend_reason = u.suspended; }
        else if (!u.odds && !u.completed) { patch.suspended_until = new Date(Date.now() + 30_000).toISOString(); patch.suspend_reason = "Mercado suspenso nas casas"; }
        const { error } = await sb.from("matches").update(patch).eq("id", m.id);
        if (error) { errors.push(`${m.home} x ${m.away}: ${error.message}`); continue; }
        updated++;
        if (u.voided) {
          const { error: e2 } = await sb.rpc("admin_void_match", { p_match: m.id, p_reason: "Jogo cancelado ou abandonado (fonte de dados)" });
          if (e2) errors.push(`${m.home} x ${m.away}: ${e2.message}`); else settled++;
        } else if (u.completed && u.home != null && u.away != null) {
          const result = u.home > u.away ? "home" : u.home < u.away ? "away" : "draw";
          await saveCorners(sb, feed, m.id, u.id);
          const { error: e2 } = await sb.rpc("settle_match", { p_match: m.id, p_result: result });
          if (e2) errors.push(`${m.home} x ${m.away}: ${e2.message}`); else settled++;
        }
      }
    } catch (e) {
      errors.push(`ao vivo: ${(e as Error).message}`);
    }
    await saveRemaining();
    return json({ modo: mode, jogos_atualizados: updated, jogos_liquidados: settled, creditos_restantes: feed.remaining(), errors });
  }

  if (rem && Number(rem.value) < fullReserve(lim) && freshRemaining(rem.updated_at)) {
    return json({ modo: mode, pulado: "cota diária da API reservada para o ao vivo", creditos_restantes: rem.value, errors });
  }

  // 1) jogos e odds; com muitas ligas, cada grupo roda numa execução separada da função
  const GROUP = 6;
  const fanOut = mode === "full" && !only && sports.length > GROUP;
  if (fanOut) {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-odds`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    for (const h of ["x-cron-secret", "authorization", "apikey"]) { const v = req.headers.get(h); if (v) headers[h] = v; }
    const groups = Array.from({ length: Math.ceil(sports.length / GROUP) }, (_, i) => sports.slice(i * GROUP, (i + 1) * GROUP));
    // 2 grupos por vez para não estourar o limite por minuto da API
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
    for (let i = 0; i < groups.length; i += 2) await Promise.all(groups.slice(i, i + 2).map(runGroup));
  }
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

  // 2) placar e resultados
  for (const [sport, list] of startedBySport) {
    // cada grupo liquida as próprias ligas; a execução principal só as que estão fora da lista
    if (only ? !only.includes(sport) : fanOut && sports.includes(sport)) continue;
    try {
      const byExt = new Map((await feed.scores(sport, list.map((m) => m.external_id.split(":")[1]))).map((s) => [`${feed.prefix}${sport}:${s.id}`, s]));
      for (const m of list) {
        const s = byExt.get(m.external_id);
        if (!s) continue;
        const goal = !s.completed && scoreChanged(m, s.home, s.away)
          ? { suspended_until: new Date(Date.now() + GOAL_LOCK_MS).toISOString(), suspend_reason: "Gol" } : {};
        await sb.from("matches").update({ score_home: s.home, score_away: s.away, ...(s.ht ? { ht_home: s.ht.home, ht_away: s.ht.away } : {}), ...goal, ...(s.completed ? {} : { status: "live" }) }).eq("id", m.id);
        if (!s.completed) continue;
        const result = s.home > s.away ? "home" : s.home < s.away ? "away" : "draw";
        await saveCorners(sb, feed, m.id, s.id);
        const { error } = await sb.rpc("settle_match", { p_match: m.id, p_result: result });
        if (error) errors.push(`${m.home} x ${m.away}: ${error.message}`);
        else settled++;
      }
    } catch (e) {
      errors.push(`resultados ${sport}: ${(e as Error).message}`);
    }
  }

  await saveRemaining();
  return json({ modo: mode, jogos_atualizados: updated, jogos_liquidados: settled, creditos_restantes: feed.remaining(), fonte: feed.info?.() ?? null, errors });
}
