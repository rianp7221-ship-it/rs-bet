// =====================================================
//  rs-base.js — utilidades compartilhadas
// =====================================================
const RS = {
  money(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },
  date(d) {
    return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  },
  $(sel, root = document) { return root.querySelector(sel); },
  $$(sel, root = document) { return [...root.querySelectorAll(sel)]; },
  esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },
  toast(msg, type = "info") {
    let box = document.getElementById("rs-toasts");
    if (!box) { box = document.createElement("div"); box.id = "rs-toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "rs-toast " + type;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3500);
  },
  // limpa a mensagem de erro que vem do banco
  err(e) {
    const m = (e && (e.message || e.error_description)) || "Erro inesperado";
    return m.replace(/^.*?:\s*/, "") || m;
  },
  async rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(RS.err(error));
    return data;
  },
  async user() {
    const { data } = await sb.auth.getSession();
    return data.session?.user || null;
  },
  async profile() {
    const u = await RS.user();
    if (!u) return null;
    const { data } = await sb.from("profiles").select("*").eq("id", u.id).single();
    return data;
  },
  async requireLogin() {
    const u = await RS.user();
    if (!u) { location.href = "login.html"; return null; }
    return u;
  },
  // avisa o cabeçalho para recarregar o saldo
  refreshBalance() { document.dispatchEvent(new Event("rs:balance")); },
  modal(html) {
    const wrap = document.createElement("div");
    wrap.className = "rs-modal";
    wrap.innerHTML = `<div class="rs-modal-box"><button class="rs-modal-x" aria-label="Fechar">×</button>${html}</div>`;
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.classList.contains("rs-modal-x")) wrap.remove(); });
    document.body.appendChild(wrap);
    return wrap;
  },
};
window.RS = RS;

// Abas simples: botões com data-tab="id" mostram a seção #id
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  const group = b.closest("[data-tabs]") || document;
  RS.$$("[data-tab]", group).forEach((x) => x.classList.toggle("active", x === b));
  RS.$$(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== b.dataset.tab));
  document.dispatchEvent(new CustomEvent("rs:tab", { detail: b.dataset.tab }));
});
