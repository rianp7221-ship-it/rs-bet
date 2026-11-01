// =====================================================
//  leao.js — Leão da Sorte (slot 3x3, 5 linhas)
//  O resultado vem do servidor (leao_spin). O navegador só anima.
// =====================================================
(() => {
  const KEYS = ["W", "I", "L", "B", "E", "F", "O"];
  const IMG = (s) => `assets/leao/${s.toLowerCase()}.webp`;
  const PAY = { W: 250, I: 100, L: 25, B: 10, E: 8, F: 5, O: 3 };
  const POOL = "WWWWIIILLLLLBBBBBBBEEEEEEEEEFFFFFFFFFFFOOOOOOOOOOOOO";
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 4, 8], [2, 4, 6]];
  const STEPS = [0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];
  const CHEERS = ["Que sorte!", "Rugiu alto!", "É ouro!", "Boa, campeão!", "Mais um!"];
  const $ = RS.$, reels = $("#lz-reels"), lines = $("#lz-lines"), msg = $("#lz-msg"), winv = $("#lz-winv"), spinBtn = $("#lz-spin"), hero = $("#lz-hero");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = () => POOL[Math.floor(Math.random() * POOL.length)];
  const sy = (s) => `<div class="lz-sy"><img src="${IMG(s)}" alt="">${s === "W" ? "<em>WILD</em>" : ""}</div>`;

  let steps = STEPS, bet = Number(localStorage.lzBet) || 1, bal = null, busy = false, auto = 0, enabled = true;
  let turbo = localStorage.lzTurbo === "1", muted = localStorage.lzMute === "1";
  let cur = Array.from({ length: 9 }, rnd);

  // ---------- som (sintetizado, sem arquivos) ----------
  let ac;
  const A = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
  function tone(f, t0, d, type = "sine", v = 0.15, f2) {
    const a = A(), t = a.currentTime + t0, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.05);
  }
  function noise(d, v, freq) {
    const a = A(), b = a.createBuffer(1, a.sampleRate * d, a.sampleRate), ch = b.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = b; f.type = "lowpass"; f.frequency.value = freq; g.gain.value = v;
    s.connect(f).connect(g).connect(a.destination); s.start();
  }
  const SND = {
    tick: () => tone(1500, 0, 0.025, "square", 0.02),
    stop: () => { tone(170, 0, 0.13, "triangle", 0.28, 80); noise(0.06, 0.15, 900); },
    lock: () => tone(1100, 0, 0.14, "sine", 0.1, 1900),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.25, "triangle", 0.13)),
    big: () => [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.11, 0.4, "triangle", 0.15)),
    coin: () => tone(1900 + Math.random() * 900, 0, 0.07, "sine", 0.05),
    roar: () => { noise(1.1, 0.5, 500); tone(200, 0, 1, "sawtooth", 0.18, 55); tone(150, 0.05, 0.9, "sawtooth", 0.12, 45); },
    full: () => [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, i * 0.07, 0.5, "square", 0.07)),
  };
  const play = (k) => { if (!muted) try { SND[k](); } catch { /* sem áudio */ } };

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
  const fit = () => reels.style.setProperty("--ch", `${cells[0].clientHeight}px`);
  new ResizeObserver(fit).observe(reels);
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
    try { [target] = await Promise.all([next, sleep(turbo ? 150 : slow ? 500 : 420)]); }
    catch (e) { clearInterval(tick); cur.forEach((s, i) => setStatic(i, s)); throw e; }
    const dur = turbo ? 220 : 420;
    for (const c of [0, 1, 2]) {
      const col = [c, c + 3, c + 6].filter((i) => moving.includes(i));
      if (!col.length) continue;
      col.forEach((i) => stopCell(i, target[i], dur));
      await sleep(dur * 0.55);
      play("stop");
      if (c < 2) await sleep(turbo ? 40 : slow ? 260 : 120);
    }
    clearInterval(tick);
    await sleep(dur * 0.5);
    target.forEach((s, i) => { if (!keep.has(i)) setStatic(i, s); });
    cur = target.slice();
  }

  // ---------- interface ----------
  const showBal = () => ($("#lz-bal").textContent = bal == null ? "—" : RS.money(bal));
  function showBet() {
    if (!steps.includes(bet)) bet = steps.reduce((a, b) => (Math.abs(b - bet) < Math.abs(a - bet) ? b : a), steps[0]);
    localStorage.lzBet = bet;
    $("#lz-betv").textContent = RS.money(bet);
    $("#lz-minus").disabled = busy || auto > 0 || bet <= steps[0];
    $("#lz-plus").disabled = busy || auto > 0 || bet >= steps[steps.length - 1];
  }
  function ui() {
    spinBtn.classList.toggle("busy", busy);
    spinBtn.classList.toggle("auto", auto > 0);
    spinBtn.dataset.n = auto;
    spinBtn.disabled = !enabled;
    $("#lz-turbo").classList.toggle("on", turbo);
    $("#lz-snd").textContent = muted ? "🔇" : "🔊";
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
  function clearWin() {
    lines.innerHTML = "";
    $("#lz-linewin").classList.add("hidden");
    cells.forEach((c) => c.classList.remove("win", "dim", "lock"));
    RS.$$(".lz-nums b").forEach((b) => b.classList.remove("on"));
    winv.textContent = RS.money(0);
    $("#lz-wbox").classList.remove("pop");
    hero.classList.remove("cheer", "roar");
  }
  const xy = (i) => `${50 + (i % 3) * 100},${50 + Math.floor(i / 3) * 100}`;
  const lineSym = (g, l) => LINES[l].map((i) => g[i]).find((s) => s !== "W") || "W";
  function showLines(ls, g) {
    const won = new Set(ls.flatMap((l) => LINES[l]));
    cells.forEach((c, i) => { c.classList.remove("lock"); c.classList.toggle("win", won.has(i)); c.classList.toggle("dim", !won.has(i)); });
    lines.innerHTML = ls.map((l) => `<polyline points="${LINES[l].map(xy).join(" ")}"/>`).join("");
    RS.$$(".lz-nums b").forEach((b) => b.classList.toggle("on", ls.includes(Number(b.textContent) - 1)));
  }
  async function presentLines(r, g) {
    showLines(r.lines, g);
    if (turbo || r.lines.length < 2) {
      if (r.lines.length === 1) lineLabel(r.lines[0], g, r.full);
      return;
    }
    for (const l of r.lines) { showLines([l], g); lineLabel(l, g, r.full); play("coin"); await sleep(650); }
    showLines(r.lines, g);
    $("#lz-linewin").classList.add("hidden");
  }
  function lineLabel(l, g, full) {
    const el = $("#lz-linewin");
    const v = (bet * PAY[lineSym(g, l)]) / 5 * (full ? 10 : 1);
    el.textContent = `Linha ${l + 1} · ${RS.money(v)}`;
    el.classList.remove("hidden"); el.style.animation = "none"; void el.offsetHeight; el.style.animation = "";
  }
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
  async function bigWin(m, v) {
    if (m < 10) return;
    $("#lz-bigt").textContent = m >= 100 ? "SUPER MEGA GANHO" : m >= 30 ? "MEGA GANHO" : "GRANDE GANHO";
    const o = $("#lz-big"), b = $("#lz-bigv");
    o.classList.remove("hidden");
    play("big"); rain(m >= 30 ? 160 : 90, true);
    const coin = setInterval(() => play("coin"), 110);
    let skip = false; o.onclick = () => (skip = true);
    const t0 = performance.now(), dur = turbo ? 900 : 2200;
    while (!skip && performance.now() - t0 < dur) { b.textContent = RS.money((v * (performance.now() - t0)) / dur); await sleep(30); }
    clearInterval(coin);
    b.textContent = RS.money(v);
    if (!skip) await Promise.race([sleep(turbo ? 700 : 1600), new Promise((r) => (o.onclick = r))]);
    o.classList.add("hidden");
  }

  async function spin() {
    if (busy || !enabled) return;
    if (!(await RS.user())) { location.href = "login.html"; return; }
    if (bal != null && bal < bet) { RS.toast("Saldo insuficiente", "error"); auto = 0; ui(); return; }
    busy = true; clearWin(); ui();
    msg.textContent = "Boa sorte!";
    if (bal != null) { bal -= bet; showBal(); }
    const req = RS.rpc("leao_spin", { p_stake: bet });
    try {
      await spinRound(req.then((r) => r.frames[0]));
      const r = await req;
      if (r.feature) {
        document.body.classList.add("roar"); hero.classList.add("roar");
        play("roar");
        const fo = $("#lz-feat");
        fo.classList.remove("hidden");
        await sleep(turbo ? 900 : 2000);
        fo.classList.add("hidden");
        msg.textContent = "Rugido do Leão! Símbolos presos até formar prêmio";
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
        document.body.classList.remove("roar"); hero.classList.remove("roar");
      }
      const g = r.frames.at(-1);
      const m = Number(r.m);
      if (r.payout > 0) {
        hero.classList.add("cheer");
        bubble(r.full ? "TELA CHEIA!" : CHEERS[Math.floor(Math.random() * CHEERS.length)]);
        play(r.full ? "full" : "win");
        if (m >= 2) rain(Math.min(60, 12 + m * 3), false);
        msg.textContent = r.full ? "TELA CHEIA! Prêmio multiplicado por 10x" : `Você ganhou ${m.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x a aposta!`;
        const lp = presentLines(r, g);
        await countUp(r.payout, turbo ? 300 : 800);
        await bigWin(m, r.payout);
        await lp;
      } else msg.textContent = "Tente de novo!";
      bal = Number(r.balance); showBal();
      if (r.payout > 0) RS.refreshBalance?.();
    } catch (e) {
      RS.toast(e.message, "error");
      msg.textContent = e.message;
      auto = 0;
      bal = null; loadBal();
    }
    document.body.classList.remove("roar");
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

  function modal(id) {
    const o = $(id);
    o.classList.remove("hidden");
    o.onclick = (e) => { if (e.target === o || e.target.classList.contains("lz-close")) o.classList.add("hidden"); };
    return o;
  }
  function paytable() {
    const x = (s) => (PAY[s] / 5).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "x";
    $("#lz-paybox").innerHTML = `<h3>Leão da Sorte · Prêmios</h3>
      <p>3 símbolos iguais em uma das 5 linhas pagam (por linha, sobre a aposta total):</p>
      <div class="lz-paygrid">${KEYS.map((s) => `<div><img src="${IMG(s)}" alt="">${x(s)}</div>`).join("")}</div>
      <p><b>Coringa (Leão):</b> substitui qualquer símbolo.</p>
      <p><b>Rugido do Leão:</b> pode acontecer em qualquer giro. Um símbolo é sorteado e fica preso junto com os coringas; o resto gira de novo até formar prêmio. Tela inteira com o símbolo e coringas multiplica o prêmio por 10x.</p>
      <p>Linhas: 1 a 3 horizontais, 4 e 5 diagonais. Prêmio máximo: 2.500x a aposta.</p>
      ${window.lzRtp ? `<p>RTP (retorno ao jogador): ${window.lzRtp}%.</p>` : ""}
      <button type="button" class="lz-close">Voltar ao jogo</button>`;
    modal("#lz-pay");
  }

  spinBtn.onclick = () => { if (auto > 0) { auto = 0; ui(); return; } spin(); };
  $("#lz-minus").onclick = () => { bet = steps[Math.max(0, steps.indexOf(bet) - 1)]; showBet(); };
  $("#lz-plus").onclick = () => { bet = steps[Math.min(steps.length - 1, steps.indexOf(bet) + 1)]; showBet(); };
  $("#lz-turbo").onclick = () => { turbo = !turbo; localStorage.lzTurbo = turbo ? "1" : "0"; ui(); };
  $("#lz-snd").onclick = () => { muted = !muted; localStorage.lzMute = muted ? "1" : "0"; ui(); };
  $("#lz-auto").onclick = () => { if (auto > 0) { auto = 0; ui(); } else modal("#lz-auto-pick"); };
  RS.$$(".lz-autos button").forEach((b) => (b.onclick = () => {
    $("#lz-auto-pick").classList.add("hidden");
    auto = Number(b.textContent); ui();
    if (!busy) spin();
  }));
  $("#lz-info").onclick = paytable;
  document.addEventListener("keydown", (e) => { if (e.code === "Space" && $("#lz-splash").classList.contains("hidden")) { e.preventDefault(); spin(); } });

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
    try { A().resume(); } catch { /* sem áudio */ }
    $("#lz-splash").classList.add("hidden");
    fit();
    play("win");
  };

  sb.rpc("casino_lobby").then(({ data }) => {
    const g = (data || []).find((x) => x.id === "leao");
    if (!g) { enabled = false; msg.textContent = "Este jogo está temporariamente indisponível."; ui(); return; }
    window.lzRtp = g.rtp;
    steps = STEPS.filter((s) => s >= Number(g.min) && s <= Number(g.max));
    if (!steps.length) steps = [Number(g.min)];
    ui();
  });
  loadBal();
  ui();
})();
