// =====================================================================
// INTEGRASI PRODUCTIVITY APP — PEMINDAI (pure, tanpa I/O selain membaca SQLite).
// ---------------------------------------------------------------------
// Setiap ~1 menit pemindai membaca data ERP (cermin SQLite per-pod yang selalu diperbarui oleh setiap
// penulisan di pod ini) lalu MEMBANDINGKAN dengan "keadaan terakhir yang sudah dikabarkan" (state). Bedanya
// menjadi peristiwa sesuai kontrak Productivity App (docs V3 §10.4 di repo Productivity App):
//   penjualan.dibuat/batal, pengiriman.dibuat/selesai, pelanggan.dibuat, pembayaran.diterima,
//   pembelian.dibuat/diterima/batal, rekap.diajukan/dibayar/dibatalkan, tagihan.jatuh_tempo/lunas,
//   piutang.ringkasan, stok.ringkasan.
// Kenapa dibandingkan (bukan disisipkan di tiap handler route.js): satu tempat, tidak menyentuh ~7.700 baris
// handler, dan otomatis menangkap SEMUA jalur perubahan (edit, rollback, tally, rekap, dsb.).
// Pengaman:
//   - Perubahan "mundur" (batal / kembali Draft / data hilang) baru dikabarkan setelah terlihat 3 kali pindai
//     berturut-turut (KONFIRMASI), supaya cermin SQLite yang sesaat kosong/basi saat hidrasi tidak memicu batal palsu.
//   - Hanya data sejak tanggal `mulai` (bawaan: awal bulan saat integrasi pertama jalan) yang dikabarkan,
//     supaya riwayat lama tidak membanjiri Productivity App.
//   - Id peristiwa deterministik → bila dikirim ulang, Productivity App mengabaikannya (idempoten).
//   - Privasi: TIDAK ada telepon, alamat, email, rekening, atau catatan bebas dalam data yang dikirim.
// =====================================================================
import crypto from 'crypto';

export const KONFIRMASI = 3;
const SO_AKTIF = ['Confirmed', 'Packed', 'Shipped', 'Invoiced']; // keputusan owner: dihitung sejak SO Dikonfirmasi
const PO_AKTIF = ['Menunggu Konfirmasi', 'Diproses', 'Dikirim', 'Tanda Terima', 'Selesai'];
const PO_DITERIMA = ['Tanda Terima', 'Selesai'];
const JENIS_PELANGGAN = ['Agen', 'Dropshipper', 'Customer', 'Mitra', 'RPH']; // urutan prioritas bila kontak punya beberapa kategori
const JATUH_TEMPO_HARI_DEPAN = 3; // kabar tagihan muncul 3 hari sebelum jatuh tempo
const JATUH_TEMPO_HARI_LEWAT = 90; // tagihan yang lewat lebih dari 90 hari sebelum integrasi aktif tidak dibuatkan tugas

// ---------- util tanggal (WIB) ----------
const WIB = 7 * 3600 * 1000;
export function keMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000; // drizzle 'timestamp' = detik
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
export function tglWib(v) { const ms = keMs(v); return ms === null ? null : new Date(ms + WIB).toISOString().slice(0, 10); }
function jamWib(v) { const ms = keMs(v); if (ms === null) return ''; const hm = new Date(ms + WIB).toISOString().slice(11, 16); return hm === '00:00' ? '' : hm; }
export function isoWib(ms) { return new Date(ms + WIB).toISOString().replace(/\.\d{3}Z$/, '+07:00'); }
function tambahHari(tgl, n) { const d = new Date(`${tgl}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function selisihHari(a, b) { return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5); }

const angka = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const bulat = (v, d = 2) => Math.round(angka(v) * 10 ** d) / 10 ** d;
const sidik = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 10);
const aman = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

function kategori(c) {
  let cats = [];
  try { cats = JSON.parse(c?.categories || '[]'); } catch { cats = []; }
  if (!Array.isArray(cats) || !cats.length) cats = c?.contact_type ? [c.contact_type] : [];
  return cats;
}
// Jenis pelanggan dikirim APA ADANYA dari kategori ERP (keputusan owner: semua dipetakan manual di Productivity App).
export function jenisPelanggan(c) {
  const cats = kategori(c);
  for (const j of JENIS_PELANGGAN) if (cats.includes(j)) return j.toLowerCase();
  return String(c?.contact_type || cats[0] || 'lain').toLowerCase();
}

// ---------- pembaca data (satu kali per pindai) ----------
function baca(db) {
  const tabelAda = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  const semua = (t, sql) => (tabelAda.has(t) ? db.prepare(sql).all() : []);
  const kontak = new Map(semua('contacts', 'SELECT id, code, display_name, contact_type, categories, created_at, archived_at FROM contacts').map((r) => [r.id, r]));
  const produk = new Map(semua('products', 'SELECT id, sku FROM products').map((r) => [r.id, r]));
  const kelompok = (rows, k) => { const m = new Map(); for (const r of rows) { if (!m.has(r[k])) m.set(r[k], []); m.get(r[k]).push(r); } return m; };
  return {
    kontak, produk,
    so: semua('sales_order', 'SELECT * FROM sales_order'),
    soItem: kelompok(semua('sales_order_items', 'SELECT sales_order_id, product_id, weight, shipped_weight, received_weight FROM sales_order_items'), 'sales_order_id'),
    sj: semua('surat_jalan', 'SELECT id, sj_number, sales_order_id, delivery_date, created_at FROM surat_jalan'),
    terima: kelompok(semua('sales_order_receipts', 'SELECT sales_order_id, received_date, total_ordered_weight, total_shrinkage_weight FROM sales_order_receipts'), 'sales_order_id'),
    bayar: semua('sales_payments', 'SELECT id, sales_order_id, payment_date, amount FROM sales_payments'),
    po: semua('purchase_order', 'SELECT * FROM purchase_order'),
    poItem: kelompok(semua('purchase_order_items', 'SELECT purchase_order_id, weight, received_weight, tally_weight FROM purchase_order_items'), 'purchase_order_id'),
    rekap: semua('bill_recaps', 'SELECT id, recap_number, title, status, total_amount, submitted_at, paid_at, created_at FROM bill_recaps'),
    rekapItem: kelompok(semua('bill_recap_items', 'SELECT recap_id, doc_type, doc_id FROM bill_recap_items'), 'recap_id'),
    stok: semua('inventory_stock', "SELECT weight FROM inventory_stock WHERE status IN ('active','allocated','opened') AND archived_at IS NULL"),
    semuaTerima: semua('sales_order_receipts', 'SELECT received_date, total_ordered_weight, total_shrinkage_weight FROM sales_order_receipts'),
  };
}

// kg penjualan: berat pesan; setelah kirim memakai berat kirim (atau berat terima bila dasar faktur = diterima).
function kgSo(so, items) {
  const kirim = ['Shipped', 'Invoiced'].includes(so.pipeline_status);
  let kg = 0;
  for (const it of items || []) {
    let w = angka(it.weight);
    if (kirim && angka(it.shipped_weight) > 0) w = angka(it.shipped_weight);
    if (kirim && so.invoice_weight_basis === 'received' && angka(it.received_weight) > 0) w = angka(it.received_weight);
    kg += w;
  }
  return bulat(kg);
}
const nilaiSo = (so) => bulat(so.markup_enabled ? (angka(so.real_amount) || angka(so.total_amount)) : angka(so.total_amount), 0);
const sisaSo = (so) => Math.max(0, bulat(nilaiSo(so) - angka(so.paid_amount), 0));
const sisaPo = (po) => Math.max(0, bulat(angka(po.total_amount) - angka(po.paid_amount), 0));

/**
 * @param db     better-sqlite3 (cermin ERP)
 * @param state  Map<key, object> keadaan terakhir yang sudah dikabarkan (dimutasi di tempat; yang berubah ada di `berubah`)
 * @param ctx    { nowMs, mulai: 'YYYY-MM-DD', uji: bool, ringkasanSudah: (tgl) => bool }
 * @returns { peristiwa: [], berubah: Set<key>, ringkasan: tgl|null }
 */
export function pindai(db, state, ctx) {
  const d = baca(db);
  const nowMs = ctx.nowMs;
  const hariIni = tglWib(nowMs);
  const mulai = ctx.mulai;
  const peristiwa = [];
  const berubah = new Set();
  const lihat = new Set();
  const st = (k) => { if (!state.has(k)) state.set(k, {}); return state.get(k); };
  const tandai = (k) => berubah.add(k);
  const kabar = (jenis, kunci, data) => {
    peristiwa.push({ id: `erp_${jenis.replace('.', '_')}_${aman(kunci)}_${sidik(data)}`, jenis, waktu: isoWib(nowMs), uji: !!ctx.uji, data });
  };
  // Konfirmasi perubahan mundur: true setelah terlihat KONFIRMASI kali berturut-turut.
  const mundur = (s, k, kondisi) => {
    if (!kondisi) { if (s.mundur) { s.mundur = 0; tandai(k); } return false; }
    s.mundur = (s.mundur || 0) + 1; tandai(k);
    if (s.mundur < KONFIRMASI) return false;
    s.mundur = 0; return true;
  };
  const pihak = (id) => { const c = d.kontak.get(id); return c ? { kode: c.code, nama: c.display_name } : { kode: null, nama: null }; };

  // ---------------- Penjualan (SO) ----------------
  const soById = new Map(d.so.map((r) => [r.id, r]));
  for (const so of d.so) {
    const k = `so:${so.id}`; lihat.add(k);
    const s = state.get(k);
    const tanggal = tglWib(so.order_date);
    const aktif = SO_AKTIF.includes(so.pipeline_status) && tanggal && tanggal >= mulai && !so.archived_at;
    if (aktif) {
      const c = d.kontak.get(so.customer_id) || {};
      const sales = so.sales_contact_id ? d.kontak.get(so.sales_contact_id) : null;
      const items = d.soItem.get(so.id) || [];
      const ss = st(k);
      if (ss.mundur) { ss.mundur = 0; tandai(k); }
      const noRef = ss.noRef || (ss.gen ? `${so.so_number}-R${ss.gen}` : so.so_number);
      const data = {
        no_faktur: noRef, no_so: so.so_number, no_invoice: so.invoice_number || null, status: so.pipeline_status, tanggal,
        pelanggan: { kode: c.code || null, nama: c.display_name || null, jenis: jenisPelanggan(c) },
        sales_kode: sales ? sales.code : null, total_kg: kgSo(so, items), nilai_rp: nilaiSo(so),
        items: items.map((it) => ({ produk_kode: d.produk.get(it.product_id)?.sku || null, kg: bulat(it.weight) })),
      };
      const sig = sidik({ ...data, status: undefined });
      if (!ss.dikirim || ss.sig !== sig) { kabar('penjualan.dibuat', `${noRef}`, data); Object.assign(ss, { dikirim: true, sig, noRef }); tandai(k); }
    } else if (s?.dikirim) {
      const turun = so.pipeline_status === 'Cancelled' || so.pipeline_status === 'Draft';
      if (mundur(s, k, turun)) {
        kabar('penjualan.batal', s.noRef, { no_faktur: s.noRef, no_so: so.so_number, alasan: so.pipeline_status === 'Cancelled' ? 'SO dibatalkan di ERP' : 'SO dikembalikan ke Draft di ERP' });
        Object.assign(s, { dikirim: false, sig: null, noRef: null, gen: (s.gen || 0) + 1 }); tandai(k);
      }
    }
  }

  // ---------------- Pengiriman (Surat Jalan) ----------------
  for (const sj of d.sj) {
    const k = `sj:${sj.id}`; lihat.add(k);
    const so = soById.get(sj.sales_order_id); if (!so) continue;
    const tKirim = tglWib(sj.delivery_date) || tglWib(sj.created_at);
    const ss = state.get(k);
    if (!ss && (!tKirim || tKirim < mulai)) continue;
    const s = st(k);
    if (!s.dibuat) {
      const c = d.kontak.get(so.customer_id) || {};
      const items = d.soItem.get(so.id) || [];
      const kg = bulat(items.reduce((a, it) => a + (angka(it.shipped_weight) || angka(it.weight)), 0));
      kabar('pengiriman.dibuat', sj.sj_number, { no_do: sj.sj_number, no_faktur: so.so_number, tanggal_kirim: tKirim, jam: jamWib(sj.delivery_date), pelanggan: { kode: c.code || null, nama: c.display_name || null }, total_kg: kg, catatan: '' });
      s.dibuat = true; tandai(k);
    }
    const rc = d.terima.get(so.id) || [];
    if (!s.selesai && (rc.length || so.pipeline_status === 'Invoiced')) {
      const w = rc.length ? Math.max(...rc.map((r) => keMs(r.received_date) || 0)) : nowMs;
      kabar('pengiriman.selesai', sj.sj_number, { no_do: sj.sj_number, waktu_selesai: isoWib(w || nowMs) });
      s.selesai = true; tandai(k);
    }
  }

  // ---------------- Pelanggan baru ----------------
  for (const c of d.kontak.values()) {
    const cats = kategori(c);
    if (!['Customer', 'Agen', 'Dropshipper'].some((x) => cats.includes(x)) || c.archived_at) continue;
    const k = `ct:${c.id}`; lihat.add(k);
    const t = tglWib(c.created_at);
    if (state.get(k)?.dibuat || !t || t < mulai) continue;
    kabar('pelanggan.dibuat', c.code, { kode: c.code, nama: c.display_name, jenis: jenisPelanggan(c), tanggal_aktif: t });
    st(k).dibuat = true; tandai(k);
  }

  // ---------------- Pembayaran diterima (SO) ----------------
  for (const p of d.bayar) {
    const k = `pay:${p.id}`; lihat.add(k);
    const t = tglWib(p.payment_date);
    if (state.get(k)?.dibuat || !t || t < mulai) continue;
    const so = soById.get(p.sales_order_id); const c = so ? d.kontak.get(so.customer_id) : null;
    kabar('pembayaran.diterima', p.id, { pelanggan_kode: c?.code || null, nilai_rp: bulat(p.amount, 0), tanggal: t, no_so: so?.so_number || null });
    st(k).dibuat = true; tandai(k);
  }

  // ---------------- Pembelian (PO) ----------------
  for (const po of d.po) {
    const k = `po:${po.id}`; lihat.add(k);
    const s = state.get(k);
    const tanggal = tglWib(po.order_date);
    const aktif = PO_AKTIF.includes(po.pipeline_status) && tanggal && tanggal >= mulai && !po.archived_at;
    if (aktif) {
      const ss = st(k); if (ss.mundur) { ss.mundur = 0; tandai(k); }
      const items = d.poItem.get(po.id) || [];
      if (!ss.dibuat) {
        kabar('pembelian.dibuat', po.po_number, {
          no_po: po.po_number, tanggal, tanggal_datang: tglWib(po.expected_date) || tanggal, jenis_po: po.po_type || null,
          supplier: pihak(po.supplier_id), total_kg: bulat(items.reduce((a, it) => a + angka(it.weight), 0)), nilai_rp: bulat(po.total_amount, 0), dropship: !!po.is_dropship,
        });
        Object.assign(ss, { dibuat: true, diterima: false, noPo: po.po_number }); tandai(k);
      }
      if (PO_DITERIMA.includes(po.pipeline_status) && !ss.diterima) {
        kabar('pembelian.diterima', po.po_number, { no_po: po.po_number, tanggal: hariIni, total_kg_diterima: bulat(items.reduce((a, it) => a + (angka(it.received_weight) || angka(it.tally_weight)), 0)) });
        ss.diterima = true; tandai(k);
      }
    } else if (s?.dibuat) {
      const turun = po.pipeline_status === 'Dibatalkan' || po.pipeline_status === 'Draft';
      if (mundur(s, k, turun)) {
        kabar('pembelian.batal', `${po.po_number}_${(s.gen || 0) + 1}`, { no_po: po.po_number, alasan: po.pipeline_status === 'Dibatalkan' ? 'PO dibatalkan di ERP' : 'PO dikembalikan ke Draft di ERP' });
        Object.assign(s, { dibuat: false, diterima: false, gen: (s.gen || 0) + 1 }); tandai(k);
      }
    }
  }

  // ---------------- Rekap tagihan ----------------
  const poById = new Map(d.po.map((r) => [r.id, r]));
  for (const r of d.rekap) {
    const k = `rk:${r.id}`; lihat.add(k);
    const s = state.get(k);
    const tAju = tglWib(r.submitted_at) || tglWib(r.created_at);
    const naik = (r.status === 'diajukan' || r.status === 'dibayar') && tAju && tAju >= mulai;
    if (naik) {
      const ss = st(k); if (ss.mundur) { ss.mundur = 0; tandai(k); }
      if (!ss.diajukan) {
        const sup = new Set((d.rekapItem.get(r.id) || []).filter((x) => x.doc_type === 'PO').map((x) => poById.get(x.doc_id)?.supplier_id).filter(Boolean));
        kabar('rekap.diajukan', `${r.recap_number}_${ss.gen || 0}`, { no_rekap: r.recap_number, tanggal: tAju, judul: r.title || null, total_rp: bulat(r.total_amount, 0), jumlah_supplier: sup.size });
        ss.diajukan = true; tandai(k);
      }
      if (r.status === 'dibayar' && !ss.dibayar) {
        kabar('rekap.dibayar', `${r.recap_number}_${ss.gen || 0}`, { no_rekap: r.recap_number, tanggal: tglWib(r.paid_at) || hariIni });
        ss.dibayar = true; tandai(k);
      }
    } else if (s?.diajukan && !s.dibayar) {
      if (mundur(s, k, r.status === 'draft' || r.status === 'dihapus')) {
        kabar('rekap.dibatalkan', `${r.recap_number}_${s.gen || 0}`, { no_rekap: r.recap_number, alasan: r.status === 'dihapus' ? 'Rekap dihapus' : 'Pengajuan rekap dibatalkan' });
        Object.assign(s, { diajukan: false, gen: (s.gen || 0) + 1 }); tandai(k);
      }
    }
  }

  // ---------------- Tagihan jatuh tempo (piutang SO & utang PO) ----------------
  const batasDepan = tambahHari(hariIni, JATUH_TEMPO_HARI_DEPAN);
  const batasLewat = tambahHari(hariIni, -JATUH_TEMPO_HARI_LEWAT);
  const tagihan = (k, arah, no, pihakObj, sisa, jt, lunas) => {
    lihat.add(k);
    const s = state.get(k);
    if (s?.jt) {
      if (lunas && !s.lunas) { kabar('tagihan.lunas', `${arah}_${no}`, { arah, no_ref: no }); s.lunas = true; tandai(k); }
      return;
    }
    if (lunas || !jt || jt > batasDepan || jt < batasLewat) return;
    kabar('tagihan.jatuh_tempo', `${arah}_${no}`, { arah, no_ref: no, pihak: pihakObj, sisa_rp: sisa, jatuh_tempo: jt });
    Object.assign(st(k), { jt: true, lunas: false }); tandai(k);
  };
  for (const so of d.so) {
    if (!so.invoice_number || !so.due_date || so.archived_at) continue;
    const lunas = so.pipeline_status === 'Cancelled' || so.payment_status === 'paid' || sisaSo(so) <= 0;
    tagihan(`tg:piutang:${so.id}`, 'piutang', so.invoice_number, pihak(so.customer_id), sisaSo(so), tglWib(so.due_date), lunas);
  }
  for (const po of d.po) {
    if (!po.due_date || po.archived_at || po.pipeline_status === 'Draft') continue;
    const lunas = po.pipeline_status === 'Dibatalkan' || po.payment_status === 'paid' || sisaPo(po) <= 0;
    tagihan(`tg:hutang:${po.id}`, 'hutang', po.po_number, pihak(po.supplier_id), sisaPo(po), tglWib(po.due_date), lunas);
  }

  // ---------------- Data yang hilang (dihapus / rollback total) ----------------
  for (const [k, s] of state) {
    if (lihat.has(k)) continue;
    if (k.startsWith('so:') && s.dikirim && mundur(s, k, true)) {
      kabar('penjualan.batal', s.noRef, { no_faktur: s.noRef, alasan: 'SO dihapus di ERP' });
      Object.assign(s, { dikirim: false, sig: null, noRef: null, gen: (s.gen || 0) + 1 }); tandai(k);
    } else if (k.startsWith('po:') && s.dibuat && s.noPo && mundur(s, k, true)) {
      kabar('pembelian.batal', `${s.noPo}_${(s.gen || 0) + 1}`, { no_po: s.noPo, alasan: 'PO dihapus di ERP' });
      Object.assign(s, { dibuat: false, diterima: false, gen: (s.gen || 0) + 1 }); tandai(k);
    }
  }

  // ---------------- Ringkasan harian (sekali per hari, setelah 06.00 WIB) ----------------
  let ringkasan = null;
  const jam = Number(new Date(nowMs + WIB).toISOString().slice(11, 13));
  if (jam >= 6 && !(ctx.ringkasanSudah && ctx.ringkasanSudah(hariIni))) {
    const lewat30 = new Set(); const lewat60 = new Set(); let nilai60 = 0;
    for (const so of d.so) {
      if (!so.invoice_number || so.pipeline_status === 'Cancelled' || so.archived_at || so.payment_status === 'paid') continue;
      const sisa = sisaSo(so); if (sisa <= 0) continue;
      const acuan = tglWib(so.due_date) || tglWib(so.invoice_date); if (!acuan) continue;
      const lewat = selisihHari(hariIni, acuan);
      if (lewat > 30) lewat30.add(so.customer_id);
      if (lewat > 60) { lewat60.add(so.customer_id); nilai60 += sisa; }
    }
    kabar('piutang.ringkasan', hariIni, { tanggal: hariIni, klien_lewat_30: lewat30.size, klien_lewat_60: lewat60.size, nilai_lewat_60_rp: bulat(nilai60, 0) });
    const bulan = hariIni.slice(0, 7); let pesan = 0, susut = 0;
    for (const r of d.semuaTerima) { if ((tglWib(r.received_date) || '').slice(0, 7) !== bulan) continue; pesan += angka(r.total_ordered_weight); susut += angka(r.total_shrinkage_weight); }
    kabar('stok.ringkasan', hariIni, { tanggal: hariIni, stok_kg: bulat(d.stok.reduce((a, r) => a + angka(r.weight), 0)), susut_pct_bulan_ini: pesan > 0 ? bulat((susut / pesan) * 100) : null });
    ringkasan = hariIni;
  }

  return { peristiwa, berubah, ringkasan };
}
