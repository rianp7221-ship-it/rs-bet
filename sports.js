// =====================================================
//  sports.js — jogos, filtros, favoritos e bilhete de apostas
// =====================================================
(() => {
  const list = RS.$("#matches"), slipEl = RS.$("#slip"), box = RS.$("#slip-box");
  if (!list) return;
  const MAX = 12;
  const PICK = { home: "1", draw: "X", away: "2" };
  const CODE = { home: "h", draw: "d", away: "a" }, UNCODE = { h: "home", d: "draw", a: "away" };
  const MK = {
    dc: ["Chance Dupla", { "1x": "1X", x2: "X2", "12": "12" }],
    ou25: ["Total de Gols 2,5", { over: "Mais de 2,5", under: "Menos de 2,5" }],
    btts: ["Ambas Marcam", { yes: "Sim", no: "Não" }],
    dnb: ["Empate Anula", { home: "1", away: "2" }],
    ou15: ["Total de Gols 1,5", { over: "Mais de 1,5", under: "Menos de 1,5" }],
    ou35: ["Total de Gols 3,5", { over: "Mais de 3,5", under: "Menos de 3,5" }],
  };
  const oddOf = (m, mk, pick) => mk === "bb" ? bbOdd(m, pick) : Number(mk === "1x2" ? m?.["odd_" + pick] : m?.markets?.[mk]?.[pick]) || 0;
  // Criar Aposta: mesmo modelo de Poisson do servidor (_bb_odd); o servidor recalcula a odd ao apostar
  const BB_MK = ["1x2", "ou15", "ou25", "ou35", "btts", "dc"], BB_MAX = 4;
  let bbMargin = 10;
  sb.rpc("bb_params").then(({ data }) => { if (data?.margin != null) bbMargin = Number(data.margin); });
  const legsOf = (s) => (s ? (s.market === "bb" ? s.pick.split("|").map((l) => l.split(":")) : [[s.market, s.pick]]) : []);
  const legWon = (mk, p, h, a) => {
    if (mk === "1x2") return (h > a ? "home" : h < a ? "away" : "draw") === p;
    if (mk === "btts") return (h > 0 && a > 0) === (p === "yes");
    if (mk === "dc") return p === "1x" ? h >= a : p === "x2" ? h <= a : h !== a;
    return (h + a > { ou15: 1.5, ou25: 2.5, ou35: 3.5 }[mk]) === (p === "over");
  };
  const bbReady = (m) => !!m && m.status === "open" && m.bb_lh != null && new Date(m.starts_at) > new Date();
  function bbOdd(m, pick) {
    const legs = String(pick).split("|").map((l) => l.split(":"));
    if (!bbReady(m) || legs.length < 2 || legs.length > BB_MAX || new Set(legs.map((l) => l[0])).size !== legs.length) return 0;
    let prod = 1;
    for (const [mk, p] of legs) {
      const o = BB_MK.includes(mk) ? oddOf(m, mk, p) : 0;
      if (!(o > 1)) return 0;
      prod *= o;
    }
    const pois = (l) => { const r = [Math.exp(-l)]; for (let i = 1; i <= 10; i++) r.push((r[i - 1] * l) / i); return r; };
    const ph = pois(Number(m.bb_lh)), pa = pois(Number(m.bb_la));
    let pr = 0;
    for (let h = 0; h <= 10; h++) for (let a = 0; a <= 10; a++) if (legs.every(([mk, p]) => legWon(mk, p, h, a))) pr += ph[h] * pa[a];
    if (pr < 0.002) return 0;
    const v = Math.round(Math.min(prod, (1 / pr) * (1 - bbMargin / 100)) * 100) / 100;
    return v >= 1.05 ? v : 0;
  }
  const bbOn = new Set();
  const extras = (m) => Object.keys(MK).filter((k) => m.markets?.[k]);
  const openMk = new Set();
  const isSel = (id, mk, pick) => legsOf(slip.get(id)).some(([k, p]) => k === mk && p === pick);
  const ICON = { Futebol: "⚽", Basquete: "🏀", "Tênis": "🎾", "Vôlei": "🏐", "Futebol Americano": "🏈", Beisebol: "⚾", "Hóquei": "🏒", MMA: "🥊", "E-sports": "🎮" };
  const icon = (s) => ICON[s] || "🏅";
  const FLAGS = [[/brazil|brasil|brasileir/i, "🇧🇷"], [/epl|premier|england|fa cup|championship/i, "🏴󠁧󠁢󠁥󠁮󠁧󠁿"], [/spain|la ?liga/i, "🇪🇸"],
    [/italy/i, "🇮🇹"], [/germany|bundesliga/i, "🇩🇪"], [/france|ligue 1/i, "🇫🇷"], [/portugal/i, "🇵🇹"], [/argentin/i, "🇦🇷"],
    [/nba|nfl|mlb|nhl|ncaa|usa|mls/i, "🇺🇸"], [/uefa|champions|europa/i, "🇪🇺"], [/libertadores|sudamericana|conmebol/i, "🌎"]];
  const flag = (l) => (FLAGS.find(([r]) => r.test(l)) || [null, "🌍"])[1];
  const LEAGUE_PT = { "Brazil Série A": "Brasileirão Série A", "Brazil Série B": "Brasileirão Série B", EPL: "Premier League",
    "UEFA Champions League": "Liga dos Campeões da UEFA", "UEFA Europa League": "Liga Europa da UEFA", "La Liga - Spain": "La Liga", "Serie A - Italy": "Serie A Itália" };
  const lname = (l) => LEAGUE_PT[l] || l;
  function shirt(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<svg class="shirt" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.8 1.6-2.2 2.4-4 2.4S8.8 4.6 8 3z" fill="hsl(${h},55%,42%)"/></svg>`;
  }

  let matches = [], sport = "Popular", view = "all", league = null, lt = "games", query = "", dayOff = 0, mode = "multi", stakeVal = "";
  const slip = new Map(); // match_id -> { market, pick, odd, base }
  const favs = new Set(JSON.parse(localStorage.getItem("rs-favs") || "[]"));
  const live = (m) => m.status === "live";
  const suspended = (m) => !!m && (m.locked || (m.suspended_until && new Date(m.suspended_until) > new Date()));
  const sameDay = (d, off) => { const a = new Date(d), b = new Date(); b.setDate(b.getDate() + off); return a.toDateString() === b.toDateString(); };
  const hhmm = (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ddmm = (d) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const dayLabel = (d) => (sameDay(d, 0) ? "Hoje" : sameDay(d, 1) ? "Amanhã" : ddmm(d));
  const code = () => [...slip].map(([id, s]) => (s.market === "1x2" ? id + CODE[s.pick] : `${id}~${s.market}.${s.pick}`)).join(",");
  const persist = () => sessionStorage.setItem("rs-slip", code());
  const num = (v) => Number(String(v).replace(",", ".")) || 0;
  const mobile = () => matchMedia("(max-width: 1000px)").matches;
  const KP = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

  async function load() {
    const { data, error } = await sb.from("matches").select("*").in("status", ["open", "live"]).order("starts_at");
    if (error) { list.innerHTML = `<p class="empty">Erro ao carregar jogos.</p>`; return; }
    matches = data;
    for (const [id, s] of slip) {
      const m = matches.find((x) => x.id === id);
      const cur = oddOf(m, s.market, s.pick);
      if (!cur) { slip.delete(id); continue; }
      s.odd = cur;
    }
    render();
    if (document.activeElement?.id !== "stake") renderSlip();
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
      <div class="row-time">${live(m) ? `<i class="live">${m.minute ? m.minute + "'" : "AO VIVO"}</i>${score(m)}` : `${ddmm(m.starts_at)} <br>${hhmm(m.starts_at)}`}</div>
      <div class="row-teams"><span>${shirt(m.home)}${RS.esc(m.home)}</span><span>${shirt(m.away)}${RS.esc(m.away)}</span>
        <small>${flag(m.league)} ${RS.esc(lname(m.league))}</small></div>
      <div class="row-odds">${odds(m)}</div>
      <button class="fav ${favs.has(m.id) ? "on" : ""}" data-fav="${m.id}" aria-label="Favoritar">${RS.icon("star")}</button>
      ${extras(m).length ? `<button class="more-mk ${openMk.has(m.id) ? "on" : ""}" data-more="${m.id}">+${extras(m).length} mercados</button>` : ""}
    </div>${openMk.has(m.id) ? panel(m) : ""}`;

  // mercados extras do jogo (Chance Dupla, Total de Gols, Ambas Marcam, Empate Anula)
  const panel = (m) => {
    const bb = bbOn.has(m.id);
    return `<div class="mk-panel">${bbReady(m) ? `<div class="bb-bar"><span>Combine até ${BB_MAX} mercados deste jogo numa aposta só</span>
      <button class="bb-toggle ${bb ? "on" : ""}" data-bb="${m.id}" aria-pressed="${bb}">CRIAR<br>APOSTA</button></div>` : ""}
    ${extras(m).filter((k) => !bb || BB_MK.includes(k)).map((k) => `<div class="mk-group"><h4>${MK[k][0]}</h4>
      <div class="odds">${Object.entries(MK[k][1]).map(([p, label]) => {
        const odd = oddOf(m, k, p);
        if (!odd || suspended(m)) return `<button class="odd" disabled><small>${label}</small><b>${RS.icon("lock")}</b></button>`;
        return `<button class="odd ${isSel(m.id, k, p) ? "selected" : ""}" data-id="${m.id}" data-mk="${k}" data-pick="${p}"><small>${label}</small><b>${odd.toFixed(2)}</b></button>`;
      }).join("")}</div></div>`).join("")}</div>`;
  };

  function feat(m) {
    const sp = "sp-" + m.sport.normalize("NFD").replace(/[^\w]/g, "").toLowerCase();
    const top = live(m)
      ? `<i class="live">${m.minute ? m.minute + "' AO VIVO" : "AO VIVO"}</i>${m.score_home != null ? ` ${m.score_home} - ${m.score_away}` : ""}`
      : `${RS.icon("clock")} ${dayLabel(m.starts_at)} ${hhmm(m.starts_at)}`;
    return `<div class="feat-card ${sp}"><div class="feat-top">${top}</div>
      <div class="feat-teams"><b>${shirt(m.home)}${RS.esc(m.home)}</b><b>${shirt(m.away)}${RS.esc(m.away)}</b></div>${odds(m)}</div>`;
  }

  function visible() {
    const q = query.toLowerCase(), now = Date.now();
    return matches.filter((m) =>
      (sport === "Popular" || m.sport === sport) &&
      (!league || (m.league === league && (lt !== "live" || live(m)))) &&
      (!q || `${m.home} ${m.away} ${m.league} ${lname(m.league)}`.toLowerCase().includes(q)) &&
      (view === "all" ||
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
    RS.$("#comp-list").innerHTML = Object.entries(byLeague).sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([l, v]) =>
      `<button class="comp-item ${league === l ? "active" : ""}" data-league="${RS.esc(l)}"><span class="comp-ico">${flag(l)}</span>
        <span><b>${RS.esc(lname(l))}</b><small>${RS.esc(v.sport)}</small></span><em>${v.n}</em></button>`).join("")
      || `<p class="muted small" style="padding:0 6px">Sem competições no momento.</p>`;

    const count = {};
    matches.filter((m) => view !== "live" || live(m)).forEach((m) => (count[m.sport] = (count[m.sport] || 0) + 1));
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
    const top = [...matches.filter(live), ...matches.filter((m) => !live(m))].filter((m) => !suspended(m)).slice(0, 6);
    RS.$("#feat-cards").classList.toggle("hidden", !home || !top.length);
    RS.$("#feat-cards").innerHTML = home ? top.map(feat).join("") : "";
    RS.$("#casino-strip").classList.toggle("hidden", !home);
    const pop = Object.entries(byLeague).sort((a, b) => b[1].n - a[1].n).slice(0, 10);
    RS.$("#league-sec").classList.toggle("hidden", !home || !pop.length);
    RS.$("#league-chips").innerHTML = home ? pop.map(([l]) =>
      `<button class="league-chip" data-league="${RS.esc(l)}"><span class="comp-ico">${flag(l)}</span>${RS.esc(lname(l))}</button>`).join("") : "";
    const lh = RS.$("#league-head");
    lh.classList.toggle("hidden", !league);
    RS.$(".action-head").classList.toggle("hidden", !!league);
    if (league) {
      const inL = matches.filter((m) => m.league === league), nLive = inL.filter(live).length;
      lh.innerHTML = `<div class="lh-top"><span class="lh-ico">${flag(league)}</span><h1>${RS.esc(lname(league))}</h1></div>
        <div class="lh-tabs"><button class="${lt === "games" ? "active" : ""}" data-lt="games">Jogos <em>${inL.length}</em></button>
          <button class="${lt === "live" ? "active" : ""}" data-lt="live">Ao vivo <em>${nLive}</em></button>
          <button data-view="all">Todas as ligas</button></div>`;
    }
    RS.$("#list-title").textContent = query ? `Busca: "${query}"` : league ? lname(league) : view === "live" ? `Jogos ao vivo (${matches.filter(live).length})` : TITLE[view];
    RS.$$("[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === view && !league && !query));

    const rows = visible();
    const reset = home ? "" : `<div class="filter-bar"><button class="btn btn-outline sm" data-view="all">Ver todos os jogos</button></div>`;
    list.innerHTML = reset + (rows.length ? rows.map(row).join("")
      : `<p class="empty">${view === "fav" ? "Toque na estrela de um jogo para salvá-lo nos favoritos." : "Nenhum jogo disponível no momento."}</p>`);
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
    if (bbOn.has(id) && bbReady(m) && BB_MK.includes(market)) {
      let legs = legsOf(cur).filter(([k]) => BB_MK.includes(k));
      if (legs.some(([k, p]) => k === market && p === pick)) legs = legs.filter(([k]) => k !== market);
      else if (legs.some(([k]) => k === market)) legs = legs.map(([k, p]) => [k, k === market ? pick : p]);
      else if (legs.length >= BB_MAX) { RS.toast(`Criar Aposta: até ${BB_MAX} mercados por jogo.`, "error"); return; }
      else legs.push([market, pick]);
      if (!cur && slip.size >= MAX) { RS.toast(`Máximo de ${MAX} seleções por bilhete.`, "error"); return; }
      if (!legs.length) slip.delete(id);
      else {
        const [mk, pk] = legs.length > 1 ? ["bb", legs.map((l) => l.join(":")).join("|")] : legs[0];
        const odd = oddOf(m, mk, pk);
        if (!odd) { RS.toast("Essa combinação não está disponível.", "error"); return; }
        slip.set(id, { market: mk, pick: pk, odd, base: odd });
      }
    } else if (cur?.market === market && cur.pick === pick) slip.delete(id);
    else {
      if (!slip.has(id) && slip.size >= MAX) { RS.toast(`Máximo de ${MAX} seleções por bilhete.`, "error"); return; }
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
      if (odd && !suspended(m) && (slip.has(id) || slip.size < MAX)) slip.set(id, { market, pick, odd, base: odd });
    }
    render(); renderSlip(); persist();
  }

  function renderSlip() {
    const items = [...slip.entries()].filter(([id]) => matches.some((m) => m.id === id));
    const n = items.length;
    const total = items.reduce((a, [, s]) => a * s.odd, 1);
    const saved = localStorage.getItem("rs-saved-slip");
    RS.$("#slip-count").textContent = `${n}/${MAX}`;
    box.classList.toggle("empty", !n && !saved);
    RS.$("#slip-fab").classList.toggle("hidden", !n);
    RS.$("#fab-odd").textContent = total.toFixed(2);
    RS.$("#fab-count").textContent = n;
    RS.$("#bn-count").textContent = n;
    RS.$("#bn-count").classList.toggle("hidden", !n);
    if (!n) document.body.classList.remove("slip-open");
    const multi = mode === "multi" && n > 1;
    RS.$$("#slip-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === (multi ? "multi" : "single")));
    if (!n) {
      slipEl.innerHTML = `<div class="slip-empty">Seu bilhete está vazio.${saved ? `<br><button class="btn btn-outline sm" id="slip-load" style="margin-top:10px">Carregar bilhete guardado</button>` : ""}</div>`;
      return;
    }
    const anySusp = items.some(([id]) => suspended(matches.find((m) => m.id === id)));
    slipEl.innerHTML = items.map(([id, s]) => {
      const m = matches.find((x) => x.id === id);
      const name = (mk, p) => (mk === "1x2" || mk === "dnb" ? (p === "home" ? m.home : p === "away" ? m.away : "Empate") : MK[mk][1][p]);
      const mkName = (mk) => (mk === "1x2" ? "Resultado Final" : MK[mk][0]);
      const up = s.odd > s.base;
      return `<div class="slip-item">
        <div class="si-main">${s.market === "bb"
          ? `<b class="si-bb">${RS.icon("ball")} Criar Aposta</b><small>${RS.esc(m.home)} - ${RS.esc(m.away)}</small>
            <ul class="si-legs">${legsOf(s).map(([k, p]) => `<li><b>${RS.esc(name(k, p))}</b><small>${mkName(k)}</small></li>`).join("")}</ul>`
          : `<b>${icon(m.sport)} ${RS.esc(name(s.market, s.pick))}</b><small class="si-mkt">${mkName(s.market)}</small>
          <small>${RS.esc(m.home)}<br>${RS.esc(m.away)}</small>`}
          ${suspended(m) ? `<small class="si-lock">${RS.icon("lock")} Mercado suspenso</small>` : ""}</div>
        <div class="si-odd">${s.odd !== s.base
          ? `<s>${s.base.toFixed(2)}</s><span class="${up ? "up" : "down"}">${up ? "▲" : "▼"} ${s.odd.toFixed(2)}</span>`
          : `<span>${s.odd.toFixed(2)}</span>`}</div>
        <button class="slip-x" data-rm="${id}" aria-label="Remover">${RS.icon("trash")}</button></div>`;
    }).join("") + `
      <div class="stake-row"><span>${multi ? `Múltipla ${n} seleções` : n > 1 ? `Simples · ${n} apostas` : "Simples"}</span>${multi ? `<b>${total.toFixed(2)}</b>` : ""}
        <label class="stake"><i>R$</i><input id="stake" type="text" inputmode="${mobile() ? "none" : "decimal"}" autocomplete="off" placeholder="0,00" value="${stakeVal}"></label></div>
      <div class="quick"><button data-stake="10">+10</button><button data-stake="50">+50</button><button data-stake="200">+200</button><button data-stake="max">MÁX</button></div>
      <div class="keypad">${KP.map((k) => `<button data-kp="${k}">${k === "del" ? "⌫" : k}</button>`).join("")}</div>
      ${!multi && n > 1 ? `<div class="slip-total"><span>Total apostado</span><b id="slip-total"></b></div>` : ""}
      <button class="btn btn-green w-full" id="place" ${anySusp ? "disabled" : ""}>
        <b>${anySusp ? "Seleção suspensa" : `Apostar agora <span id="pl-stake"></span>`}</b>
        <small>Ganhos potenciais <span id="slip-return"></span></small></button>`;

    const stake = RS.$("#stake");
    const upd = () => {
      stakeVal = stake.value;
      const v = num(stake.value);
      RS.$("#slip-return").textContent = RS.money(multi ? v * Number(total.toFixed(2)) : items.reduce((a, [, s]) => a + v * s.odd, 0));
      const ps = RS.$("#pl-stake");
      if (ps) ps.textContent = RS.money(multi ? v : v * n);
      const t = RS.$("#slip-total");
      if (t) t.textContent = RS.money(v * n);
    };
    stake.oninput = upd;
    upd();
    RS.$$("[data-stake]", slipEl).forEach((c) => (c.onclick = async () => {
      if (c.dataset.stake === "max") {
        const p = await RS.profile();
        if (!p) { location.href = "login.html"; return; }
        stake.value = Math.floor((Number(p.balance) / (multi ? 1 : n)) * 100) / 100;
      } else stake.value = Math.round((num(stake.value) + Number(c.dataset.stake)) * 100) / 100;
      upd();
    }));
    RS.$$("[data-kp]", slipEl).forEach((c) => (c.onclick = () => {
      const k = c.dataset.kp, v = String(stake.value).replace(",", ".");
      stake.value = k === "del" ? v.slice(0, -1) : k === "." ? (v.includes(".") ? v : (v || "0") + ".") : /\.\d{2}$/.test(v) || v.length >= 9 ? v : v === "0" ? k : v + k;
      upd();
    }));
    RS.$$("[data-rm]", slipEl).forEach((c) => (c.onclick = () => { slip.delete(Number(c.dataset.rm)); render(); renderSlip(); persist(); }));
    RS.$("#place").onclick = () => place(multi);
  }

  async function place(multi) {
    if (!(await RS.user())) { location.href = "login.html"; return; }
    const btn = RS.$("#place");
    const stake = num(RS.$("#stake").value);
    if (!(stake > 0)) { RS.toast("Digite o valor da aposta.", "error"); return; }
    btn.disabled = true;
    const sel = [...slip.entries()].map(([match_id, s]) => ({ match_id, market: s.market, pick: s.pick }));
    const groups = multi ? [sel] : sel.map((s) => [s]);
    const ok = [];
    try {
      for (const g of groups) {
        ok.push(await RS.rpc("place_bet", { p_selections: g, p_stake: stake }));
        g.forEach((s) => slip.delete(s.match_id));
      }
      RS.toast(ok.length > 1 ? `${ok.length} apostas feitas! Boa sorte.` : `Aposta #${ok[0]} feita! Boa sorte.`, "ok");
      document.body.classList.remove("slip-open");
    } catch (e) {
      RS.toast((ok.length ? `${ok.length} aposta(s) feita(s). ` : "") + e.message, "error");
    }
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
    if (mo) { const id = Number(mo.dataset.more); if (openMk.has(id)) openMk.delete(id); else openMk.add(id); render(); return; }
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

  // odds e placar ao vivo; suspensões que expiram
  let pend;
  sb.channel("matches").on("postgres_changes", { event: "*", schema: "public", table: "matches" },
    () => { clearTimeout(pend); pend = setTimeout(load, 400); }).subscribe();
  setInterval(() => { if (!document.hidden) render(); }, 30000);

  (async () => {
    await load();
    const shared = new URLSearchParams(location.search).get("b");
    restore(shared || sessionStorage.getItem("rs-slip"));
    if (shared) { history.replaceState(null, "", location.pathname + location.hash); document.body.classList.add("slip-open"); }
  })();
})();
