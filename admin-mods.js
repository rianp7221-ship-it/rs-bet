// =====================================================
//  admin-mods.js — módulos Usuários, Financeiro e Apostas do painel
// =====================================================
(() => {
  const esc = RS.esc, M = RS.money;
  const A = () => window.RSadmin;
  const main = () => RS.$("#adm-main");

  // ---------- USUÁRIOS ----------
  async function users(openId) {
    const { can, act, ask, table, head } = A();
    main().innerHTML = head("Usuários", `<input class="input" id="u-q" placeholder="Buscar por e-mail, usuário ou ID" style="min-width:260px">`) + `<div id="u-list"></div>`;
    async function load() {
      const q = RS.$("#u-q").value.trim().replace(/[,()]/g, "");
      let req = sb.from("profiles").select("*").order("created_at", { ascending: false }).limit(100);
      if (q) req = /^[0-9a-f-]{36}$/i.test(q) ? req.eq("id", q) : req.or(`email.ilike.%${q}%,username.ilike.%${q}%`);
      const { data } = await req;
      RS.$("#u-list").innerHTML = table(["Usuário", "Saldo", "Desde", ""], (data || []).map((u) => [
        `${esc(u.username || "")}<br><small>${esc(u.email)}</small> ${u.is_admin || u.staff_role ? `<span class="badge b-won">${u.is_admin ? "master" : u.staff_role}</span>` : ""} ${u.blocked ? '<span class="badge b-lost">bloqueado</span>' : ""}`,
        M(u.balance), RS.date(u.created_at),
        `${can("users.balance") ? `<button class="btn sm" data-adj="${u.id}">Ajustar saldo</button>` : ""}
         ${can("users.block") ? `<button class="btn sm ${u.blocked ? "" : "danger"}" data-blk="${u.id}" data-v="${!u.blocked}">${u.blocked ? "Desbloquear" : "Bloquear"}</button>` : ""}`]),
        "Nenhum usuário encontrado.");
    }
    let t;
    RS.$("#u-q").oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
    RS.$("#u-list").onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.adj) {
        const v = await ask("Ajustar saldo", [{ name: "amount", label: "Valor (negativo para retirar)", type: "number", required: true },
          { name: "reason", label: "Motivo (fica na auditoria)", type: "textarea", required: true }]);
        if (v && await act("admin_adjust_balance", { p_user: b.dataset.adj, p_amount: Number(v.amount), p_reason: v.reason }, "Saldo ajustado")) load();
      }
      if (b.dataset.blk) {
        const blocking = b.dataset.v === "true";
        const v = blocking ? await ask("Bloquear conta", [{ name: "reason", label: "Motivo do bloqueio", type: "textarea", required: true }]) : { reason: null };
        if (v && await act("admin_set_blocked", { p_user: b.dataset.blk, p_blocked: blocking, p_reason: v.reason }, "Atualizado")) load();
      }
    };
    if (openId) RS.$("#u-q").value = openId;
    await load();
  }

  // ---------- FINANCEIRO ----------
  async function finance() {
    const { can, act, table, head, badge } = A();
    main().innerHTML = head("Financeiro", `<select class="input" id="f-type"><option value="">Depósitos e saques</option><option value="deposit">Depósitos</option><option value="withdraw">Saques</option></select>
      <select class="input" id="f-st"><option value="">Todos</option><option value="pending" selected>Pendentes</option><option value="done">Concluídos</option><option value="rejected">Recusados</option></select>`) + `<div id="f-list"></div>`;
    async function load() {
      const type = RS.$("#f-type").value, st = RS.$("#f-st").value;
      let req = sb.from("transactions").select("*, profiles(email)").order("created_at", { ascending: false }).limit(200);
      req = type ? req.eq("type", type) : req.in("type", ["deposit", "withdraw"]);
      if (st) req = req.eq("status", st);
      const { data } = await req;
      RS.$("#f-list").innerHTML = table(["#", "Usuário", "Tipo", "Valor", "Data", "Status", ""], (data || []).map((t) => [
        t.id, `<a href="#users" data-open-user="${t.user_id}" style="color:var(--primary)">${esc(t.profiles?.email || "")}</a>`,
        t.type === "deposit" ? "Depósito" : "Saque", M(Math.abs(t.amount)), RS.date(t.created_at), badge(t.status),
        t.status === "pending" && can("finance.manage") ? `<button class="btn sm" data-ok="${t.id}">Aprovar</button><button class="btn sm danger" data-no="${t.id}">Recusar</button>` : ""]),
        "Nenhuma transação.");
    }
    RS.$("#f-type").onchange = load;
    RS.$("#f-st").onchange = load;
    RS.$("#f-list").onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const approve = !!b.dataset.ok;
      if (!confirm(approve ? "Aprovar esta transação?" : "Recusar esta transação?")) return;
      if (await act("admin_review_transaction", { p_tx: +(b.dataset.ok || b.dataset.no), p_approve: approve }, approve ? "Aprovado" : "Recusado")) load();
    };
    A().onLeave(() => {});
    window.RSadmin && (RS.$("#f-list").dataset.ready = "1");
    await load();
  }

  // ---------- APOSTAS E JOGOS ----------
  async function sports() {
    const { can, act, table, head, badge } = A();
    const manage = can("sports.manage");
    main().innerHTML = head("Apostas e jogos") + `
      <div class="tabs-sm" id="sp-tabs"><button class="chip active" data-v="matches">Jogos</button><button class="chip" data-v="bets">Bilhetes</button></div>
      <div id="sp-matches">
        ${manage ? `<div class="panel" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="sync-odds">Buscar jogos e odds reais (API)</button>
          <small class="muted" id="sync-msg">Atualiza jogos, odds, placares e paga bilhetes encerrados. Também roda sozinho a cada 2 min (ao vivo) e 6 h.</small></div>
        <form id="match-form" class="form-grid panel">
          <input name="sport" class="input" placeholder="Esporte" value="Futebol" required>
          <input name="league" class="input" placeholder="Campeonato" required>
          <input name="home" class="input" placeholder="Time da casa" required>
          <input name="away" class="input" placeholder="Visitante" required>
          <input name="starts_at" type="datetime-local" class="input" required>
          <input name="odd_home" type="number" step="0.01" min="1.01" class="input" placeholder="Odd casa" required>
          <input name="odd_draw" type="number" step="0.01" min="1.01" class="input" placeholder="Odd empate (opcional)">
          <input name="odd_away" type="number" step="0.01" min="1.01" class="input" placeholder="Odd fora" required>
          <button class="btn btn-primary">Adicionar jogo</button></form>` : ""}
        <div id="m-list"></div></div>
      <div id="sp-bets" hidden></div>`;
    async function matches() {
      const { data } = await sb.from("matches").select("*").order("starts_at", { ascending: false }).limit(150);
      RS.$("#m-list").innerHTML = table(["Jogo", "Data", "Odds", "Status", manage ? "Ações" : ""], (data || []).map((m) => [
        `<small>${esc(m.league)}</small><br>${esc(m.home)} x ${esc(m.away)}`, RS.date(m.starts_at),
        `${m.odd_home} / ${m.odd_draw ?? "-"} / ${m.odd_away}`,
        `${badge(m.status)}${m.result ? " " + m.result : ""}${m.score_home != null ? `<br><small>${m.score_home} x ${m.score_away}</small>` : ""}
         ${m.locked ? `<br><small class="neg">🔒 Suspenso</small>` : new Date(m.suspended_until) > new Date() ? `<br><small class="neg">⏸ ${esc(m.suspend_reason || "Suspenso")}</small>` : ""}`,
        !manage ? "" : m.status === "settled" || m.status === "canceled" ? "" : `
          <button class="btn sm" data-st="${m.id}" data-v="${m.status === "live" ? "open" : "live"}">${m.status === "live" ? "Tirar do ao vivo" : "Ao vivo"}</button>
          <button class="btn sm ${m.locked ? "" : "danger"}" data-lock="${m.id}" data-v="${m.locked ? "0" : "1"}">${m.locked ? "Liberar" : "Suspender"}</button>
          <button class="btn sm" data-res="${m.id}" data-r="home">Casa</button>${m.odd_draw ? `<button class="btn sm" data-res="${m.id}" data-r="draw">Empate</button>` : ""}<button class="btn sm" data-res="${m.id}" data-r="away">Fora</button>
          <button class="btn sm danger" data-del="${m.id}">Excluir</button>`]), "Nenhum jogo.");
    }
    async function bets() {
      const { data } = await sb.from("bets").select("*, profiles(email), bet_selections(count)").order("created_at", { ascending: false }).limit(150);
      RS.$("#sp-bets").innerHTML = table(["#", "Usuário", "Jogos", "Aposta", "Odd", "Retorno", "Status", "Data"], (data || []).map((b) => [
        b.id, `<a href="#users" data-open-user="${b.user_id}" style="color:var(--primary)">${esc(b.profiles?.email || "")}</a>`, b.bet_selections[0]?.count,
        M(b.stake), b.total_odd, M(b.potential), badge(b.status), RS.date(b.created_at)]), "Nenhum bilhete.");
    }
    RS.$("#sp-tabs").onclick = (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      RS.$$("#sp-tabs .chip").forEach((x) => x.classList.toggle("active", x === b));
      RS.$("#sp-matches").hidden = b.dataset.v !== "matches";
      RS.$("#sp-bets").hidden = b.dataset.v !== "bets";
      if (b.dataset.v === "bets") bets();
    };
    RS.$("#m-list").onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.res && confirm("Confirmar resultado? Os bilhetes serão pagos agora.") && await act("settle_match", { p_match: +b.dataset.res, p_result: b.dataset.r }, "Jogo liquidado")) matches();
      if (b.dataset.lock && await act("admin_match_set", { p_match: +b.dataset.lock, p_locked: b.dataset.v === "1" }, "Atualizado")) matches();
      if (b.dataset.st && await act("admin_match_set", { p_match: +b.dataset.st, p_status: b.dataset.v }, "Atualizado")) matches();
      if (b.dataset.del && confirm("Excluir jogo?")) {
        const { error } = await sb.from("matches").delete().eq("id", b.dataset.del);
        RS.toast(error ? "Jogo tem apostas — não pode ser excluído" : "Excluído", error ? "error" : "ok");
        matches();
      }
    };
    RS.$("#match-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      f.starts_at = new Date(f.starts_at).toISOString();
      if (!f.odd_draw) f.odd_draw = null;
      const { error } = await sb.from("matches").insert(f);
      RS.toast(error ? RS.err(error) : "Jogo adicionado", error ? "error" : "ok");
      if (!error) { e.target.reset(); matches(); }
    });
    RS.$("#sync-odds")?.addEventListener("click", async () => {
      const btn = RS.$("#sync-odds");
      btn.disabled = true; RS.$("#sync-msg").textContent = "Buscando…";
      const { data, error } = await sb.functions.invoke("sync-odds");
      btn.disabled = false;
      if (error || data?.error) { RS.$("#sync-msg").textContent = "Erro: " + (data?.error || error.message); return; }
      RS.$("#sync-msg").textContent = `${data.jogos_atualizados} jogos atualizados, ${data.jogos_liquidados} liquidados`
        + (data.creditos_restantes != null ? ` · ${data.creditos_restantes} consultas restantes na API` : "")
        + (data.errors?.length ? ` · avisos: ${data.errors.join("; ")}` : "");
      matches();
    });
    await matches();
  }

  window.RSmods = Object.assign(window.RSmods || {}, { users, finance, sports, loaded: true });
  if (window.RSadmin?.ready) window.RSadmin.ready();
})();
