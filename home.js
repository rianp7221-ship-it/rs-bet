// =====================================================
//  home.js — menu, voltar ao topo, minhas apostas e mentor de apostas
// =====================================================
(() => {
  const body = document.body;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-menu]")) { e.preventDefault(); body.classList.toggle("menu-open"); return; }
    if (e.target.closest("[data-close]") || e.target.id === "overlay") { body.classList.remove("menu-open", "slip-open"); return; }
    const act = e.target.closest("[data-act]");
    if (act) {
      e.preventDefault();
      body.classList.remove("menu-open");
      if (act.dataset.act === "refer") RS.refer(); else RS.support();
    }
  });

  const top = RS.$("#to-top");
  if (top) {
    addEventListener("scroll", () => top.classList.toggle("hidden", scrollY < 900), { passive: true });
    top.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- Banners do Início (Admin → Bônus e marketing → Banners): cartões na fileira de atalhos ----------
  const strip = RS.$("#casino-strip");
  if (strip) {
    const linkOf = (b) => {
      const l = b.link || "";
      if (l.startsWith("view:")) return `href="#sports" data-view="${RS.esc(l.slice(5))}"`;
      if (l === "deposit") return `href="#" data-promo-dep`;
      return `href="${RS.esc(/^(https?:|#|\/|[a-z0-9-]+\.html)/i.test(l) ? l : "#sports")}"`;
    };
    (async () => {
      const { data } = await sb.from("banners").select("*").order("sort").order("id");
      if (!data?.length) return;
      strip.insertAdjacentHTML("afterbegin", data.map((b) => `<a class="cs-tile pb-tile pb-${RS.esc(b.theme)}${b.image_url ? " pb-img" : ""}" ${linkOf(b)}
          ${b.image_url ? `style="background-image:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(0,0,0,.75)),url('${RS.esc(b.image_url)}')"` : ""}>
          ${b.image_url ? "" : `<span class="pb-art">${RS.icon(b.icon || "ball")}</span><small class="pb-cta">${RS.esc(b.cta || "")}</small>`}
          <b>${RS.esc(b.title)}</b></a>`).join(""));
    })();
    strip.addEventListener("click", (e) => { if (e.target.closest("[data-promo-dep]")) { e.preventDefault(); document.dispatchEvent(new Event("rs:deposit")); } });
  }

  // ---------- Minhas apostas (coluna da direita) ----------
  const mbList = RS.$("#mybets-list");
  let mb = "open";
  const ST = { pending: "Aberta", won: "Ganhou", lost: "Perdeu", canceled: "Cancelada", cashout: "Cashout" };
  async function loadMyBets() {
    if (!mbList) return;
    const u = await RS.user();
    if (!u) { mbList.innerHTML = `<p class="muted center small"><a href="login.html" style="color:var(--primary)">Entre</a> para ver suas apostas.</p>`; return; }
    let q = sb.from("bets").select("id,stake,potential,status,cashout_amount,bet_selections(id)")
      .eq("user_id", u.id).order("created_at", { ascending: false }).limit(5);
    q = mb === "open" ? q.eq("status", "pending") : q.neq("status", "pending");
    const { data } = await q;
    mbList.innerHTML = data?.length ? data.map((b) => `<div class="mb-item">
        <div>Bilhete #${b.id}<small>${b.bet_selections.length} seleção(ões) · ${RS.money(b.stake)}</small></div>
        <div style="text-align:right"><span class="badge b-${b.status}">${ST[b.status] || b.status}</span><small>${RS.money(b.status === "cashout" ? b.cashout_amount : b.potential)}</small></div>
      </div>`).join("")
      : `<p class="muted center small">${mb === "open" ? "Não tem apostas em aberto no momento." : "Nenhuma aposta resolvida ainda."}</p>`;
  }
  RS.$("#mybets")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mb]");
    if (!b) return;
    mb = b.dataset.mb;
    RS.$$("[data-mb]").forEach((x) => x.classList.toggle("active", x === b));
    loadMyBets();
  });
  document.addEventListener("rs:balance", loadMyBets);
  sb.auth.onAuthStateChange(() => setTimeout(loadMyBets, 0));

  // ---------- Mentor de apostas: monta múltiplas que pagam a faixa escolhida ----------
  const ranges = RS.$("#mentor-ranges");
  let range = [60, 200];
  ranges?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    range = b.dataset.r.split("-").map(Number);
    RS.$$("[data-r]", ranges).forEach((x) => x.classList.toggle("active", x === b));
  });
  RS.$("#mentor-go")?.addEventListener("click", () => {
    const out = RS.$("#mentor-out");
    const stake = Number(RS.$("#mentor-stake").value);
    if (!(stake > 0)) { out.innerHTML = `<p class="muted small">Digite quanto quer apostar.</p>`; return; }
    const S = window.RSsports;
    const pool = S.matches.filter((m) => m.status === "open" && !S.suspended(m) && m.odd_home && m.odd_away);
    const lo = range[0] / stake, hi = range[1] / stake;
    const found = new Map();
    for (let t = 0; t < 4000 && found.size < 12 && pool.length; t++) {
      const k = 1 + Math.floor(Math.random() * Math.min(10, pool.length));
      const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, k).map((m) => {
        const opts = ["home", "draw", "away"].filter((p) => m["odd_" + p]);
        const pick = opts[Math.floor(Math.random() * opts.length)];
        return { m, pick, odd: Number(m["odd_" + pick]) };
      });
      const odd = picks.reduce((a, s) => a * s.odd, 1);
      if (odd >= lo && odd <= hi) found.set(picks.map((s) => s.m.id + s.pick).sort().join(), { picks, odd });
    }
    const sug = [...found.values()].sort((a, b) => a.picks.length - b.picks.length).slice(0, 3);
    out.innerHTML = sug.length ? sug.map((s, i) => `<div class="sug">
        ${s.picks.map((p) => `<div><span>${RS.esc(p.pick === "draw" ? "Empate" : p.m[p.pick])} <small class="muted">· ${RS.esc(p.m.home)} x ${RS.esc(p.m.away)}</small></span><b>${p.odd.toFixed(2)}</b></div>`).join("")}
        <div><span>Odd total <b>${s.odd.toFixed(2)}</b></span><span>Ganho <b>${RS.money(stake * s.odd)}</b></span></div>
        <button class="btn btn-dark w-full sm" data-sug="${i}">Adicionar ao bilhete</button></div>`).join("")
      : `<p class="muted small" style="margin-top:8px">Não achamos uma combinação para essa faixa com os jogos disponíveis agora.</p>`;
    out.onclick = (e) => {
      const b = e.target.closest("[data-sug]");
      if (b) S.add(sug[b.dataset.sug].picks.map((p) => ({ id: p.m.id, pick: p.pick })), stake);
    };
  });

  // ---------- Cassino: categorias e "continuar jogando" ----------
  const cats = RS.$("#cat-chips");
  const tiles = [...document.querySelectorAll("#casino .game-tiles:not(#recent-tiles) .tile")];
  cats?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    cats.querySelectorAll("[data-cat]").forEach((x) => x.classList.toggle("active", x === b));
    tiles.forEach((t) => t.classList.toggle("hidden", b.dataset.cat !== "all" && !t.dataset.cat.split(" ").includes(b.dataset.cat)));
  });
  const recentIds = () => JSON.parse(localStorage.getItem("rs-recent-games") || "[]");
  function recent() {
    const html = recentIds().map((id) => tiles.find((t) => t.dataset.game === id)?.cloneNode(true)).filter(Boolean).map((t) => (t.classList.remove("hidden"), t.outerHTML)).filter(Boolean).join("");
    RS.$("#recent-tiles").innerHTML = html;
    RS.$("#recent-wrap").classList.toggle("hidden", !html);
  }
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-game]");
    if (!g || !cats) return;
    localStorage.setItem("rs-recent-games", JSON.stringify([g.dataset.game, ...recentIds().filter((x) => x !== g.dataset.game)].slice(0, 6)));
    setTimeout(recent, 0);
  });
  if (cats) recent();
})();
