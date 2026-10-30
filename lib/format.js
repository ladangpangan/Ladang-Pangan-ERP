// Format angka standar ERP LPI (kamus istilah paket A):
//   Rupiah  : Rp 2.520.000   (spasi tak-putus, jadi "Rp" tidak terpisah dari angkanya)
//   Berat   : 1.234,5 kg
//   Tanggal : 30 Okt 2026
const NBSP = ' ';

export function fmtNum(n, digits = 1) {
  return Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtKg(n, digits = 1) {
  return `${fmtNum(n, digits)}${NBSP}kg`;
}

// Rupiah; minus ditulis "−Rp 1.000" (bukan dalam kurung).
export function fmtRp(n) {
  const v = Math.round(Number(n || 0));
  return `${v < 0 ? '−' : ''}Rp${NBSP}${Math.abs(v).toLocaleString('id-ID')}`;
}

export function fmtPct(n, digits = 1) {
  return `${fmtNum(n, digits)}%`;
}
