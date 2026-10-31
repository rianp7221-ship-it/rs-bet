// sync-odds — jogos, odds, placares e resultados da API configurada (_shared/providers.ts)
// Secrets: ODDS_API_KEY, ODDS_PROVIDER (padrão theoddsapi), ODDS_SPORTS (opcional), CRON_SECRET (cron).
// Body: { mode: "full" } (padrão: todos os esportes) ou { mode: "live" } (só esportes com jogo em andamento).
import { adminClient, cors, json } from "../_shared/auth.ts";
import { getProvider } from "../_shared/providers.ts";

type Odds = { home: number | null; draw?: number | null; away: number | null };
// margem da casa: tira a margem do mercado (probabilidade justa) e aplica a margem configurada
function applyMargin(o: Odds, marginPct: number): Odds {
  if (!(marginPct > 0)) return o;
  const prices = [o.home, o.draw, o.away].filter((x): x is number => !!x && x > 1);
  const book = prices.reduce((a, x) => a + 1 / x, 0);
  const adj = (x?: number | null) => (x && x > 1 ? Math.max(1.01, Math.floor((x * book / (1 + marginPct / 100)) * 100) / 100) : x ?? null);
  return { home: adj(o.home), draw: adj(o.draw), away: adj(o.away) };
}

const DEFAULT_SPORTS = "soccer_brazil_campeonato,soccer_epl,soccer_uefa_champs_league,soccer_spain_la_liga,basketball_nba";

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
  for (const m of started ?? []) {
    const sport = m.external_id.split(":")[0];
    if (!startedBySport.has(sport)) startedBySport.set(sport, []);
    startedBySport.get(sport)!.push(m);
  }
  const sports = mode === "live"
    ? [...startedBySport.keys()]
    : (Deno.env.get("ODDS_SPORTS") || DEFAULT_SPORTS).split(",").map((s) => s.trim()).filter(Boolean);
  const { data: cfg } = await sb.from("settings").select("key, value").in("key", ["odds_margin_pre", "odds_margin_live"]);
  const margin = (k: string) => Number(cfg?.find((c) => c.key === k)?.value ?? 0) || 0;
  const errors: string[] = [];
  let updated = 0, settled = 0;

  // 1) jogos e odds
  for (const sport of sports) {
    try {
      const events = await feed.odds(sport);
      const { data: existing } = await sb.from("matches").select("id, external_id, status")
        .in("external_id", events.map((e) => `${sport}:${e.id}`));
      const byExt = new Map((existing ?? []).map((m) => [m.external_id, m]));
      const now = Date.now();
      const priced = new Set<string>();
      for (const ev of events) {
        if (!ev.odds) continue;
        const isLive = new Date(ev.commence_time).getTime() <= now;
        const odds = applyMargin(ev.odds, margin(isLive ? "odds_margin_live" : "odds_margin_pre"));
        const row = {
          external_id: `${sport}:${ev.id}`, sport: ev.sport, league: ev.league, home: ev.home, away: ev.away,
          starts_at: ev.commence_time, odd_home: odds.home, odd_draw: odds.draw, odd_away: odds.away,
          status: isLive ? "live" : "open",
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
      const byExt = new Map((await feed.scores(sport)).map((s) => [`${sport}:${s.id}`, s]));
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

  return json({ modo: mode, jogos_atualizados: updated, jogos_liquidados: settled, creditos_restantes: feed.remaining(), errors });
});
