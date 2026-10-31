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

  async function load() {
    const u = await RS.user();
    if (!u) { box.innerHTML = `<p class="muted">Entre na sua conta para ver o histórico. <a href="login.html">Entrar</a></p>`; return; }
    box.innerHTML = `<p class="muted">Carregando…</p>`;

    if (kind === "bets") {
      const { data } = await sb.from("bets")
        .select("*, bet_selections(market, pick, odd, status, matches(home, away, league, status, score_home, score_away, minute))")
        .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
      box.innerHTML = data?.length ? data.map((b) => `
        <div class="hist-card">
          <div class="hist-top"><b>Bilhete #${b.id}</b>${badge(b.status)}<small>${RS.date(b.created_at)}</small></div>
          ${b.bet_selections.map((s) => `<div class="hist-sel">
            <span>${RS.esc(s.matches.home)} x ${RS.esc(s.matches.away)}${s.status === "pending" && s.matches.status === "live" ? ` <i class="live">${s.matches.minute ? s.matches.minute + "'" : "AO VIVO"}${s.matches.score_home != null ? ` ${s.matches.score_home}-${s.matches.score_away}` : ""}</i>` : ""} · <b>${s.market && s.market !== "1x2" ? `${MKT[s.market] || s.market}: ${PICK[s.pick] || s.pick}` : PICK[s.pick]}</b></span>
            <span>${Number(s.odd).toFixed(2)} ${badge(s.status)}</span></div>`).join("")}
          <div class="hist-foot"><span>Apostado ${RS.money(b.stake)} · Odd ${Number(b.total_odd).toFixed(2)}</span>
            <b>${b.status === "cashout" ? "Recebeu " + RS.money(b.cashout_amount) : (b.status === "won" ? "Recebeu " : "Retorno ") + RS.money(b.potential)}</b></div>
          ${b.status === "pending" ? `<div class="cashout-box" data-co="${b.id}"><small class="muted">Calculando cashout…</small></div>` : ""}
        </div>`).join("") : `<p class="muted">Você ainda não fez apostas.</p>`;
    }

    if (kind === "bets") loadCashouts();

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
  async function loadCashouts() {
    if (cashing) return;
    for (const el of RS.$$("[data-co]", box)) {
      const id = Number(el.dataset.co);
      const { data: q } = await sb.rpc("cashout_quote", { p_bet: id });
      if (cashing) return;
      if (!q) { el.innerHTML = `<small class="muted">Cashout indisponível no momento</small>`; continue; }
      if (q.suspended) { el.innerHTML = `<button class="btn w-full" disabled>🔒 Cashout suspenso · ${RS.esc(q.reason)}</button>`; continue; }
      const prev = lastCo.get(id), trend = prev == null || prev === q.value ? "" : q.value > prev ? "co-up" : "co-down";
      lastCo.set(id, q.value);
      el.innerHTML = `<button class="btn btn-primary w-full ${trend}" data-cash="${id}" data-v="${q.value}">Cashout ${RS.money(q.value)}${trend ? (trend === "co-up" ? " ▲" : " ▼") : ""}${q.live ? " · ao vivo" : ""}</button>`;
    }
  }
  const showingBets = () => kind === "bets" && !RS.$("#history").classList.contains("hidden") && RS.$("[data-co]", box);
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cash]");
    if (!b) return;
    if (!confirm(`Encerrar o bilhete #${b.dataset.cash} e receber ${RS.money(b.dataset.v)} agora?`)) return;
    b.disabled = true; cashing = true;
    b.textContent = "Confirmando cashout…";
    try {
      const v = await RS.rpc("cashout_bet", { p_bet: Number(b.dataset.cash), p_expected: Number(b.dataset.v) });
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

  RS.$$("[data-hist]").forEach((b) => (b.onclick = () => {
    kind = b.dataset.hist;
    RS.$$("[data-hist]").forEach((x) => x.classList.toggle("active", x === b));
    load();
  }));
  document.addEventListener("rs:tab", (e) => { if (e.detail === "history") load(); });
  document.addEventListener("rs:balance", () => { if (!RS.$("#history").classList.contains("hidden")) load(); });
  load();
})();
