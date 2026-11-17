// =====================================================
//  history.js — histórico de apostas, cassino e extrato
// =====================================================
(() => {
  const box = RS.$("#history-list");
  if (!box) return;
  let kind = "bets";
  const STATUS = { pending: "Aberta", won: "Ganhou", lost: "Perdeu", canceled: "Cancelada", done: "Concluída", rejected: "Recusada", active: "Em jogo", cashout: "Cashout" };
  const PICK = { home: "Casa", draw: "Empate", away: "Fora", over: "Mais", under: "Menos", yes: "Sim", no: "Não", "1x": "1X", x2: "X2", "12": "12" };
  const MKT = { dc: "Chance Dupla", ou15: "Gols 1,5", ou25: "Gols 2,5", ou35: "Gols 3,5", btts: "Ambas Marcam", dnb: "Empate Anula" };
  const badge = (s) => `<span class="badge b-${s}">${STATUS[s] || s}</span>`;
  // cashout acima do apostado = verde, abaixo = vermelho
  const betBadge = (b) => (b.status === "cashout" ? RS.betBadge(b) : badge(b.status));
  const TYPE = (n) => (n === 1 ? "Simples" : n === 2 ? "Dupla" : n === 3 ? "Tripla" : "Múltipla");
  const MNAME = { "1x2": "Resultado Final", boost: "Resultado Final · Odd turbinada", ou15: "Total de Gols", ou25: "Total de Gols", ou35: "Total de Gols", btts: "Ambas Marcam", btts1: "Ambas Marcam 1º Tempo", btts2: "Ambas Marcam 2º Tempo", ht1x2: "Resultado 1º Tempo", ou05: "Total de Gols", ou45: "Total de Gols", ou55: "Total de Gols", dc: "Chance Dupla", dnb: "Empate Anula", c1x2: "Escanteios 1X2", s1x2: "Chutes 1X2", t1x2: "Chutes no Gol 1X2", eg: "Gols Exatos", cs: "Placar Exato" };
  const mname = (mk) => MNAME[mk] || (/^ou\d{4,}$/.test(mk) ? "Total de Pontos" : /^hc[mp]\d+$/.test(mk) ? "Handicap de Pontos" : /^co\d+$/.test(mk) ? "Total de Escanteios" : /^k\d+$/.test(mk) ? "Total de Cartões" : PXN[mk.replace(/\d+$/, "")] && /\d$/.test(mk) ? PXN[mk.replace(/\d+$/, "")] : /^s\d+$/.test(mk) ? "Total de Chutes" : /^t\d+$/.test(mk) ? "Total de Chutes no Gol" : RS.esc(mk));
  const LINE = { ou05: "0,5", ou15: "1,5", ou25: "2,5", ou35: "3,5", ou45: "4,5", ou55: "5,5" };
  const PXN = { hto: "Gols 1º Tempo", gh: "Gols Casa", ga: "Gols Fora", ch: "Escanteios Casa", ca: "Escanteios Fora", kh: "Cartões Casa", ka: "Cartões Fora", sh: "Chutes Casa", sa: "Chutes Fora" };
  let bets = [], betTab = "open", betFilter = "";
  const folded = new Set();

  function selName(s) {
    const { home, away } = s.matches, mk = s.market || "1x2";
    if (mk === "bb") return "Criar Aposta";
    if (mk === "cs") return `${s.pick[1]} - ${s.pick[2]}`;
    if (mk === "eg") return `Exatamente ${s.pick.slice(1)} ${s.pick === "g1" ? "gol" : "gols"}`;
    if (/^ou\d{4,}$/.test(mk)) return `${s.pick === "over" ? "Mais" : "Menos"} de ${(Number(mk.slice(2)) / 10).toLocaleString("pt-BR")} pontos`;
    if (/^hc[mp]\d+$/.test(mk)) { const v = (mk[2] === "m" ? -1 : 1) * (s.pick === "home" ? 1 : -1) * Number(mk.slice(3)) / 10; return `${s.pick === "home" ? home : away} ${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR")}`; }
    if (LINE[mk]) return `${s.pick === "over" ? "Mais" : "Menos"} de ${LINE[mk]}`;
    if (/^k\d+$/.test(mk)) return `${s.pick === "over" ? "Mais" : "Menos"} de ${(Number(mk.slice(1)) / 10).toLocaleString("pt-BR")} cartões`;
    if (/^(hto|gh|ga|ch|ca|kh|ka|sh|sa)\d+$/.test(mk)) return `${s.pick === "over" ? "Mais" : "Menos"} de ${(Number(mk.replace(/^[a-z]+/, "")) / 10).toLocaleString("pt-BR")}`;
    if (/^[st]\d+$/.test(mk)) return `${s.pick === "over" ? "Mais" : "Menos"} de ${(Number(mk.slice(1)) / 10).toLocaleString("pt-BR")} ${mk[0] === "s" ? "chutes" : "chutes no gol"}`;
    if (/^co\d+$/.test(mk)) return `${s.pick === "over" ? "Mais" : "Menos"} de ${(Number(mk.slice(2)) / 10).toLocaleString("pt-BR")} escanteios`;
    if (/^btts[12]?$/.test(mk)) return s.pick === "yes" ? "Sim" : "Não";
    if (mk === "dc") return { "1x": `${home} ou Empate`, x2: `Empate ou ${away}`, "12": `${home} ou ${away}` }[s.pick] || s.pick;
    return s.pick === "home" ? home : s.pick === "away" ? away : "Empate";
  }
  // Criar Aposta: status de cada perna com o placar/estatísticas atuais (indicativo; a liquidação oficial é no fim do jogo).
  // "won" = já garantida, "lost" = já impossível, null = em aberto. Com o jogo encerrado, avalia o resultado final.
  const STAT = { c: "corners", k: "cards", s: "shots", t: "sot" };
  const STAT_NAME = { corners: "Escanteios", cards: "Cartões", shots: "Chutes", sot: "Chutes no gol" };
  // a API preenche o placar do intervalo já durante o 1º tempo (0 x 0 aos 5'): só vale depois do 1º tempo
  const htFinal = (m) => m.ht_home != null && m.ht_away != null && !["1H", "NS"].includes(m.period);
  function legStat(mk, m) {
    const g = /^(ou|gh|ga|hto)\d+$/.test(mk) ? mk.replace(/\d+$/, "") : null;
    if (g) {
      if (g === "hto") return htFinal(m) ? m.ht_home + m.ht_away : m.score_home != null ? m.score_home + m.score_away : null;
      if (m.score_home == null) return null;
      return g === "gh" ? m.score_home : g === "ga" ? m.score_away : m.score_home + m.score_away;
    }
    const x = /^(co|k|s|t)\d+$/.exec(mk) || /^([cst])(1x2)$/.exec(mk) || /^([cks])([ha])\d+$/.exec(mk);
    if (!x) return null;
    const f = STAT[x[1][0]], h = m[f + "_home"], a = m[f + "_away"];
    if (h == null || a == null) return null;
    return x[2] === "h" ? h : x[2] === "a" ? a : x[2] === "1x2" ? [h, a] : h + a;
  }
  function legState(mk, pick, m) {
    if (!m || m.score_home == null) return null;
    const done = !["live", "open"].includes(m.status) && m.status != null;
    const h = m.score_home, a = m.score_away, ht = htFinal(m), h1 = m.ht_home, a1 = m.ht_away;
    const res = (x, y) => (x > y ? "home" : x < y ? "away" : "draw");
    const yes = pick === "yes" || pick === "over", line = Number(mk.replace(/^[a-z]+/, "")) / 10;
    const ou = (v, firstHalfOver) => (v == null ? null : v > line ? (yes ? "won" : "lost") : done || firstHalfOver ? (yes ? "lost" : "won") : null);
    if (mk === "1x2" || mk === "dc" || mk === "dnb") {
      if (!done) return null;
      const r = res(h, a);
      if (mk === "dnb") return r === "draw" ? null : r === pick ? "won" : "lost";
      if (mk === "dc") return (pick === "1x" ? h >= a : pick === "x2" ? h <= a : h !== a) ? "won" : "lost";
      return r === pick ? "won" : "lost";
    }
    if (mk === "btts") return h > 0 && a > 0 ? (yes ? "won" : "lost") : done ? (yes ? "lost" : "won") : null;
    if (mk === "eg") return h + a > Number(pick.slice(1)) ? "lost" : done ? (h + a === Number(pick.slice(1)) ? "won" : "lost") : null;
    if (mk === "cs") return h > Number(pick[1]) || a > Number(pick[2]) ? "lost" : done ? (h === Number(pick[1]) && a === Number(pick[2]) ? "won" : "lost") : null;
    // 1º tempo sem o placar do intervalo: só dá para avaliar com o 1º tempo ainda em andamento
    if (!ht && /^(ht1x2|btts1|hto\d+)$/.test(mk) && m.period !== "1H") return null;
    if (mk === "ht1x2") return ht ? (res(h1, a1) === pick ? "won" : "lost") : null;
    if (mk === "btts1") { const x = ht ? h1 : h, y = ht ? a1 : a; return x > 0 && y > 0 ? (yes ? "won" : "lost") : ht ? (yes ? "lost" : "won") : null; }
    if (mk === "btts2") { if (!ht) return null; const x = h - h1, y = a - a1; return x > 0 && y > 0 ? (yes ? "won" : "lost") : done ? (yes ? "lost" : "won") : null; }
    if (/^hto\d+$/.test(mk)) return ou(legStat(mk, m), ht);
    const v = legStat(mk, m);
    if (Array.isArray(v)) return done ? (res(v[0], v[1]) === pick ? "won" : "lost") : null;
    return /^(ou|gh|ga)\d+$/.test(mk) || /^(c|k|s|t)/.test(mk) ? ou(v, false) : null;
  }
  // texto curto do andamento da perna (ex.: "Escanteios 7/10")
  function legNow(mk, pick, m) {
    const v = legStat(mk, m);
    if (v == null) return "";
    const f = /^(c|k|s|t)/.test(mk) ? STAT_NAME[STAT[mk[0]]] : "Gols";
    if (Array.isArray(v)) return `${f} ${v[0]} - ${v[1]}`;
    const need = Math.floor(Number(mk.replace(/^[a-z]+/, "")) / 10) + 1;
    return pick === "over" ? `${f} ${Math.min(v, need)}/${need}` : `${f} ${v} (máx. ${need - 1})`;
  }
  const legLive = (s) => s.status === "pending" && s.matches.status === "live";
  const legShow = (s) => legLive(s) || ["won", "lost"].includes(s.status);
  const legList = (s) => s.pick.split("|").map((l) => { const [market, pick] = l.split(":");
    const st = legShow(s) ? legState(market, pick, s.matches) : null, now = legLive(s) ? legNow(market, pick, s.matches) : "";
    return `<li class="lg-${st || "open"}"><b>${RS.esc(selName({ ...s, market, pick }))}</b><small>${mname(market)}${now ? ` · <em>${RS.esc(now)}</em>` : ""}</small></li>`; }).join("")
    + (legLive(s) ? `<li class="lg-note">Status ao vivo indicativo · a liquidação oficial é no fim do jogo</li>` : "");
  function when(iso) {
    const d = new Date(iso), hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    if (days === 0) return (d.getHours() >= 18 ? "Esta noite " : "Hoje ") + hm;
    if (days === 1) return "Amanhã " + hm;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + hm;
  }
  const isLive = (s) => s.status === "pending" && s.matches.status === "live";
  const isFar = (s) => s.status === "pending" && new Date(s.matches.starts_at) - Date.now() > 7 * 864e5;
  // relógio do jogo: tempo exato do 365Scores (clock_secs em clock_at); sem ele, minuto da fonte + segundos contados aqui
  const seen = new Map();
  function clock(m) {
    if (m.period === "HT") return "Intervalo";
    if (/^(Q\d|Intervalo|Prorroga|Primeiro|Segundo|OT)/i.test(m.period || "")) return m.period;
    const age = (Date.now() - Date.parse(m.clock_at || "")) / 1000;
    if (age >= 0 && age < 60) {
      const t = m.clock_secs + Math.floor(age);
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    }
    if (m.minute == null) return "AO VIVO";
    const v = seen.get(m.id);
    if (!v || v.min !== m.minute) seen.set(m.id, { min: m.minute, t: Date.now() });
    const sec = Math.floor((Date.now() - seen.get(m.id).t) / 1000);
    return sec > 75 ? `${m.minute}'` : `${m.minute}:${String(Math.min(sec, 59)).padStart(2, "0")}`;
  }
  const scoreCol = (m) => (m.score_home != null ? `<span class="bc-score"><b>${m.score_home}</b><b>${m.score_away}</b></span>` : "");
  function selState(s) {
    const m = s.matches;
    if (isLive(s)) return `<span class="bc-clock">⚡<b data-clock="${s.match_id}">${clock({ ...m, id: s.match_id })}</b></span>${scoreCol(m)}${m.ext365_id ? `<button class="bc-track" data-track="${s.match_id}" aria-label="Acompanhar jogo">${RS.icon("chart")}</button>` : ""}`;
    if (s.status === "canceled") return `<span class="badge b-void">Devolvida</span>`;
    if (s.status !== "pending" || m.status !== "open") return scoreCol(m) || badge(s.status);
    return `<span class="bc-when">${when(m.starts_at)}</span>`;
  }
  setInterval(() => {
    for (const el of RS.$$("[data-clock]", box)) {
      const s = bets.flatMap((b) => b.bet_selections).find((x) => x.match_id === Number(el.dataset.clock));
      if (s) el.textContent = clock({ ...s.matches, id: s.match_id });
    }
  }, 1000);
  const logo = (u) => (/^https:\/\/[\w.-]+\//.test(u || "") ? `<img class="crest" src="${RS.esc(u)}" alt="" loading="lazy">` : "");
  const mark = (s) => (s.status === "won" ? `<i class="leg-ok" title="Ganhou">✓</i>` : s.status === "lost" ? `<i class="leg-ko" title="Perdeu">✕</i>` : "");
  function winLine(b) {
    if (b.status === "cashout") return ["Cashout recebido", b.cashout_amount];
    if (b.status === "won") return ["Ganhos", b.potential];
    if (b.status === "canceled") return ["Valor devolvido", b.stake];
    if (b.status === "lost") return ["Ganhos", 0];
    return ["Ganhos Potenciais", b.potential];
  }
  // seleção devolvida (jogo adiado/cancelado) vale odd 1; igual ao _resolve_bet
  const selOdd = (s) => (s.status === "canceled" ? 1 : Number(s.odd));
  const betOdd = (b) => {
    const sels = b.bet_selections;
    if (!sels.some((s) => s.status === "canceled")) return Number(b.total_odd);
    const all = sels.reduce((x, s) => x * Number(s.odd), 1), left = sels.reduce((x, s) => x * selOdd(s), 1);
    return all > Number(b.total_odd) + 0.01 ? Math.min(left, Number(b.total_odd)) : left;
  };
  const card = (b) => {
    const sels = b.bet_selections, [wl, wv] = winLine(b);
    return `<div class="bet-card${folded.has(b.id) ? " closed" : ""}" data-bet="${b.id}">
      <div class="bc-head" data-fold="${b.id}"><b>${TYPE(sels.length)}${b.freebet_id ? ` <span class="badge b-fb">Grátis</span>` : ""}</b><span>${RS.money(b.stake)}</span>${b.status !== "pending" ? betBadge(b) : ""}
        <span class="bc-odd">${betOdd(b).toFixed(2)}</span><i class="bc-chev"></i></div>
      <div class="bc-body">
        ${sels.map((s) => `<div class="bc-sel" data-m="${s.match_id}">
          <div class="bc-l1">${RS.icon("ball")}<b${s.market === "bb" ? ' class="bc-bb"' : ""}>${RS.esc(selName(s))}</b>${mark(s)}${s.boosted ? `<em class="bc-boost">${RS.icon("bolt")}</em>` : ""}<span>${selOdd(s).toFixed(2)}</span></div>
          ${s.boosted ? `<div class="bc-boost-l">${RS.icon("bolt")} Odd turbinada · sem cash out</div>` : ""}
          ${s.market === "bb" ? "" : `<div class="bc-mk">${mname(s.market || "1x2")}</div>`}
          <div class="bc-l3"><span class="bc-teams">${logo(s.matches.home_logo)}${RS.esc(s.matches.home)}<br>${logo(s.matches.away_logo)}${RS.esc(s.matches.away)}</span><span class="bc-st" data-st="${s.match_id}">${selState(s)}</span></div>
          ${s.market === "bb" ? `<ul class="bc-legs" data-legs="${s.match_id}">${legList(s)}</ul>` : ""}</div>`).join("")}
        <div class="bc-row"><span>Aposta</span><b>${RS.money(b.stake)}</b></div>
        <div class="bc-row bc-win"><span>${wl}</span><b>${RS.money(wv)}</b></div>
        ${b.status === "pending" ? `<div class="cashout-box" data-co="${b.id}"><small class="muted">Calculando cash out…</small></div>` : ""}
        <div class="bc-foot"><button data-rebet="${b.id}">Reapostar ${RS.icon("refresh")}</button><button data-share="${b.id}">Compartilhar ${RS.icon("share")}</button></div>
      </div></div>`;
  };
  function renderBets() {
    const open = bets.filter((b) => b.status === "pending");
    let list = betTab === "open" ? open : bets.filter((b) => b.status !== "pending");
    if (betTab === "open" && betFilter === "live") list = list.filter((b) => b.bet_selections.some(isLive));
    if (betTab === "open" && betFilter === "long") list = list.filter((b) => b.bet_selections.some(isFar));
    const empty = betTab === "open" ? "Nenhuma aposta em aberto." : "Nenhuma aposta resolvida nos últimos 7 dias.";
    box.innerHTML = `<div class="bt-tabs"><button data-bt="open" class="${betTab === "open" ? "active" : ""}">Em Aberto (${open.length})</button>
        <button data-bt="done" class="${betTab === "done" ? "active" : ""}">Resolvidas</button></div>
      ${betTab === "open" ? `<div class="bt-filters">${[["live", "Ao Vivo"], ["cash", "Cash Out"], ["long", "Apostas a Longo Prazo"]]
        .map(([k, l]) => `<button class="bt-f${betFilter === k ? " active" : ""}" data-bf="${k}">${l}</button>`).join("")}</div>` : ""}
      <div class="${betFilter === "cash" && betTab === "open" ? "only-cash" : ""}">${list.map(card).join("") || `<p class="muted">${empty}</p>`}</div>
      ${betTab === "done" && list.length ? `<p class="muted small bt-week">Mostrando os bilhetes dos últimos 7 dias.</p>` : ""}`;
    loadCashouts();
  }
  const selCode = (b) => b.bet_selections.map((s) => `${s.match_id}~${s.market || "1x2"}.${s.pick}`).join(",");

  // imagem do bilhete (1080x1920, stories/status) com o link de indicação de quem compartilha
  const pic = (src) => new Promise((ok) => {
    if (!src) return ok(null);
    const i = new Image(); i.crossOrigin = "anonymous";
    i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src;
  });
  const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; };
  async function betImage(b, refUrl) {
    const W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d"), all = b.bet_selections, one = new Set(all.map((s) => s.match_id)).size === 1, m0 = all[0].matches;
    // cartão começa abaixo do destaque; só entram as seleções que cabem acima da chamada do rodapé
    const rowH = one ? 110 : 160, cardTop = one ? 760 : 560;
    const sels = all.slice(0, Math.max(1, Math.min(5, Math.floor((H - cardTop - 680) / rowH)))), more = all.length - sels.length;
    const [mark, hl, al, ...logos] = await Promise.all([pic("icons/rs-mark.png"), pic(m0.home_logo), pic(m0.away_logo), ...sels.flatMap((s) => [pic(s.matches.home_logo), pic(s.matches.away_logo)])]);
    const F = (w, px) => (x.font = `${w} ${px}px Roboto, system-ui, sans-serif`);
    const fit = (t, max) => { t = String(t); if (x.measureText(t).width <= max) return t; while (t.length > 1 && x.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };
    const rr = (X, Y, w, h, r) => { x.beginPath(); if (x.roundRect) x.roundRect(X, Y, w, h, r); else x.rect(X, Y, w, h); };
    const box = (X, Y, w, h, r) => { rr(X, Y, w, h, r); x.fill(); };
    const center = (t, Y) => x.fillText(t, (W - x.measureText(t).width) / 2, Y);
    const right = (t, X, Y) => x.fillText(t, X - x.measureText(t).width, Y);
    const won = b.status === "won" || b.status === "cashout", OR = "#ff5a0f";
    // fundo escuro com brilho laranja e faixas diagonais
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#151b2e"); bg.addColorStop(1, "#0a0e1a");
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    for (const [cx, cy, r, col] of [[W, 0, 900, won ? "rgba(22,163,74,.45)" : "rgba(255,90,15,.5)"], [0, H, 800, "rgba(255,90,15,.22)"]]) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    x.save(); x.globalAlpha = 0.07; x.fillStyle = "#fff";
    for (let i = -4; i < 14; i++) { x.beginPath(); x.moveTo(i * 140, 0); x.lineTo(i * 140 + 60, 0); x.lineTo(i * 140 - 540, H); x.lineTo(i * 140 - 600, H); x.fill(); }
    x.restore();
    x.textBaseline = "middle";
    // topo: marca + selo de status
    // a marca tem "R" branco e "S" escuro: vai num selo laranja para as duas letras aparecerem
    if (mark) { x.fillStyle = OR; box(60, 72, 180, 110, 28); x.drawImage(mark, 78, 82, 144, 81); }
    x.fillStyle = "#fff"; F(900, 60); x.fillText("REAL SPORTS", mark ? 262 : 70, 127);
    const [st, stc] = { won: ["GANHOU!", "#16a34a"], cashout: ["CASH OUT", "#16a34a"], lost: ["BILHETE", "#5d6883"], canceled: ["BILHETE", "#5d6883"] }[b.status] || ["EM ABERTO", OR];
    F(900, 30); const sw = x.measureText(st).width + 60;
    x.fillStyle = stc; box(W - 70 - sw, 100, sw, 56, 28); x.fillStyle = "#fff"; x.fillText(st, W - 70 - sw + 30, 129);
    // destaque: escudos + VS (um jogo) ou tipo da múltipla
    let y = 230;
    const crest = (img, name, cx) => {
      x.fillStyle = "rgba(255,255,255,.08)"; x.beginPath(); x.arc(cx, y + 110, 105, 0, 7); x.fill();
      x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = 4; x.stroke();
      if (img) x.drawImage(img, cx - 70, y + 40, 140, 140);
      else { x.fillStyle = "#fff"; F(900, 70); const t = name.slice(0, 2).toUpperCase(); x.fillText(t, cx - x.measureText(t).width / 2, y + 112); }
      x.fillStyle = "#fff"; F(700, 40); const t = fit(name, 360); x.fillText(t, cx - x.measureText(t).width / 2, y + 260);
    };
    if (one) {
      crest(hl, m0.home, 250); crest(al, m0.away, W - 250);
      x.fillStyle = OR; F(900, 72); center("VS", y + 110);
      x.fillStyle = "rgba(255,255,255,.65)"; F(500, 30); center(fit(`${m0.league || ""}${m0.starts_at ? ` · ${when(m0.starts_at)}` : ""}`, W - 160), y + 320);
      y += 370;
    } else {
      x.fillStyle = "#fff"; F(900, 88); center(TYPE(all.length).toUpperCase(), y + 60);
      x.fillStyle = "rgba(255,255,255,.65)"; F(500, 34); center(`${all.length} seleções`, y + 130);
      y += 170;
    }
    // selo da odd
    const odd = `ODD ${betOdd(b).toFixed(2)}`; F(900, 64); const ow = x.measureText(odd).width + 100;
    const og = x.createLinearGradient(0, y, 0, y + 110); og.addColorStop(0, "#ff7a2f"); og.addColorStop(1, "#e04400");
    x.save(); x.shadowColor = "rgba(255,90,15,.55)"; x.shadowBlur = 40; x.fillStyle = og; box((W - ow) / 2, y, ow, 110, 55); x.restore();
    x.fillStyle = "#fff"; center(odd, y + 57);
    y += 160;
    // cartão branco com as seleções (Criar Aposta: pernas com bolinha de status)
    const legH = 70, legsOf2 = (s) => (s.market === "bb" ? s.pick.split("|").map((l) => l.split(":")) : []);
    let room = Math.floor((H - y - 680 - sels.length * rowH) / legH);
    const shown = sels.map((s) => { const lg = legsOf2(s), n = Math.max(0, Math.min(lg.length, room - (lg.length > room ? 1 : 0))), rest = n ? lg.length - n : 0; room -= n + (rest ? 1 : 0); return { lg: lg.slice(0, n), rest }; });
    const rowOf = (i) => rowH + (shown[i].lg.length + (shown[i].rest ? 1 : 0)) * legH;
    const cardH = 60 + sels.reduce((t, _, i) => t + rowOf(i), 0) + (more ? 60 : 0) + 230, top = y;
    x.save(); x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = 50; x.shadowOffsetY = 16; x.fillStyle = "#fff"; box(60, top, W - 120, cardH, 40); x.restore();
    x.fillStyle = OR; box(60, top, 14, cardH, 7);
    y = top + 50;
    sels.forEach((s, i) => {
      if (i) { x.fillStyle = "#e6e9f2"; x.fillRect(110, y - 20, W - 220, 2); }
      F(900, 46); const so = selOdd(s).toFixed(2), sw2 = x.measureText(so).width;
      x.fillStyle = OR; x.fillText(so, W - 110 - sw2, y + 30);
      x.fillStyle = s.status === "won" ? "#16a34a" : s.status === "lost" ? "#dc2626" : "#141a2b";
      x.fillText(fit((s.status === "won" ? "✓ " : s.status === "lost" ? "✕ " : "") + selName(s), W - 260 - sw2), 110, y + 30);
      const lgs = legsOf2(s);
      x.fillStyle = "#6b7590"; F(500, 30);
      x.fillText(fit(lgs.length ? `${lgs.length} seleções no mesmo jogo` : plain(mname(s.market || "1x2")), W - 220), 110, y + 78);
      if (!one) {
        let tx = 110;
        for (const l of [logos[i * 2], logos[i * 2 + 1]]) if (l) { x.drawImage(l, tx, y + 100, 34, 34); tx += 42; }
        x.fillStyle = "#141a2b"; F(500, 30); x.fillText(fit(`${s.matches.home} x ${s.matches.away}`, W - 230 - (tx - 110)), tx + (tx > 110 ? 6 : 0), y + 118);
      }
      let ly = y + rowH + 20;
      for (const [li, [mk, pk]] of shown[i].lg.entries()) {
        const ls = legState(mk, pk, s.matches);
        if (li < shown[i].lg.length - 1) { x.fillStyle = "#e6e9f2"; x.fillRect(127, ly + 18, 6, legH - 36); }
        x.fillStyle = ls === "won" ? "#16a34a" : ls === "lost" ? "#dc2626" : OR;
        x.beginPath(); x.arc(130, ly, 16, 0, 7); x.fill();
        x.fillStyle = "#fff"; F(900, 20); const ic = ls === "won" ? "✓" : ls === "lost" ? "✕" : String(li + 1); x.fillText(ic, 130 - x.measureText(ic).width / 2, ly + 1);
        x.fillStyle = "#141a2b"; F(700, 36); const nm = fit(selName({ ...s, market: mk, pick: pk }), 500); x.fillText(nm, 170, ly);
        const nw = x.measureText(nm).width;
        x.fillStyle = "#6b7590"; F(400, 30); x.fillText(fit(` · ${plain(mname(mk))}`, W - 280 - nw), 170 + nw, ly);
        ly += legH;
      }
      if (shown[i].rest) { x.fillStyle = "#6b7590"; F(500, 30); x.fillText(`+ ${shown[i].rest} ${shown[i].rest === 1 ? "seleção" : "seleções"}`, 170, ly); }
      y += rowOf(i);
    });
    if (more) { x.fillStyle = "#6b7590"; F(500, 32); x.fillText(`+ ${more} ${more === 1 ? "seleção" : "seleções"}`, 110, y); y += 60; }
    // rodapé do cartão: aposta e ganho
    x.fillStyle = "#f4f6fb"; rr(74, top + cardH - 210, W - 134, 210, [0, 0, 40, 0]); x.fill();
    const [wl, wv] = winLine(b), fy0 = top + cardH - 210;
    x.fillStyle = "#6b7590"; F(500, 32); x.fillText("Aposta", 110, fy0 + 60);
    x.fillStyle = "#141a2b"; F(700, 38); right(RS.money(b.stake), W - 110, fy0 + 60);
    x.fillStyle = "#6b7590"; F(500, 32); x.fillText(wl, 110, fy0 + 145);
    x.fillStyle = won ? "#16a34a" : "#141a2b"; F(900, 72); right(RS.money(wv), W - 110, fy0 + 145);
    // chamada com link de indicação
    const fy = top + cardH + 100;
    x.fillStyle = "#fff"; F(900, 52); center("Aposte também na Real Sports", fy);
    x.fillStyle = "rgba(255,255,255,.7)"; F(400, 34); center("Cadastre-se pelo meu link", fy + 62);
    F(800, 40); const link = refUrl.replace(/^https?:\/\/(www\.)?/, ""), lw = x.measureText(link).width + 90;
    x.fillStyle = OR; box((W - lw) / 2, fy + 105, lw, 86, 43);
    x.fillStyle = "#fff"; center(link, fy + 149);
    return c;
  }
  async function shareBet(bet) {
    const u = await RS.user(), ref = u ? u.id.slice(0, 8) : "";
    const refUrl = `${location.origin}/${ref ? `?ref=${ref}` : ""}`;
    const url = `${location.origin}/?${ref ? `ref=${ref}&` : ""}b=${selCode(bet)}#sports`;
    const text = `Olha meu bilhete na Real Sports! Cadastre-se pelo meu link: ${url}`;
    const m = RS.modal(`<h3>Compartilhar bilhete</h3>
      <div class="sh-prev"><p class="muted small">Gerando imagem…</p></div>
      <button class="btn btn-primary w-full" id="sh-go" disabled>Compartilhar</button>
      <div class="sh-row"><button class="btn btn-outline" id="sh-dl" disabled>Baixar imagem</button><button class="btn btn-outline" id="sh-link">Copiar link</button></div>
      ${ref ? `<p class="muted small">Quem se cadastrar pelo seu link e depositar te dá bônus de indicação.</p>` : ""}`);
    let file = null, href = "";
    RS.$("#sh-link", m).onclick = async () => { try { await navigator.clipboard.writeText(url); RS.toast("Link copiado!", "ok"); } catch { RS.toast(url); } };
    try {
      const cv = await betImage(bet, refUrl);
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
      file = new File([blob], `bilhete-real-sports-${bet.id}.png`, { type: "image/png" });
      href = URL.createObjectURL(blob);
      RS.$(".sh-prev", m).innerHTML = `<img src="${href}" alt="Imagem do bilhete">`;
      RS.$("#sh-dl", m).disabled = false;
    } catch { RS.$(".sh-prev", m).innerHTML = `<p class="muted small">Não deu para gerar a imagem; compartilhe o link.</p>`; }
    const canFile = !!file && !!navigator.canShare?.({ files: [file] });
    const go = RS.$("#sh-go", m);
    go.disabled = !canFile && !navigator.share;
    if (!canFile && !navigator.share) go.classList.add("hidden");
    go.onclick = async () => {
      try {
        if (canFile) await navigator.share({ files: [file], text });
        else await navigator.share({ title: "Meu bilhete Real Sports", text, url });
      } catch { /* cancelado */ }
    };
    RS.$("#sh-dl", m).onclick = () => { const a = document.createElement("a"); a.href = href; a.download = file.name; a.click(); };
  }

  async function load() {
    const u = await RS.user();
    if (!u) { box.innerHTML = `<p class="muted">Entre na sua conta para ver o histórico. <a href="login.html">Entrar</a></p>`; return; }
    box.innerHTML = `<p class="muted">Carregando…</p>`;

    if (kind === "bets") {
      const { data } = await sb.from("bets")
        .select("*, bet_selections(match_id, market, pick, odd, status, boosted, matches(home, away, league, status, starts_at, score_home, score_away, minute, period, clock_secs, clock_at, ext365_id, home_logo, away_logo, ht_home, ht_away, corners_home, corners_away, cards_home, cards_away, shots_home, shots_away, sot_home, sot_away))")
        .eq("user_id", u.id).or(`status.eq.pending,created_at.gte.${new Date(Date.now() - 7 * 864e5).toISOString()}`)
        .order("created_at", { ascending: false }).limit(1000);
      bets = data || [];
      renderBets();
      return;
    }

    if (kind === "casino") {
      const { data } = await sb.from("casino_games").select("id,game,stake,mines,multiplier,payout,status,created_at")
        .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
      box.innerHTML = data?.length ? `<table class="table"><thead><tr><th>Jogo</th><th>Data</th><th>Aposta</th><th>Mult.</th><th>Prêmio</th><th></th></tr></thead><tbody>
        ${data.map((g) => `<tr><td>${g.game === "mines" ? `Mines (${g.mines})` : g.game === "leao" ? "Leão da Sorte" : "Dados"}</td><td>${RS.date(g.created_at)}</td>
        <td>${RS.money(g.stake)}</td><td>${Number(g.multiplier).toFixed(2)}x</td><td>${RS.money(g.payout)}</td><td>${badge(g.status)}</td></tr>`).join("")}
        </tbody></table>` : `<p class="muted">Nenhuma partida de cassino ainda.</p>`;
    }

    if (kind === "tx") {
      const { data } = await sb.from("transactions").select("*").eq("user_id", u.id)
        .order("created_at", { ascending: false }).limit(100);
      box.innerHTML = data?.length ? `<table class="table"><thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th></th></tr></thead><tbody>
        ${data.map((t) => `<tr><td>${RS.date(t.created_at)}</td><td>${RS.esc(t.description || t.type)}</td>
        <td class="${t.amount >= 0 ? "pos" : "neg"}">${RS.money(t.amount)}</td><td>${badge(t.status)}</td></tr>`).join("")}
        </tbody></table>` : `<p class="muted">Nenhuma movimentação.</p>`;
    }
  }

  // Cashout: cotado no servidor pelas odds atuais; suspenso em gol, odd mexendo ou dados atrasados
  let cashing = false;
  const lastCo = new Map();
  // minuto, placar e status dos jogos do bilhete sem recarregar a página
  async function refreshLive() {
    const ids = [...new Set(bets.filter((b) => b.status === "pending").flatMap((b) => b.bet_selections.map((s) => s.match_id)))];
    if (!ids.length) return;
    const { data } = await sb.from("matches").select("id, status, starts_at, score_home, score_away, minute, period, clock_secs, clock_at, ext365_id, ht_home, ht_away, corners_home, corners_away, cards_home, cards_away, shots_home, shots_away, sot_home, sot_away").in("id", ids);
    const byId = new Map((data || []).map((m) => [m.id, m]));
    for (const b of bets) for (const s of b.bet_selections) { const m = byId.get(s.match_id); if (m) Object.assign(s.matches, m); }
    for (const el of RS.$$("[data-st]", box)) {
      const b = bets.find((x) => x.id === Number(el.closest("[data-bet]")?.dataset.bet));
      const s = b?.bet_selections.find((x) => x.match_id === Number(el.dataset.st));
      if (s) el.innerHTML = selState(s);
    }
    for (const el of RS.$$("[data-legs]", box)) {
      const b = bets.find((x) => x.id === Number(el.closest("[data-bet]")?.dataset.bet));
      const s = b?.bet_selections.find((x) => x.match_id === Number(el.dataset.legs) && x.market === "bb");
      if (s) RS.morph(el, legList(s));
    }
  }
  // uma chamada cota todos os bilhetes; nunca duas ao mesmo tempo; valor velho trava o botão
  let coBusy = false, coAgain = false, coAt = 0, coSeq = 0;
  const CO_MAX_AGE = 8000, CO_OFF = `<button class="btn btn-co w-full" disabled>Cash out indisponível</button>`;
  function coButton(el, q, id) {
    const card = el.closest(".bet-card");
    card?.classList.toggle("co-ok", !!q && !q.suspended);
    // barra laranja no jogo que está travando o cashout
    for (const sel of RS.$$(".bc-sel[data-m]", card || el)) sel.classList.toggle("co-block", !!q?.suspended && Number(sel.dataset.m) === Number(q.match));
    if (q?.boost) { el.innerHTML = `<button class="btn btn-co w-full" disabled>Sem cash out · odd turbinada</button>`; return; }
    if (!q || q.suspended) {
      el.innerHTML = CO_OFF + (q?.min ? `<p class="co-min">O valor do cash out está em ${RS.money(q.now)}. O mínimo para cash out é ${RS.money(q.min)}.</p>` : "");
      return;
    }
    const prev = lastCo.get(id), trend = prev == null || prev === q.value ? "" : q.value > prev ? "co-up" : "co-down";
    lastCo.set(id, q.value);
    const label = `CASH OUT ${RS.money(q.value)}${trend ? (trend === "co-up" ? " ▲" : " ▼") : ""}`;
    let btn = el.querySelector("[data-cash]");
    if (!btn) { el.innerHTML = `<button class="btn btn-co w-full" data-cash="${id}"></button>`; btn = el.firstChild; }
    btn.dataset.v = q.value; btn.disabled = false; btn.textContent = label;
    if (trend) { btn.classList.remove("co-up", "co-down"); void btn.offsetWidth; btn.classList.add(trend); }
  }
  async function loadCashouts() {
    if (cashing) return;
    if (coBusy) { coAgain = true; return; }
    coBusy = true;
    const seq = ++coSeq, late = (ms) => new Promise((ok) => setTimeout(() => ok({ error: "timeout" }), ms));
    try {
      await Promise.race([refreshLive(), late(4000)]);
      const els = RS.$$("[data-co]", box), ids = els.map((el) => Number(el.dataset.co));
      if (!ids.length) return;
      const { data, error } = await Promise.race([sb.rpc("cashout_quotes", { p_bets: ids }), late(6000)]);
      if (cashing || error || !data || seq !== coSeq) return;
      coAt = Date.now();
      els.forEach((el, i) => el.isConnected && coButton(el, data[ids[i]], ids[i]));
    } finally {
      coBusy = false;
      if (coAgain) { coAgain = false; loadCashouts(); }
    }
  }
  // sem cotação nova há mais de 8 s (rede caiu, app em segundo plano): botão trava até atualizar
  setInterval(() => {
    if (cashing || !coAt || Date.now() - coAt < CO_MAX_AGE) return;
    for (const btn of RS.$$("[data-cash]:not([disabled])", box)) { btn.disabled = true; btn.textContent = "Cash out indisponível"; }
  }, 1000);
  const showingBets = () => kind === "bets" && !RS.$("#history").classList.contains("hidden") && RS.$("[data-co]", box);
  box.addEventListener("click", async (e) => {
    const t = e.target;
    const tab = t.closest("[data-bt]"), f = t.closest("[data-bf]"), fold = t.closest("[data-fold]");
    if (tab) { betTab = tab.dataset.bt; renderBets(); return; }
    if (f) { betFilter = betFilter === f.dataset.bf ? "" : f.dataset.bf; renderBets(); return; }
    if (fold) {
      const id = Number(fold.dataset.fold);
      if (folded.has(id)) folded.delete(id); else folded.add(id);
      fold.parentElement.classList.toggle("closed", folded.has(id));
      return;
    }
    const tr = t.closest("[data-track]") || (t.closest(".bc-teams") && t.closest(".bc-sel")?.querySelector("[data-track]"));
    if (tr) {
      const s = bets.flatMap((x) => x.bet_selections).find((x) => x.match_id === Number(tr.dataset.track));
      if (s) RS.track({ ...s.matches, id: s.match_id });
      return;
    }
    const rb = t.closest("[data-rebet]"), sh = t.closest("[data-share]");
    const bet = bets.find((x) => x.id === Number((rb || sh)?.dataset.rebet ?? (rb || sh)?.dataset.share));
    if (rb && bet) {
      location.hash = "#sports";
      const n = window.RSsports?.add(bet.bet_selections.map((s) => ({ id: s.match_id, market: s.market || "1x2", pick: s.pick })), bet.stake) ?? 0;
      if (!n) RS.toast("Os jogos deste bilhete não estão mais disponíveis.", "error");
      else if (n < bet.bet_selections.length) RS.toast(`${n} de ${bet.bet_selections.length} seleções ainda disponíveis foram para o bilhete.`);
      return;
    }
    if (sh && bet) {
      shareBet(bet);
      return;
    }
    const b = t.closest("[data-cash]");
    if (!b) return;
    if (localStorage.getItem("rs-co-confirm") !== "0" && !confirm(`Encerrar o bilhete #${b.dataset.cash} e receber ${RS.money(b.dataset.v)} agora?`)) return;
    b.disabled = true; cashing = true;
    b.textContent = "Confirmando cashout…";
    try {
      const r = await RS.rpc("cashout_request", { p_bet: Number(b.dataset.cash), p_expected: Number(b.dataset.v) });
      let v = r.paid;
      if (v == null) {
        // ao vivo: espera e o servidor confere o jogo de novo (gol, VAR, pênalti, mercado suspenso)
        for (let s = r.wait; s > 0; s--) {
          b.textContent = `Confirmando cashout… ${s}s`;
          await new Promise((ok) => setTimeout(ok, 1000));
        }
        b.textContent = "Conferindo o jogo…";
        v = await RS.rpc("cashout_confirm", { p_request: r.request });
        if (v == null) throw new Error((await RS.rpc("cashout_reason", { p_request: r.request })) || "Cashout recusado");
      }
      RS.toast(`Cashout feito: ${RS.money(v)} no seu saldo.`, "ok");
      RS.refreshBalance();
    } catch (err) { RS.toast(err.message, "error"); }
    cashing = false; load();
  });
  // gol ou suspensão no placar fecha o botão na hora; a cotação confirma no servidor em seguida
  function lockCashout(ids, goal) {
    const mine = new Set(ids.map(Number));
    for (const b of bets) {
      if (b.status !== "pending" || !b.bet_selections.some((s) => mine.has(Number(s.match_id)))) continue;
      const el = box.querySelector(`[data-co="${b.id}"]`);
      if (!el) continue;
      for (const sel of RS.$$(".bc-sel[data-m]", el.closest(".bet-card"))) if (mine.has(Number(sel.dataset.m))) sel.classList.add("co-block");
      el.innerHTML = goal
        ? `<button class="btn btn-co w-full" disabled>Cash out indisponível — gol no jogo</button>`
        : CO_OFF;
    }
  }
  document.addEventListener("rs:match-lock", (e) => {
    if (!showingBets()) return;
    const hits = e.detail || [];
    const open = new Set(bets.filter((b) => b.status === "pending").flatMap((b) => b.bet_selections.map((s) => Number(s.match_id))));
    const mine = hits.filter((h) => open.has(Number(h.id)));
    if (!mine.length) return;
    lockCashout(mine.map((h) => h.id), mine.some((h) => h.goal));
    loadCashouts();
  });
  setInterval(() => { if (showingBets() && !document.hidden) loadCashouts(); }, 3000);
  const wake = () => { if (!document.hidden && showingBets()) { coAt = 1; loadCashouts(); } };
  document.addEventListener("visibilitychange", wake);
  addEventListener("pageshow", wake); addEventListener("focus", wake); addEventListener("online", wake);

  RS.$$("[data-hist]").forEach((b) => (b.onclick = () => {
    kind = b.dataset.hist;
    RS.$$("[data-hist]").forEach((x) => x.classList.toggle("active", x === b));
    load();
  }));
  document.addEventListener("rs:tab", (e) => { if (e.detail === "history") load(); });
  document.addEventListener("rs:balance", () => { if (!RS.$("#history").classList.contains("hidden")) load(); });
  if (!RS.$("#history").classList.contains("hidden")) load();
})();
