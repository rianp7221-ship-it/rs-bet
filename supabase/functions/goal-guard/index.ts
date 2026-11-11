// goal-guard — chamado pelo pg_cron a cada 5 s (header x-cron-secret). Publicar com --no-verify-jwt.
// Placar da ESPN, 365Scores, FotMob e LiveScore como fontes extras: se uma delas já mostra mais gols que o nosso jogo ao vivo, trava apostas e cashout
// até a API-Football confirmar o gol (aí o sync-odds aplica a trava normal). Máx. 3 min por placar, para um
// placar errado ou um jogo trocado na fonte externa não travar o mercado para sempre.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/auth.ts";
import { hits, tokens } from "../_shared/names.ts";

const ESPN: Record<string, string> = {
  "Brazil Série A": "bra.1", "Brazil Série B": "bra.2", "Copa do Brasil": "bra.copa_do_brazil",
  "CONMEBOL Libertadores": "conmebol.libertadores", "CONMEBOL Sudamericana": "conmebol.sudamericana",
  "UEFA Champions League": "uefa.champions", "UEFA Europa League": "uefa.europa", "UEFA Conference League": "uefa.europa.conf",
  "Premier League": "eng.1", "EPL": "eng.1", "Championship Inglaterra": "eng.2", "FA Cup Inglaterra": "eng.fa",
  "La Liga": "esp.1", "La Liga 2 Espanha": "esp.2", "Copa del Rey": "esp.copa_del_rey",
  "Serie A - Italy": "ita.1", "Serie B Itália": "ita.2", "Bundesliga": "ger.1", "2. Bundesliga Alemanha": "ger.2",
  "Ligue 1": "fra.1", "Ligue 2 França": "fra.2", "Primeira Liga Portugal": "por.1", "Eredivisie Holanda": "ned.1",
  "Pro League Bélgica": "bel.1", "Süper Lig Turquia": "tur.1", "Premiership Escócia": "sco.1", "Super League Suíça": "sui.1",
  "Bundesliga Áustria": "aut.1", "Superliga Dinamarca": "den.1", "Eliteserien Noruega": "nor.1", "Allsvenskan Suécia": "swe.1",
  "Super League Grécia": "gre.1", "Liga Profesional Argentina": "arg.1", "MLS EUA": "usa.1", "Liga MX México": "mex.1",
  "Primera A Colômbia": "col.1", "Primera División Chile": "chi.1", "Primera División Uruguai": "uru.1", "Liga 1 Peru": "per.1",
  "Liga Pro Equador": "ecu.1", "J1 League Japão": "jpn.1", "Super League China": "chn.1", "A-League Austrália": "aus.1",
  "Saudi Pro League": "ksa.1",
  "Eerste Divisie Holanda": "ned.2", "Premier League Rússia": "rus.1", "1. Lig Turquia": "tur.2", "Championship Escócia": "sco.2",
  "Challenge League Suíça": "sui.2", "1ª Divisão Dinamarca": "den.2", "1ª Divisão Noruega": "nor.2", "Superettan Suécia": "swe.2",
  "Ligat Ha'Al Israel": "isr.1", "2. Liga Áustria": "aut.2", "League One Inglaterra": "eng.3", "League Two Inglaterra": "eng.4",
  "National League Inglaterra": "eng.5", "UEFA Nations League": "uefa.nations", "Amistosos Internacionais": "fifa.friendly", "AFC Champions League Elite": "afc.champions",
  "Liga 1 Indonésia": "idn.1", "Indian Super League": "ind.1", "Thai League 1 Tailândia": "tha.1", "Primera Nacional Argentina": "arg.2",
  "Primera B Argentina": "arg.3", "Primera B Colômbia": "col.2", "Primera División Costa Rica": "crc.1", "Primera División Paraguai": "par.1",
  "Primera División Venezuela": "ven.1", "Primera División Bolívia": "bol.1", "USL Championship EUA": "usa.usl.1", "Liga Nacional Honduras": "hon.1",
  "Liga Nacional Guatemala": "gua.1", "Copa Colômbia": "col.copa",
};
const LOCK_MS = 30_000, MAX_MS = 180_000;

type Live = { id: number; league: string; home: string; away: string; starts_at: string; score_home: number | null; score_away: number | null; suspended_until: string | null };
type G365 = { id: number; startTime: string; statusGroup: number; homeCompetitor: { name: string; score?: number }; awayCompetitor: { name: string; score?: number } };
// jogo ao vivo de uma fonte extra (sem liga): casamos por horário de início e nome dos times
type Ext = { id: string; start: number; home: string; away: string; h: number; a: number };
const UA = { "User-Agent": "Mozilla/5.0" };
const get = (u: string) => fetch(u, { headers: UA, signal: AbortSignal.timeout(4000) }).then((r) => r.json());
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10).replaceAll("-", "");
// LiveScore com locale -3: Esd = yyyymmddhhmmss no horário de Brasília
const esd = (n: number) => { const s = String(n); return Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00-03:00`); };
async function extras(): Promise<Ext[]> {
  const now = Date.now();
  const days = new Date(now).getUTCHours() < 5 ? [ymd(now - 864e5), ymd(now)] : [ymd(now)];
  const src = await Promise.all([
    // 365Scores: uma chamada traz todos os jogos ao vivo do mundo; o mais rápido nas medições
    get("https://webws.365scores.com/web/games/current/?appTypeId=5&langId=1&timezoneName=UTC&userCountryId=21&sports=1")
      .then((j) => ((j?.games ?? []) as G365[]).filter((g) => g.statusGroup === 3).map((g) => ({ id: `365:${g.id}`, start: Date.parse(g.startTime),
        home: g.homeCompetitor.name, away: g.awayCompetitor.name, h: Number(g.homeCompetitor.score) || 0, a: Number(g.awayCompetitor.score) || 0 }))),
    // FotMob e LiveScore: um pouco mais lentos que o 365Scores, mas mantêm jogos que ele às vezes tira da lista
    ...days.map((d) => get(`https://www.fotmob.com/api/data/matches?date=${d}`)
      .then((j) => (j?.leagues ?? []).flatMap((l: any) => l.matches ?? []).filter((x: any) => x.status?.ongoing).map((x: any) => ({ id: `fm:${x.id}`,
        start: Date.parse(x.status.utcTime), home: x.home.name, away: x.away.name, h: Number(x.home.score) || 0, a: Number(x.away.score) || 0 })))),
    get("https://prod-public-api.livescore.com/v1/api/app/live/soccer/-3?locale=en&MD=1")
      .then((j) => (j?.Stages ?? []).flatMap((s: any) => s.Events ?? []).filter((e: any) => "Tr1" in e && !["NS", "FT", "AET", "AP", "Canc.", "Postp."].includes(e.Eps))
        .map((e: any) => ({ id: `lsc:${e.Eid}`, start: esd(e.Esd), home: e.T1[0].Nm, away: e.T2[0].Nm, h: Number(e.Tr1) || 0, a: Number(e.Tr2) || 0 }))),
  ].map((p) => p.catch(() => [] as Ext[])));
  return src.flat();
}
type Side = { homeAway: string; score?: string; team: { displayName: string; shortDisplayName?: string } };
type Ev = { id: string; status?: { type?: { state?: string } }; competitions?: { competitors?: Side[] }[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Sem permissão" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data } = await sb.from("matches").select("id, league, home, away, starts_at, score_home, score_away, suspended_until").eq("status", "live").eq("sport", "Futebol");
  const live = (data ?? []) as Live[];
  if (!live.length) return json({ live: 0 });
  const slugs = [...new Set(live.map((m) => ESPN[m.league]).filter(Boolean))];
  const boards = new Map(await Promise.all(slugs.map(async (s) => {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${s}/scoreboard`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      return [s, ((j?.events ?? []) as Ev[]).filter((e) => e.status?.type?.state === "in")] as const;
    } catch { return [s, [] as Ev[]] as const; }
  })));
  const ext = await extras();
  const { data: gs } = await sb.from("goal_guard").select("match_id, espn_home, espn_away, first_at").in("match_id", live.map((m) => m.id));
  const guard = new Map((gs ?? []).map((g) => [g.match_id as number, g]));

  const now = Date.now();
  let matched = 0, locked = 0;
  const var365: { m: Live; gid: string }[] = [];
  for (const m of live) {
    const mh = tokens(m.home), ma = tokens(m.away);
    let best: { ev: Ev; h: number; a: number } | null = null, bestScore = 0, tie = false;
    for (const ev of boards.get(ESPN[m.league]) ?? []) {
      const c = ev.competitions?.[0]?.competitors ?? [];
      const H = c.find((x) => x.homeAway === "home"), A = c.find((x) => x.homeAway === "away");
      if (!H || !A) continue;
      const th = tokens(`${H.team.displayName} ${H.team.shortDisplayName ?? ""}`), ta = tokens(`${A.team.displayName} ${A.team.shortDisplayName ?? ""}`);
      const score = Math.max(hits(mh, th) + hits(ma, ta), hits(mh, ta) + hits(ma, th));
      if (score > bestScore) { best = { ev, h: Number(H.score) || 0, a: Number(A.score) || 0 }; bestScore = score; tie = false; }
      else if (score && score === bestScore) tie = true;
    }
    // fontes extras: mesmo horário de início (±20 min) e nome parecido; em cada fonte fica o jogo mais parecido (empate = ignora).
    // Vale o maior placar entre as fontes que acharam o jogo.
    const bySrc = new Map<string, { x: Ext; sc: number; tie: boolean }>();
    for (const x of ext) {
      if (!(Math.abs(x.start - Date.parse(m.starts_at)) <= 20 * 60_000)) continue;
      const th = tokens(x.home), ta = tokens(x.away);
      const sc = Math.max(hits(mh, th) + hits(ma, ta), hits(mh, ta) + hits(ma, th));
      if (!sc) continue;
      const k = x.id.split(":")[0], cur = bySrc.get(k);
      if (!cur || sc > cur.sc) bySrc.set(k, { x, sc, tie: false }); else if (sc === cur.sc && cur.x.id !== x.id) cur.tie = true;
    }
    const s365 = bySrc.get("365");
    if (s365 && !s365.tie) var365.push({ m, gid: s365.x.id.slice(4) });
    for (const { x, tie: t } of bySrc.values()) {
      if (t) continue;
      if (!best || tie || x.h + x.a > best.h + best.a) { best = { ev: { id: x.id }, h: x.h, a: x.a }; tie = false; }
    }
    const g = guard.get(m.id);
    if (!best || tie) { if (g) await sb.from("goal_guard").delete().eq("match_id", m.id); continue; }
    matched++;
    if (best.h + best.a <= (m.score_home ?? 0) + (m.score_away ?? 0)) { if (g) await sb.from("goal_guard").delete().eq("match_id", m.id); continue; }
    const same = g && g.espn_home === best.h && g.espn_away === best.a;
    const first = same ? Date.parse(g.first_at) : now;
    if (!same) await sb.from("goal_guard").upsert({ match_id: m.id, espn_id: best.ev.id, espn_home: best.h, espn_away: best.a, first_at: new Date(now).toISOString() });
    if (now - first >= MAX_MS) continue;
    const until = now + LOCK_MS;
    if ((Date.parse(m.suspended_until ?? "") || 0) < until) {
      await sb.from("matches").update({ suspended_until: new Date(until).toISOString(), suspend_reason: "Gol" }).eq("id", m.id);
    }
    locked++;
  }
  // relógio exato do 365Scores + VAR/pênalti/vermelho no 365Scores (aparece lá antes da API-Football): trava enquanto o lance é do minuto atual ou do anterior
  let vars = 0;
  await Promise.all(var365.map(async ({ m, gid }) => {
    const g = (await get(`https://webws.365scores.com/web/game/?appTypeId=5&langId=1&timezoneName=UTC&userCountryId=21&gameId=${gid}`).catch(() => null))?.game;
    const pt = g?.preciseGameTime, min = Number(pt?.minutes ?? g?.gameTime);
    if (!g || !(min > 0) || g.statusGroup !== 3) return;
    const patch: Record<string, unknown> = pt?.autoProgress
      ? { clock_secs: min * 60 + (Number(pt.seconds) || 0), clock_at: new Date().toISOString() }
      : { clock_at: null };
    patch.ext365_id = Number(gid);
    const varMin = Number(String(g.eventChartPenaltiesDetails?.uniqueHashEvent ?? "").match(/^var_.*_(\d+)$/)?.[1]);
    const ev = ((g.events ?? []) as { gameTime: number; addedTime?: number; statusId?: number; eventType?: { name?: string; subTypeName?: string } }[])
      .find((e) => e.statusId === g.statusId && e.gameTime + (e.addedTime ?? 0) >= min - 1 && /red card|penalt|var/i.test(`${e.eventType?.name} ${e.eventType?.subTypeName ?? ""}`));
    const why = varMin >= min - 1 ? "Revisão do VAR" : ev ? (/red/i.test(ev.eventType?.name ?? "") ? "Expulsão" : /var/i.test(ev.eventType?.name ?? "") ? "Revisão do VAR" : "Pênalti") : null;
    const until = Date.now() + LOCK_MS;
    if (why) vars++;
    if (why && (Date.parse(m.suspended_until ?? "") || 0) < until) Object.assign(patch, { suspended_until: new Date(until).toISOString(), suspend_reason: why });
    await sb.from("matches").update(patch).eq("id", m.id);
  }));
  const per = Object.fromEntries(["365", "fm", "lsc"].map((k) => [k, ext.filter((x) => x.id.startsWith(k + ":")).length]));
  return json({ live: live.length, leagues: slugs.length, ext: per, matched, locked, vars });
});
