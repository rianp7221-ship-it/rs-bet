// =====================================================
//  sports.js — jogos, filtros, favoritos e bilhete de apostas
// =====================================================
(() => {
  const list = RS.$("#matches"), slipEl = RS.$("#slip"), box = RS.$("#slip-box");
  if (!list) return;
  // texto do botão enquanto uma aposta está em andamento; impede um segundo pedido
  // quando a lista é redesenhada durante a espera do ao vivo
  let placing = "";
  const PICK = { home: "1", draw: "X", away: "2" };
  const CODE = { home: "h", draw: "d", away: "a" }, UNCODE = { h: "home", d: "draw", a: "away" };
  const MK = {
    dc: ["Chance Dupla", { "1x": "1X", x2: "X2", "12": "12" }],
    ou25: ["Total de Gols 2,5", { over: "Mais de 2,5", under: "Menos de 2,5" }],
    ou05: ["Total de Gols 0,5", { over: "Mais de 0,5", under: "Menos de 0,5" }],
    ou45: ["Total de Gols 4,5", { over: "Mais de 4,5", under: "Menos de 4,5" }],
    ou55: ["Total de Gols 5,5", { over: "Mais de 5,5", under: "Menos de 5,5" }],
    btts: ["Ambas Marcam", { yes: "Sim", no: "Não" }],
    btts1: ["Ambas Marcam 1º Tempo", { yes: "Sim", no: "Não" }],
    btts2: ["Ambas Marcam 2º Tempo", { yes: "Sim", no: "Não" }],
    ht1x2: ["Resultado 1º Tempo", { home: "1", draw: "X", away: "2" }],
    dnb: ["Empate Anula", { home: "1", away: "2" }],
    ou15: ["Total de Gols 1,5", { over: "Mais de 1,5", under: "Menos de 1,5" }],
    ou35: ["Total de Gols 3,5", { over: "Mais de 3,5", under: "Menos de 3,5" }],
    c1x2: ["Escanteios 1X2", { home: "1", draw: "X", away: "2" }],
    s1x2: ["Chutes 1X2", { home: "1", draw: "X", away: "2" }],
    t1x2: ["Chutes no Gol 1X2", { home: "1", draw: "X", away: "2" }],
    eg: ["Gols Exatos", Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((n) => ["g" + n, `Exatamente ${n} ${n === 1 ? "gol" : "gols"}`]))],
    cs: ["Placar Exato", Object.fromEntries([0, 1, 2, 3, 4, 5, 6].flatMap((h) => [0, 1, 2, 3, 4, 5, 6].map((a) => [`s${h}${a}`, `${h} - ${a}`])))],
  };
  const coKeys = (m) => Object.keys(m?.markets || {}).filter((k) => /^co\d+$/.test(k)).sort((a, b) => a.slice(2) - b.slice(2));
  const coLine = (k) => (Number(k.slice(2)) / 10).toLocaleString("pt-BR");
  const PX = { hto: "Gols 1º Tempo", gh: "Gols Casa", ga: "Gols Fora", ch: "Escanteios Casa", ca: "Escanteios Fora", kh: "Cartões Casa", ka: "Cartões Fora", sh: "Chutes Casa", sa: "Chutes Fora" };
  const pxKeys = (m, p) => Object.keys(m?.markets || {}).filter((k) => k.startsWith(p) && /^\d+$/.test(k.slice(p.length))).sort((a, b) => a.slice(p.length) - b.slice(p.length));
  const pxLine = (k) => (Number(k.replace(/^[a-z]+/, "")) / 10).toLocaleString("pt-BR");
  const pxRows = (p) => (m) => pxKeys(m, p).map((k) => [[k, "over", mkDef(k)[1].over], [k, "under", mkDef(k)[1].under]]);
  const kKeys = (m) => Object.keys(m?.markets || {}).filter((k) => /^k\d+$/.test(k)).sort((a, b) => a.slice(1) - b.slice(1));
  const kLine = (k) => (Number(k.slice(1)) / 10).toLocaleString("pt-BR");
  const mkDef = (k) => MK[k] || (/^co\d+$/.test(k) ? [`Escanteios ${coLine(k)}`, { over: `Mais de ${coLine(k)}`, under: `Menos de ${coLine(k)}` }]
    : /^k\d+$/.test(k) ? [`Cartões ${kLine(k)}`, { over: `Mais de ${kLine(k)}`, under: `Menos de ${kLine(k)}` }]
    : PX[k.replace(/\d+$/, "")] && /\d$/.test(k) ? [`${PX[k.replace(/\d+$/, "")]} ${pxLine(k)}`, { over: `Mais de ${pxLine(k)}`, under: `Menos de ${pxLine(k)}` }]
    : /^[st]\d+$/.test(k) ? [`${k[0] === "s" ? "Chutes" : "Chutes no Gol"} ${kLine(k)}`, { over: `Mais de ${kLine(k)}`, under: `Menos de ${kLine(k)}` }] : [k, {}]);
  const stKeys = (m, p) => Object.keys(m?.markets || {}).filter((k) => k[0] === p && /^[st]\d+$/.test(k)).sort((a, b) => a.slice(1) - b.slice(1));
  const oddOf = (m, mk, pick) => mk === "bb" ? bbOdd(m, pick) : Number(mk === "1x2" ? m?.["odd_" + pick] : m?.markets?.[mk]?.[pick]) || 0;
  // Criar Aposta: mesmo modelo de Poisson do servidor (_bb_odd); o servidor recalcula a odd ao apostar
  // pernas de gols: Poisson do placar; escanteios/cartões/chutes: odd justa do próprio mercado, 1 perna por grupo
  const GOAL_RE = /^(1x2|dc|btts|btts1|btts2|ht1x2|eg|cs|ou\d+|hto\d+|gh\d+|ga\d+)$/, HALF_RE = /^(ht1x2|btts1|btts2|hto\d+)$/, BB_MAX = 13;
  const bbFam = (mk) => /^(c1x2|co\d+|ch\d+|ca\d+)$/.test(mk) ? "c" : /^(k\d+|kh\d+|ka\d+)$/.test(mk) ? "k" : /^(s1x2|t1x2|[st]\d+|sh\d+|sa\d+)$/.test(mk) ? "s" : null;
  const bbOk = (mk) => GOAL_RE.test(mk) || !!bbFam(mk);
  let bbMargin = 10;
  sb.rpc("bb_params").then(({ data }) => { if (data?.margin != null) bbMargin = Number(data.margin); });
  const legsOf = (s) => (s ? (s.market === "bb" ? s.pick.split("|").map((l) => l.split(":")) : [[s.market, s.pick]]) : []);
  const ouL = (mk) => Number(mk.replace(/^[a-z]+/, "")) / 10;
  const legWon = (mk, p, h, a, h1 = 0, a1 = 0) => {
    if (mk === "1x2") return (h > a ? "home" : h < a ? "away" : "draw") === p;
    if (mk === "btts") return (h > 0 && a > 0) === (p === "yes");
    if (mk === "dc") return p === "1x" ? h >= a : p === "x2" ? h <= a : h !== a;
    if (mk === "eg") return h + a === Number(p.slice(1));
    if (mk === "cs") return h === Number(p[1]) && a === Number(p[2]);
    if (mk === "ht1x2") return (h1 > a1 ? "home" : h1 < a1 ? "away" : "draw") === p;
    if (mk === "btts1") return (h1 > 0 && a1 > 0) === (p === "yes");
    if (mk === "btts2") return (h - h1 > 0 && a - a1 > 0) === (p === "yes");
    if (/^hto\d+$/.test(mk)) return (h1 + a1 > ouL(mk)) === (p === "over");
    if (/^gh\d+$/.test(mk)) return (h > ouL(mk)) === (p === "over");
    if (/^ga\d+$/.test(mk)) return (a > ouL(mk)) === (p === "over");
    return (h + a > ouL(mk)) === (p === "over");
  };
  const bbReady = (m) => !!m && m.status === "open" && m.bb_lh != null && new Date(m.starts_at) > new Date();
  function bbOdd(m, pick) {
    const legs = String(pick).split("|").map((l) => l.split(":"));
    if (!bbReady(m) || legs.length < 2 || legs.length > BB_MAX || new Set(legs.map((l) => l[0])).size !== legs.length) return 0;
    let prod = 1, pst = 1, half = false;
    const goal = [], fams = new Set();
    for (const [mk, p] of legs) {
      const o = bbOk(mk) ? oddOf(m, mk, p) : 0;
      if (!(o > 1)) return 0;
      prod *= o;
      if (GOAL_RE.test(mk)) { goal.push([mk, p]); half ||= HALF_RE.test(mk); continue; }
      const f = bbFam(mk);
      if (fams.has(f)) return 0;
      fams.add(f);
      pst *= (1 / o) / Object.values(m.markets?.[mk] || {}).filter((x) => x > 1).reduce((t, x) => t + 1 / x, 0);
    }
    const pois = (l, n) => { const r = [Math.exp(-l)]; for (let i = 1; i <= n; i++) r.push((r[i - 1] * l) / i); return r; };
    const lh = Number(m.bb_lh), la = Number(m.bb_la), won = (h, a, h1, a1) => goal.every(([mk, p]) => legWon(mk, p, h, a, h1, a1));
    let pr = 0;
    if (!goal.length) pr = 1;
    else if (!half) {
      const ph = pois(lh, 10), pa = pois(la, 10);
      for (let h = 0; h <= 10; h++) for (let a = 0; a <= 10; a++) if (won(h, a, 0, 0)) pr += ph[h] * pa[a];
    } else {
      const h1 = pois(0.45 * lh, 6), a1 = pois(0.45 * la, 6), h2 = pois(0.55 * lh, 6), a2 = pois(0.55 * la, 6);
      for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) for (let x = 0; x <= 6; x++) for (let y = 0; y <= 6; y++)
        if (won(i + x, j + y, i, j)) pr += h1[i] * a1[j] * h2[x] * a2[y];
    }
    pr *= pst;
    if (pr < 0.002) return 0;
    const v = Math.round(Math.min(prod, (1 / pr) * (1 - bbMargin / 100)) * 100) / 100;
    return v >= 1.05 ? v : 0;
  }
  const bbOn = new Set();
  const extras = (m) => [...Object.keys(MK).filter((k) => m.markets?.[k]), ...coKeys(m), ...kKeys(m), ...stKeys(m, "s"), ...stKeys(m, "t"), ...Object.keys(PX).flatMap((p) => pxKeys(m, p))];
  let mvId = null, mvTab = "all";
  const mvClosed = new Set();
  const isSel = (id, mk, pick) => legsOf(slip.get(id)).some(([k, p]) => k === mk && p === pick);
  const ICON = { Futebol: "⚽", Basquete: "🏀", "Tênis": "🎾", "Vôlei": "🏐", "Futebol Americano": "🏈", Beisebol: "⚾", "Hóquei": "🏒", MMA: "🥊", "E-sports": "🎮" };
  const icon = (s) => ICON[s] || "🏅";
  const FLAGS = [[/portugal/i, "🇵🇹"], [/alemanha/i, "🇩🇪"], [/eua/i, "🇺🇸"], [/holanda/i, "🇳🇱"], [/bélgica/i, "🇧🇪"], [/turquia/i, "🇹🇷"], [/escócia/i, "🏴󠁧󠁢󠁳󠁣󠁴󠁿"],
    [/suíça/i, "🇨🇭"], [/áustria/i, "🇦🇹"], [/dinamarca/i, "🇩🇰"], [/noruega/i, "🇳🇴"], [/suécia/i, "🇸🇪"], [/polônia/i, "🇵🇱"],
    [/tcheca/i, "🇨🇿"], [/grécia/i, "🇬🇷"], [/croácia/i, "🇭🇷"], [/romênia/i, "🇷🇴"], [/sérvia/i, "🇷🇸"], [/ucrânia/i, "🇺🇦"],
    [/méxico/i, "🇲🇽"], [/colômbia/i, "🇨🇴"], [/chile/i, "🇨🇱"], [/uruguai/i, "🇺🇾"], [/peru/i, "🇵🇪"], [/equador/i, "🇪🇨"],
    [/japão/i, "🇯🇵"], [/coreia/i, "🇰🇷"], [/saudi/i, "🇸🇦"], [/austrália/i, "🇦🇺"], [/china/i, "🇨🇳"], [/catar/i, "🇶🇦"],
    [/copa del rey/i, "🇪🇸"], [/pokal/i, "🇩🇪"], [/coppa/i, "🇮🇹"], [/coupe/i, "🇫🇷"], [/inglesa|inglaterra/i, "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
    [/brazil|brasil|brasileir/i, "🇧🇷"], [/epl|premier|england|fa cup|championship/i, "🏴󠁧󠁢󠁥󠁮󠁧󠁿"], [/spain|la ?liga/i, "🇪🇸"],
    [/italy/i, "🇮🇹"], [/germany|bundesliga/i, "🇩🇪"], [/france|ligue 1/i, "🇫🇷"], [/portugal/i, "🇵🇹"], [/argentin/i, "🇦🇷"],
    [/nba|nfl|mlb|nhl|ncaa|usa|mls/i, "🇺🇸"], [/uefa|champions|europa|conference/i, "🇪🇺"], [/libertadores|sudamericana|conmebol/i, "🌎"]];
  const flag = (l) => (FLAGS.find(([r]) => r.test(l)) || [null, "🌍"])[1];
  const LEAGUE_PT = { "Brazil Série A": "Brasileirão Série A", "Brazil Série B": "Brasileirão Série B", EPL: "Premier League",
    "UEFA Champions League": "Liga dos Campeões da UEFA", "UEFA Europa League": "Liga Europa da UEFA", "La Liga - Spain": "La Liga", "Serie A - Italy": "Serie A Itália",
    "Saudi Pro League": "Pro League Arábia Saudita" };
  const lname = (l) => LEAGUE_PT[l] || l;
  // ligas principais primeiro nas listas; o resto pela quantidade de jogos
  const TOP = ["Brazil Série A", "Brazil Série B", "Copa do Brasil", "CONMEBOL Libertadores", "CONMEBOL Sudamericana",
    "UEFA Champions League", "Premier League", "La Liga", "Serie A - Italy", "Bundesliga", "Ligue 1", "UEFA Europa League",
    "UEFA Conference League", "Primeira Liga Portugal", "Liga Profesional Argentina", "Copa del Rey", "FA Cup Inglaterra",
    "Championship Inglaterra", "2. Bundesliga Alemanha", "3. Liga Alemanha", "Eredivisie Holanda", "Eerste Divisie Holanda",
    "Liga MX México", "MLS EUA", "USL Championship EUA", "Saudi Pro League", "Süper Lig Turquia",
    "Super League Suíça", "Pro League Bélgica", "Premiership Escócia", "Allsvenskan Suécia", "Eliteserien Noruega",
    "Superliga Dinamarca", "HNL Croácia"];
  // card grande: só jogos de campeonatos grandes, os mais importantes primeiro
  const BIG = ["CONMEBOL Libertadores", "UEFA Champions League", "Brazil Série A", "Copa do Brasil", "Premier League", "EPL",
    "La Liga", "La Liga - Spain", "Serie A - Italy", "Bundesliga", "Ligue 1", "CONMEBOL Sudamericana", "UEFA Europa League",
    "Liga Profesional Argentina", "Primeira Liga Portugal", "UEFA Nations League", "Copa del Rey", "FA Cup Inglaterra",
    "UEFA Conference League", "Saudi Pro League", "MLS EUA", "NBA"];
  const BIG_RE = /world cup|copa do mundo|mundial de clubes|eliminat|qualif|copa am[eé]rica|euro 20\d\d|recopa|supercopa do brasil/i;
  const bigRank = (l) => { const i = BIG.indexOf(l); return i >= 0 ? i : BIG_RE.test(l) ? 0 : -1; };
  function featPick(list) {
    const soon = Date.now() + 3 * 864e5;
    const big = list.filter((m) => bigRank(m.league) >= 0)
      .sort((a, b) => (new Date(a.starts_at) > soon) - (new Date(b.starts_at) > soon) || bigRank(a.league) - bigRank(b.league) || new Date(a.starts_at) - new Date(b.starts_at));
    const per = {}, pick = big.filter((m) => (per[m.league] = (per[m.league] || 0) + 1) <= 2).slice(0, 6);
    for (const m of big) if (pick.length < 6 && !pick.includes(m)) pick.push(m);
    return pick.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }
  const rank = (l) => { const i = TOP.indexOf(l); return i < 0 ? TOP.length : i; };
  const byTop = (a, b) => rank(a[0]) - rank(b[0]) || b[1].n - a[1].n;
  // escudo do time (API-Football); sem escudo, camisa com a cor do nome
  const safeUrl = (u) => (/^https:\/\/[\w.-]+\//.test(u || "") ? u : "");
  const badLogo = (window.RSbadLogo ||= new Set());
  const crest = (m, side) => { const u = safeUrl(m[side + "_logo"]);
    return u && !badLogo.has(u) ? `<img class="crest" src="${RS.esc(u)}" alt="" loading="lazy" onerror="window.RSbadLogo.add(this.getAttribute('src'));this.replaceWith(document.createRange().createContextualFragment(window.RSshirt(this.dataset.n)))" data-n="${RS.esc(m[side])}">` : shirt(m[side]); };
  const leagueLogo = (l) => { const m = matches.find((x) => x.league === l && x.league_logo); return m ? safeUrl(m.league_logo) : ""; };
  const lico = (l) => { const u = leagueLogo(l); return u ? `<img class="lg-logo" src="${RS.esc(u)}" alt="" loading="lazy">` : flag(l); };
  window.RSshirt = (n) => shirt(n);
  function shirt(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<svg class="shirt" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.8 1.6-2.2 2.4-4 2.4S8.8 4.6 8 3z" fill="hsl(${h},55%,42%)"/></svg>`;
  }

  // apostas grátis do jogador (Minha conta → Bônus / roleta): escolhidas no bilhete
  let fbs = [], fbSel = null, fbNow = null;
  async function loadFb() {
    const u = await RS.user();
    const { data } = u ? await sb.from("user_rewards").select("id,amount,min_odd,expires_at").eq("user_id", u.id).eq("kind", "freebet")
      .eq("status", "disponivel").gt("expires_at", new Date().toISOString()).order("expires_at") : { data: [] };
    const same = JSON.stringify(data || []) === JSON.stringify(fbs);
    fbs = data || [];
    if (!fbs.some((f) => f.id === fbSel)) fbSel = null;
    if (!same || fbSel) renderSlip();
  }
  let matches = [], sport = "Popular", view = "all", league = null, lt = "games", query = "", dayOff = 0, mode = "multi", stakeVal = localStorage.getItem("rs-def-stake") || "", sysK = 2;
  // Sistema: cada combinação de k seleções vira uma múltipla separada
  const MAXC = 40;
  const nCk = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
  const kComb = (arr, k) => { const out = []; const go = (i, cur) => { if (cur.length === k) { out.push(cur); return; } for (let j = i; j < arr.length; j++) go(j + 1, [...cur, arr[j]]); }; go(0, []); return out; };
  const KNAME = { 2: "Duplas", 3: "Triplas", 4: "Quádruplas" };
  const slip = new Map(); // match_id -> { market, pick, odd, base }
  const favs = new Set(JSON.parse(localStorage.getItem("rs-favs") || "[]"));
  const live = (m) => m.status === "live";
  // ao vivo sem odds novas do feed ao vivo: cadeado (o servidor recusa igual)
  const staleLive = (m) => !!m.external_id && (m.status === "live" || new Date(m.starts_at) <= new Date())
    && (!m.odds_at || Date.now() - new Date(m.odds_at) > 45_000);
  const suspended = (m) => !!m && (m.locked || (m.suspended_until && new Date(m.suspended_until) > new Date()) || staleLive(m));
  const sameDay = (d, off) => { const a = new Date(d), b = new Date(); b.setDate(b.getDate() + off); return a.toDateString() === b.toDateString(); };
  const hhmm = (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ddmm = (d) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const dayLabel = (d) => (sameDay(d, 0) ? "Hoje" : sameDay(d, 1) ? "Amanhã" : ddmm(d));
  const code = () => [...slip].map(([id, s]) => (s.market === "1x2" ? id + CODE[s.pick] : `${id}~${s.market}.${s.pick}`)).join(",");
  const persist = () => sessionStorage.setItem("rs-slip", code());
  const num = (v) => Number(String(v).replace(",", ".")) || 0;
  const mobile = () => matchMedia("(max-width: 1000px)").matches;
  const KP = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

  function syncSlip() {
    for (const [id, s] of slip) {
      const m = matches.find((x) => x.id === id);
      const cur = oddOf(m, s.market, s.pick);
      if (!cur) { slip.delete(id); continue; }
      s.odd = cur;
    }
  }
  function paint() {
    syncSlip();
    render();
    if (document.activeElement?.id !== "stake") renderSlip();
  }
  const LIST_COLS = "id,external_id,sport,league,home,away,starts_at,odd_home,odd_draw,odd_away,status,result,score_home,score_away,locked,suspended_until,suspend_reason,minute,period,bb_lh,bb_la,home_logo,away_logo,league_logo,odds_at,n_markets";
  async function loadMarkets(ids) {
    ids = ids.filter(Boolean);
    if (!ids.length) return;
    const { data } = await sb.from("matches").select("id,markets").in("id", ids);
    for (const r of data || []) { const m = matches.find((x) => x.id === r.id); if (m) m.markets = r.markets; }
    paint();
  }
  async function load() {
    // lista sem os mercados extras (pesados): eles vêm só do jogo aberto e dos jogos no bilhete
    const { data, error } = await sb.from("matches").select(LIST_COLS).in("status", ["open", "live"]).order("starts_at");
    if (error) { list.innerHTML = `<p class="empty">Erro ao carregar jogos.</p>`; return; }
    const old = new Map(matches.map((m) => [m.id, m]));
    matches = data.map((r) => (old.get(r.id)?.markets ? { ...r, markets: old.get(r.id).markets } : r));
    loadMarkets([...slip.keys()]);
    lastFull = Date.now();
    paint();
  }
  // o tempo real manda a linha que mudou; a lista inteira só volta na rede se o socket cair
  function applyPayload(payload) {
    const row = payload.new?.id ? payload.new : null;
    const id = row?.id || payload.old?.id;
    if (!id) return;
    const i = matches.findIndex((m) => m.id === id);
    const visible = row && (row.status === "open" || row.status === "live");
    if (!visible) { if (i >= 0) matches.splice(i, 1); return; }
    if (i >= 0) matches[i] = { ...matches[i], ...row };
    else {
      matches.push(row);
      matches.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    }
  }

  // ---------- jogos ----------
  function oddBtn(m, pick) {
    const odd = m["odd_" + pick];
    if (!odd) return pick === "draw" ? "" : `<button class="odd" disabled><small>${PICK[pick]}</small><b>-</b></button>`;
    if (suspended(m)) return `<button class="odd" disabled title="Mercado suspenso"><small>${PICK[pick]}</small><b>${RS.icon("lock")}</b></button>`;
    const sel = isSel(m.id, "1x2", pick);
    return `<button class="odd ${sel ? "selected" : ""}" data-id="${m.id}" data-pick="${pick}"><small>${PICK[pick]}</small><b>${Number(odd).toFixed(2)}</b></button>`;
  }
  const odds = (m) => `<div class="odds">${["home", "draw", "away"].map((p) => oddBtn(m, p)).join("")}</div>`;
  const score = (m) => (m.score_home != null ? `<b class="score">${m.score_home} - ${m.score_away}</b>` : "");

  const row = (m) => `<div class="row">
      <div class="row-time">${live(m) ? `<i class="live">${m.period === "HT" ? "Intervalo" : m.minute ? m.minute + "'" : "AO VIVO"}</i>${score(m)}` : `${ddmm(m.starts_at)} <br>${hhmm(m.starts_at)}`}</div>
      <div class="row-teams"><span>${crest(m, "home")}${RS.esc(m.home)}</span><span>${crest(m, "away")}${RS.esc(m.away)}</span>
        <small>${lico(m.league)} ${RS.esc(lname(m.league))}</small></div>
      <div class="row-odds">${odds(m)}</div>
      <button class="fav ${favs.has(m.id) ? "on" : ""}" data-fav="${m.id}" aria-label="Favoritar">${RS.icon("star")}</button>
      ${(m.markets ? extras(m).length : m.n_markets) ? `<button class="more-mk" data-more="${m.id}">+${m.markets ? extras(m).length : m.n_markets} mercados</button>` : ""}
    </div>`;

  // tela do jogo: mercados em blocos que abrem e fecham, separados por abas
  const MV_TABS = { all: "Todos", main: "Principais", goals: "Gols", corners: "Escanteios", cards: "Cartões", shots: "Chutes" };
  // placar exato em 3 colunas: vitória da casa, empate, vitória do visitante
  const CS_COLS = [(h, a) => h > a, (h, a) => h === a, (h, a) => h < a];
  const csRows = (m) => {
    const ks = Object.keys(m.markets?.cs || {}).sort((x, y) => (+x[1] + +x[2]) - (+y[1] + +y[2]) || Math.abs(x[1] - x[2]) - Math.abs(y[1] - y[2]) || x[1] - y[1] || x[2] - y[2]);
    const cols = CS_COLS.map((f) => ks.filter((k) => f(+k[1], +k[2])));
    return Array.from({ length: Math.max(...cols.map((c) => c.length)) }, (_, i) => cols.map((c) => c[i] ? ["cs", c[i], MK.cs[1][c[i]]] : [null]));
  };
  const MV_GROUPS = [
    { key: "r", tab: "main", name: "Resultado Final", rows: (m) => [[["1x2", "home", m.home], ["1x2", "draw", "Empate"], ["1x2", "away", m.away]]] },
    { key: "ht", tab: "main", name: "Resultado 1º Tempo", rows: (m) => [[["ht1x2", "home", m.home], ["ht1x2", "draw", "Empate"], ["ht1x2", "away", m.away]]] },
    { key: "ou", tab: "goals", name: "Total de Gols Mais/Menos", rows: () => ["ou05", "ou15", "ou25", "ou35", "ou45", "ou55"].map((k) => Object.entries(MK[k][1]).map(([p, l]) => [k, p, l])) },
    { key: "eg", tab: "goals", name: "Gols Exatos", rows: () => [[0, 1, 2], [3, 4, 5], [6]].map((r) => r.map((n) => ["eg", "g" + n, `${n} ${n === 1 ? "gol" : "gols"}`])) },
    { key: "cs", tab: "goals", name: "Placar Exato", rows: csRows },
    { key: "gh", tab: "goals", name: "Gols Casa Mais/Menos", rows: pxRows("gh") },
    { key: "ga", tab: "goals", name: "Gols Fora Mais/Menos", rows: pxRows("ga") },
    { key: "hto", tab: "goals", name: "Gols 1º Tempo Mais/Menos", rows: pxRows("hto") },
    { key: "btts", tab: "goals", name: "Ambas equipes Marcam", rows: () => [[["btts", "yes", "Sim"], ["btts", "no", "Não"]]] },
    { key: "btts1", tab: "goals", name: "Ambas Marcam 1º Tempo", rows: () => [[["btts1", "yes", "Sim"], ["btts1", "no", "Não"]]] },
    { key: "btts2", tab: "goals", name: "Ambas Marcam 2º Tempo", rows: () => [[["btts2", "yes", "Sim"], ["btts2", "no", "Não"]]] },
    { key: "dc", tab: "main", name: "Chance Dupla", rows: (m) => [[["dc", "1x", `${m.home} ou Empate`], ["dc", "x2", `Empate ou ${m.away}`], ["dc", "12", `${m.home} ou ${m.away}`]]] },
    { key: "dnb", tab: "main", name: "Empate Anula", ca: false, rows: (m) => [[["dnb", "home", m.home], ["dnb", "away", m.away]]] },
    { key: "c1x2", tab: "corners", name: "Escanteios 1X2", rows: (m) => [[["c1x2", "home", m.home], ["c1x2", "draw", "Empate"], ["c1x2", "away", m.away]]] },
    { key: "co", tab: "corners", name: "Total de Escanteios Mais/Menos", rows: (m) => coKeys(m).map((k) => [[k, "over", mkDef(k)[1].over], [k, "under", mkDef(k)[1].under]]) },
    { key: "ch", tab: "corners", name: "Escanteios Casa Mais/Menos", rows: pxRows("ch") },
    { key: "ca", tab: "corners", name: "Escanteios Fora Mais/Menos", rows: pxRows("ca") },
    { key: "ko", tab: "cards", name: "Total de Cartões Mais/Menos", rows: (m) => kKeys(m).map((k) => [[k, "over", mkDef(k)[1].over], [k, "under", mkDef(k)[1].under]]) },
    { key: "kh", tab: "cards", name: "Cartões Casa Mais/Menos", rows: pxRows("kh") },
    { key: "ka", tab: "cards", name: "Cartões Fora Mais/Menos", rows: pxRows("ka") },
    { key: "s1x2", tab: "shots", name: "Chutes 1X2", rows: (m) => [[["s1x2", "home", m.home], ["s1x2", "draw", "Empate"], ["s1x2", "away", m.away]]] },
    { key: "so", tab: "shots", name: "Total de Chutes Mais/Menos", rows: (m) => stKeys(m, "s").map((k) => [[k, "over", mkDef(k)[1].over], [k, "under", mkDef(k)[1].under]]) },
    { key: "sh", tab: "shots", name: "Chutes Casa Mais/Menos", rows: pxRows("sh") },
    { key: "sa", tab: "shots", name: "Chutes Fora Mais/Menos", rows: pxRows("sa") },
    { key: "t1x2", tab: "shots", name: "Chutes no Gol 1X2", rows: (m) => [[["t1x2", "home", m.home], ["t1x2", "draw", "Empate"], ["t1x2", "away", m.away]]] },
    { key: "to", tab: "shots", name: "Total de Chutes no Gol Mais/Menos", rows: (m) => stKeys(m, "t").map((k) => [[k, "over", mkDef(k)[1].over], [k, "under", mkDef(k)[1].under]]) },
  ];
  const mvBtn = (m, [mk, p, label]) => {
    if (!mk) return `<span></span>`;
    const odd = oddOf(m, mk, p);
    if (!odd) return "";
    if (suspended(m)) return `<button class="odd" disabled><small>${RS.esc(label)}</small><b>${RS.icon("lock")}</b></button>`;
    return `<button class="odd ${isSel(m.id, mk, p) ? "selected" : ""}" data-id="${m.id}" data-mk="${mk}" data-pick="${p}"><small>${RS.esc(label)}</small><b>${odd.toFixed(2)}</b></button>`;
  };
  function renderMv() {
    let el = RS.$("#mv");
    const m = mvId != null && matches.find((x) => x.id === mvId);
    document.body.classList.toggle("mv-open", !!m);
    if (!m) { el?.remove(); return; }
    if (!el) { el = document.createElement("section"); el.id = "mv"; el.className = "mv"; document.body.append(el); }
    const bb = bbOn.has(m.id) && bbReady(m), canBB = bbReady(m);
    const avail = MV_GROUPS.map((g) => ({ ...g, html: g.rows(m).map((r) => r.map((b) => mvBtn(m, b)).join("")).filter(Boolean) }))
      .filter((g) => g.html.length && (!bb || g.ca !== false));
    const tabs = Object.entries(MV_TABS).filter(([k]) => k === "all" || avail.some((g) => g.tab === k));
    if (!tabs.some(([k]) => k === mvTab)) mvTab = "all";
    const groups = avail.filter((g) => mvTab === "all" || g.tab === mvTab);
    const allClosed = groups.length && groups.every((g) => mvClosed.has(g.key));
    const top = live(m)
      ? `<i class="live">${m.period === "HT" ? "Intervalo" : (m.minute ? m.minute + "' " : "") + "AO VIVO"}</i>`
      : new Date(m.starts_at).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) + " " + hhmm(m.starts_at);
    const sc = m.score_home != null ? `<b class="mv-score">${m.score_home} - ${m.score_away}</b>` : `<i class="mv-vs">x</i>`;
    const keep = el.querySelector(".mv-body")?.scrollTop || 0;
    RS.morph(el, `<div class="mv-head"><button class="mv-back" data-mvclose aria-label="Voltar">←</button><small>${lico(m.league)} ${RS.esc(lname(m.league))}</small></div>
      <div class="mv-match"><div class="mv-date">${top}</div>
        <div class="mv-teams"><span>${crest(m, "home")}${RS.esc(m.home)}</span>${sc}<span>${RS.esc(m.away)}${crest(m, "away")}</span></div></div>
      <div class="mv-bar"><div class="mv-tabs">${tabs.map(([k, l]) => `<button class="${mvTab === k ? "on" : ""}" data-mvtab="${k}">${l}</button>`).join("")}</div>
        <button class="mv-all" data-mvall title="${allClosed ? "Abrir todos" : "Fechar todos"}">${allClosed ? "⇕" : "⇳"}</button>
        ${canBB ? `<button class="bb-toggle ${bb ? "on" : ""}" data-bb="${m.id}" aria-pressed="${bb}">CRIAR<br>APOSTA</button>` : ""}</div>
      ${bb ? `<p class="mv-hint">Escolha de 2 a ${BB_MAX} mercados deste jogo para combinar numa aposta só.</p>` : ""}
      <div class="mv-body">${groups.map((g) => `<div class="mv-acc ${mvClosed.has(g.key) ? "closed" : ""}">
        <button class="mv-acc-h" data-mvacc="${g.key}"><span>${g.name}</span>${canBB && g.ca !== false ? `<i class="ca">CA</i>` : ""}<i class="mv-chev"></i></button>
        <div class="mv-acc-b">${g.html.map((r) => `<div class="odds">${r}</div>`).join("")}</div></div>`).join("")
        || `<p class="empty">Nenhum mercado disponível nesta aba.</p>`}</div>`);
    el.querySelector(".mv-body").scrollTop = keep;
  }

  const FEAT_IMG = { futebol: 8, basquete: 3, tenis: 2, volei: 1 };
  const hash = (t) => [...String(t)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  // foto de fundo por esporte; no futebol a foto é fixa por liga, para os jogos da mesma liga ficarem iguais
  function featImg(m, key) {
    const n = FEAT_IMG[key] ? key : "futebol";
    return `img/feat/${n}-${(hash(n === "futebol" ? m.league : m.id) % FEAT_IMG[n]) + 1}.webp`;
  }

  // foto do time que vai jogar (TheSportsDB, direto do navegador): fanart do time ou, se não tiver, recorte de um jogador do elenco.
  // Fica guardada no aparelho por 7 dias; enquanto não chega (ou se o time não tiver foto), fica a foto genérica.
  const ART_SPORT = { futebol: "Soccer", basquete: "Basketball" };
  const ART_KEY = "rs-team-art:v2", ART_TTL = 7 * 864e5;
  let art = {};
  try { art = JSON.parse(localStorage.getItem(ART_KEY)) || {}; } catch { art = {}; }
  const artWait = new Set();
  let artChain = Promise.resolve(), featTop = null;
  const tsdb = (path) => fetch("https://www.thesportsdb.com/api/v1/json/123/" + path)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  const findTeam = async (name, sport) =>
    ((await tsdb("searchteams.php?t=" + encodeURIComponent(name))).teams || []).find((t) => t.strSport === sport);
  async function lookupArt(name, sport) {
    const plain = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/)
      .filter((w) => !/^(\d+\.?|[A-Z]{2,3})$/.test(w)).join(" ");
    const team = (await findTeam(name, sport)) || (plain && plain !== name ? await findTeam(plain, sport) : null);
    if (!team) return [];
    const fan = [1, 2, 3, 4].map((i) => team["strFanart" + i]).filter(Boolean).map((x) => x + "/medium");
    if (fan.length) return fan;
    return ((await tsdb("lookup_all_players.php?id=" + team.idTeam)).player || [])
      .filter((p) => p.strCutout && !/manager|coach/i.test(p.strPosition || "")).map((p) => "p:" + p.strCutout + "/medium");
  }

  function queueArt(k, name, sport) {
    if (artWait.has(k)) return;
    artWait.add(k);
    artChain = artChain.then(() => lookupArt(name, sport))
      .then((u) => { art[k] = { u, t: Date.now() }; }, () => { art[k] = { u: [], t: Date.now() - ART_TTL + 6e5, err: 1 }; })
      .then(() => {
        artWait.delete(k);
        try { localStorage.setItem(ART_KEY, JSON.stringify(art, (key, v) => (v && v.err ? undefined : v))); } catch {}
        if (featTop && !artWait.size) RS.morph(RS.$("#feat-cards"), featTop.map(feat).join(""));
      });
  }

  function teamArt(m, key) {
    const sport = ART_SPORT[key];
    if (!sport) return null;
    for (const name of [m.home, m.away]) {
      const k = key + ":" + name, e = art[k];
      if (!e || Date.now() - e.t > ART_TTL) { queueArt(k, name, sport); return null; }
      if (e.u.length) return e.u[hash(m.id) % e.u.length];
    }
    return null;
  }

  function featBg(m, key) {
    const t = teamArt(m, key), base = `--feat-base:url('${featImg(m, key)}')`;
    if (!t) return `--feat-img:url('${featImg(m, key)}');${base}`;
    const player = t.startsWith("p:");
    return `--feat-img:url('${RS.esc(player ? t.slice(2) : t)}');${base}${player ? ";--feat-pos:left -8px bottom;--feat-size:auto 94%" : ""}`;
  }

  function feat(m) {
    const sp = "sp-" + m.sport.normalize("NFD").replace(/[^\w]/g, "").toLowerCase();
    const top = live(m)
      ? `<i class="live">${m.period === "HT" ? "Intervalo" : m.minute ? m.minute + "' AO VIVO" : "AO VIVO"}</i>${m.score_home != null ? ` ${m.score_home} - ${m.score_away}` : ""}`
      : `${RS.icon("clock")} ${dayLabel(m.starts_at)} ${hhmm(m.starts_at)}`;
    const big = safeUrl(m.home_logo) && safeUrl(m.away_logo)
      ? `<div class="feat-crests"><img src="${RS.esc(m.home_logo)}" alt=""><img src="${RS.esc(m.away_logo)}" alt=""></div>` : "";
    return `<div class="feat-card ${sp}${big ? " has-crests" : ""} has-photo" style="${featBg(m, sp.slice(3))}"><div class="feat-top">${top}</div>${big}
      <div class="feat-teams"><b>${crest(m, "home")}${RS.esc(m.home)}</b><b>${crest(m, "away")}${RS.esc(m.away)}</b></div>${odds(m)}</div>`;
  }

  // tela principal: só os jogos de hoje que ainda não começaram
  const mainDay = (m) => !live(m) && sameDay(m.starts_at, 0);
  function visible() {
    const q = query.toLowerCase(), now = Date.now();
    return matches.filter((m) =>
      (sport === "Popular" || m.sport === sport) &&
      (!league || (m.league === league && (lt !== "live" || live(m)))) &&
      (!q || `${m.home} ${m.away} ${m.league} ${lname(m.league)}`.toLowerCase().includes(q)) &&
      ((view === "all" && (league || q || mainDay(m))) ||
        (view === "live" && live(m)) ||
        (view === "today" && (live(m) || sameDay(m.starts_at, 0))) ||
        (view === "week" && sameDay(m.starts_at, dayOff)) ||
        (view === "fav" && favs.has(m.id)) ||
        (view === "next" && !live(m) && new Date(m.starts_at) - now < 86400000)));
  }
  const TITLE = { all: "Junte-se à ação", live: "Ao vivo", today: "Jogos de hoje", week: "Calendário de 7 dias", fav: "Favoritos", next: "Próximos jogos" };

  function render() {
    const byLeague = {};
    matches.forEach((m) => { (byLeague[m.league] ||= { n: 0, sport: m.sport }).n++; });
    RS.morph(RS.$("#comp-list"), Object.entries(byLeague).sort(byTop).filter(([l], i) => i < 12 || TOP.includes(l)).map(([l, v]) =>
      `<button class="comp-item ${league === l ? "active" : ""}" data-league="${RS.esc(l)}"><span class="comp-ico">${lico(l)}</span>
        <span><b>${RS.esc(lname(l))}</b><small>${RS.esc(v.sport)}</small></span><em>${v.n}</em></button>`).join("")
      || `<p class="muted small" style="padding:0 6px">Sem competições no momento.</p>`);

    const count = {};
    matches.filter((m) => (view === "live" ? live(m) : view !== "all" || league || query || mainDay(m))).forEach((m) => (count[m.sport] = (count[m.sport] || 0) + 1));
    if (sport !== "Popular" && !count[sport]) sport = "Popular";
    const sports = ["Popular", ...Object.keys(count).sort((a, b) => count[b] - count[a])];
    RS.$("#sport-pills").innerHTML = sports.map((s) => `<button class="${s === sport ? "active" : ""}" data-sport="${RS.esc(s)}">
      ${s === "Popular" ? RS.icon("grid") : icon(s)} ${RS.esc(s)}${s !== "Popular" ? ` <em>${count[s]}</em>` : ""}</button>`).join("");

    const days = RS.$("#day-pills");
    days.classList.toggle("hidden", view !== "week");
    if (view === "week") {
      days.innerHTML = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() + i);
        const t = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
        return `<button class="${i === dayOff ? "active" : ""}" data-day="${i}">${t}</button>`;
      }).join("");
    }

    const home = view === "all" && sport === "Popular" && !league && !query;
    const top = featPick(matches.filter((m) => !live(m) && !suspended(m)));
    RS.$("#feat-cards").classList.toggle("hidden", !home || !top.length);
    featTop = home ? top : null;
    RS.morph(RS.$("#feat-cards"), home ? top.map(feat).join("") : "");
    RS.$("#casino-strip").classList.toggle("hidden", !home);
    document.body.classList.toggle("is-home", home);
    const pop = Object.entries(byLeague).sort(byTop).filter(([l], i) => i < 10 || TOP.includes(l));
    RS.$("#league-sec").classList.toggle("hidden", !home || !pop.length);
    RS.morph(RS.$("#league-chips"), home ? pop.map(([l]) =>
      `<button class="league-chip" data-league="${RS.esc(l)}"><span class="comp-ico">${lico(l)}</span>${RS.esc(lname(l))}</button>`).join("") : "");
    const lh = RS.$("#league-head");
    lh.classList.toggle("hidden", !league);
    RS.$(".action-head").classList.toggle("hidden", !!league);
    if (league) {
      const inL = matches.filter((m) => m.league === league), nLive = inL.filter(live).length;
      RS.morph(lh, `<div class="lh-top"><span class="lh-ico">${lico(league)}</span><h1>${RS.esc(lname(league))}</h1></div>
        <div class="lh-tabs"><button class="${lt === "games" ? "active" : ""}" data-lt="games">Jogos <em>${inL.length}</em></button>
          <button class="${lt === "live" ? "active" : ""}" data-lt="live">Ao vivo <em>${nLive}</em></button>
          <button data-view="all">Todas as ligas</button></div>`);
    }
    RS.$("#list-title").textContent = query ? `Busca: "${query}"` : league ? lname(league) : view === "live" ? `Jogos ao vivo (${matches.filter(live).length})` : TITLE[view];
    RS.$$("[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === view && !league && !query));

    const rows = visible();
    const reset = home ? "" : `<div class="filter-bar"><button class="btn btn-outline sm" data-view="all">Ver todos os jogos</button></div>`;
    RS.morph(list, reset + (rows.length ? (league ? rows.map(row).join("") : groups(rows))
      : `<p class="empty">${view === "fav" ? "Toque na estrela de um jogo para salvá-lo nos favoritos." : view === "all" && !league && !query ? "Nenhum jogo hoje. Veja os próximos dias no Calendário." : "Nenhum jogo disponível no momento."}</p>`));
    renderMv();
  }

  // lista separada por campeonato, ligas principais primeiro
  function groups(rows) {
    const by = new Map();
    rows.forEach((m) => { if (!by.has(m.league)) by.set(m.league, []); by.get(m.league).push(m); });
    return [...by].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1].length - a[1].length)
      .map(([l, ms]) => `<section class="lg-group"><button class="lg-bar" data-league="${RS.esc(l)}"><span class="comp-ico">${lico(l)}</span>
        <b>${RS.esc(lname(l))}</b><em>${ms.length}</em></button>${ms.map(row).join("")}</section>`).join("");
  }

  function setView(v, opts = {}) {
    view = v; league = opts.league ?? null; query = opts.query ?? ""; lt = "games";
    if (v === "week") dayOff = opts.day ?? 0;
    render();
  }

  // ---------- bilhete ----------
  function toggle(id, pick, market = "1x2") {
    const m = matches.find((x) => x.id === id);
    if (!m || suspended(m)) return;
    const cur = slip.get(id);
    if (bbOn.has(id) && bbReady(m) && bbOk(market)) {
      let legs = legsOf(cur).filter(([k]) => bbOk(k));
      if (legs.some(([k, p]) => k === market && p === pick)) legs = legs.filter(([k]) => k !== market);
      else if (legs.some(([k]) => k === market)) legs = legs.map(([k, p]) => [k, k === market ? pick : p]);
      else if (legs.length >= BB_MAX) { RS.toast(`Criar Aposta: até ${BB_MAX} mercados por jogo.`, "error"); return; }
      else legs.push([market, pick]);
      if (!legs.length) slip.delete(id);
      else {
        const [mk, pk] = legs.length > 1 ? ["bb", legs.map((l) => l.join(":")).join("|")] : legs[0];
        const odd = oddOf(m, mk, pk);
        if (!odd) { RS.toast("Essa combinação não está disponível.", "error"); return; }
        slip.set(id, { market: mk, pick: pk, odd, base: odd });
      }
    } else if (cur?.market === market && cur.pick === pick) slip.delete(id);
    else {
      const odd = oddOf(m, market, pick);
      if (!odd) return;
      slip.set(id, { market, pick, odd, base: odd });
    }
    render(); renderSlip(); persist();
  }

  function restore(str) {
    if (!str) return;
    for (const part of str.split(",")) {
      const [ids, mp] = part.split("~");
      const id = Number(mp ? ids : part.slice(0, -1));
      const [market, pick] = mp ? mp.split(".") : ["1x2", UNCODE[part.slice(-1)]];
      const m = matches.find((x) => x.id === id);
      const odd = oddOf(m, market, pick);
      if (odd && !suspended(m)) slip.set(id, { market, pick, odd, base: odd });
    }
    render(); renderSlip(); persist();
  }

  let oddMax = 0;
  const capOdd = (o) => (oddMax > 0 ? Math.min(o, oddMax) : o);
  RS.rpc("bet_limits").then((l) => { oddMax = Number(l && l.total_odd_max) || 0; if (slip.size) renderSlip(); }).catch(() => {});

  function renderSlip() {
    const items = [...slip.entries()].filter(([id]) => matches.some((m) => m.id === id));
    const n = items.length;
    const total = capOdd(items.reduce((a, [, s]) => a * s.odd, 1));
    const saved = localStorage.getItem("rs-saved-slip");
    RS.$("#slip-count").textContent = n;
    box.classList.toggle("empty", !n && !saved);
    RS.$("#slip-fab").classList.toggle("hidden", !n);
    RS.$("#fab-odd").textContent = total.toFixed(2);
    RS.$("#fab-count").textContent = n;
    RS.$("#bn-count").textContent = n;
    RS.$("#bn-count").classList.toggle("hidden", !n);
    if (!n) document.body.classList.remove("slip-open");
    const sys = mode === "system" && n >= 3;
    const multi = !sys && mode !== "single" && n > 1;
    if (sys) { sysK = Math.min(Math.max(sysK, 2), n - 1); while (sysK > 2 && nCk(n, sysK) > MAXC) sysK--; }
    const combos = sys ? kComb(items.map(([, x]) => x.odd), sysK) : [];
    RS.$$("#slip-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === (sys ? "system" : multi ? "multi" : "single")));
    if (!n) {
      slipEl.innerHTML = `<div class="slip-empty">Seu bilhete está vazio.${saved ? `<br><button class="btn btn-outline sm" id="slip-load" style="margin-top:10px">Carregar bilhete guardado</button>` : ""}</div>`;
      return;
    }
    const anySusp = items.some(([id]) => suspended(matches.find((m) => m.id === id)));
    const fb = (fbNow = !sys && (multi || n === 1) ? fbs.find((f) => f.id === fbSel) || null : null);
    const fbRow = !sys && (multi || n === 1) && fbs.length ? `<div class="fb-row"><span>${RS.icon("gift")} Aposta grátis</span><div>${fbs.map((f) =>
      `<button type="button" class="fb-chip${f.id === fbSel ? " on" : ""}" data-fb="${f.id}">${RS.money(f.amount)}</button>`).join("")}</div>
      ${fb ? `<small>Odd mínima ${Number(fb.min_odd).toFixed(2)}${total < fb.min_odd ? ` · <b class="fb-warn">bilhete com ${total.toFixed(2)}</b>` : ""} · se ganhar, recebe só o lucro, sem rollover</small>` : ""}</div>` : "";
    slipEl.innerHTML = items.map(([id, s]) => {
      const m = matches.find((x) => x.id === id);
      const name = (mk, p) => (mk === "1x2" || mk === "dnb" || /^([cst]|ht)1x2$/.test(mk) ? (p === "home" ? m.home : p === "away" ? m.away : "Empate") : mkDef(mk)[1][p]);
      const mkName = (mk) => (mk === "1x2" ? "Resultado Final" : mkDef(mk)[0]);
      const up = s.odd > s.base;
      return `<div class="slip-item">
        <div class="si-main">${s.market === "bb"
          ? `<b class="si-bb">${RS.icon("ball")} Criar Aposta</b><small>${crest(m, "home")} ${RS.esc(m.home)} - ${RS.esc(m.away)} ${crest(m, "away")}</small>
            <ul class="si-legs">${legsOf(s).map(([k, p]) => `<li><b>${RS.esc(name(k, p))}</b><small>${mkName(k)}</small></li>`).join("")}</ul>`
          : `<b>${icon(m.sport)} ${RS.esc(name(s.market, s.pick))}</b><small class="si-mkt">${mkName(s.market)}</small>
          <small class="si-teams">${crest(m, "home")}${RS.esc(m.home)}<br>${crest(m, "away")}${RS.esc(m.away)}</small>`}
          ${suspended(m) ? `<small class="si-lock">${RS.icon("lock")} Mercado suspenso</small>` : ""}</div>
        <div class="si-odd">${s.odd !== s.base
          ? `<s>${s.base.toFixed(2)}</s><span class="${up ? "up" : "down"}">${up ? "▲" : "▼"} ${s.odd.toFixed(2)}</span>`
          : `<span>${s.odd.toFixed(2)}</span>`}</div>
        <button class="slip-x" data-rm="${id}" aria-label="Remover">${RS.icon("trash")}</button></div>`;
    }).join("") + `
      ${mode === "system" && n < 3 ? `<p class="muted small sys-hint">Sistema precisa de pelo menos 3 seleções.</p>` : ""}
      ${sys ? `<div class="sys-row"><span>Combinações</span><select class="input" id="sys-k">${Array.from({ length: n - 2 }, (_, i) => i + 2).filter((k) => nCk(n, k) <= MAXC)
        .map((k) => `<option value="${k}" ${k === sysK ? "selected" : ""}>${KNAME[k] || k + " seleções"} ${k}/${n} · ${nCk(n, k)} apostas</option>`).join("")}</select></div>` : ""}
      ${fbRow}<div class="stake-row"><span>${sys ? `Sistema ${sysK}/${n} · valor por aposta` : multi ? `Múltipla ${n} seleções` : n > 1 ? `Simples · ${n} apostas` : "Simples"}</span>${multi ? `<b>${total.toFixed(2)}</b>` : ""}
        <label class="stake"><i>R$</i><input id="stake" type="text" inputmode="${mobile() ? "none" : "decimal"}" autocomplete="off" placeholder="0,00" value="${fb ? fb.amount : stakeVal}"${fb ? " readonly" : ""}></label></div>
      ${fb ? "" : `<div class="quick"><button data-stake="10">+10</button><button data-stake="50">+50</button><button data-stake="200">+200</button><button data-stake="max">MÁX</button></div>
      <div class="keypad">${KP.map((k) => `<button data-kp="${k}">${k === "del" ? "⌫" : k}</button>`).join("")}</div>`}
      ${sys || (!multi && n > 1) ? `<div class="slip-total"><span>Total apostado</span><b id="slip-total"></b></div>` : ""}
      <button class="btn btn-green w-full" id="place" ${anySusp || placing ? "disabled" : ""}>
        <b>${placing || (anySusp ? "Seleção suspensa" : fb ? `Apostar grátis <span id="pl-stake"></span>` : `Apostar agora <span id="pl-stake"></span>`)}</b>
        <small>Ganhos potenciais <span id="slip-return"></span></small></button>`;

    const stake = RS.$("#stake");
    const upd = () => {
      if (!fb) stakeVal = stake.value;
      const v = num(stake.value);
      RS.$("#slip-return").textContent = RS.money(fb ? v * Number(total.toFixed(2)) - v : sys ? combos.reduce((a, c) => a + v * Number(capOdd(c.reduce((x, o) => x * o, 1)).toFixed(2)), 0)
        : multi ? v * Number(total.toFixed(2)) : items.reduce((a, [, s]) => a + v * s.odd, 0));
      const bets = sys ? combos.length : multi ? 1 : n;
      const ps = RS.$("#pl-stake");
      if (ps) ps.textContent = RS.money(v * bets);
      const t = RS.$("#slip-total");
      if (t) t.textContent = RS.money(v * bets);
    };
    stake.oninput = upd;
    upd();
    RS.$$("[data-stake]", slipEl).forEach((c) => (c.onclick = async () => {
      if (c.dataset.stake === "max") {
        const p = await RS.profile();
        if (!p) { location.href = "login.html"; return; }
        stake.value = Math.floor((Number(p.balance) / (sys ? combos.length : multi ? 1 : n)) * 100) / 100;
      } else stake.value = Math.round((num(stake.value) + Number(c.dataset.stake)) * 100) / 100;
      upd();
    }));
    RS.$$("[data-kp]", slipEl).forEach((c) => (c.onclick = () => {
      const k = c.dataset.kp, v = String(stake.value).replace(",", ".");
      stake.value = k === "del" ? v.slice(0, -1) : k === "." ? (v.includes(".") ? v : (v || "0") + ".") : /\.\d{2}$/.test(v) || v.length >= 9 ? v : v === "0" ? k : v + k;
      upd();
    }));
    RS.$$("[data-fb]", slipEl).forEach((c) => (c.onclick = () => { fbSel = fbSel === +c.dataset.fb ? null : +c.dataset.fb; renderSlip(); }));
    RS.$$("[data-rm]", slipEl).forEach((c) => (c.onclick = () => { slip.delete(Number(c.dataset.rm)); render(); renderSlip(); persist(); }));
    const sk = RS.$("#sys-k");
    if (sk) sk.onchange = () => { sysK = Number(sk.value); renderSlip(); };
    RS.$("#place").onclick = () => place(multi, sys ? sysK : 0);
  }

  const btnTxt = (t) => { placing = t; const b = RS.$("#place"); if (b) { b.disabled = true; b.innerHTML = `<b>${t}</b>`; } };

  async function place(multi, k = 0) {
    if (placing) return;
    if (!(await RS.user())) { location.href = "login.html"; return; }
    if (fbNow) return placeFree(fbNow);
    const stake = num(RS.$("#stake").value);
    if (!(stake > 0)) { RS.toast("Digite o valor da aposta.", "error"); return; }
    btnTxt("Enviando aposta…");
    const sel = [...slip.entries()].map(([match_id, s]) => ({ match_id, market: s.market, pick: s.pick }));
    const groups = k ? kComb(sel, k) : multi ? [sel] : sel.map((s) => [s]);
    const ok = [];
    try {
      for (const g of groups) {
        // ao vivo: o servidor espera alguns segundos e confere o jogo de novo antes de aceitar
        const r = await RS.rpc("place_bet_request", { p_selections: g, p_stake: stake });
        let id = r.bet;
        if (id == null) {
          for (let s = r.wait; s > 0; s--) { btnTxt(`Confirmando aposta… ${s}s`); await new Promise((res) => setTimeout(res, 1000)); }
          btnTxt("Conferindo o jogo…");
          id = await RS.rpc("place_bet_confirm", { p_request: r.request });
          if (id == null) throw new Error((await RS.rpc("place_bet_reason", { p_request: r.request })) || "Aposta recusada");
        }
        ok.push(id);
        if (!k) g.forEach((s) => slip.delete(s.match_id));
      }
      if (k) slip.clear();
      RS.toast(ok.length > 1 ? `${ok.length} apostas feitas! Boa sorte.` : `Aposta #${ok[0]} feita! Boa sorte.`, "ok");
      document.body.classList.remove("slip-open");
    } catch (e) {
      RS.toast((ok.length ? `${ok.length} aposta(s) feita(s). ` : "") + e.message, "error");
    }
    placing = "";
    RS.refreshBalance();
    render(); renderSlip(); persist();
  }

  async function placeFree(fb) {
    btnTxt("Enviando aposta grátis…");
    const sel = [...slip.entries()].map(([match_id, s]) => ({ match_id, market: s.market, pick: s.pick }));
    try {
      const id = await RS.rpc("place_freebet", { p_selections: sel, p_reward: fb.id });
      slip.clear(); fbSel = null;
      RS.toast(`Aposta grátis #${id} feita! Boa sorte.`, "ok");
      document.body.classList.remove("slip-open");
    } catch (e) { RS.toast(e.message, "error"); }
    placing = "";
    await loadFb();
    RS.refreshBalance();
    render(); renderSlip(); persist();
  }

  // ---------- eventos ----------
  document.addEventListener("click", (e) => {
    const t = e.target;
    const lb = t.closest("[data-lt]");
    if (lb) { lt = lb.dataset.lt; render(); return; }
    const v = t.closest("[data-view]");
    if (v) { setView(v.dataset.view); if (!v.matches("a")) scrollTo({ top: 0, behavior: "smooth" }); return; }
    const s = t.closest("[data-sport]");
    if (s) { sport = s.dataset.sport; render(); return; }
    const l = t.closest("[data-league]");
    if (l) {
      document.querySelector('[data-tabs] [data-tab="sports"]').click();
      document.body.classList.remove("menu-open");
      setView("all", { league: l.dataset.league });
      scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const d = t.closest("[data-day]");
    if (d) { dayOff = Number(d.dataset.day); render(); return; }
    const f = t.closest("[data-fav]");
    if (f) {
      const id = Number(f.dataset.fav);
      if (favs.has(id)) favs.delete(id); else favs.add(id);
      localStorage.setItem("rs-favs", JSON.stringify([...favs]));
      render(); return;
    }
    const bt = t.closest("[data-bb]");
    if (bt) { const id = Number(bt.dataset.bb); if (bbOn.has(id)) bbOn.delete(id); else bbOn.add(id); render(); return; }
    const mo = t.closest("[data-more]");
    if (mo) { mvId = Number(mo.dataset.more); mvTab = "all"; render(); loadMarkets([mvId]); return; }
    if (t.closest("[data-mvclose]")) { mvId = null; render(); return; }
    const mt = t.closest("[data-mvtab]");
    if (mt) { mvTab = mt.dataset.mvtab; render(); return; }
    const ma = t.closest("[data-mvacc]");
    if (ma) { const k = ma.dataset.mvacc; if (mvClosed.has(k)) mvClosed.delete(k); else mvClosed.add(k); render(); return; }
    if (t.closest("[data-mvall]")) {
      const keys = MV_GROUPS.map((g) => g.key), shut = keys.every((k) => mvClosed.has(k));
      keys.forEach((k) => (shut ? mvClosed.delete(k) : mvClosed.add(k))); render(); return;
    }
    const b = t.closest(".odd[data-id]");
    if (b) toggle(Number(b.dataset.id), b.dataset.pick, b.dataset.mk || "1x2");
  });
  RS.$("#slip-tabs").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b) { mode = b.dataset.mode; renderSlip(); } };
  RS.$("#slip-clear").onclick = () => { slip.clear(); render(); renderSlip(); persist(); };
  RS.$("#slip-save").onclick = () => {
    if (!slip.size) { RS.toast("Adicione seleções antes de guardar.", "error"); return; }
    localStorage.setItem("rs-saved-slip", code());
    RS.toast("Bilhete guardado neste aparelho.", "ok");
  };
  RS.$("#slip-share").onclick = async () => {
    if (!slip.size) { RS.toast("Adicione seleções para compartilhar.", "error"); return; }
    const url = `${location.origin}${location.pathname}?b=${code()}#sports`;
    try {
      if (navigator.share) await navigator.share({ title: "Meu bilhete Real Sports", url });
      else { await navigator.clipboard.writeText(url); RS.toast("Link do bilhete copiado!", "ok"); }
    } catch { /* cancelado */ }
  };
  slipEl.addEventListener("click", (e) => { if (e.target.id === "slip-load") restore(localStorage.getItem("rs-saved-slip")); });
  RS.$("#slip-fab").onclick = () => document.body.classList.add("slip-open");

  window.RSsports = {
    get matches() { return matches; },
    useFreebet(id) { fbSel = id; loadFb(); document.body.classList.toggle("slip-open", slip.size > 0); },
    suspended, setView,
    search(q) { document.querySelector('[data-tabs] [data-tab="sports"]').click(); setView("all", { query: q.trim() }); scrollTo({ top: 0 }); },
    add(sels, stake) {
      const next = new Map();
      sels.forEach(({ id, pick, market = "1x2" }) => {
        const m = matches.find((x) => x.id === id), odd = oddOf(m, market, pick);
        if (odd && !suspended(m)) next.set(id, { market, pick, odd, base: odd });
      });
      if (!next.size) return 0;
      slip.clear();
      next.forEach((v, k) => slip.set(k, v));
      mode = slip.size > 1 ? "multi" : "single";
      if (stake) stakeVal = String(stake);
      render(); renderSlip(); persist();
      document.body.classList.add("slip-open");
      return slip.size;
    },
  };

  loadFb();
  document.addEventListener("rs:balance", loadFb);

  // odds e placar ao vivo; várias linhas do sync chegam juntas e redesenham uma vez só
  let lastFull = 0, rtOk = false, queue = [], pend;
  const sportsOpen = () => !document.getElementById("sports")?.classList.contains("hidden");
  const needFeed = () => sportsOpen() || slip.size > 0;
  sb.channel("matches").on("postgres_changes", { event: "*", schema: "public", table: "matches" }, (payload) => {
    const row = payload.new?.id ? payload.new : null;
    const prev = row && matches.find((m) => m.id === row.id);
    const goal = !!row && !!prev && (Number(prev.score_home) !== Number(row.score_home) || Number(prev.score_away) !== Number(row.score_away));
    const locked = !!row && (row.locked || (row.suspended_until && new Date(row.suspended_until) > new Date()));
    if (row && (goal || locked)) document.dispatchEvent(new CustomEvent("rs:match-lock", { detail: [{ id: row.id, goal }] }));
    queue.push(payload);
    clearTimeout(pend);
    pend = setTimeout(() => { for (const p of queue) applyPayload(p); queue = []; paint(); }, 400);
  }).subscribe((status) => { rtOk = status === "SUBSCRIBED"; });
  // lista completa no máximo 1 vez por minuto com o socket saudável; a cada 15 s se ele cair
  setInterval(() => {
    if (document.hidden || !needFeed()) return;
    if (rtOk && Date.now() - lastFull < 60000) return;
    load();
  }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && needFeed()) load(); });
  document.addEventListener("rs:tab", (e) => {
    if (e.detail !== "sports") return;
    paint();
    if (!rtOk || Date.now() - lastFull > 60000) load();
  });

  (async () => {
    await load();
    const shared = new URLSearchParams(location.search).get("b");
    restore(shared || sessionStorage.getItem("rs-slip"));
    if (shared) { history.replaceState(null, "", location.pathname + location.hash); document.body.classList.add("slip-open"); }
  })();
})();
