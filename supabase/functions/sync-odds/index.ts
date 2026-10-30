// sync-odds — busca jogos, odds e resultados reais na The Odds API (the-odds-api.com)
// Secret obrigatório: ODDS_API_KEY. Opcional: ODDS_SPORTS (chaves separadas por vírgula).
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.the-odds-api.com/v4/sports";
const DEFAULT_SPORTS = "soccer_brazil_campeonato,soccer_epl,soccer_uefa_champs_league,soccer_spain_la_liga,basketball_nba";
const SPORT_PT: Record<string, string> = {
  soccer: "Futebol", basketball: "Basquete", tennis: "Tênis", americanfootball: "Futebol Americano",
  baseball: "Beisebol", icehockey: "Hóquei", mma: "MMA", volleyball: "Vôlei",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Outcome = { name: string; price: number };
type Event = {
  id: string; sport_key: string; sport_title: string; commence_time: string; home_team: string; away_team: string;
  completed?: boolean; scores?: { name: string; score: string }[] | null;
  bookmakers?: { markets: { key: string; outcomes: Outcome[] }[] }[];
};

function avgOdd(ev: Event, name: string): number | null {
  const prices = (ev.bookmakers ?? []).flatMap((b) => b.markets.filter((m) => m.key === "h2h"))
    .flatMap((m) => m.outcomes.filter((o) => o.name === name).map((o) => o.price));
  if (!prices.length) return null;
  const v = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
  return v > 1 ? v : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("ODDS_API_KEY");
  if (!key) return json({ error: "Configure o secret ODDS_API_KEY no Supabase (Edge Functions → Secrets)" });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "Faça login" }, 401);
  const { data: me } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return json({ error: "Apenas administradores" }, 403);

  const sports = (Deno.env.get("ODDS_SPORTS") || DEFAULT_SPORTS).split(",").map((s) => s.trim()).filter(Boolean);
  const errors: string[] = [];
  let updated = 0, settled = 0, remaining: string | null = null;

  const get = async (url: string): Promise<Event[]> => {
    const r = await fetch(url);
    remaining = r.headers.get("x-requests-remaining") ?? remaining;
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    return await r.json();
  };

  // 1) jogos e odds
  for (const sport of sports) {
    try {
      const events = await get(`${API}/${sport}/odds?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`);
      const ids = events.map((e) => `${sport}:${e.id}`);
      const { data: existing } = await sb.from("matches").select("id, external_id, status").in("external_id", ids);
      const byExt = new Map((existing ?? []).map((m) => [m.external_id, m]));
      const now = Date.now();
      for (const ev of events) {
        const odd_home = avgOdd(ev, ev.home_team), odd_away = avgOdd(ev, ev.away_team), odd_draw = avgOdd(ev, "Draw");
        if (!odd_home || !odd_away) continue;
        const row = {
          external_id: `${sport}:${ev.id}`,
          sport: SPORT_PT[sport.split("_")[0]] ?? ev.sport_title,
          league: ev.sport_title, home: ev.home_team, away: ev.away_team,
          starts_at: ev.commence_time, odd_home, odd_draw, odd_away,
          status: new Date(ev.commence_time).getTime() <= now ? "live" : "open",
        };
        const cur = byExt.get(row.external_id);
        if (cur && !["open", "live"].includes(cur.status)) continue;
        const { error } = cur
          ? await sb.from("matches").update(row).eq("id", cur.id)
          : await sb.from("matches").insert(row);
        if (error) errors.push(`${ev.home_team} x ${ev.away_team}: ${error.message}`);
        else updated++;
      }
    } catch (e) {
      errors.push(`${sport}: ${(e as Error).message}`);
    }
  }

  // 2) resultados — só consulta esportes com jogos já iniciados e ainda abertos
  const { data: pending } = await sb.from("matches").select("id, external_id, home, away")
    .in("status", ["open", "live"]).lt("starts_at", new Date().toISOString()).not("external_id", "is", null);
  const pendingBySport = new Map<string, typeof pending>();
  for (const m of pending ?? []) {
    const sport = m.external_id.split(":")[0];
    if (!pendingBySport.has(sport)) pendingBySport.set(sport, []);
    pendingBySport.get(sport)!.push(m);
  }
  for (const [sport, list] of pendingBySport) {
    try {
      const scores = await get(`${API}/${sport}/scores?apiKey=${key}&daysFrom=3`);
      const byExt = new Map(scores.map((s) => [`${sport}:${s.id}`, s]));
      for (const m of list!) {
        const s = byExt.get(m.external_id);
        if (!s?.scores) continue;
        const sh = Number(s.scores.find((x) => x.name === s.home_team)?.score);
        const sa = Number(s.scores.find((x) => x.name === s.away_team)?.score);
        if (Number.isNaN(sh) || Number.isNaN(sa)) continue;
        await sb.from("matches").update({ score_home: sh, score_away: sa, ...(s.completed ? {} : { status: "live" }) }).eq("id", m.id);
        if (!s.completed) continue;
        const result = sh > sa ? "home" : sh < sa ? "away" : "draw";
        const { error } = await sb.rpc("settle_match", { p_match: m.id, p_result: result });
        if (error) errors.push(`${m.home} x ${m.away}: ${error.message}`);
        else settled++;
      }
    } catch (e) {
      errors.push(`resultados ${sport}: ${(e as Error).message}`);
    }
  }

  return json({ jogos_atualizados: updated, jogos_liquidados: settled, creditos_restantes: remaining, errors });
});
