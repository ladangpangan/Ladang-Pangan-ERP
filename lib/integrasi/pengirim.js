// =====================================================================
// INTEGRASI PRODUCTIVITY APP — PENGIRIM (webhook bertanda tangan + kirim ulang).
// ---------------------------------------------------------------------
// Kontrak (Productivity App, V3 §10.4):
//   POST <INTEGRASI_URL>   body = {"id","jenis","waktu","uji","data"}
//   X-LPI-Sumber: erp
//   X-LPI-Waktu:  <unix detik>
//   X-LPI-Tanda:  sha256=<hex HMAC-SHA256(rahasia, waktu + "." + body mentah)>
// Urutan dijaga: peristiwa dikirim berurutan (seq); bila satu gagal karena jaringan/server/rahasia, yang di
// belakangnya MENUNGGU (supaya "batal" tidak pernah sampai sebelum "dibuat"). Jeda kirim ulang 1, 5, 15, 60 menit,
// lalu tiap jam sampai 24 jam → ditandai gagal dan antrean jalan lagi. Productivity App juga menarik ulang
// lewat GET /api/integrasi/peristiwa, jadi yang gagal tetap bisa sampai.
// =====================================================================
import crypto from 'crypto';

export const JEDA_MENIT = [1, 5, 15, 60];
const BATAS_MS = 24 * 3600 * 1000;

export function tandaTangan(rahasia, waktu, raw) {
  return 'sha256=' + crypto.createHmac('sha256', rahasia).update(`${waktu}.${raw}`).digest('hex');
}

export function jedaBerikut(percobaan) {
  const m = JEDA_MENIT[percobaan - 1] ?? 60;
  return m * 60 * 1000;
}

export function badanPeristiwa(ev) {
  return JSON.stringify({ id: ev.id, jenis: ev.jenis, waktu: ev.waktu, uji: !!ev.uji, data: ev.data });
}

/**
 * Kirim antrean secara berurutan. Mengembalikan ringkasan { terkirim, gagal, tertunda }.
 * cfg: { url, rahasia, nowMs, fetchFn, timeoutMs }
 */
export async function kirimAntrean(store, cfg) {
  const hasil = { terkirim: 0, gagal: 0, tertunda: 0 };
  if (!cfg.url || !cfg.rahasia) return hasil;
  const daftar = await store.antrean(100);
  for (const ev of daftar) {
    if (ev.berikut_at > cfg.nowMs) { hasil.tertunda = daftar.length - hasil.terkirim - hasil.gagal; break; }
    const raw = badanPeristiwa(ev);
    const waktu = Math.floor(cfg.nowMs / 1000);
    let status = 0; let pesan = '';
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), cfg.timeoutMs || 15000);
      const r = await (cfg.fetchFn || fetch)(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-LPI-Sumber': 'erp', 'X-LPI-Waktu': String(waktu), 'X-LPI-Tanda': tandaTangan(cfg.rahasia, waktu, raw) },
        body: raw, signal: ctl.signal,
      });
      clearTimeout(t);
      status = r.status;
      if (!r.ok) { try { const j = await r.json(); pesan = j?.error || ''; } catch { pesan = ''; } }
    } catch (e) { status = 0; pesan = e?.name === 'AbortError' ? 'waktu habis' : (e?.message || 'jaringan'); }

    if (status >= 200 && status < 300) {
      await store.ubah(ev.seq, { status: 'terkirim', terkirim_at: cfg.nowMs, galat: null, percobaan: ev.percobaan + 1 });
      hasil.terkirim++; continue;
    }
    const galat = `${status || 'jaringan'}${pesan ? ': ' + String(pesan).slice(0, 160) : ''}`;
    // 400/404/413/422 = isi ditolak (tidak akan berubah bila dikirim ulang) → gagal, lanjut ke berikutnya.
    if ([400, 404, 413, 422].includes(status)) {
      await store.ubah(ev.seq, { status: 'gagal', galat, percobaan: ev.percobaan + 1 }); hasil.gagal++; continue;
    }
    // Lainnya (jaringan, 5xx, 401 rahasia salah, 403 integrasi dimatikan, 429): coba lagi nanti; antrean berhenti di sini.
    const percobaan = ev.percobaan + 1;
    if (cfg.nowMs - ev.dibuat_at >= BATAS_MS) { await store.ubah(ev.seq, { status: 'gagal', galat, percobaan }); hasil.gagal++; continue; }
    await store.ubah(ev.seq, { percobaan, galat, berikut_at: cfg.nowMs + jedaBerikut(percobaan) });
    hasil.tertunda = daftar.length - hasil.terkirim - hasil.gagal;
    break;
  }
  return hasil;
}
