// =====================================================
//  leao.js — Leão da Sorte (slot 3x3, 5 linhas)
//  O resultado vem do servidor (leao_spin). O navegador só anima.
//  Som e música: leao-audio.js
// =====================================================
(() => {
  // ---------- regras / constantes ----------
  const KEYS = ["W", "I", "L", "B", "E", "F", "O"];
  const IMG = (s) => `assets/leao/${s.toLowerCase()}.webp`;
  const PAY = { W: 250, I: 100, L: 25, B: 10, E: 8, F: 5, O: 3 };
  const POOL = "WWWWIIILLLLLBBBBBBBEEEEEEEEEFFFFFFFFFFFOOOOOOOOOOOOO";
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 4, 8], [2, 4, 6]];
  const STEPS = [0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];
  const TIERS = [[10, "GRANDE GANHO"], [30, "MEGA GANHO"], [100, "SUPER MEGA GANHO"]];
  const CHEERS = ["Que sorte!", "Rugiu alto!", "É ouro!", "Boa, campeão!", "Mais um!"];

  const $ = RS.$, $$ = RS.$$, SFX = window.LeaoAudio;
  const stage = $("#lz-stage"), frame = $("#lz-frame"), reels = $("#lz-reels"), lines = $("#lz-lines");
  const msg = $("#lz-msg"), winv = $("#lz-winv"), spinBtn = $("#lz-spin"), hero = $("#lz-hero");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = () => POOL[Math.floor(Math.random() * POOL.length)];
  const sy = (s) => `<div class="lz-sy"><img src="${IMG(s)}" alt="">${s === "W" ? "<em>WILD</em>" : ""}</div>`;
  const play = (k) => SFX.fx(k);
  const mult = (m) => m.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  // ---------- estado ----------
  let steps = STEPS, bet = Number(localStorage.lzBet) || 1, bal = null, busy = false, auto = 0, enabled = true, slam = false;
  let turbo = localStorage.lzTurbo === "1";
  let cur = Array.from({ length: 9 }, rnd);
  // espera interrompível pelo "parar rápido" (toque no girar durante o giro)
  const nap = async (ms) => { const t = performance.now(); while (!slam && performance.now() - t < ms) await sleep(25); };

  // ---------- layout: banner e grade cabem na altura da tela ----------
  function layout() {
    const H = stage.clientHeight, W = stage.clientWidth - 40, rest = 52;
    let hh = Math.max(72, Math.min(200, H * 0.27));
    let fs = Math.min(W, 400, H - hh - rest);
    if (fs < 240) { hh = Math.max(60, H - rest - 240); fs = Math.min(W, 400, H - hh - rest); }
    stage.style.setProperty("--hh", `${Math.round(hh)}px`);
    frame.style.setProperty("--fs", `${Math.round(Math.max(170, fs))}px`);
  }
  new ResizeObserver(layout).observe(stage);

  // ---------- moedas ----------
  const cv = $("#lz-coins"), cx = cv.getContext("2d");
  let coins = [], coinRaf = 0;
  function rain(n, burst) {
    const dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < n; i++) {
      coins.push(burst
        ? { x: innerWidth / 2, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 16 - 6, r: 9 + Math.random() * 9, a: Math.random() * 6, va: 0.2 + Math.random() * 0.3, d: Math.random() * 20 }
        : { x: Math.random() * innerWidth, y: -30 - Math.random() * innerHeight * 0.8, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 4, r: 9 + Math.random() * 9, a: Math.random() * 6, va: 0.15 + Math.random() * 0.3, d: 0 });
    }
    if (!coinRaf) coinRaf = requestAnimationFrame(drawCoins);
  }
  function drawCoins() {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    coins = coins.filter((c) => c.y < innerHeight + 40);
    coins.forEach((c) => {
      if (c.d > 0) { c.d--; return; }
      c.vy += 0.35; c.x += c.vx; c.y += c.vy; c.a += c.va;
      const w = Math.abs(Math.cos(c.a)) * c.r + 1;
      const g = cx.createRadialGradient(c.x - w * 0.3, c.y - c.r * 0.3, 1, c.x, c.y, c.r);
      g.addColorStop(0, "#fff6c0"); g.addColorStop(0.5, "#f5b800"); g.addColorStop(1, "#9c6400");
      cx.fillStyle = g; cx.beginPath(); cx.ellipse(c.x, c.y, w, c.r, 0, 0, 7); cx.fill();
      cx.strokeStyle = "#7a4a00"; cx.lineWidth = 1.5; cx.stroke();
      cx.fillStyle = "#8a5600"; cx.fillRect(c.x - w * 0.25, c.y - c.r * 0.25, w * 0.5, c.r * 0.5);
    });
    coinRaf = coins.length ? requestAnimationFrame(drawCoins) : 0;
    if (!coinRaf) cx.clearRect(0, 0, innerWidth, innerHeight);
  }

  // ---------- rolos ----------
  reels.innerHTML = Array.from({ length: 9 }, () => `<div class="lz-cell"><div class="lz-strip"></div></div>`).join("");
  const cells = [...reels.children], strip = (i) => cells[i].firstElementChild;
  const fitCells = () => reels.style.setProperty("--ch", `${cells[0].clientHeight}px`);
  new ResizeObserver(fitCells).observe(reels);
  const setStatic = (i, s) => {
    const st = strip(i);
    cells[i].classList.remove("loop");
    st.style.transition = "none"; st.style.transform = "none"; st.innerHTML = sy(s);
  };
  cur.forEach((s, i) => setStatic(i, s));
  const startLoop = (i) => {
    const r = Array.from({ length: 8 }, rnd);
    strip(i).style.transition = "none"; strip(i).style.transform = "";
    strip(i).innerHTML = [...r, ...r].map(sy).join("");
    cells[i].classList.add("loop");
  };
  function stopCell(i, s, dur) {
    const st = strip(i), ch = cells[i].clientHeight, n = 4;
    cells[i].classList.remove("loop");
    st.innerHTML = [s, ...Array.from({ length: n }, rnd)].map(sy).join("");
    st.style.transition = "none"; st.style.transform = `translateY(${-n * ch}px)`;
    void st.offsetHeight;
    st.style.transition = `transform ${dur}ms cubic-bezier(.2,.9,.35,1.18)`;
    st.style.transform = "translateY(0)";
  }

  // gira as células (menos as presas) até o resultado chegar; para coluna por coluna
  async function spinRound(next, keep = new Set(), slow = false) {
    const moving = [...Array(9).keys()].filter((i) => !keep.has(i));
    moving.forEach(startLoop);
    const tick = setInterval(() => play("tick"), 90);
    let target;
    try { [target] = await Promise.all([next, nap(turbo ? 150 : slow ? 500 : 420)]); }
    catch (e) { clearInterval(tick); cur.forEach((s, i) => setStatic(i, s)); throw e; }
    const dur = () => (turbo || slam ? 200 : 420);
    const left = new Set(moving);
    for (const c of [0, 1, 2]) {
      const col = slam ? [...left] : [c, c + 3, c + 6].filter((i) => left.has(i));
      if (!col.length) continue;
      const hard = slam;
      col.forEach((i) => { stopCell(i, target[i], dur()); left.delete(i); });
      await nap(dur() * 0.55);
      play(hard ? "slam" : "stop");
      if (!left.size) break;
      await nap(turbo ? 40 : slow ? 260 : 120);
    }
    clearInterval(tick);
    await sleep(dur() * 0.5);
    target.forEach((s, i) => { if (!keep.has(i)) setStatic(i, s); });
    cur = target.slice();
  }

  // ---------- interface ----------
  const showBal = () => ($("#lz-bal").textContent = bal == null ? "—" : RS.money(bal));
  function showBet() {
    if (!steps.includes(bet)) bet = steps.reduce((a, b) => (Math.abs(b - bet) < Math.abs(a - bet) ? b : a), steps[0]);
    localStorage.lzBet = bet;
    $("#lz-betv").textContent = RS.money(bet);
    const lock = busy || auto > 0;
    $("#lz-minus").disabled = lock || bet <= steps[0];
    $("#lz-plus").disabled = lock || bet >= steps[steps.length - 1];
    $("#lz-betbox").disabled = lock;
  }
  function ui() {
    spinBtn.classList.toggle("busy", busy);
    spinBtn.classList.toggle("auto", auto > 0);
    spinBtn.dataset.n = auto;
    spinBtn.disabled = !enabled;
    $("#lz-turbo").classList.toggle("on", turbo);
    $("#lz-snd").textContent = SFX.fxOn ? "🔊" : "🔇";
    $("#lz-mus").classList.toggle("off", !SFX.musOn);
    $("#lz-m-mus").checked = SFX.musOn;
    $("#lz-m-snd").checked = SFX.fxOn;
    $("#lz-m-turbo").checked = turbo;
    const a = $("#lz-auto");
    a.classList.toggle("on", auto > 0);
    a.innerHTML = auto > 0 ? `■<small>PARAR</small>` : `↻<small>AUTO</small>`;
    showBet();
  }
  function bubble(t) {
    const b = $("#lz-bubble");
    b.textContent = t; b.classList.remove("hidden");
    clearTimeout(bubble.t); bubble.t = setTimeout(() => b.classList.add("hidden"), 1800);
  }
  function say(t, big = false) {
    msg.textContent = t;
    msg.classList.toggle("big", big);
  }
  function clearWin() {
    lines.innerHTML = "";
    $("#lz-linewin").classList.add("hidden");
    cells.forEach((c) => c.classList.remove("win", "dim", "lock"));
    $$(".lz-nums b").forEach((b) => b.classList.remove("on"));
    winv.textContent = RS.money(0);
    $("#lz-wbox").classList.remove("pop");
    hero.classList.remove("cheer", "roar");
  }

  // ---------- linhas vencedoras ----------
  const xy = (i) => `${50 + (i % 3) * 100},${50 + Math.floor(i / 3) * 100}`;
  const lineSym = (g, l) => LINES[l].map((i) => g[i]).find((s) => s !== "W") || "W";
  function showLines(ls) {
    const won = new Set(ls.flatMap((l) => LINES[l]));
    cells.forEach((c, i) => { c.classList.remove("lock"); c.classList.toggle("win", won.has(i)); c.classList.toggle("dim", !won.has(i)); });
    lines.innerHTML = ls.map((l) => `<polyline points="${LINES[l].map(xy).join(" ")}"/>`).join("");
    $$(".lz-nums b").forEach((b) => b.classList.toggle("on", ls.includes(Number(b.textContent) - 1)));
  }
  function lineLabel(l, g, full) {
    const el = $("#lz-linewin");
    const v = (bet * PAY[lineSym(g, l)]) / 5 * (full ? 10 : 1);
    el.textContent = `Linha ${l + 1} · ${RS.money(v)}`;
    el.classList.remove("hidden"); el.style.animation = "none"; void el.offsetHeight; el.style.animation = "";
  }
  async function presentLines(r, g) {
    showLines(r.lines);
    if (turbo || r.lines.length < 2) {
      if (r.lines.length === 1) lineLabel(r.lines[0], g, r.full);
      return;
    }
    for (const l of r.lines) { showLines([l]); lineLabel(l, g, r.full); play("coin"); await sleep(650); }
    showLines(r.lines);
    $("#lz-linewin").classList.add("hidden");
  }

  // ---------- prêmio ----------
  function countUp(v, dur) {
    const t0 = performance.now();
    $("#lz-wbox").classList.toggle("pop", v > 0);
    return new Promise((res) => {
      const f = (now) => {
        const k = dur ? Math.min(1, (now - t0) / dur) : 1;
        winv.textContent = RS.money(v * k);
        k < 1 ? requestAnimationFrame(f) : res();
      };
      requestAnimationFrame(f);
    });
  }
  // grande ganho: o contador sobe e a faixa escala (Grande → Mega → Super Mega)
  async function bigWin(m, v) {
    const reach = TIERS.filter(([x]) => m >= x).length;
    if (!reach) return;
    const o = $("#lz-big"), box = o.firstElementChild, t = $("#lz-bigt"), b = $("#lz-bigv");
    let tier = 0;
    const setTier = (k) => {
      tier = k; box.className = `lz-big t${k}`;
      t.textContent = TIERS[k - 1][1];
      t.classList.remove("tier"); void t.offsetWidth; t.classList.add("tier");
      if (k > 1) { play("tier"); rain(70, true); }
    };
    o.classList.remove("hidden");
    SFX.duck(true);
    setTier(1); play("big"); rain(reach > 1 ? 120 : 90, true);
    const coin = setInterval(() => play("coin"), 110);
    let skip = false; o.onclick = () => (skip = true);
    const t0 = performance.now(), dur = (turbo ? 700 : 1700) * reach;
    while (!skip && performance.now() - t0 < dur) {
      const k = (performance.now() - t0) / dur;
      b.textContent = RS.money(v * k);
      const want = TIERS.filter(([x]) => m * k >= x).length;
      if (want > tier) setTier(want);
      await sleep(30);
    }
    clearInterval(coin);
    if (tier < reach) setTier(reach);
    b.textContent = RS.money(v);
    if (!skip) await Promise.race([sleep(turbo ? 800 : 1800), new Promise((r) => (o.onclick = r))]);
    o.classList.add("hidden");
    SFX.duck(false);
  }

  // ---------- rodada bônus ----------
  async function roar(r) {
    document.body.classList.add("roar"); hero.classList.add("roar"); frame.classList.add("feat");
    $("#lz-ftag").classList.remove("hidden");
    SFX.mode("feat"); play("roar"); play("gong");
    const fo = $("#lz-feat");
    fo.classList.remove("hidden");
    await sleep(turbo ? 900 : 2000);
    fo.classList.add("hidden");
    say("Símbolos presos até formar prêmio");
    for (let k = 1; k < r.frames.length; k++) {
      const prev = r.frames[k - 1];
      const keep = new Set(prev.map((s, i) => (s === r.symbol || s === "W" ? i : -1)).filter((i) => i >= 0));
      keep.forEach((i) => cells[i].classList.add("lock"));
      play("lock");
      await sleep(turbo ? 120 : 300);
      await spinRound(Promise.resolve(r.frames[k]), keep, true);
    }
    r.frames.at(-1).forEach((s, i) => { if (s === r.symbol || s === "W") cells[i].classList.add("lock"); });
    await sleep(turbo ? 150 : 400);
    endRoar();
  }
  function endRoar() {
    document.body.classList.remove("roar"); hero.classList.remove("roar"); frame.classList.remove("feat");
    $("#lz-ftag").classList.add("hidden");
    SFX.mode("base");
  }

  // ---------- giro ----------
  async function spin() {
    if (busy || !enabled) return;
    if (!(await RS.user())) { location.href = "login.html"; return; }
    if (bal != null && bal < bet) { RS.toast("Saldo insuficiente", "error"); auto = 0; ui(); return; }
    busy = true; slam = false; clearWin(); ui();
    say("Boa sorte!");
    if (bal != null) { bal -= bet; showBal(); }
    const req = RS.rpc("leao_spin", { p_stake: bet });
    try {
      await spinRound(req.then((r) => r.frames[0]));
      const r = await req;
      slam = false;
      if (r.feature) await roar(r);
      const g = r.frames.at(-1), m = Number(r.m);
      if (r.payout > 0) {
        hero.classList.add("cheer");
        bubble(r.full ? "TELA CHEIA!" : CHEERS[Math.floor(Math.random() * CHEERS.length)]);
        play(r.full ? "full" : "win");
        if (m >= 2) rain(Math.min(60, 12 + m * 3), false);
        say(r.full ? `TELA CHEIA! ${mult(m)}x · ${RS.money(r.payout)}` : `Ganhou ${RS.money(r.payout)} · ${mult(m)}x`, true);
        const lp = presentLines(r, g);
        await countUp(r.payout, turbo ? 300 : 800);
        await bigWin(m, r.payout);
        await lp;
      } else say("Tente de novo!");
      bal = Number(r.balance); showBal();
      if (r.payout > 0) RS.refreshBalance?.();
    } catch (e) {
      endRoar();
      RS.toast(e.message, "error");
      say(e.message);
      auto = 0;
      bal = null; loadBal();
    }
    busy = false;
    if (auto > 0) { auto--; ui(); if (auto > 0) { await sleep(turbo ? 250 : 700); if (auto > 0) return spin(); } }
    ui();
  }

  async function loadBal() {
    const p = await RS.profile().catch(() => null);
    bal = p ? Number(p.balance) : null;
    showBal();
    if (!p) msg.innerHTML = `<a href="login.html" style="color:#ffd76a">Entre na sua conta</a> para jogar.`;
  }

  // ---------- janelas ----------
  function modal(id) {
    const o = $(id);
    o.classList.remove("hidden");
    o.onclick = (e) => { if (e.target === o || e.target.classList.contains("lz-close")) o.classList.add("hidden"); };
    return o;
  }
  const closeMenu = () => $("#lz-menu-o").classList.add("hidden");
  function paytable() {
    const x = (s) => mult(PAY[s] / 5) + "x";
    $("#lz-paybox").innerHTML = `<h3>Leão da Sorte · Prêmios</h3>
      <p>3 símbolos iguais em uma das 5 linhas pagam (por linha, sobre a aposta total):</p>
      <div class="lz-paygrid">${KEYS.map((s) => `<div><img src="${IMG(s)}" alt="">${x(s)}</div>`).join("")}</div>
      <p><b>Coringa (Leão):</b> substitui qualquer símbolo.</p>
      <p><b>Rugido do Leão:</b> pode acontecer em qualquer giro. Um símbolo é sorteado e fica preso junto com os coringas; o resto gira de novo até formar prêmio. Tela inteira com o símbolo e coringas multiplica o prêmio por 10x.</p>
      <p>Linhas: 1 a 3 horizontais, 4 e 5 diagonais. Prêmio máximo: 2.500x a aposta.</p>
      <p>Toque no botão girar durante o giro para parar os rolos na hora.</p>
      ${window.lzRtp ? `<p>RTP (retorno ao jogador): ${window.lzRtp}%.</p>` : ""}
      <button type="button" class="lz-close">Voltar ao jogo</button>`;
    modal("#lz-pay");
  }
  async function history() {
    const box = $("#lz-histl");
    box.innerHTML = "<p>Carregando…</p>";
    modal("#lz-hist");
    if (!(await RS.user())) { box.innerHTML = `<p>Entre na sua conta para ver seus giros.</p>`; return; }
    const { data, error } = await sb.from("casino_games").select("id,stake,multiplier,payout,created_at")
      .eq("game", "leao").order("created_at", { ascending: false }).limit(30);
    if (error) { box.innerHTML = `<p>${error.message}</p>`; return; }
    if (!data.length) { box.innerHTML = "<p>Nenhum giro ainda.</p>"; return; }
    box.innerHTML = data.map((g) => {
      const d = new Date(g.created_at), p = Number(g.payout);
      return `<div><small>${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>
        <span>${RS.money(g.stake)}</span><b class="${p > 0 ? "w" : ""}">${p > 0 ? `+${RS.money(p)}` : "—"}</b></div>`;
    }).join("");
  }
  function betPicker() {
    $("#lz-bets").innerHTML = steps.map((s) => `<button class="${s === bet ? "on" : ""}" data-v="${s}">${RS.money(s)}</button>`).join("");
    $$("#lz-bets button").forEach((b) => (b.onclick = () => { bet = Number(b.dataset.v); play("click"); showBet(); $("#lz-bet-pick").classList.add("hidden"); }));
    modal("#lz-bet-pick");
  }

  // ---------- controles ----------
  spinBtn.onclick = () => {
    if (auto > 0) { auto = 0; ui(); return; }
    if (busy) { slam = true; return; }
    spin();
  };
  $("#lz-minus").onclick = () => { bet = steps[Math.max(0, steps.indexOf(bet) - 1)]; play("click"); showBet(); };
  $("#lz-plus").onclick = () => { bet = steps[Math.min(steps.length - 1, steps.indexOf(bet) + 1)]; play("click"); showBet(); };
  $("#lz-betbox").onclick = betPicker;
  const setTurbo = (v) => { turbo = v; localStorage.lzTurbo = v ? "1" : "0"; ui(); };
  $("#lz-turbo").onclick = () => setTurbo(!turbo);
  $("#lz-snd").onclick = () => { SFX.setFx(!SFX.fxOn); ui(); };
  $("#lz-mus").onclick = () => { SFX.setMusic(!SFX.musOn); ui(); };
  $("#lz-auto").onclick = () => { if (auto > 0) { auto = 0; ui(); } else modal("#lz-auto-pick"); };
  $$(".lz-autos button").forEach((b) => (b.onclick = () => {
    $("#lz-auto-pick").classList.add("hidden");
    auto = Number(b.textContent); ui();
    if (!busy) spin();
  }));
  $("#lz-menu").onclick = () => modal("#lz-menu-o");
  $("#lz-m-pay").onclick = () => { closeMenu(); paytable(); };
  $("#lz-m-hist").onclick = () => { closeMenu(); history(); };
  $("#lz-m-mus").onchange = (e) => { SFX.setMusic(e.target.checked); ui(); };
  $("#lz-m-snd").onchange = (e) => { SFX.setFx(e.target.checked); ui(); };
  $("#lz-m-turbo").onchange = (e) => setTurbo(e.target.checked);
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !$("#lz-splash").classList.contains("hidden")) return;
    e.preventDefault(); spinBtn.click();
  });

  // ---------- abertura: carrega as imagens e libera o som no toque ----------
  const assets = [...KEYS.map(IMG), "assets/leao/hero.webp", "assets/leao/bg.webp"];
  let loaded = 0;
  Promise.all(assets.map((src) => new Promise((res) => {
    const im = new Image(); im.onload = im.onerror = () => { loaded++; $("#lz-loadbar").style.width = `${(loaded / assets.length) * 100}%`; res(); }; im.src = src;
  }))).then(() => {
    $(".lz-load").classList.add("hidden");
    $("#lz-start").classList.remove("hidden");
  });
  $("#lz-start").onclick = () => {
    SFX.unlock();
    $("#lz-splash").classList.add("hidden");
    layout(); fitCells();
    setTimeout(() => play("win"), 60);
  };

  sb.rpc("casino_lobby").then(({ data }) => {
    const g = (data || []).find((x) => x.id === "leao");
    if (!g) { enabled = false; say("Este jogo está temporariamente indisponível."); ui(); return; }
    window.lzRtp = g.rtp;
    steps = STEPS.filter((s) => s >= Number(g.min) && s <= Number(g.max));
    if (!steps.length) steps = [Number(g.min)];
    ui();
  });
  layout();
  loadBal();
  ui();
})();
