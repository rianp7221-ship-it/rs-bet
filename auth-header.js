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
        <div class="hdr-right">
          <button class="icon-btn hide-xs" id="hdr-search" aria-label="Buscar">${RS.icon("search")}</button>
          ${me ? `
            <button class="balance" id="hdr-bal"><small>Saldo</small><b id="hdr-balance">${RS.money(me.balance)}</b></button>
            <button class="btn btn-green" id="btn-deposit">Depositar</button>
            <button class="avatar" id="hdr-avatar" aria-label="Minha conta">${RS.esc(initial(me))}</button>`
          : `<a class="btn btn-hdr-out" href="login.html">Cadastre-se</a><a class="btn btn-green" href="login.html">Entrar</a>`}
        </div>
      </div>`;
    markNav();
    RS.$("#hdr-search").onclick = search;
    if (!me) return;
    if (me.blocked) RS.toast("Sua conta está bloqueada. Fale com o suporte.", "error");
    RS.$("#btn-deposit").onclick = () => moneyModal("deposit");
    RS.$("#hdr-bal").onclick = () => panel("overview");
    RS.$("#hdr-avatar").onclick = togglePop;
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
      if (a === "panel") panel("overview");
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
  const txRow = (t) => `<div class="mb-item"><div>${RS.esc(t.description || t.type)}<small>${RS.date(t.created_at)} · ${TX_ST[t.status] || t.status}</small></div>
    <b class="${t.amount >= 0 ? "pos" : "neg"}">${RS.money(t.amount)}</b></div>`;
  const TABS = { overview: ["grid", "Visão geral"], tx: ["card", "Transações"], data: ["user", "Meus dados"] };

  function panel(tab) {
    RS.$(".acct-panel")?.remove();
    const w = document.createElement("div");
    w.className = "acct-panel";
    w.innerHTML = `<div class="ap-box">
      <div class="ap-head"><span id="ap-title"></span><button class="icon-btn" data-x aria-label="Fechar">${RS.icon("x")}</button></div>
      <div class="ap-tabs">${Object.entries(TABS).map(([k, [ic, t]]) => `<button data-t="${k}">${RS.icon(ic)} ${t}</button>`).join("")}</div>
      <div class="ap-body" id="ap-body"></div></div>`;
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
        const { data } = await sb.from("transactions").select("*").eq("user_id", p.id).order("created_at", { ascending: false }).limit(50);
        body.innerHTML = `<div class="ap-card ap-list">${data?.length ? data.map(txRow).join("") : `<p class="muted">Nenhuma movimentação.</p>`}</div>`;
      }
      if (k === "data") {
        body.innerHTML = `<div class="ap-card"><h3>Informações gerais</h3>
          <div class="ap-field"><label>ID</label><input class="input" readonly value="${p.id}"></div>
          <div class="ap-field"><label>Nome de usuário</label><input class="input" readonly value="${RS.esc(p.username || "")}"></div>
          <div class="ap-field"><label>E-mail</label><input class="input" readonly value="${RS.esc(p.email || "")}"></div>
          <p class="muted small">Para corrigir nome ou e-mail, fale com o suporte.</p>
          <button class="btn btn-outline sm" data-ap="pass" style="margin-top:12px">${RS.icon("key")} Trocar senha</button></div>`;
      }
    }
    w.addEventListener("click", (e) => {
      if (e.target === w || e.target.closest("[data-x]")) { w.remove(); return; }
      const t = e.target.closest("[data-t]");
      if (t) { show(t.dataset.t); return; }
      const a = e.target.closest("[data-ap]")?.dataset.ap;
      if (a === "refresh") { RS.refreshBalance(); show("overview"); }
      if (a === "deposit" || a === "withdraw") moneyModal(a);
      if (a === "pass") resetPass();
    });
    document.addEventListener("rs:balance", () => { if (document.body.contains(w)) show(cur); });
    show(tab);
  }

  // ---------- depósito e saque ----------
  function moneyModal(kind) {
    const dep = kind === "deposit";
    const m = RS.modal(`
      <h3>${dep ? "Depositar" : "Sacar"}</h3>
      <p class="muted">${dep ? "Mínimo R$ 10,00. O saldo entra assim que o pagamento for confirmado." : "Mínimo R$ 20,00. O valor é reservado até a aprovação."}</p>
      <div class="chips">${[20, 50, 100, 500].map((v) => `<button class="chip" data-v="${v}">R$ ${v}</button>`).join("")}</div>
      <input type="number" id="mm-amount" class="input" min="${dep ? 10 : 20}" step="0.01" placeholder="Valor">
      <button class="btn ${dep ? "btn-green" : "btn-primary"} w-full" id="mm-go">${dep ? "Gerar pagamento" : "Solicitar saque"}</button>`);
    RS.$$(".chip", m).forEach((c) => (c.onclick = () => (RS.$("#mm-amount", m).value = c.dataset.v)));
    RS.$("#mm-go", m).onclick = async () => {
      const v = Number(RS.$("#mm-amount", m).value);
      try {
        const id = await RS.rpc(dep ? "request_deposit" : "request_withdraw", { p_amount: v });
        m.remove();
        if (dep) await showPix(id, v);
        else RS.toast(`Saque #${id} solicitado. Aguarde a aprovação.`, "ok");
        RS.refreshBalance();
      } catch (e) { RS.toast(e.message, "error"); }
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
      <button class="btn btn-primary w-full" id="pix-copy">Copiar código PIX</button>`);
    RS.$("#pix-copy", w).onclick = async () => { await navigator.clipboard.writeText(data.qr_code); RS.toast("Código copiado!", "ok"); };
    const ch = sb.channel("dep-" + id).on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "transactions", filter: `id=eq.${id}` },
      (e) => { if (e.new.status === "done") { w.remove(); RS.toast("Depósito confirmado!", "ok"); RS.refreshBalance(); sb.removeChannel(ch); } }).subscribe();
  }

  document.addEventListener("rs:balance", async () => {
    const p = await RS.profile();
    if (!p) return;
    me = p;
    for (const id of ["hdr-balance", "pop-balance"]) {
      const b = document.getElementById(id);
      if (b) { b.textContent = RS.money(p.balance); b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 600); }
    }
  });
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") render(); });
  render();
})();
