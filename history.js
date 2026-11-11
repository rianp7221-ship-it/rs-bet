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
  const MNAME = { "1x2": "Resultado Final", ou15: "Total de Gols", ou25: "Total de Gols", ou35: "Total de Gols", btts: "Ambas Marcam", btts1: "Ambas Marcam 1º Tempo", btts2: "Ambas Marcam 2º Tempo", ht1x2: "Resultado 1º Tempo", ou05: "Total de Gols", ou45: "Total de Gols", ou55: "Total de Gols", dc: "Chance Dupla", dnb: "Empate Anula", c1x2: "Escanteios 1X2", s1x2: "Chutes 1X2", t1x2: "Chutes no Gol 1X2", eg: "Gols Exatos", cs: "Placar Exato" };
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
  const legList = (s) => s.pick.split("|").map((l) => { const [market, pick] = l.split(":");
    return `<li><b>${RS.esc(selName({ ...s, market, pick }))}</b><small>${mname(market)}</small></li>`; }).join("");
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
          <div class="bc-l1">${RS.icon("ball")}<b${s.market === "bb" ? ' class="bc-bb"' : ""}>${RS.esc(selName(s))}</b>${mark(s)}<span>${selOdd(s).toFixed(2)}</span></div>
          ${s.market === "bb" ? "" : `<div class="bc-mk">${mname(s.market || "1x2")}</div>`}
          <div class="bc-l3"><span class="bc-teams">${logo(s.matches.home_logo)}${RS.esc(s.matches.home)}<br>${logo(s.matches.away_logo)}${RS.esc(s.matches.away)}</span><span class="bc-st" data-st="${s.match_id}">${selState(s)}</span></div>
          ${s.market === "bb" ? `<ul class="bc-legs">${legList(s)}</ul>` : ""}</div>`).join("")}
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

  async function load() {
    const u = await RS.user();
    if (!u) { box.innerHTML = `<p class="muted">Entre na sua conta para ver o histórico. <a href="login.html">Entrar</a></p>`; return; }
    box.innerHTML = `<p class="muted">Carregando…</p>`;

    if (kind === "bets") {
      const { data } = await sb.from("bets")
        .select("*, bet_selections(match_id, market, pick, odd, status, matches(home, away, league, status, starts_at, score_home, score_away, minute, period, clock_secs, clock_at, ext365_id, home_logo, away_logo))")
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
    const { data } = await sb.from("matches").select("id, status, starts_at, score_home, score_away, minute, period, clock_secs, clock_at, ext365_id").in("id", ids);
    const byId = new Map((data || []).map((m) => [m.id, m]));
    for (const b of bets) for (const s of b.bet_selections) { const m = byId.get(s.match_id); if (m) Object.assign(s.matches, m); }
    for (const el of RS.$$("[data-st]", box)) {
      const b = bets.find((x) => x.id === Number(el.closest("[data-bet]")?.dataset.bet));
      const s = b?.bet_selections.find((x) => x.match_id === Number(el.dataset.st));
      if (s) el.innerHTML = selState(s);
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
      const url = `${location.origin}${location.pathname}?b=${selCode(bet)}#sports`;
      try {
        if (navigator.share) await navigator.share({ title: `Meu bilhete Real Sports #${bet.id}`, url });
        else { await navigator.clipboard.writeText(url); RS.toast("Link do bilhete copiado!", "ok"); }
      } catch { /* cancelado */ }
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
