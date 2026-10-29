// =====================================================
//  auth-header.js — cabeçalho com saldo, depósito, saque e sair
//  Coloque <header id="rs-header"></header> em qualquer página.
// =====================================================
(async () => {
  const el = document.getElementById("rs-header");
  if (!el) return;
  const page = location.pathname.split("/").pop() || "index.html";
  const link = (href, txt) => `<a href="${href}" class="${page === href ? "active" : ""}">${txt}</a>`;

  async function render() {
    const p = await RS.profile();
    el.innerHTML = `
      <div class="hdr">
        <a href="index.html" class="logo">RS<span>BET</span></a>
        <nav class="hdr-nav">
          <a href="index.html#sports">Esportes</a>
          <a href="index.html#casino">Cassino</a>
          ${p ? `<a href="index.html#history">Histórico</a>` : ""}
          ${p?.is_admin ? link("admin.html", "Admin") : ""}
        </nav>
        <div class="hdr-right">
          ${p ? `
            <div class="balance"><small>Saldo</small><b id="hdr-balance">${RS.money(p.balance)}</b></div>
            <button class="btn btn-primary" id="btn-deposit">Depositar</button>
            <button class="btn btn-ghost" id="btn-withdraw">Sacar</button>
            <button class="btn btn-ghost" id="btn-logout" title="Sair">Sair</button>`
          : `<a class="btn btn-ghost" href="login.html">Entrar</a><a class="btn btn-primary" href="login.html">Cadastrar</a>`}
        </div>
      </div>`;
    if (!p) return;
    if (p.blocked) RS.toast("Sua conta está bloqueada. Fale com o suporte.", "error");

    RS.$("#btn-logout").onclick = async () => { await sb.auth.signOut(); location.href = "login.html"; };
    RS.$("#btn-deposit").onclick = () => moneyModal("deposit");
    RS.$("#btn-withdraw").onclick = () => moneyModal("withdraw");
  }

  function moneyModal(kind) {
    const dep = kind === "deposit";
    const m = RS.modal(`
      <h3>${dep ? "Depositar" : "Sacar"}</h3>
      <p class="muted">${dep ? "Mínimo R$ 10,00. O saldo entra assim que o pagamento for confirmado." : "Mínimo R$ 20,00. O valor é reservado até a aprovação."}</p>
      <div class="chips">${[20, 50, 100, 500].map((v) => `<button class="chip" data-v="${v}">R$ ${v}</button>`).join("")}</div>
      <input type="number" id="mm-amount" class="input" min="${dep ? 10 : 20}" step="0.01" placeholder="Valor">
      <button class="btn btn-primary w-full" id="mm-go">${dep ? "Gerar pagamento" : "Solicitar saque"}</button>`);
    RS.$$(".chip", m).forEach((c) => (c.onclick = () => (RS.$("#mm-amount", m).value = c.dataset.v)));
    RS.$("#mm-go", m).onclick = async () => {
      const v = Number(RS.$("#mm-amount", m).value);
      try {
        const id = await RS.rpc(dep ? "request_deposit" : "request_withdraw", { p_amount: v });
        m.remove();
        // >>> PONTO DE INTEGRAÇÃO: aqui você chama o seu provedor de pagamento
        // licenciado (PIX) com o id da transação. Quando ele confirmar, o
        // webhook deve aprovar a transação no banco.
        RS.toast(dep ? `Depósito #${id} criado. Aguardando pagamento.` : `Saque #${id} solicitado.`, "ok");
        RS.refreshBalance();
      } catch (e) { RS.toast(e.message, "error"); }
    };
  }

  document.addEventListener("rs:balance", async () => {
    const p = await RS.profile();
    const b = document.getElementById("hdr-balance");
    if (p && b) { b.textContent = RS.money(p.balance); b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 600); }
  });
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") render(); });
  render();
})();
