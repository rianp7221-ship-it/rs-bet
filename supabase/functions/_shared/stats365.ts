// estatísticas finais do 365Scores (escanteios, cartões, chutes): reserva para quando a API principal não tem o dado da liga
import { hits, tokens } from "./names.ts";

const BASE = "https://webws.365scores.com/web";
const QS = "appTypeId=5&langId=1&timezoneName=UTC&userCountryId=21";
const get = (u: string) => fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) }).then((r) => r.json());
type C365 = { id: number; name: string };
type G365 = { id: number; startTime: string; statusGroup: number; homeCompetitor: C365; awayCompetitor: C365 };
type S365 = { id: number; competitorId: number; value: string };
export type Stats = { corners: { home: number; away: number } | null; cards: { home: number; away: number } | null;
  shots: { home: number; away: number } | null; sot: { home: number; away: number } | null };
export type MatchRef = { home: string; away: string; starts_at: string; ext365_id?: number | null };

const dmy = (t: number) => { const d = new Date(t); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
// lado a lado (true) ou invertido (false); null = não é o mesmo jogo. Exige nome parecido nos dois times.
function side(m: MatchRef, g: G365): boolean | null {
  const mh = tokens(m.home), ma = tokens(m.away), gh = tokens(g.homeCompetitor.name), ga = tokens(g.awayCompetitor.name);
  const same = hits(mh, gh) && hits(ma, ga) ? hits(mh, gh) + hits(ma, ga) : 0;
  const swap = hits(mh, ga) && hits(ma, gh) ? hits(mh, ga) + hits(ma, gh) : 0;
  return same > swap ? true : swap > same ? false : null;
}
const days = new Map<string, Promise<G365[]>>();
async function find(m: MatchRef): Promise<number | null> {
  const t = Date.parse(m.starts_at), d = dmy(t);
  if (!days.has(d)) days.set(d, get(`${BASE}/games/allscores/?${QS}&sports=1&startDate=${d}&endDate=${d}&showOdds=false&onlyMajorGames=false`)
    .then((j) => (j?.games ?? []) as G365[]).catch(() => []));
  const near = (await days.get(d)!).filter((g) => Math.abs(Date.parse(g.startTime) - t) <= 20 * 60_000 && side(m, g) !== null);
  return near.length === 1 ? near[0].id : null;
}

async function load(m: MatchRef, id: number): Promise<{ id: number; stats: Stats } | null> {
  const j = await get(`${BASE}/game/stats/?${QS}&games=${id}`);
  const g = (j?.games ?? [])[0] as G365 | undefined;
  if (!g || g.statusGroup !== 4) return null;
  const straight = side(m, g);
  if (straight === null) return null;
  const [h, a] = straight ? [g.homeCompetitor.id, g.awayCompetitor.id] : [g.awayCompetitor.id, g.homeCompetitor.id];
  const st = (j?.statistics ?? []) as S365[];
  const val = (type: number, team: number) => {
    const s = st.find((x) => x.id === type && x.competitorId === team);
    const n = s ? Number(String(s.value).replace("%", "")) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const pair = (type: number) => { const x = val(type, h), y = val(type, a); return x == null || y == null ? null : { home: x, away: y }; };
  // 0 x 0 em escanteios/chutes é o 365Scores sem o dado (jogo de verdade sempre tem chute); sem escanteios, os cartões 0 x 0 também não são confiáveis
  const real = (p: { home: number; away: number } | null) => (p && p.home + p.away > 0 ? p : null);
  const corners = real(pair(8)), shots = real(pair(3)), yellow = pair(1), red = pair(2);
  return { id, stats: {
    corners,
    cards: corners && yellow && { home: yellow.home + (red?.home ?? 0), away: yellow.away + (red?.away ?? 0) },
    shots, sot: shots && pair(4),
  } };
}
// só com o jogo encerrado lá; cada grupo (escanteios, cartões...) vem null se faltar o dado de um dos times.
// O ext365_id salvo pelo goal-guard às vezes é de outro jogo: se os times não batem, procura o jogo pela data.
export async function stats365(m: MatchRef): Promise<{ id: number; stats: Stats } | null> {
  const saved = m.ext365_id ? await load(m, m.ext365_id) : null;
  if (saved) return saved;
  const id = await find(m);
  return id && id !== m.ext365_id ? load(m, id) : null;
}
