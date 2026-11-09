// team-art — chamado pelo pg_cron a cada 2 minutos (header x-cron-secret).
// Busca no TheSportsDB a foto dos times dos próximos jogos (fanart do time ou, se não tiver, recorte de jogador do elenco)
// e guarda em team_art, que o card grande da home lê. O TheSportsDB (chave grátis) limita os pedidos por IP,
// por isso cada rodada faz poucos pedidos, com intervalo, e para no primeiro bloqueio.
// Publicar com --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "../_shared/auth.ts";

const SPORT: Record<string, string> = { futebol: "Soccer", basquete: "Basketball" };
const TTL_MS = 7 * 864e5, GAP_MS = 2200, MAX_REQ = 14;
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = (s: string) => plain(s).toLowerCase().replace(/\s+/g, " ").trim();
// nomes do API-Football que o TheSportsDB conhece por outro nome
const ALIAS: Record<string, string> = {
  "atletico-mg": "Atletico Mineiro", "atletico mg": "Atletico Mineiro", "cruzeiro mg": "Cruzeiro",
  "atletico-pr": "Athletico Paranaense", "athletico-pr": "Athletico Paranaense", "atletico paranaense": "Athletico Paranaense",
  "atletico-go": "Atletico Goianiense", "atletico go": "Atletico Goianiense", "botafogo fr": "Botafogo", "se palmeiras": "Palmeiras",
  "fortaleza ec": "Fortaleza", "bragantino": "Red Bull Bragantino", "paris st-g": "Paris SG", "paris saint germain": "Paris SG",
  "bayern munchen": "Bayern Munich", "inter": "Inter Milan", "turkiye": "Turkey", "czechia": "Czech Republic",
  "fyr macedonia": "North Macedonia", "rep. of ireland": "Republic of Ireland", "bosnia & herzegovina": "Bosnia and Herzegovina",
  "guadalajara chivas": "Guadalajara",
};

// times que podem ir para o card grande (sports.js featPick) vêm primeiro na fila
const BIG = /libertadores|champions|s[eé]rie a|copa do brasil|premier|epl|la liga|bundesliga|ligue 1|sudamericana|europa league|nations league|copa del rey|fa cup|argentina|portugal|saudi|mls|liga mx|nba|world cup|copa do mundo|eliminat|qualif|copa am[eé]rica/i;
const FAMOUS = /flamengo|palmeiras|corinthians|sao paulo|santos|gremio|internacional|cruzeiro|atletico|botafogo|fluminense|vasco|bahia|fortaleza|real madrid|barcelona|manchester|liverpool|arsenal|chelsea|tottenham|bayern|dortmund|paris|psg|juventus|inter|milan|napoli|roma|benfica|porto|sporting|boca|river|chivas|guadalajara|america|nacional|penarol|brazil|brasil|argentina|france|spain|england|germany|portugal|italy|netherlands|belgium|croatia|uruguay/i;

class Limited extends Error {}
let last = 0, used = 0, block = "";
async function tsdb(path: string) {
  if (used >= MAX_REQ) throw new Limited();
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); used++;
  const r = await fetch("https://www.thesportsdb.com/api/v1/json/123/" + path);
  const t = r.ok ? await r.text() : "";
  if (!t.startsWith("{")) { block = `${r.status} ${t.slice(0, 80)}`; throw new Limited(); }
  return JSON.parse(t);
}

function names(name: string) {
  const n = norm(name);
  const out = [ALIAS[n], name, name.replace(/-(sc|sp|rj|rs|pr|mg|ba|pe|ce|go|df|ec)$/i, ""),
    plain(name).split(/\s+/).filter((w) => !/^(\d+\.?|[A-Z]{2,3})$/.test(w)).join(" ")];
  return [...new Set(out.filter((x): x is string => !!x && !!x.trim()))];
}

async function lookup(name: string, sport: string): Promise<{ id: string | null; urls: string[] }> {
  let team: any = null;
  for (const q of names(name)) {
    const list = ((await tsdb("searchteams.php?t=" + encodeURIComponent(q))).teams || []).filter((t: any) => t.strSport === sport);
    team = list.find((t: any) => norm(t.strTeam) === norm(q)) || list[0];
    if (team) break;
  }
  if (!team) return { id: null, urls: [] };
  const fan = [1, 2, 3, 4].map((i) => team["strFanart" + i]).filter(Boolean).map((x: string) => x + "/medium");
  if (fan.length) return { id: team.idTeam, urls: fan };
  const players = (await tsdb("lookup_all_players.php?id=" + team.idTeam)).player || [];
  return { id: team.idTeam, urls: players.filter((p: any) => p.strCutout && !/manager|coach/i.test(p.strPosition || ""))
    .map((p: any) => "p:" + p.strCutout + "/medium") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Sem permissão" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  last = 0; used = 0; block = "";

  const { data: games } = await sb.from("matches").select("sport,league,home,away,starts_at").eq("status", "open")
    .lt("starts_at", new Date(Date.now() + 8 * 864e5).toISOString()).order("starts_at").limit(500);
  const want = new Map<string, { name: string; sport: string; pri: number }>();
  for (const g of games ?? []) {
    const key = String(g.sport).normalize("NFD").replace(/[^\w]/g, "").toLowerCase();
    if (!SPORT[key]) continue;
    for (const name of [g.home, g.away]) {
      const k = key + ":" + name, pri = (FAMOUS.test(plain(name)) ? 2 : 0) + (BIG.test(g.league ?? "") ? 1 : 0);
      if (name && (!want.has(k) || want.get(k)!.pri < pri)) want.set(k, { name, sport: SPORT[key], pri });
    }
  }
  const keys = [...want.keys()], have = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await sb.from("team_art").select("key,checked_at").in("key", keys.slice(i, i + 200));
    for (const r of data ?? []) have.set(r.key, Date.parse(r.checked_at));
  }
  const todo = keys.filter((k) => !have.has(k) || Date.now() - have.get(k)! > TTL_MS)
    .sort((a, b) => want.get(b)!.pri - want.get(a)!.pri);

  const done: string[] = [];
  let limited = false;
  for (const k of todo) {
    try {
      const { id, urls } = await lookup(want.get(k)!.name, want.get(k)!.sport);
      await sb.from("team_art").upsert({ key: k, urls, team_id: id, checked_at: new Date().toISOString() });
      done.push(`${k} (${urls.length})`);
    } catch (e) {
      if (e instanceof Limited) { limited = used < MAX_REQ; break; }
      throw e;
    }
  }
  return json({ todo: todo.length, done, limited, block, requests: used });
});
