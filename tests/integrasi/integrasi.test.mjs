// Uji integrasi Productivity App (pengirim di ERP).
//   node --test tests/integrasi/integrasi.test.mjs
// Opsional uji ujung-ke-ujung ke PENERIMA ASLI Productivity App:
//   PRODUKTIVITAS_APP_DIR=/path/ke/app node --test tests/integrasi/integrasi.test.mjs
// Memakai SQLite sementara dengan kolom-kolom yang dibaca pemindai (bukan DB produksi), penyimpanan memori.
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { pindai, KONFIRMASI, tglWib } from '../../lib/integrasi/pemindai.js';
import { buatPenyimpananMemori } from '../../lib/integrasi/penyimpanan.js';
import { kirimAntrean, tandaTangan, JEDA_MENIT } from '../../lib/integrasi/pengirim.js';
import { satuPutaran, bacaKonfig } from '../../lib/integrasi/jalan.js';

const detik = (iso) => Math.floor(Date.parse(iso) / 1000);
// "Sekarang" tetap: Senin 19 Okt 2026 10.00 WIB
const NOW = Date.parse('2026-10-19T03:00:00Z');
const MULAI = '2026-10-01';

function dbBaru() {
  const db = new Database(':memory:');
  db.exec(`
CREATE TABLE contacts (id TEXT PRIMARY KEY, code TEXT, display_name TEXT, contact_type TEXT, categories TEXT, phone TEXT, address TEXT, created_at INTEGER, archived_at INTEGER);
CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT);
CREATE TABLE sales_order (id TEXT PRIMARY KEY, customer_id TEXT, so_number TEXT, order_date INTEGER, pipeline_status TEXT, invoice_weight_basis TEXT DEFAULT 'shipped', archived_at INTEGER,
  total_amount REAL DEFAULT 0, paid_amount REAL DEFAULT 0, payment_status TEXT DEFAULT 'unpaid', invoice_number TEXT, invoice_date INTEGER, due_date INTEGER, markup_enabled INTEGER DEFAULT 0, real_amount REAL DEFAULT 0, sales_contact_id TEXT, notes TEXT);
CREATE TABLE sales_order_items (id TEXT PRIMARY KEY, sales_order_id TEXT, product_id TEXT, weight REAL, shipped_weight REAL DEFAULT 0, received_weight REAL DEFAULT 0);
CREATE TABLE surat_jalan (id TEXT PRIMARY KEY, sj_number TEXT, sales_order_id TEXT, delivery_date INTEGER, ship_to_phone TEXT, ship_to_address TEXT, created_at INTEGER);
CREATE TABLE sales_order_receipts (id TEXT PRIMARY KEY, sales_order_id TEXT, received_date INTEGER, total_ordered_weight REAL, total_shrinkage_weight REAL);
CREATE TABLE sales_payments (id TEXT PRIMARY KEY, sales_order_id TEXT, payment_date INTEGER, amount REAL);
CREATE TABLE purchase_order (id TEXT PRIMARY KEY, supplier_id TEXT, po_number TEXT, po_type TEXT, order_date INTEGER, expected_date INTEGER, pipeline_status TEXT, is_dropship INTEGER DEFAULT 0, archived_at INTEGER,
  total_amount REAL DEFAULT 0, paid_amount REAL DEFAULT 0, payment_status TEXT DEFAULT 'unpaid', due_date INTEGER, notes TEXT);
CREATE TABLE purchase_order_items (id TEXT PRIMARY KEY, purchase_order_id TEXT, weight REAL, received_weight REAL DEFAULT 0, tally_weight REAL DEFAULT 0);
CREATE TABLE bill_recaps (id TEXT PRIMARY KEY, recap_number TEXT, title TEXT, status TEXT, total_amount REAL, submitted_at INTEGER, paid_at INTEGER, created_at INTEGER);
CREATE TABLE bill_recap_items (id TEXT PRIMARY KEY, recap_id TEXT, doc_type TEXT, doc_id TEXT);
CREATE TABLE inventory_stock (id TEXT PRIMARY KEY, weight REAL, status TEXT, archived_at INTEGER);
`);
  const ins = (t, o) => db.prepare(`INSERT INTO ${t} (${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`).run(...Object.values(o));
  ins('contacts', { id: 'c1', code: 'CUS-0001', display_name: 'Dapur Kediri', contact_type: 'Customer', categories: '["Customer"]', phone: '08123', address: 'Jl. Rahasia 1', created_at: detik('2026-10-05T02:00:00Z') });
  ins('contacts', { id: 'c2', code: 'AGN-0001', display_name: 'Agen Pasar Wage', contact_type: 'Agen', categories: '["Agen","Customer"]', created_at: detik('2026-09-01T02:00:00Z') });
  ins('contacts', { id: 'k1', code: 'KRY-0001', display_name: 'Rama', contact_type: 'Karyawan', categories: '["Karyawan"]', created_at: detik('2026-01-01T00:00:00Z') });
  ins('contacts', { id: 's1', code: 'SUP-0001', display_name: 'CV Phalosari', contact_type: 'Supplier', categories: '["Supplier"]', created_at: detik('2026-01-01T00:00:00Z') });
  ins('products', { id: 'p1', sku: 'AYM-KRK' });
  ins('inventory_stock', { id: 'st1', weight: 1500, status: 'active' }); ins('inventory_stock', { id: 'st2', weight: 500, status: 'allocated' }); ins('inventory_stock', { id: 'st3', weight: 999, status: 'used' });
  return { db, ins, set: (t, id, o) => db.prepare(`UPDATE ${t} SET ${Object.keys(o).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(o), id) };
}

const jenis = (r) => r.peristiwa.map((p) => p.jenis);
const cari = (r, j) => r.peristiwa.filter((p) => p.jenis === j);
const tanpaPelanggan = (r) => r.peristiwa.filter((p) => p.jenis !== 'pelanggan.dibuat');
const ctx = (o = {}) => ({ nowMs: NOW, mulai: MULAI, uji: false, ringkasanSudah: () => true, ...o });

test('penjualan: dikirim sejak SO Dikonfirmasi; data sesuai kontrak; tanpa telepon/alamat; draft & data lama tidak dikirim', () => {
  const { db, ins, set } = dbBaru(); const state = new Map();
  ins('sales_order', { id: 'so1', customer_id: 'c1', so_number: 'SO/202610/0001', order_date: detik('2026-10-10T02:00:00Z'), pipeline_status: 'Draft', total_amount: 7500000, sales_contact_id: 'k1' });
  ins('sales_order_items', { id: 'i1', sales_order_id: 'so1', product_id: 'p1', weight: 250 });
  ins('sales_order', { id: 'lama', customer_id: 'c1', so_number: 'SO/202609/0099', order_date: detik('2026-09-20T02:00:00Z'), pipeline_status: 'Invoiced', total_amount: 1 });
  let r = pindai(db, state, ctx()); assert.equal(cari(r, 'penjualan.dibuat').length, 0, 'Draft & SO sebelum tanggal mulai tidak dikirim');
  set('sales_order', 'so1', { pipeline_status: 'Confirmed' });
  r = pindai(db, state, ctx()); const [p] = cari(r, 'penjualan.dibuat');
  assert.equal(p.data.no_faktur, 'SO/202610/0001'); assert.equal(p.data.tanggal, '2026-10-10'); assert.equal(p.data.total_kg, 250); assert.equal(p.data.nilai_rp, 7500000);
  assert.deepEqual(p.data.pelanggan, { kode: 'CUS-0001', nama: 'Dapur Kediri', jenis: 'customer' }, 'jenis = kategori ERP apa adanya (dipetakan manual di Productivity)');
  assert.equal(p.data.sales_kode, 'KRY-0001'); assert.deepEqual(p.data.items, [{ produk_kode: 'AYM-KRK', kg: 250 }]);
  assert.ok(!JSON.stringify(r.peristiwa).match(/08123|Rahasia/), 'telepon & alamat tidak pernah dikirim');
  assert.match(p.waktu, /\+07:00$/); assert.equal(p.uji, false);
  r = pindai(db, state, ctx()); assert.equal(cari(r, 'penjualan.dibuat').length, 0, 'tanpa perubahan = tanpa kabar');
  set('sales_order', 'so1', { pipeline_status: 'Packed' }); r = pindai(db, state, ctx()); assert.equal(r.peristiwa.length, 0, 'ganti status saja tidak mengubah angka → tidak dikirim ulang');
});

test('penjualan: perubahan kg/sales dikirim ulang dengan no_faktur sama (Productivity memperbarui); kg memakai berat kirim setelah Shipped', () => {
  const { db, ins, set } = dbBaru(); const state = new Map();
  ins('sales_order', { id: 'so1', customer_id: 'c2', so_number: 'SO/202610/0002', order_date: detik('2026-10-11T02:00:00Z'), pipeline_status: 'Confirmed', total_amount: 100 });
  ins('sales_order_items', { id: 'i1', sales_order_id: 'so1', product_id: 'p1', weight: 100 });
  let r = pindai(db, state, ctx()); assert.equal(cari(r, 'penjualan.dibuat')[0].data.sales_kode, null); assert.equal(cari(r, 'penjualan.dibuat')[0].data.pelanggan.jenis, 'agen');
  set('sales_order', 'so1', { sales_contact_id: 'k1' }); r = pindai(db, state, ctx()); const a = cari(r, 'penjualan.dibuat')[0];
  assert.equal(a.data.sales_kode, 'KRY-0001'); assert.equal(a.data.no_faktur, 'SO/202610/0002');
  set('sales_order_items', 'i1', { shipped_weight: 97.5 }); set('sales_order', 'so1', { pipeline_status: 'Shipped' });
  r = pindai(db, state, ctx()); assert.equal(cari(r, 'penjualan.dibuat')[0].data.total_kg, 97.5);
});

test('penjualan: batal baru dikirim setelah 3x pindai berturut-turut (pengaman cermin basi); dikonfirmasi ulang memakai nomor baru', () => {
  const { db, ins, set } = dbBaru(); const state = new Map();
  ins('sales_order', { id: 'so1', customer_id: 'c1', so_number: 'SO/202610/0003', order_date: detik('2026-10-12T02:00:00Z'), pipeline_status: 'Confirmed', total_amount: 10 });
  ins('sales_order_items', { id: 'i1', sales_order_id: 'so1', product_id: 'p1', weight: 10 });
  pindai(db, state, ctx());
  set('sales_order', 'so1', { pipeline_status: 'Draft' }); let r = pindai(db, state, ctx()); assert.equal(r.peristiwa.length, 0);
  set('sales_order', 'so1', { pipeline_status: 'Confirmed' }); r = pindai(db, state, ctx()); assert.equal(r.peristiwa.length, 0, 'kembali normal sebelum terkonfirmasi → tidak ada batal');
  set('sales_order', 'so1', { pipeline_status: 'Cancelled' });
  for (let i = 1; i < KONFIRMASI; i++) assert.equal(pindai(db, state, ctx()).peristiwa.length, 0);
  r = pindai(db, state, ctx()); assert.deepEqual(jenis(r), ['penjualan.batal']); assert.equal(r.peristiwa[0].data.no_faktur, 'SO/202610/0003');
  set('sales_order', 'so1', { pipeline_status: 'Confirmed' }); r = pindai(db, state, ctx());
  assert.equal(cari(r, 'penjualan.dibuat')[0].data.no_faktur, 'SO/202610/0003-R1', 'dikonfirmasi ulang = nomor baru (batal lama tetap batal)');
  db.prepare("DELETE FROM sales_order WHERE id = 'so1'").run();
  for (let i = 1; i < KONFIRMASI; i++) pindai(db, state, ctx());
  r = pindai(db, state, ctx()); assert.equal(cari(r, 'penjualan.batal')[0].data.no_faktur, 'SO/202610/0003-R1', 'SO dihapus → batal');
});

test('pengiriman: Surat Jalan → dibuat (jam WIB); penerimaan → selesai; pelanggan baru & pembayaran sekali saja', () => {
  const { db, ins } = dbBaru(); const state = new Map();
  ins('sales_order', { id: 'so1', customer_id: 'c1', so_number: 'SO/202610/0004', order_date: detik('2026-10-12T02:00:00Z'), pipeline_status: 'Shipped', total_amount: 10 });
  ins('sales_order_items', { id: 'i1', sales_order_id: 'so1', product_id: 'p1', weight: 300, shipped_weight: 298 });
  ins('surat_jalan', { id: 'sj1', sj_number: 'SJ/202610/0001', sales_order_id: 'so1', delivery_date: detik('2026-10-19T01:30:00Z'), ship_to_phone: '0899', ship_to_address: 'Jl. X', created_at: detik('2026-10-19T01:00:00Z') });
  ins('sales_payments', { id: 'pay1', sales_order_id: 'so1', payment_date: detik('2026-10-15T03:00:00Z'), amount: 5000000 });
  let r = pindai(db, state, ctx());
  const [k] = cari(r, 'pengiriman.dibuat'); assert.deepEqual({ no_do: k.data.no_do, tgl: k.data.tanggal_kirim, jam: k.data.jam, kg: k.data.total_kg }, { no_do: 'SJ/202610/0001', tgl: '2026-10-19', jam: '08:30', kg: 298 });
  assert.ok(!JSON.stringify(k).includes('0899'));
  assert.equal(cari(r, 'pelanggan.dibuat').length, 1, 'hanya pelanggan yang dibuat sejak tanggal mulai (Agen lama tidak)'); assert.equal(cari(r, 'pelanggan.dibuat')[0].data.kode, 'CUS-0001');
  assert.equal(cari(r, 'pembayaran.diterima')[0].data.nilai_rp, 5000000);
  ins('sales_order_receipts', { id: 'rc1', sales_order_id: 'so1', received_date: detik('2026-10-19T06:00:00Z'), total_ordered_weight: 298, total_shrinkage_weight: 3 });
  r = pindai(db, state, ctx()); assert.deepEqual(jenis(r), ['pengiriman.selesai']);
  assert.equal(pindai(db, state, ctx()).peristiwa.length, 0);
});

test('pembelian: PO → dibuat (Supplier, kg), Tanda Terima → diterima, Dibatalkan → batal (setelah konfirmasi); Draft tidak dikirim', () => {
  const { db, ins, set } = dbBaru(); const state = new Map();
  ins('purchase_order', { id: 'po1', supplier_id: 's1', po_number: 'PO/202610/0001', po_type: 'Produk Jadi', order_date: detik('2026-10-18T02:00:00Z'), expected_date: detik('2026-10-21T02:00:00Z'), pipeline_status: 'Draft', total_amount: 36000000 });
  ins('purchase_order_items', { id: 'pi1', purchase_order_id: 'po1', weight: 1200 });
  assert.equal(tanpaPelanggan(pindai(db, state, ctx())).length, 0);
  set('purchase_order', 'po1', { pipeline_status: 'Diproses' }); let r = pindai(db, state, ctx());
  assert.deepEqual(cari(r, 'pembelian.dibuat')[0].data, { no_po: 'PO/202610/0001', tanggal: '2026-10-18', tanggal_datang: '2026-10-21', jenis_po: 'Produk Jadi', supplier: { kode: 'SUP-0001', nama: 'CV Phalosari' }, total_kg: 1200, nilai_rp: 36000000, dropship: false });
  set('purchase_order', 'po1', { pipeline_status: 'Tanda Terima' }); set('purchase_order_items', 'pi1', { received_weight: 1190 });
  r = pindai(db, state, ctx()); assert.deepEqual(jenis(r), ['pembelian.diterima']); assert.equal(r.peristiwa[0].data.total_kg_diterima, 1190);
  ins('purchase_order', { id: 'po2', supplier_id: 's1', po_number: 'PO/202610/0002', order_date: detik('2026-10-18T02:00:00Z'), pipeline_status: 'Menunggu Konfirmasi', is_dropship: 1 });
  assert.equal(cari(pindai(db, state, ctx()), 'pembelian.dibuat')[0].data.dropship, true);
  set('purchase_order', 'po2', { pipeline_status: 'Dibatalkan' });
  for (let i = 1; i < KONFIRMASI; i++) assert.equal(pindai(db, state, ctx()).peristiwa.length, 0);
  assert.deepEqual(jenis(pindai(db, state, ctx())), ['pembelian.batal']);
});

test('rekap tagihan: diajukan → dibayar; pengajuan dibatalkan → dibatalkan (setelah konfirmasi); jumlah supplier dihitung', () => {
  const { db, ins, set } = dbBaru(); const state = new Map();
  ins('purchase_order', { id: 'po1', supplier_id: 's1', po_number: 'PO/202610/0001', order_date: detik('2026-09-18T02:00:00Z'), pipeline_status: 'Selesai' });
  ins('bill_recaps', { id: 'r1', recap_number: 'REK/202610/0007', title: 'TAGIHAN PHALOSARI', status: 'draft', total_amount: 36000000, created_at: detik('2026-10-18T02:00:00Z') });
  ins('bill_recap_items', { id: 'ri1', recap_id: 'r1', doc_type: 'PO', doc_id: 'po1' });
  assert.equal(tanpaPelanggan(pindai(db, state, ctx())).length, 0, 'draft tidak dikirim');
  set('bill_recaps', 'r1', { status: 'diajukan', submitted_at: detik('2026-10-19T02:00:00Z') });
  let r = pindai(db, state, ctx()); const idPertama = cari(r, 'rekap.diajukan')[0].id; assert.deepEqual(cari(r, 'rekap.diajukan')[0].data, { no_rekap: 'REK/202610/0007', tanggal: '2026-10-19', judul: 'TAGIHAN PHALOSARI', total_rp: 36000000, jumlah_supplier: 1 });
  set('bill_recaps', 'r1', { status: 'draft' }); for (let i = 1; i < KONFIRMASI; i++) pindai(db, state, ctx());
  r = pindai(db, state, ctx()); assert.deepEqual(jenis(r), ['rekap.dibatalkan']);
  set('bill_recaps', 'r1', { status: 'dibayar', paid_at: detik('2026-10-19T03:00:00Z') });
  r = pindai(db, state, ctx()); assert.deepEqual(jenis(r), ['rekap.diajukan', 'rekap.dibayar'], 'langsung dibayar → diajukan lalu dibayar, id berbeda dari pengajuan pertama');
  assert.notEqual(r.peristiwa[0].id, idPertama, 'pengajuan kedua = kabar baru (tidak dianggap duplikat oleh Productivity)');
});

test('tagihan jatuh tempo: piutang & utang dalam 3 hari / lewat ≤90 hari → sekali; lunas → lunas; yang jauh tidak', () => {
  const { db, ins, set } = dbBaru(); const state = new Map();
  ins('sales_order', { id: 'so1', customer_id: 'c1', so_number: 'SO/202609/0050', order_date: detik('2026-09-01T02:00:00Z'), pipeline_status: 'Invoiced', total_amount: 10000000, paid_amount: 2500000, invoice_number: 'INV/202609/0050', due_date: detik('2026-10-21T02:00:00Z') });
  ins('sales_order', { id: 'so2', customer_id: 'c1', so_number: 'SO/202609/0051', order_date: detik('2026-09-01T02:00:00Z'), pipeline_status: 'Invoiced', total_amount: 5, invoice_number: 'INV/202609/0051', due_date: detik('2026-11-30T02:00:00Z') });
  ins('sales_order', { id: 'so3', customer_id: 'c1', so_number: 'SO/202601/0001', order_date: detik('2026-01-01T02:00:00Z'), pipeline_status: 'Invoiced', total_amount: 5, invoice_number: 'INV/202601/0001', due_date: detik('2026-02-01T02:00:00Z') });
  ins('purchase_order', { id: 'po1', supplier_id: 's1', po_number: 'PO/202609/0010', order_date: detik('2026-09-01T02:00:00Z'), pipeline_status: 'Selesai', total_amount: 900, due_date: detik('2026-10-10T02:00:00Z') });
  let r = pindai(db, state, ctx()); const jt = cari(r, 'tagihan.jatuh_tempo');
  assert.deepEqual(jt.map((x) => [x.data.arah, x.data.no_ref, x.data.sisa_rp, x.data.jatuh_tempo]), [['piutang', 'INV/202609/0050', 7500000, '2026-10-21'], ['hutang', 'PO/202609/0010', 900, '2026-10-10']]);
  assert.equal(pindai(db, state, ctx()).peristiwa.length, 0, 'sekali saja');
  set('sales_order', 'so1', { paid_amount: 10000000, payment_status: 'paid' }); r = pindai(db, state, ctx());
  assert.deepEqual(r.peristiwa.map((x) => [x.jenis, x.data.no_ref]), [['tagihan.lunas', 'INV/202609/0050']]);
});

test('ringkasan harian: setelah 06.00 WIB, sekali per hari: piutang lewat 30/60 hari, stok kg, susut bulan ini', () => {
  const { db, ins } = dbBaru(); const state = new Map();
  ins('sales_order', { id: 'so1', customer_id: 'c1', so_number: 'A', order_date: 1, pipeline_status: 'Invoiced', total_amount: 4000000, invoice_number: 'INV-A', due_date: detik('2026-08-01T02:00:00Z') });
  ins('sales_order', { id: 'so2', customer_id: 'c2', so_number: 'B', order_date: 1, pipeline_status: 'Invoiced', total_amount: 100, invoice_number: 'INV-B', due_date: detik('2026-09-10T02:00:00Z') });
  ins('sales_order_receipts', { id: 'rc1', sales_order_id: 'so1', received_date: detik('2026-10-05T02:00:00Z'), total_ordered_weight: 1000, total_shrinkage_weight: 15 });
  ins('sales_order_receipts', { id: 'rc2', sales_order_id: 'so2', received_date: detik('2026-09-05T02:00:00Z'), total_ordered_weight: 1000, total_shrinkage_weight: 500 });
  const pagi = pindai(db, state, ctx({ nowMs: Date.parse('2026-10-18T22:00:00Z'), ringkasanSudah: () => false })); assert.equal(pagi.ringkasan, null, '05.00 WIB belum');
  const r = pindai(db, state, ctx({ ringkasanSudah: () => false }));
  assert.equal(r.ringkasan, '2026-10-19');
  assert.deepEqual(cari(r, 'piutang.ringkasan')[0].data, { tanggal: '2026-10-19', klien_lewat_30: 2, klien_lewat_60: 1, nilai_lewat_60_rp: 4000000 });
  assert.deepEqual(cari(r, 'stok.ringkasan')[0].data, { tanggal: '2026-10-19', stok_kg: 2000, susut_pct_bulan_ini: 1.5 });
  assert.equal(pindai(db, state, ctx({ ringkasanSudah: (t) => t === '2026-10-19' })).ringkasan, null);
});

test('waktu: tanggal & jam dihitung WIB (lewat tengah malam UTC)', () => {
  assert.equal(tglWib(detik('2026-10-18T18:30:00Z')), '2026-10-19');
  assert.equal(tglWib(Date.parse('2026-10-18T18:30:00Z')), '2026-10-19', 'milidetik juga dikenali');
});

test('pengirim: tanda tangan HMAC; urutan dijaga saat gagal; jeda 1/5/15/60 menit; 400 = gagal & lanjut; 24 jam = gagal', async () => {
  const store = buatPenyimpananMemori(); const rahasia = 'rahasia-uji-0123456789';
  await store.tambah([{ id: 'e1', jenis: 'a', waktu: 'w', uji: false, data: { x: 1 } }, { id: 'e2', jenis: 'b', waktu: 'w', uji: false, data: {} }], NOW);
  const masuk = []; let jawab = 503;
  const fetchFn = async (url, o) => { masuk.push({ url, o }); return { ok: jawab < 300, status: jawab, json: async () => ({ error: 'x' }) }; };
  let h = await kirimAntrean(store, { url: 'http://produktivitas:3000/api/integrasi/erp', rahasia, nowMs: NOW, fetchFn });
  assert.equal(masuk.length, 1, 'gagal pertama menghentikan antrean (urutan dijaga)'); assert.equal(h.tertunda, 2);
  const o = masuk[0].o; assert.equal(o.headers['X-LPI-Sumber'], 'erp'); assert.equal(o.headers['X-LPI-Tanda'], tandaTangan(rahasia, o.headers['X-LPI-Waktu'], o.body));
  assert.deepEqual(JSON.parse(o.body), { id: 'e1', jenis: 'a', waktu: 'w', uji: false, data: { x: 1 } });
  assert.equal(store._outbox[0].berikut_at, NOW + JEDA_MENIT[0] * 60000);
  h = await kirimAntrean(store, { url: 'u', rahasia, nowMs: NOW + 30000, fetchFn }); assert.equal(masuk.length, 1, 'belum waktunya');
  await kirimAntrean(store, { url: 'u', rahasia, nowMs: NOW + 61000, fetchFn }); assert.equal(store._outbox[0].berikut_at, NOW + 61000 + JEDA_MENIT[1] * 60000);
  jawab = 400; await kirimAntrean(store, { url: 'u', rahasia, nowMs: NOW + 3600e3, fetchFn });
  assert.equal(store._outbox[0].status, 'gagal'); assert.equal(store._outbox[1].status, 'gagal', 'isi ditolak → gagal, antrean lanjut');
  await store.tambah([{ id: 'e3', jenis: 'c', waktu: 'w', data: {} }], NOW); jawab = 500;
  await kirimAntrean(store, { url: 'u', rahasia, nowMs: NOW + 25 * 3600e3, fetchFn }); assert.equal(store._outbox[2].status, 'gagal', 'lewat 24 jam');
  await store.tambah([{ id: 'e4', jenis: 'd', waktu: 'w', data: {} }], NOW + 25 * 3600e3); jawab = 200;
  h = await kirimAntrean(store, { url: 'u', rahasia, nowMs: NOW + 25 * 3600e3, fetchFn }); assert.equal(h.terkirim, 1); assert.equal(store._outbox[3].status, 'terkirim');
  assert.equal((await kirimAntrean(store, { url: '', rahasia, nowMs: NOW, fetchFn })).terkirim, 0, 'tanpa URL tidak mengirim');
});

test('konfigurasi: rahasia < 16 karakter ditolak; integrasi mati bila rahasia & token kosong', () => {
  assert.equal(bacaKonfig({}).aktif, false);
  const c = bacaKonfig({ INTEGRASI_RAHASIA: 'pendek' }); assert.equal(c.rahasia, ''); assert.equal(c.rahasiaTerlaluPendek, true);
  const d = bacaKonfig({ INTEGRASI_RAHASIA: 'x'.repeat(20), INTEGRASI_URL: 'http://produktivitas:3000/api/integrasi/erp', INTEGRASI_MULAI: '2026-10-01', INTEGRASI_UJI: '1' });
  assert.equal(d.aktif, true); assert.equal(d.mulai, '2026-10-01'); assert.equal(d.uji, true);
});

test('putaran: tanggal mulai bawaan = awal bulan, disimpan sekali; outbox lalu state; kunci mencegah dua pod', async () => {
  const { db, ins } = dbBaru(); const store = buatPenyimpananMemori(); const cfg = bacaKonfig({ INTEGRASI_TOKEN: 't'.repeat(20) });
  ins('sales_order', { id: 'so1', customer_id: 'c1', so_number: 'SO/202610/0009', order_date: detik('2026-10-02T02:00:00Z'), pipeline_status: 'Confirmed', total_amount: 1 });
  const r1 = await satuPutaran({ store, db, cfg, nowMs: NOW, pemilik: 'A' }); assert.ok(r1.baru >= 1);
  assert.equal((await store.meta('mulai')).tgl, '2026-10-01');
  assert.deepEqual(await satuPutaran({ store, db, cfg, nowMs: NOW + 1000, pemilik: 'B' }), { dilewati: 'pod lain sedang memindai' });
  const r2 = await satuPutaran({ store, db, cfg, nowMs: NOW + 120000, pemilik: 'A' }); assert.equal(r2.baru, 0, 'state tersimpan → tidak dobel');
  assert.ok((await store.sejak(0)).every((e) => e.status === 'menunggu'), 'tanpa URL: tetap di antrean untuk ditarik');
});

// ---------------------------------------------------------------- ujung ke ujung (opsional)
const APP = process.env.PRODUKTIVITAS_APP_DIR;
test('UJUNG KE UJUNG: kabar ERP diterima & diolah oleh penerima asli Productivity App', { skip: !APP && 'set PRODUKTIVITAS_APP_DIR untuk menjalankan' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpi-e2e-'));
  Object.assign(process.env, { DATA_DIR: dir, APP_SECRET: 'rahasia-uji-0123456789abcdef', WA_ENABLED: 'false', COOKIE_SECURE: 'false' });
  const require = createRequire(path.join(APP, 'server.js'));
  const srv = require(path.join(APP, 'server.js'));
  const server = srv.app.listen(0); await new Promise((r) => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, json: await r.json().catch(() => null) }; };
  try {
    const RAHASIA = 'rahasia-bersama-erp-0123456789';
    assert.equal((await call('POST', '/api/setup', { memberId: 'lukman', pin: '1111' })).status, 200);
    assert.equal((await call('PUT', '/api/pengaturan/integrasi/erp', { aktif: true, rahasia: RAHASIA, kepalaGudangId: 'iqbal' })).status, 200);
    assert.equal((await call('PATCH', '/api/team/rama', { kodeErp: 'KRY-0001' })).status, 200);

    // Data ERP lengkap → pindai → kirim ke penerima asli (bukan tiruan)
    const { db, ins } = dbBaru(); const store = buatPenyimpananMemori();
    const hariIni = tglWib(Date.now()); const kini = Date.now();
    ins('sales_order', { id: 'so1', customer_id: 'c1', so_number: 'SO/E2E/0001', order_date: Math.floor(kini / 1000), pipeline_status: 'Confirmed', total_amount: 7500000, sales_contact_id: 'k1', invoice_number: 'INV/E2E/1', due_date: Math.floor(kini / 1000) + 86400 });
    ins('sales_order_items', { id: 'i1', sales_order_id: 'so1', product_id: 'p1', weight: 250 });
    ins('surat_jalan', { id: 'sj1', sj_number: 'SJ/E2E/0001', sales_order_id: 'so1', delivery_date: Math.floor(kini / 1000), created_at: Math.floor(kini / 1000) });
    ins('purchase_order', { id: 'po1', supplier_id: 's1', po_number: 'PO/E2E/0001', order_date: Math.floor(kini / 1000), pipeline_status: 'Diproses', total_amount: 36000000 });
    ins('purchase_order_items', { id: 'pi1', purchase_order_id: 'po1', weight: 1200 });
    ins('bill_recaps', { id: 'r1', recap_number: 'REK/E2E/0001', title: 'TAGIHAN PHALOSARI', status: 'diajukan', total_amount: 36000000, submitted_at: Math.floor(kini / 1000), created_at: Math.floor(kini / 1000) });
    const cfg = { ...bacaKonfig({ INTEGRASI_RAHASIA: RAHASIA, INTEGRASI_URL: `${base}/api/integrasi/erp`, INTEGRASI_MULAI: `${hariIni.slice(0, 7)}-01` }) };
    const h = await satuPutaran({ store, db, cfg, nowMs: kini, pemilik: 'e2e' });
    assert.equal(h.gagal, 0); assert.equal(h.terkirim, h.baru, `semua terkirim (${h.terkirim}/${h.baru})`);

    const ev = srv.db.prepare("SELECT jenis, status, galat FROM integrasi_peristiwa WHERE sumber = 'erp' ORDER BY id").all();
    assert.ok(ev.length >= 6); assert.ok(ev.every((e) => e.status === 'diolah' || e.status === 'perlu_dipetakan'), JSON.stringify(ev));
    const pj = srv.db.prepare("SELECT * FROM penjualan_eksternal WHERE no_ref = 'SO/E2E/0001'").get();
    assert.equal(pj.kg, 250); assert.equal(pj.orang_id, 'rama', 'kode sales ERP (kode kontak Karyawan) → orang di Productivity');
    assert.equal(pj.saluran_id, null, 'jenis "customer" belum dipetakan → antrean (keputusan: dipetakan manual)');
    const antre = (await call('GET', '/api/pengaturan/integrasi/antrean')).json.antrean; assert.ok(antre.some((a) => a.tipe === 'jenis_pelanggan' && a.kode === 'customer'));
    const tugas = (ref) => srv.db.prepare('SELECT assignee_id, title, status FROM tasks WHERE ref_eksternal = ?').get(ref);
    assert.equal(tugas('erp:pengiriman:SJ/E2E/0001').assignee_id, 'iqbal');
    assert.equal(tugas('erp:pembelian:PO/E2E/0001').assignee_id, 'natasha');
    assert.equal(tugas('erp:rekap:REK/E2E/0001').assignee_id, 'aulia');
    assert.match(tugas('erp:tagihan:piutang:INV/E2E/1').title, /^Tagih INV\/E2E\/1 · Dapur Kediri · Rp 7\.500\.000/);

    // Kiriman ulang (mis. setelah gagal jaringan) tidak menggandakan apa pun
    for (const e of store._outbox) e.status = 'menunggu';
    await kirimAntrean(store, { url: cfg.url, rahasia: RAHASIA, nowMs: Date.now() });
    assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM integrasi_peristiwa WHERE sumber = 'erp'").get().n, ev.length, 'idempoten');

    // Rahasia salah → 401 → ditahan untuk dikirim ulang (bukan dibuang)
    await store.tambah([{ id: 'erp_x_salah', jenis: 'pembayaran.diterima', waktu: new Date().toISOString(), uji: false, data: {} }], Date.now());
    const s = await kirimAntrean(store, { url: cfg.url, rahasia: 'rahasia-salah-0123456789', nowMs: Date.now() });
    assert.equal(s.terkirim, 0); assert.equal(store._outbox.at(-1).status, 'menunggu'); assert.match(store._outbox.at(-1).galat, /^401/);
  } finally { server.close(); srv.db.close(); }
});
