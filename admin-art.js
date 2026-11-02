// =====================================================
//  admin-art.js — Admin → Gerar arte: imagem de divulgação de um jogo
//  Cores tiradas dos escudos; modelo e detalhes variam por jogo e a cada "Outra variação".
// =====================================================
(() => {
  const esc = RS.esc, TZ = "America/Sao_Paulo", BRAND = "#ff4d00", SITE = "realsports.online";
  const main = () => RS.$("#adm-main");
  const SIZES = { feed: [1080, 1350], story: [1080, 1920], quad: [1080, 1080] };
  // posições (px na largura 1080) por formato
  const LAYOUT = {
    feed: { brand: 60, league: 180, cy: 470, cs: 300, gap: 55, name: 54, ty: 800, bh: 140, oy: 900, oh: 110, fy: 1072, ch: 96, link: 58 },
    story: { brand: 170, league: 300, cy: 680, cs: 360, gap: 70, name: 58, ty: 1080, bh: 160, oy: 1210, oh: 124, fy: 1450, ch: 104, link: 66 },
    quad: { brand: 36, league: 140, cy: 370, cs: 220, gap: 46, name: 46, ty: 625, bh: 118, oy: 712, oh: 96, fy: 860, ch: 84, link: 52 },
  };
  const MODELS = [["auto", "Automático"], ["split", "Confronto diagonal"], ["neon", "Neon"], ["pitch", "Estádio"], ["waves", "Ondas"], ["brand", "Laranja Real Sports"]];

  // ligas principais (mesma ordem da lista de jogos do site)
  const TOP = ["Brazil Série A", "Brazil Série B", "Copa do Brasil", "CONMEBOL Libertadores", "CONMEBOL Sudamericana",
    "UEFA Champions League", "Premier League", "La Liga", "Serie A - Italy", "Bundesliga", "Ligue 1", "UEFA Europa League"];

  // .zip sem compressão (PNG já é comprimido)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
  function zip(files) {
    const parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = new TextEncoder().encode(f.name), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
      parts.push(h, name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(c, name);
      off += 30 + name.length + n;
    }
    const size = central.reduce((t, x) => t + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e], { type: "application/zip" });
  }

  const imgCache = new Map();
  const loadImg = (u) => {
    if (!u) return Promise.resolve(null);
    if (!imgCache.has(u)) imgCache.set(u, new Promise((ok) => {
      const i = new Image(); i.crossOrigin = "anonymous";
      i.onload = () => ok(i); i.onerror = () => ok(null); i.src = u;
    }));
    return imgCache.get(u);
  };
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rng = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const C = ([h, s, l], dl = 0, a = 1) => `hsla(${h},${Math.round(s * 100)}%,${Math.round(Math.max(0, Math.min(1, l + dl)) * 100)}%,${a})`;

  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  }
  // cor predominante (saturada) do escudo; escudo preto/branco vira grafite
  function teamTone(img, name) {
    if (img) try {
      const c = document.createElement("canvas"); c.width = c.height = 40;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, 40, 40);
      const d = x.getImageData(0, 0, 40, 40).data, bins = {};
      let opaque = 0;
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 200) continue;
        opaque++;
        const [h, s, l] = rgb2hsl(d[k], d[k + 1], d[k + 2]);
        if (s < 0.3 || l < 0.15 || l > 0.85) continue;
        const b = (bins[Math.round(h / 24) % 15] ||= { n: 0, h: 0, s: 0, l: 0 });
        b.n++; b.h += h; b.s += s; b.l += l;
      }
      const top = Object.values(bins).sort((a, b) => b.n - a.n)[0];
      if (top && top.n > opaque * 0.06) return [Math.round(top.h / top.n), Math.min(0.85, top.s / top.n), Math.min(0.48, Math.max(0.34, top.l / top.n))];
      if (opaque) return [220, 0.12, 0.2];
    } catch { /* imagem sem CORS */ }
    return [hash(name) % 360, 0.65, 0.42];
  }

  const when = (iso) => {
    const d = new Date(iso), f = (o) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, ...o }).format(d);
    const key = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(x);
    const today = key(new Date()), tomorrow = key(new Date(Date.now() + 864e5));
    const day = key(d) === today ? "HOJE" : key(d) === tomorrow ? "AMANHÃ" : f({ weekday: "long" }).replace("-feira", "").toUpperCase();
    return { day, date: f({ day: "2-digit", month: "2-digit" }), time: f({ hour: "2-digit", minute: "2-digit" }), dayKey: key(d) };
  };
  const odd = (v) => (Number(v) > 1 ? Number(v).toFixed(2) : null);

  // ---------- desenho ----------
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.roundRect(X, Y, w, h, r); }
  function fit(x, text, maxW, size, weight = 900) {
    do { x.font = `${weight} ${size}px Roboto, Arial, sans-serif`; size -= 2; } while (x.measureText(text).width > maxW && size > 14);
  }
  function crest(x, img, cx, cy, size, tone, name, glow) {
    x.save();
    if (glow) { x.shadowColor = glow; x.shadowBlur = size * 0.35; }
    if (img) {
      const k = size / Math.max(img.width, img.height);
      x.drawImage(img, cx - (img.width * k) / 2, cy - (img.height * k) / 2, img.width * k, img.height * k);
    } else {
      x.fillStyle = C(tone); x.beginPath(); x.arc(cx, cy, size / 2, 0, 7); x.fill();
      x.shadowBlur = 0; x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
      x.font = `900 ${size * 0.34}px Roboto, Arial`;
      x.fillText(name.split(/\s+/).filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || name.slice(0, 2).toUpperCase(), cx, cy);
    }
    x.restore();
  }
  function watermark(x, img, cx, cy, size, rot, alpha) {
    if (!img) return;
    x.save(); x.globalAlpha = alpha; x.translate(cx, cy); x.rotate(rot);
    const k = size / Math.max(img.width, img.height);
    x.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k);
    x.restore();
  }

  const BG = {
    split(x, W, H, A, B, r, L) {
      const t = 0.35 + r() * 0.3, s = (r() - 0.5) * 0.5;
      x.fillStyle = C(A, -0.08); x.fillRect(0, 0, W, H);
      x.fillStyle = C(B, -0.08);
      x.beginPath(); x.moveTo(W * (t + s), 0); x.lineTo(W, 0); x.lineTo(W, H); x.lineTo(W * (t - s), H); x.closePath(); x.fill();
      x.strokeStyle = "rgba(255,255,255,.9)"; x.lineWidth = 14;
      x.beginPath(); x.moveTo(W * (t + s), 0); x.lineTo(W * (t - s), H); x.stroke();
      x.strokeStyle = BRAND; x.lineWidth = 6;
      x.beginPath(); x.moveTo(W * (t + s) + 22, 0); x.lineTo(W * (t - s) + 22, H); x.stroke();
      watermark(x, L.h, W * 0.12, H * 0.55, W * 0.75, -0.25, 0.1);
      watermark(x, L.a, W * 0.9, H * 0.45, W * 0.75, 0.25, 0.1);
    },
    neon(x, W, H, A, B, r, L) {
      x.fillStyle = "#07090f"; x.fillRect(0, 0, W, H);
      for (const [t, cx] of [[A, 0.22], [B, 0.78]]) {
        const g = x.createRadialGradient(W * cx, H * 0.45, 10, W * cx, H * 0.45, W * 0.7);
        g.addColorStop(0, C(t, 0.1, 0.75)); g.addColorStop(1, C(t, 0, 0)); x.fillStyle = g; x.fillRect(0, 0, W, H);
      }
      x.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const y = r() * H, len = 120 + r() * 380, left = r() < 0.5;
        x.strokeStyle = C(left ? A : B, 0.25, 0.25 + r() * 0.35);
        const x0 = left ? r() * W * 0.4 : W * 0.6 + r() * W * 0.4;
        x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + (left ? len : -len), y - len * 0.25); x.stroke();
      }
      x.strokeStyle = "rgba(255,255,255,.05)"; x.lineWidth = 2;
      for (let gx = 0; gx < W; gx += 60) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
      for (let gy = 0; gy < H; gy += 60) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
    },
    pitch(x, W, H, A, B, r, L) {
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0a3d22"); g.addColorStop(1, "#05170e");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      const n = 8 + Math.floor(r() * 5);
      for (let i = 0; i < n; i += 2) { x.fillStyle = "rgba(255,255,255,.035)"; x.fillRect(0, (H / n) * i, W, H / n); }
      x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = 5;
      x.beginPath(); x.moveTo(0, H * 0.5); x.lineTo(W, H * 0.5); x.stroke();
      x.beginPath(); x.arc(W / 2, H * 0.5, W * 0.2, 0, 7); x.stroke();
      x.strokeRect(W * 0.22, -5, W * 0.56, H * 0.12); x.strokeRect(W * 0.22, H * 0.88, W * 0.56, H * 0.13);
      for (const [t, side] of [[A, 0], [B, 1]]) {
        const b = x.createLinearGradient(side ? W : 0, 0, side ? W * 0.55 : W * 0.45, 0);
        b.addColorStop(0, C(t, 0, 0.85)); b.addColorStop(1, C(t, 0, 0)); x.fillStyle = b; x.fillRect(0, 0, W, H);
      }
      x.save(); x.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const sx = W * (0.1 + r() * 0.8), l = x.createLinearGradient(sx, 0, W / 2, H * 0.7);
        l.addColorStop(0, "rgba(255,255,255,.22)"); l.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = l; x.beginPath(); x.moveTo(sx - 30, 0); x.lineTo(sx + 30, 0); x.lineTo(W / 2 + 260, H * 0.75); x.lineTo(W / 2 - 260, H * 0.75); x.fill();
      }
      x.restore();
    },
    waves(x, W, H, A, B, r, L) {
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, C(A, -0.05)); g.addColorStop(1, C(B, -0.05));
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        const y0 = H * (0.15 + r() * 0.75), amp = 40 + r() * 110, fr = 1 + r() * 2.5, ph = r() * 6;
        x.fillStyle = i % 2 ? `rgba(255,255,255,${0.05 + r() * 0.07})` : `rgba(0,0,0,${0.08 + r() * 0.1})`;
        x.beginPath(); x.moveTo(0, H);
        for (let px = 0; px <= W; px += 20) x.lineTo(px, y0 + Math.sin((px / W) * fr * 6.28 + ph) * amp);
        x.lineTo(W, H); x.fill();
      }
      for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.35})`; x.beginPath(); x.arc(r() * W, r() * H, 2 + r() * 5, 0, 7); x.fill(); }
    },
    brand(x, W, H, A, B, r, L) {
      const g = x.createLinearGradient(0, 0, W * (r() < 0.5 ? 1 : 0.3), H); g.addColorStop(0, "#ff6a1f"); g.addColorStop(1, "#b52e00");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      watermark(x, L.h, W * (0.05 + r() * 0.2), H * (0.2 + r() * 0.2), W * 0.8, -0.3 + r() * 0.2, 0.13);
      watermark(x, L.a, W * (0.8 + r() * 0.15), H * (0.6 + r() * 0.2), W * 0.8, 0.1 + r() * 0.2, 0.13);
      x.strokeStyle = "rgba(255,255,255,.12)"; x.lineWidth = 40;
      for (let i = 0; i < 3; i++) { const o = r() * W; x.beginPath(); x.moveTo(o - 400, H); x.lineTo(o + 400, 0); x.stroke(); }
      x.fillStyle = C(A, 0, 0.9); x.fillRect(0, 0, 22, H); x.fillStyle = C(B, 0, 0.9); x.fillRect(W - 22, 0, 22, H);
    },
  };

  function brandMark(x, cx, y, s) {
    x.font = `900 ${s * 0.62}px Roboto, Arial`;
    const word = "REAL SPORTS", tw = x.measureText(word).width, total = s + s * 0.3 + tw, x0 = cx - total / 2;
    x.fillStyle = BRAND; rr(x, x0, y, s, s, s * 0.22); x.fill();
    x.strokeStyle = "rgba(255,255,255,.9)"; x.lineWidth = s * 0.05; x.stroke();
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `900 ${s * 0.5}px Roboto, Arial`; x.fillText("RS", x0 + s / 2, y + s * 0.53);
    x.textAlign = "left"; x.font = `900 ${s * 0.62}px Roboto, Arial`; x.fillText(word, x0 + s * 1.3, y + s * 0.54);
  }

  async function draw(cv, m, fmt, model, variant) {
    const [W, H] = SIZES[fmt];
    cv.width = W; cv.height = H;
    const x = cv.getContext("2d");
    await document.fonts.load("900 40px Roboto").catch(() => {});
    const [ih, ia, il] = await Promise.all([loadImg(m.home_logo), loadImg(m.away_logo), loadImg(m.league_logo)]);
    const A = teamTone(ih, m.home), B = teamTone(ia, m.away);
    if (Math.abs(A[0] - B[0]) < 25 && A[1] > 0.3 && B[1] > 0.3) B[2] = Math.max(0.18, B[2] - 0.18);
    const r = rng(hash(m.id) + variant * 7919);
    const keys = Object.keys(BG), key = model === "auto" ? keys[(hash(m.id) + variant) % keys.length] : model;
    BG[key](x, W, H, A, B, r, { h: ih, a: ia });
    const shade = x.createLinearGradient(0, H * 0.55, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,.6)");
    x.fillStyle = shade; x.fillRect(0, 0, W, H);

    const u = W / 1080, L = LAYOUT[fmt];
    brandMark(x, W / 2, L.brand * u, 82 * u);
    // liga
    let y = L.league * u;
    const lg = m.league.toUpperCase();
    fit(x, lg, W - 260 * u, 34 * u, 700);
    const lw = x.measureText(lg).width + (il ? 70 * u : 0) + 60 * u;
    x.fillStyle = "rgba(0,0,0,.45)"; rr(x, W / 2 - lw / 2, y, lw, 70 * u, 35 * u); x.fill();
    if (il) { rr(x, W / 2 - lw / 2 + 22 * u, y + 11 * u, 48 * u, 48 * u, 10 * u); x.fillStyle = "#fff"; x.fill(); crest(x, il, W / 2 - lw / 2 + 46 * u, y + 35 * u, 40 * u); }
    x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(lg, W / 2 + (il ? 35 * u : 0), y + 37 * u);

    // escudos e nomes
    const cy = L.cy * u, cs = L.cs * u;
    crest(x, ih, W * 0.26, cy, cs, A, m.home, "rgba(0,0,0,.55)");
    crest(x, ia, W * 0.74, cy, cs, B, m.away, "rgba(0,0,0,.55)");
    x.save(); x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 20;
    x.fillStyle = "#fff"; x.font = `900 italic ${120 * u}px Roboto, Arial`; x.fillText("X", W / 2, cy);
    x.restore();
    const ny = cy + cs / 2 + L.gap * u;
    x.save(); x.shadowColor = "rgba(0,0,0,.7)"; x.shadowBlur = 14; x.fillStyle = "#fff";
    for (const [name, cx] of [[m.home, 0.26], [m.away, 0.74]]) { fit(x, name.toUpperCase(), W * 0.44, L.name * u); x.fillText(name.toUpperCase(), W * cx, ny); }
    x.restore();

    // data e hora
    const w = when(m.starts_at), ty = L.ty * u, bw = 620 * u, bh = L.bh * u, k = L.bh / 150;
    x.fillStyle = "rgba(255,255,255,.96)"; rr(x, W / 2 - bw / 2, ty - bh / 2, bw, bh, 26 * u); x.fill();
    x.fillStyle = BRAND; rr(x, W / 2 - bw / 2, ty - bh / 2, bw * 0.46, bh, [26 * u, 0, 0, 26 * u]); x.fill();
    x.fillStyle = "#fff"; fit(x, w.day, bw * 0.4, 46 * u * k); x.fillText(w.day, W / 2 - bw / 2 + bw * 0.23, ty - 18 * u * k);
    x.font = `700 ${34 * u * k}px Roboto, Arial`; x.fillText(w.date, W / 2 - bw / 2 + bw * 0.23, ty + 32 * u * k);
    x.fillStyle = "#111"; x.font = `900 ${96 * u * k}px Roboto, Arial`; x.fillText(w.time, W / 2 + bw * 0.23, ty + 6 * u);

    // odds
    const odds = [["CASA", odd(m.odd_home)], ["EMPATE", odd(m.odd_draw)], ["FORA", odd(m.odd_away)]];
    if (odds.every(([, v]) => v)) {
      const oy = L.oy * u, ow = 250 * u, oh = L.oh * u, gap = 26 * u, ox = W / 2 - (ow * 3 + gap * 2) / 2, q = L.oh / 120;
      odds.forEach(([t, v], i) => {
        const bx = ox + i * (ow + gap);
        x.fillStyle = "rgba(0,0,0,.55)"; rr(x, bx, oy, ow, oh, 20 * u); x.fill();
        x.strokeStyle = "rgba(255,255,255,.25)"; x.lineWidth = 2; x.stroke();
        x.fillStyle = "rgba(255,255,255,.75)"; x.font = `700 ${26 * u * q}px Roboto, Arial`; x.fillText(t, bx + ow / 2, oy + 34 * u * q);
        x.fillStyle = "#ffd23f"; x.font = `900 ${52 * u * q}px Roboto, Arial`; x.fillText(v, bx + ow / 2, oy + 82 * u * q);
      });
    }

    // chamada e link
    const fy = L.fy * u, cw = 600 * u, ch = L.ch * u;
    x.save(); x.shadowColor = "rgba(0,0,0,.4)"; x.shadowBlur = 24;
    x.fillStyle = BRAND; rr(x, W / 2 - cw / 2, fy, cw, ch, ch / 2); x.fill(); x.restore();
    x.fillStyle = "#fff"; x.font = `900 ${46 * u * (L.ch / 100)}px Roboto, Arial`; x.fillText("APOSTE AGORA", W / 2, fy + ch / 2 + 2 * u);
    x.font = `700 ${38 * u}px Roboto, Arial`; x.fillText(SITE, W / 2, fy + ch + L.link * u);
    return key;
  }

  const caption = (m) => {
    const w = when(m.starts_at), o = [odd(m.odd_home), odd(m.odd_draw), odd(m.odd_away)];
    return `⚽ ${m.home} x ${m.away}\n🏆 ${m.league}\n🕒 ${w.day === "HOJE" || w.day === "AMANHÃ" ? w.day[0] + w.day.slice(1).toLowerCase() : w.date}, ${w.time}`
      + (o.every(Boolean) ? `\n📊 Casa ${o[0]} | Empate ${o[1]} | Fora ${o[2]}` : "") + `\n👉 Aposte em https://${SITE}`;
  };

  // ---------- tela ----------
  async function art() {
    const { head } = window.RSadmin;
    main().innerHTML = head("Gerar arte") + `
      <div class="art">
        <div class="panel art-pick">
          <div class="filters">
            <input class="input" id="art-q" placeholder="Buscar time ou liga" style="flex:1;min-width:160px">
            <select class="input" id="art-day"><option value="0">Hoje</option><option value="1">Amanhã</option><option value="7">Próximos 7 dias</option></select>
          </div>
          <div class="art-bulk">
            <button class="btn btn-primary" id="art-all">Gerar todas das ligas principais</button>
            <div class="art-actions" id="art-bulk-out" hidden>
              <button class="btn btn-primary" id="art-sendall">${RS.icon("share")} Compartilhar todas</button>
              <button class="btn btn-outline" id="art-zip">Baixar .zip</button>
            </div>
            <small class="muted" id="art-bulk-msg">Brasileirão, Copa do Brasil, Libertadores, Champions, Premier, La Liga, Serie A, Bundesliga, Ligue 1… do dia escolhido acima.</small>
          </div>
          <div id="art-list" class="art-list"><p class="muted">Carregando jogos…</p></div>
        </div>
        <div class="panel art-view">
          <div class="filters">
            <select class="input" id="art-fmt"><option value="feed">Post 4:5</option><option value="story">Status / Story 9:16</option><option value="quad">Quadrado 1:1</option></select>
            <select class="input" id="art-model">${MODELS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select>
          </div>
          <div class="art-canvas"><canvas id="art-cv"></canvas><p class="muted" id="art-hint">Escolha um jogo para gerar a arte.</p></div>
          <div class="art-actions">
            <button class="btn btn-outline" id="art-var" disabled>${RS.icon("refresh")} Outra variação</button>
            <button class="btn btn-primary" id="art-share" disabled>${RS.icon("share")} Compartilhar</button>
            <button class="btn btn-outline" id="art-dl" disabled>Baixar imagem</button>
          </div>
          <label class="small muted" style="display:block;margin-top:12px">Texto para o grupo
            <textarea class="input" id="art-txt" rows="5" readonly></textarea></label>
          <button class="btn btn-outline" id="art-copy" disabled>${RS.icon("copy")} Copiar texto</button>
        </div>
      </div>`;
    const { data, error } = await sb.from("matches").select("id,league,home,away,starts_at,odd_home,odd_draw,odd_away,home_logo,away_logo,league_logo,status")
      .eq("status", "open").gt("starts_at", new Date().toISOString()).order("starts_at").limit(1500);
    if (error) { RS.$("#art-list").innerHTML = `<p class="empty">Erro: ${esc(error.message)}</p>`; return; }
    const games = data || [];
    let sel = null, variant = 0;
    const cv = RS.$("#art-cv");
    const list = () => {
      const q = RS.$("#art-q").value.trim().toLowerCase(), days = +RS.$("#art-day").value;
      const keys = new Set(Array.from({ length: days ? days : 1 }, (_, i) => when(new Date(Date.now() + (days === 1 ? 1 : i) * 864e5).toISOString()).dayKey));
      const rows = games.filter((g) => keys.has(when(g.starts_at).dayKey) && (!q || `${g.home} ${g.away} ${g.league}`.toLowerCase().includes(q))).slice(0, 300);
      RS.$("#art-list").innerHTML = rows.length ? rows.map((g) => {
        const w = when(g.starts_at);
        return `<button class="art-row${sel?.id === g.id ? " active" : ""}" data-g="${g.id}">
          <small>${esc(w.day === "HOJE" ? "" : w.date + " · ")}${w.time} · ${esc(g.league)}</small>
          <span>${g.home_logo ? `<img src="${esc(g.home_logo)}" alt="">` : ""}${esc(g.home)} x ${esc(g.away)}${g.away_logo ? `<img src="${esc(g.away_logo)}" alt="">` : ""}</span></button>`;
      }).join("") : `<p class="empty">Nenhum jogo encontrado.</p>`;
    };
    const render = async () => {
      if (!sel) return;
      RS.$("#art-hint").hidden = true;
      await draw(cv, sel, RS.$("#art-fmt").value, RS.$("#art-model").value, variant);
      RS.$("#art-txt").value = caption(sel);
      for (const id of ["#art-var", "#art-share", "#art-dl", "#art-copy"]) RS.$(id).disabled = false;
    };
    const slug = (g) => `real-sports-${g.home}-x-${g.away}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "-").replace(/-+$/, "").toLowerCase();
    const fileName = () => `real-sports-${sel.home}-x-${sel.away}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "-").replace(/-+$/, "").toLowerCase() + ".png";
    const blob = () => new Promise((ok) => cv.toBlob(ok, "image/png"));
    const download = async () => {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await blob()), download: fileName() });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    RS.$("#art-list").onclick = (e) => {
      const b = e.target.closest("[data-g]"); if (!b) return;
      sel = games.find((g) => String(g.id) === b.dataset.g); variant = 0;
      RS.$$(".art-row", RS.$("#art-list")).forEach((r) => r.classList.toggle("active", r === b));
      render();
      if (matchMedia("(max-width: 900px)").matches) RS.$(".art-view").scrollIntoView({ behavior: "smooth" });
    };
    // todas as artes das ligas principais do dia escolhido
    let bulk = [];
    const bulkDays = () => {
      const days = +RS.$("#art-day").value;
      return new Set(Array.from({ length: days || 1 }, (_, i) => when(new Date(Date.now() + (days === 1 ? 1 : i) * 864e5).toISOString()).dayKey));
    };
    RS.$("#art-day").addEventListener("change", () => { bulk = []; RS.$("#art-bulk-out").hidden = true; });
    RS.$("#art-all").onclick = async (e) => {
      const btn = e.currentTarget, keys = bulkDays();
      const top = games.filter((g) => TOP.includes(g.league) && keys.has(when(g.starts_at).dayKey))
        .sort((a, b) => TOP.indexOf(a.league) - TOP.indexOf(b.league) || a.starts_at.localeCompare(b.starts_at));
      if (!top.length) { RS.toast("Nenhum jogo das ligas principais nesse dia", "error"); return; }
      btn.disabled = true; bulk = []; RS.$("#art-bulk-out").hidden = true;
      const c = document.createElement("canvas"), fmt = RS.$("#art-fmt").value, model = RS.$("#art-model").value;
      for (const [i, g] of top.entries()) {
        btn.textContent = `Gerando ${i + 1} de ${top.length}…`;
        await draw(c, g, fmt, model, 0);
        const b = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
        bulk.push(new File([b], `${String(i + 1).padStart(2, "0")}-${slug(g)}.jpg`, { type: "image/jpeg" }));
      }
      btn.disabled = false; btn.textContent = "Gerar todas das ligas principais";
      RS.$("#art-bulk-msg").textContent = `${bulk.length} artes prontas.`;
      RS.$("#art-bulk-out").hidden = false;
      RS.$("#art-sendall").hidden = !navigator.canShare?.({ files: bulk });
    };
    RS.$("#art-sendall").onclick = async () => {
      try { await navigator.share({ files: bulk }); } catch (err) { if (err.name !== "AbortError") RS.toast("Não deu para compartilhar todas; use Baixar .zip", "error"); }
    };
    RS.$("#art-zip").onclick = async () => {
      const files = await Promise.all(bulk.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(zip(files)), download: `real-sports-artes-${when(new Date().toISOString()).dayKey}.zip` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    RS.$("#art-q").oninput = list; RS.$("#art-day").onchange = list;
    RS.$("#art-fmt").onchange = render; RS.$("#art-model").onchange = render;
    RS.$("#art-var").onclick = () => { variant++; render(); };
    RS.$("#art-dl").onclick = download;
    RS.$("#art-share").onclick = async () => {
      const f = new File([await blob()], fileName(), { type: "image/png" });
      if (navigator.canShare?.({ files: [f] })) {
        try { await navigator.share({ files: [f] }); } catch { /* cancelado */ }
      } else download();
    };
    RS.$("#art-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(RS.$("#art-txt").value); RS.toast("Texto copiado", "ok"); }
      catch { RS.$("#art-txt").select(); }
    };
    list();
  }

  window.RSmods = Object.assign(window.RSmods || {}, { art });
})();
