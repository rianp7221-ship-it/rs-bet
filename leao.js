// =====================================================
//  leao.js — Leão da Sorte (slot 3x3, 5 linhas)
//  O resultado vem do servidor (leao_spin). O navegador só anima.
// =====================================================
(() => {
  const INGOT = `<svg viewBox="0 0 64 44" aria-hidden="true"><defs><linearGradient id="lzg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c0"/><stop offset=".5" stop-color="#f5b800"/><stop offset="1" stop-color="#a86b00"/></linearGradient></defs><path d="M4 40 H60 L55 34 H9 Z" fill="#8a5600"/><path d="M15 9 Q32 1 49 9 L58 35 H6 Z" fill="url(#lzg)" stroke="#7a4a00" stroke-width="2"/><ellipse cx="32" cy="11" rx="13" ry="5" fill="#fff8d8" opacity=".75"/><path d="M14 30 H50" stroke="#c98a00" stroke-width="2"/></svg>`;
  const SYM = { W: "🦁", I: INGOT, L: "🏮", B: "💰", E: "🧧", F: "🧨", O: "🍊" };
  const PAY = { W: 250, I: 100, L: 25, B: 10, E: 8, F: 5, O: 3 };
  const POOL = "WWWWIIILLLLLBBBBBBBEEEEEEEEEFFFFFFFFFFFOOOOOOOOOOOOO";
  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 4, 8], [2, 4, 6]];
  const STEPS = [0.5, 1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];
  const reels = RS.$("#lz-reels"), lines = RS.$("#lz-lines"), msg = RS.$("#lz-msg"), winv = RS.$("#lz-winv"), spinBtn = RS.$("#lz-spin");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = () => POOL[Math.floor(Math.random() * POOL.length)];

  let steps = STEPS, bet = Number(localStorage.lzBet) || 1, bal = null, busy = false, auto = 0, enabled = true;
  let turbo = localStorage.lzTurbo === "1";

  reels.innerHTML = Array.from({ length: 9 }, () => `<div class="lz-cell"><i></i></div>`).join("");
  const setCell = (i, s, cls = "") => {
    const el = reels.children[i];
    el.className = `lz-cell s-${s} ${cls}`;
    el.innerHTML = `<i>${SYM[s]}</i>${s === "W" ? "<em>WILD</em>" : ""}`;
  };
  Array.from({ length: 9 }, rnd).forEach((s, i) => setCell(i, s));

  const showBal = () => (RS.$("#lz-bal").textContent = bal == null ? "—" : RS.money(bal));
  function showBet() {
    if (!steps.includes(bet)) bet = steps.reduce((a, b) => (Math.abs(b - bet) < Math.abs(a - bet) ? b : a), steps[0]);
    localStorage.lzBet = bet;
    RS.$("#lz-betv").textContent = RS.money(bet);
    RS.$("#lz-minus").disabled = busy || bet <= steps[0];
    RS.$("#lz-plus").disabled = busy || bet >= steps[steps.length - 1];
  }
  function ui() {
    spinBtn.classList.toggle("busy", busy);
    spinBtn.classList.toggle("auto", auto > 0);
    spinBtn.disabled = !enabled;
    RS.$("#lz-turbo").classList.toggle("on", turbo);
    const a = RS.$("#lz-auto");
    a.classList.toggle("on", auto > 0);
    a.innerHTML = auto > 0 ? `${auto}<small>PARAR</small>` : `↻<small>AUTO</small>`;
    showBet();
  }

  function clearWin() {
    lines.innerHTML = "";
    RS.$$(".lz-cell", reels).forEach((c) => c.classList.remove("win", "dim", "lock"));
    winv.textContent = RS.money(0);
    RS.$(".lz-win").classList.remove("pop");
  }

  // gira as células (menos as presas) até a resposta chegar; para coluna por coluna
  async function spinTo(next, keep = new Set()) {
    const moving = new Set([...Array(9).keys()].filter((i) => !keep.has(i)));
    const t = setInterval(() => moving.forEach((i) => setCell(i, rnd(), "blur")), 65);
    let target;
    try { [target] = await Promise.all([next, sleep(turbo ? 120 : 380)]); }
    catch (e) { clearInterval(t); throw e; }
    for (const c of [0, 1, 2]) {
      const col = [c, c + 3, c + 6].filter((i) => moving.has(i));
      if (!col.length) continue;
      await sleep(turbo ? 70 : 200);
      col.forEach((i) => { moving.delete(i); setCell(i, target[i], "land"); });
    }
    clearInterval(t);
    keep.forEach((i) => setCell(i, target[i], "lock"));
    return target;
  }

  function countUp(v) {
    const box = RS.$(".lz-win"), t0 = performance.now(), dur = v > 0 ? (turbo ? 350 : 900) : 0;
    box.classList.toggle("pop", v > 0);
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
    RS.$("#lz-bigt").textContent = m >= 100 ? "SUPER MEGA GANHO" : m >= 30 ? "MEGA GANHO" : "GRANDE GANHO";
    RS.$("#lz-bigv").textContent = RS.money(v);
    const o = RS.$("#lz-big");
    o.classList.remove("hidden");
    await Promise.race([sleep(turbo ? 1500 : 2800), new Promise((r) => (o.onclick = r))]);
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
      const o = await spinTo(req.then((r) => r.frames[0]));
      const r = await req;
      if (r.feature) {
        document.body.classList.add("roar");
        const fo = RS.$("#lz-feat");
        fo.classList.remove("hidden");
        await sleep(turbo ? 900 : 1800);
        fo.classList.add("hidden");
        msg.textContent = "Rugido do Leão! Os símbolos presos ficam até formar prêmio";
        for (let k = 1; k < r.frames.length; k++) {
          const prev = r.frames[k - 1];
          const keep = new Set(prev.map((s, i) => (s === r.symbol || s === "W" ? i : -1)).filter((i) => i >= 0));
          keep.forEach((i) => reels.children[i].classList.add("lock"));
          await sleep(turbo ? 120 : 260);
          await spinTo(Promise.resolve(r.frames[k]), keep);
        }
        document.body.classList.remove("roar");
      }
      const last = r.frames[r.frames.length - 1] || o;
      if (r.lines.length) {
        const won = new Set(r.lines.flatMap((l) => LINES[l]));
        RS.$$(".lz-cell", reels).forEach((c, i) => { c.classList.remove("lock", "land"); c.classList.add(won.has(i) ? "win" : "dim"); });
        const xy = (i) => `${50 + (i % 3) * 100},${50 + Math.floor(i / 3) * 100}`;
        lines.innerHTML = r.lines.map((l) => `<polyline points="${LINES[l].map(xy).join(" ")}"/>`).join("");
      }
      msg.textContent = r.full ? "TELA CHEIA! Prêmio multiplicado por 10x" : r.payout > 0 ? `Você ganhou ${Number(r.m).toFixed(2).replace(".", ",")}x a aposta!` : last && "Tente de novo!";
      await countUp(r.payout);
      await bigWin(Number(r.m), r.payout);
      bal = Number(r.balance); showBal();
      if (r.payout > 0) RS.refreshBalance();
    } catch (e) {
      RS.toast(e.message, "error");
      msg.textContent = e.message;
      auto = 0;
      bal = null; loadBal();
    }
    document.body.classList.remove("roar");
    busy = false;
    if (auto > 0) { auto--; ui(); if (auto > 0) { await sleep(turbo ? 250 : 600); if (auto > 0) return spin(); } }
    ui();
  }

  async function loadBal() {
    const p = await RS.profile().catch(() => null);
    bal = p ? Number(p.balance) : null;
    showBal();
    if (!p) msg.innerHTML = `<a href="login.html" style="color:#ffd76a">Entre na sua conta</a> para jogar.`;
  }

  function paytable() {
    const box = RS.$("#lz-paybox");
    const x = (s) => (PAY[s] / 5).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "x";
    box.innerHTML = `<h3>Leão da Sorte · Prêmios</h3>
      <p>3 símbolos iguais em uma das 5 linhas pagam (por linha, sobre a aposta total):</p>
      <div class="lz-paygrid">${Object.keys(PAY).map((s) => `<div><i>${SYM[s]}</i>${x(s)}</div>`).join("")}</div>
      <p><b>🦁 Coringa:</b> substitui qualquer símbolo.</p>
      <p><b>Rugido do Leão:</b> pode aparecer em qualquer giro. Um símbolo é sorteado e fica preso junto com os coringas; o resto gira de novo até formar prêmio. Se a tela inteira ficar com o símbolo e coringas, o prêmio é multiplicado por 10x.</p>
      <p>Linhas: as 3 horizontais e as 2 diagonais. Prêmio máximo: 2.500x a aposta.</p>
      <p id="lz-rtp"></p>
      <button type="button">Voltar ao jogo</button>`;
    if (window.lzRtp) RS.$("#lz-rtp").textContent = `RTP (retorno ao jogador): ${window.lzRtp}%.`;
    const o = RS.$("#lz-pay");
    o.classList.remove("hidden");
    o.onclick = (e) => { if (e.target === o || e.target.tagName === "BUTTON") o.classList.add("hidden"); };
  }

  spinBtn.onclick = () => { if (auto > 0) { auto = 0; ui(); return; } spin(); };
  RS.$("#lz-minus").onclick = () => { bet = steps[Math.max(0, steps.indexOf(bet) - 1)]; showBet(); };
  RS.$("#lz-plus").onclick = () => { bet = steps[Math.min(steps.length - 1, steps.indexOf(bet) + 1)]; showBet(); };
  RS.$("#lz-turbo").onclick = () => { turbo = !turbo; localStorage.lzTurbo = turbo ? "1" : "0"; ui(); };
  RS.$("#lz-auto").onclick = () => { if (auto > 0) auto = 0; else { auto = 10; if (!busy) spin(); } ui(); };
  RS.$("#lz-info").onclick = paytable;
  document.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); spin(); } });

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
