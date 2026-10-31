// sync-odds — jogos, odds, placares e resultados da API configurada (_shared/providers.ts)
// Secrets: ODDS_PROVIDER (theoddsapi | apifootball | betsapi), ODDS_API_KEY / API_FOOTBALL_KEY / BETSAPI_TOKEN, ODDS_SPORTS (opcional), CRON_SECRET (cron).
// Body: { mode: "full" } (padrão: todos os esportes) ou { mode: "live" } (só esportes com jogo em andamento).
import { adminClient, cors, json } from "../_shared/auth.ts";
import { getProvider, type Markets } from "../_shared/providers.ts";

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
function marginMarkets(mk: Markets | null | undefined, marginPct: number): Markets | null {
  if (!mk) return null;
  if (!(marginPct > 0)) return mk;
  return Object.fromEntries(Object.entries(mk).map(([k, o]) => {
    const book = Object.values(o).reduce((a, x) => a + 1 / x, 0) / (k === "dc" ? 2 : 1);
    return [k, Object.fromEntries(Object.entries(o).map(([p, x]) => [p, Math.max(1.01, Math.floor((x * book / (1 + marginPct / 100)) * 100) / 100)]))];
  }));
}

// para de consultar ao vivo quando a cota está acabando (reserva 20% para a busca completa)
const liveReserve = (limit: number) => Math.max(20, Math.floor(limit * 0.2));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = await adminClient(req);
  if (sb instanceof Response) return sb;
  let feed;
  try { feed = getProvider(); } catch (e) { return json({ error: (e as Error).message }); }
  const mode = (await req.json().catch(() => ({})))?.mode === "live" ? "live" : "full";

  // jogos já iniciados e ainda não liquidados (ao vivo)
  const { data: started } = await sb.from("matches").select("id, external_id, home, away")
    .in("status", ["open", "live"]).lt("starts_at", new Date().toISOString()).not("external_id", "is", null);
  const startedBySport = new Map<string, { id: number; external_id: string; home: string; away: string }[]>();
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
    : (Deno.env.get("ODDS_SPORTS") || feed.defaultSports).split(",").map((s) => s.trim()).filter(Boolean);
  const { data: cfg } = await sb.from("settings").select("key, value, updated_at")
    .in("key", ["odds_margin_pre", "odds_margin_live", "feed_remaining", "feed_limit"]);
  const margin = (k: string) => Number(cfg?.find((c) => c.key === k)?.value ?? 0) || 0;
  const errors: string[] = [];
  let updated = 0, settled = 0;
  const saveRemaining = async () => {
    const left = feed.remaining();
    const at = new Date().toISOString();
    if (left != null) await sb.from("settings").upsert({ key: "feed_remaining", value: Number(left), label: "Consultas restantes hoje na API de odds", updated_at: at });
    const lim = feed.limit?.();
    if (lim) await sb.from("settings").upsert({ key: "feed_limit", value: lim, label: "Cota da API de odds (por dia ou por hora, conforme o plano)", updated_at: at });
  };

  // ao vivo com feed próprio: 1 rodada para todos os jogos (placar, odds, suspensão e resultado)
  if (mode === "live" && feed.live) {
    const ids = [...startedBySport.values()].flat();
    if (!ids.length) return json({ modo: mode, jogos_atualizados: 0, jogos_liquidados: 0, creditos_restantes: null, errors });
    const rem = cfg?.find((c) => c.key === "feed_remaining");
    const lim = Number(cfg?.find((c) => c.key === "feed_limit")?.value) || 7500;
    if (rem && Number(rem.value) < liveReserve(lim) && Date.now() - Date.parse(rem.updated_at) < 3600_000) {
      return json({ modo: mode, pulado: "cota diária da API quase no fim", creditos_restantes: rem.value, errors });
    }
    const byId = new Map(ids.map((m) => [m.external_id.split(":")[1], m]));
    try {
      for (const u of await feed.live([...byId.keys()])) {
        const m = byId.get(u.id);
        if (!m) continue;
        const patch: Record<string, unknown> = { synced_at: new Date().toISOString() };
        if (u.home != null && u.away != null) { patch.score_home = u.home; patch.score_away = u.away; }
        if (!u.completed && !u.cancelled) patch.status = "live";
        if (u.odds) {
          const o = applyMargin(u.odds, margin("odds_margin_live"));
          patch.odd_home = o.home; patch.odd_draw = o.draw; patch.odd_away = o.away;
        }
        if (u.markets !== undefined) patch.markets = marginMarkets(u.markets, margin("odds_margin_live"));
        if (u.cancelled) { patch.suspended_until = new Date(Date.now() + 600_000).toISOString(); patch.suspend_reason = "Jogo adiado ou cancelado"; }
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

  // 1) jogos e odds
  for (const sport of sports) {
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
        const odds = applyMargin(ev.odds, margin(isLive ? "odds_margin_live" : "odds_margin_pre"));
        const row = {
          external_id: ext(ev.id), sport: ev.sport, league: ev.league, home: ev.home, away: ev.away,
          starts_at: ev.commence_time, odd_home: odds.home, odd_draw: odds.draw, odd_away: odds.away,
          status: isLive ? "live" : "open",
          ...(ev.markets !== undefined ? { markets: marginMarkets(ev.markets, margin(isLive ? "odds_margin_live" : "odds_margin_pre")) } : {}),
          synced_at: new Date().toISOString(),
        };
        priced.add(row.external_id);
        const cur = byExt.get(row.external_id);
        if (cur && !["open", "live"].includes(cur.status)) continue;
        const { error } = cur
          ? await sb.from("matches").update(row).eq("id", cur.id)
          : await sb.from("matches").insert(row);
        if (error) errors.push(`${ev.home} x ${ev.away}: ${error.message}`);
        else updated++;
      }
      // jogo ao vivo sem odds nas casas = mercado suspenso lá (lance perigoso, VAR...) => suspende aqui também
      const gone = (startedBySport.get(sport) ?? []).filter((m) => !priced.has(m.external_id)).map((m) => m.id);
      if (gone.length) {
        await sb.from("matches").update({
          suspended_until: new Date(now + 60_000).toISOString(), suspend_reason: "Mercado suspenso nas casas",
        }).in("id", gone);
      }
    } catch (e) {
      errors.push(`${sport}: ${(e as Error).message}`);
    }
  }

  // 2) placar e resultados
  for (const [sport, list] of startedBySport) {
    try {
      const byExt = new Map((await feed.scores(sport, list.map((m) => m.external_id.split(":")[1]))).map((s) => [`${feed.prefix}${sport}:${s.id}`, s]));
      for (const m of list) {
        const s = byExt.get(m.external_id);
        if (!s) continue;
        await sb.from("matches").update({ score_home: s.home, score_away: s.away, ...(s.completed ? {} : { status: "live" }) }).eq("id", m.id);
        if (!s.completed) continue;
        const result = s.home > s.away ? "home" : s.home < s.away ? "away" : "draw";
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
});
