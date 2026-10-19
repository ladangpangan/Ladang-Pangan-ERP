// =====================================================================
// INTEGRASI PRODUCTIVITY APP — PENGGERAK (dijalankan dari lib/db/boot.js).
// ---------------------------------------------------------------------
// Pengaturan lewat .env di VPS (JANGAN ditulis di kode / chat):
//   INTEGRASI_URL      alamat penerima webhook, mis. http://produktivitas:3000/api/integrasi/erp (jalur dalam server)
//   INTEGRASI_RAHASIA  rahasia tanda tangan (min. 16 karakter) — sama persis dengan yang diisi di Productivity App
//   INTEGRASI_TOKEN    token Bearer untuk GET /api/integrasi/peristiwa (tarik ulang tiap 15 menit oleh Productivity App)
//   INTEGRASI_MULAI    (opsional) YYYY-MM-DD; data sebelum tanggal ini tidak dikabarkan. Bawaan: awal bulan saat pertama jalan.
//   INTEGRASI_UJI      (opsional) 1 = semua peristiwa bertanda uji (untuk staging; tidak dihitung ke target)
//   INTEGRASI_DETIK    (opsional) jeda pindai, bawaan 60
// Integrasi mati sepenuhnya bila INTEGRASI_RAHASIA dan INTEGRASI_TOKEN sama-sama kosong.
// =====================================================================
import crypto from 'crypto';
import { pindai, tglWib } from './pemindai.js';
import { kirimAntrean } from './pengirim.js';

export function bacaKonfig(env = process.env) {
  const rahasia = String(env.INTEGRASI_RAHASIA || '').trim();
  const token = String(env.INTEGRASI_TOKEN || '').trim();
  return {
    url: String(env.INTEGRASI_URL || '').trim(),
    rahasia: rahasia.length >= 16 ? rahasia : '',
    rahasiaTerlaluPendek: !!rahasia && rahasia.length < 16,
    token: token.length >= 16 ? token : '',
    mulai: /^\d{4}-\d{2}-\d{2}$/.test(String(env.INTEGRASI_MULAI || '')) ? env.INTEGRASI_MULAI : '',
    uji: env.INTEGRASI_UJI === '1' || env.INTEGRASI_UJI === 'true',
    detik: Math.max(15, Number(env.INTEGRASI_DETIK) || 60),
    aktif: rahasia.length >= 16 || token.length >= 16,
  };
}

/** Satu putaran: kunci → pindai → simpan outbox lalu state → kirim. Aman diulang. */
export async function satuPutaran({ store, db, cfg, nowMs = Date.now(), pemilik, fetchFn }) {
  if (!(await store.kunci(pemilik, nowMs, Math.max(45000, cfg.detik * 1000 * 0.9)))) return { dilewati: 'pod lain sedang memindai' };
  // Tanggal mulai disimpan sekali (stabil walau kontainer dibangun ulang).
  let m = await store.meta('mulai');
  if (!m?.tgl) { const tgl = cfg.mulai || `${tglWib(nowMs).slice(0, 7)}-01`; await store.setMeta('mulai', { tgl, sejak: nowMs }); m = { tgl }; }
  else if (cfg.mulai && cfg.mulai !== m.tgl) { await store.setMeta('mulai', { tgl: cfg.mulai }); m = { tgl: cfg.mulai }; }

  const state = await store.muatState();
  const ringkasanTgl = (await store.meta('ringkasan'))?.tgl || null;
  const hasil = pindai(db, state, { nowMs, mulai: m.tgl, uji: cfg.uji, ringkasanSudah: (t) => t === ringkasanTgl });
  // Outbox DULU, baru state: bila penyimpanan state gagal, putaran berikut membuat peristiwa yang sama (id sama) —
  // Productivity App mengabaikan duplikat. Kebalikannya (state dulu) bisa menghilangkan kabar.
  await store.tambah(hasil.peristiwa, nowMs);
  await store.simpanState([...hasil.berubah].map((k) => [k, state.get(k)]));
  if (hasil.ringkasan) await store.setMeta('ringkasan', { tgl: hasil.ringkasan });
  const kirim = await kirimAntrean(store, { url: cfg.url, rahasia: cfg.rahasia, nowMs, fetchFn });
  return { baru: hasil.peristiwa.length, ...kirim };
}

let _timer = null;
export function mulaiIntegrasi({ store, getDb, env = process.env, log = console }) {
  const cfg = bacaKonfig(env);
  if (cfg.rahasiaTerlaluPendek) log.warn('[integrasi] INTEGRASI_RAHASIA kurang dari 16 karakter — webhook tidak dikirim.');
  if (!cfg.aktif) return false;
  if (_timer) return true;
  const pemilik = `${process.env.HOSTNAME || 'pod'}-${crypto.randomBytes(4).toString('hex')}`;
  let jalan = false; let galatTerakhir = '';
  const putar = async () => {
    if (jalan) return; jalan = true;
    try {
      const r = await satuPutaran({ store, db: getDb(), cfg, pemilik });
      if (r.baru || r.terkirim || r.gagal) log.log(`[integrasi] ${r.baru || 0} kabar baru, ${r.terkirim || 0} terkirim, ${r.gagal || 0} gagal, ${r.tertunda || 0} menunggu`);
      galatTerakhir = '';
    } catch (e) {
      const g = e?.message || String(e);
      if (g !== galatTerakhir) log.error('[integrasi] putaran gagal:', g); // jangan banjiri log dengan galat yang sama
      galatTerakhir = g;
    } finally { jalan = false; }
  };
  // Mulai 2 menit setelah boot: cermin SQLite sudah dihidrasi dari MongoDB (warmCaches) sebelum dipindai.
  setTimeout(() => { putar(); _timer = setInterval(putar, cfg.detik * 1000); if (_timer.unref) _timer.unref(); }, 120000).unref?.();
  log.log(`[integrasi] aktif — webhook ${cfg.url ? 'ke ' + cfg.url : 'tidak dikirim (INTEGRASI_URL kosong; hanya tarik)'}, tarik ${cfg.token ? 'aktif' : 'mati'}${cfg.uji ? ', MODE UJI' : ''}.`);
  _timer = _timer || true;
  return true;
}
