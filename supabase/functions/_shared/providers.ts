// Adaptadores de API de odds. Para trocar de API: implemente OddsProvider e registre em PROVIDERS,
// depois defina o secret ODDS_PROVIDER com o nome do adaptador (theoddsapi | apifootball | betsapi).

export type MatchOdds = { home: number | null; draw: number | null; away: number | null };
// mercados extras por jogo: { ou15|ou25|ou35: {over, under}, btts: {yes, no}, dc: {"1x", "12", "x2"}, dnb: {home, away} }
export type Markets = Record<string, Record<string, number>>;
export type FeedEvent = {
  id: string; league: string; sport: string; home: string; away: string;
  commence_time: string; odds: MatchOdds | null; markets?: Markets | null;
};
export type FeedScore = { id: string; home: number; away: number; completed: boolean };

// ao vivo em 1 chamada para todos os jogos (APIs com feed ao vivo)
export type LiveUpdate = {
  id: string; home: number | null; away: number | null; completed: boolean;
  cancelled: boolean; // adiado ou cancelado: trava o mercado
  voided: boolean; // cancelado de vez: anula as seleções
  odds: MatchOdds | null; markets?: Markets | null;
  minute?: number | null; // minuto de jogo
  suspended: string | null; // motivo de suspensão (lance perigoso, pênalti, mercado travado...)
};

export interface OddsProvider {
  name: string;
  prefix: string; // external_id = `${prefix}${sport}:${id}`
  defaultSports: string;
  odds(sport: string): Promise<FeedEvent[]>;
  scores(sport: string, ids?: string[]): Promise<FeedScore[]>; // ids = jogos já iniciados dessa liga
  live?(ids: string[]): Promise<LiveUpdate[]>;
  remaining(): string | null;
  limit?(): number | null; // cota do plano (por dia ou por hora)
  info?(): string | null; // resumo da última busca (diagnóstico)
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

// ---------- BetsAPI (betsapi.com) — feed Betfair Sportsbook ----------
// "sport" = competitionId da Betfair (13 Brasileirão, 10932509 Premier, 228 Champions...). external_id = "bf<liga>:<eventId>".
// Odds e mercado travado vêm do /betfair/sb/event; placar e status oficial do /betfair/result (até 10 jogos por chamada).
type BfListEv = { id: string; time: string; league: { id: string; name: string }; home: { name: string }; away: { name: string } };
type BfRunner = { selectionId: number; runnerStatus: string; runnerOrder: number; winRunnerOdds?: { trueOdds?: { decimalOdds?: { decimalOdds?: number } } } };
type BfMarket = { marketStatus: string; runnerDetails?: BfRunner[]; market: { marketType: string; runners?: { selectionId: number; sortPriority: number; runnerName?: string }[] } };
type BfEvent = {
  event: { eventId: number }; markets?: BfMarket[];
  markets_updated_at?: string | number;
  timeline?: { status?: string; timeElapsed?: number; score?: { home?: { score?: string }; away?: { score?: string } }; updateDetails?: { type: string; updateTime: string }[] } | null;
};
type BfResult = { time_status: string; ss: string | null; scores?: Record<string, { home: string; away: string }> };

// time_status: 0 não começou, 1 ao vivo, 3 encerrado, 4 adiado, 5 cancelado, 6 W.O., 7 interrompido, 8 abandonado, 99 removido
const BF_VOID = ["5", "6", "8", "99"];
const BF_CANCEL = ["4", ...BF_VOID];
const BF_PAUSE: Record<string, string> = { "7": "Jogo interrompido" };
// lance que mexe no jogo nos últimos 2 min
const BF_HOT: [RegExp, string][] = [[/red/i, "Expulsão"], [/penalt/i, "Pênalti"], [/var/i, "Revisão do VAR"], [/^goal$/i, "Gol"]];

function betsApi(token: string): OddsProvider {
  const API = "https://api.b365api.com/v1/betfair";
  // a API oscila (502/504, 1–40 s por chamada): tempo limite por chamada, novas tentativas e prazo total por execução
  const started = Date.now(), deadline = started + 80_000;
  let info: string | null = null;
  let left: string | null = null, cap: number | null = null;
  const get = async <T>(path: string): Promise<{ results: T[]; pager?: { page: number; per_page: number; total: number } }> => {
    for (let i = 0; ; i++) {
      let err = "";
      try {
        const r = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}token=${token}`, { signal: AbortSignal.timeout(25_000) });
        left = r.headers.get("x-ratelimit-remaining") ?? left;
        cap = Number(r.headers.get("x-ratelimit-limit")) || cap;
        const j = await r.json().catch(() => null);
        if (r.ok && j?.success === 1) return j;
        err = `${r.status} ${j?.error ?? ""} ${j?.error_detail ?? ""}`.trim();
        if (r.status < 500 && j) throw new Error(err);
      } catch (e) {
        if (!err && (e as Error).name !== "TimeoutError" && (e as Error).name !== "TypeError") throw e;
        err ||= (e as Error).message;
      }
      if (i >= 2 || Date.now() > deadline) throw new Error(err);
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  };
  // n chamadas em paralelo; o que passar do prazo fica sem resposta (undefined)
  const pool = async <I, O>(items: I[], n: number, fn: (x: I) => Promise<O>) => {
    const out: (O | undefined)[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length && Date.now() < deadline) {
        const i = next++;
        out[i] = await fn(items[i]).catch(() => undefined);
      }
    }));
    return out;
  };
  const list = async (kind: "inplay" | "upcoming", until: number) => {
    const first = await get<BfListEv>(`/sb/${kind}?sport_id=1&page=1`);
    const out = [...first.results];
    const pages = Math.min(30, Math.ceil((first.pager?.total ?? 0) / (first.pager?.per_page || 50)));
    // a lista vem em ordem de horário: estima quantas páginas cobrem o período e busca todas em paralelo
    const span = Number(first.results.at(-1)?.time ?? 0) - Number(first.results[0]?.time ?? 0);
    const need = until === Infinity || span <= 0 ? pages : Math.min(pages, Math.ceil((until / 1000 - Number(first.results[0].time)) / span) + 2);
    const rest = await pool(Array.from({ length: Math.max(0, need - 1) }, (_, k) => k + 2), 10, (pg) => get<BfListEv>(`/sb/${kind}?sport_id=1&page=${pg}`));
    for (const r of rest) out.push(...(r?.results ?? []));
    return out;
  };
  const eventMap = (evs: (BfEvent | undefined)[]) => new Map(evs.filter((d): d is BfEvent => !!d).map((d) => [String(d.event.eventId), d]));
  // até 10 ids por chamada; se o lote falhar ou vier incompleto, busca um por um
  const batch = async <T>(path: string, ids: string[]) => {
    const parts = Array.from({ length: Math.ceil(ids.length / 10) }, (_, i) => ids.slice(i * 10, i * 10 + 10));
    const res = await pool(parts, 4, async (part) => {
      const r = await get<T>(`${path}?event_id=${part.join(",")}`).catch(() => null);
      if (r?.results.length === part.length) return r.results;
      return (await pool(part, 10, async (id) => (await get<T>(`${path}?event_id=${id}`)).results[0]));
    });
    return parts.flatMap((part, i) => res[i] ?? part.map(() => undefined));
  };
  // catálogo (ao vivo + próximos 7 dias) e odds pré-jogo de todas as ligas, uma vez por execução, jogos mais próximos primeiro
  let catalog: Promise<{ evs: BfListEv[]; details: Map<string, BfEvent> }> | null = null;
  const loadCatalog = async () => {
    const until = Date.now() + 7 * 86400_000;
    const leagues = new Set((Deno.env.get("ODDS_SPORTS") || "13,321319,89219,10932509,117,81,59,55,228,2005").split(",").map((x) => x.trim()));
    const [live, next] = await Promise.all([list("inplay", Infinity), list("upcoming", until)]);
    // jogos das próximas 3 h primeiro; o resto em ordem aleatória para cada execução cobrir jogos diferentes dentro do prazo
    const soon = Date.now() + 3 * 3600_000;
    const evs = [...live, ...next].filter((e) => leagues.has(e.league.id) && Number(e.time) * 1000 <= until)
      .map((e) => ({ e, k: Number(e.time) * 1000 <= soon ? Number(e.time) : 2e10 + Math.random() }))
      .sort((a, b) => a.k - b.k).map(({ e }) => e);
    // o /sb/event pré-jogo é lento em lote: 1 jogo por chamada, 10 em paralelo
    const details = eventMap(await pool(evs.map((e) => e.id), 10, async (id) => (await get<BfEvent>(`/sb/event?event_id=${id}`)).results[0]));
    info = `catálogo: ${evs.length} jogos, ${details.size} com mercados, ${Math.round((Date.now() - started) / 1000)} s`;
    return { evs, details };
  };
  const price = (r: BfRunner) => { const v = Math.round((r.winRunnerOdds?.trueOdds?.decimalOdds?.decimalOdds ?? 0) * 100) / 100; return v > 1 ? v : null; };
  const pick = (ev?: BfEvent) => {
    const m = ev?.markets?.find((x) => x.market.marketType === "MATCH_ODDS");
    if (!m) return { odds: null, locked: false };
    if (m.marketStatus !== "OPEN") return { odds: null, locked: true };
    const prio = new Map((m.market.runners ?? []).map((r) => [r.selectionId, r.sortPriority]));
    const rs = [...(m.runnerDetails ?? [])].sort((a, b) => (prio.get(a.selectionId) ?? a.runnerOrder) - (prio.get(b.selectionId) ?? b.runnerOrder));
    if (rs.length !== 3 || rs.some((r) => r.runnerStatus !== "ACTIVE")) return { odds: null, locked: true };
    const odds = { home: price(rs[0]), draw: price(rs[1]), away: price(rs[2]) };
    return { odds: odds.home && odds.away ? odds : null, locked: false };
  };
  const BF_MKT: Record<string, string> = {
    OVER_UNDER_15: "ou15", OVER_UNDER_25: "ou25", OVER_UNDER_35: "ou35", BOTH_TEAMS_TO_SCORE: "btts", DOUBLE_CHANCE: "dc", DRAW_NO_BET: "dnb",
  };
  // seleção pelo nome do runner (Over/Under, Yes/No, "X And Draw"); Empate Anula e a ordem das chances duplas pela sortPriority
  const sel = (mk: string, name: string, i: number, draws: number) =>
    mk === "btts" ? (/^yes/i.test(name) ? "yes" : "no")
    : mk === "dnb" ? (i === 0 ? "home" : "away")
    : mk === "dc" ? (!/draw/i.test(name) ? "12" : draws === 0 ? "1x" : "x2")
    : /^over/i.test(name) ? "over" : "under";
  const extra = (ev?: BfEvent): Markets | null => {
    const out: Markets = {};
    for (const m of ev?.markets ?? []) {
      const mk = BF_MKT[m.market.marketType];
      if (!mk || m.marketStatus !== "OPEN") continue;
      const info = new Map((m.market.runners ?? []).map((r) => [r.selectionId, r]));
      const rs = [...(m.runnerDetails ?? [])].sort((a, b) =>
        (info.get(a.selectionId)?.sortPriority ?? a.runnerOrder) - (info.get(b.selectionId)?.sortPriority ?? b.runnerOrder));
      if (rs.length !== (mk === "dc" ? 3 : 2) || rs.some((r) => r.runnerStatus !== "ACTIVE")) continue;
      const o: Record<string, number> = {};
      let draws = 0;
      rs.forEach((r, i) => {
        const name = info.get(r.selectionId)?.runnerName ?? "";
        const k = sel(mk, name, i, draws), v = price(r);
        if (mk === "dc" && /draw/i.test(name)) draws++;
        if (v) o[k] = v;
      });
      if (Object.keys(o).length === rs.length) out[mk] = o;
    }
    return Object.keys(out).length ? out : null;
  };
  // 1X2 vale pelos 90 min: scores["2"] é o placar do tempo normal; ss pode incluir prorrogação
  const goals = (r?: BfResult) => {
    const s = r?.scores?.["2"] ?? (r?.ss ? { home: r.ss.split("-")[0], away: r.ss.split("-")[1] } : null);
    const h = Number(s?.home), a = Number(s?.away);
    return s && Number.isFinite(h) && Number.isFinite(a) ? { home: h, away: a } : null;
  };
  return {
    name: "betsapi",
    prefix: "bf",
    // Brasileirão A/B, Copa do Brasil, Premier, La Liga, Serie A, Bundesliga, Ligue 1, Champions, Europa League
    defaultSports: "13,321319,89219,10932509,117,81,59,55,228,2005",
    async odds(league) {
      catalog ??= loadCatalog();
      const { evs, details } = await catalog;
      return evs.filter((e) => e.league.id === league).map((e) => ({
        id: e.id, league: e.league.name, sport: "Futebol", home: e.home.name, away: e.away.name,
        commence_time: new Date(Number(e.time) * 1000).toISOString(), odds: pick(details.get(e.id)).odds,
        markets: extra(details.get(e.id)),
      }));
    },
    async scores(_league, ids = []) {
      const res = await batch<BfResult>("/result", ids);
      return ids.flatMap((id, i) => {
        const g = goals(res[i]);
        return g ? [{ id, ...g, completed: res[i]!.time_status === "3" }] : [];
      });
    },
    async live(ids) {
      const byId = eventMap(await batch<BfEvent>("/sb/event", ids));
      // placar ao vivo vem do /sb/event; o /result (status oficial) só para jogo fora do ar ou que não está mais "IN_PLAY"
      const check = ids.filter((id) => byId.get(id)?.timeline?.status !== "IN_PLAY");
      const res = new Map((await batch<BfResult>("/result", check)).map((r, i) => [check[i], r]));
      const now = Date.now();
      return ids.map((id) => {
        const ev = byId.get(id), r = res.get(id), st = r?.time_status ?? "";
        const sc = ev?.timeline?.score;
        const g = goals(r) ?? (sc?.home?.score != null && sc.away?.score != null ? { home: Number(sc.home.score), away: Number(sc.away.score) } : null);
        const { odds, locked } = pick(ev);
        const recent = (ev?.timeline?.updateDetails ?? []).filter((u) => now - Date.parse(u.updateTime) < 120_000);
        const hot = BF_HOT.find(([re]) => recent.some((u) => re.test(u.type)))?.[1] ?? null;
        // em jogo, a Betfair reprecifica a cada poucos segundos: odds paradas há mais de 90 s não servem para cashout
        const at = Number(ev?.markets_updated_at) || Date.parse(String(ev?.markets_updated_at ?? ""));
        const stale = ev?.timeline?.status === "IN_PLAY" && at > 0 && now - (at < 1e12 ? at * 1000 : at) > 90_000 ? "Odds desatualizadas na fonte" : null;
        return {
          id, home: g?.home ?? null, away: g?.away ?? null,
          completed: st === "3", cancelled: BF_CANCEL.includes(st), voided: BF_VOID.includes(st),
          odds, markets: locked ? null : extra(ev), minute: ev?.timeline?.timeElapsed ?? null,
          suspended: BF_PAUSE[st] ?? (locked ? "Mercado travado na fonte" : hot ?? stale),
        };
      });
    },
    remaining: () => left,
    limit: () => cap,
    info: () => info,
  };
}

const PROVIDERS: Record<string, (key: string) => OddsProvider> = {
  theoddsapi: theOddsApi,
  apifootball: apiFootball,
  betsapi: betsApi,
};

// secret com a chave de cada API (o primeiro que existir)
const KEYS: Record<string, string[]> = {
  theoddsapi: ["ODDS_API_KEY"],
  apifootball: ["API_FOOTBALL_KEY", "ODDS_API_KEY"],
  betsapi: ["BETSAPI_TOKEN", "ODDS_API_KEY"],
};

export function getProvider(): OddsProvider {
  const name = (Deno.env.get("ODDS_PROVIDER") || "theoddsapi").toLowerCase();
  const make = PROVIDERS[name];
  if (!make) throw new Error(`ODDS_PROVIDER desconhecido: ${name}`);
  const key = KEYS[name].map((k) => Deno.env.get(k)).find(Boolean);
  if (!key) throw new Error(`Configure o secret ${KEYS[name][0]} no Supabase (Edge Functions → Secrets)`);
  return make(key);
}
