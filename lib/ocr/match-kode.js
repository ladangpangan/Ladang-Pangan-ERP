// Pencocokan hasil baca tulisan tangan (OCR) dengan daftar kode simpan yang ada.
// Dipakai Tally: angka spidol sering tertukar (1↔7, 0↔8, 5↔6 …), jadi substitusi angka yang mirip
// bentuknya lebih murah, dan angka yang dibaca dengan yakin lebih mahal untuk diganti.

// Pasangan angka yang sering tertukar pada tulisan tangan.
const LOOKALIKE = new Set([
  '1-7', '1-4', '0-8', '0-6', '0-9', '5-6', '3-8', '4-9', '2-7', '6-8', '8-9', '3-5', '2-3', '5-9', '7-9',
]);

function subCost(a, b, conf) {
  if (a === b) return 0;
  const base = LOOKALIKE.has(a < b ? `${a}-${b}` : `${b}-${a}`) ? 0.5 : 1;
  // conf 0..100 dari OCR; angka yang ragu (conf rendah) lebih murah untuk diganti.
  const c = Number.isFinite(conf) ? Math.max(0, Math.min(100, conf)) : 70;
  return base * (0.4 + 0.6 * (c / 100));
}

// Jarak edit berbobot antara hasil baca `read` dan kode `code`.
// `confs[i]` = keyakinan OCR untuk angka ke-i dari `read`.
export function kodeDistance(read, code, confs = []) {
  const n = read.length, m = code.length;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j * 0.9;
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1);
    const conf = confs[i - 1];
    const del = Number.isFinite(conf) && conf < 50 ? 0.6 : 0.9; // angka ragu mudah dianggap coretan
    cur[0] = prev[0] + del;
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(
        prev[j - 1] + subCost(read[i - 1], code[j - 1], conf),
        prev[j] + del,
        cur[j - 1] + 0.9,
      );
    }
    prev = cur;
  }
  return prev[m];
}

// Kembalikan kode terdekat (maks `limit`), urut dari paling mirip. Kode yang terlalu jauh dibuang.
export function matchKode(read, codes, confs = [], { limit = 3, maxDistance = 2.2 } = {}) {
  const r = String(read || '').replace(/\D/g, '');
  if (!r) return [];
  const out = [];
  for (const code of codes) {
    const c = String(code || '');
    if (!c || Math.abs(c.length - r.length) > 2) continue;
    const d = kodeDistance(r, c, confs);
    if (d <= maxDistance) out.push({ code: c, distance: Math.round(d * 100) / 100 });
  }
  out.sort((a, b) => a.distance - b.distance || a.code.localeCompare(b.code));
  return out.slice(0, limit);
}
