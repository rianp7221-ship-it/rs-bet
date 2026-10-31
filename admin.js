// =====================================================
//  admin.js — painel admin (cada módulo aparece conforme o cargo)
//  A proteção real está no banco: has_perm() em cada função e nas regras RLS.
// =====================================================
(async () => {
  const main = RS.$("#adm-main"), nav = RS.$("#adm-nav"), gate = RS.$("#adm-gate");
  if (!(await RS.requireLogin())) return;
  let perms = [];
  try { perms = (await RS.rpc("my_perms")) || []; } catch { perms = []; }
  if (!perms.length) { location.href = "index.html"; return; }
  const can = (p) => perms.includes("master") || perms.includes(p);
  const M = RS.money, esc = RS.esc;

  // ---------- utilidades ----------
  const STATUS = { open: "Aberto", live: "Ao vivo", closed: "Fechado", settled: "Liquidado", canceled: "Cancelado", pending: "Pendente",
    won: "Ganhou", lost: "Perdeu", done: "Concluída", rejected: "Recusada", cashout: "Cashout", aberto: "Aberto", em_analise: "Em análise", resolvido: "Resolvido" };
  const badge = (s, label) => `<span class="badge b-${s}">${label || STATUS[s] || s}</span>`;
  const head = (title, right = "") => `<div class="adm-head"><h1>${title}</h1><div class="filters" style="margin:0">${right}</div></div>`;
  const table = (cols, rows, empty = "Nada por aqui.") => rows.length
    ? `<table class="table"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<p class="empty">${empty}</p>`;
  async function act(fn, args, msg) {
    try { const r = await RS.rpc(fn, args); if (msg) RS.toast(msg, "ok"); return r ?? true; } catch (e) { RS.toast(e.message, "error"); return null; }
  }
  // formulário rápido em janela: ask("Título", [{ name, label, type, value, options, required }])
  function ask(title, fields, okText = "Confirmar") {
    return new Promise((resolve) => {
      const m = RS.modal(`<h3>${title}</h3><form id="ask-f">${fields.map((f) => `<label>${f.label}${f.options
        ? `<select class="input" name="${f.name}">${f.options.map(([v, t]) => `<option value="${v}" ${v === f.value ? "selected" : ""}>${t}</option>`).join("")}</select>`
        : f.type === "textarea" ? `<textarea class="input" name="${f.name}" rows="3" ${f.required ? "required" : ""}>${esc(f.value || "")}</textarea>`
        : `<input class="input" name="${f.name}" type="${f.type || "text"}" step="any" value="${esc(f.value ?? "")}" ${f.required ? "required" : ""} placeholder="${esc(f.placeholder || "")}">`}</label>`).join("")}
        <button class="btn btn-primary w-full">${okText}</button></form>`);
      let done = false;
      const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!done) resolve(null); } });
      RS.$("#ask-f", m).onsubmit = (e) => { e.preventDefault(); done = true; obs.disconnect(); resolve(Object.fromEntries(new FormData(e.target))); m.remove(); };
      obs.observe(document.body, { childList: true });
    });
  }
  function csv(name, rows) {
    const text = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv" })), download: name });
    a.click();
  }
  window.RSadmin = { can, act, ask, table, badge, head, csv, STATUS };

  // ---------- 2FA: se a conta tem 2FA, pede o código antes de abrir ----------
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    gate.textContent = "Confirme o código do seu app autenticador para abrir o painel.";
    const v = await ask("Verificação em 2 etapas", [{ name: "code", label: "Código de 6 dígitos", required: true }], "Entrar no painel");
    const { data: f } = await sb.auth.mfa.listFactors();
    const factor = f?.totp?.find((x) => x.status === "verified");
    const { error } = v && factor ? await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: v.code.trim() }) : { error: { message: "Código não informado" } };
    if (error) { RS.toast(error.message, "error"); gate.innerHTML = `Código inválido. <a href="admin.html" style="color:var(--primary)">Tentar de novo</a>`; return; }
    location.reload();
    return;
  }

  // ---------- módulos ----------
  const MODS = [
    { id: "dash", t: "Visão geral", ic: "grid", p: "kpi.view", run: dash },
    { id: "alerts", t: "Alertas", ic: "live", p: "alerts.view", run: alerts },
    { id: "users", t: "Usuários", ic: "user", p: "users.view", run: (id) => window.RSmods.users(id) },
    { id: "finance", t: "Financeiro", ic: "card", p: "finance.view", run: () => window.RSmods.finance() },
    { id: "sports", t: "Apostas e jogos", ic: "receipt", p: "sports.view", run: () => window.RSmods.sports() },
    { id: "staff", t: "Equipe e acessos", ic: "key", p: "staff.manage", run: staff },
    { id: "audit", t: "Auditoria", ic: "id", p: "audit.view", run: audit },
    { id: "settings", t: "Configurações", ic: "wallet", p: "settings.manage", run: settings },
    { id: "security", t: "Minha segurança (2FA)", ic: "lock", p: null, run: security },
  ].filter((m) => !m.p || can(m.p));
  window.RSmods = window.RSmods || {};
  let current = null, cleanup = null;
  nav.innerHTML = MODS.map((m) => `<a data-mod="${m.id}">${RS.icon(m.ic)} ${m.t}${m.id === "alerts" ? `<em id="al-count" hidden></em>` : ""}</a>`).join("");
  nav.onclick = (e) => { const a = e.target.closest("[data-mod]"); if (a) go(a.dataset.mod); };
  function go(id, arg) {
    const m = MODS.find((x) => x.id === id) || MODS[0];
    if (cleanup) { cleanup(); cleanup = null; }
    current = m;
    history.replaceState(null, "", "#" + m.id);
    RS.$$("[data-mod]", nav).forEach((a) => a.classList.toggle("active", a.dataset.mod === m.id));
    main.innerHTML = `<p class="muted">Carregando…</p>`;
    Promise.resolve(m.run(arg)).catch((e) => { main.innerHTML = `<p class="empty">Erro: ${esc(e.message)}</p>`; });
  }
  window.RSadmin.go = go;
  window.RSadmin.onLeave = (fn) => { cleanup = fn; };
  document.addEventListener("click", (e) => {
    const u = e.target.closest("[data-open-user]");
    if (u && can("users.view")) { e.preventDefault(); go("users", u.dataset.openUser); }
  });

  // contador de alertas + atualização em tempo real
  async function alertCount() {
    if (!can("alerts.view")) return;
    const { count } = await sb.from("alerts").select("id", { count: "exact", head: true }).neq("status", "resolvido");
    const el = RS.$("#al-count");
    if (el) { el.hidden = !count; el.textContent = count; }
  }
  let pend;
  const refresh = () => { clearTimeout(pend); pend = setTimeout(() => current?.refresh?.(), 1200); };
  sb.channel("adm")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, (e) => {
      RS.toast("Novo alerta: " + e.new.message, e.new.severity === "critica" ? "error" : "info"); alertCount(); refresh();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "alerts" }, () => { alertCount(); refresh(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, refresh)
    .subscribe();

  // ---------- 1. VISÃO GERAL ----------
  async function dash() {
    main.innerHTML = head("Visão geral", `<select class="input" id="d-range">
        <option value="today">Hoje</option><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="month">Este mês</option></select>`) + `
      <div class="kpis" id="d-kpis"></div>
      <div class="charts">
        <div class="chart-card"><h3>Fluxo de caixa</h3><div><canvas id="c-cash"></canvas></div></div>
        <div class="chart-card"><h3>Volume apostado e GGR</h3><div><canvas id="c-vol"></canvas></div></div>
        <div class="chart-card"><h3>Novos cadastros e bilhetes</h3><div><canvas id="c-users"></canvas></div></div>
      </div>
      ${can("alerts.view") ? `<div class="panel"><h2>Alertas abertos</h2><div id="d-alerts"></div></div>` : ""}
      <p class="muted small">GGR = apostado − prêmios. NGR = GGR − bônus. Lucro líquido = NGR − imposto sobre GGR − taxa do gateway (ajuste em Configurações).</p>`;
    let charts = [];
    const range = () => {
      const v = RS.$("#d-range").value, now = new Date();
      let from = new Date();
      if (v === "today") from.setHours(0, 0, 0, 0);
      else if (v === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
      else { from.setDate(from.getDate() - Number(v) + 1); from.setHours(0, 0, 0, 0); }
      return { from: from.toISOString(), to: new Date(now.getTime() + 60000).toISOString(), bucket: v === "today" ? "hour" : "day" };
    };
    function draw(id, type, labels, sets) {
      if (!window.Chart) return;
      charts.push(new Chart(RS.$(id), { type, data: { labels, datasets: sets },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } } }));
    }
    async function load() {
      const r = range();
      const [k, s] = await Promise.all([
        RS.rpc("admin_kpis", { p_from: r.from, p_to: r.to }),
        RS.rpc("admin_series", { p_from: r.from, p_to: r.to, p_bucket: r.bucket })]);
      const cards = [["Total apostado", M(k.handle)], ["GGR", M(k.ggr), k.ggr >= 0], ["NGR", M(k.ngr), k.ngr >= 0], ["Lucro líquido", M(k.net), k.net >= 0],
        ["Prêmios pagos", M(k.prizes)], ["Pagamentos (saques)", M(k.withdrawals)], ["Depósitos", M(k.deposits)], ["Imposto estimado", M(k.tax)],
        ["GGR esportes", M(k.sports_ggr)], ["GGR cassino", M(k.casino_ggr)], ["Novos cadastros", k.signups], ["1º depósito (FTD)", k.ftd],
        ["Jogadores ativos", k.active], ["Bilhetes", k.bets], ["Saldo dos jogadores", M(k.player_balance)], ["Exposição em aberto", M(k.open_exposure)],
        ["Saques pendentes", `${k.pending_withdrawals} · ${M(k.pending_withdrawals_sum)}`], ["Alertas abertos", k.open_alerts, k.open_alerts ? false : null]];
      RS.$("#d-kpis").innerHTML = cards.map(([l, v, ok]) => `<div class="kpi ${ok === true ? "pos" : ok === false ? "neg" : ""}"><small>${l}</small><b>${v}</b></div>`).join("");
      const labels = s.map((x) => (r.bucket === "hour" ? x.at.slice(11, 16) : `${x.at.slice(8, 10)}/${x.at.slice(5, 7)}`));
      charts.forEach((c) => c.destroy()); charts = [];
      draw("#c-cash", "bar", labels, [
        { label: "Depósitos", data: s.map((x) => x.deposits), backgroundColor: "#2f9b57" },
        { label: "Saques", data: s.map((x) => x.withdrawals), backgroundColor: "#d93545" }]);
      draw("#c-vol", "line", labels, [
        { label: "Apostado", data: s.map((x) => x.handle), borderColor: "#ff4d00", backgroundColor: "rgba(255,77,0,.12)", fill: true, tension: .3 },
        { label: "GGR", data: s.map((x) => x.ggr), borderColor: "#222838", tension: .3 }]);
      draw("#c-users", "bar", labels, [
        { label: "Cadastros", data: s.map((x) => x.signups), backgroundColor: "#4b63a8" },
        { label: "Bilhetes", data: s.map((x) => x.bets_count), backgroundColor: "#ffb23e" }]);
      if (can("alerts.view")) {
        const { data } = await sb.from("alerts").select("*").neq("status", "resolvido").order("created_at", { ascending: false }).limit(5);
        RS.$("#d-alerts").innerHTML = table(["Quando", "Gravidade", "Descrição"],
          (data || []).map((a) => [RS.date(a.created_at), `<span class="badge sev-${a.severity}">${a.severity}</span>`, esc(a.message)]), "Nenhum alerta aberto.");
      }
    }
    RS.$("#d-range").onchange = load;
    current.refresh = load;
    window.RSadmin.onLeave(() => { charts.forEach((c) => c.destroy()); current.refresh = null; });
    await load();
  }

  // ---------- ALERTAS ----------
  const KIND = { aposta_alta: "Aposta alta", retorno_alto: "Retorno alto", saque_sem_giro: "Saque sem apostar", saldo_divergente: "Saldo divergente",
    concentracao: "Apostas concentradas", multi_conta: "Multi-contas", odd_atrasada: "Odd atrasada" };
  async function alerts() {
    let st = "aberto";
    main.innerHTML = head("Alertas", `<div class="seg" id="al-st" style="min-width:330px"><button data-s="aberto" class="active">Abertos</button><button data-s="em_analise">Em análise</button><button data-s="resolvido">Resolvidos</button></div>`) + `<div id="al-list"></div>`;
    async function load() {
      const { data } = await sb.from("alerts").select("*, profiles(email)").eq("status", st).order("created_at", { ascending: false }).limit(200);
      RS.$("#al-list").innerHTML = table(["Quando", "Gravidade", "Tipo", "Descrição", "Jogador", ""], (data || []).map((a) => [
        RS.date(a.created_at), `<span class="badge sev-${a.severity}">${a.severity}</span>`, KIND[a.kind] || a.kind,
        esc(a.message) + (a.resolution ? `<br><small>Resolução: ${esc(a.resolution)}</small>` : ""),
        a.user_id ? `<a href="#users" data-open-user="${a.user_id}" style="color:var(--primary)">${esc(a.profiles?.email || "ver")}</a>` : "-",
        can("alerts.manage") && a.status !== "resolvido"
          ? `${a.status === "aberto" ? `<button class="btn sm" data-al="${a.id}" data-s="em_analise">Assumir</button>` : ""}<button class="btn sm" data-al="${a.id}" data-s="resolvido">Resolver</button>` : ""]),
        "Nenhum alerta aqui.");
    }
    RS.$("#al-st").onclick = (e) => { const b = e.target.closest("[data-s]"); if (!b) return; st = b.dataset.s; RS.$$("#al-st button").forEach((x) => x.classList.toggle("active", x === b)); load(); };
    RS.$("#al-list").onclick = async (e) => {
      const b = e.target.closest("[data-al]");
      if (!b) return;
      let res = null;
      if (b.dataset.s === "resolvido") {
        const v = await ask("Resolver alerta", [{ name: "r", label: "O que foi feito?", type: "textarea", required: true }]);
        if (!v) return; res = v.r;
      }
      if (await act("admin_alert_update", { p_id: +b.dataset.al, p_status: b.dataset.s, p_resolution: res }, "Alerta atualizado")) { load(); alertCount(); }
    };
    current.refresh = load;
    await load();
  }

  // ---------- EQUIPE ----------
  const ROLES = { master: "Master (tudo)", suporte: "Suporte", risco: "Risco", financeiro: "Financeiro", trader: "Trader (apostas)", marketing: "Marketing" };
  const PERM = { "kpi.view": "Ver indicadores", "alerts.view": "Ver alertas", "alerts.manage": "Tratar alertas", "users.view": "Ver jogadores",
    "users.block": "Bloquear jogadores", "users.limits": "Limites de jogo", "users.message": "Enviar mensagens", "users.balance": "Ajustar saldo",
    "finance.view": "Ver financeiro", "finance.manage": "Aprovar depósitos/saques", "sports.view": "Ver apostas", "sports.manage": "Gerenciar jogos e mercados",
    "audit.view": "Ver auditoria", "staff.manage": "Gerenciar equipe", "settings.manage": "Configurações" };
  async function staff() {
    main.innerHTML = head("Equipe e acessos") + `
      <div class="panel"><h2>Dar ou trocar cargo</h2>
        <form id="st-form" class="filters"><input class="input" name="email" type="email" placeholder="E-mail da pessoa (já cadastrada no site)" required style="min-width:280px">
          <select class="input" name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <button class="btn btn-primary">Salvar</button></form>
        <p class="muted small">Só o Master gerencia a equipe, a auditoria e as configurações. Toda mudança de cargo fica registrada.</p></div>
      <div class="panel"><h2>Equipe atual</h2><div id="st-list"></div></div>
      <div class="panel"><h2>O que cada cargo pode fazer</h2><div id="st-perms"></div></div>`;
    async function load() {
      const { data } = await sb.from("profiles").select("id,email,username,staff_role,is_admin").or("staff_role.not.is.null,is_admin.eq.true").order("email");
      RS.$("#st-list").innerHTML = table(["Pessoa", "Cargo", ""], (data || []).map((u) => [
        `${esc(u.username || "")}<br><small>${esc(u.email)}</small>`, u.is_admin ? "Master (dono)" : ROLES[u.staff_role],
        u.is_admin ? "" : `<button class="btn sm danger" data-rm="${esc(u.email)}">Remover acesso</button>`]));
      const { data: rp } = await sb.from("role_permissions").select("*");
      const by = {};
      (rp || []).forEach((r) => (by[r.role] ||= []).push(PERM[r.perm] || r.perm));
      RS.$("#st-perms").innerHTML = table(["Cargo", "Permissões"], [["Master", "Tudo, inclusive equipe, auditoria, configurações e ajuste de saldo"],
        ...Object.entries(by).map(([r, ps]) => [ROLES[r], ps.join(" · ")])]);
    }
    RS.$("#st-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (await act("admin_set_staff_role", { p_email: f.email, p_role: f.role }, "Cargo salvo")) { e.target.reset(); load(); }
    };
    RS.$("#st-list").onclick = async (e) => {
      const b = e.target.closest("[data-rm]");
      if (b && confirm(`Remover o acesso de ${b.dataset.rm} ao painel?`) && await act("admin_set_staff_role", { p_email: b.dataset.rm, p_role: null }, "Acesso removido")) load();
    };
    await load();
  }

  // ---------- AUDITORIA ----------
  async function audit() {
    main.innerHTML = head("Auditoria", `<input class="input" id="au-q" placeholder="Filtrar por ação, e-mail ou ID"><button class="btn btn-outline" id="au-csv">Exportar CSV</button>`) + `<div id="au-list"></div>`;
    let rows = [];
    async function load() {
      const q = RS.$("#au-q").value.trim().replace(/[,()]/g, "");
      let req = sb.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
      if (q) req = req.or(`action.ilike.%${q}%,actor_email.ilike.%${q}%,entity_id.ilike.%${q}%`);
      const { data } = await req;
      rows = data || [];
      RS.$("#au-list").innerHTML = table(["Quando", "Quem", "Ação", "Registro", "Motivo", "Detalhes", "IP"], rows.map((a) => [
        RS.date(a.created_at), esc(a.actor_email || "-"), `<b>${esc(a.action)}</b>`, `${esc(a.entity || "")} ${esc(a.entity_id || "")}`, esc(a.reason || ""),
        a.before || a.after ? `<details><summary>ver</summary><pre class="json">Antes: ${esc(JSON.stringify(a.before, null, 1))}\nDepois: ${esc(JSON.stringify(a.after, null, 1))}</pre></details>` : "",
        esc(a.ip || "")]), "Nenhum registro.");
    }
    let t;
    RS.$("#au-q").oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
    RS.$("#au-csv").onclick = () => csv("auditoria.csv", [["data", "quem", "acao", "entidade", "id", "motivo", "antes", "depois", "ip"],
      ...rows.map((a) => [a.created_at, a.actor_email, a.action, a.entity, a.entity_id, a.reason, JSON.stringify(a.before), JSON.stringify(a.after), a.ip])]);
    await load();
  }

  // ---------- CONFIGURAÇÕES ----------
  async function settings() {
    main.innerHTML = head("Configurações") + `<div class="panel" id="se-list"></div>`;
    async function load() {
      const { data } = await sb.from("settings").select("*").order("key");
      RS.$("#se-list").innerHTML = table(["Configuração", "Valor", ""], (data || []).map((s) => {
        const t = typeof s.value;
        const input = t === "boolean"
          ? `<select class="input" data-k="${s.key}" style="margin:0"><option value="true" ${s.value ? "selected" : ""}>Sim</option><option value="false" ${!s.value ? "selected" : ""}>Não</option></select>`
          : `<input class="input" data-k="${s.key}" style="margin:0;max-width:200px" type="${t === "number" ? "number" : "text"}" step="any" value="${esc(t === "string" ? s.value : JSON.stringify(s.value))}">`;
        return [`${esc(s.label || s.key)}<br><small>${esc(s.key)}</small>`, input, `<button class="btn sm" data-save="${s.key}" data-t="${t}">Salvar</button>`];
      }));
    }
    RS.$("#se-list").onclick = async (e) => {
      const b = e.target.closest("[data-save]");
      if (!b) return;
      const raw = RS.$(`[data-k="${b.dataset.save}"]`).value;
      let v;
      try { v = b.dataset.t === "string" ? raw : JSON.parse(raw); } catch { RS.toast("Valor inválido", "error"); return; }
      if (b.dataset.save === "require_admin_mfa" && v === true) {
        const { data: f } = await sb.auth.mfa.listFactors();
        if (!f?.totp?.some((x) => x.status === "verified")) { RS.toast("Ative o seu 2FA em 'Minha segurança' antes de exigir da equipe.", "error"); return; }
      }
      if (await act("admin_set_setting", { p_key: b.dataset.save, p_value: v }, "Configuração salva")) load();
    };
    await load();
  }

  // ---------- MINHA SEGURANÇA (2FA) ----------
  async function security() {
    const { data: f } = await sb.auth.mfa.listFactors();
    const { data: lvl } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const on = (f?.totp || []).filter((x) => x.status === "verified");
    main.innerHTML = head("Minha segurança (2FA)") + `<div class="panel" style="max-width:520px">${on.length
      ? `<h2>2FA ativo ✅</h2><p class="muted">Esta sessão está no nível <b>${lvl?.currentLevel === "aal2" ? "verificado (2 etapas)" : "senha apenas"}</b>.</p>
         <button class="btn btn-outline danger" id="mfa-off" data-id="${on[0].id}" style="margin-top:12px">Desativar 2FA</button>`
      : `<h2>Ative a verificação em 2 etapas</h2><p class="muted">Use um app autenticador (Google Authenticator, Authy, Microsoft Authenticator). Depois de ativar, o painel pede o código a cada login.</p>
         <button class="btn btn-primary" id="mfa-on" style="margin-top:12px">Ativar 2FA</button><div id="mfa-box"></div>`}</div>`;
    RS.$("#mfa-on")?.addEventListener("click", async () => {
      for (const x of f?.totp || []) if (x.status !== "verified") await sb.auth.mfa.unenroll({ factorId: x.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Real Sports " + new Date().toISOString().slice(0, 10) });
      if (error) { RS.toast(error.message, "error"); return; }
      RS.$("#mfa-box").innerHTML = `<p style="margin-top:14px">1. Escaneie o QR code no app:</p>
        <img src="${data.totp.qr_code}" alt="QR code 2FA" style="width:200px;background:#fff;padding:8px;border:1px solid var(--line);border-radius:8px;margin:8px 0">
        <p class="small muted">Ou digite a chave: <code>${esc(data.totp.secret)}</code></p>
        <p style="margin-top:10px">2. Digite o código de 6 dígitos:</p>
        <input class="input" id="mfa-code" inputmode="numeric" maxlength="6" style="max-width:160px"><button class="btn btn-green" id="mfa-ok">Confirmar</button>`;
      RS.$("#mfa-ok").onclick = async () => {
        const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: RS.$("#mfa-code").value.trim() });
        if (e2) { RS.toast(e2.message, "error"); return; }
        RS.toast("2FA ativado!", "ok"); security();
      };
    });
    RS.$("#mfa-off")?.addEventListener("click", async (e) => {
      if (!confirm("Desativar o 2FA desta conta?")) return;
      const { error } = await sb.auth.mfa.unenroll({ factorId: e.target.dataset.id });
      RS.toast(error ? error.message : "2FA desativado", error ? "error" : "ok");
      security();
    });
  }

  gate.remove();
  RS.$("#admin").hidden = false;
  alertCount();
  const start = location.hash.slice(1);
  window.RSadmin.ready = () => go(MODS.some((m) => m.id === start) ? start : MODS[0].id);
  if (window.RSmods.loaded) window.RSadmin.ready();
})();
