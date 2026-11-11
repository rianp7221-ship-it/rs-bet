// Basquete: odds da The Odds API (plano grátis: 500 créditos/mês, 1 por liga a cada busca de odds)
// e placar/escudos da API-Basketball (api-sports.io, mesma chave da API-Football; plano grátis: 100 consultas/dia).
// external_id = "bk<liga da The Odds API>:<id do evento>", ex.: "bkbasketball_nba:85a2...".
import { hits, tokens } from "./names.ts";

export const BK_PREFIX = "bk";
export const BK_DEFAULT = "basketball_nba,basketball_euroleague";
export const BK_LEAGUE: Record<string, string> = { basketball_nba: "NBA", basketball_euroleague: "EuroLeague" };

// lista de eventos da The Odds API: não gasta crédito
export type ToaListed = { id: string; commence_time: string; home_team: string; away_team: string };
export async function toaEvents(key: string, sport: string): Promise<ToaListed[]> {
  const r = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${key}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`The Odds API ${r.status} ${(await r.text()).slice(0, 120)}`);
  return await r.json();
}

export type AbGame = {
  id: number; date: string; status: { short: string };
  league: { id: number; logo?: string | null };
  teams: { home: { name: string; logo?: string | null }; away: { name: string; logo?: string | null } };
  scores: { home: { total: number | null }; away: { total: number | null } };
};
export const AB_DONE = ["FT", "AOT"];
export const AB_VOID = ["POST", "CANC", "ABD", "AWD"];

// datas da API-Basketball no fuso de Nova York: a rodada da NBA (e a da EuroLeague) cai num dia só
const TZ = "America/New_York";
export const abDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

export function apiBasketball(key: string) {
  let left: number | null = null;
  const days = new Map<string, Promise<AbGame[]>>();
  const games = (day: string) => {
    if (!days.has(day)) {
      days.set(day, (async () => {
        const r = await fetch(`https://v1.basketball.api-sports.io/games?date=${day}&timezone=${encodeURIComponent(TZ)}`,
          { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(20_000) });
        const rem = Number(r.headers.get("x-ratelimit-requests-remaining"));
        if (Number.isFinite(rem) && r.headers.has("x-ratelimit-requests-remaining")) left = rem;
        const j = await r.json().catch(() => null);
        const err = j?.errors && Object.values(j.errors)[0];
        if (!r.ok || err) throw new Error(`API-Basketball: ${err ?? r.status}`);
        return (j.response ?? []) as AbGame[];
      })());
    }
    return days.get(day)!;
  };
  // mesmo jogo: começa até 40 min de diferença e os dois nomes batem (uma palavra de cada lado já basta)
  const find = async (m: { home: string; away: string; starts_at: string }) => {
    const t = Date.parse(m.starts_at), mh = tokens(m.home), ma = tokens(m.away);
    let best: AbGame | null = null, bestSc = 0, tie = false;
    for (const g of await games(abDay(m.starts_at))) {
      if (Math.abs(Date.parse(g.date) - t) > 40 * 60_000) continue;
      const h = hits(mh, tokens(g.teams.home.name)), a = hits(ma, tokens(g.teams.away.name));
      if (!h || !a) continue;
      if (h + a > bestSc) { best = g; bestSc = h + a; tie = false; } else if (h + a === bestSc) tie = true;
    }
    return tie ? null : best;
  };
  return { games, find, remaining: () => left, fetched: () => days.size };
}
