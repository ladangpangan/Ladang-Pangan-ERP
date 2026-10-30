'use client';

import { format } from 'date-fns';
import { generateTallyBeritaAcaraPDF } from '@/lib/pdf/invoice';

// Jenis riwayat Tally: label + warna yang sama dengan layar Tally di HP.
export const TALLY_TYPES = [
  { key: 'in', label: 'Barang Masuk', short: 'Masuk', color: '#117956', bg: '#EDF8F3', fg: '#0D6346', refHead: 'Sumber', link: (d) => (d.refType === 'PO' ? `/dashboard/purchase-orders/${d.refId}` : d.refType === 'WO' ? `/dashboard/work-orders/${d.refId}` : null), linkLabel: (d) => (d.refType === 'PO' ? 'Buka PO' : d.refType === 'WO' ? 'Buka WO' : null) },
  { key: 'out', label: 'Barang Keluar', short: 'Keluar', color: '#C2410C', bg: '#FFF7ED', fg: '#9A3412', refHead: 'Pesanan', link: (d) => `/dashboard/sales-orders/${d.refId}`, linkLabel: () => 'Buka SO' },
  { key: 'op', label: 'Stock Opname', short: 'Opname', color: '#1D4ED8', bg: '#EFF6FF', fg: '#1E40AF', refHead: 'Nomor opname', link: () => '/dashboard/inventory/opnames', linkLabel: () => 'Buka Stock Opname' },
  { key: 'wo', label: 'Produksi', short: 'Produksi', color: '#7C3AED', bg: '#F5F3FF', fg: '#5B21B6', refHead: 'Work Order', link: (d) => `/dashboard/work-orders/${d.refId}`, linkLabel: () => 'Buka WO' },
];
export const tallyType = (key) => TALLY_TYPES.find(t => t.key === key) || TALLY_TYPES[0];

export const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ymd = (d) => format(d, 'yyyy-MM-dd');

// Rentang tanggal untuk pilihan periode.
export function periodRange(period) {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period === 'today') return { from: ymd(start), to: ymd(now) };
  if (period === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
  const days = period === '30' ? 29 : 6;
  start.setDate(start.getDate() - days);
  return { from: ymd(start), to: ymd(now) };
}

export async function fetchTallyDetail(type, id) {
  const res = await fetch(`/api/tally-history/${type}/${encodeURIComponent(id)}`, { credentials: 'include' });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'Gagal memuat riwayat');
  return j.data;
}

// Buka berita acara (PDF) lewat dialog pratinjau.
export async function openBeritaAcara(pdfPreview, type, id, detail) {
  const d = detail || await fetchTallyDetail(type, id);
  const doc = generateTallyBeritaAcaraPDF(d);
  const name = `BeritaAcara_${tallyType(type).short}_${String(d.ref || '').replace(/[^\w-]+/g, '-')}_${d.at ? format(new Date(d.at), 'yyyyMMdd') : ''}.pdf`;
  pdfPreview.show(doc, name, `Berita Acara ${tallyType(type).label}`);
}
