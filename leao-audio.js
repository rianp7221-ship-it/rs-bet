// =====================================================
//  leao-audio.js — som do Leão da Sorte (WebAudio, sem arquivos)
//  Efeitos e trilha de fundo sintetizados; música e efeitos têm liga/desliga próprios.
// =====================================================
window.LeaoAudio = (() => {
  let ac, fxBus, musBus, noiseBuf;
  let fxOn = localStorage.lzMute !== "1", musOn = localStorage.lzMusic !== "0";
  const ctx = () => {
    if (ac) return ac;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    fxBus = ac.createGain(); fxBus.gain.value = 1; fxBus.connect(ac.destination);
    musBus = ac.createGain(); musBus.gain.value = 0.55; musBus.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    return ac;
  };
  const midi = (n) => 440 * 2 ** ((n - 69) / 12);

  // nota com envelope; t = tempo absoluto do AudioContext
  function note(dest, f, t, d, type = "sine", v = 0.15, f2) {
    const a = ctx(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(dest); o.start(t); o.stop(t + d + 0.05);
  }
  function hit(dest, t, d, v, type, freq, q = 1) {
    const a = ctx(), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02);
  }
  // corda dedilhada (estilo cítara): ataque brilhante e queda rápida
  function pluck(dest, n, t, d, v) {
    note(dest, midi(n) * 1.01, t, d, "triangle", v, midi(n));
    note(dest, midi(n + 12), t, d * 0.5, "sine", v * 0.35);
  }

  // ---------- efeitos ----------
  const FX = {
    tick: (t) => note(fxBus, 1500, t, 0.025, "square", 0.02),
    stop: (t) => { note(fxBus, 170, t, 0.13, "triangle", 0.28, 80); hit(fxBus, t, 0.06, 0.18, "lowpass", 900); },
    slam: (t) => { note(fxBus, 120, t, 0.2, "triangle", 0.35, 60); hit(fxBus, t, 0.12, 0.3, "lowpass", 700); },
    lock: (t) => note(fxBus, 1100, t, 0.14, "sine", 0.1, 1900),
    click: (t) => note(fxBus, 900, t, 0.04, "triangle", 0.08),
    win: (t) => [72, 76, 79, 84].forEach((n, i) => pluck(fxBus, n, t + i * 0.08, 0.35, 0.16)),
    big: (t) => [72, 76, 79, 84, 79, 84, 88, 91].forEach((n, i) => pluck(fxBus, n, t + i * 0.1, 0.45, 0.17)),
    tier: (t) => { [84, 88, 91, 96].forEach((n, i) => note(fxBus, midi(n), t + i * 0.05, 0.3, "square", 0.06)); hit(fxBus, t, 0.6, 0.2, "highpass", 6000); },
    coin: (t) => note(fxBus, 1900 + Math.random() * 900, t, 0.07, "sine", 0.05),
    roar: (t) => { hit(fxBus, t, 1.1, 0.6, "lowpass", 500); note(fxBus, 200, t, 1, "sawtooth", 0.18, 55); note(fxBus, 150, t + 0.05, 0.9, "sawtooth", 0.12, 45); },
    gong: (t) => { [55, 82.4, 110, 164.8].forEach((f, i) => note(fxBus, f, t, 2.4 - i * 0.4, "sine", 0.16 / (i + 1))); hit(fxBus, t, 0.5, 0.15, "bandpass", 300, 2); },
    tease: (t) => { for (let i = 0; i < 10; i++) note(fxBus, 600 + i * 90, t + i * 0.08, 0.07, "triangle", 0.05); },
    boing: (t) => note(fxBus, 260, t, 0.22, "sine", 0.16, 620),
    full: (t) => [79, 83, 86, 91, 95].forEach((n, i) => note(fxBus, midi(n), t + i * 0.07, 0.5, "square", 0.07)),
  };
  const fx = (k) => {
    if (!fxOn) return;
    try { const a = ctx(); if (a.state === "running") FX[k](a.currentTime + 0.005); } catch { /* sem áudio */ }
  };

  // ---------- trilha: pentatônica festiva, I-vi-IV-V em Sol, loop de 8 compassos ----------
  const _ = null;
  const MEL = [
    74, _, 76, 74, 71, _, 67, _, 71, _, 74, 71, 69, _, 67, 64, 67, _, 69, 71, 74, _, 76, 79, 74, _, 69, _, 74, 76, 74, _,
    79, _, 76, 74, 76, _, 74, 71, 74, _, 71, 69, 71, _, 67, _, 64, 67, 69, 71, 74, 76, 74, 71, 69, _, 74, _, 67, _, _, _,
  ];
  const ROOT = [43, 40, 36, 38];
  const CHORD = [[67, 71, 74], [64, 67, 71], [60, 64, 67], [62, 66, 69]];
  const M = { timer: 0, step: 0, next: 0, mode: "base" };
  const bpm = () => (M.mode === "feat" ? 150 : 116);
  function step(s, t) {
    const bar = Math.floor(s / 8) % 4, b = s % 8, e = 60 / bpm() / 2, feat = M.mode === "feat";
    if (s === 0) note(musBus, 98, t, 1.6, "sine", 0.12);
    if (b === 0 || b === 4) note(musBus, 110, t, 0.18, "sine", 0.5, 45);
    if (b === 2 || b === 6) hit(musBus, t, 0.07, feat ? 0.32 : 0.22, "bandpass", 2200, 3);
    if (b % 2 === 1 || feat) hit(musBus, t, 0.03, feat ? 0.07 : 0.05, "highpass", 8000);
    if ([0, 3, 4, 6].includes(b)) note(musBus, midi(ROOT[bar] + (b === 3 || b === 6 ? 7 : b === 4 ? 12 : 0)), t, e * 1.6, "triangle", 0.22);
    if (b === 2 || b === 6) CHORD[bar].forEach((n) => note(musBus, midi(n), t, e * 0.9, "triangle", 0.035));
    const m = MEL[s % MEL.length];
    if (m) pluck(musBus, m + (feat ? 12 : 0), t, e * 2.2, 0.11);
  }
  function schedule() {
    const a = ctx();
    while (M.next < a.currentTime + 0.2) {
      step(M.step, M.next);
      M.next += 60 / bpm() / 2;
      M.step = (M.step + 1) % MEL.length;
    }
  }
  function musicStart() {
    if (!musOn || M.timer || !ac || ac.state !== "running") return;
    M.step = 0; M.next = ac.currentTime + 0.08;
    musBus.gain.setValueAtTime(0.55, ac.currentTime);
    M.timer = setInterval(schedule, 40);
  }
  function musicStop() { clearInterval(M.timer); M.timer = 0; }

  document.addEventListener("visibilitychange", () => {
    if (!ac) return;
    if (document.hidden) { musicStop(); ac.suspend(); } else ac.resume().then(musicStart);
  });

  return {
    unlock() { try { ctx().resume().then(musicStart); } catch { /* sem áudio */ } },
    fx,
    mode(m) { M.mode = m; },
    duck(on) { if (ac) musBus.gain.setTargetAtTime(on ? 0.12 : 0.55, ac.currentTime, 0.15); },
    get fxOn() { return fxOn; },
    get musOn() { return musOn; },
    setFx(v) { fxOn = v; localStorage.lzMute = v ? "0" : "1"; },
    setMusic(v) { musOn = v; localStorage.lzMusic = v ? "1" : "0"; v ? musicStart() : musicStop(); },
  };
})();
