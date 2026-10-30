// Adaptadores de API de odds. Para trocar de API: implemente OddsProvider e registre em PROVIDERS,
// depois defina o secret ODDS_PROVIDER com o nome do adaptador.

export type MatchOdds = { home: number | null; draw: number | null; away: number | null };
export type FeedEvent = {
  id: string; league: string; sport: string; home: string; away: string;
  commence_time: string; odds: MatchOdds | null;
};
export type FeedScore = { id: string; home: number; away: number; completed: boolean };

export interface OddsProvider {
  odds(sport: string): Promise<FeedEvent[]>;
  scores(sport: string): Promise<FeedScore[]>;
  remaining(): string | null;
}

const SPORT_PT: Record<string, string> = {
  soccer: "Futebol", basketball: "Basquete", tennis: "Tênis", americanfootball: "Futebol Americano",
  baseball: "Beisebol", icehockey: "Hóquei", mma: "MMA", volleyball: "Vôlei",
};
export const sportPt = (key: string, fallback: string) => SPORT_PT[key.split("_")[0]] ?? fallback;

// ---------- The Odds API (the-odds-api.com) ----------
type ToaEvent = {
  id: string; sport_title: string; commence_time: string; home_team: string; away_team: string;
  completed?: boolean; scores?: { name: string; score: string }[] | null;
  bookmakers?: { markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
};

function theOddsApi(key: string): OddsProvider {
  const API = "https://api.the-odds-api.com/v4/sports";
  let left: string | null = null;
  const get = async (url: string): Promise<ToaEvent[]> => {
    const r = await fetch(url);
    left = r.headers.get("x-requests-remaining") ?? left;
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    return await r.json();
  };
  const avg = (ev: ToaEvent, name: string) => {
    const p = (ev.bookmakers ?? []).flatMap((b) => b.markets.filter((m) => m.key === "h2h"))
      .flatMap((m) => m.outcomes.filter((o) => o.name === name).map((o) => o.price));
    if (!p.length) return null;
    const v = Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 100) / 100;
    return v > 1 ? v : null;
  };
  return {
    async odds(sport) {
      const evs = await get(`${API}/${sport}/odds?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`);
      return evs.map((e) => {
        const odds = { home: avg(e, e.home_team), draw: avg(e, "Draw"), away: avg(e, e.away_team) };
        return {
          id: e.id, league: e.sport_title, sport: sportPt(sport, e.sport_title), home: e.home_team, away: e.away_team,
          commence_time: e.commence_time, odds: odds.home && odds.away ? odds : null,
        };
      });
    },
    async scores(sport) {
      const evs = await get(`${API}/${sport}/scores?apiKey=${key}&daysFrom=3`);
      return evs.flatMap((e) => {
        const h = Number(e.scores?.find((x) => x.name === e.home_team)?.score);
        const a = Number(e.scores?.find((x) => x.name === e.away_team)?.score);
        return e.scores && !Number.isNaN(h) && !Number.isNaN(a) ? [{ id: e.id, home: h, away: a, completed: !!e.completed }] : [];
      });
    },
    remaining: () => left,
  };
}

const PROVIDERS: Record<string, (key: string) => OddsProvider> = {
  theoddsapi: theOddsApi,
  // novaapi: novaApi,
};

export function getProvider(): OddsProvider {
  const name = (Deno.env.get("ODDS_PROVIDER") || "theoddsapi").toLowerCase();
  const make = PROVIDERS[name];
  if (!make) throw new Error(`ODDS_PROVIDER desconhecido: ${name}`);
  const key = Deno.env.get("ODDS_API_KEY");
  if (!key) throw new Error("Configure o secret ODDS_API_KEY no Supabase (Edge Functions → Secrets)");
  return make(key);
}
