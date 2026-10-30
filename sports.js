// =====================================================
//  sports.js — lista de jogos, odds e bilhete de aposta
// =====================================================
(() => {
  const list = RS.$("#matches");
  const slipEl = RS.$("#slip");
  let matches = [];
  let filter = "Todos";
  let day = "all";
  let mode = "multi"; // multi = um bilhete com tudo | single = uma aposta por jogo
  const slip = new Map(); // match_id -> { pick, odd }

  const PICK = { home: "1", draw: "X", away: "2" };
  const LIVE = "Ao vivo";
  const ICON = { Todos: "🏆", [LIVE]: "🔴", Futebol: "⚽", Basquete: "🏀", "Tênis": "🎾", "Vôlei": "🏐", "Futebol Americano": "🏈", Beisebol: "⚾", "Hóquei": "🏒", MMA: "🥊", "E-sports": "🎮" };
  const icon = (s) => ICON[s] || "🏅";

  async function load() {
    const { data, error } = await sb.from("matches").select("*")
      .in("status", ["open", "live"]).order("starts_at");
    if (error) { list.innerHTML = `<p class="muted">Erro ao carregar jogos.</p>`; return; }
    matches = data;
    // jogo que saiu da lista sai do bilhete
    for (const id of slip.keys()) if (!matches.some((m) => m.id === id)) slip.delete(id);
    render();
    renderSlip();
  }

  function sportBtn(s, count) {
    return `<button class="chip ${s === filter ? "active" : ""}" data-sport="${RS.esc(s)}"><span>${icon(s)}</span>${RS.esc(s)}${count != null ? `<em>${count}</em>` : ""}</button>`;
  }

  function renderFilters() {
    const count = {};
    matches.forEach((m) => (count[m.sport] = (count[m.sport] || 0) + 1));
    const live = matches.filter((m) => m.status === "live").length;
    const popular = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 5);
    RS.$("#sport-filters").innerHTML = sportBtn("Todos", matches.length) + (live ? sportBtn(LIVE, live) : "") + popular.map((s) => sportBtn(s, count[s])).join("");
    RS.$("#sport-az").innerHTML = Object.keys(count).sort((a, b) => a.localeCompare(b, "pt-BR")).map((s) => sportBtn(s, count[s])).join("");
  }

  function oddBtn(m, pick, odd) {
    if (!odd) return `<button class="odd" disabled><small>${PICK[pick]}</small><b>-</b></button>`;
    const sel = slip.get(m.id)?.pick === pick;
    return `<button class="odd ${sel ? "selected" : ""}" data-id="${m.id}" data-pick="${pick}">
      <small>${PICK[pick]}</small><b>${Number(odd).toFixed(2)}</b></button>`;
  }
  const odds = (m) => `<div class="odds">${oddBtn(m, "home", m.odd_home)}${oddBtn(m, "draw", m.odd_draw)}${oddBtn(m, "away", m.odd_away)}</div>`;
  const when = (m) => m.status === "live"
    ? `<i class="live">AO VIVO</i>${m.score_home != null ? ` <b class="score">${m.score_home} - ${m.score_away}</b>` : ""}`
    : RS.date(m.starts_at);

  function card(m) {
    return `<div class="mcard">
      <div class="mcard-top"><span>${icon(m.sport)} ${RS.esc(m.league)}</span><span class="match-time">${when(m)}</span></div>
      <div class="mcard-teams"><b>${RS.esc(m.home)}</b><b>${RS.esc(m.away)}</b></div>
      ${odds(m)}
    </div>`;
  }

  function sameDay(d, offset) {
    const a = new Date(d), b = new Date();
    b.setDate(b.getDate() + offset);
    return a.toDateString() === b.toDateString();
  }

  function render() {
    renderFilters();
    const home = filter === "Todos";
    const live = matches.filter((m) => m.status === "live");
    RS.$("#live-block").classList.toggle("hidden", !home || !live.length);
    RS.$("#live-cards").innerHTML = live.slice(0, 12).map(card).join("");
    const top = matches.filter((m) => m.status === "open").slice(0, 8);
    RS.$("#top-block").classList.toggle("hidden", !home || !top.length);
    RS.$("#top-cards").innerHTML = top.map(card).join("");
    RS.$("#list-title").textContent = home ? "Todos os jogos" : filter === LIVE ? "Jogos ao vivo" : filter;

    const rows = matches.filter((m) => filter === "Todos" || (filter === LIVE ? m.status === "live" : m.sport === filter))
      .filter((m) => day === "all" || m.status === "live" || sameDay(m.starts_at, day === "today" ? 0 : 1));
    if (!rows.length) { list.innerHTML = `<p class="muted empty">Nenhum jogo disponível no momento.</p>`; return; }
    const byLeague = {};
    rows.forEach((m) => (byLeague[m.sport + " · " + m.league] ||= []).push(m));
    list.innerHTML = Object.entries(byLeague).map(([title, ms]) => `
      <div class="league">
        <div class="league-title"><span>${icon(ms[0].sport)} ${RS.esc(title)}</span>
          <div class="odds-head"><span>1</span><span>X</span><span>2</span></div></div>
        ${ms.map((m) => `
          <div class="match">
            <div class="match-info">
              <span class="match-time">${when(m)}</span>
              <div class="teams"><b>${RS.esc(m.home)}</b><b>${RS.esc(m.away)}</b></div>
            </div>
            ${odds(m)}
          </div>`).join("")}
      </div>`).join("");
  }

  function setFilter(f) { filter = f; render(); }

  document.addEventListener("click", (e) => {
    const s = e.target.closest("[data-sport]");
    if (s) { setFilter(s.dataset.sport); RS.$("#list-title").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const d = e.target.closest("[data-day]");
    if (d) {
      day = d.dataset.day;
      RS.$$("[data-day]").forEach((x) => x.classList.toggle("active", x === d));
      render(); return;
    }
    if (e.target.closest("[data-live], [data-goto-live]")) {
      e.preventDefault();
      RS.$$(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== "sports"));
      RS.$$("[data-tabs] [data-tab]").forEach((x) => x.classList.toggle("active", x.hasAttribute("data-live")));
      setFilter(LIVE); return;
    }
    if (e.target.closest('[data-tabs] [data-tab="sports"]')) { setFilter("Todos"); return; }

    const b = e.target.closest(".odd[data-id]");
    if (!b) return;
    const id = Number(b.dataset.id), pick = b.dataset.pick;
    const m = matches.find((x) => x.id === id);
    if (!m) return;
    const odd = Number(m["odd_" + pick]);
    if (slip.get(id)?.pick === pick) slip.delete(id);
    else slip.set(id, { pick, odd });
    render();
    renderSlip();
  });

  RS.$$("#slip-tabs button").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; renderSlip(); }));

  function renderSlip() {
    const items = [...slip.entries()];
    RS.$("#slip-count").textContent = items.length;
    const multi = mode === "multi" && items.length > 1;
    RS.$$("#slip-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === (items.length > 1 ? mode : "single")));
    if (!items.length) {
      slipEl.innerHTML = `<div class="slip-empty"><i>🧾</i><p>Seu bilhete está vazio.</p><p class="muted small">Clique numa odd para adicionar uma seleção.</p></div>`;
      return;
    }
    const total = items.reduce((a, [, s]) => a * s.odd, 1);
    const sumOdds = items.reduce((a, [, s]) => a + s.odd, 0);
    slipEl.innerHTML = `
      ${items.map(([id, s]) => {
        const m = matches.find((x) => x.id === id);
        const label = s.pick === "home" ? m.home : s.pick === "away" ? m.away : "Empate";
        return `<div class="slip-item">
          <div><b>${RS.esc(label)}</b><small>Resultado final · ${RS.esc(m.home)} x ${RS.esc(m.away)}</small></div>
          <span class="slip-odd">${s.odd.toFixed(2)}</span>
          <button class="slip-x" data-rm="${id}" aria-label="Remover">×</button></div>`;
      }).join("")}
      ${multi ? `<div class="slip-sum"><span>Múltipla (${items.length}) · Odd total</span><b>${total.toFixed(2)}</b></div>` : ""}
      <label>${!multi && items.length > 1 ? "Valor por aposta (R$)" : "Valor da aposta (R$)"}
        <input type="number" id="stake" class="input" min="1" step="0.01" placeholder="0,00"></label>
      <div class="chips">${[5, 10, 25, 50, 100].map((v) => `<button class="chip" data-stake="${v}">+${v}</button>`).join("")}</div>
      ${!multi && items.length > 1 ? `<div class="slip-sum"><span>Total apostado</span><b id="slip-total">${RS.money(0)}</b></div>` : ""}
      <div class="slip-sum ret"><span>Retorno possível</span><b id="slip-return">${RS.money(0)}</b></div>
      <button class="btn btn-primary w-full" id="place">Fazer aposta</button>
      <button class="btn btn-ghost w-full" id="clear">Limpar bilhete</button>`;

    const stake = RS.$("#stake");
    const upd = () => {
      const v = Number(stake.value) || 0;
      RS.$("#slip-return").textContent = RS.money(multi ? v * Number(total.toFixed(2)) : v * sumOdds);
      const t = RS.$("#slip-total");
      if (t) t.textContent = RS.money(v * items.length);
    };
    stake.oninput = upd;
    RS.$$("[data-stake]", slipEl).forEach((c) => (c.onclick = () => { stake.value = (Number(stake.value) || 0) + Number(c.dataset.stake); upd(); }));
    RS.$$("[data-rm]", slipEl).forEach((c) => (c.onclick = () => { slip.delete(Number(c.dataset.rm)); render(); renderSlip(); }));
    RS.$("#clear").onclick = () => { slip.clear(); render(); renderSlip(); };
    RS.$("#place").onclick = () => place(multi);
  }

  async function place(multi) {
    if (!(await RS.user())) { location.href = "login.html"; return; }
    const btn = RS.$("#place");
    const stake = Number(RS.$("#stake").value);
    btn.disabled = true;
    const sel = [...slip.entries()].map(([match_id, s]) => ({ match_id, pick: s.pick }));
    const groups = multi ? [sel] : sel.map((s) => [s]);
    const ok = [];
    try {
      for (const g of groups) {
        ok.push(await RS.rpc("place_bet", { p_selections: g, p_stake: stake }));
        slip.delete(g[0].match_id);
        if (multi) slip.clear();
      }
      RS.toast(ok.length > 1 ? `${ok.length} apostas feitas! Boa sorte.` : `Aposta #${ok[0]} feita! Boa sorte.`, "ok");
    } catch (e) {
      RS.toast((ok.length ? `${ok.length} aposta(s) feita(s). ` : "") + e.message, "error");
    }
    RS.refreshBalance();
    render(); renderSlip();
  }

  // odds atualizam ao vivo quando o admin muda algo
  sb.channel("matches").on("postgres_changes", { event: "*", schema: "public", table: "matches" }, load).subscribe();

  renderSlip();
  load();
})();
