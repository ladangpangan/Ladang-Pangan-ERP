'use client';

// Formatting & shared helpers for the Accounting UI (client-side).
export const fmtRp = (n) => {
  const num = Math.round(Number(n) || 0);
  const neg = num < 0;
  return (neg ? '(Rp ' : 'Rp ') + Math.abs(num).toLocaleString('id-ID') + (neg ? ')' : '');
};

export const fmtNum = (n) => (Number(n) || 0).toLocaleString('id-ID');

export const fmtDate = (sec) => {
  if (!sec) return '-';
  const d = new Date(Number(sec) * 1000);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const acctFetcher = (u) => fetch(u, { credentials: 'include' }).then((r) => r.json());

export const TYPE_LABEL = {
  asset: 'Aset', liability: 'Liabilitas', equity: 'Ekuitas', revenue: 'Pendapatan',
  cogs: 'HPP', expense: 'Beban Operasional', other_income: 'Pendapatan Lain', other_expense: 'Beban Lain',
};

export const TYPE_COLOR = {
  asset: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  liability: 'bg-amber-100 text-amber-700 border-amber-200',
  equity: 'bg-purple-100 text-purple-700 border-purple-200',
  revenue: 'bg-blue-100 text-blue-700 border-blue-200',
  cogs: 'bg-orange-100 text-orange-700 border-orange-200',
  expense: 'bg-rose-100 text-rose-700 border-rose-200',
  other_income: 'bg-sky-100 text-sky-700 border-sky-200',
  other_expense: 'bg-red-100 text-red-700 border-red-200',
};

export const SOURCE_LABEL = {
  MANUAL: 'Manual', OPENING: 'Saldo Awal', SO_INV: 'Faktur Jual', PO_INV: 'Faktur Beli',
  SPAY: 'Terima Bayar', PPAY: 'Bayar Supplier', SRET: 'Retur Jual', PRET: 'Retur Beli',
  OPN: 'Opname', WO: 'Produksi', DEPR: 'Penyusutan', CLOSING: 'Tutup Buku',
  EXPENSE: 'Pengeluaran', INCOME: 'Pemasukan', CAPITAL: 'Setor Modal', DRAWING: 'Prive', TRANSFER: 'Transfer',
};

export const SOURCE_COLOR = {
  MANUAL: 'bg-slate-100 text-slate-700',
  OPENING: 'bg-purple-100 text-purple-700',
  SO_INV: 'bg-blue-100 text-blue-700',
  PO_INV: 'bg-amber-100 text-amber-700',
  SPAY: 'bg-emerald-100 text-emerald-700',
  PPAY: 'bg-orange-100 text-orange-700',
  SRET: 'bg-rose-100 text-rose-700',
  PRET: 'bg-red-100 text-red-700',
  OPN: 'bg-cyan-100 text-cyan-700',
  WO: 'bg-indigo-100 text-indigo-700',
  DEPR: 'bg-fuchsia-100 text-fuchsia-700',
  CLOSING: 'bg-gray-200 text-gray-700',
  EXPENSE: 'bg-rose-100 text-rose-700',
  INCOME: 'bg-emerald-100 text-emerald-700',
  CAPITAL: 'bg-teal-100 text-teal-700',
  DRAWING: 'bg-orange-100 text-orange-700',
  TRANSFER: 'bg-sky-100 text-sky-700',
};

// Default date range: 1 Jan current year -> today (yyyy-mm-dd strings)
export const defaultRange = () => {
  const y = new Date().getFullYear();
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    from: `${y}-01-01`,
    to: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
  };
};

export const todayStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
