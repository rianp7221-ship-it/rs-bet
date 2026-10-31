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
          `<small>${esc(t.review_notes || "-")}</small>${t.pix_key ? `<br><small>PIX (${esc(t.pix_key_type)}): <b>${esc(t.pix_key)}</b></small> <button class="btn sm btn-outline" data-copy="${esc(t.pix_key)}">Copiar</button>` : "<br><small>sem chave PIX informada</small>"}`,
          can("finance.manage") ? `<button class="btn sm btn-green" data-ok="${t.id}">${t.review_level === "dupla" && !t.first_approver ? "1ª aprovação" : "Aprovar e pagar"}</button><button class="btn sm danger" data-no="${t.id}">Recusar</button>` : ""]),
          "Nenhum saque na fila.");
    }
    async function all() {
      const { data } = await sb.from("transactions").select("*, profiles(email)").in("type", ["deposit", "withdraw"]).order("created_at", { ascending: false }).limit(300);
      RS.$("#f-body").innerHTML = table(["#", "Usuário", "Tipo", "Método", "Valor", "Taxa", "Data", "Status", ""], (data || []).map((t) => [t.id,
        `<a href="#" data-open-user="${t.user_id}" style="color:var(--primary)">${esc(t.profiles?.email || "")}</a>`, t.type === "deposit" ? "Depósito" : "Saque", esc(t.method || "PIX") + (t.gateway ? `<br><small>${esc(t.gateway)}${t.provider_id ? " #" + esc(t.provider_id) : ""}</small>` : t.pix_key ? `<br><small>${esc(t.pix_key)}</small>` : ""),
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
      const cp = e.target.closest("button[data-copy]");
      if (cp) { e.preventDefault(); navigator.clipboard.writeText(cp.dataset.copy).then(() => RS.toast("Chave copiada", "ok")); return; }
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


  // ---------- BÔNUS, CUPONS, INDICAÇÕES E AFILIADOS ----------
  const KIND = { boas_vindas: "Boas-vindas (1º depósito)", deposito: "Bônus de depósito (cupom)", freebet: "Free bet", cashback: "Cashback", cupom: "Cupom de valor fixo" };
  const BST = { aguardando_deposito: "Aguardando depósito", ativo: "Ativo", concluido: "Liberado", expirado: "Expirado", cancelado: "Cancelado" };
  async function bonus() {
    const { can, act, ask, table, head } = A();
    const tabs = [["camp", "Campanhas e cupons", "bonus.view"], ["ub", "Bônus dos jogadores", "bonus.view"], ["aff", "Afiliados", "affiliates.manage"], ["ref", "Indicações", "bonus.view"]].filter((t) => can(t[2]));
    main().innerHTML = head("Bônus e marketing") + `<div class="tabs-sm" id="b-tabs">${tabs.map(([v, t], i) => `<button class="chip ${i ? "" : "active"}" data-v="${v}">${t}</button>`).join("")}</div><div id="b-body"></div>`;
    let view = tabs[0]?.[0];
    const body = () => RS.$("#b-body");
    const rule = (c) => [c.fixed > 0 ? M(c.fixed) : "", c.percent > 0 ? `${+c.percent}%` : ""].filter(Boolean).join(" + ") + (c.max_amount ? ` (máx. ${M(c.max_amount)})` : "");
    async function camp() {
      const { data } = await sb.from("bonus_campaigns").select("*").order("created_at", { ascending: false });
      body().innerHTML = (can("bonus.manage") ? `<div class="filters"><button class="btn btn-primary" id="c-new">Nova campanha</button><button class="btn btn-outline" id="c-grant">Bônus manual para jogador</button>
        <small class="muted">Boas-vindas sem código é aplicado sozinho no 1º depósito. Cupons com % ou depósito mínimo entram no próximo depósito.</small></div>` : "") +
        table(["#", "Campanha", "Tipo", "Código", "Valor", "Dep. mín.", "Rollover", "Odd mín.", "Validade", "Usos", "Status", ""], (data || []).map((c) => [c.id, esc(c.name), KIND[c.kind] || c.kind,
          c.code ? `<b>${esc(c.code)}</b>` : "-", rule(c), c.min_deposit > 0 ? M(c.min_deposit) : "-", `${+c.rollover}x`, (+c.min_odd).toFixed(2), `${c.valid_days} dias${c.ends_at ? "<br><small>até " + RS.date(c.ends_at) + "</small>" : ""}`,
          `${c.uses}${c.max_uses ? " / " + c.max_uses : ""}`, c.active ? `<span class="badge b-done">Ativa</span>` : `<span class="badge b-canceled">Pausada</span>`,
          can("bonus.manage") ? `<button class="btn sm btn-outline" data-tg="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? "Pausar" : "Ativar"}</button>` +
            (c.kind === "cashback" && c.active ? `<button class="btn sm" data-cb="${c.id}">Pagar cashback</button>` : "") : ""]), "Nenhuma campanha criada.");
      RS.$("#c-new")?.addEventListener("click", async () => {
        const f = await ask("Nova campanha de bônus", [
          { name: "name", label: "Nome", required: true },
          { name: "kind", label: "Tipo", options: Object.entries(KIND) },
          { name: "code", label: "Código do cupom (em branco = sem código)", placeholder: "EX.: BEMVINDO100" },
          { name: "fixed", label: "Valor fixo (R$)", type: "number", value: "0" },
          { name: "percent", label: "% do depósito ou das perdas (cashback)", type: "number", value: "0" },
          { name: "max_amount", label: "Bônus máximo (R$)", type: "number" },
          { name: "min_deposit", label: "Depósito mínimo (R$)", type: "number", value: "0" },
          { name: "rollover", label: "Rollover (x o valor do bônus)", type: "number", value: "5" },
          { name: "min_odd", label: "Odd mínima para contar no rollover", type: "number", value: "1.5" },
          { name: "valid_days", label: "Dias para cumprir", type: "number", value: "30" },
          { name: "max_uses", label: "Limite de usos (em branco = sem limite)", type: "number" },
          { name: "ends_at", label: "Encerrar em", type: "datetime-local" }], "Criar campanha");
        if (!f) return;
        if (f.ends_at) f.ends_at = new Date(f.ends_at).toISOString();
        if (await act("admin_save_campaign", { p: f }, "Campanha criada")) camp();
      });
      RS.$("#c-grant")?.addEventListener("click", async () => {
        const f = await ask("Bônus manual", [{ name: "user", label: "ID do jogador", required: true }, { name: "amount", label: "Valor (R$)", type: "number", required: true },
          { name: "rollover", label: "Rollover (x)", type: "number", value: "1" }, { name: "reason", label: "Motivo (fica na auditoria)", type: "textarea", required: true }], "Creditar");
        if (f && await act("admin_grant_bonus", { p_user: f.user.trim(), p_amount: +f.amount, p_rollover: +f.rollover, p_reason: f.reason }, "Bônus creditado")) view === "camp" ? camp() : ub();
      });
    }
    async function ub() {
      const { data } = await sb.from("user_bonuses").select("*, profiles(email), bonus_campaigns(name)").order("created_at", { ascending: false }).limit(300);
      body().innerHTML = table(["#", "Jogador", "Origem", "Valor", "Rollover", "Status", "Expira", ""], (data || []).map((b) => [b.id,
        `<a href="#" data-open-user="${b.user_id}" style="color:var(--primary)">${esc(b.profiles?.email || "")}</a>`,
        esc(b.bonus_campaigns?.name || ({ indicacao: "Indicação", manual: "Manual" })[b.kind] || b.kind), M(b.amount),
        b.wager_required > 0 ? `${M(b.wagered)} / ${M(b.wager_required)}` : "-", BST[b.status] || b.status, b.expires_at ? RS.date(b.expires_at) : "-",
        can("bonus.manage") && ["ativo", "aguardando_deposito"].includes(b.status) ? `<button class="btn sm danger" data-bx="${b.id}">Cancelar</button>` : ""]), "Nenhum bônus concedido.");
    }
    async function aff() {
      const to = new Date(Date.now() + 60000), from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0, 0, 0, 0);
      const rows = await RS.rpc("admin_affiliate_report", { p_from: from.toISOString(), p_to: to.toISOString() }).catch((e) => { RS.toast(e.message, "error"); return []; });
      const MOD = { cpa: "CPA", revshare: "Revenue share", hibrido: "Híbrido" };
      body().innerHTML = `<div class="filters"><button class="btn btn-primary" id="a-new">Novo afiliado</button><small class="muted">Últimos 30 dias. Link do afiliado: ${location.origin}/?aff=CODIGO. CPA conta 1º depósito acima do mínimo; revenue share é % do NGR positivo dos jogadores.</small></div>` +
        table(["Afiliado", "Código / link", "Modelo", "Cliques", "Cadastros", "FTD", "Depósitos", "NGR", "Comissão", ""], rows.map((a) => [esc(a.name),
          `<b>${esc(a.code)}</b><br><small>${location.origin}/?aff=${esc(a.code)}</small>`, `${MOD[a.model]}<br><small>${a.model !== "revshare" ? M(a.cpa_value) + " CPA " : ""}${a.model !== "cpa" ? +a.revshare_pct + "% RS" : ""}</small>`,
          a.clicks, a.signups, `${a.ftd}${a.ftd !== a.ftd_ok ? ` <small>(${a.ftd_ok} válidos)</small>` : ""}`, M(a.deposits), `<span class="${a.ngr >= 0 ? "pos" : "neg"}">${M(a.ngr)}</span>`, `<b>${M(a.commission)}</b>`,
          `<button class="btn sm btn-outline" data-af="${a.id}" data-on="${a.active ? 0 : 1}">${a.active ? "Desativar" : "Ativar"}</button>`]), "Nenhum afiliado cadastrado.");
      RS.$("#a-new").onclick = async () => {
        const f = await ask("Novo afiliado", [{ name: "name", label: "Nome", required: true }, { name: "email", label: "E-mail", type: "email" },
          { name: "code", label: "Código (letras minúsculas, números, - ou _)", required: true },
          { name: "model", label: "Modelo", options: Object.entries(MOD) }, { name: "cpa_value", label: "CPA por FTD (R$)", type: "number", value: "0" },
          { name: "cpa_min_deposit", label: "Depósito mínimo do FTD (R$)", type: "number", value: "20" }, { name: "revshare_pct", label: "Revenue share (%)", type: "number", value: "0" }], "Cadastrar");
        if (f && await act("admin_save_affiliate", { p: f }, "Afiliado cadastrado")) aff();
      };
    }
    async function ref() {
      const rows = await RS.rpc("admin_referrals").catch((e) => { RS.toast(e.message, "error"); return []; });
      body().innerHTML = `<p class="muted" style="margin-bottom:8px">O valor, o depósito mínimo e o rollover da indicação ficam em Configurações.</p>` +
        table(["Quem indicou", "Convidados", "Com 1º depósito", "Bônus recebido"], rows.map((r) => [`<a href="#" data-open-user="${r.id}" style="color:var(--primary)">${esc(r.email || "")}</a>`,
          r.invited, r.qualified, M(r.earned)]), "Nenhuma indicação ainda.");
    }
    const load = () => ({ camp, ub, aff, ref })[view]?.() ?? (body().innerHTML = `<p class="empty">Sem acesso.</p>`);
    RS.$("#b-tabs").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; view = b.dataset.v; RS.$$("#b-tabs .chip").forEach((x) => x.classList.toggle("active", x === b)); load(); };
    body().onclick = async (e) => {
      const t = e.target.closest("[data-tg]"), cb = e.target.closest("[data-cb]"), bx = e.target.closest("[data-bx]"), af = e.target.closest("[data-af]");
      if (t && await act("admin_save_campaign", { p: { id: t.dataset.tg, active: t.dataset.on === "1" } }, "Campanha atualizada")) camp();
      if (af && await act("admin_save_affiliate", { p: { id: af.dataset.af, active: af.dataset.on === "1" } }, "Afiliado atualizado")) aff();
      if (bx) {
        const f = await ask("Cancelar bônus", [{ name: "reason", label: "Motivo (o valor do bônus é retirado do saldo)", type: "textarea", required: true }], "Cancelar bônus");
        if (f && await act("admin_cancel_bonus", { p_id: +bx.dataset.bx, p_reason: f.reason }, "Bônus cancelado")) ub();
      }
      if (cb) {
        const d = new Date(); d.setHours(0, 0, 0, 0); const from = new Date(d); from.setDate(from.getDate() - 7);
        const f = await ask("Pagar cashback", [{ name: "from", label: "De", type: "date", value: from.toISOString().slice(0, 10) }, { name: "to", label: "Até (exclusivo)", type: "date", value: d.toISOString().slice(0, 10) }], "Calcular e pagar");
        if (!f) return;
        const r = await act("admin_run_cashback", { p_campaign: +cb.dataset.cb, p_from: new Date(f.from + "T00:00:00").toISOString(), p_to: new Date(f.to + "T00:00:00").toISOString() });
        if (r) { RS.toast(`Cashback pago a ${r.players} jogador(es): ${M(r.total)}`, "ok"); camp(); }
      }
    };
    await load();
  }


  // ---------- CASSINO: PROVEDORES, JOGOS, RTP E MONITOR ----------
  async function casino() {
    const { can, act, ask, table, head } = A();
    const manage = can("casino.manage");
    const pct = (v) => (v == null ? "-" : `${(+v).toFixed(2)}%`);
    main().innerHTML = head("Cassino") + `<div class="tabs-sm" id="cs-tabs"><button class="chip active" data-v="mon">Monitor</button><button class="chip" data-v="cfg">Jogos e provedores</button></div><div id="cs-body"></div>`;
    let view = "mon", hours = 24;
    const body = () => RS.$("#cs-body");
    async function mon() {
      const d = await RS.rpc("admin_casino_stats", { p_hours: hours }).catch((e) => { RS.toast(e.message, "error"); return null; });
      if (!d) return;
      const tot = d.games.reduce((a, g) => ({ h: a.h + +g.handle, p: a.p + +g.paid, r: a.r + +g.rounds }), { h: 0, p: 0, r: 0 });
      body().innerHTML = `<div class="filters"><select class="input" id="cs-h" style="max-width:160px">${[[1, "Última hora"], [24, "Últimas 24 h"], [168, "Últimos 7 dias"], [720, "Últimos 30 dias"]].map(([v, t]) => `<option value="${v}" ${v === hours ? "selected" : ""}>${t}</option>`).join("")}</select>
          <button class="btn btn-outline" id="cs-r">Atualizar</button><small class="muted">Rodadas ${tot.r} · Apostado ${M(tot.h)} · Pago ${M(tot.p)} · GGR <b>${M(tot.h - tot.p)}</b> · RTP real ${tot.h ? pct((100 * tot.p) / tot.h) : "-"}</small></div>` +
        table(["Jogo", "Provedor", "Status", "RTP config.", "RTP real", "Rodadas", "Jogadores", "Apostado", "Pago", "GGR", "Em andamento"], d.games.map((g) => [esc(g.name), esc(g.provider),
          g.active ? `<span class="badge b-done">Ligado</span>` : `<span class="badge b-canceled">Desligado</span>`, pct(g.rtp_config),
          g.rtp_real == null ? "-" : `<span class="${+g.rtp_real > +g.rtp_config + 5 ? "neg" : ""}">${pct(g.rtp_real)}</span>`, g.rounds, g.players, M(g.handle), M(g.paid),
          `<span class="${g.ggr >= 0 ? "pos" : "neg"}">${M(g.ggr)}</span>`, g.open_rounds]), "Sem jogos.") +
        `<h3 style="margin:16px 0 8px">Maiores prêmios do período</h3>` +
        table(["Quando", "Jogador", "Jogo", "Aposta", "Multiplicador", "Prêmio"], d.big_wins.map((w) => [RS.date(w.created_at),
          `<a href="#" data-open-user="${w.user_id}" style="color:var(--primary)">${esc(w.email || "")}</a>`, w.game === "mines" ? "Mines" : w.game === "dice" ? "Dados" : esc(w.game),
          M(w.stake), `${(+w.multiplier).toFixed(2)}x`, `<b>${M(w.payout)}</b>`]), "Nenhum prêmio no período.");
      RS.$("#cs-h").onchange = (e) => { hours = +e.target.value; mon(); };
      RS.$("#cs-r").onclick = mon;
    }
    async function cfg() {
      const [{ data: provs }, { data: games }] = await Promise.all([sb.from("casino_providers").select("*").order("name"), sb.from("casino_catalog").select("*").order("sort")]);
      const pname = Object.fromEntries((provs || []).map((p) => [p.id, p.name]));
      const toggle = (kind, id, on) => manage ? `<button class="btn sm btn-outline" data-${kind}="${id}" data-on="${on ? 0 : 1}">${on ? "Desligar" : "Ligar"}</button>` : "";
      body().innerHTML = `<p class="muted" style="margin-bottom:8px">O RTP do jogo tem prioridade sobre o do provedor, que tem prioridade sobre o RTP global (Configurações → casino_rtp_global). Em branco = herda. Partidas de Mines em andamento mantêm o RTP do início. Para desligar o cassino inteiro use Configurações → casino_enabled.</p>
        <h3 style="margin:8px 0">Provedores</h3>` +
        table(["Provedor", "Tipo", "Status", "RTP", ""], (provs || []).map((p) => [esc(p.name), p.kind === "interno" ? "Jogos próprios" : "Agregador",
          p.active ? `<span class="badge b-done">Ligado</span>` : `<span class="badge b-canceled">Desligado</span>`, p.rtp == null ? "herda global" : pct(p.rtp),
          toggle("pv", p.id, p.active) + (manage ? `<button class="btn sm" data-prtp="${p.id}" data-v="${p.rtp ?? ""}">RTP</button>` : "")]), "Nenhum provedor.") +
        `<h3 style="margin:16px 0 8px">Jogos</h3>` +
        table(["Jogo", "Provedor", "Categoria", "Status", "RTP", "Aposta mín.", "Aposta máx.", ""], (games || []).map((g) => [esc(g.name), esc(pname[g.provider] || g.provider), esc(g.category),
          g.active ? `<span class="badge b-done">Ligado</span>` : `<span class="badge b-canceled">Desligado</span>`, g.rtp == null ? "herda" : pct(g.rtp), M(g.min_stake), M(g.max_stake),
          toggle("gm", g.id, g.active) + (manage ? `<button class="btn sm" data-gedit="${g.id}">Editar</button>` : "")]), "Nenhum jogo.");
      body().onclick = async (e) => {
        const pv = e.target.closest("[data-pv]"), gm = e.target.closest("[data-gm]"), pr = e.target.closest("[data-prtp]"), ge = e.target.closest("[data-gedit]");
        if (pv) { const p = provs.find((x) => x.id === pv.dataset.pv); if (await act("admin_casino_provider", { p_id: p.id, p_active: pv.dataset.on === "1", p_rtp: p.rtp }, "Provedor atualizado")) cfg(); }
        if (gm) { const g = games.find((x) => x.id === gm.dataset.gm); if (await act("admin_casino_game", { p_id: g.id, p_active: gm.dataset.on === "1", p_rtp: g.rtp, p_min: null, p_max: null }, "Jogo atualizado")) cfg(); }
        if (pr) {
          const p = provs.find((x) => x.id === pr.dataset.prtp);
          const f = await ask(`RTP — ${p.name}`, [{ name: "rtp", label: "RTP (%) entre 80 e 99,5 — em branco herda o global", type: "number", value: p.rtp ?? "" }], "Salvar");
          if (f && await act("admin_casino_provider", { p_id: p.id, p_active: null, p_rtp: f.rtp === "" ? null : +f.rtp }, "RTP atualizado")) cfg();
        }
        if (ge) {
          const g = games.find((x) => x.id === ge.dataset.gedit);
          const f = await ask(`Editar ${g.name}`, [{ name: "rtp", label: "RTP (%) entre 80 e 99,5 — em branco herda o provedor", type: "number", value: g.rtp ?? "" },
            { name: "min", label: "Aposta mínima (R$)", type: "number", value: g.min_stake }, { name: "max", label: "Aposta máxima (R$)", type: "number", value: g.max_stake }], "Salvar");
          if (f && await act("admin_casino_game", { p_id: g.id, p_active: null, p_rtp: f.rtp === "" ? null : +f.rtp, p_min: +f.min, p_max: +f.max }, "Jogo atualizado")) cfg();
        }
      };
    }
    RS.$("#cs-tabs").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; view = b.dataset.v; RS.$$("#cs-tabs .chip").forEach((x) => x.classList.toggle("active", x === b)); body().onclick = null; view === "mon" ? mon() : cfg(); };
    await mon();
  }

  window.RSmods = Object.assign(window.RSmods || {}, { users, finance, sports, risk, bonus, casino, loaded: true });
  if (window.RSadmin?.ready) window.RSadmin.ready();
})();
