// =====================================================
//  admin-mods.js — módulos Usuários, Financeiro e Apostas do painel
// =====================================================
(() => {
  const esc = RS.esc, M = RS.money;
  const A = () => window.RSadmin;
  const main = () => RS.$("#adm-main");

  // ---------- USUÁRIOS (CRM) ----------
  const RISK = { baixo: "Baixo", medio: "Médio", alto: "Alto" };
  async function users(openId) {
    if (openId) return profile(openId);
    const { can, act, table, head } = A();
    main().innerHTML = head("Usuários", can("users.message") ? `<button class="btn btn-outline" id="u-msg-all">Mensagem para todos</button>` : "") + `
      <div class="filters panel">
        <input class="input" id="u-q" placeholder="E-mail, usuário, ID ou IP" style="min-width:220px">
        <select class="input" id="u-st"><option value="">Todos</option><option value="ativo">Ativos</option><option value="bloqueado">Bloqueados</option><option value="equipe">Equipe</option></select>
        <select class="input" id="u-risk"><option value="">Qualquer risco</option><option value="baixo">Risco baixo</option><option value="medio">Risco médio</option><option value="alto">Risco alto</option></select>
        <input class="input" id="u-min" type="number" placeholder="Saldo mín." style="width:110px">
        <input class="input" id="u-max" type="number" placeholder="Saldo máx." style="width:110px">
        <input class="input" id="u-country" placeholder="País (BR)" maxlength="2" style="width:90px">
      </div>
      <div id="u-pending"></div><div id="u-list"></div>`;
    async function load() {
      const val = (id) => RS.$(id).value.trim();
      const r = await RS.rpc("admin_search_users", { p_q: val("#u-q") || null, p_status: val("#u-st") || null, p_risk: val("#u-risk") || null,
        p_min_balance: val("#u-min") ? Number(val("#u-min")) : null, p_max_balance: val("#u-max") ? Number(val("#u-max")) : null,
        p_country: val("#u-country") || null, p_limit: 100, p_offset: 0 }).catch((e) => { RS.toast(e.message, "error"); return { rows: [], total: 0 }; });
      RS.$("#u-list").innerHTML = `<p class="muted small" style="margin-bottom:6px">${r.total} usuário(s)</p>` + table(
        ["Usuário", "Saldo", "Depósitos", "Bilhetes", "Risco", "País", "Último acesso", ""], r.rows.map((u) => [
          `<a href="#" data-open-user="${u.id}" style="color:var(--primary)"><b>${esc(u.username || "")}</b></a><br><small>${esc(u.email)}</small>
           ${u.staff_role ? `<span class="badge b-won">${u.staff_role}</span>` : ""}${u.blocked ? ' <span class="badge b-lost">bloqueado</span>' : ""}${u.excluded ? ' <span class="badge b-pending">em pausa</span>' : ""}`,
          M(u.balance), M(u.deposits), u.bets_count, `<span class="badge ${u.risk_level === "alto" ? "sev-critica" : u.risk_level === "medio" ? "sev-alta" : ""}">${RISK[u.risk_level]}</span>`,
          esc(u.country), u.last_login_at ? `${RS.date(u.last_login_at)}<br><small>${esc(u.last_ip || "")}</small>` : "-",
          `<button class="btn sm" data-open-user="${u.id}">Abrir</button>`]), "Nenhum usuário encontrado.");
      if (can("users.balance")) {
        const { data: pa } = await sb.from("pending_actions").select("*").eq("status", "pendente").order("created_at");
        RS.$("#u-pending").innerHTML = pa?.length ? `<div class="panel"><h2>Ajustes aguardando 2º aprovador</h2>${table(["Pedido", "Quem pediu", "Detalhes", ""], pa.map((a) => [
          `#${a.id} · ${RS.date(a.created_at)}`, esc(a.requested_email || ""), `${M(a.payload.amount)} · ${esc(a.payload.reason)} · <a href="#" data-open-user="${a.payload.user_id}" style="color:var(--primary)">jogador</a>`,
          `<button class="btn sm" data-pa="${a.id}" data-ok="1">Aprovar</button><button class="btn sm danger" data-pa="${a.id}">Recusar</button>`]))}</div>` : "";
      }
    }
    let t;
    ["#u-q", "#u-min", "#u-max", "#u-country"].forEach((id) => (RS.$(id).oninput = () => { clearTimeout(t); t = setTimeout(load, 350); }));
    ["#u-st", "#u-risk"].forEach((id) => (RS.$(id).onchange = load));
    RS.$("#u-pending").onclick = async (e) => {
      const b = e.target.closest("[data-pa]");
      if (b && await act("admin_decide_action", { p_id: +b.dataset.pa, p_approve: !!b.dataset.ok, p_reason: null }, b.dataset.ok ? "Ajuste aprovado" : "Pedido recusado")) load();
    };
    RS.$("#u-msg-all")?.addEventListener("click", () => sendMessage(null));
    await load();
  }

  async function sendMessage(userId) {
    const v = await A().ask(userId ? "Enviar mensagem" : "Mensagem para todos os jogadores", [
      { name: "title", label: "Título", required: true }, { name: "body", label: "Mensagem", type: "textarea" }], "Enviar");
    if (v) { const n = await A().act("admin_send_notification", { p_user: userId, p_title: v.title, p_body: v.body }); if (n) RS.toast(`Enviada para ${n} jogador(es)`, "ok"); }
  }

  async function profile(id) {
    const { can, act, ask, table, head, badge } = A();
    const d = await RS.rpc("admin_user_profile", { p_user: id });
    const p = d.profile, t = d.totals, l = d.limits || {};
    main().innerHTML = head(`${esc(p.username || p.email)}`, `<button class="btn btn-outline" data-back>← Voltar</button>`) + `
      <div class="panel"><p><b>${esc(p.email)}</b> · ID <code>${p.id}</code></p>
        <p style="margin-top:6px">${p.blocked ? '<span class="badge b-lost">bloqueado</span> ' : '<span class="badge b-won">ativo</span> '}
          <span class="badge ${p.risk_level === "alto" ? "sev-critica" : p.risk_level === "medio" ? "sev-alta" : ""}">risco ${RISK[p.risk_level]}</span>
          ${l.self_excluded_until && new Date(l.self_excluded_until) > new Date() ? `<span class="badge b-pending">em pausa até ${RS.date(l.self_excluded_until)}</span>` : ""}
          ${d.alerts ? `<span class="badge sev-critica">${d.alerts} alerta(s) aberto(s)</span>` : ""}
          · País ${esc(p.country)} · Cadastro ${RS.date(p.created_at)} · Último acesso ${p.last_login_at ? RS.date(p.last_login_at) + " (" + esc(p.last_ip || "") + ")" : "-"}</p>
        <div class="filters" style="margin:12px 0 0">
          ${can("users.balance") ? `<button class="btn sm" data-a="adj">Ajustar saldo</button>` : ""}
          ${can("users.block") ? `<button class="btn sm ${p.blocked ? "" : "danger"}" data-a="blk">${p.blocked ? "Desbloquear" : "Bloquear"}</button><button class="btn sm" data-a="risk">Nível de risco</button>` : ""}
          ${can("users.message") ? `<button class="btn sm" data-a="msg">Enviar mensagem</button>` : ""}
          ${can("users.limits") ? `<button class="btn sm" data-a="lim">Limites de jogo</button>` : ""}
          <button class="btn sm" data-a="note">Adicionar nota</button></div></div>
      <div class="kpis">${[["Saldo", M(p.balance)], ["Depósitos", M(t.deposits)], ["Saques", M(t.withdrawals)], ["Apostado", M(t.staked)], ["Prêmios", M(t.won)],
        ["Resultado p/ casa", M(t.staked - t.won), t.staked - t.won >= 0], ["Ajustes manuais", M(t.adjust)], ["Método mais usado", t.method]]
        .map(([k, v, ok]) => `<div class="kpi ${ok === true ? "pos" : ok === false ? "neg" : ""}"><small>${k}</small><b>${v}</b></div>`).join("")}</div>
      <div class="tabs-sm" id="pf-tabs">${[["bets", "Apostas"], ["casino", "Cassino"], ["tx", "Transações"], ["dev", "Logins e dispositivos"], ["linked", `Contas ligadas (${d.linked.length})`],
        ["notes", `Notas (${d.notes.length})`], ["limits", "Limites"]].map(([k, v], i) => `<button class="chip ${i ? "" : "active"}" data-t="${k}">${v}</button>`).join("")}</div>
      <div id="pf-body"></div>`;
    async function tab(k) {
      RS.$$("#pf-tabs .chip").forEach((x) => x.classList.toggle("active", x.dataset.t === k));
      const box = RS.$("#pf-body");
      if (k === "bets") {
        const { data } = await sb.from("bets").select("*, bet_selections(pick, odd, status, matches(home, away))").eq("user_id", id).order("created_at", { ascending: false }).limit(100);
        box.innerHTML = table(["#", "Data", "Seleções", "Aposta", "Odd", "Retorno", "Status"], (data || []).map((b) => [b.id, RS.date(b.created_at),
          b.bet_selections.map((s) => `${esc(s.matches?.home)} x ${esc(s.matches?.away)} · ${s.pick} @ ${s.odd} ${badge(s.status)}`).join("<br>"),
          M(b.stake), b.total_odd, M(b.status === "cashout" ? b.cashout_amount : b.potential), badge(b.status)]), "Sem apostas.");
      }
      if (k === "casino") {
        const { data } = await sb.from("casino_games").select("id,game,stake,mines,multiplier,payout,status,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(100);
        box.innerHTML = table(["#", "Data", "Jogo", "Aposta", "Mult.", "Prêmio", "Status"], (data || []).map((g) => [g.id, RS.date(g.created_at),
          g.game === "mines" ? `Mines (${g.mines})` : "Dados", M(g.stake), Number(g.multiplier).toFixed(2) + "x", M(g.payout), badge(g.status)]), "Sem partidas.");
      }
      if (k === "tx") {
        const { data } = await sb.from("transactions").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(200);
        box.innerHTML = table(["#", "Data", "Descrição", "Valor", "Status"], (data || []).map((x) => [x.id, RS.date(x.created_at), esc(x.description || x.type),
          `<span class="${x.amount >= 0 ? "pos" : "neg"}">${M(x.amount)}</span>`, badge(x.status)]), "Sem transações.");
      }
      if (k === "dev") box.innerHTML = table(["Data", "IP", "Dispositivo (hash)", "Navegador"], d.devices.map((x) => [RS.date(x.created_at), esc(x.ip || ""),
        `<code>${esc((x.fingerprint || "").slice(0, 12))}</code>`, `<small>${esc(x.user_agent || "")}</small>`]), "Nenhum login registrado ainda.");
      if (k === "linked") box.innerHTML = table(["Conta", "Status"], d.linked.map((x) => [`<a href="#" data-open-user="${x.id}" style="color:var(--primary)">${esc(x.email)}</a>`,
        x.blocked ? badge("lost", "bloqueado") : badge("won", "ativo")]), "Nenhuma conta usa o mesmo dispositivo ou IP.");
      if (k === "notes") box.innerHTML = table(["Data", "Autor", "Nota"], d.notes.map((n) => [RS.date(n.created_at), esc(n.author_email || ""), esc(n.body)]), "Sem notas.");
      if (k === "limits") box.innerHTML = table(["Limite", "Valor"], [["Depósito/dia", l.deposit_day ? M(l.deposit_day) : "-"], ["Depósito/semana", l.deposit_week ? M(l.deposit_week) : "-"],
        ["Depósito/mês", l.deposit_month ? M(l.deposit_month) : "-"], ["Perda/dia", l.loss_day ? M(l.loss_day) : "-"],
        ["Pausa até", l.self_excluded_until ? RS.date(l.self_excluded_until) : "-"], ["Mudança agendada", l.pending ? `${esc(JSON.stringify(l.pending))} em ${RS.date(l.pending_at)}` : "-"]]);
    }
    RS.$("#pf-tabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) tab(b.dataset.t); };
    main().querySelector("[data-back]").onclick = () => A().go("users");
    main().querySelector(".filters").onclick = async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      let ok = null;
      if (a === "adj") {
        const v = await ask("Ajustar saldo", [{ name: "amount", label: "Valor (negativo para retirar)", type: "number", required: true },
          { name: "reason", label: "Motivo (fica na auditoria)", type: "textarea", required: true }]);
        if (v) { ok = await act("admin_adjust_balance", { p_user: id, p_amount: Number(v.amount), p_reason: v.reason }); if (ok) RS.toast(ok === "pendente" ? "Pedido criado: outra pessoa precisa aprovar." : "Saldo ajustado", "ok"); }
      }
      if (a === "blk") {
        const v = p.blocked ? { reason: null } : await ask("Bloquear conta", [{ name: "reason", label: "Motivo do bloqueio", type: "textarea", required: true }]);
        if (v) ok = await act("admin_set_blocked", { p_user: id, p_blocked: !p.blocked, p_reason: v.reason }, "Atualizado");
      }
      if (a === "risk") {
        const v = await ask("Nível de risco", [{ name: "level", label: "Nível", value: p.risk_level, options: Object.entries(RISK) }, { name: "reason", label: "Motivo", type: "textarea", required: true }]);
        if (v) ok = await act("admin_set_risk", { p_user: id, p_level: v.level, p_reason: v.reason }, "Risco atualizado");
      }
      if (a === "msg") return sendMessage(id);
      if (a === "lim") {
        const v = await ask("Limites de jogo responsável", [
          { name: "dd", label: "Depósito/dia (R$, vazio = sem limite)", type: "number", value: l.deposit_day ?? "" },
          { name: "dw", label: "Depósito/semana", type: "number", value: l.deposit_week ?? "" },
          { name: "dm", label: "Depósito/mês", type: "number", value: l.deposit_month ?? "" },
          { name: "ld", label: "Perda/dia", type: "number", value: l.loss_day ?? "" },
          { name: "ex", label: "Pausa até (vazio = sem pausa)", type: "datetime-local", value: l.self_excluded_until ? new Date(new Date(l.self_excluded_until) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "" },
          { name: "reason", label: "Motivo", type: "textarea", required: true }]);
        const n = (x) => (x === "" ? null : Number(x));
        if (v) ok = await act("admin_set_limits", { p_user: id, p_deposit_day: n(v.dd), p_deposit_week: n(v.dw), p_deposit_month: n(v.dm), p_loss_day: n(v.ld),
          p_excluded_until: v.ex ? new Date(v.ex).toISOString() : null, p_reason: v.reason }, "Limites salvos");
      }
      if (a === "note") {
        const v = await ask("Nota interna", [{ name: "body", label: "Nota (só a equipe vê)", type: "textarea", required: true }]);
        if (v) ok = await act("admin_add_note", { p_user: id, p_body: v.body }, "Nota salva");
      }
      if (ok) profile(id);
    };
    await tab("bets");
  }

  // ---------- FINANCEIRO ----------
  const LEVEL = { rapido: ["Rápido", "b-won"], manual: ["Manual", "b-pending"], dupla: ["2 aprovadores", "b-lost"] };
  async function finance() {
    const { can, act, ask, table, head, badge, csv } = A();
    main().innerHTML = head("Financeiro") + `
      <div class="tabs-sm" id="f-tabs"><button class="chip active" data-v="queue">Fila de saques</button><button class="chip" data-v="all">Depósitos e saques</button><button class="chip" data-v="rec">Reconciliação</button></div>
      <div id="f-body"></div>`;
    let view = "queue";
    async function queue() {
      const { data } = await sb.from("transactions").select("*, profiles(email, risk_level)").eq("type", "withdraw").eq("status", "pending").order("created_at");
      const rows = data || [];
      const sum = rows.reduce((a, t) => a + Math.abs(t.amount), 0);
      RS.$("#f-body").innerHTML = `<p class="muted" style="margin-bottom:8px">${rows.length} saque(s) aguardando · ${M(sum)}. Fila rápida = sem risco e abaixo do limite; manual = motivos ao lado; 2 aprovadores = valor alto.</p>` +
        table(["#", "Jogador", "Valor", "Pedido em", "Fila", "Motivos", ""], rows.map((t) => [t.id,
          `<a href="#" data-open-user="${t.user_id}" style="color:var(--primary)">${esc(t.profiles?.email || "")}</a><br><small>risco ${esc(t.profiles?.risk_level || "")}</small>`,
          `<b>${M(Math.abs(t.amount))}</b>`, RS.date(t.created_at),
          `<span class="badge ${(LEVEL[t.review_level] || ["", ""])[1]}">${(LEVEL[t.review_level] || ["Manual"])[0]}</span>${t.first_approver ? "<br><small>1ª aprovação feita</small>" : ""}`,
          `<small>${esc(t.review_notes || "-")}</small>`,
          can("finance.manage") ? `<button class="btn sm btn-green" data-ok="${t.id}">${t.review_level === "dupla" && !t.first_approver ? "1ª aprovação" : "Aprovar e pagar"}</button><button class="btn sm danger" data-no="${t.id}">Recusar</button>` : ""]),
          "Nenhum saque na fila.");
    }
    async function all() {
      const { data } = await sb.from("transactions").select("*, profiles(email)").in("type", ["deposit", "withdraw"]).order("created_at", { ascending: false }).limit(300);
      RS.$("#f-body").innerHTML = table(["#", "Usuário", "Tipo", "Método", "Valor", "Taxa", "Data", "Status", ""], (data || []).map((t) => [t.id,
        `<a href="#" data-open-user="${t.user_id}" style="color:var(--primary)">${esc(t.profiles?.email || "")}</a>`, t.type === "deposit" ? "Depósito" : "Saque", esc(t.method || "PIX"),
        M(Math.abs(t.amount)), t.fee ? M(t.fee) : "-", RS.date(t.created_at), badge(t.status),
        t.status === "pending" && can("finance.manage") ? `<button class="btn sm" data-ok="${t.id}">Aprovar</button><button class="btn sm danger" data-no="${t.id}">Recusar</button>`
          : t.type === "deposit" && t.status === "done" && can("chargeback.manage") ? `<button class="btn sm btn-outline danger" data-cbtx="${t.id}">Contestação</button>` : ""]), "Nenhuma transação.");
    }
    async function rec() {
      const to = new Date(Date.now() + 60000), from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
      const r = await RS.rpc("admin_reconciliation", { p_from: from.toISOString(), p_to: to.toISOString() });
      const tot = r.days.reduce((a, d) => ({ dep: a.dep + +d.deposits, wd: a.wd + +d.withdrawals, fee: a.fee + +d.fees, net: a.net + +d.net }), { dep: 0, wd: 0, fee: 0, net: 0 });
      RS.$("#f-body").innerHTML = `<div class="kpis">${[["Entradas (30 dias)", M(tot.dep)], ["Saídas (30 dias)", M(tot.wd)], ["Taxas de gateway", M(tot.fee)], ["Resultado de caixa", M(tot.net), tot.net >= 0],
          ["Saldo retido (jogadores)", M(r.retained)], ["Saques pendentes", M(r.pending_withdrawals)], ["Depósitos pendentes", M(r.pending_deposits)],
          ["Divergências de saldo", r.ledger_diff, r.ledger_diff ? false : true]].map(([k, v, ok]) => `<div class="kpi ${ok === true ? "pos" : ok === false ? "neg" : ""}"><small>${k}</small><b>${v}</b></div>`).join("")}</div>
        <div class="filters"><button class="btn btn-outline" id="rec-csv">Exportar CSV</button><small class="muted">Confira estes totais com o extrato do gateway de pagamento. Divergências de saldo aparecem em Alertas.</small></div>` +
        table(["Dia", "Depósitos", "Qtd.", "Saques", "Qtd.", "Taxas", "Líquido"], r.days.map((d) => [d.day.split("-").reverse().join("/"), M(d.deposits), d.deposits_n, M(d.withdrawals), d.withdrawals_n, M(d.fees),
          `<span class="${d.net >= 0 ? "pos" : "neg"}">${M(d.net)}</span>`]), "Sem movimentação no período.");
      RS.$("#rec-csv").onclick = () => csv("reconciliacao.csv", [["dia", "depositos", "qtd_depositos", "saques", "qtd_saques", "taxas", "liquido"],
        ...r.days.map((d) => [d.day, d.deposits, d.deposits_n, d.withdrawals, d.withdrawals_n, d.fees, d.net])]);
    }
    const load = () => (view === "queue" ? queue() : view === "all" ? all() : rec());
    RS.$("#f-tabs").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; view = b.dataset.v; RS.$$("#f-tabs .chip").forEach((x) => x.classList.toggle("active", x === b)); load(); };
    RS.$("#f-body").onclick = async (e) => {
      const cbt = e.target.closest("[data-cbtx]");
      if (cbt) {
        const f = await ask("Registrar contestação do depósito #" + cbt.dataset.cbtx, [{ name: "reason", label: "Motivo (ex.: PIX contestado no banco, MED)", type: "textarea", required: true }], "Registrar");
        if (f && await act("admin_chargeback_open", { p_tx: +cbt.dataset.cbtx, p_reason: f.reason }, "Contestação registrada")) load();
        return;
      }
      const b = e.target.closest("button[data-ok],button[data-no]");
      if (!b) return;
      const approve = !!b.dataset.ok;
      if (!confirm(approve ? "Aprovar esta transação? Para saque, faça o PIX ao jogador antes de confirmar." : "Recusar? Em saque, o valor volta para o saldo do jogador.")) return;
      if (await act("admin_review_transaction", { p_tx: +(b.dataset.ok || b.dataset.no), p_approve: approve }, approve ? "Aprovação registrada" : "Recusado")) load();
    };
    await load();
  }

  // ---------- APOSTAS E JOGOS ----------
  async function sports() {
    const { can, act, table, head, badge } = A();
    const manage = can("sports.manage");
    main().innerHTML = head("Apostas e jogos") + `
      <div class="tabs-sm" id="sp-tabs"><button class="chip active" data-v="matches">Jogos</button><button class="chip" data-v="bets">Bilhetes</button><button class="chip" data-v="exp">Exposição</button></div>
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
      <div id="sp-bets" hidden></div><div id="sp-exp" hidden></div>`;
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
          <button class="btn sm danger" data-void="${m.id}">Anular mercado</button>
          <button class="btn sm danger" data-del="${m.id}">Excluir</button>`]), "Nenhum jogo.");
    }
    async function bets() {
      const { data } = await sb.from("bets").select("*, profiles(email), bet_selections(count)").order("created_at", { ascending: false }).limit(150);
      RS.$("#sp-bets").innerHTML = (manage ? `<div class="filters"><button class="btn btn-outline danger sm" id="b-cancel">Cancelar selecionados (reembolsa)</button></div>` : "") + table(["", "#", "Usuário", "Jogos", "Aposta", "Odd", "Retorno", "Status", "Data"], (data || []).map((b) => [
        manage && b.status === "pending" ? `<input type="checkbox" data-bc="${b.id}">` : "", b.id, `<a href="#users" data-open-user="${b.user_id}" style="color:var(--primary)">${esc(b.profiles?.email || "")}</a>`, b.bet_selections[0]?.count,
        M(b.stake), b.total_odd, M(b.potential), badge(b.status), RS.date(b.created_at)]), "Nenhum bilhete.");
    }
    RS.$("#sp-tabs").onclick = (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      RS.$$("#sp-tabs .chip").forEach((x) => x.classList.toggle("active", x === b));
      RS.$("#sp-matches").hidden = b.dataset.v !== "matches";
      RS.$("#sp-bets").hidden = b.dataset.v !== "bets";
      RS.$("#sp-exp").hidden = b.dataset.v !== "exp";
      if (b.dataset.v === "bets") bets();
      if (b.dataset.v === "exp") exposure();
    };
    async function exposure() {
      const rows = await RS.rpc("admin_exposure");
      RS.$("#sp-exp").innerHTML = `<p class="muted" style="margin-bottom:8px">Quanto a casa paga em cada resultado, somando os bilhetes em aberto. Suspenda ou anule jogos com exposição alta.</p>` +
        table(["Jogo", "Bilhetes", "Apostado", "Paga se 1", "Paga se X", "Paga se 2", "Pior caso", ""], rows.map((m) => [
          `<small>${esc(m.league)}</small><br>${esc(m.home)} x ${esc(m.away)} ${badge(m.status)}`, m.bets, M(m.staked), M(m.pay_home), M(m.pay_draw), M(m.pay_away),
          `<b class="${m.worst > m.staked ? "neg" : ""}">${M(m.worst)}</b>`,
          manage ? `<button class="btn sm ${m.locked ? "" : "danger"}" data-lock="${m.id}" data-v="${m.locked ? "0" : "1"}">${m.locked ? "Liberar" : "Suspender"}</button>` : ""]), "Nenhum bilhete em aberto.");
    }
    RS.$("#sp-exp").onclick = async (e) => {
      const b = e.target.closest("[data-lock]");
      if (b && await act("admin_match_set", { p_match: +b.dataset.lock, p_locked: b.dataset.v === "1" }, "Atualizado")) exposure();
    };
    RS.$("#sp-bets").onclick = async (e) => {
      if (e.target.id !== "b-cancel") return;
      const ids = RS.$$("[data-bc]:checked").map((x) => +x.dataset.bc);
      if (!ids.length) { RS.toast("Marque os bilhetes", "error"); return; }
      const v = await A().ask(`Cancelar ${ids.length} bilhete(s)`, [{ name: "r", label: "Motivo (o valor apostado volta para o jogador)", type: "textarea", required: true }]);
      if (v && await act("admin_cancel_bets", { p_bets: ids, p_reason: v.r }, "Bilhetes cancelados")) bets();
    };
    RS.$("#m-list").onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.void) {
        const v = await A().ask("Anular mercado", [{ name: "r", label: "Motivo (erro de odd, jogo adiado…). Seleções deste jogo viram odd 1; bilhetes simples são reembolsados.", type: "textarea", required: true }]);
        if (v && await act("admin_void_match", { p_match: +b.dataset.void, p_reason: v.r }, "Mercado anulado")) matches();
        return;
      }
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


  // ---------- RISCO, KYC E CONTESTAÇÕES ----------
  const DOC = { rg: "RG", cnh: "CNH", comprovante: "Comprovante de residência", selfie: "Selfie com documento" };
  async function risk() {
    const { can, act, ask, table, head, badge } = A();
    const tabs = [["kyc", "Fila de KYC", "kyc.view"], ["susp", "Apostas suspeitas", "alerts.view"], ["cb", "Contestações (chargeback)", "chargeback.manage"]].filter((t) => can(t[2]));
    main().innerHTML = head("Risco e KYC") + `<div class="tabs-sm" id="r-tabs">${tabs.map(([v, t], i) => `<button class="chip ${i ? "" : "active"}" data-v="${v}">${t}</button>`).join("")}</div><div id="r-body"></div>`;
    let view = tabs[0]?.[0], kst = "em_analise";
    async function kyc() {
      const { data } = await sb.from("kyc_documents").select("*, profiles(email, kyc_status)").eq("status", kst).order("created_at", { ascending: kst === "em_analise" }).limit(200);
      RS.$("#r-body").innerHTML = `<div class="filters"><select class="input" id="k-st"><option value="em_analise">Em análise</option><option value="aprovado">Aprovados</option><option value="rejeitado">Rejeitados</option></select>
        <small class="muted">O KYC do jogador fica aprovado com RG ou CNH + comprovante aprovados. Sem KYC, o saque vai para revisão manual.</small></div>` +
        table(["#", "Jogador", "Documento", "Enviado em", "Status", "Motivo", ""], (data || []).map((d) => [d.id,
          `<a href="#" data-open-user="${d.user_id}" style="color:var(--primary)">${esc(d.profiles?.email || "")}</a><br><small>KYC ${esc((d.profiles?.kyc_status || "").replace("_", " "))}</small>`,
          DOC[d.doc_type] || d.doc_type, RS.date(d.created_at), badge(d.status), `<small>${esc(d.reason || "-")}</small>`,
          `<button class="btn sm btn-outline" data-view="${esc(d.path)}">Ver arquivo</button>` + (d.status === "em_analise" && can("kyc.manage")
            ? `<button class="btn sm btn-green" data-kok="${d.id}">Aprovar</button><button class="btn sm danger" data-kno="${d.id}">Rejeitar</button>` : "")]), "Nenhum documento.");
      RS.$("#k-st").value = kst;
      RS.$("#k-st").onchange = (e) => { kst = e.target.value; kyc(); };
    }
    async function susp() {
      const rows = await RS.rpc("admin_suspicious_bets", { p_days: 7 }).catch((e) => { RS.toast(e.message, "error"); return []; });
      RS.$("#r-body").innerHTML = `<p class="muted" style="margin-bottom:8px">Bilhetes dos últimos 7 dias com padrão de risco: múltiplas de odd alta, valor muito acima da média do jogador, apostas nos dois lados do mesmo jogo e contas ligadas (mesmo IP/dispositivo) no mesmo palpite.</p>` +
        table(["#", "Jogador", "Valor", "Odd", "Retorno", "Status", "Data", "Motivos"], rows.map((b) => [b.id,
          `<a href="#" data-open-user="${b.user_id}" style="color:var(--primary)">${esc(b.email || "")}</a><br><small>risco ${esc(b.risk_level)}</small>`,
          M(b.stake), (+b.total_odd).toFixed(2), M(b.potential), badge(b.status), RS.date(b.created_at), b.reasons.map((r) => `<span class="badge b-rejected">${esc(r)}</span>`).join(" ")]), "Nenhuma aposta suspeita.");
    }
    async function cb() {
      const { data } = await sb.from("chargebacks").select("*, profiles(email)").order("created_at", { ascending: false }).limit(200);
      RS.$("#r-body").innerHTML = `<div class="filters"><button class="btn btn-primary" id="cb-new">Registrar contestação</button>
        <small class="muted">Ao registrar, o valor é debitado do saldo disponível, o risco do jogador vira Alto e os saques dele vão para revisão manual. Se o caso for ganho pelo jogador, o valor volta ao saldo.</small></div>` +
        table(["#", "Jogador", "Depósito", "Valor", "Recuperado", "Motivo", "Status", "Data", ""], (data || []).map((c) => [c.id,
          `<a href="#" data-open-user="${c.user_id}" style="color:var(--primary)">${esc(c.profiles?.email || "")}</a>`, "#" + c.tx_id, M(c.amount), M(c.recovered),
          `<small>${esc(c.reason)}${c.notes ? "<br>" + esc(c.notes) : ""}</small>`, esc(c.status), RS.date(c.created_at),
          `<button class="btn sm btn-outline" data-cb="${c.id}" data-st="${c.status}">Atualizar</button>`]), "Nenhuma contestação.");
      RS.$("#cb-new").onclick = () => openChargeback();
    }
    async function openChargeback(tx) {
      const f = await ask("Registrar contestação de depósito", [{ name: "tx", label: "Nº do depósito", type: "number", value: tx || "", required: true },
        { name: "reason", label: "Motivo (ex.: PIX contestado no banco, MED)", type: "textarea", required: true }], "Registrar");
      if (f && await act("admin_chargeback_open", { p_tx: +f.tx, p_reason: f.reason }, "Contestação registrada")) load();
    }
    const load = () => (view === "kyc" ? kyc() : view === "susp" ? susp() : view === "cb" ? cb() : (RS.$("#r-body").innerHTML = `<p class="empty">Sem acesso.</p>`));
    RS.$("#r-tabs").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; view = b.dataset.v; RS.$$("#r-tabs .chip").forEach((x) => x.classList.toggle("active", x === b)); load(); };
    RS.$("#r-body").onclick = async (e) => {
      const v = e.target.closest("[data-view]");
      if (v) {
        const { data, error } = await sb.storage.from("kyc").createSignedUrl(v.dataset.view, 120);
        if (error) return RS.toast(error.message, "error");
        return window.open(data.signedUrl, "_blank", "noopener");
      }
      const k = e.target.closest("[data-kok],[data-kno]");
      if (k) {
        const ok = !!k.dataset.kok;
        const f = ok ? {} : await ask("Rejeitar documento", [{ name: "reason", label: "Motivo (o jogador recebe esta mensagem)", type: "textarea", required: true }], "Rejeitar");
        if (f && await act("admin_kyc_review", { p_id: +(k.dataset.kok || k.dataset.kno), p_approve: ok, p_reason: f.reason || null }, ok ? "Documento aprovado" : "Documento rejeitado")) kyc();
        return;
      }
      const c = e.target.closest("[data-cb]");
      if (c) {
        const f = await ask("Atualizar contestação", [{ name: "st", label: "Status", value: c.dataset.st, options: [["aberto", "Aberto"], ["contestado", "Contestado (defesa enviada)"], ["perdido", "Perdido (valor fica com o banco)"], ["ganho", "Ganho pelo jogador (devolve o valor)"]] },
          { name: "notes", label: "Observação", type: "textarea" }], "Salvar");
        if (f && await act("admin_chargeback_update", { p_id: +c.dataset.cb, p_status: f.st, p_notes: f.notes }, "Atualizado")) cb();
      }
    };
    await load();
  }

  window.RSmods = Object.assign(window.RSmods || {}, { users, finance, sports, risk, loaded: true });
  if (window.RSadmin?.ready) window.RSadmin.ready();
})();
