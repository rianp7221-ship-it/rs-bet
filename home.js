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
      const promo = `<a class="pc pc-dark pc-wheel" href="#" data-wheel><span class="pc-glow"></span><span class="pc-shine"></span><span class="pc-art pc-wheel-art"></span>
          <span class="pc-body"><b>Roleta diária</b><small id="pc-wheel-sub">Gire e ganhe apostas e rodadas grátis</small><span class="pc-cta">Girar agora <i>→</i></span></span></a>
        <a class="pc pc-navy pc-top hidden" href="#" id="pc-top"></a>`;
      strip.insertAdjacentHTML("beforebegin", `<div class="pc-strip" id="pc-strip">${promo}${(data || []).map((b) => `<a class="pc pc-${RS.esc(b.theme)}${b.image_url ? " pc-img" : ""}" ${linkOf(b)}
          ${b.image_url ? `style="--pc-img:url('${RS.esc(b.image_url)}')"` : ""}>
          <span class="pc-glow"></span><span class="pc-shine"></span>
          ${b.image_url ? "" : `<span class="pc-art">${RS.icon(b.icon || "ball")}</span>`}
          <span class="pc-body"><b>${RS.esc(b.title)}</b>${b.subtitle ? `<small>${RS.esc(b.subtitle)}</small>` : ""}
          ${b.cta ? `<span class="pc-cta">${RS.esc(b.cta)} <i>→</i></span>` : ""}</span></a>`).join("")}</div>`);
      wheelSub(); loadTop();
    })();
    document.addEventListener("click", (e) => { if (e.target.closest("#pc-strip [data-promo-dep]")) { e.preventDefault(); document.dispatchEvent(new Event("rs:deposit")); } });
    strip.addEventListener("click", (e) => { if (e.target.closest("[data-promo-dep]")) { e.preventDefault(); document.dispatchEvent(new Event("rs:deposit")); } });
  }

  // ---------- Roleta diária e "Mais apostado do dia" (primeiros cartões da fileira de banners) ----------
  const WC = ["#ff5a00", "#1d3fae", "#0f9d55", "#6a1fd6"];
  const wLabel = (l) => { const m = /R\$\s*\d+/.exec(l), n = /^(\d+)\s+rodadas/i.exec(l);
    return m ? [m[0], "APOSTA GRÁTIS"] : n ? [n[1], "RODADAS GRÁTIS"] : ["✕", "TENTE AMANHÃ"]; };
  function wheelSvg(prizes, labels = true) {
    const N = prizes.length, seg = 360 / N, pt = (a, r) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)},${(-r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
    let c = 0;
    return `<svg viewBox="-100 -100 200 200" aria-hidden="true"><circle r="99" fill="#141a28"/>${prizes.map((l, i) => {
      const none = wLabel(l)[0] === "✕", fill = none ? (i % 2 ? "#2c3447" : "#3a4458") : WC[c++ % WC.length], [big, small] = wLabel(l);
      return `<path d="M0,0 L${pt(i * seg, 94)} A94,94 0 0 1 ${pt((i + 1) * seg, 94)} Z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>
        ${labels ? `<g transform="rotate(${(i + 0.5) * seg})"><text y="-66" text-anchor="middle" fill="#fff" font-weight="900" font-size="${big.length > 3 ? 12 : 15}">${RS.esc(big)}</text>
        <text y="-54" text-anchor="middle" fill="#fff" font-size="5.6" font-weight="700">${small}</text></g>` : ""}`;
    }).join("")}<circle r="15" fill="#fff"/><circle r="10" fill="#ff5a00"/></svg>`;
  }
  async function openWheel() {
    const st = await RS.rpc("wheel_status").catch(() => null);
    if (!st?.on) { RS.toast("Roleta indisponível no momento.", "error"); return; }
    const seg = 360 / st.prizes.length, at = (i) => 360 - (i + 0.5) * seg;
    const falta = Math.max(0, st.min - st.bet);
    const msg = !st.logged ? "Entre na sua conta para girar." : st.spun ? `Você já girou hoje: <b>${RS.esc(st.label)}</b>. Volte amanhã!`
      : falta > 0 ? `Aposte ${RS.money(st.min)} hoje para liberar o giro. Falta ${RS.money(falta)}.` : "Seu giro de hoje está liberado!";
    const btn = !st.logged ? ["login", "Entrar para girar"] : st.spun ? ["bonus", "Ver meus bônus"] : falta > 0 ? ["bet", "Apostar agora"] : ["spin", "GIRAR"];
    const m = RS.modal(`<div class="wh"><h3>Roleta diária</h3><p class="muted small">1 giro por dia para quem apostou ${RS.money(st.min)} ou mais no dia.</p>
      <div class="wh-box"><i class="wh-pin"></i><div class="wh-disc" style="transform:rotate(${st.spun ? at(st.idx) : 0}deg)">${wheelSvg(st.prizes)}</div></div>
      <p class="wh-msg">${msg}</p><button class="btn ${btn[0] === "spin" ? "btn-green" : "btn-primary"} w-full" data-wh="${btn[0]}">${btn[1]}</button>
      <p class="muted small wh-terms">Prêmios: apostas grátis (só o lucro vai para o saldo, sem rollover, odd mínima 1,50) e rodadas grátis no cassino (ganho sem rollover, até R$ 50). Validade de 7 dias.</p></div>`);
    m.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-wh]");
      if (!b) return;
      const a = b.dataset.wh;
      if (a === "login") { location.href = "login.html"; return; }
      if (a === "bet" || a === "close") { m.remove(); return; }
      if (a === "bonus") { m.remove(); document.dispatchEvent(new Event("rs:bonus")); return; }
      b.disabled = true; b.textContent = "Girando…";
      try {
        const r = await RS.rpc("wheel_spin");
        const disc = RS.$(".wh-disc", m);
        disc.style.transition = "transform 4.8s cubic-bezier(.12,.7,.12,1)";
        disc.style.transform = `rotate(${360 * 7 + at(r.idx)}deg)`;
        setTimeout(() => {
          const win = r.kind !== "none";
          RS.$(".wh-msg", m).innerHTML = win ? `🎉 Você ganhou <b>${RS.esc(r.label)}</b>! Já está em Minha conta → Bônus.` : "Não foi dessa vez. Volte amanhã para girar de novo!";
          b.disabled = false; b.dataset.wh = win ? "bonus" : "close"; b.textContent = win ? "Usar agora" : "Fechar";
          m.classList.toggle("wh-win", win);
          wheelSub();
        }, 5000);
      } catch (err) { RS.toast(err.message, "error"); b.disabled = false; b.textContent = "GIRAR"; }
    });
  }
  window.RSwheel = openWheel;
  async function wheelSub() {
    const el = RS.$("#pc-wheel-sub"), st = await RS.rpc("wheel_status").catch(() => null);
    const card = el?.closest(".pc");
    if (!st?.on) { card?.remove(); return; }
    RS.$(".pc-wheel-art", card).innerHTML = wheelSvg(st.prizes, false);
    el.textContent = st.spun ? "Você já girou hoje. Volte amanhã!" : st.logged && st.bet >= st.min ? "Seu giro de hoje está liberado!" : `Aposte ${RS.money(st.min)} no dia e gire para ganhar apostas e rodadas grátis`;
    RS.$(".pc-cta", card).innerHTML = `${st.spun ? "Ver roleta" : "Girar agora"} <i>→</i>`;
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
    el.innerHTML = `<span class="pc-glow"></span><span class="pc-shine"></span><span class="pc-top-logos">${logo(topPick.home_logo)}${logo(topPick.away_logo)}</span>
      <span class="pc-body"><small class="pc-kick">🔥 Mais apostado do dia · ${RS.esc(topPick.league || "")} · ${hora}</small><b>${RS.esc(topPick.home)} x ${RS.esc(topPick.away)}</b>
      <small><b class="pc-pct">${topPick.pct}%</b> apostaram em ${RS.esc(side)} · ${topPick.bets} bilhetes</small>
      <span class="pc-cta">Apostar junto ${Number(topPick.odd).toFixed(2)} <i>→</i></span></span>`;
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
