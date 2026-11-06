// "Acompanhar" do bilhete: campinho, estatísticas e lances do jogo ao vivo, direto do 365Scores (sem passar pelo Supabase)
(() => {
  const API = "https://webws.365scores.com/web";
  const Q = "appTypeId=5&langId=31&timezoneName=America/Sao_Paulo&userCountryId=21";
  const get = (u) => fetch(u, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const esc = (s) => RS.esc(String(s ?? ""));
  // estatísticas mostradas (ids do 365Scores), na ordem
  const STATS = [10, 11, 24, 3, 4, 8, 9, 2];
  const PT = { Goal: "Gol", Substitution: "Substituição", "Yellow Card": "Cartão amarelo", "Red Card": "Cartão vermelho", "Missed Penalty": "Pênalti perdido", "Penalty Miss": "Pênalti perdido", "Own Goal": "Gol contra" };
  let cur = null;

  // texto do lance (365/Opta em português, Sportradar em inglês) → rótulo e posição da bola (x 0..105, y 0..68, mandante ataca para a direita)
  function play(m, home, away) {
    const t = String(m.Comment || "").toLowerCase(), k = String(m.TypeName || "").toLowerCase();
    const own = /own half|their half|próprio campo|seu campo|defesa/.test(t), opp = /half of|campo adversário|ataque/.test(t);
    const side = m.Id % 2 ? 2 : 66;
    if (k === "free kick lost") return null;
    if (k === "goal" || /\bgoal!|levels the score|scores|gol!|^gol\b|marca o gol/.test(t)) return { label: "Gol", x: 102, y: 34 };
    if (/red card|cartão vermelho|second yellow|segundo amarelo/.test(t + k)) return { label: "Cartão vermelho", keep: true };
    if (/yellow card|cartão amarelo/.test(t + k)) return { label: "Cartão amarelo", keep: true };
    if (/substitut|substituiç/.test(t + k)) return { label: "Substituição", keep: true };
    if (/\bvar\b/.test(t)) return { label: "Revisão do VAR", keep: true };
    if (/penalty(?! (box|area))|pênalti|penalti(?!.*área)/.test(t)) return { label: "Pênalti", x: 94, y: 34 };
    if (/goal kick|tiro de meta/.test(t + k)) return { label: "Tiro de meta", x: 6, y: 34 };
    if (/corner|escanteio/.test(t + k)) return { label: "Escanteio", x: 104, y: /right|direita/.test(t) ? 66 : 2 };
    if (/throw|lateral/.test(t + k)) return { label: "Arremesso lateral", x: own ? 32 : opp ? 74 : 52, y: side };
    if (/offside|impedimento/.test(t + k)) return { label: "Impedimento", x: 78, y: 30 };
    if (/blocked|bloquead/.test(t + k)) return { label: "Chute bloqueado", x: 86, y: 30, shot: true };
    if (/saved|defendid|defesa d/.test(t + k)) return { label: "Chute defendido", x: 98, y: 34, shot: true };
    if (/post|crossbar|trave/.test(t + k)) return { label: "Na trave", x: 102, y: 31, shot: true };
    if (/attempt|shot|miss|wide|finaliza|chute|oportunidade/.test(t + k)) return { label: "Chute para fora", x: 90, y: 22, shot: true };
    if (/free kick|falta/.test(t + k)) {
      if (/danger|close to the penalty|good position|perig|próxim/.test(t)) return { label: "Falta perigosa", x: 84, y: 26 };
      return { label: "Falta", x: own ? 30 : opp ? 68 : 52, y: 22 };
    }
    if (/danger|perig/.test(t)) return { label: "Ataque perigoso", x: 82, y: 34 };
    if (/half-time|halftime|end of the first|intervalo|fim do primeiro/.test(t)) return { label: "Intervalo", x: 52.5, y: 34, center: true };
    if (/started|kick-off|kicks off|início|começ/.test(t + k)) return { label: "Bola rolando", x: 52.5, y: 34, center: true };
    return null;
  }
  function team(m, home, away) {
    if (m.CompetitorNum === 1 || m.CompetitorNum === 2) return m.CompetitorNum;
    const t = String(m.Comment || "").toLowerCase(), h = t.lastIndexOf(home.toLowerCase()), a = t.lastIndexOf(away.toLowerCase());
    return h < 0 && a < 0 ? 0 : h > a ? 1 : 2;
  }
  // último lance com posição; cartão/substituição só troca o rótulo
  function lastPlay(msgs, g) {
    const home = g.homeCompetitor.name, away = g.awayCompetitor.name, shots = g.chartEvents?.events || [];
    let label = null;
    for (const m of msgs) {
      const p = play(m, home, away);
      if (!p) continue;
      const tm = team(m, home, away);
      if (p.keep) { label ??= { label: p.label, team: tm, min: m.Timeline }; continue; }
      let { x, y } = p;
      const sh = p.shot && shots.findLast((s) => s.competitorNum === tm && parseInt(s.time) === parseInt(m.Timeline));
      if (sh) { x = sh.side * 1.05; y = sh.line * 0.68; }
      if (tm === 2 && !p.center) { x = 105 - x; y = 68 - y; }
      return { ...(label || { label: p.label, team: p.center ? 0 : tm, min: m.Timeline }), x, y, center: p.center };
    }
    return label ? { ...label, x: 52.5, y: 34 } : null;
  }

  const pitch = (p, g) => {
    const tm = p?.team === 1 ? g.homeCompetitor : p?.team === 2 ? g.awayCompetitor : null;
    const lx = p ? Math.min(Math.max(p.x / 105 * 100, 18), 82) : 50, ly = p ? p.y / 68 * 100 : 50;
    return `<div class="trk-pitch">
      <svg viewBox="-3 -3 111 74" preserveAspectRatio="none" aria-hidden="true">
        ${Array.from({ length: 10 }, (_, i) => `<rect x="${i * 10.5}" y="0" width="10.5" height="68" fill="${i % 2 ? "#2f7d3a" : "#358a41"}"/>`).join("")}
        <g fill="none" stroke="rgba(255,255,255,.75)" stroke-width=".5">
          <rect x="0" y="0" width="105" height="68"/><line x1="52.5" y1="0" x2="52.5" y2="68"/><circle cx="52.5" cy="34" r="9.15"/>
          <rect x="0" y="13.85" width="16.5" height="40.3"/><rect x="0" y="24.85" width="5.5" height="18.3"/>
          <rect x="88.5" y="13.85" width="16.5" height="40.3"/><rect x="99.5" y="24.85" width="5.5" height="18.3"/>
          <rect x="-2" y="30.34" width="2" height="7.32"/><rect x="105" y="30.34" width="2" height="7.32"/>
          <path d="M16.5 26.7a9.15 9.15 0 0 1 0 14.6M88.5 26.7a9.15 9.15 0 0 0 0 14.6"/>
        </g>
        <circle cx="52.5" cy="34" r=".6" fill="#fff"/><circle cx="11" cy="34" r=".5" fill="#fff"/><circle cx="94" cy="34" r=".5" fill="#fff"/>
      </svg>
      <span class="trk-side l">${esc(g.homeCompetitor.name)}</span><span class="trk-side r">${esc(g.awayCompetitor.name)}</span>
      ${p ? `<i class="trk-ball" style="left:${p.x / 105 * 100}%;top:${ly}%"></i>
      <div class="trk-tip${ly < 40 ? " down" : ""}" style="left:${lx}%;top:${ly}%">
        ${tm ? `<b style="background:${esc(tm.color || "#ff4d00")}">${esc(tm.name)}</b>` : ""}<span>${esc(p.label)}${p.min ? ` · ${esc(p.min)}'` : ""}</span></div>` : `<p class="trk-wait">Aguardando lances…</p>`}
    </div>`;
  };

  function statsHtml(st, g) {
    const rows = st?.statistics || [];
    if (!rows.length) return `<p class="muted trk-empty">Estatísticas ainda não disponíveis.</p>`;
    const by = new Map();
    for (const r of rows) by.set(r.id, { ...(by.get(r.id) || { name: r.name }), [r.competitorId === g.homeCompetitor.id ? "h" : "a"]: r.value });
    const ids = STATS.filter((id) => by.has(id));
    const yc = rows.find((r) => /amarel/i.test(r.name));
    if (yc && !ids.includes(yc.id)) ids.splice(ids.length - 1, 0, yc.id);
    return ids.map((id) => {
      const s = by.get(id), h = parseFloat(s.h) || 0, a = parseFloat(s.a) || 0, tot = h + a || 1;
      return `<div class="trk-st"><div><b>${esc(s.h ?? 0)}</b><span>${esc(s.name)}</span><b>${esc(s.a ?? 0)}</b></div>
        <div class="trk-bar"><i style="width:${h / tot * 100}%;background:${esc(g.homeCompetitor.color || "#ff4d00")}"></i><i style="width:${a / tot * 100}%;background:${esc(g.awayCompetitor.color || "#1c2233")}"></i></div></div>`;
    }).join("");
  }

  function eventsHtml(g) {
    const names = new Map((g.members || []).map((m) => [m.id, m.shortName || m.name]));
    const ev = (g.events || []).slice().reverse();
    if (!ev.length) return `<p class="muted trk-empty">Nenhum lance importante ainda.</p>`;
    const ico = (n) => (/gol/i.test(n) ? "⚽" : /vermelho/i.test(n) ? "🟥" : /amarelo/i.test(n) ? "🟨" : /substitu/i.test(n) ? "🔁" : /var/i.test(n) ? "📺" : "•");
    return ev.map((e) => {
      const n = PT[e.eventType?.name] || e.eventType?.name || "", home = e.competitorId === g.homeCompetitor.id;
      const who = names.get(e.playerId) || "", min = `${e.gameTime}${e.addedTime ? "+" + e.addedTime : ""}'`;
      return `<div class="trk-ev ${home ? "h" : "a"}"><span class="trk-min">${min}</span><span>${ico(n)}</span>
        <div><b>${esc(n)}</b>${who ? `<small>${esc(who)}</small>` : ""}</div><em>${esc(home ? g.homeCompetitor.name : g.awayCompetitor.name)}</em></div>`;
    }).join("");
  }

  function clockOf(c) {
    const g = c.game, pt = g.preciseGameTime;
    if (g.statusGroup !== 3) return esc(g.statusText || "");
    if (pt?.autoProgress) {
      const s = pt.minutes * 60 + (pt.seconds || 0) + Math.floor((Date.now() - c.at) / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    return esc(g.gameTimeDisplay || g.shortStatusText || "");
  }

  function render() {
    const c = cur;
    if (!c?.el.isConnected) return;
    const body = c.el.querySelector(".trk-body");
    if (!c.game) { body.innerHTML = `<p class="muted trk-empty">${c.failed ? "Não foi possível carregar o jogo agora." : "Carregando…"}</p>`; return; }
    const g = c.game;
    RS.morph(body, `
      <div class="trk-score"><span>${esc(g.homeCompetitor.name)}</span><b>${g.homeCompetitor.score ?? 0} - ${g.awayCompetitor.score ?? 0}</b><span>${esc(g.awayCompetitor.name)}</span></div>
      <div class="trk-head"><b>Campinho</b><span data-trk-clock>${clockOf(c)}</span></div>
      ${pitch(c.play, g)}
      <div class="seg trk-tabs"><button data-trk-tab="stats" class="${c.tab === "stats" ? "active" : ""}">Estatísticas</button><button data-trk-tab="events" class="${c.tab === "events" ? "active" : ""}">Lances</button></div>
      <div class="trk-panel">${c.tab === "stats" ? statsHtml(c.stats, g) : eventsHtml(g)}</div>
      <p class="trk-src">Dados: 365Scores</p>`);
  }

  async function poll(c, withStats) {
    if (cur !== c || !c.el.isConnected || document.hidden) return;
    const d = await get(`${API}/game/?${Q}&gameId=${c.gid}`);
    if (cur !== c) return;
    if (d?.game) {
      c.game = d.game; c.at = Date.now();
      const feed = d.game.playByPlay?.feedURL;
      const [pbp, st] = await Promise.all([feed ? get(feed) : null, withStats || !c.stats ? get(`${API}/game/stats/?${Q}&games=${c.gid}`) : null]);
      if (pbp?.Messages) c.play = lastPlay(pbp.Messages, d.game) || c.play;
      if (st) c.stats = st;
    } else if (!c.game) c.failed = true;
    render();
  }

  RS.track = (m) => {
    cur?.close();
    if (!m?.ext365_id) { RS.toast("As estatísticas deste jogo ainda não estão disponíveis."); return; }
    const el = document.createElement("div");
    el.className = "trk-ov";
    el.innerHTML = `<div class="trk-sheet" role="dialog" aria-label="Acompanhar jogo">
      <div class="trk-top"><b>${esc(m.home)} x ${esc(m.away)}</b><button type="button" aria-label="Fechar">✕</button></div>
      <div class="trk-body"></div></div>`;
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
    const c = { el, gid: m.ext365_id, tab: "stats", n: 0 };
    const tick = setInterval(() => { const k = el.querySelector("[data-trk-clock]"); if (k && c.game) k.textContent = clockOf(c).replace(/&[^;]+;/g, ""); }, 1000);
    const loop = setInterval(() => poll(c, ++c.n % 3 === 0), 5000);
    c.close = () => { clearInterval(tick); clearInterval(loop); el.remove(); document.body.style.overflow = ""; if (cur === c) cur = null; };
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.closest(".trk-top button")) return c.close();
      const tb = e.target.closest("[data-trk-tab]");
      if (tb) { c.tab = tb.dataset.trkTab; render(); }
    });
    cur = c;
    render();
    poll(c, true);
  };
})();
