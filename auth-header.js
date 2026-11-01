// =====================================================
//  auth-header.js — cabeçalho, menu da conta, painel da conta, depósito e saque
//  Coloque <header id="rs-header"></header> em qualquer página.
// =====================================================
(async () => {
  const el = document.getElementById("rs-header");
  if (!el) return;
  const page = location.pathname.split("/").pop() || "index.html";
  let me = null;
  const nameOf = (p) => p.username || (p.email || "").split("@")[0];
  const initial = (p) => (nameOf(p) || "?").trim()[0];
  const navLink = (href, txt, key) => `<a href="${href}" data-nav="${key}">${txt}</a>`;

  // contas criadas antes do CPF obrigatório: completa CPF e nome antes de continuar
  function askIdentity(p) {
    if (document.getElementById("id-form")) return;
    const m = RS.modal(`<h3>Complete seu cadastro</h3><p class="muted small">Para continuar, informe seu nome completo e CPF. O CPF precisa ser o mesmo da conta bancária do saque e só o suporte corrige depois.</p>
      <form id="id-form">
        ${p.full_name ? "" : `<label>Nome completo<input name="n" class="input" maxlength="120" autocomplete="name" required></label>`}
        ${p.cpf ? "" : `<label>CPF<input name="c" class="input" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" required></label>`}
        <button class="btn btn-green w-full" style="margin-top:12px">Salvar</button></form>`);
    m.querySelector(".rs-modal-x").remove();
    m.addEventListener("click", (e) => { if (e.target === m) e.stopImmediatePropagation(); }, true);
    const f = RS.$("#id-form", m);
    if (f.c) f.c.oninput = () => (f.c.value = RS.cpfMask(f.c.value));
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (f.c && !RS.cpf(f.c.value)) { RS.toast("CPF inválido", "error"); return; }
      if (f.n && !/\S+\s+\S+/.test(f.n.value.trim())) { RS.toast("Informe seu nome completo", "error"); return; }
      try {
        await RS.rpc("set_my_identity", { p_cpf: f.c ? f.c.value : null, p_name: f.n ? f.n.value : null });
        m.remove(); RS.toast("Cadastro completo.", "ok");
      } catch (err) { RS.toast(RS.err(err), "error"); }
    };
  }

  async function render() {
    me = await RS.profile();
    el.innerHTML = `
      <div class="hdr">
        <a href="index.html" class="logo" aria-label="Real Sports"><b class="logo-mark">RS</b><span class="logo-word">Real<em>Sports</em></span></a>
        <nav class="hdr-nav">
          ${navLink("index.html#sports", "Apostas esportivas", "sports")}
          ${navLink("index.html#proximos", "Próximos jogos", "proximos")}
          ${navLink("index.html#casino", "Cassino", "casino")}
          ${me ? navLink("index.html#history", "Minhas apostas", "history") : ""}
          ${me?.is_admin || me?.staff_role ? `<a href="admin.html" class="${page === "admin.html" ? "active" : ""}">Admin</a>` : ""}
        </nav>
        <div class="hdr-right${me ? " logged" : ""}">
          <button class="icon-btn hide-xs" id="hdr-search" aria-label="Buscar">${RS.icon("search")}</button>
          ${me ? `
            <button class="icon-btn hide-xs" id="hdr-bell" aria-label="Notificações" style="position:relative">${RS.icon("bell")}<i class="bell-dot" id="bell-dot" hidden></i></button>
            <button class="balance" id="hdr-bal"><small>Saldo</small><b id="hdr-balance">${RS.money(me.balance)}</b></button>
            <button class="btn btn-green" id="btn-deposit">Depositar</button>
            <button class="avatar" id="hdr-avatar" aria-label="Minha conta">${RS.esc(initial(me))}</button>`
          : `<a class="btn btn-hdr-out" href="login.html?cadastro">Cadastre-se</a><a class="btn btn-green" href="login.html">Entrar</a>`}
        </div>
      </div>`;
    markNav();
    el.querySelector(".logo").onclick = (e) => {
      if (!document.getElementById("lside") || !matchMedia("(max-width: 1000px)").matches) return;
      e.preventDefault();
      document.body.classList.toggle("menu-open");
    };
    RS.$("#hdr-search").onclick = search;
    drawerAcct();
    if (!me) return;
    if (me.blocked) RS.toast("Sua conta está bloqueada. Fale com o suporte.", "error");
    if ((!me.cpf || !me.full_name) && page !== "admin.html") askIdentity(me);
    RS.$("#btn-deposit").onclick = () => panel("overview");
    RS.$("#hdr-bal").onclick = () => panel("overview");
    RS.$("#hdr-avatar").onclick = togglePop;
    RS.$("#hdr-bell").onclick = showNotifications;
    bell();
    if (!sessionStorage.getItem("rs-login-logged")) {
      sessionStorage.setItem("rs-login-logged", "1");
      sb.rpc("log_login", { p_fingerprint: await fingerprint() });
    }
  }

  // ---------- menu lateral da conta (celular) ----------
  function drawerAcct() {
    document.getElementById("lacct")?.remove();
    const nav = document.querySelector("#lside .lnav");
    if (!nav || !me) return;
    const grp = (ic, t, items) => `<details class="la-grp"><summary>${RS.icon(ic)}<span>${t}</span></summary>
      ${items.map(([k, l]) => `<button data-la="${k}">${l}</button>`).join("")}</details>`;
    const d = document.createElement("div");
    d.id = "lacct";
    d.className = "lacct";
    d.innerHTML = `<div class="la-who"><span class="avatar">${RS.esc(initial(me))}</span><div><b>${RS.esc(nameOf(me))}</b><small id="la-bal">${RS.money(me.balance)}</small></div></div>
      <button class="la-item" data-la="overview">${RS.icon("grid")}<span>Visão Geral</span></button>
      ${grp("card", "Transações", [["deposit", "Depositar"], ["withdraw", "Sacar"], ["tx", "Histórico de transações"]])}
      ${grp("clock", "Histórico", [["h:bets", "Apostas esportivas"], ["h:casino", "Cassino"]])}
      ${grp("user", "Perfil", [["data", "Dados pessoais"], ["security", "Login & Segurança"], ["betcfg", "Configurações de apostas"], ["limits", "Proteção do jogador"], ["kyc", "Processo de verificação"]])}
      <button class="la-item" data-la="privacy">${RS.icon("lock")}<span>Definições de privacidade</span></button>
      <button class="la-out" data-la="logout">Sair ${RS.icon("logout")}</button>`;
    nav.before(d);
    d.onclick = async (e) => {
      const a = e.target.closest("[data-la]")?.dataset.la;
      if (!a) return;
      document.body.classList.remove("menu-open");
      if (a === "deposit" || a === "withdraw") moneyModal(a);
      else if (a.startsWith("h:")) {
        location.hash = "#history";
        setTimeout(() => document.querySelector(`[data-hist="${a.slice(2)}"]`)?.click(), 50);
      } else if (a === "logout") { await sb.auth.signOut(); location.href = "index.html"; }
      else panel(a);
    };
  }

  // identificador do aparelho (hash de características do navegador) para detectar multi-contas
  async function fingerprint() {
    const raw = [navigator.userAgent, navigator.language, screen.width + "x" + screen.height, screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.hardwareConcurrency, navigator.platform].join("|");
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  }

  // ---------- notificações ----------
  async function bell() {
    if (!me) return;
    const { count } = await sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", me.id).is("read_at", null);
    const d = RS.$("#bell-dot");
    if (d) d.hidden = !count;
  }
  async function showNotifications() {
    const { data } = await sb.from("notifications").select("*").eq("user_id", me.id).order("created_at", { ascending: false }).limit(30);
    RS.modal(`<h3>Notificações</h3>${data?.length ? data.map((n) => `<div class="mb-item" style="display:block"><b>${RS.esc(n.title)}</b>${n.read_at ? "" : ' <span class="badge b-pending">nova</span>'}
      <small>${RS.date(n.created_at)}</small>${n.body ? `<p style="margin:6px 0 0">${RS.esc(n.body)}</p>` : ""}</div>`).join("") : `<p class="muted">Nenhuma notificação.</p>`}`);
    await sb.rpc("mark_notifications_read");
    bell();
  }

  function markNav() {
    const h = location.hash.slice(1) || "sports";
    RS.$$("[data-nav]", el).forEach((a) => a.classList.toggle("active", page === "index.html" && a.dataset.nav === h));
  }
  addEventListener("hashchange", markNav);
  document.addEventListener("rs:tab", () => setTimeout(markNav, 0));

  function search() {
    if (!window.RSsports) { location.href = "index.html#sports"; return; }
    const m = RS.modal(`<h3>Buscar</h3><p class="muted">Time ou campeonato</p>
      <input class="input" id="q" placeholder="Ex.: Flamengo, NBA" autocomplete="off"><button class="btn btn-primary w-full" id="q-go">Buscar</button>`);
    const go = () => { window.RSsports.search(RS.$("#q", m).value); m.remove(); };
    RS.$("#q-go", m).onclick = go;
    RS.$("#q", m).onkeydown = (e) => { if (e.key === "Enter") go(); };
    RS.$("#q", m).focus();
  }

  // ---------- menu da conta ----------
  function togglePop() {
    const old = RS.$(".acct-pop");
    if (old) { old.remove(); return; }
    const d = document.createElement("div");
    d.className = "acct-pop";
    d.innerHTML = `
      <div class="acct-who"><span class="avatar">${RS.esc(initial(me))}</span><div><b>${RS.esc(nameOf(me))}</b><small>${RS.esc(me.email || "")}</small></div></div>
      <div class="acct-bal"><div><span>Carteira</span><b id="pop-balance">${RS.money(me.balance)}</b></div></div>
      <div class="acct-grid">
        <button class="btn btn-outline" data-a="refresh">${RS.icon("refresh")} Atualizar</button>
        <button class="btn btn-outline orange" data-a="refer">${RS.icon("share")} Indicações</button>
      </div>
      <button class="btn btn-dark" data-a="panel">Detalhes da conta</button>
      <div class="acct-grid three">
        <button class="btn btn-outline" data-a="data" title="Meus dados" aria-label="Meus dados">${RS.icon("id")}</button>
        <button class="btn btn-outline" data-a="pass" title="Trocar senha" aria-label="Trocar senha">${RS.icon("key")}</button>
        <button class="btn btn-outline" data-a="support" title="Suporte" aria-label="Suporte">${RS.icon("headset")}</button>
      </div>
      ${me.is_admin || me.staff_role ? `<a class="btn btn-primary" href="admin.html" style="margin-bottom:8px">Painel Admin</a>` : ""}
      <button class="btn btn-outline" data-a="logout">Sair</button>`;
    RS.$(".hdr-right", el).appendChild(d);
    d.onclick = async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      if (a === "refresh") { RS.refreshBalance(); RS.toast("Saldo atualizado.", "ok"); return; }
      d.remove();
      if (a === "refer") RS.refer();
      if (a === "panel") panel("data");
      if (a === "data") panel("data");
      if (a === "pass") resetPass();
      if (a === "support") RS.support();
      if (a === "logout") { await sb.auth.signOut(); location.href = "index.html"; }
    };
  }
  document.addEventListener("click", (e) => {
    const p = RS.$(".acct-pop");
    if (p && !p.contains(e.target) && !e.target.closest("#hdr-avatar")) p.remove();
  });

  async function resetPass() {
    const { error } = await sb.auth.resetPasswordForEmail(me.email, { redirectTo: location.origin + "/login.html" });
    RS.toast(error ? RS.err(error) : "Enviamos para o seu e-mail um link para trocar a senha.", error ? "error" : "ok");
  }

  // ---------- painel da conta ----------
  const TX_ST = { pending: "Pendente", done: "Concluída", rejected: "Recusada" };
  const txRow = (t) => `<div class="mb-item"><div>${RS.esc(t.description || t.type)}<small>${RS.date(t.created_at)} · ${TX_ST[t.status] || t.status}${t.pix_key ? " · PIX " + RS.esc(t.pix_key) : ""}</small>
    ${t.type === "deposit" && t.status === "pending" && t.provider_id && new Date(t.expires_at) > new Date() ? `<button class="btn sm btn-outline" data-ap="pix:${t.id}:${t.amount}">Ver PIX</button>` : ""}</div>
    <b class="${t.amount >= 0 ? "pos" : "neg"}">${RS.money(t.amount)}</b></div>`;
  const TABS = { overview: ["grid", "Visão geral"], tx: ["card", "Transações"], data: ["user", "Dados pessoais"], security: ["key", "Login & Segurança"],
    betcfg: ["receipt", "Configurações de apostas"], limits: ["lock", "Proteção do jogador"], kyc: ["id", "Processo de verificação"], bonus: ["gift", "Bônus"], privacy: ["lock", "Privacidade"] };
  const TX_NAME = { deposit: "Depósito", withdraw: "Saque", bet: "Aposta", win: "Prêmio", cashout: "Cash out", casino_bet: "Aposta cassino", casino_win: "Prêmio cassino", adjust: "Ajuste", bonus: "Bônus", bet_refund: "Reembolso" };
  const txCard = (t) => `<div class="tx-card">
      <div class="tx-h"><span class="tx-ic ${t.amount >= 0 ? "in" : "out"}">${RS.icon(t.amount >= 0 ? "wallet" : "back")}</span>
        <div><b>${TX_NAME[t.type] || RS.esc(t.type)}</b><small>${t.type === "deposit" || t.type === "withdraw" ? "Pix" : RS.esc(t.description || "")}</small></div>
        ${t.status && t.status !== "done" ? `<span class="badge b-${t.status}">${TX_ST[t.status] || t.status}</span>` : ""}</div>
      <div class="tx-r"><span>ID</span><span>${t.id}<button class="icon-btn" data-copy="${t.id}" aria-label="Copiar ID">${RS.icon("copy")}</button></span></div>
      <div class="tx-r"><span>Data</span><span>${RS.date(t.created_at)}</span></div>
      ${t.pix_key ? `<div class="tx-r"><span>Chave PIX</span><span>${RS.esc(t.pix_key)}</span></div>` : ""}
      <div class="tx-r tx-v"><span>Valor</span><b class="${t.amount >= 0 ? "pos" : "neg"}">${RS.money(t.amount)}</b></div>
      ${t.type === "deposit" && t.status === "pending" && t.provider_id && new Date(t.expires_at) > new Date() ? `<button class="btn sm btn-outline w-full" data-ap="pix:${t.id}:${t.amount}">Ver PIX</button>` : ""}
    </div>`;

  function panel(tab) {
    RS.$(".acct-panel")?.remove();
    const w = document.createElement("div");
    w.className = "acct-panel";
    w.innerHTML = `<div class="ap-box">
      <div class="ap-head"><button class="icon-btn ap-menu" data-side aria-label="Menu da conta">${RS.icon("menu")}</button><span id="ap-title"></span>
        <button class="icon-btn" data-x aria-label="Fechar">${RS.icon("x")}</button></div>
      <div class="ap-main"><nav class="ap-side">${Object.entries(TABS).map(([k, [ic, t]]) => `<button data-t="${k}">${RS.icon(ic)}<span>${t}</span></button>`).join("")}</nav>
        <div class="ap-body" id="ap-body"></div></div></div>`;
    document.body.appendChild(w);
    let cur = tab;
    async function show(k) {
      cur = k;
      RS.$$("[data-t]", w).forEach((b) => b.classList.toggle("active", b.dataset.t === k));
      RS.$("#ap-title", w).textContent = TABS[k][1];
      const body = RS.$("#ap-body", w);
      const p = await RS.profile();
      if (!p) { w.remove(); return; }
      if (k === "overview") {
        const { data: deps } = await sb.from("transactions").select("*").eq("user_id", p.id).eq("type", "deposit")
          .order("created_at", { ascending: false }).limit(5);
        body.innerHTML = `<div class="ap-card"><h3>Olá, ${RS.esc(nameOf(p))}<button class="btn btn-outline sm" data-ap="refresh">${RS.icon("refresh")} Atualizar</button></h3>
            <div class="ap-saldo">${RS.icon("wallet")}<b>${RS.money(p.balance)}</b><small class="muted">Saldo</small><hr>
              <div><span>Disponível para apostar</span><span>${RS.money(p.balance)}</span></div>
              <div><span>Disponível para saque</span><span>${RS.money(p.balance)}</span></div></div>
            <div class="ap-btns"><button class="btn btn-outline" data-ap="withdraw">Sacar</button><button class="btn btn-green" data-ap="deposit">Depositar</button></div></div>
          <h3 style="margin:6px 2px 10px">Últimos depósitos</h3>
          <div class="ap-card ap-list">${deps?.length ? deps.map(txRow).join("") : `<p class="muted">Nenhum depósito ainda.</p>`}</div>`;
      }
      if (k === "tx") {
        body.innerHTML = `<div class="tx-top"><b>${RS.money(p.balance)}</b><button class="btn btn-green" data-ap="deposit">Depósito</button></div>
          <input class="input" id="tx-q" inputmode="numeric" placeholder="Procurar por ID da transação">
          <div class="tx-filters"><select class="input" id="tx-days"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option></select>
            <select class="input" id="tx-type"><option value="">Todos os tipos</option><option value="deposit">Depósitos</option><option value="withdraw">Saques</option>
            <option value="bet,win,cashout">Apostas esportivas</option><option value="casino_bet,casino_win">Cassino</option><option value="bonus,adjust">Bônus e ajustes</option></select></div>
          <div id="tx-list"><p class="muted">Carregando…</p></div>`;
        const list = async () => {
          const id = RS.$("#tx-q", body).value.replace(/\D/g, ""), types = RS.$("#tx-type", body).value;
          let q = sb.from("transactions").select("*").eq("user_id", p.id).order("created_at", { ascending: false }).limit(100);
          if (id) q = q.eq("id", Number(id));
          else {
            q = q.gte("created_at", new Date(Date.now() - Number(RS.$("#tx-days", body).value) * 864e5).toISOString());
            if (types) q = q.in("type", types.split(","));
          }
          const { data } = await q;
          RS.$("#tx-list", body).innerHTML = data?.length ? data.map(txCard).join("") : `<p class="muted">Nenhuma movimentação nesse filtro.</p>`;
        };
        RS.$("#tx-days", body).onchange = RS.$("#tx-type", body).onchange = list;
        let tq; RS.$("#tx-q", body).oninput = () => { clearTimeout(tq); tq = setTimeout(list, 400); };
        list();
      }
      if (k === "security") {
        body.innerHTML = `<div class="ap-card"><h3>Login & Segurança</h3>
          <div class="ap-field"><label>E-mail de acesso</label><input class="input" readonly value="${RS.esc(p.email || "")}"></div>
          <div class="ap-field"><label>Último acesso</label><input class="input" readonly value="${p.last_login_at ? RS.date(p.last_login_at) : "—"}"></div>
          <p class="muted small" style="margin-bottom:10px">Sua conexão com o site é criptografada (HTTPS). Use uma senha só sua e não compartilhe seu acesso.</p>
          <button class="btn btn-outline w-full" data-ap="pass" style="margin-bottom:8px">${RS.icon("key")} Trocar senha</button>
          <button class="btn btn-outline w-full" data-ap="logout-all">Sair de todos os aparelhos</button></div>`;
      }
      if (k === "betcfg") {
        const def = localStorage.getItem("rs-def-stake") || "", ask = localStorage.getItem("rs-co-confirm") !== "0";
        body.innerHTML = `<div class="ap-card"><h3>Configurações de apostas</h3>
          <div class="ap-field"><label>Valor padrão da aposta no bilhete (R$)</label><input class="input" id="cfg-stake" inputmode="decimal" placeholder="Em branco = sem valor padrão" value="${RS.esc(def)}"></div>
          <label class="check" style="margin:10px 0"><input type="checkbox" id="cfg-co" ${ask ? "checked" : ""}> Pedir confirmação antes do cash out</label>
          <button class="btn btn-dark w-full" id="cfg-save">Salvar</button>
          <p class="muted small" style="margin-top:8px">Fica salvo neste aparelho.</p></div>`;
        RS.$("#cfg-save", body).onclick = () => {
          const v = RS.$("#cfg-stake", body).value.replace(",", ".").trim();
          if (v && !(Number(v) > 0)) { RS.toast("Valor inválido.", "error"); return; }
          if (v) localStorage.setItem("rs-def-stake", v); else localStorage.removeItem("rs-def-stake");
          localStorage.setItem("rs-co-confirm", RS.$("#cfg-co", body).checked ? "1" : "0");
          RS.toast("Configurações salvas.", "ok");
        };
      }
      if (k === "privacy") {
        body.innerHTML = `<div class="ap-card"><h3>Definições de privacidade</h3>
          <p class="muted small" style="margin-bottom:10px">Seus dados são usados só para operar sua conta, cumprir a lei (LGPD) e prevenir fraudes. Documentos de verificação ficam em armazenamento privado.</p>
          <button class="btn btn-outline w-full" data-ap="export" style="margin-bottom:8px">Baixar meus dados</button>
          <button class="btn btn-outline w-full" data-ap="delete">Pedir exclusão da conta</button></div>`;
      }
      if (k === "limits") {
        const { data: l } = await sb.from("user_limits").select("*").eq("user_id", p.id).maybeSingle();
        const v = (x) => (l?.[x] != null ? l[x] : "");
        body.innerHTML = `<div class="ap-card"><h3>Seus limites</h3>
          <p class="muted small" style="margin-bottom:10px">Diminuir vale na hora. Aumentar ou remover só vale depois de 24 h. Deixe em branco para não ter limite.</p>
          <form id="lim-f">
            <div class="ap-field"><label>Depósito por dia (R$)</label><input class="input" name="dd" type="number" min="0" step="1" value="${v("deposit_day")}"></div>
            <div class="ap-field"><label>Depósito por semana (R$)</label><input class="input" name="dw" type="number" min="0" step="1" value="${v("deposit_week")}"></div>
            <div class="ap-field"><label>Depósito por mês (R$)</label><input class="input" name="dm" type="number" min="0" step="1" value="${v("deposit_month")}"></div>
            <div class="ap-field"><label>Perda máxima por dia (R$)</label><input class="input" name="ld" type="number" min="0" step="1" value="${v("loss_day")}"></div>
            ${l?.pending ? `<p class="small" style="color:var(--gold);margin-bottom:10px">Mudança agendada para ${RS.date(l.pending_at)}.</p>` : ""}
            <button class="btn btn-dark w-full">Salvar limites</button></form></div>
          <div class="ap-card"><h3>Pausa (autoexclusão)</h3>
            ${l?.self_excluded_until && new Date(l.self_excluded_until) > new Date() ? `<p>Sua conta está em pausa até <b>${RS.date(l.self_excluded_until)}</b>.</p>` : `
            <p class="muted small" style="margin-bottom:10px">Durante a pausa você não consegue apostar nem depositar. Não dá para cancelar antes do fim.</p>
            <select class="input" id="lim-ex"><option value="1">24 horas</option><option value="7">7 dias</option><option value="30">30 dias</option><option value="180">6 meses</option></select>
            <button class="btn btn-outline danger w-full" id="lim-ex-go">Pausar minha conta</button>`}</div>`;
        const num = (x) => (x === "" ? null : Number(x));
        RS.$("#lim-f", w).onsubmit = async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.target));
          try {
            const r = await RS.rpc("set_my_limits", { p_deposit_day: num(f.dd), p_deposit_week: num(f.dw), p_deposit_month: num(f.dm), p_loss_day: num(f.ld), p_exclude_days: null });
            RS.toast(Object.keys(r.em_24h || {}).length ? "Limites salvos. Os aumentos valem em 24 h." : "Limites salvos.", "ok");
            show("limits");
          } catch (err) { RS.toast(err.message, "error"); }
        };
        RS.$("#lim-ex-go", w)?.addEventListener("click", async () => {
          const d = Number(RS.$("#lim-ex", w).value);
          if (!confirm("Tem certeza? A pausa não pode ser cancelada.")) return;
          try { await RS.rpc("set_my_limits", { p_deposit_day: num(v("deposit_day")), p_deposit_week: num(v("deposit_week")), p_deposit_month: num(v("deposit_month")), p_loss_day: num(v("loss_day")), p_exclude_days: d }); RS.toast("Conta pausada.", "ok"); show("limits"); }
          catch (err) { RS.toast(err.message, "error"); }
        });
      }
      if (k === "bonus") {
        const [{ data: bs }, ref] = await Promise.all([sb.from("user_bonuses").select("*").eq("user_id", p.id).order("created_at", { ascending: false }).limit(30),
          RS.rpc("my_referrals").catch(() => null)]);
        const ST = { aguardando_deposito: "Aguardando depósito", ativo: "Ativo", concluido: "Liberado", expirado: "Expirado", cancelado: "Cancelado" };
        const url = `${location.origin}/login.html?ref=${ref?.code || p.id.slice(0, 8)}`;
        body.innerHTML = `<div class="ap-card"><h3>Cupom promocional</h3>
            <form id="cp-f" style="display:flex;gap:8px"><input class="input" name="c" placeholder="Digite o código" required style="text-transform:uppercase"><button class="btn btn-dark">Aplicar</button></form></div>
          <div class="ap-card ap-list"><h3>Meus bônus</h3>
            <p class="muted small" style="margin-bottom:8px">O saque fica liberado depois de apostar o valor do rollover. Apostas esportivas só contam com odd mínima do bônus.</p>
            ${bs?.length ? bs.map((b) => { const pct = b.wager_required > 0 ? Math.min(100, Math.round((b.wagered / b.wager_required) * 100)) : 100;
              return `<div class="tx-row" style="flex-wrap:wrap"><div><b>${RS.money(b.amount)}</b><small>${ST[b.status] || b.status}${b.expires_at && b.status === "ativo" ? " · até " + RS.date(b.expires_at) : ""}${b.status === "ativo" ? ` · odd mín. ${(+b.min_odd).toFixed(2)}` : ""}</small></div>
                ${["ativo", "aguardando_deposito"].includes(b.status) ? `<button class="btn sm btn-outline danger" data-bx="${b.id}">Cancelar</button>` : ""}
                ${b.status === "ativo" ? `<div style="flex-basis:100%;margin-top:6px"><div style="height:6px;background:var(--line,#eee);border-radius:4px"><div style="width:${pct}%;height:6px;background:var(--primary);border-radius:4px"></div></div>
                  <small class="muted">${RS.money(b.wagered)} de ${RS.money(b.wager_required)} apostados</small></div>` : ""}</div>`; }).join("") : `<p class="muted">Nenhum bônus ainda.</p>`}</div>
          <div class="ap-card"><h3>Indique um amigo</h3>
            <p class="muted small" style="margin-bottom:8px">${ref?.reward ? `Ganhe ${RS.money(ref.reward)} de bônus quando seu amigo fizer o primeiro depósito.` : "Convide amigos para a Real Sports."}
              ${ref ? ` Convidados: <b>${ref.invited}</b> · com depósito: <b>${ref.qualified}</b> · ganho: <b>${RS.money(ref.earned)}</b>` : ""}</p>
            <input class="input" readonly value="${url}" style="margin-bottom:8px"><button class="btn btn-primary w-full" id="ref-cp">Copiar link</button></div>`;
        RS.$("#cp-f", w).onsubmit = async (e) => {
          e.preventDefault();
          try { RS.toast(await RS.rpc("redeem_coupon", { p_code: e.target.c.value }), "ok"); RS.refreshBalance(); show("bonus"); } catch (err) { RS.toast(err.message, "error"); }
        };
        RS.$("#ref-cp", w).onclick = async () => { try { await navigator.clipboard.writeText(url); RS.toast("Link copiado!", "ok"); } catch { /* sem permissão */ } };
        body.onclick = async (e) => {
          const b = e.target.closest("[data-bx]");
          if (!b || !confirm("Cancelar o bônus? O valor do bônus é retirado do saldo e o saque fica liberado.")) return;
          try { await RS.rpc("cancel_my_bonus", { p_id: +b.dataset.bx }); RS.toast("Bônus cancelado.", "ok"); RS.refreshBalance(); show("bonus"); } catch (err) { RS.toast(err.message, "error"); }
        };
      } else body.onclick = null;
      if (k === "kyc") {
        const { data: docs } = await sb.from("kyc_documents").select("*").eq("user_id", p.id).order("created_at", { ascending: false });
        const DOC = { rg: "RG", cnh: "CNH", comprovante: "Comprovante de residência", selfie: "Selfie com documento" };
        const ST = { pendente: "Não enviada", em_analise: "Em análise", aprovado: "Aprovada", rejeitado: "Rejeitada" };
        body.innerHTML = `<div class="ap-card"><h3>Verificação de identidade</h3>
            <p class="small" style="margin-bottom:8px">Status: <span class="badge b-${p.kyc_status || "pendente"}">${ST[p.kyc_status] || ST.pendente}</span></p>
            <p class="muted small" style="margin-bottom:10px">Envie um documento com foto (RG ou CNH) e um comprovante de residência. Fotos nítidas, sem cortes. JPG, PNG ou PDF até 8 MB. Com a verificação aprovada, seus saques são liberados mais rápido.</p>
            <form id="kyc-f">
              <div class="ap-field"><label>Tipo de documento</label><select class="input" name="t">${Object.entries(DOC).map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></div>
              <div class="ap-field"><label>Arquivo</label><input class="input" name="f" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>
              <button class="btn btn-dark w-full">Enviar documento</button></form></div>
          <div class="ap-card ap-list"><h3>Documentos enviados</h3>${docs?.length ? docs.map((d) => `<div class="tx-row"><div><b>${DOC[d.doc_type]}</b><small>${RS.date(d.created_at)}${d.reason ? " · " + RS.esc(d.reason) : ""}</small></div>
            <span class="badge b-${d.status}">${ST[d.status] || d.status}</span></div>`).join("") : `<p class="muted">Nenhum documento enviado.</p>`}</div>`;
        RS.$("#kyc-f", w).onsubmit = async (e) => {
          e.preventDefault();
          const f = new FormData(e.target), file = f.get("f"), btn = e.target.querySelector("button");
          if (!file?.size) return;
          if (file.size > 8 * 1024 * 1024) return RS.toast("Arquivo maior que 8 MB.", "error");
          btn.disabled = true;
          try {
            const path = `${p.id}/${Date.now()}-${f.get("t")}.${(file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
            const { error } = await sb.storage.from("kyc").upload(path, file, { contentType: file.type });
            if (error) throw error;
            await RS.rpc("kyc_submit", { p_doc_type: f.get("t"), p_path: path });
            p.kyc_status = "em_analise";
            RS.toast("Documento enviado para análise.", "ok");
            show("kyc");
          } catch (err) { RS.toast(err.message, "error"); btn.disabled = false; }
        };
      }
      if (k === "data") {
        const { data: pix } = await sb.rpc("my_last_pix_key");
        const cpfMask = (c) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
        const KYC = { aprovado: "Verificada", em_analise: "Em análise", recusado: "Recusada", pendente: "Não verificada" };
        const KT = { cpf: "CPF", cnpj: "CNPJ", email: "E-mail", telefone: "Celular", aleatoria: "Chave aleatória" };
        const f = (l, v) => `<div class="ap-field"><label>${l}</label><input class="input" readonly value="${RS.esc(v)}"></div>`;
        body.innerHTML = `<div class="ap-card"><h3>Informações gerais</h3>
            ${f("ID", p.id)}${p.full_name ? f("Nome completo", p.full_name) : ""}${f("Nome de usuário", p.username || "")}${f("E-mail", p.email || "")}
            ${f("Membro desde", new Date(p.created_at).toLocaleDateString("pt-BR"))}
            <p class="muted small">Para corrigir nome ou e-mail, fale com o suporte.</p></div>
          <div class="ap-card"><h3>Documento</h3>
            ${p.cpf ? f("CPF", cpfMask(p.cpf)) : `<div class="ap-field"><label>CPF</label><input class="input" id="dp-cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00"></div>
              <button class="btn btn-dark w-full" id="dp-cpf-save">Salvar CPF</button>`}
            <p class="muted small" style="margin-top:8px">O CPF precisa ser o mesmo da conta bancária do saque. Depois de salvo, só o suporte corrige.</p>
            <div class="ap-field" style="margin-top:12px"><label>Verificação da conta</label>
              <div><span class="badge b-${p.kyc_status || "pendente"}">${KYC[p.kyc_status] || KYC.pendente}</span> <button class="btn btn-outline sm" data-t="kyc">Ver verificação</button></div></div></div>
          <div class="ap-card"><h3>Chave PIX para saque</h3>
            ${pix?.key ? f(KT[pix.type] || "Chave", pix.key) : `<p class="muted small">Nenhuma chave ainda. Ela fica salva no seu primeiro saque.</p>`}
            <p class="muted small" style="margin-top:6px">Para trocar, informe outra chave no próximo saque.</p>
            <button class="btn btn-outline sm" data-ap="withdraw" style="margin-top:10px">Sacar</button></div>
          <button class="btn btn-outline sm" data-ap="pass">${RS.icon("key")} Trocar senha</button>`;
        const inp = RS.$("#dp-cpf", body);
        if (inp) {
          inp.oninput = () => (inp.value = cpfMask(inp.value.replace(/\D/g, "").slice(0, 11)));
          RS.$("#dp-cpf-save", body).onclick = async () => {
            try { await RS.rpc("set_my_cpf", { p_cpf: inp.value }); RS.toast("CPF salvo.", "ok"); show("data"); }
            catch (err) { RS.toast(err.message, "error"); }
          };
        }
      }
    }
    w.addEventListener("click", (e) => {
      if (e.target === w || e.target.closest("[data-x]")) { w.remove(); return; }
      const t = e.target.closest("[data-t]");
      if (e.target.closest("[data-side]")) { RS.$(".ap-box", w).classList.toggle("side-open"); return; }
      if (e.target.closest(".ap-main") && !e.target.closest(".ap-side")) RS.$(".ap-box", w).classList.remove("side-open");
      if (t) { RS.$(".ap-box", w).classList.remove("side-open"); show(t.dataset.t); return; }
      const a = e.target.closest("[data-ap]")?.dataset.ap;
      if (a === "refresh") { RS.refreshBalance(); show("overview"); }
      if (a === "deposit" || a === "withdraw") moneyModal(a);
      if (a === "pass") resetPass();
      if (a === "logout-all" && confirm("Sair da conta em todos os aparelhos?")) sb.auth.signOut({ scope: "global" }).then(() => (location.href = "index.html"));
      if (a === "export") exportData();
      if (a === "delete") RS.support();
      const cp = e.target.closest("[data-copy]")?.dataset.copy;
      if (cp) navigator.clipboard?.writeText(cp).then(() => RS.toast("ID copiado!", "ok"));
      if (a?.startsWith("pix:")) { const [, id, v] = a.split(":"); showPix(+id, +v); }
    });
    document.addEventListener("rs:balance", () => { if (document.body.contains(w)) show(cur); });
    show(tab);
  }

  // LGPD: cópia dos dados da conta em JSON
  async function exportData() {
    const p = await RS.profile();
    const [tx, bets, lim] = await Promise.all([
      sb.from("transactions").select("*").eq("user_id", p.id),
      sb.from("bets").select("*, bet_selections(*)").eq("user_id", p.id),
      sb.from("user_limits").select("*").eq("user_id", p.id)]);
    const blob = new Blob([JSON.stringify({ perfil: p, transacoes: tx.data, apostas: bets.data, limites: lim.data }, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "meus-dados-realsports.json" });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- depósito e saque ----------
  function moneyModal(kind) {
    const dep = kind === "deposit";
    if (!dep) return withdrawModal();
    const m = RS.modal(`
      <h3>${dep ? "Depositar" : "Sacar"}</h3>
      <p class="muted">${dep ? "Mínimo R$ 10,00. O saldo entra assim que o pagamento for confirmado." : "Mínimo R$ 20,00. O valor é reservado até a aprovação."}</p>
      <div class="chips">${[20, 50, 100, 500].map((v) => `<button class="chip" data-v="${v}">R$ ${v}</button>`).join("")}</div>
      <input type="number" id="mm-amount" class="input" min="${dep ? 10 : 20}" step="0.01" placeholder="Valor">
      ${dep ? "" : `<div class="ap-field"><label>Tipo da chave PIX</label><select class="input" id="mm-ktype">
        <option value="cpf">CPF</option><option value="email">E-mail</option><option value="telefone">Celular</option>
        <option value="aleatoria">Chave aleatória</option><option value="cnpj">CNPJ</option></select></div>
      <input class="input" id="mm-key" maxlength="77" placeholder="Sua chave PIX (em seu nome)" autocomplete="off">`}
      <button class="btn ${dep ? "btn-green" : "btn-primary"} w-full" id="mm-go">${dep ? "Gerar pagamento" : "Solicitar saque"}</button>`);
    RS.$$(".chip", m).forEach((c) => (c.onclick = () => (RS.$("#mm-amount", m).value = c.dataset.v)));
    if (!dep) sb.rpc("my_last_pix_key").then(({ data }) => {
      if (data?.key && !RS.$("#mm-key", m).value) { RS.$("#mm-key", m).value = data.key; RS.$("#mm-ktype", m).value = data.type; }
    });
    RS.$("#mm-go", m).onclick = async () => {
      const v = Number(RS.$("#mm-amount", m).value);
      try {
        const id = await RS.rpc(dep ? "request_deposit" : "request_withdraw", dep ? { p_amount: v }
          : { p_amount: v, p_pix_key: RS.$("#mm-key", m).value, p_pix_type: RS.$("#mm-ktype", m).value });
        m.remove();
        if (dep) await showPix(id, v);
        else RS.toast(`Saque #${id} solicitado. O PIX cai na chave informada após a aprovação.`, "ok");
        RS.refreshBalance();
      } catch (e) { RS.toast(e.message, "error"); }
    };
  }

  // Saque PIX: CPF do titular (cadastrado uma vez), valor e chave PIX
  async function withdrawModal() {
    const p = await RS.profile();
    if (!p) { location.href = "login.html"; return; }
    const cpfMask = (c) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    const m = RS.modal(`<div class="wd">
      <div class="wd-info"><div>${RS.icon("refresh")}<b>Mín. R$ 20,00</b></div><div>${RS.icon("clock")}<span>Tempo de processamento: normalmente em poucos minutos após a aprovação</span></div></div>
      <h3>Pix</h3>
      <p class="muted small">Faça seus saques de forma fácil e segura com o Pix. É importante usar uma conta bancária vinculada ao seu CPF.</p>
      <label class="wd-l">CPF</label>
      <input class="input" id="wd-cpf" inputmode="numeric" maxlength="14" placeholder="000.000.000-00" ${p.cpf ? `readonly value="${cpfMask(p.cpf)}"` : ""}>
      <p class="small wd-warn"><b>Importante:</b> se o CPF do titular da conta bancária não for o mesmo cadastrado na Real Sports, o PIX não será processado.${p.cpf ? " Para corrigir o CPF, fale com o suporte." : " Depois de salvo, o CPF só pode ser corrigido pelo suporte."}</p>
      <label class="wd-l">Montante</label>
      <label class="stake wd-amt"><i>R$</i><input id="mm-amount" type="number" min="20" step="0.01" placeholder="0,00"></label>
      <div class="chips">${[20, 50, 100, 500].map((v) => `<button class="chip" data-v="${v}">R$ ${v}</button>`).join("")}</div>
      <label class="wd-l">Chave PIX</label>
      <div class="wd-key"><select class="input" id="mm-ktype"><option value="cpf">CPF</option><option value="email">E-mail</option><option value="telefone">Celular</option>
        <option value="aleatoria">Chave aleatória</option></select>
        <input class="input" id="mm-key" maxlength="77" placeholder="Sua chave PIX" autocomplete="off"></div>
      <button class="btn btn-dark w-full" id="mm-go">Saque</button></div>`);
    const type = RS.$("#mm-ktype", m), key = RS.$("#mm-key", m), cpf = RS.$("#wd-cpf", m);
    const syncKey = () => { if (type.value === "cpf") { key.value = cpf.value; key.readOnly = true; } else key.readOnly = false; };
    type.onchange = () => { key.value = ""; syncKey(); };
    cpf.oninput = () => { cpf.value = cpfMask(cpf.value.replace(/\D/g, "").slice(0, 11)); syncKey(); };
    syncKey();
    RS.$$(".chip", m).forEach((c) => (c.onclick = () => (RS.$("#mm-amount", m).value = c.dataset.v)));
    sb.rpc("my_last_pix_key").then(({ data }) => {
      if (data?.key && data.type !== "cpf" && data.type !== "cnpj") { type.value = data.type; key.readOnly = false; key.value = data.key; }
    });
    RS.$("#mm-go", m).onclick = async (e) => {
      const btn = e.currentTarget, v = Number(RS.$("#mm-amount", m).value);
      btn.disabled = true;
      try {
        if (!p.cpf) { p.cpf = await RS.rpc("set_my_cpf", { p_cpf: cpf.value }); cpf.readOnly = true; }
        const id = await RS.rpc("request_withdraw", { p_amount: v, p_pix_key: key.value, p_pix_type: type.value });
        m.remove();
        RS.toast(`Saque #${id} solicitado. O PIX cai na chave informada após a aprovação.`, "ok");
        RS.refreshBalance();
      } catch (err) { RS.toast(err.message, "error"); btn.disabled = false; }
    };
  }

  // Gera o PIX no servidor (função pix-create) e mostra QR + copia e cola
  async function showPix(id, v) {
    const { data, error } = await sb.functions.invoke("pix-create", { body: { tx_id: id } });
    if (error || data?.error) {
      RS.toast(`Depósito #${id} criado, mas o PIX não foi gerado: ${data?.error || "provedor indisponível"}`, "error");
      return;
    }
    const w = RS.modal(`
      <h3>Pague com PIX</h3>
      <p class="muted">Valor: <b>${RS.money(v)}</b>. O saldo entra sozinho assim que o pagamento for confirmado.</p>
      ${data.qr_base64 ? `<img src="data:image/png;base64,${data.qr_base64}" alt="QR code PIX" style="width:220px;margin:12px auto;display:block;background:#fff;padding:8px;border-radius:8px">` : ""}
      <textarea class="input" id="pix-code" readonly rows="3">${RS.esc(data.qr_code || "")}</textarea>
      <button class="btn btn-primary w-full" id="pix-copy">Copiar código PIX</button>
      <p class="muted small" id="pix-exp" style="margin-top:8px;text-align:center"></p>`);
    RS.$("#pix-copy", w).onclick = async () => {
      try { await navigator.clipboard.writeText(data.qr_code); } catch { RS.$("#pix-code", w).select(); document.execCommand("copy"); }
      RS.toast("Código copiado!", "ok");
    };
    const end = data.expires_at ? new Date(data.expires_at).getTime() : 0;
    const tick = () => {
      if (!document.body.contains(w)) return clearInterval(timer);
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      RS.$("#pix-exp", w).textContent = s ? `Expira em ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "PIX expirado. Gere um novo depósito.";
      if (!s) clearInterval(timer);
    };
    const timer = end ? setInterval(tick, 1000) : 0;
    if (end) tick();
    const ch = sb.channel("dep-" + id).on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "transactions", filter: `id=eq.${id}` },
      (e) => { if (e.new.status === "done") { w.remove(); RS.toast("Depósito confirmado!", "ok"); RS.refreshBalance(); sb.removeChannel(ch); } }).subscribe();
  }

  document.addEventListener("rs:balance", async () => {
    const p = await RS.profile();
    if (!p) return;
    me = p;
    for (const id of ["hdr-balance", "pop-balance", "la-bal"]) {
      const b = document.getElementById(id);
      if (b) { b.textContent = RS.money(p.balance); b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 600); }
    }
  });
  // banners e outros atalhos pedem o depósito por evento
  document.addEventListener("rs:deposit", () => (me ? panel("overview") : (location.href = "login.html?cadastro")));
  sb.channel("my-notif").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (e) => {
    if (me && e.new.user_id === me.id) { RS.toast("🔔 " + e.new.title, "info"); bell(); }
  }).subscribe();
  sb.auth.onAuthStateChange((ev) => {
    if (ev === "SIGNED_IN") sessionStorage.removeItem("rs-login-logged"); if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") render();
  });
  render();
})();
