// =====================================================
//  sports.js — lista de jogos, odds e bilhete de aposta
// =====================================================
(() => {
  const list = RS.$("#matches");
  const slipEl = RS.$("#slip");
  let matches = [];
  let filter = "Todos";
  const slip = new Map(); // match_id -> { pick, odd }

  const PICK = { home: "1", draw: "X", away: "2" };

  async function load() {
    const { data, error } = await sb.from("matches").select("*")
      .in("status", ["open", "live"]).order("starts_at");
    if (error) { list.innerHTML = `<p class="muted">Erro ao carregar jogos.</p>`; return; }
    matches = data;
    renderFilters();
    renderMatches();
  }

  function renderFilters() {
    const sports = ["Todos", ...new Set(matches.map((m) => m.sport))];
    RS.$("#sport-filters").innerHTML = sports
      .map((s) => `<button class="chip ${s === filter ? "active" : ""}" data-sport="${RS.esc(s)}">${RS.esc(s)}</button>`).join("");
    RS.$$("#sport-filters .chip").forEach((b) => (b.onclick = () => { filter = b.dataset.sport; renderFilters(); renderMatches(); }));
  }

  function oddBtn(m, pick, odd) {
    if (!odd) return `<button class="odd" disabled>-</button>`;
    const sel = slip.get(m.id)?.pick === pick;
    return `<button class="odd ${sel ? "selected" : ""}" data-id="${m.id}" data-pick="${pick}">
      <small>${PICK[pick]}</small><b>${Number(odd).toFixed(2)}</b></button>`;
  }

  function renderMatches() {
    const rows = matches.filter((m) => filter === "Todos" || m.sport === filter);
    if (!rows.length) { list.innerHTML = `<p class="muted">Nenhum jogo disponível no momento.</p>`; return; }
    const byLeague = {};
    rows.forEach((m) => (byLeague[m.league] ||= []).push(m));
    list.innerHTML = Object.entries(byLeague).map(([league, ms]) => `
      <div class="league">
        <div class="league-title">${RS.esc(ms[0].sport)} · ${RS.esc(league)}</div>
        ${ms.map((m) => `
          <div class="match">
            <div class="match-info">
              <span class="match-time">${m.status === "live" ? '<i class="live">AO VIVO</i>' : RS.date(m.starts_at)}</span>
              <div class="teams"><b>${RS.esc(m.home)}</b><b>${RS.esc(m.away)}</b></div>
            </div>
            <div class="odds">${oddBtn(m, "home", m.odd_home)}${oddBtn(m, "draw", m.odd_draw)}${oddBtn(m, "away", m.odd_away)}</div>
          </div>`).join("")}
      </div>`).join("");
  }

  list.addEventListener("click", (e) => {
    const b = e.target.closest(".odd[data-id]");
    if (!b) return;
    const id = Number(b.dataset.id), pick = b.dataset.pick;
    const m = matches.find((x) => x.id === id);
    const odd = Number(m["odd_" + pick]);
    if (slip.get(id)?.pick === pick) slip.delete(id);
    else slip.set(id, { pick, odd });
    renderMatches();
    renderSlip();
  });

  function renderSlip() {
    const items = [...slip.entries()];
    RS.$("#slip-count").textContent = items.length;
    if (!items.length) {
      slipEl.innerHTML = `<p class="muted center">Clique numa odd para adicionar ao bilhete.</p>`;
      return;
    }
    const total = items.reduce((a, [, s]) => a * s.odd, 1);
    slipEl.innerHTML = `
      ${items.map(([id, s]) => {
        const m = matches.find((x) => x.id === id);
        const label = s.pick === "home" ? m.home : s.pick === "away" ? m.away : "Empate";
        return `<div class="slip-item">
          <div><small>${RS.esc(m.home)} x ${RS.esc(m.away)}</small><b>${RS.esc(label)}</b></div>
          <span class="slip-odd">${s.odd.toFixed(2)}</span>
          <button class="slip-x" data-rm="${id}" aria-label="Remover">×</button></div>`;
      }).join("")}
      <div class="slip-sum"><span>${items.length > 1 ? "Múltipla" : "Simples"} · Odd total</span><b>${total.toFixed(2)}</b></div>
      <input type="number" id="stake" class="input" min="1" step="0.01" placeholder="Valor da aposta (R$)">
      <div class="chips">${[5, 10, 25, 50, 100].map((v) => `<button class="chip" data-stake="${v}">+${v}</button>`).join("")}</div>
      <div class="slip-sum"><span>Retorno possível</span><b id="slip-return">${RS.money(0)}</b></div>
      <button class="btn btn-primary w-full" id="place">Fazer aposta</button>
      <button class="btn btn-ghost w-full" id="clear">Limpar bilhete</button>`;

    const stake = RS.$("#stake");
    const upd = () => (RS.$("#slip-return").textContent = RS.money((Number(stake.value) || 0) * Number(total.toFixed(2))));
    stake.oninput = upd;
    RS.$$("[data-stake]", slipEl).forEach((c) => (c.onclick = () => { stake.value = (Number(stake.value) || 0) + Number(c.dataset.stake); upd(); }));
    RS.$$("[data-rm]", slipEl).forEach((c) => (c.onclick = () => { slip.delete(Number(c.dataset.rm)); renderMatches(); renderSlip(); }));
    RS.$("#clear").onclick = () => { slip.clear(); renderMatches(); renderSlip(); };
    RS.$("#place").onclick = place;
  }

  async function place() {
    if (!(await RS.user())) { location.href = "login.html"; return; }
    const btn = RS.$("#place");
    btn.disabled = true;
    try {
      const sel = [...slip.entries()].map(([match_id, s]) => ({ match_id, pick: s.pick }));
      const id = await RS.rpc("place_bet", { p_selections: sel, p_stake: Number(RS.$("#stake").value) });
      RS.toast(`Aposta #${id} feita! Boa sorte.`, "ok");
      slip.clear(); renderMatches(); renderSlip(); RS.refreshBalance();
    } catch (e) { RS.toast(e.message, "error"); btn.disabled = false; }
  }

  // odds atualizam ao vivo quando o admin muda algo
  sb.channel("matches").on("postgres_changes", { event: "*", schema: "public", table: "matches" }, load).subscribe();

  renderSlip();
  load();
})();
