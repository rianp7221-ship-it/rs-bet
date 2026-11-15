// Páginas de jogos/ligas em HTML puro para o Google (o site principal é SPA e os jogos só aparecem via JS).
// Rotas (vercel.json): /jogos, /apostas/<liga>, /jogo/<times>-<id>, /sitemap.xml
const SB = "https://pscpcxleyysspvwkevpe.supabase.co/rest/v1";
const KEY = "sb_publishable_wZYqk42N5iDD-Mv7emPp0A_UQm8cLNV";
const COLS = "id,sport,league,home,away,starts_at,odd_home,odd_draw,odd_away,status,score_home,score_away,minute";
const LEAGUE_PT = { "Brazil Série A": "Brasileirão Série A", "Brazil Série B": "Brasileirão Série B", EPL: "Premier League",
  "UEFA Champions League": "Liga dos Campeões da UEFA", "UEFA Europa League": "Liga Europa da UEFA", "La Liga - Spain": "La Liga",
  "Serie A - Italy": "Serie A Itália", "Saudi Pro League": "Pro League Arábia Saudita" };
const lname = (l) => LEAGUE_PT[l] || l;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const gameSlug = (m) => `${slug(m.home)}-x-${slug(m.away)}-${m.id}`;
const odd = (v) => (v ? Number(v).toFixed(2) : "—");
const when = (iso) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const day = (iso) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long" }).format(new Date(iso));

async function q(path) {
  const r = await fetch(`${SB}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
}
// jogos abertos/ao vivo que ainda fazem sentido (ignora "abertos" que começaram há mais de 4h)
const upcoming = () => q(`matches?select=${COLS}&status=in.(open,live)&starts_at=gte.${new Date(Date.now() - 4 * 3600e3).toISOString()}&order=starts_at&limit=2000`);
const leagues = (ms) => {
  const by = new Map();
  for (const m of ms) { const k = slug(lname(m.league)); if (!by.has(k)) by.set(k, { name: lname(m.league), sport: m.sport, games: [] }); by.get(k).games.push(m); }
  return [...by.entries()].sort((a, b) => (b[1].sport === "Futebol") - (a[1].sport === "Futebol") || b[1].games.length - a[1].games.length);
};

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Roboto,Arial,sans-serif;background:#f4f5f7;color:#1c1f26}
header{background:#ff4d00;padding:14px 18px}header a{color:#fff;font-weight:900;font-size:22px;text-decoration:none;letter-spacing:.5px}
main{max-width:760px;margin:0 auto;padding:16px}h1{font-size:24px;margin:8px 0 4px}h2{font-size:18px;margin:22px 0 8px}
.muted{color:#6b7280;font-size:14px}.card{background:#fff;border-radius:12px;padding:14px 16px;margin:10px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card a.t{color:#1c1f26;text-decoration:none;font-weight:700}.odds{display:flex;gap:8px;margin-top:10px}
.odds a{flex:1;text-align:center;background:#fff4ee;border:1px solid #ffd2bd;border-radius:8px;padding:8px 4px;color:#1c1f26;text-decoration:none}
.odds small{display:block;color:#6b7280;font-size:12px}.odds b{color:#ff4d00;font-size:17px}
.cta{display:block;text-align:center;background:#ff4d00;color:#fff;font-weight:700;padding:14px;border-radius:10px;text-decoration:none;margin:16px 0}
.live{color:#e11d48;font-weight:700}.lg a{display:inline-block;margin:4px 6px 4px 0;padding:6px 10px;background:#fff;border-radius:16px;color:#1c1f26;text-decoration:none;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
footer{max-width:760px;margin:20px auto;padding:0 16px 30px;color:#6b7280;font-size:13px}nav.bc{font-size:13px}nav.bc a{color:#ff4d00}`;

function page({ title, desc, canon, body, ld, noindex }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canon)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}<meta name="theme-color" content="#ff4d00">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}"><meta property="og:site_name" content="Real Sports"><meta property="og:image" content="${esc(new URL("/icons/apple-touch-icon.png", canon).href)}">
<link rel="icon" type="image/png" href="/icons/favicon.png"><style>${CSS}</style>
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><header><a href="/">REAL SPORTS</a></header><main>${body}</main>
<footer><p><a href="/jogos">Todos os jogos</a> · <a href="/login.html">Cadastre-se</a></p><p><b>+18</b> Jogue com responsabilidade. Apostas envolvem risco de perda financeira. Proibido para menores de 18 anos.</p></footer></body></html>`;
}

const oddsRow = (m) => `<div class="odds">
<a href="/?b=${m.id}h#sports" rel="nofollow"><small>${esc(m.home)}</small><b>${odd(m.odd_home)}</b></a>
${m.odd_draw ? `<a href="/?b=${m.id}d#sports" rel="nofollow"><small>Empate</small><b>${odd(m.odd_draw)}</b></a>` : ""}
<a href="/?b=${m.id}a#sports" rel="nofollow"><small>${esc(m.away)}</small><b>${odd(m.odd_away)}</b></a></div>`;
const gameCard = (m) => `<div class="card"><a class="t" href="/jogo/${gameSlug(m)}">${esc(m.home)} x ${esc(m.away)}</a>
<div class="muted">${m.status === "live" ? `<span class="live">AO VIVO</span> ${m.score_home ?? 0}–${m.score_away ?? 0}` : esc(when(m.starts_at))} · ${esc(lname(m.league))}</div>${oddsRow(m)}</div>`;

async function gamePage(base, s) {
  const id = Number((s.match(/-(\d+)$/) || s.match(/^(\d+)$/) || [])[1]);
  const [m] = id ? await q(`matches?select=${COLS}&id=eq.${id}`) : [];
  if (!m) return null;
  const canon = `${base}/jogo/${gameSlug(m)}`, lg = lname(m.league), open = m.status === "open" || m.status === "live";
  const name = `${m.home} x ${m.away}`;
  const ld = { "@context": "https://schema.org", "@type": "SportsEvent", name, sport: m.sport, startDate: m.starts_at,
    eventStatus: "https://schema.org/EventScheduled", homeTeam: { "@type": "SportsTeam", name: m.home }, awayTeam: { "@type": "SportsTeam", name: m.away },
    location: { "@type": "Place", name: lg }, superEvent: { "@type": "SportsEvent", name: lg } };
  const body = `<nav class="bc"><a href="/jogos">Jogos</a> › <a href="/apostas/${slug(lg)}">${esc(lg)}</a></nav>
<h1>${esc(name)}: palpites e odds</h1><p class="muted">${esc(lg)} · ${esc(when(m.starts_at))}${m.status === "live" ? ` · <span class="live">AO VIVO ${m.score_home ?? 0}–${m.score_away ?? 0}${m.minute ? ` (${esc(m.minute)}')` : ""}</span>` : ""}</p>
${open ? `<div class="card"><b>Resultado final</b>${oddsRow(m)}</div>
<a class="cta" href="/?jogo=${m.id}#sports">Ver todos os mercados e apostar</a>
<p>Veja as odds de <b>${esc(name)}</b> pela ${esc(lg)} em ${esc(day(m.starts_at))}. Na Real Sports você aposta no resultado final, ambas marcam, total de gols e muito mais${m.status === "live" ? ", também ao vivo" : ""}. As odds podem mudar até o início da partida.</p>`
    : `<div class="card"><b>Jogo encerrado</b>${m.score_home != null ? `<p>Placar final: ${esc(m.home)} ${m.score_home} x ${m.score_away} ${esc(m.away)}</p>` : ""}</div>
<a class="cta" href="/apostas/${slug(lg)}">Ver próximos jogos da ${esc(lg)}</a>`}
<p><a href="/login.html">Crie sua conta</a> em poucos minutos e aposte com PIX.</p>`;
  return page({ title: `${name} — odds e palpites (${day(m.starts_at)}) | Real Sports`, desc: `Odds de ${name} pela ${lg}, ${when(m.starts_at)}: ${m.home} ${odd(m.odd_home)}${m.odd_draw ? `, empate ${odd(m.odd_draw)}` : ""}, ${m.away} ${odd(m.odd_away)}. Aposte na Real Sports.`,
    canon, body, ld, noindex: !open });
}

async function leaguePage(base, s) {
  const lg = leagues(await upcoming()).find(([k]) => k === s);
  if (!lg) return null;
  const { name, games } = lg[1];
  const body = `<nav class="bc"><a href="/jogos">Jogos</a> › ${esc(name)}</nav><h1>Apostas ${esc(name)}: jogos e odds</h1>
<p class="muted">${games.length} jogo${games.length > 1 ? "s" : ""} com odds abertas</p>${games.map(gameCard).join("")}<a class="cta" href="/#sports">Apostar na Real Sports</a>`;
  return page({ title: `Apostas ${name}: odds dos próximos jogos | Real Sports`, desc: `Odds de todos os jogos da ${name}: ${games.slice(0, 3).map((m) => `${m.home} x ${m.away}`).join(", ")} e mais. Aposte na Real Sports.`,
    canon: `${base}/apostas/${s}`, body });
}

async function indexPage(base) {
  const ls = leagues(await upcoming());
  const body = `<h1>Jogos de hoje e próximos: odds e apostas</h1><p class="muted">Futebol, basquete e mais, com odds atualizadas.</p>
<div class="lg">${ls.map(([k, l]) => `<a href="/apostas/${k}">${esc(l.name)} (${l.games.length})</a>`).join("")}</div>
${ls.slice(0, 12).map(([k, l]) => `<h2><a href="/apostas/${k}" style="color:inherit">${esc(l.name)}</a></h2>${l.games.slice(0, 6).map(gameCard).join("")}`).join("")}`;
  return page({ title: "Jogos de hoje: odds e apostas esportivas | Real Sports", desc: "Veja os jogos de hoje e dos próximos dias com as odds da Real Sports: Brasileirão, Champions, NBA e muito mais.", canon: `${base}/jogos`, body });
}

async function sitemap(base) {
  const ms = await upcoming(), ls = leagues(ms);
  const u = (loc, pri) => `<url><loc>${esc(base + loc)}</loc><changefreq>hourly</changefreq><priority>${pri}</priority></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u("/", "1.0")}${u("/jogos", "0.9")}${ls.map(([k]) => u(`/apostas/${k}`, "0.8")).join("")}${ms.map((m) => u(`/jogo/${gameSlug(m)}`, "0.6")).join("")}</urlset>`;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x"), p = url.searchParams.get("p"), s = slug(url.searchParams.get("s") || "");
  const base = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  try {
    if (p === "sitemap") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
      return res.end(await sitemap(base));
    }
    const html = p === "jogo" ? await gamePage(base, s) : p === "liga" ? await leaguePage(base, s) : await indexPage(base);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (!html) {
      res.statusCode = 404;
      res.setHeader("Cache-Control", "public, s-maxage=600");
      return res.end(page({ title: "Jogo não encontrado | Real Sports", desc: "", canon: `${base}/jogos`, noindex: true,
        body: `<h1>Jogo não encontrado</h1><p>Esse jogo não está mais disponível.</p><a class="cta" href="/jogos">Ver jogos com odds abertas</a>` }));
    }
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.end(html);
  } catch (e) {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.end("Indisponível, tente de novo em instantes.");
  }
};
