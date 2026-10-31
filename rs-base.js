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

// Ícones (SVG próprios, traço)
RS.ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  week: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h3M14 14h3M7 17h3"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8c-1-3-5-4-5-1s5 1 5 1zm0 0c1-3 5-4 5-1s-5 1-5 1z"/>',
  headset: '<path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  home: '<path d="M3 11l9-8 9 8M5 9v12h14V9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 000 11.4M17.7 6.3a8 8 0 010 11.4"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 13h2M3 10h18"/>',
  id: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.5-2 3-2s2.5.5 3 2M14 10h4M14 13h4"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
};
RS.icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${RS.ICONS[n] || ""}</svg>`;

// Contato do suporte: preencha para ativar (whatsapp só números com DDI, ex. "5511999999999")
RS.SUPPORT = { whatsapp: "", email: "" };
RS.support = () => {
  const { whatsapp, email } = RS.SUPPORT;
  RS.modal(`<h3>Suporte</h3>${whatsapp || email
    ? `<p class="muted">Fale com a nossa equipe:</p>
       ${whatsapp ? `<a class="btn btn-green w-full" target="_blank" rel="noopener" href="https://wa.me/${whatsapp}">WhatsApp</a>` : ""}
       ${email ? `<a class="btn btn-outline w-full" style="margin-top:8px" href="mailto:${email}">${email}</a>` : ""}`
    : `<p class="muted">O canal de atendimento será liberado em breve.</p>`}`);
};
RS.refer = async () => {
  const u = await RS.user();
  if (!u) { location.href = "login.html"; return; }
  const url = `${location.origin}/login.html?ref=${u.id.slice(0, 8)}`;
  const m = RS.modal(`<h3>Indique um amigo</h3><p class="muted">Envie seu link para amigos criarem conta na Real Sports.</p>
    <input class="input" readonly value="${url}"><button class="btn btn-primary w-full" id="ref-copy">Compartilhar link</button>`);
  RS.$("#ref-copy", m).onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "Real Sports", url });
      else { await navigator.clipboard.writeText(url); RS.toast("Link copiado!", "ok"); }
    } catch { /* cancelado */ }
  };
};
