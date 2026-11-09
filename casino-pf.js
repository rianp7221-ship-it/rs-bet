// Cassino no estilo lobby: atalhos, categorias, filtros, banner e faixas por categoria e por estúdio com "Ver todos".
// Jogos PlayFiver (casino_catalog com pf_code) abrem em tela cheia; jogos próprios usam os cards da página.
(function () {
  const root = RS.$("#casino");
  if (!root) return;
  const grid = RS.$("#pf-grid"), more = RS.$("#pf-more"), q = RS.$("#pf-q"), prov = RS.$("#pf-prov");
  const studios = RS.$("#cz-studios"), search = RS.$("#cz-search");
  const PAGE = 48, ROW = 18, COLS = "id,name,image,provider,pf_code";
  const POP = ["Fortune Tiger", "Gates of Olympus", "Sweet Bonanza", "Fortune Mouse", "Fortune Rabbit", "Big Bass Splash", "Sugar Rush", "Fortune Ox"];
  const FORT = ["126", "1543462", "98", "68", "1695365", "1879752", "3", "2100928"].map((c) => "pf:pf-1:" + c);
  const FIRST = ["PGSOFT", "PRAGMATIC", "PLAYNGO", "HACKSAW", "REELKINGDOM", "JILI", "HABANERO", "CQ9", "EGT", "AMUSNET"];
  const NAMES = { PGSOFT: "PG Soft", PRAGMATIC: "Pragmatic Play", PLAYNGO: "Play'n GO", REELKINGDOM: "Reel Kingdom", HACKSAW: "Hacksaw Gaming",
    SPADEGAMING: "Spadegaming", FATPANDA: "Fat Panda", BOOONGO: "Booongo", TOPTREND: "TopTrend Gaming", RUBYPLAY: "Ruby Play", FASTSPIN: "FastSpin",
    DREAMTECH: "Dreamtech", POPOK: "PopOK", FACHAI: "Fa Chai", "GALAXSYS ORIGINAL": "Galaxsys", "CRASH GAMES": "Crash Games", "DIGITAIN OFICIAL": "Digitain" };
  const RKEY = "rs-recent-games", MKEY = "rs-recent-meta";
  const ARR = `<span class="cs-arr"><button type="button" data-arr="-1" aria-label="Anterior">‹</button><button type="button" data-arr="1" aria-label="Próximo">›</button></span>`;
  let page = 0, provs = [], timer, sec = "all";

  const esc = RS.esc;
  const nice = (n) => NAMES[n] || (n.length <= 4 ? n : n.charAt(0) + n.slice(1).toLowerCase());
  const pname = (id) => nice(provs.find((p) => p.id === id)?.name || "");
  const byPop = (a, b) => (POP.indexOf(a.name) + 1 || 99) - (POP.indexOf(b.name) + 1 || 99);
  const pfTile = (g) => `<button class="pf-tile" data-pf="${esc(g.id)}" title="${esc(g.name)}">
      <img loading="lazy" src="${esc(g.image || "")}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(g.name)}<small>${esc(pname(g.provider))}</small></span></button>`;
  // jogo próprio (Leão, Mines, Dados) no formato das faixas, a partir do card da seção Originais
  const intTile = (game) => {
    const t = root.querySelector(`.cs-orig [data-game="${game}"]`) || root.querySelector(`.cs-orig [data-game="${game}-card"]`);
    if (!t || t.style.display === "none") return "";
    return `<a class="pf-tile cs-int" href="${t.getAttribute("href")}" data-game="${t.dataset.game}"><i class="${t.classList[1]}">${t.querySelector("i").textContent}</i><span>${esc(t.querySelector("b").textContent)}<small>Real Sports</small></span></a>`;
  };
  const tile = (g) => (g.pf_code ? pfTile(g) : intTile(g.id));
  const onProv = (list) => list.filter((g) => !g.pf_code || provs.some((p) => p.id === g.provider));
  // imagem de fundo dos atalhos do topo vem de um jogo da própria faixa
  const promo = (s, img) => img && root.querySelectorAll(`.cz-promo[data-sec="${s}"]`).forEach((b) => {
    if (!b.style.backgroundImage) b.style.backgroundImage = `url("${String(img).replace(/["\\]/g, "")}")`;
  });

  function show() {
    const orig = root.querySelector(".cs-orig"), origOn = [...orig.children].some((t) => t.style.display !== "none");
    orig.closest(".cs-sec").dataset.empty = origOn ? "" : "1";
    root.querySelectorAll('[data-sec="orig"]:not(.cs-sec)').forEach((b) => b.classList.toggle("hidden", !origOn));
    const searching = !!q.value.trim(), lobby = sec === "all" && !searching;
    root.classList.toggle("cz-solo", !lobby);
    root.querySelectorAll(".cz-lobby").forEach((el) => el.classList.toggle("hidden", !lobby));
    root.querySelectorAll(".cs-sec").forEach((s) => s.classList.toggle("hidden", !!s.dataset.empty ||
      !(searching ? s.dataset.sec === "slots" : lobby ? s.dataset.sec !== "slots" : s.dataset.sec === sec)));
  }
  function fill(id, html) {
    const el = RS.$("#" + id), s = el.closest(".cs-sec");
    el.innerHTML = html;
    s.dataset.empty = html.trim() ? "" : "1";
    const c = s.querySelector(".cz-count");
    if (c) c.textContent = `${el.children.length} ›`;
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
    if (data.free > 0) RS.toast(`🎁 Você tem ${data.free} rodadas grátis neste jogo! Elas aparecem dentro do jogo e depois que acabarem o jogo volta a usar o seu saldo.`, "ok");
    else if (data.free_fallback > 0) RS.toast(`🎁 ${data.free_fallback} rodadas grátis neste jogo: coloque a aposta no valor mínimo.`, "ok");
    ov.querySelector(".pf-ov-body").innerHTML = `<iframe src="${esc(data.url)}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    const g = provs.length && b.closest("[data-pf]");
    remember(id, { name: data.name || g?.title || "", image: g?.querySelector("img")?.getAttribute("src") || "", provider: data.provider || "" });
  }

  // ---------- grade (todos os jogos / busca / filtro / estúdio) ----------
  async function load(reset) {
    if (reset) { page = 0; grid.innerHTML = ""; }
    const t = q.value.trim();
    RS.$("#pf-title").textContent = t ? `Resultados para "${t}"` : prov.value ? pname(prov.value) : "Todos os jogos";
    let r = sb.from("casino_catalog").select(COLS).not("pf_code", "is", null).eq("active", true)
      .in("provider", prov.value ? [prov.value] : provs.map((p) => p.id));
    if (t) r = r.ilike("name", `%${t.replace(/[%_]/g, "")}%`);
    const { data } = await r.order("sort").range(page * PAGE, page * PAGE + PAGE - 1);
    const list = data || [];
    if (!t && !prov.value && page === 0) { list.sort(byPop); promo("slots", list[2]?.image); }
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
      data = (r.data || []).sort(byPop).filter((g) => !seen.has(g.name) && seen.add(g.name));
    }
    const list = onProv(data);
    fill("pf-feat", list.map(tile).join(""));
    promo("feat", (list.find((g) => g.name === "Gates of Olympus") || list.find((g) => g.image))?.image);
  }
  async function loadFort() {
    const { data } = await sb.from("casino_catalog").select(COLS).in("id", FORT).eq("active", true);
    const list = onProv(data || []).sort((a, b) => FORT.indexOf(a.id) - FORT.indexOf(b.id));
    fill("pf-fort", list.map(pfTile).join(""));
    promo("fort", list[0]?.image);
    RS.$("#cz-ban-art").innerHTML = list.slice(0, 3).map((g) => `<img src="${esc(g.image || "")}" alt="">`).join("");
  }
  function loadProvs() {
    fill("pf-provs", provs.map((p) => `<button class="cs-prov" data-prov="${esc(p.id)}">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="" onerror="this.remove()">` : ""}<b>${esc(nice(p.name))}</b></button>`).join(""));
  }

  // ---------- uma faixa por estúdio, carregada quando chega perto da tela ----------
  function buildStudios() {
    const order = [...provs].sort((a, b) => ((FIRST.indexOf(a.name) + 1 || 99) - (FIRST.indexOf(b.name) + 1 || 99)) || a.name.localeCompare(b.name));
    studios.innerHTML = order.map((p) => `<div class="cs-sec" data-sec="studio" data-sid="${esc(p.id)}"><div class="cs-head"><h2>${esc(nice(p.name))}</h2><div class="cz-hr">${ARR}<button type="button" class="cz-count" data-prov="${esc(p.id)}">Ver todos</button></div></div><div class="cs-rail cz-2r">${'<i class="cz-ph"></i>'.repeat(8)}</div></div>`).join("");
    RS.$("#cz-side-provs").innerHTML = order.map((p) => `<a data-prov="${esc(p.id)}"><i>›</i>${esc(nice(p.name))}</a>`).join("");
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); loadStudio(e.target); } }), { rootMargin: "600px 0px" });
    studios.querySelectorAll(".cs-sec").forEach((s) => io.observe(s));
  }
  async function loadStudio(s) {
    const { data, count } = await sb.from("casino_catalog").select(COLS, { count: "exact" }).eq("provider", s.dataset.sid)
      .not("pf_code", "is", null).eq("active", true).order("sort").limit(ROW);
    const list = (data || []).sort(byPop);
    if (list.length < 6) { s.dataset.empty = "1"; show(); return; }
    s.querySelector(".cs-rail").innerHTML = list.map(pfTile).join("");
    s.querySelector(".cz-count").textContent = `${count ?? list.length} ›`;
  }

  function go(s) {
    sec = s;
    root.querySelectorAll("[data-sec]:not(.cs-sec):not(.cz-promo):not(.cz-more):not(.cz-count)").forEach((x) => x.classList.toggle("active", x.dataset.sec === s));
    RS.$$(".bn-cz").forEach((x) => x.classList.toggle("active", x.dataset.cz === s));
    show();
    const top = root.getBoundingClientRect().top + scrollY - 70;
    if (scrollY > top) scrollTo({ top, behavior: "smooth" });
  }
  function reset() {
    if (!q.value && !prov.value) return;
    q.value = ""; prov.value = ""; load(true);
  }
  function find(text) {
    search.classList.remove("hidden");
    if (text != null) { q.value = text; load(true); show(); }
    setTimeout(() => q.focus(), 300);
  }

  root.addEventListener("click", (e) => {
    const pf = e.target.closest("[data-pf]");
    if (pf) { open(pf); return; }
    const arr = e.target.closest("[data-arr]");
    if (arr) { const rail = arr.closest(".cs-sec").querySelector(".cs-rail"); rail.scrollBy({ left: +arr.dataset.arr * rail.clientWidth * 0.85, behavior: "smooth" }); return; }
    const pv = e.target.closest("[data-prov]");
    if (pv) { prov.value = pv.dataset.prov; q.value = ""; load(true); go("slots"); return; }
    const tg = e.target.closest("[data-tag]");
    if (tg) { find(tg.dataset.tag); go("slots"); return; }
    if (e.target.closest("#cz-find")) { search.classList.toggle("hidden") || q.focus(); return; }
    const sb_ = e.target.closest("[data-sec]:not(.cs-sec)");
    if (sb_) { reset(); go(sb_.dataset.sec); return; }
    const g = e.target.closest("[data-game]");
    if (!g) return;
    remember(g.dataset.game);
    const card = g.getAttribute("href")?.startsWith("#") && document.getElementById(g.getAttribute("href").slice(1));
    if (card) { e.preventDefault(); card.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  // barra inferior no cassino: Cassino, Fortuna, Mais jogados, Explorar
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".bn-cz");
    if (!a) return;
    if (a.dataset.cz === "search") { reset(); go("all"); find(); return; }
    reset(); go(a.dataset.cz);
  });
  window.RScasino = { open: (id) => open({ dataset: { pf: id }, closest: () => null }) };
  more.onclick = () => load(false);
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { load(true); show(); }, 300); };
  prov.onchange = () => load(true);

  new MutationObserver(() => show()).observe(root.querySelector(".cs-orig"), { attributes: true, subtree: true, attributeFilter: ["style"] });
  recent();
  loadFeat();
  sb.from("casino_providers").select("id,name,image").like("id", "pf-%").eq("active", true).order("name").then(({ data }) => {
    provs = data || [];
    if (!provs.length) return;
    prov.insertAdjacentHTML("beforeend", provs.map((p) => `<option value="${esc(p.id)}">${esc(nice(p.name))}</option>`).join(""));
    RS.$("#pf-wrap").dataset.empty = "";
    recent(); loadFeat(); loadFort(); loadProvs(); buildStudios(); load(true); show();
  });
})();
