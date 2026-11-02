// Cassino PlayFiver: lista os jogos importados (casino_catalog com pf_code) e abre o jogo em tela cheia.
(function () {
  const wrap = RS.$("#pf-wrap");
  if (!wrap) return;
  const fort = RS.$("#pf-fort"), grid = RS.$("#pf-grid"), more = RS.$("#pf-more"), q = RS.$("#pf-q"), prov = RS.$("#pf-prov");
  const PAGE = 48, POP = ["Fortune Tiger", "Fortune Rabbit", "Fortune Ox", "Fortune Mouse", "Gates of Olympus", "Sweet Bonanza", "Aviator", "Mines", "Big Bass Splash", "Sugar Rush"];
  const FORT = ["126", "1543462", "98", "68", "1695365", "1879752", "3", "2100928"].map((c) => "pf:pf-1:" + c);
  let page = 0, provs = [], timer;
  const tile = (g) => `<button class="pf-tile" data-pf="${RS.esc(g.id)}" title="${RS.esc(g.name)}">
      <img loading="lazy" src="${RS.esc(g.image || "")}" alt="" onerror="this.style.visibility='hidden'"><span>${RS.esc(g.name)}</span></button>`;

  async function loadFort() {
    const { data } = await sb.from("casino_catalog").select("id,name,image,provider").in("id", FORT).eq("active", true);
    const list = (data || []).filter((g) => provs.some((p) => p.id === g.provider)).sort((a, b) => FORT.indexOf(a.id) - FORT.indexOf(b.id));
    fort.innerHTML = list.map(tile).join("");
    fort.previousElementSibling.classList.toggle("hidden", !list.length);
  }

  async function load(reset) {
    if (reset) { page = 0; grid.innerHTML = ""; }
    let r = sb.from("casino_catalog").select("id,name,image,provider").not("pf_code", "is", null).eq("active", true)
      .in("provider", prov.value ? [prov.value] : provs.map((p) => p.id));
    const t = q.value.trim();
    if (t) r = r.ilike("name", `%${t.replace(/[%_]/g, "")}%`);
    const { data } = await r.order("sort").range(page * PAGE, page * PAGE + PAGE - 1);
    let list = data || [];
    if (!t && !prov.value && page === 0) list.sort((a, b) => (POP.indexOf(a.name) + 1 || 99) - (POP.indexOf(b.name) + 1 || 99));
    grid.insertAdjacentHTML("beforeend", list.map(tile).join(""));
    if (!grid.children.length) grid.innerHTML = `<p class="muted">Nenhum jogo encontrado.</p>`;
    more.classList.toggle("hidden", list.length < PAGE);
    page++;
  }

  async function open(id) {
    if (!(await RS.user())) { location.href = "login.html"; return; }
    const ov = document.createElement("div");
    ov.className = "pf-ov";
    ov.innerHTML = `<div class="pf-ov-top"><b>Carregando…</b><button type="button" aria-label="Fechar">✕</button></div><div class="pf-ov-body"></div>`;
    document.body.appendChild(ov);
    document.body.style.overflow = "hidden";
    ov.querySelector("button").onclick = () => { ov.remove(); document.body.style.overflow = ""; RS.refreshBalance(); };
    const { data, error } = await sb.functions.invoke("playfiver", { body: { action: "launch", game: id } });
    const err = error ? (await error.context?.json?.().catch(() => null))?.error || "Não foi possível abrir o jogo." : null;
    if (err) { ov.remove(); document.body.style.overflow = ""; RS.toast(err, "error"); return; }
    ov.querySelector("b").textContent = data.name;
    ov.querySelector(".pf-ov-body").innerHTML = `<iframe src="${RS.esc(data.url)}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
  }

  wrap.addEventListener("click", (e) => { const b = e.target.closest("[data-pf]"); if (b) open(b.dataset.pf); });
  more.onclick = () => load(false);
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load(true), 300); };
  prov.onchange = () => load(true);

  sb.from("casino_providers").select("id,name").like("id", "pf-%").eq("active", true).order("name").then(({ data }) => {
    provs = data || [];
    if (!provs.length) return;
    prov.insertAdjacentHTML("beforeend", provs.map((p) => `<option value="${p.id}">${RS.esc(p.name)}</option>`).join(""));
    wrap.classList.remove("hidden");
    loadFort();
    load(true);
  });
})();
