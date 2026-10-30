'use client';

// Pembaca angka tulisan tangan (kode simpan spidol di karung), berjalan penuh di HP.
// Langkah: potong kotak bidik → hitam-putih → pisahkan per angka → setiap angka dikenali
// jaringan saraf kecil (dilatih dari angka tulisan tangan; kelas ke-11 = "bukan angka").
// Model: public/ocr-model/digits-v1.json (bobot int8, ±180 KB).

const MODEL_URL = '/ocr-model/digits-v1.json';
let modelPromise = null;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function loadDigitModel() {
  if (!modelPromise) {
    modelPromise = fetch(MODEL_URL).then(r => {
      if (!r.ok) throw new Error('Model angka tidak bisa dimuat');
      return r.json();
    }).then(j => {
      const L = {};
      for (const [name, t] of Object.entries(j.layers)) {
        if (t.q) {
          const q = new Int8Array(b64ToBytes(t.q).buffer);
          const f = new Float32Array(q.length);
          for (let i = 0; i < q.length; i++) f[i] = q[i] * t.scale;
          L[name] = f;
        } else {
          L[name] = new Float32Array(b64ToBytes(t.f).buffer);
        }
      }
      return L;
    }).catch(e => { modelPromise = null; throw e; });
  }
  return modelPromise;
}

// ===== Jaringan saraf (conv 3x3 → relu → maxpool, x3; lalu 2 lapis penuh) =====
function conv3(input, C, H, W, weight, bias, O) {
  const out = new Float32Array(O * H * W);
  for (let o = 0; o < O; o++) {
    const b = bias[o];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = b;
      for (let c = 0; c < C; c++) {
        const wBase = ((o * C + c) * 9), iBase = c * H * W;
        for (let ky = 0; ky < 3; ky++) {
          const yy = y + ky - 1; if (yy < 0 || yy >= H) continue;
          for (let kx = 0; kx < 3; kx++) {
            const xx = x + kx - 1; if (xx < 0 || xx >= W) continue;
            s += input[iBase + yy * W + xx] * weight[wBase + ky * 3 + kx];
          }
        }
      }
      out[(o * H + y) * W + x] = s > 0 ? s : 0;
    }
  }
  return out;
}

function pool2(input, C, H, W) {
  const h = Math.floor(H / 2), w = Math.floor(W / 2);
  const out = new Float32Array(C * h * w);
  for (let c = 0; c < C; c++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = c * H * W + y * 2 * W + x * 2;
    out[(c * h + y) * w + x] = Math.max(input[i], input[i + 1], input[i + W], input[i + W + 1]);
  }
  return out;
}

function dense(input, weight, bias, O, relu) {
  const N = input.length, out = new Float32Array(O);
  for (let o = 0; o < O; o++) {
    let s = bias[o];
    for (let i = 0; i < N; i++) s += input[i] * weight[o * N + i];
    out[o] = relu && s < 0 ? 0 : s;
  }
  return out;
}

function classify(L, img28) {
  let x = conv3(img28, 1, 28, 28, L['c1.weight'], L['c1.bias'], 32); x = pool2(x, 32, 28, 28);
  x = conv3(x, 32, 14, 14, L['c2.weight'], L['c2.bias'], 64); x = pool2(x, 64, 14, 14);
  x = conv3(x, 64, 7, 7, L['c3.weight'], L['c3.bias'], 64); x = pool2(x, 64, 7, 7);
  x = dense(x, L['f1.weight'], L['f1.bias'], 128, true);
  const logits = dense(x, L['f2.weight'], L['f2.bias'], 11, false);
  const m = Math.max(...logits);
  const e = Array.from(logits, v => Math.exp(v - m));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / sum);
}

// ===== Gambar → tinta hitam-putih =====
export function cropVideo(video, box) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = video.clientWidth, ch = video.clientHeight;
  if (!vw || !vh || !cw || !ch) return null;
  const scale = Math.max(cw / vw, ch / vh);
  const offX = (vw * scale - cw) / 2, offY = (vh * scale - ch) / 2;
  const sx = (box.x * cw + offX) / scale, sy = (box.y * ch + offY) / scale;
  const sw = (box.w * cw) / scale, sh = (box.h * ch) / scale;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh));
  c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function grayscale(canvas, H) {
  const W = Math.max(1, Math.round(canvas.width * H / canvas.height));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return { g, W, H };
}

// Piksel jauh lebih gelap dari rata-rata sekitarnya = tinta. Tahan bayangan dan anyaman karung.
function inkMask({ g, W, H }, radius, C) {
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += g[y * W + x]; integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row; }
  }
  // Kontras gambar: tinta harus lebih gelap dari latar setidaknya sebagian dari rentang ini.
  const sorted = Array.from(g).sort((a, b) => a - b);
  const span = Math.max(20, sorted[Math.floor(sorted.length * 0.95)] - sorted[Math.floor(sorted.length * 0.02)]);
  const thr = Math.max(C, span * 0.18);
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(H, y + radius + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(W, x + radius + 1);
      const sum = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
      if (g[y * W + x] < sum / ((x1 - x0) * (y1 - y0)) - thr) m[y * W + x] = 1;
    }
  }
  return m;
}

// ===== Pisahkan per angka =====
function components(m, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i] >= 0) continue;
    const id = comps.length;
    const c = { id, px: [], x0: W, y0: H, x1: 0, y1: 0 };
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop();
      const x = p % W, y = (p - x) / W;
      c.px.push(p);
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (m[q] && lab[q] < 0) { lab[q] = id; stack.push(q); }
      }
    }
    c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1;
    comps.push(c);
  }
  return comps;
}

function merge(a, b) {
  return { px: a.px.concat(b.px), x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
    get w() { return this.x1 - this.x0 + 1; }, get h() { return this.y1 - this.y0 + 1; } };
}

function segment(m, W, H) {
  let comps = components(m, W, H).filter(c => c.px.length >= W * H * 0.0015);
  // Buang garis panjang (tepi karung/jahitan) yang hampir selebar atau setinggi kotak.
  comps = comps.filter(c => !(c.w > W * 0.6 && c.h < H * 0.25) && !(c.h > H * 0.97 && c.w < W * 0.04));
  if (!comps.length) return [];
  const maxH = Math.max(...comps.map(c => c.h));
  // Bagian angka yang terputus (misal topi angka 5/7) digabung kalau menumpuk secara horizontal.
  comps.sort((a, b) => a.x0 - b.x0);
  const merged = [];
  for (const c of comps) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const ov = Math.min(prev.x1, c.x1) - Math.max(prev.x0, c.x0);
      if (ov > Math.min(prev.w, c.w) * 0.55 && (prev.h < maxH * 0.6 || c.h < maxH * 0.6)) { merged[merged.length - 1] = merge(prev, c); continue; }
    }
    merged.push(c);
  }
  // Hanya yang setinggi angka (bukan titik/coretan kecil) dan berada di baris yang sama.
  const tallH = Math.max(...merged.map(c => c.h));
  let digits = merged.filter(c => c.h >= tallH * 0.45);
  if (!digits.length) return [];
  const mids = digits.map(c => (c.y0 + c.y1) / 2).sort((a, b) => a - b);
  const midY = mids[Math.floor(mids.length / 2)];
  digits = digits.filter(c => Math.abs((c.y0 + c.y1) / 2 - midY) < tallH * 0.6);
  // Angka yang menempel: pecah di kolom yang tintanya paling sedikit.
  const widths = digits.map(c => c.w).sort((a, b) => a - b);
  const typW = Math.max(widths[Math.floor(widths.length / 2)], tallH * 0.45);
  const out = [];
  for (const c of digits) {
    const n = Math.round(c.w / typW);
    if (n < 2 || c.w < c.h * 1.05) { out.push(c); continue; }
    const cols = new Array(c.w).fill(0);
    for (const p of c.px) cols[(p % W) - c.x0]++;
    const cuts = [];
    for (let k = 1; k < n; k++) {
      const at = Math.round(c.w * k / n), span = Math.round(typW * 0.3);
      let best = at, bv = Infinity;
      for (let x = Math.max(1, at - span); x < Math.min(c.w - 1, at + span); x++) if (cols[x] < bv) { bv = cols[x]; best = x; }
      cuts.push(best + c.x0);
    }
    const edges = [c.x0, ...cuts, c.x1 + 1];
    for (let k = 0; k < edges.length - 1; k++) {
      const px = c.px.filter(p => { const x = p % W; return x >= edges[k] && x < edges[k + 1]; });
      if (!px.length) continue;
      let y0 = H, y1 = 0;
      for (const p of px) { const y = (p - (p % W)) / W; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      out.push({ px, x0: edges[k], x1: edges[k + 1] - 1, y0, y1, w: edges[k + 1] - edges[k], h: y1 - y0 + 1 });
    }
  }
  return out.sort((a, b) => a.x0 - b.x0);
}

// Satu angka → 28x28 gaya MNIST: muat dalam 20x20, pusat massa di tengah.
function toMnist(c, W) {
  const src = document.createElement('canvas');
  src.width = c.w; src.height = c.h;
  const sctx = src.getContext('2d');
  const id = sctx.createImageData(c.w, c.h);
  for (const p of c.px) {
    const x = (p % W) - c.x0, y = (p - (p % W)) / W - c.y0;
    if (x < 0 || x >= c.w) continue;
    const i = (y * c.w + x) * 4;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);
  const k = 20 / Math.max(c.w, c.h);
  const w = Math.max(1, Math.round(c.w * k)), h = Math.max(1, Math.round(c.h * k));
  const t = document.createElement('canvas');
  t.width = 28; t.height = 28;
  const tctx = t.getContext('2d', { willReadFrequently: true });
  tctx.fillStyle = '#000'; tctx.fillRect(0, 0, 28, 28);
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(src, 0, 0, c.w, c.h, (28 - w) / 2, (28 - h) / 2, w, h);
  let d = tctx.getImageData(0, 0, 28, 28).data;
  let sx = 0, sy = 0, sm = 0;
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { const v = d[(y * 28 + x) * 4]; sx += v * x; sy += v * y; sm += v; }
  const img = new Float32Array(784);
  if (!sm) return img;
  const dx = Math.round(13.5 - sx / sm), dy = Math.round(13.5 - sy / sm);
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const ox = x - dx, oy = y - dy;
    if (ox >= 0 && oy >= 0 && ox < 28 && oy < 28) img[y * 28 + x] = d[(oy * 28 + ox) * 4] / 255;
  }
  return img;
}

// Potong gambar menjadi gambar-gambar angka 28x28 (urut kiri ke kanan).
export function segmentDigits(crop, H, C) {
  const gray = grayscale(crop, H);
  const m = inkMask(gray, Math.max(6, Math.round(H / 3)), C);
  return segment(m, gray.W, gray.H).map(c => toMnist(c, gray.W));
}

function readOnce(L, crop, H, C) {
  const digits = [];
  for (const img of segmentDigits(crop, H, C)) {
    const p = classify(L, img);
    const order = p.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    if (order[0][1] === 10 && order[0][0] > 0.5) continue; // bukan angka
    const top = order.find(o => o[1] !== 10);
    const alt = order.filter(o => o[1] !== 10)[1];
    digits.push({ ch: String(top[1]), conf: Math.round(top[0] * 100), alt: alt && alt[0] > 0.08 ? String(alt[1]) : null });
  }
  return digits;
}

function score(digits, expectLen) {
  if (!digits.length) return -1;
  const mean = digits.reduce((a, d) => a + d.conf, 0) / digits.length;
  const lenAdj = expectLen ? (digits.length === expectLen ? 20 : -10 * Math.abs(digits.length - expectLen)) : 0;
  return mean + lenAdj;
}

// Baca angka dari potongan gambar. Hasil: { code, digits:[{ch,conf,alt}], confidence } atau null.
// `quick` = satu kali baca saja (untuk percobaan otomatis yang berulang).
export async function readKode(crop, { expectLen = 10, quick = false } = {}) {
  const L = await loadDigitModel();
  let best = null;
  for (const [H, C] of quick ? [[96, 14]] : [[96, 14], [128, 20], [72, 10]]) {
    const digits = readOnce(L, crop, H, C);
    const sc = score(digits, expectLen);
    if (!best || sc > best.sc) best = { sc, digits };
    if (digits.length === expectLen && digits.every(d => d.conf >= 85)) break;
  }
  if (!best || !best.digits.length) return null;
  const confidence = Math.round(best.digits.reduce((a, d) => a + d.conf, 0) / best.digits.length);
  return { code: best.digits.map(d => d.ch).join(''), digits: best.digits, confidence };
}
