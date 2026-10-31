// Adaptadores de API de odds. Para trocar de API: implemente OddsProvider e registre em PROVIDERS,
// depois defina o secret ODDS_PROVIDER com o nome do adaptador (theoddsapi | apifootball).

export type MatchOdds = { home: number | null; draw: number | null; away: number | null };
export type FeedEvent = {
  id: string; league: string; sport: string; home: string; away: string;
  commence_time: string; odds: MatchOdds | null;
};
export type FeedScore = { id: string; home: number; away: number; completed: boolean };

// ao vivo em 1 chamada para todos os jogos (APIs com feed ao vivo)
export type LiveUpdate = {
  id: string; home: number | null; away: number | null; completed: boolean;
  cancelled: boolean; // adiado ou cancelado: trava o mercado
  voided: boolean; // cancelado de vez: anula as seleções
  odds: MatchOdds | null; suspended: string | null; // motivo de suspensão (lance perigoso, pênalti, mercado travado...)
};

export interface OddsProvider {
  name: string;
  prefix: string; // external_id = `${prefix}${sport}:${id}`
  defaultSports: string;
  odds(sport: string): Promise<FeedEvent[]>;
  scores(sport: string): Promise<FeedScore[]>;
  live?(ids: string[]): Promise<LiveUpdate[]>;
  remaining(): string | null;
  limit?(): number | null; // cota diária do plano
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
    name: "theoddsapi",
    prefix: "",
    defaultSports: "soccer_brazil_campeonato,soccer_epl,soccer_uefa_champs_league,soccer_spain_la_liga,basketball_nba",
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

// ---------- API-Football (api-football.com / api-sports.io) ----------
// "sport" = id da liga (71 Brasileirão, 39 Premier, 2 Champions...). external_id = "af<liga>:<fixture>".
type AfFixture = {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null } };
  league: { id: number; name: string; country: string };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
  score?: { fulltime?: { home: number | null; away: number | null } };
  events?: { time: { elapsed: number; extra: number | null }; type: string; detail: string }[];
};
type AfBet = { id: number; name: string; values: { value: string; odd: string; suspended?: boolean }[] };
type AfOdds = { fixture: { id: number }; bookmakers?: { bets: AfBet[] }[] };
type AfLiveOdds = { fixture: { id: number }; status?: { stopped?: boolean; blocked?: boolean; finished?: boolean }; odds: AfBet[] };

const AF_DONE = ["FT", "AET", "PEN"];
const AF_VOID = ["CANC", "ABD", "AWD", "WO"];
const AF_CANCEL = ["PST", ...AF_VOID];
// o mercado 1X2 vale só pelos 90 min: na prorrogação/pênaltis usa o placar do tempo normal
const afGoals = (f: AfFixture) =>
  ["AET", "PEN"].includes(f.fixture.status.short) && f.score?.fulltime?.home != null && f.score.fulltime.away != null
    ? f.score.fulltime : f.goals;
const AF_PAUSE: Record<string, string> = { SUSP: "Jogo paralisado", INT: "Jogo interrompido", BT: "Intervalo da prorrogação", P: "Disputa de pênaltis" };
const AF_1X2 = ["Match Winner", "Fulltime Result", "1x2"];

function apiFootball(key: string): OddsProvider {
  const API = "https://v3.football.api-sports.io";
  let left: string | null = null, daily: number | null = null;
  const seasons = new Map<string, number>();
  const get = async <T>(path: string): Promise<{ response: T[]; paging?: { current: number; total: number } }> => {
    const r = await fetch(`${API}${path}`, { headers: { "x-apisports-key": key } });
    left = r.headers.get("x-ratelimit-requests-remaining") ?? left;
    daily = Number(r.headers.get("x-ratelimit-requests-limit")) || daily;
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    const errs = j.errors && (Array.isArray(j.errors) ? j.errors : Object.values(j.errors));
    if (errs?.length) throw new Error(String(errs[0]));
    return j;
  };
  const num = (s?: string) => { const v = Math.round(Number(s) * 100) / 100; return v > 1 ? v : null; };
  const pick = (bets: AfBet[]) => {
    const vals = bets.filter((b) => AF_1X2.includes(b.name)).flatMap((b) => b.values);
    const avg = (name: string) => {
      const p = vals.filter((v) => v.value === name && !v.suspended).map((v) => num(v.odd)).filter((x): x is number => !!x);
      return p.length ? Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 100) / 100 : null;
    };
    const o = { home: avg("Home"), draw: avg("Draw"), away: avg("Away") };
    return o.home && o.away ? o : null;
  };
  const season = async (league: string) => {
    if (!seasons.has(league)) {
      const { response } = await get<{ seasons: { year: number; current: boolean }[] }>(`/leagues?id=${league}&current=true`);
      const y = response[0]?.seasons.find((s) => s.current)?.year;
      if (!y) throw new Error(`liga ${league} sem temporada atual`);
      seasons.set(league, y);
    }
    return seasons.get(league)!;
  };
  const day = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
  return {
    name: "apifootball",
    prefix: "af",
    // Brasileirão A/B, Copa do Brasil, Libertadores, Sul-Americana, Premier, La Liga, Serie A, Bundesliga, Ligue 1, Champions
    defaultSports: "71,72,73,13,11,39,140,135,78,61,2",
    async odds(league) {
      const y = await season(league);
      const { response: fx } = await get<AfFixture>(`/fixtures?league=${league}&season=${y}&from=${day(0)}&to=${day(7)}&timezone=UTC`);
      const open = fx.filter((f) => !AF_DONE.includes(f.fixture.status.short) && !AF_CANCEL.includes(f.fixture.status.short));
      if (!open.length) return [];
      const prices = new Map<number, AfBet[]>();
      for (let page = 1, total = 1; page <= total && page <= 5; page++) {
        const r = await get<AfOdds>(`/odds?league=${league}&season=${y}&bet=1&page=${page}`);
        total = r.paging?.total ?? 1;
        for (const o of r.response) prices.set(o.fixture.id, (o.bookmakers ?? []).flatMap((b) => b.bets));
      }
      return open.map((f) => ({
        id: String(f.fixture.id), league: f.league.name, sport: "Futebol", home: f.teams.home.name, away: f.teams.away.name,
        commence_time: f.fixture.date, odds: pick(prices.get(f.fixture.id) ?? []),
      }));
    },
    async scores(league) {
      const y = await season(league);
      const { response } = await get<AfFixture>(`/fixtures?league=${league}&season=${y}&from=${day(-3)}&to=${day(0)}&timezone=UTC`);
      return response.map((f) => ({ f, g: afGoals(f) })).filter(({ g }) => g.home != null && g.away != null).map(({ f, g }) => ({
        id: String(f.fixture.id), home: g.home!, away: g.away!, completed: AF_DONE.includes(f.fixture.status.short),
      }));
    },
    async live(ids) {
      const out: LiveUpdate[] = [];
      if (!ids.length) return out;
      const fixtures: AfFixture[] = [];
      for (let i = 0; i < ids.length; i += 20) fixtures.push(...(await get<AfFixture>(`/fixtures?ids=${ids.slice(i, i + 20).join("-")}`)).response);
      const live = fixtures.some((f) => !AF_DONE.includes(f.fixture.status.short) && !AF_CANCEL.includes(f.fixture.status.short) && f.fixture.status.short !== "NS")
        ? new Map((await get<AfLiveOdds>(`/odds/live`)).response.map((o) => [o.fixture.id, o])) : new Map<number, AfLiveOdds>();
      for (const f of fixtures) {
        const st = f.fixture.status.short;
        const lo = live.get(f.fixture.id);
        const el = f.fixture.status.elapsed ?? 0;
        // lance que mexe no jogo nos últimos ~2 min: pênalti, expulsão, VAR
        const hot = (f.events ?? []).find((e) => e.time.elapsed + (e.time.extra ?? 0) >= el - 2 &&
          (e.type === "Var" || e.detail === "Red Card" || /penalty/i.test(e.detail)));
        const suspended = AF_PAUSE[st] ?? (lo?.status?.blocked || lo?.status?.stopped ? "Mercado travado na fonte"
          : hot ? (hot.type === "Var" ? "Revisão do VAR" : hot.detail === "Red Card" ? "Expulsão" : "Pênalti") : null);
        const g = afGoals(f);
        out.push({
          id: String(f.fixture.id), home: g.home, away: g.away,
          completed: AF_DONE.includes(st), cancelled: AF_CANCEL.includes(st), voided: AF_VOID.includes(st),
          odds: lo ? pick(lo.odds) : null, suspended,
        });
      }
      return out;
    },
    remaining: () => left,
    limit: () => daily,
  };
}

const PROVIDERS: Record<string, (key: string) => OddsProvider> = {
  theoddsapi: theOddsApi,
  apifootball: apiFootball,
};

export function getProvider(): OddsProvider {
  const name = (Deno.env.get("ODDS_PROVIDER") || "theoddsapi").toLowerCase();
  const make = PROVIDERS[name];
  if (!make) throw new Error(`ODDS_PROVIDER desconhecido: ${name}`);
  const key = name === "apifootball" ? Deno.env.get("API_FOOTBALL_KEY") ?? Deno.env.get("ODDS_API_KEY") : Deno.env.get("ODDS_API_KEY");
  if (!key) throw new Error(`Configure o secret ${name === "apifootball" ? "API_FOOTBALL_KEY" : "ODDS_API_KEY"} no Supabase (Edge Functions → Secrets)`);
  return make(key);
}
