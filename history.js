// =====================================================
//  history.js — histórico de apostas, cassino e extrato
// =====================================================
(() => {
  const box = RS.$("#history-list");
  if (!box) return;
  let kind = "bets";
  const STATUS = { pending: "Aberta", won: "Ganhou", lost: "Perdeu", canceled: "Cancelada", done: "Concluída", rejected: "Recusada", active: "Em jogo", cashout: "Cashout" };
  const PICK = { home: "Casa", draw: "Empate", away: "Fora" };
  const badge = (s) => `<span class="badge b-${s}">${STATUS[s] || s}</span>`;

  async function load() {
    const u = await RS.user();
    if (!u) { box.innerHTML = `<p class="muted">Entre na sua conta para ver o histórico. <a href="login.html">Entrar</a></p>`; return; }
    box.innerHTML = `<p class="muted">Carregando…</p>`;

    if (kind === "bets") {
      const { data } = await sb.from("bets")
        .select("*, bet_selections(pick, odd, status, matches(home, away, league))")
        .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
      box.innerHTML = data?.length ? data.map((b) => `
        <div class="hist-card">
          <div class="hist-top"><b>Bilhete #${b.id}</b>${badge(b.status)}<small>${RS.date(b.created_at)}</small></div>
          ${b.bet_selections.map((s) => `<div class="hist-sel">
            <span>${RS.esc(s.matches.home)} x ${RS.esc(s.matches.away)} · <b>${PICK[s.pick]}</b></span>
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

  // Cashout: valor calculado no servidor pelas odds atuais de cada jogo
  async function loadCashouts() {
    for (const el of RS.$$("[data-co]", box)) {
      const id = Number(el.dataset.co);
      const { data: v } = await sb.rpc("cashout_value", { p_bet: id });
      if (v == null) { el.innerHTML = `<small class="muted">Cashout indisponível no momento</small>`; continue; }
      el.innerHTML = `<button class="btn btn-primary w-full" data-cash="${id}" data-v="${v}">Cashout ${RS.money(v)}</button>`;
    }
  }
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cash]");
    if (!b) return;
    if (!confirm(`Encerrar o bilhete #${b.dataset.cash} e receber ${RS.money(b.dataset.v)} agora?`)) return;
    b.disabled = true;
    try {
      const v = await RS.rpc("cashout_bet", { p_bet: Number(b.dataset.cash), p_expected: Number(b.dataset.v) });
      RS.toast(`Cashout feito: ${RS.money(v)} no seu saldo.`, "ok");
      RS.refreshBalance(); load();
    } catch (err) { RS.toast(err.message, "error"); load(); }
  });
  // valor do cashout acompanha as odds ao vivo
  sb.channel("hist-odds").on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" },
    () => { if (kind === "bets" && !RS.$("#history").classList.contains("hidden")) loadCashouts(); }).subscribe();

  RS.$$("[data-hist]").forEach((b) => (b.onclick = () => {
    kind = b.dataset.hist;
    // Cashout: valor calculado no servidor pelas odds atuais de cada jogo
  async function loadCashouts() {
    for (const el of RS.$$("[data-co]", box)) {
      const id = Number(el.dataset.co);
      const { data: v } = await sb.rpc("cashout_value", { p_bet: id });
      if (v == null) { el.innerHTML = `<small class="muted">Cashout indisponível no momento</small>`; continue; }
      el.innerHTML = `<button class="btn btn-primary w-full" data-cash="${id}" data-v="${v}">Cashout ${RS.money(v)}</button>`;
    }
  }
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cash]");
    if (!b) return;
    if (!confirm(`Encerrar o bilhete #${b.dataset.cash} e receber ${RS.money(b.dataset.v)} agora?`)) return;
    b.disabled = true;
    try {
      const v = await RS.rpc("cashout_bet", { p_bet: Number(b.dataset.cash), p_expected: Number(b.dataset.v) });
      RS.toast(`Cashout feito: ${RS.money(v)} no seu saldo.`, "ok");
      RS.refreshBalance(); load();
    } catch (err) { RS.toast(err.message, "error"); load(); }
  });
  // valor do cashout acompanha as odds ao vivo
  sb.channel("hist-odds").on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" },
    () => { if (kind === "bets" && !RS.$("#history").classList.contains("hidden")) loadCashouts(); }).subscribe();

  RS.$$("[data-hist]").forEach((x) => x.classList.toggle("active", x === b));
    load();
  }));
  document.addEventListener("rs:tab", (e) => { if (e.detail === "history") load(); });
  document.addEventListener("rs:balance", () => { if (!RS.$("#history").classList.contains("hidden")) load(); });
  load();
})();
