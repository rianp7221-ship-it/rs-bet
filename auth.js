// =====================================================
//  auth.js — login, cadastro e recuperação de senha (login.html)
// =====================================================
(async () => {
  if (await RS.user()) { location.href = "index.html"; return; }

  const form = RS.$("#auth-form");
  const title = RS.$("#auth-title");
  const submit = RS.$("#auth-submit");
  const nameRow = RS.$("#row-username");
  const ageRow = RS.$("#row-age");
  let mode = "login";

  function setMode(m) {
    mode = m;
    RS.$$(".auth-switch button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    nameRow.classList.toggle("hidden", m !== "signup");
    ageRow.classList.toggle("hidden", m !== "signup");
    RS.$("#row-password").classList.toggle("hidden", m === "reset");
    title.textContent = { login: "Entrar na sua conta", signup: "Criar conta", reset: "Recuperar senha" }[m];
    submit.textContent = { login: "Entrar", signup: "Cadastrar", reset: "Enviar link" }[m];
    RS.$("#auth-have").innerHTML = m === "signup" ? `Já tem uma conta? <a href="#" data-go="login">Faça login aqui</a>` : `Ainda não tem conta? <a href="#" data-go="signup">Cadastre-se</a>`;
  }
  RS.$$(".auth-switch button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  RS.$("#auth-have").addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); setMode(g.dataset.go); } });
    RS.$("#forgot").addEventListener("click", (e) => { e.preventDefault(); setMode("reset"); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    submit.disabled = true;
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        location.href = "index.html";
      } else if (mode === "signup") {
        if (!form.age.checked) throw new Error("Você precisa ter 18 anos ou mais");
        if (password.length < 8) throw new Error("A senha precisa de pelo menos 8 caracteres");
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { username: form.username.value.trim(), ref: localStorage.getItem("rs-ref") || undefined, aff: localStorage.getItem("rs-aff") || undefined }, emailRedirectTo: location.origin + "/index.html" },
        });
        if (error) throw error;
        if (data.session) location.href = "index.html";
        else RS.toast("Conta criada! Confirme pelo link enviado ao seu email.", "ok");
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/login.html" });
        if (error) throw error;
        RS.toast("Enviamos um link para seu email.", "ok");
      }
    } catch (err) {
      RS.toast(RS.err(err) === "Invalid login credentials" ? "Email ou senha incorretos" : RS.err(err), "error");
    } finally {
      submit.disabled = false;
    }
  });

  // chegou pelo link de "recuperar senha"
  sb.auth.onAuthStateChange(async (event) => {
    if (event === "PASSWORD_RECOVERY") {
      const nova = prompt("Digite sua nova senha (mínimo 8 caracteres):");
      if (nova && nova.length >= 8) {
        const { error } = await sb.auth.updateUser({ password: nova });
        RS.toast(error ? RS.err(error) : "Senha alterada!", error ? "error" : "ok");
        if (!error) location.href = "index.html";
      }
    }
  });

  setMode(/cadastro|signup/.test(location.search + location.hash) ? "signup" : "login");
})();
