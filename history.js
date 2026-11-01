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
  const TYPE = (n) => (n === 1 ? "Simples" : n === 2 ? "Dupla" : n === 3 ? "Tripla" : "Múltipla");
  const MNAME = { "1x2": "Resultado Final", ou15: "Total de Gols", ou25: "Total de Gols", ou35: "Total de Gols", btts: "Ambas Marcam", dc: "Chance Dupla", dnb: "Empate Anula" };
  const LINE = { ou15: "1,5", ou25: "2,5", ou35: "3,5" };
  let bets = [], betTab = "open", betFilter = "";
  const folded = new Set();

  function selName(s) {
    const { home, away } = s.matches, mk = s.market || "1x2";
    if (mk === "bb") return "Criar Aposta";
    if (LINE[mk]) return `${s.pick === "over" ? "Mais" : "Menos"} de ${LINE[mk]}`;
    if (mk === "btts") return s.pick === "yes" ? "Sim" : "Não";
    if (mk === "dc") return { "1x": `${home} ou Empate`, x2: `Empate ou ${away}`, "12": `${home} ou ${away}` }[s.pick] || s.pick;
    return s.pick === "home" ? home : s.pick === "away" ? away : "Empate";
  }
  const legs = (s) => s.pick.split("|").map((l) => { const [market, pick] = l.split(":"); return RS.esc(selName({ ...s, market, pick })); }).join(" · ");
  function when(iso) {
    const d = new Date(iso), hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const days = Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
    if (days === 0) return (d.getHours() >= 18 ? "Esta noite " : "Hoje ") + hm;
    if (days === 1) return "Amanhã " + hm;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + hm;
  }
  const isLive = (s) => s.status === "pending" && s.matches.status === "live";
  const isFar = (s) => s.status === "pending" && new Date(s.matches.starts_at) - Date.now() > 7 * 864e5;
  function selState(s) {
    const m = s.matches;
    if (s.status !== "pending") return badge(s.status);
    if (isLive(s)) return `<i class="live">${m.minute ? m.minute + "'" : "AO VIVO"}${m.score_home != null ? ` ${m.score_home}-${m.score_away}` : ""}</i>`;
    return when(m.starts_at);
  }
  function winLine(b) {
    if (b.status === "cashout") return ["Cashout recebido", b.cashout_amount];
    if (b.status === "won") return ["Ganhos", b.potential];
    if (b.status === "canceled") return ["Valor devolvido", b.stake];
    if (b.status === "lost") return ["Ganhos", 0];
    return ["Ganhos Potenciais", b.potential];
  }
  const card = (b) => {
    const sels = b.bet_selections, [wl, wv] = winLine(b);
    return `<div class="bet-card${folded.has(b.id) ? " closed" : ""}" data-bet="${b.id}">
      <div class="bc-head" data-fold="${b.id}"><b>${TYPE(sels.length)}</b><span>${RS.money(b.stake)}</span>${b.status !== "pending" ? badge(b.status) : ""}
        <span class="bc-odd">${Number(b.total_odd).toFixed(2)}</span><i class="bc-chev"></i></div>
      <div class="bc-body">
        ${sels.map((s) => `<div class="bc-sel">
          <div class="bc-l1">${RS.icon("ball")}<b>${RS.esc(selName(s))}</b><span>${Number(s.odd).toFixed(2)}</span></div>
          <div class="bc-mk">${s.market === "bb" ? legs(s) : MNAME[s.market || "1x2"] || RS.esc(s.market)}</div>
          <div class="bc-l3"><span>${RS.esc(s.matches.home)} - ${RS.esc(s.matches.away)}</span><span data-st="${s.match_id}">${selState(s)}</span></div></div>`).join("")}
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
    const empty = betTab === "open" ? "Nenhuma aposta em aberto." : "Nenhuma aposta resolvida.";
    box.innerHTML = `<div class="bt-tabs"><button data-bt="open" class="${betTab === "open" ? "active" : ""}">Em Aberto (${open.length})</button>
        <button data-bt="done" class="${betTab === "done" ? "active" : ""}">Resolvidas</button></div>
      ${betTab === "open" ? `<div class="bt-filters">${[["live", "Ao Vivo"], ["cash", "Cash Out"], ["long", "Apostas a Longo Prazo"]]
        .map(([k, l]) => `<button class="bt-f${betFilter === k ? " active" : ""}" data-bf="${k}">${l}</button>`).join("")}</div>` : ""}
      <div class="${betFilter === "cash" && betTab === "open" ? "only-cash" : ""}">${list.map(card).join("") || `<p class="muted">${empty}</p>`}</div>`;
    loadCashouts();
  }
  const selCode = (b) => b.bet_selections.map((s) => `${s.match_id}~${s.market || "1x2"}.${s.pick}`).join(",");

  async function load() {
    const u = await RS.user();
    if (!u) { box.innerHTML = `<p class="muted">Entre na sua conta para ver o histórico. <a href="login.html">Entrar</a></p>`; return; }
    box.innerHTML = `<p class="muted">Carregando…</p>`;

    if (kind === "bets") {
      const { data } = await sb.from("bets")
        .select("*, bet_selections(match_id, market, pick, odd, status, matches(home, away, league, status, starts_at, score_home, score_away, minute))")
        .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
      bets = data || [];
      renderBets();
      return;
    }

    if (kind === "casino") {
      const { data } = await sb.from("casino_games").select("id,game,stake,mines,multiplier,payout,status,created_at")
        .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
      box.innerHTML = data?.length ? `<table class="table"><thead><tr><th>Jogo</th><th>Data</th><th>Aposta</th><th>Mult.</th><th>Prêmio</th><th></th></tr></thead><tbody>
        ${data.map((g) => `<tr><td>${g.game === "mines" ? `Mines (${g.mines})` : "Dados"}</td><td>${RS.date(g.created_at)}</td>
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
    const { data } = await sb.from("matches").select("id, status, starts_at, score_home, score_away, minute").in("id", ids);
    const byId = new Map((data || []).map((m) => [m.id, m]));
    for (const b of bets) for (const s of b.bet_selections) { const m = byId.get(s.match_id); if (m) Object.assign(s.matches, m); }
    for (const el of RS.$$("[data-st]", box)) {
      const b = bets.find((x) => x.id === Number(el.closest("[data-bet]")?.dataset.bet));
      const s = b?.bet_selections.find((x) => x.match_id === Number(el.dataset.st));
      if (s) el.innerHTML = selState(s);
    }
  }
  async function loadCashouts() {
    if (cashing) return;
    await refreshLive();
    for (const el of RS.$$("[data-co]", box)) {
      const id = Number(el.dataset.co);
      const { data: q } = await sb.rpc("cashout_quote", { p_bet: id });
      if (cashing) return;
      el.closest(".bet-card")?.classList.toggle("co-ok", !!q && !q.suspended);
      if (!q) { el.innerHTML = `<small class="muted">Cash out indisponível no momento</small>`; continue; }
      if (q.suspended) { el.innerHTML = `<button class="btn btn-co w-full" disabled>🔒 CASH OUT suspenso · ${RS.esc(q.reason)}</button>`; continue; }
      const prev = lastCo.get(id), trend = prev == null || prev === q.value ? "" : q.value > prev ? "co-up" : "co-down";
      lastCo.set(id, q.value);
      el.innerHTML = `<button class="btn btn-co w-full ${trend}" data-cash="${id}" data-v="${q.value}">CASH OUT ${RS.money(q.value)}${trend ? (trend === "co-up" ? " ▲" : " ▼") : ""}${q.live ? " · ao vivo" : ""}</button>`;
    }
  }
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
    if (!confirm(`Encerrar o bilhete #${b.dataset.cash} e receber ${RS.money(b.dataset.v)} agora?`)) return;
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
  // valor e suspensão do cashout acompanham o jogo: tempo real + checagem a cada 5s
  let pend;
  sb.channel("hist-odds").on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" },
    () => { clearTimeout(pend); pend = setTimeout(() => { if (showingBets()) loadCashouts(); }, 300); }).subscribe();
  setInterval(() => { if (showingBets() && !document.hidden) loadCashouts(); }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && showingBets()) load(); });

  RS.$$("[data-hist]").forEach((b) => (b.onclick = () => {
    kind = b.dataset.hist;
    RS.$$("[data-hist]").forEach((x) => x.classList.toggle("active", x === b));
    load();
  }));
  document.addEventListener("rs:tab", (e) => { if (e.detail === "history") load(); });
  document.addEventListener("rs:balance", () => { if (!RS.$("#history").classList.contains("hidden")) load(); });
  load();
})();
