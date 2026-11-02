// goal-guard — chamado pelo pg_cron a cada 5 s (header x-cron-secret). Publicar com --no-verify-jwt.
// Placar da ESPN como 2ª fonte: se a ESPN já mostra mais gols que o nosso jogo ao vivo, trava apostas e cashout
// até a API-Football confirmar o gol (aí o sync-odds aplica a trava normal). Máx. 3 min por placar, para um
// placar errado ou um jogo trocado na ESPN não travar o mercado para sempre.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/auth.ts";

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
};
const LOCK_MS = 30_000, MAX_MS = 180_000;
const STOP = new Set(["fc", "cf", "sc", "ac", "cd", "ad", "sk", "fk", "if", "bk", "afc", "ud", "rc", "club", "clube", "de", "the",
  "city", "united", "town", "real", "sporting", "athletic", "atletico", "esporte", "futebol", "calcio", "sport"]);
const tokens = (s: string) => new Set(s.replace(/ø/g, "o").replace(/ı/g, "i").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
const hits = (a: Set<string>, b: Set<string>) => [...a].filter((t) => b.has(t)).length;

type Live = { id: number; league: string; home: string; away: string; score_home: number | null; score_away: number | null; suspended_until: string | null };
type Side = { homeAway: string; score?: string; team: { displayName: string; shortDisplayName?: string } };
type Ev = { id: string; status?: { type?: { state?: string } }; competitions?: { competitors?: Side[] }[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Sem permissão" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data } = await sb.from("matches").select("id, league, home, away, score_home, score_away, suspended_until").eq("status", "live");
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
  const { data: gs } = await sb.from("goal_guard").select("match_id, espn_home, espn_away, first_at").in("match_id", live.map((m) => m.id));
  const guard = new Map((gs ?? []).map((g) => [g.match_id as number, g]));

  const now = Date.now();
  let matched = 0, locked = 0;
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
  return json({ live: live.length, leagues: slugs.length, matched, locked });
});
