// Cassino em lobby: faixas (continuar jogando, destaques do Admin, Fortuna, originais, crash, provedores) e grade com busca.
// Jogos PlayFiver (casino_catalog com pf_code) abrem em tela cheia; jogos próprios usam os cards da página.
(function () {
  const root = RS.$("#casino");
  if (!root) return;
  const grid = RS.$("#pf-grid"), more = RS.$("#pf-more"), q = RS.$("#pf-q"), prov = RS.$("#pf-prov"), nav = RS.$("#cat-chips");
  const PAGE = 48, COLS = "id,name,image,provider,pf_code";
  const POP = ["Fortune Tiger", "Gates of Olympus", "Sweet Bonanza", "Aviator", "Fortune Rabbit", "Big Bass Splash", "Sugar Rush", "Fortune Ox"];
  const FORT = ["126", "1543462", "98", "68", "1695365", "1879752", "3", "2100928"].map((c) => "pf:pf-1:" + c);
  const RKEY = "rs-recent-games", MKEY = "rs-recent-meta";
  let page = 0, provs = [], timer, sec = "all";

  const esc = RS.esc;
  const pname = (id) => provs.find((p) => p.id === id)?.name || "";
  const pfTile = (g) => `<button class="pf-tile" data-pf="${esc(g.id)}" title="${esc(g.name)}">
      <img loading="lazy" src="${esc(g.image || "")}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(g.name)}<small>${esc(pname(g.provider))}</small></span></button>`;
  // jogo próprio (Leão, Mines, Dados) no formato das faixas, a partir do card da seção Originais
  const intTile = (game) => {
    const t = root.querySelector(`.cs-orig [data-game="${game}"]`) || root.querySelector(`.cs-orig [data-game="${game}-card"]`);
    if (!t || t.style.display === "none") return "";
    return `<a class="pf-tile cs-int ${t.classList[1]}" href="${t.getAttribute("href")}" data-game="${t.dataset.game}"><i>${t.querySelector("i").textContent}</i><span>${esc(t.querySelector("b").textContent)}<small>Real Sports</small></span></a>`;
  };
  const tile = (g) => (g.pf_code ? pfTile(g) : intTile(g.id));
  const onProv = (list) => list.filter((g) => !g.pf_code || provs.some((p) => p.id === g.provider));

  function show() {
    const orig = root.querySelector(".cs-orig"), origOn = [...orig.children].some((t) => t.style.display !== "none");
    orig.closest(".cs-sec").dataset.empty = origOn ? "" : "1";
    nav.querySelector('[data-sec="orig"]').classList.toggle("hidden", !origOn);
    const searching = !!q.value.trim();
    root.querySelectorAll(".cs-sec").forEach((s) => s.classList.toggle("hidden", !!s.dataset.empty ||
      !(searching ? s.dataset.sec === "slots" : sec === "all" || s.dataset.sec === sec)));
  }
  function fill(id, html) {
    const el = RS.$("#" + id);
    el.innerHTML = html;
    el.closest(".cs-sec").dataset.empty = html.trim() ? "" : "1";
    show();
  }

  // ---------- continuar jogando (só jogos que abriram de verdade) ----------
  const recentIds = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch { return []; } };
  const recentMeta = () => { try { return JSON.parse(localStorage.getItem(MKEY) || "{}"); } catch { return {}; } };
  function recent() {
    const meta = recentMeta();
    fill("recent-tiles", recentIds().map((id) => (id.startsWith("pf:") ? (meta[id] ? pfTile({ id, ...meta[id] }) : "") : intTile(id))).join(""));
  }
  function remember(id, info) {
    const ids = [id, ...recentIds().filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(RKEY, JSON.stringify(ids));
    if (info) {
      const meta = recentMeta();
      meta[id] = info;
      Object.keys(meta).forEach((k) => ids.includes(k) || delete meta[k]);
      localStorage.setItem(MKEY, JSON.stringify(meta));
    }
    recent();
  }

  async function open(b) {
    const id = b.dataset.pf;
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
    ov.querySelector(".pf-ov-body").innerHTML = `<iframe src="${esc(data.url)}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    const g = provs.length && b.closest("[data-pf]");
    remember(id, { name: data.name || g?.title || "", image: g?.querySelector("img")?.getAttribute("src") || "", provider: data.provider || "" });
  }

  // ---------- grade (todos os slots / busca / provedor) ----------
  async function load(reset) {
    if (reset) { page = 0; grid.innerHTML = ""; }
    const t = q.value.trim();
    RS.$("#pf-title").textContent = t ? `Resultados para "${t}"` : prov.value ? `🎰 ${pname(prov.value)}` : "🎰 Todos os slots";
    let r = sb.from("casino_catalog").select(COLS).not("pf_code", "is", null).eq("active", true)
      .in("provider", prov.value ? [prov.value] : provs.map((p) => p.id));
    if (t) r = r.ilike("name", `%${t.replace(/[%_]/g, "")}%`);
    const { data } = await r.order("sort").range(page * PAGE, page * PAGE + PAGE - 1);
    const list = data || [];
    if (!t && !prov.value && page === 0) list.sort((a, b) => (POP.indexOf(a.name) + 1 || 99) - (POP.indexOf(b.name) + 1 || 99));
    grid.insertAdjacentHTML("beforeend", list.map(pfTile).join(""));
    if (!grid.children.length) grid.innerHTML = `<p class="muted">Nenhum jogo encontrado.</p>`;
    more.classList.toggle("hidden", list.length < PAGE);
    page++;
  }

  // ---------- faixas ----------
  async function loadFeat() {
    let { data } = await sb.from("casino_catalog").select(COLS).not("featured", "is", null).eq("active", true).order("featured").limit(30);
    if (!data?.length) { // sem destaques no Admin: os mais populares
      const r = await sb.from("casino_catalog").select(COLS).in("name", POP).not("pf_code", "is", null).eq("active", true);
      const seen = new Set();
      data = (r.data || []).sort((a, b) => POP.indexOf(a.name) - POP.indexOf(b.name)).filter((g) => !seen.has(g.name) && seen.add(g.name));
    }
    fill("pf-feat", onProv(data).map(tile).join(""));
  }
  async function loadFort() {
    const { data } = await sb.from("casino_catalog").select(COLS).in("id", FORT).eq("active", true);
    fill("pf-fort", onProv(data || []).sort((a, b) => FORT.indexOf(a.id) - FORT.indexOf(b.id)).map(pfTile).join(""));
  }
  async function loadCrash() {
    const { data } = await sb.from("casino_catalog").select(COLS).eq("category", "crash").not("pf_code", "is", null).eq("active", true)
      .in("provider", provs.map((p) => p.id)).order("sort").limit(24);
    fill("pf-crash", (data || []).map(pfTile).join(""));
  }
  function loadProvs() {
    fill("pf-provs", provs.map((p) => `<button class="cs-prov" data-prov="${esc(p.id)}">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="" onerror="this.remove()">` : ""}<b>${esc(p.name)}</b></button>`).join(""));
  }

  function go(s) {
    sec = s;
    nav.querySelectorAll("[data-sec]").forEach((x) => x.classList.toggle("active", x.dataset.sec === s));
    show();
    const top = nav.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight / 2) nav.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sec]");
    if (!b) return;
    if (q.value) { q.value = ""; load(true); }
    if (b.dataset.sec === "all" && prov.value) { prov.value = ""; load(true); }
    go(b.dataset.sec);
  });
  root.addEventListener("click", (e) => {
    const pf = e.target.closest("[data-pf]");
    if (pf) { open(pf); return; }
    const arr = e.target.closest("[data-arr]");
    if (arr) { const rail = arr.closest(".cs-sec").querySelector(".cs-rail"); rail.scrollBy({ left: +arr.dataset.arr * rail.clientWidth * 0.85, behavior: "smooth" }); return; }
    const pv = e.target.closest("[data-prov]");
    if (pv) { prov.value = pv.dataset.prov; q.value = ""; load(true); go("slots"); return; }
    const g = e.target.closest("[data-game]");
    if (!g) return;
    remember(g.dataset.game);
    const card = g.getAttribute("href")?.startsWith("#") && document.getElementById(g.getAttribute("href").slice(1));
    if (card) { e.preventDefault(); card.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  more.onclick = () => load(false);
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { load(true); show(); }, 300); };
  prov.onchange = () => load(true);

  new MutationObserver(() => show()).observe(root.querySelector(".cs-orig"), { attributes: true, subtree: true, attributeFilter: ["style"] });
  recent();
  loadFeat();
  sb.from("casino_providers").select("id,name,image").like("id", "pf-%").eq("active", true).order("name").then(({ data }) => {
    provs = data || [];
    if (!provs.length) return;
    prov.insertAdjacentHTML("beforeend", provs.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(""));
    RS.$("#pf-wrap").dataset.empty = "";
    recent(); loadFeat(); loadFort(); loadCrash(); loadProvs(); load(true); show();
  });
})();
