// Basquete pela 365Scores com país EUA (userCountryId=1): odds da Bet365 antes e durante o jogo, placar e quarto.
// Mercados: vencedor com prorrogação (1x2 sem empate), total de pontos (ou + linha x10) e handicap (hc + m/p + linha x10).
import type { Markets } from "./providers.ts";

export const BK_PREFIX = "bk";
export const BK_EXT = `${BK_PREFIX}365:`;
const BASE = "https://webws.365scores.com/web";
const QS = "appTypeId=5&langId=31&timezoneName=UTC&userCountryId=1";
const B365 = 14;
const IMG = "https://imagecache.365scores.com/image/upload/f_png,w_64,h_64,c_limit,q_auto:eco,dpr_2";

type Comp = { id: number; name: string; score?: number; imageVersion?: number };
export type G365 = {
  id: number; competitionId: number; competitionDisplayName: string; startTime: string; statusGroup: number; statusText: string;
  gameTimeDisplay?: string | null; homeCompetitor: Comp; awayCompetitor: Comp; odds?: { bookmakerId?: number } | null;
};
export type List365 = { games: G365[]; competitions: { id: number; name: string; countryId: number }[]; countries: { id: number; name: string; isNotReal?: boolean }[] };
type Line = { gameId: number; lineTypeId: number; bookmakerId: number; internalOptionValue?: string; options: { num: number; rate?: { decimal?: number }; lead?: number }[] };

async function get(path: string) {
  const r = await fetch(`${BASE}/${path}&${QS}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`365Scores ${r.status}`);
  return await r.json();
}
const day = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

export async function bkList(from: Date, to: Date): Promise<List365> {
  const j = await get(`games/?sports=2&showOdds=true&startDate=${day(from)}&endDate=${day(to)}`);
  return { games: j.games ?? [], competitions: j.competitions ?? [], countries: j.countries ?? [] };
}

// só linhas de meio ponto: linha inteira devolveria a aposta no empate da linha
const half = (v: number) => Number.isFinite(v) && Math.abs(v) < 1000 && Math.abs(Math.round(v * 10)) % 10 === 5;

export async function bkLines(id: number): Promise<{ game: G365 | null; odds: { home: number; draw: null; away: number } | null; markets: Markets }> {
  const j = await get(`bets/lines/?games=${id}`);
  let odds: { home: number; draw: null; away: number } | null = null;
  const markets: Markets = {};
  for (const l of (j.lines ?? []) as Line[]) {
    if (l.gameId !== id || l.bookmakerId !== B365) continue;
    const opt = (n: number) => l.options.find((o) => o.num === n);
    const a = Number(opt(1)?.rate?.decimal), b = Number(opt(2)?.rate?.decimal);
    if (!(a > 1 && b > 1)) continue;
    if (l.lineTypeId === 33) odds = { home: a, draw: null, away: b };
    else if (l.lineTypeId === 34) {
      const v = Number(l.internalOptionValue);
      if (half(v) && v > 0) markets[`ou${Math.round(v * 10)}`] = { over: b, under: a };
    } else if (l.lineTypeId === 35) {
      const v = Number(opt(1)?.lead ?? l.internalOptionValue); // linha da casa
      if (half(v)) markets[`hc${v < 0 ? "m" : "p"}${Math.round(Math.abs(v) * 10)}`] = { home: a, away: b };
    }
  }
  return { game: ((j.games ?? []) as G365[]).find((g) => g.id === id) ?? null, odds, markets };
}

const KEEP = new Set(["NBA", "NBB", "NBL", "Eurocup", "WNBA", "NCAAW"]);
export function bkLeague(g: G365, l: List365): string {
  const name = g.competitionDisplayName.split(" - ")[0].trim();
  if (name === "Euroliga") return "EuroLeague";
  if (name.startsWith("NCAAB")) return "NCAA";
  const c = l.countries.find((x) => x.id === l.competitions.find((x) => x.id === g.competitionId)?.countryId);
  return KEEP.has(name) || !c || c.isNotReal || name.includes(c.name) ? name : `${name} ${c.name}`;
}

export const bkTeamLogo = (c: Comp) => `${IMG},d_Competitors:default1.png/v${c.imageVersion ?? 1}/Competitors/${c.id}`;
export const bkLeagueLogo = (id: number) => `${IMG},d_Countries:round:2.png/v1/Competitions/light/${id}`;
// statusGroup 2 = agendado, 3 = em andamento, 4 = encerrado (Fim, Pós-prorrogação, Adiado...)
export const bkVoid = (g: G365) => g.statusGroup === 4 && /adiad|cancel|abandon|interromp|suspen/i.test(g.statusText);
export const bkDone = (g: G365) => g.statusGroup === 4 && !bkVoid(g);
export const bkScore = (c: Comp) => (typeof c.score === "number" && c.score >= 0 ? c.score : null);
