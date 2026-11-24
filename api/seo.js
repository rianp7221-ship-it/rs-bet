// Páginas de jogos/ligas em HTML puro para o Google (o site principal é SPA e os jogos só aparecem via JS).
// Rotas (vercel.json): /jogos, /apostas/<liga>, /jogo/<times>-<id>, /sitemap.xml
const SB = "https://pscpcxleyysspvwkevpe.supabase.co/rest/v1";
const KEY = "sb_publishable_wZYqk42N5iDD-Mv7emPp0A_UQm8cLNV";
const COLS = "id,sport,league,home,away,starts_at,odd_home,odd_draw,odd_away,status,score_home,score_away,minute";
const COLS_M = COLS + ",markets";
const LEAGUE_PT = { "Brazil Série A": "Brasileirão Série A", "Brazil Série B": "Brasileirão Série B", EPL: "Premier League",
  "UEFA Champions League": "Liga dos Campeões da UEFA", "UEFA Europa League": "Liga Europa da UEFA", "La Liga - Spain": "La Liga",
  "Serie A - Italy": "Serie A Itália", "Saudi Pro League": "Pro League Arábia Saudita" };
const lname = (l) => LEAGUE_PT[l] || l;
// mesma ordem do site (sports.js TOP): ligas mais famosas primeiro
const TOP = ["Brazil Série A", "Brazil Série B", "Copa do Brasil", "CONMEBOL Libertadores", "CONMEBOL Sudamericana",
  "UEFA Champions League", "Premier League", "EPL", "La Liga", "La Liga - Spain", "Serie A - Italy", "Bundesliga", "Ligue 1", "UEFA Europa League",
  "UEFA Conference League", "UEFA Nations League", "Primeira Liga Portugal", "Liga Profesional Argentina", "Copa del Rey", "FA Cup Inglaterra",
  "Championship Inglaterra", "2. Bundesliga Alemanha", "Eredivisie Holanda", "Liga MX México", "MLS EUA", "Saudi Pro League", "Süper Lig Turquia", "NBA", "EuroLeague"];
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
const upcoming = (cols = COLS) => q(`matches?select=${cols}&status=in.(open,live)&starts_at=gte.${new Date(Date.now() - 4 * 3600e3).toISOString()}&order=starts_at&limit=2000`);
const rpc = async (fn) => {
  const r = await fetch(`${SB}/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}" });
  return r.ok ? r.json() : null;
};
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
// probabilidade de cada resultado pelas odds (sem a margem da casa)
function tip(m) {
  const o = [["home", m.home, m.odd_home], ["draw", "Empate", m.odd_draw], ["away", m.away, m.odd_away]].filter((x) => Number(x[2]) > 1);
  if (o.length < 2) return null;
  const inv = o.map((x) => 1 / Number(x[2])), sum = inv.reduce((a, b) => a + b, 0);
  const pr = o.map((x, i) => ({ k: x[0], name: x[1], odd: Number(x[2]), p: Math.round((100 * inv[i]) / sum) })).sort((a, b) => b.p - a.p);
  const f = pr[0];
  const text = f.k === "draw" ? "Empate" : f.p >= 60 ? `Vitória do ${f.name}` : f.p >= 45 ? `${f.name} é favorito` : "Jogo equilibrado";
  return { pr, f, text, level: f.p >= 60 ? "Alta" : f.p >= 45 ? "Média" : "Baixa" };
}
const tipBox = (m) => {
  const t = tip(m);
  if (!t) return "";
  return `<div class="tip"><b>Palpite: ${esc(t.text)}</b> <small>(confiança ${t.level.toLowerCase()})</small>
<div class="pr">${t.pr.map((x) => `<span>${esc(x.name)} <b>${x.p}%</b></span>`).join("")}</div></div>`;
};
// outros mercados: o lado mais provável de cada um, com a chance tirada das odds (sem a margem)
const pct2 = (a, b) => (Number(a) > 1 && Number(b) > 1 ? Math.round((100 / a) / (1 / a + 1 / b)) : null);
const mkLine = (k) => (Number(k.replace(/^[a-z]+/, "")) / 10).toLocaleString("pt-BR");
function extras(m) {
  const mk = m.markets || {}, out = [], t = tip(m);
  const two = (key, title, a, b, na, nb) => {
    const x = mk[key], p = x && pct2(x[a], x[b]);
    if (p == null) return;
    const [k, text, pp] = p >= 50 ? [a, na, p] : [b, nb, 100 - p];
    out.push({ title, text, p: pp, odd: Number(x[k]), code: `${m.id}~${key}.${k}` });
  };
  const mid = (re) => { const ks = Object.keys(mk).filter((k) => re.test(k)).sort((a, b) => a.replace(/\D/g, "") - b.replace(/\D/g, "")); return ks[Math.floor(ks.length / 2)]; };
  if (m.sport === "Futebol") {
    two("ou25", "Gols", "over", "under", "Mais de 2,5 gols", "Menos de 2,5 gols");
    two("btts", "Ambas marcam", "yes", "no", "Sim, os dois marcam", "Não, um não marca");
    if (t && mk.dc) {
      const pr = Object.fromEntries(t.pr.map((x) => [x.k, x.p]));
      const k = t.f.k === "home" ? "1x" : t.f.k === "away" ? "x2" : Number(mk.dc["1x"]) <= Number(mk.dc.x2) ? "1x" : "x2";
      if (Number(mk.dc[k]) > 1) out.push({ title: "Chance dupla", text: `${k === "1x" ? m.home : m.away} ou empate`, p: Math.min(99, (pr[k === "1x" ? "home" : "away"] || 0) + (pr.draw || 0)), odd: Number(mk.dc[k]), code: `${m.id}~dc.${k}` });
    }
    const co = mid(/^co\d+$/);
    if (co) two(co, "Escanteios", "over", "under", `Mais de ${mkLine(co)} escanteios`, `Menos de ${mkLine(co)} escanteios`);
    const cs = Object.entries(mk.cs || {}).filter(([, o]) => Number(o) > 1);
    if (cs.length) {
      const sum = cs.reduce((a, [, o]) => a + 1 / o, 0), [k, o] = cs.sort((a, b) => a[1] - b[1])[0];
      out.push({ title: "Placar provável", text: `${k[1]} x ${k[2]}`, p: Math.round(100 / o / sum), odd: Number(o), code: `${m.id}~cs.${k}` });
    }
  } else {
    const ou = mid(/^ou\d{3,}$/);
    if (ou) two(ou, "Pontos", "over", "under", `Mais de ${mkLine(ou)} pontos`, `Menos de ${mkLine(ou)} pontos`);
  }
  return out;
}
const extrasBox = (m) => {
  const x = extras(m);
  return x.length ? `<div class="mk-h">Mais palpites</div><div class="odds mkg">${x.map((e) => `<a href="/?b=${encodeURIComponent(e.code)}#sports" data-s="${e.code}" rel="nofollow"><small>${esc(e.title)} · ${e.p}%</small><span>${esc(e.text)}</span><b>${odd(e.odd)}</b></a>`).join("")}</div>` : "";
};
// múltipla pronta: a seleção mais provável (odd 1,25–1,80) dos jogos de futebol das ligas mais fortes
function multi(games) {
  const c = [];
  for (const m of games.filter((g) => g.sport === "Futebol").slice(0, 40)) {
    const t = tip(m), opts = extras(m).filter((e) => e.title !== "Placar provável");
    if (t && t.f.k !== "draw") opts.push({ title: "Resultado", text: `Vitória do ${t.f.name}`, p: t.f.p, odd: t.f.odd, code: `${m.id}${t.f.k[0]}` });
    const best = opts.filter((e) => e.odd >= 1.25 && e.odd <= 1.8).sort((a, b) => b.p - a.p)[0];
    if (best) c.push({ m, e: best });
  }
  return c.sort((a, b) => b.e.p - a.e.p).slice(0, 4);
}
const multiBox = (games) => {
  const ms = multi(games);
  if (ms.length < 2) return "";
  const total = ms.reduce((a, x) => a * x.e.odd, 1);
  return `<div class="card hl"><b>Múltipla pronta do dia</b>${ms.map(({ m, e }) => `<div class="ml"><span><a class="t" href="/jogo/${gameSlug(m)}">${esc(m.home)} x ${esc(m.away)}</a><small>${esc(e.text)} · ${e.p}%</small></span><b>${odd(e.odd)}</b></div>`).join("")}
<a class="cta" href="/?b=${encodeURIComponent(ms.map((x) => x.e.code).join(","))}#sports" rel="nofollow">Colocar no bilhete · odd ${odd(total)}</a></div>`;
};
const leagues = (ms) => {
  const by = new Map();
  for (const m of ms) { const k = slug(lname(m.league)); if (!by.has(k)) by.set(k, { name: lname(m.league), raw: m.league, sport: m.sport, games: [] }); by.get(k).games.push(m); }
  const r = (l) => { const i = TOP.indexOf(l.raw); return i < 0 ? 999 : i; };
  return [...by.entries()].sort((a, b) => r(a[1]) - r(b[1]) || (b[1].sport === "Futebol") - (a[1].sport === "Futebol") || b[1].games.length - a[1].games.length);
};

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Roboto,Arial,sans-serif;background:#f4f5f7;color:#1c1f26}
header{background:#ff4d00;padding:14px 18px;display:flex;align-items:center;justify-content:space-between}header a.bk{font-size:14px;font-weight:700;background:rgba(255,255,255,.2);padding:7px 12px;border-radius:8px}header a{color:#fff;font-weight:900;font-size:22px;text-decoration:none;letter-spacing:.5px}
main{max-width:760px;margin:0 auto;padding:16px}h1{font-size:24px;margin:8px 0 4px}h2{font-size:18px;margin:22px 0 8px}
.muted{color:#6b7280;font-size:14px}.card{background:#fff;border-radius:12px;padding:14px 16px;margin:10px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card a.t{color:#1c1f26;text-decoration:none;font-weight:700}.odds{display:flex;gap:8px;margin-top:10px}
.odds a{flex:1;text-align:center;background:#fff4ee;border:1px solid #ffd2bd;border-radius:8px;padding:8px 4px;color:#1c1f26;text-decoration:none}
.odds small{display:block;color:#6b7280;font-size:12px}.odds b{color:#ff4d00;font-size:17px}.odds a.on{background:#ff4d00;border-color:#ff4d00}.odds a.on small,.odds a.on b{color:#fff}
#slipbar{position:fixed;left:12px;right:12px;bottom:12px;max-width:756px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#1fa055;color:#fff;border-radius:12px;padding:14px 16px;font-weight:700;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.25)}#slipbar[hidden]{display:none}body.has-slip{padding-bottom:80px}
.cta{display:block;text-align:center;background:#ff4d00;color:#fff;font-weight:700;padding:14px;border-radius:10px;text-decoration:none;margin:16px 0}
.live{color:#e11d48;font-weight:700}.lg a{display:inline-block;margin:4px 6px 4px 0;padding:6px 10px;background:#fff;border-radius:16px;color:#1c1f26;text-decoration:none;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.tip{margin-top:10px;padding:10px 12px;background:#f7f8fa;border-left:4px solid #ff4d00;border-radius:8px;font-size:14px}
.tip small{color:#6b7280}.pr{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;color:#6b7280;font-size:13px}.pr b{color:#1c1f26}
.hl{background:#fff4ee;border:1px solid #ffd2bd}.mk-h{margin-top:12px;font-size:13px;font-weight:700;color:#6b7280}.odds.mkg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}.mkg a span{display:block;font-size:14px;font-weight:600;margin:2px 0}.odds a.on span{color:#fff}.ml{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #ffd2bd}.ml small{display:block;color:#6b7280;font-size:13px}.ml b{color:#ff4d00;font-size:17px}.hl .cta{margin:12px 0 0}.disc{font-size:12px;color:#6b7280}
footer{max-width:760px;margin:20px auto;padding:0 16px 30px;color:#6b7280;font-size:13px}nav.bc{font-size:13px}nav.bc a{color:#ff4d00}`;

function page({ title, desc, canon, body, ld, noindex }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canon)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}<meta name="theme-color" content="#ff4d00">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canon)}"><meta property="og:site_name" content="Real Sports"><meta property="og:image" content="${esc(new URL("/icons/apple-touch-icon.png", canon).href)}">
<link rel="icon" type="image/png" href="/icons/favicon.png"><style>${CSS}</style>
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><header><a href="/">REAL SPORTS</a><a class="bk" href="/">‹ Voltar ao site</a></header><main>${body}</main>
<a id="slipbar" href="/#sports" hidden><span id="sb-t"></span><span>Apostar ›</span></a>
<script>(function(){var K="rs-slip",g=function(){try{return (sessionStorage.getItem(K)||"").split(",").filter(Boolean)}catch(e){return []}},id=function(c){return c.match(/^[0-9]+/)[0]};
function paint(){var s=g(),b=document.getElementById("slipbar");document.querySelectorAll(".odds a[data-s]").forEach(function(a){a.classList.toggle("on",s.indexOf(a.dataset.s)>=0)});
b.hidden=!s.length;document.body.classList.toggle("has-slip",!!s.length);b.href="/?b="+encodeURIComponent(s.join(","))+"#sports";document.getElementById("sb-t").textContent="Bilhete: "+s.length+(s.length>1?" jogos":" jogo")}
document.addEventListener("click",function(e){var a=e.target.closest(".odds a[data-s]");if(!a)return;e.preventDefault();var c=a.dataset.s,s=g(),on=s.indexOf(c)>=0;
s=s.filter(function(x){return id(x)!==id(c)});if(!on)s.push(c);try{sessionStorage.setItem(K,s.join(","))}catch(e){location.href=a.href;return}paint()});paint()})();</script>
<footer><p><a href="/jogos">Todos os jogos</a> · <a href="/palpites">Palpites de hoje</a> · <a href="/login.html">Cadastre-se</a></p><p><b>+18</b> Jogue com responsabilidade. Apostas envolvem risco de perda financeira. Proibido para menores de 18 anos.</p></footer></body></html>`;
}

const oddsRow = (m) => `<div class="odds">
<a href="/?b=${m.id}h#sports" data-s="${m.id}h" rel="nofollow"><small>${esc(m.home)}</small><b>${odd(m.odd_home)}</b></a>
${m.odd_draw ? `<a href="/?b=${m.id}d#sports" data-s="${m.id}d" rel="nofollow"><small>Empate</small><b>${odd(m.odd_draw)}</b></a>` : ""}
<a href="/?b=${m.id}a#sports" data-s="${m.id}a" rel="nofollow"><small>${esc(m.away)}</small><b>${odd(m.odd_away)}</b></a></div>`;
const gameCard = (m) => `<div class="card"><a class="t" href="/jogo/${gameSlug(m)}">${esc(m.home)} x ${esc(m.away)}</a>
<div class="muted">${m.status === "live" ? `<span class="live">AO VIVO</span> ${m.score_home ?? 0}–${m.score_away ?? 0}` : esc(when(m.starts_at))} · ${esc(lname(m.league))}</div>${oddsRow(m)}</div>`;

async function gamePage(base, s) {
  const id = Number((s.match(/-(\d+)$/) || s.match(/^(\d+)$/) || [])[1]);
  const [m] = id ? await q(`matches?select=${COLS_M}&id=eq.${id}`) : [];
  if (!m) return null;
  const canon = `${base}/jogo/${gameSlug(m)}`, lg = lname(m.league), open = m.status === "open" || m.status === "live";
  const name = `${m.home} x ${m.away}`;
  const ld = { "@context": "https://schema.org", "@type": "SportsEvent", name, sport: m.sport, startDate: m.starts_at,
    eventStatus: "https://schema.org/EventScheduled", homeTeam: { "@type": "SportsTeam", name: m.home }, awayTeam: { "@type": "SportsTeam", name: m.away },
    // sem superEvent: o Google lia o campeonato como outro evento sem startDate/location
    endDate: new Date(Date.parse(m.starts_at) + (/basq/i.test(m.sport ?? "") ? 2.5 : 2) * 3600e3).toISOString(),
    description: `${name} pela ${lg}: odds e palpites na Real Sports.`, image: new URL("/icons/icon-512.png", canon).href,
    performer: [{ "@type": "SportsTeam", name: m.home }, { "@type": "SportsTeam", name: m.away }],
    organizer: { "@type": "SportsOrganization", name: lg, url: canon },
    location: { "@type": "Place", name: lg, address: lg } };
  const body = `<nav class="bc"><a href="/jogos">Jogos</a> › <a href="/apostas/${slug(lg)}">${esc(lg)}</a></nav>
<h1>${esc(name)}: palpites e odds</h1><p class="muted">${esc(lg)} · ${esc(when(m.starts_at))}${m.status === "live" ? ` · <span class="live">AO VIVO ${m.score_home ?? 0}–${m.score_away ?? 0}${m.minute ? ` (${esc(m.minute)}')` : ""}</span>` : ""}</p>
${open ? `<div class="card"><b>Resultado final</b>${oddsRow(m)}${tipBox(m)}${extrasBox(m)}</div>
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

const tipCard = (m) => `<div class="card"><a class="t" href="/jogo/${gameSlug(m)}">${esc(m.home)} x ${esc(m.away)}</a>
<div class="muted">${m.status === "live" ? `<span class="live">AO VIVO</span> ${m.score_home ?? 0}–${m.score_away ?? 0}` : esc(when(m.starts_at))} · ${esc(lname(m.league))}</div>${tipBox(m)}${oddsRow(m)}${extrasBox(m)}</div>`;

// /palpites (hoje), /palpites/amanha e /palpites/<liga>
async function tipsPage(base, s) {
  const all = (await upcoming(COLS_M)).filter((m) => m.status === "open" && tip(m));
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));
  let games, h1, title, desc, canon, sub = "";
  if (!s || s === "amanha") {
    const d = s ? tomorrow : today, label = s ? "amanhã" : "hoje";
    games = all.filter((m) => ymd(new Date(m.starts_at)) === d);
    const ls = leagues(games);
    // jogos das ligas mais fortes primeiro
    games = ls.flatMap(([, l]) => l.games);
    h1 = `Palpites de ${label} (${day(d + "T12:00:00-03:00")})`;
    title = `Palpites de ${label}: futebol e basquete, ${day(d + "T12:00:00-03:00")} | Real Sports`;
    desc = `Palpites de ${label} com as probabilidades de cada resultado: ${games.slice(0, 3).map((m) => `${m.home} x ${m.away}`).join(", ")} e mais ${Math.max(games.length - 3, 0)} jogos.`;
    canon = `${base}/palpites${s ? "/amanha" : ""}`;
    sub = `<div class="lg">${s ? `<a href="/palpites">Palpites de hoje</a>` : `<a href="/palpites/amanha">Palpites de amanhã</a>`}${ls.slice(0, 15).map(([k, l]) => `<a href="/palpites/${k}">${esc(l.name)}</a>`).join("")}</div>`;
    if (!s) {
      const [pick, boost] = await Promise.all([rpc("top_pick_today").catch(() => null), rpc("boost_today").catch(() => null)]);
      const pn = (x) => (x.pick === "h" || x.pick === "home" ? x.home : x.pick === "a" || x.pick === "away" ? x.away : x.pick === "d" || x.pick === "draw" ? "Empate" : x.pick);
      if (boost && boost.match) sub += `<div class="card hl"><b>Odd turbinada do dia</b><p><a class="t" href="/?jogo=${boost.match}#sports">${esc(boost.home)} x ${esc(boost.away)}</a>: ${esc(pn(boost))} de <s>${odd(boost.base)}</s> por <b>${odd(boost.odd)}</b></p></div>`;
      sub = multiBox(games) + sub;
      if (pick && pick.match) sub += `<div class="card hl"><b>Mais apostado na Real Sports hoje</b><p><a class="t" href="/?jogo=${pick.match}#sports">${esc(pick.home)} x ${esc(pick.away)}</a>: ${pick.pct}% dos apostadores foram de ${esc(pn(pick))} (odd ${odd(pick.odd)})</p></div>`;
    }
  } else {
    const lg = leagues(all).find(([k]) => k === s);
    if (!lg) return null;
    games = lg[1].games;
    h1 = `Palpites ${lg[1].name}`;
    title = `Palpites ${lg[1].name}: próximos jogos e probabilidades | Real Sports`;
    desc = `Palpites para os jogos da ${lg[1].name}: ${games.slice(0, 3).map((m) => `${m.home} x ${m.away}`).join(", ")}. Probabilidades calculadas pelas odds.`;
    canon = `${base}/palpites/${s}`;
    sub = `<nav class="bc"><a href="/palpites">Palpites de hoje</a> › ${esc(lg[1].name)}</nav>`;
  }
  const ld = { "@context": "https://schema.org", "@type": "ItemList", name: h1, itemListElement: games.slice(0, 50).map((m, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/jogo/${gameSlug(m)}`, name: `${m.home} x ${m.away}` })) };
  const body = `<h1>${esc(h1)}</h1><p class="muted">${games.length} jogo${games.length === 1 ? "" : "s"} · probabilidades calculadas pelas odds atuais, sem a margem da casa</p>${sub}
${games.length ? games.slice(0, 80).map(tipCard).join("") : `<div class="card">Nenhum jogo com odds abertas agora. <a href="/palpites${s ? "" : "/amanha"}">Veja os palpites de ${s ? "hoje" : "amanhã"}</a>.</div>`}
<a class="cta" href="/#sports">Apostar na Real Sports</a>
<p class="disc">Palpites são estimativas baseadas nas odds e não garantem resultado. Aposte só o que pode perder.</p>`;
  return page({ title, desc, canon, body, ld, noindex: !games.length });
}

async function indexPage(base) {
  const ls = leagues(await upcoming());
  const body = `<h1>Jogos de hoje e próximos: odds e apostas</h1><p class="muted">Futebol, basquete e mais, com odds atualizadas. <a href="/palpites">Ver palpites de hoje</a></p>
<div class="lg">${ls.map(([k, l]) => `<a href="/apostas/${k}">${esc(l.name)} (${l.games.length})</a>`).join("")}</div>
${ls.slice(0, 12).map(([k, l]) => `<h2><a href="/apostas/${k}" style="color:inherit">${esc(l.name)}</a></h2>${l.games.slice(0, 6).map(gameCard).join("")}`).join("")}`;
  return page({ title: "Jogos de hoje: odds e apostas esportivas | Real Sports", desc: "Veja os jogos de hoje e dos próximos dias com as odds da Real Sports: Brasileirão, Champions, NBA e muito mais.", canon: `${base}/jogos`, body });
}

async function sitemap(base) {
  const ms = await upcoming(), ls = leagues(ms);
  const u = (loc, pri) => `<url><loc>${esc(base + loc)}</loc><changefreq>hourly</changefreq><priority>${pri}</priority></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u("/", "1.0")}${u("/jogos", "0.9")}${u("/palpites", "0.9")}${u("/palpites/amanha", "0.8")}${ls.map(([k]) => u(`/palpites/${k}`, "0.7")).join("")}${ls.map(([k]) => u(`/apostas/${k}`, "0.8")).join("")}${ms.map((m) => u(`/jogo/${gameSlug(m)}`, "0.6")).join("")}</urlset>`;
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
    const html = p === "jogo" ? await gamePage(base, s) : p === "liga" ? await leaguePage(base, s) : p === "palpites" ? await tipsPage(base, s) : await indexPage(base);
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
