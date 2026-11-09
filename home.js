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
      const promo = `<a class="pt pt-wheel" href="#" data-wheel><span class="pt-ic">${RS.icon("star")}</span><span class="pt-art pc-wheel-art"></span>
          <span class="pt-t"><b>Roda da Sorte</b><small id="pc-wheel-sub">Gire grátis todo dia</small></span></a>
        <a class="pt pt-wide pt-top hidden" href="#" id="pc-top"></a>`;
      const czArt = `<span class="pt-art ptc"><i class="ptc-rays"></i><i class="ptc-glow"></i><span class="ptc-covers"></span>
          <i class="ptc-coin c1"></i><i class="ptc-coin c2"></i><i class="ptc-coin c3"></i><i class="ptc-spark s1"></i><i class="ptc-spark s2"></i><i class="ptc-spark s3"></i></span>`;
      strip.insertAdjacentHTML("beforebegin", `<div class="pc-strip pt-strip" id="pc-strip">${promo}${(data || []).map((b) => `<a class="pt pt-wide pt-${RS.esc(b.theme)}${b.image_url ? " pt-img" : b.link === "#casino" ? " pt-casino" : ""}" ${linkOf(b)}
          ${b.image_url ? `style="--pc-img:url('${RS.esc(b.image_url)}')"` : ""}>
          <span class="pt-ic">${RS.icon(b.icon || "ball")}</span>${b.image_url ? "" : b.link === "#casino" ? czArt
            : `<span class="pt-art pt-art-ic">${RS.icon(b.icon || "ball")}</span>`}
          <span class="pt-t">${b.subtitle ? `<small class="pt-kick">${RS.esc(b.subtitle)}</small>` : ""}${!b.image_url && b.link === "#casino" ? `<span class="ptc-chip hidden"></span>` : ""}<b>${RS.esc(b.title)}</b>
          ${b.cta ? `<span class="pt-pill">${RS.esc(b.cta)}</span>` : ""}</span></a>`).join("")}</div>`);
      wheelSub(); loadTop(); casinoArt();
    })();
    document.addEventListener("click", (e) => { if (e.target.closest("#pc-strip [data-promo-dep]")) { e.preventDefault(); document.dispatchEvent(new Event("rs:deposit")); } });
    strip.addEventListener("click", (e) => { if (e.target.closest("[data-promo-dep]")) { e.preventDefault(); document.dispatchEvent(new Event("rs:deposit")); } });
  }

  // banner do cassino: capas dos jogos mais famosos que estão ativos (estúdio ativo também)
  const CZ_POP = ["Fortune Tiger", "Gates of Olympus", "Sweet Bonanza", "Fortune Rabbit", "Big Bass Splash", "Fortune Ox", "Sugar Rush", "Fortune Mouse"];
  async function casinoArt() {
    const cards = RS.$$("#pc-strip .pt-casino");
    if (!cards.length) return;
    const { data: provs } = await sb.from("casino_providers").select("id").eq("active", true);
    const on = (provs || []).map((p) => p.id);
    if (!on.length) return;
    const [{ data: games }, { count }] = await Promise.all([
      sb.from("casino_catalog").select("name,image").in("name", CZ_POP).in("provider", on).eq("active", true).not("pf_code", "is", null).not("image", "is", null),
      sb.from("casino_catalog").select("id", { count: "exact", head: true }).in("provider", on).eq("active", true).not("pf_code", "is", null),
    ]);
    const seen = new Set();
    const list = (games || []).sort((a, b) => CZ_POP.indexOf(a.name) - CZ_POP.indexOf(b.name))
      .filter((g) => !seen.has(g.name) && seen.add(g.name)).slice(0, 3);
    const html = list.map((g) => `<img src="${RS.esc(g.image)}" alt="${RS.esc(g.name)}" loading="lazy">`).join("");
    const n = count >= 200 ? Math.floor(count / 100) * 100 : count;
    cards.forEach((c) => {
      c.querySelector(".ptc-covers").innerHTML = html;
      const chip = c.querySelector(".ptc-chip");
      if (n) { chip.textContent = `+${n.toLocaleString("pt-BR")} jogos`; chip.classList.remove("hidden"); }
    });
  }

  // ---------- Roleta diária e "Mais apostado do dia" (primeiros cartões da fileira de banners) ----------
  const WG = [["#ff8a1f", "#e64400"], ["#3d7bff", "#1636a8"], ["#2fe08a", "#0b8a48"], ["#b45cff", "#5d17c9"], ["#ff4f9a", "#c4105a"]];
  const wLabel = (l) => { const m = /R\$\s*\d+/.exec(l), n = /^(\d+)\s+rodadas/i.exec(l);
    return m ? [m[0], "APOSTA GRÁTIS"] : n ? [n[1], "RODADAS GRÁTIS"] : ["✕", "TENTE AMANHÃ"]; };
  const wPt = (a, r) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)},${(-r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
  function wheelDisc(prizes, labels = true) {
    const N = prizes.length, seg = 360 / N, top = Math.max(...prizes.map((l) => +(/R\$\s*(\d+)/.exec(l)?.[1] || 0)));
    let c = 0;
    const defs = WG.map((g, i) => `<radialGradient id="wg${i}" cx="0" cy="0" r="96" gradientUnits="userSpaceOnUse"><stop offset=".25" stop-color="${g[0]}"/><stop offset="1" stop-color="${g[1]}"/></radialGradient>`).join("")
      + `<radialGradient id="wgn" cx="0" cy="0" r="96" gradientUnits="userSpaceOnUse"><stop offset=".25" stop-color="#2a3352"/><stop offset="1" stop-color="#121833"/></radialGradient>
         <radialGradient id="wgt" cx="0" cy="0" r="96" gradientUnits="userSpaceOnUse"><stop offset=".25" stop-color="#ffe27a"/><stop offset="1" stop-color="#d68a00"/></radialGradient>`;
    return `<svg viewBox="-100 -100 200 200" aria-hidden="true"><defs>${defs}</defs>${prizes.map((l, i) => {
      const [big, small] = wLabel(l), none = big === "✕", jack = !none && top >= 10 && big === `R$ ${top}`;
      const fill = none ? "url(#wgn)" : jack ? "url(#wgt)" : `url(#wg${c++ % WG.length})`;
      return `<path d="M0,0 L${wPt(i * seg, 92)} A92,92 0 0 1 ${wPt((i + 1) * seg, 92)} Z" fill="${fill}" stroke="#ffd34d" stroke-width="1.2"/>
        ${labels ? `<g transform="rotate(${(i + 0.5) * seg})"><text y="-62" text-anchor="middle" fill="${jack ? "#3b1d00" : "#fff"}" font-weight="900" font-size="${none ? 16 : big.length > 3 ? 13 : 17}" style="paint-order:stroke" stroke="rgba(0,0,0,.25)" stroke-width="${jack ? 0 : 1.5}">${RS.esc(big)}</text>
        <text y="-50" text-anchor="middle" fill="${jack ? "#3b1d00" : "#fff"}" font-size="4.5" font-weight="800">${small}</text>
        ${jack ? `<text y="-80" text-anchor="middle" font-size="9">👑</text>` : ""}</g>` : ""}`;
    }).join("")}<circle r="92" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="8"/></svg>`;
  }
  function wheelFrame(n = 16) {
    return `<svg viewBox="-100 -100 200 200" aria-hidden="true"><defs><linearGradient id="wfr" x1="0" y1="-1" x2="0" y2="1">
      <stop offset="0" stop-color="#fff2a8"/><stop offset=".45" stop-color="#f5b301"/><stop offset="1" stop-color="#a86500"/></linearGradient></defs>
      <circle r="96" fill="none" stroke="url(#wfr)" stroke-width="9"/><circle r="100" fill="none" stroke="#7a4a00" stroke-width="1.5"/><circle r="91.5" fill="none" stroke="#7a4a00" stroke-width="1"/>
      ${Array.from({ length: n }, (_, i) => { const [x, y] = wPt((i * 360) / n, 96).split(","); return `<circle class="wb ${i % 2 ? "wb2" : ""}" cx="${x}" cy="${y}" r="3.1"/>`; }).join("")}</svg>`;
  }
  const wheelSvg = (prizes, labels = true) => `<span class="wh-mini">${wheelDisc(prizes, labels)}${wheelFrame(12)}</span>`;
  function confetti(host) {
    const box = document.createElement("div");
    box.className = "wh-conf";
    const cs = ["#ffd34d", "#ff5a00", "#2fe08a", "#3d7bff", "#ff4f9a", "#fff"];
    box.innerHTML = Array.from({ length: 70 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${cs[i % cs.length]};animation-delay:${(Math.random() * 0.6).toFixed(2)}s;animation-duration:${(1.8 + Math.random() * 1.6).toFixed(2)}s;transform:rotate(${Math.random() * 360}deg)"></i>`).join("");
    host.appendChild(box);
    setTimeout(() => box.remove(), 4200);
  }
  async function openWheel() {
    const st = await RS.rpc("wheel_status").catch(() => null);
    if (!st?.on) { RS.toast("Roleta indisponível no momento.", "error"); return; }
    const seg = 360 / st.prizes.length, at = (i) => 360 - (i + 0.5) * seg;
    const state = !st.logged ? "login" : st.spun ? "spun" : !st.dep ? "lock" : "spin";
    const msg = { login: "Entre na sua conta para girar a roleta.", spun: `Você já girou hoje: <b>${RS.esc(st.label)}</b>. Volte amanhã!`,
      lock: "Faça seu <b>primeiro depósito</b> para liberar a roleta. Depois é 1 giro grátis todo dia, sem precisar apostar.", spin: "Seu giro de hoje está liberado! Toque em <b>GIRAR</b>." }[state];
    const btn = { login: "Entrar para girar", spun: "Ver meus bônus", lock: "Depositar agora", spin: "GIRAR AGORA" }[state];
    const kinds = [...new Set(st.prizes.map((l) => wLabel(l)).filter((x) => x[0] !== "✕").map((x) => `${x[0]} ${x[1].toLowerCase()}`))];
    const m = RS.modal(`<div class="wh wh-${state}"><div class="wh-stars"></div>
      <div class="wh-kick">🎁 Prêmios todos os dias</div><h3>Roda da Sorte</h3>
      <div class="wh-box"><i class="wh-pin"></i><div class="wh-disc" style="transform:rotate(${st.spun ? at(st.idx) : 0}deg)">${wheelDisc(st.prizes)}</div>
        <div class="wh-frame">${wheelFrame(20)}</div><button class="wh-hub" data-wh="${state}" aria-label="${btn}">${state === "spin" ? "GIRAR" : state === "lock" ? "🔒" : state === "spun" ? "✓" : "▶"}</button></div>
      <p class="wh-msg">${msg}</p>
      <button class="btn wh-go w-full" data-wh="${state}">${btn}</button>
      <div class="wh-legend">${kinds.map((k) => `<span>${RS.esc(k)}</span>`).join("")}</div>
      <p class="small wh-terms">1 giro grátis por dia para quem já fez pelo menos 1 depósito, sem precisar apostar. Aposta grátis: só o lucro vai para o saldo, sem rollover, odd mínima 1,50. Rodadas grátis: ganho sem rollover, até R$ 50. Validade de 7 dias.</p></div>`);
    m.classList.add("wh-modal");
    m.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-wh]");
      if (!b) return;
      const a = b.dataset.wh;
      if (a === "login") { location.href = "login.html"; return; }
      if (a === "lock") {
        if (b.classList.contains("wh-go")) { m.remove(); document.dispatchEvent(new Event("rs:deposit")); }
        else RS.toast("Faça seu primeiro depósito para liberar a roleta.", "error");
        return;
      }
      if (a === "close") { m.remove(); return; }
      if (a === "spun" || a === "bonus") { m.remove(); document.dispatchEvent(new Event("rs:bonus")); return; }
      if (m.dataset.busy) return;
      m.dataset.busy = 1;
      const go = RS.$(".wh-go", m), hub = RS.$(".wh-hub", m);
      go.disabled = true; go.textContent = "Girando…"; m.classList.add("wh-spinning");
      try {
        const r = await RS.rpc("wheel_spin");
        const disc = RS.$(".wh-disc", m);
        disc.style.transition = "transform 5.2s cubic-bezier(.1,.75,.1,1)";
        disc.style.transform = `rotate(${360 * 8 + at(r.idx) + (Math.random() - 0.5) * seg * 0.6}deg)`;
        setTimeout(() => {
          const win = r.kind !== "none";
          m.classList.remove("wh-spinning");
          m.classList.add(win ? "wh-win" : "wh-lose");
          RS.$(".wh-msg", m).innerHTML = win ? `<span class="wh-prize"><small>Você ganhou</small><b>${RS.esc(r.label)}</b><small>Já está em Minha conta → Bônus</small></span>` : "Não foi dessa vez. Volte amanhã para girar de novo!";
          if (win) confetti(RS.$(".rs-modal-box", m));
          go.disabled = false; go.dataset.wh = win ? "bonus" : "close"; go.textContent = win ? "Usar meu prêmio" : "Fechar";
          hub.dataset.wh = go.dataset.wh; hub.textContent = win ? "🎉" : "✓";
          wheelSub();
        }, 5400);
      } catch (err) { RS.toast(err.message, "error"); go.disabled = false; go.textContent = "GIRAR AGORA"; m.classList.remove("wh-spinning"); delete m.dataset.busy; }
    });
  }
  window.RSwheel = openWheel;
  async function wheelSub() {
    const el = RS.$("#pc-wheel-sub"), st = await RS.rpc("wheel_status").catch(() => null);
    const card = el?.closest(".pt");
    if (!st?.on) { card?.remove(); return; }
    RS.$(".pc-wheel-art", card).innerHTML = wheelSvg(st.prizes, false);
    el.textContent = st.spun ? "Volte amanhã" : st.logged && st.dep ? "Giro liberado!" : "Gire grátis todo dia";
    card.classList.toggle("pt-ready", !st.spun && st.logged && st.dep);
  }
  let topPick = null;
  async function loadTop() {
    topPick = await RS.rpc("top_pick_today").catch(() => null);
    const el = RS.$("#pc-top");
    if (!el) return;
    if (!topPick) { el.remove(); return; }
    const side = topPick.pick === "home" ? topPick.home : topPick.pick === "away" ? topPick.away : "Empate";
    const logo = (u) => (u ? `<img src="${RS.esc(u)}" alt="" onerror="this.remove()">` : "");
    const hora = new Date(topPick.starts_at).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    el.innerHTML = `<span class="pt-ic">${RS.icon("fire")}</span><small class="pt-corner">Mais apostado do dia</small>
      <span class="pt-art pc-top-logos">${logo(topPick.home_logo)}${logo(topPick.away_logo)}</span>
      <span class="pt-t"><small class="pt-kick">${RS.esc(topPick.league || "")} · ${hora}</small><b>${RS.esc(topPick.home)} x ${RS.esc(topPick.away)}</b>
      <span class="pt-pill"><em>${topPick.pct}%</em> em ${RS.esc(side)} · ${Number(topPick.odd).toFixed(2)}</span></span>`;
    el.classList.remove("hidden");
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#pc-strip [data-wheel]")) { e.preventDefault(); openWheel(); return; }
    if (e.target.closest("#pc-top") && topPick) {
      e.preventDefault();
      if (!window.RSsports?.add([{ id: topPick.match, pick: topPick.pick, market: topPick.market }])) RS.toast("Esse jogo não está disponível agora.", "error");
    }
  });

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
        <div style="text-align:right">${b.status === "cashout" ? RS.betBadge(b) : `<span class="badge b-${b.status}">${ST[b.status] || b.status}</span>`}<small>${RS.money(b.status === "cashout" ? b.cashout_amount : b.potential)}</small></div>
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
  document.addEventListener("rs:balance", () => { if (RS.$("#pc-wheel-sub")) wheelSub(); });
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

})();
