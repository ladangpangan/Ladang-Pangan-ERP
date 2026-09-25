// Definisi field Rekap Tagihan — dipakai bersama oleh API (validasi template) dan UI (pilihan kolom,
// render tabel, cetak, Excel). Tidak boleh import modul server di sini.

// type: text | date | weight | money | number
export const RECAP_FIELDS = {
  PO: [
    { key: 'no', label: 'No', type: 'number', group: 'Dokumen' },
    { key: 'date', label: 'Tgl', type: 'date', group: 'Dokumen', hint: 'Tanggal invoice (kalau kosong: tanggal PO)' },
    { key: 'poDate', label: 'Tgl PO', type: 'date', group: 'Dokumen' },
    { key: 'deliveryDate', label: 'Tgl Kirim', type: 'date', group: 'Dokumen', hint: 'Tanggal Surat Jalan SO dropship' },
    { key: 'invoiceNumber', label: 'No. Invoice', type: 'text', group: 'Dokumen', hint: 'No. invoice supplier di PO' },
    { key: 'poNumber', label: 'No. PO', type: 'text', group: 'Dokumen' },
    { key: 'soNumber', label: 'No. SO', type: 'text', group: 'Dokumen' },
    { key: 'customer', label: 'Customer', type: 'text', group: 'Tujuan' },
    { key: 'customerCity', label: 'Kota', type: 'text', group: 'Tujuan' },
    { key: 'shipAddress', label: 'Alamat Kirim', type: 'text', group: 'Tujuan' },
    { key: 'sku', label: 'Kode', type: 'text', group: 'Barang' },
    { key: 'item', label: 'Item', type: 'text', group: 'Barang' },
    { key: 'orderWeight', label: 'Order', type: 'weight', group: 'Berat' },
    { key: 'shippedWeight', label: 'Tonase (Dikirim)', type: 'weight', group: 'Berat' },
    { key: 'receivedWeight', label: 'Diterima', type: 'weight', group: 'Berat' },
    { key: 'shrinkage', label: 'Susut', type: 'weight', group: 'Berat', hint: 'Dikirim − Diterima' },
    { key: 'unitPrice', label: 'Harga', type: 'money', group: 'Nilai' },
    { key: 'total', label: 'Total Tagihan', type: 'money', group: 'Nilai' },
  ],
};

// Template bawaan (dipakai bila belum ada template tersimpan) — meniru rekap Excel tim.
export const DEFAULT_TEMPLATE = {
  PO: {
    id: 'builtin-PO',
    name: 'Standar (seperti Excel tim)',
    columns: ['no', 'date', 'invoiceNumber', 'customer', 'item', 'orderWeight', 'shippedWeight', 'receivedWeight', 'unitPrice', 'total'],
    options: { subtotalByDate: true },
    isDefault: true,
    builtin: true,
  },
};

export const RECAP_STATUS_LABEL = { draft: 'Draft', diajukan: 'Diajukan ke Finance', dibayar: 'Dibayar' };

export function fieldMap(docType = 'PO') {
  const m = {};
  for (const f of RECAP_FIELDS[docType] || []) m[f.key] = f;
  return m;
}

// Bersihkan daftar kolom dari key yang tidak dikenal/duplikat; 'total' selalu ikut (dasar rekap).
export function sanitizeColumns(columns, docType = 'PO') {
  const m = fieldMap(docType);
  const out = [];
  for (const k of Array.isArray(columns) ? columns : []) if (m[k] && !out.includes(k)) out.push(k);
  if (!out.includes('total')) out.push('total');
  return out;
}

export const fmtNum = (v, dec = 2) => (v == null || v === '' ? '' : Number(v).toLocaleString('id-ID', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
export const fmtRp = (v) => (v == null || v === '' ? '' : `Rp ${Math.round(Number(v)).toLocaleString('id-ID')}`);
export const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function formatCell(field, value) {
  if (!field) return value ?? '';
  if (field.type === 'date') return fmtDate(value);
  if (field.type === 'weight') return fmtNum(value, 2);
  if (field.type === 'money') return value == null ? '' : Math.round(Number(value)).toLocaleString('id-ID');
  return value ?? '';
}
