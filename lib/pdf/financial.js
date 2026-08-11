// PDF generators for financial statements (SAK EP) with shared letterhead + theme.
// Company profile & PDF settings come from lib/pdf/theme.js.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawDocHeader, drawFooter, tableHeadStyle, accentRGB, tint } from './theme';

const rp = (n) => {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? `(Rp ${Math.abs(v).toLocaleString('id-ID')})` : `Rp ${v.toLocaleString('id-ID')}`;
};
const pct = (cur, prev) => {
  const c = Number(cur) || 0, p = Number(prev) || 0;
  if (p === 0) return c === 0 ? '0%' : '+100%';
  const v = (c - p) / Math.abs(p) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

const BODY_STYLE = { fontSize: 8.6, cellPadding: 1.6, lineColor: [228, 228, 228] };
const tSection = () => tint(accentRGB(), 0.9);
const tStrong = () => tint(accentRGB(), 0.8);

/* --------- NERACA (Balance Sheet) --------- */
export function balanceSheetPDF(d, company, asOfLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawDocHeader(doc, { title: 'LAPORAN POSISI KEUANGAN (NERACA)', subtitle: `Per ${asOfLabel}`, company, centered: true });
  const sec = tSection(); const strong = tStrong();
  const body = [];
  const side = (label, sSide) => {
    body.push([{ content: label.toUpperCase(), colSpan: 2, styles: { fontStyle: 'bold', fillColor: sec } }]);
    (sSide.groups || []).forEach((g) => {
      body.push([{ content: g.category, colSpan: 2, styles: { fontStyle: 'bold', textColor: [60, 60, 60] } }]);
      (g.items || []).forEach((it) => body.push([`    ${it.code}  ${it.name}`, { content: rp(it.amount), styles: { halign: 'right' } }]));
      body.push([{ content: `    Subtotal ${g.category}`, styles: { fontStyle: 'italic' } }, { content: rp(g.total), styles: { halign: 'right', fontStyle: 'italic' } }]);
    });
    body.push([{ content: `TOTAL ${label.toUpperCase()}`, styles: { fontStyle: 'bold' } }, { content: rp(sSide.total), styles: { halign: 'right', fontStyle: 'bold' } }]);
  };
  side('Aset', d.assets);
  side('Liabilitas', d.liabilities);
  side('Ekuitas', d.equity);
  body.push([{ content: 'TOTAL LIABILITAS & EKUITAS', styles: { fontStyle: 'bold', fillColor: strong } }, { content: rp(d.totalLiabilitiesEquity), styles: { halign: 'right', fontStyle: 'bold', fillColor: strong } }]);
  autoTable(doc, { startY, head: [['Akun', 'Jumlah']], body, theme: 'grid', styles: BODY_STYLE, headStyles: tableHeadStyle({ fontSize: 8.8, halign: 'left' }), columnStyles: { 1: { halign: 'right', cellWidth: 45 } }, margin: { left: 15, right: 15 } });
  drawFooter(doc);
  return doc;
}

/* --------- LABA RUGI (Income Statement) --- single period --------- */
export function incomeStatementPDF(d, company, periodLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawDocHeader(doc, { title: 'LAPORAN LABA RUGI', subtitle: periodLabel, company, centered: true });
  const sec = tSection(); const strong = tStrong();
  const body = [];
  const section = (title, s) => {
    body.push([{ content: title, colSpan: 2, styles: { fontStyle: 'bold', fillColor: sec } }]);
    (s.items || []).forEach((it) => body.push([`    ${it.code}  ${it.name}`, { content: rp(it.amount), styles: { halign: 'right' } }]));
    if (!s.items || s.items.length === 0) body.push([{ content: '    —', colSpan: 2, styles: { textColor: [150, 150, 150] } }]);
  };
  const total = (label, val, st) => body.push([{ content: label, styles: { fontStyle: st ? 'bold' : 'normal', fillColor: st ? strong : undefined } }, { content: rp(val), styles: { halign: 'right', fontStyle: st ? 'bold' : 'normal', fillColor: st ? strong : undefined } }]);
  section('PENDAPATAN', d.revenue); total('Total Pendapatan', d.revenue.total);
  section('BEBAN POKOK PENJUALAN (HPP)', d.cogs); total('Total HPP', d.cogs.total);
  total('LABA KOTOR', d.grossProfit, true);
  section('BEBAN OPERASIONAL', d.expense); total('Total Beban Operasional', d.expense.total);
  total('LABA OPERASIONAL', d.operatingProfit, true);
  section('PENDAPATAN LAIN', d.otherIncome);
  section('BEBAN LAIN', d.otherExpense);
  total('LABA (RUGI) BERSIH', d.netIncome, true);
  autoTable(doc, { startY, head: [['Keterangan', 'Jumlah']], body, theme: 'grid', styles: BODY_STYLE, headStyles: tableHeadStyle({ fontSize: 8.8, halign: 'left' }), columnStyles: { 1: { halign: 'right', cellWidth: 50 } }, margin: { left: 15, right: 15 } });
  drawFooter(doc);
  return doc;
}

/* --------- LABA RUGI PERBANDINGAN (comparison) --------- */
export function incomeStatementComparisonPDF(cur, prev, company, curLabel, prevLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawDocHeader(doc, { title: 'LAPORAN LABA RUGI (PERBANDINGAN)', subtitle: `${curLabel}  vs  ${prevLabel}`, company, centered: true });
  const strong = tStrong();
  const row = (label, c, p, st) => [
    { content: label, styles: { fontStyle: st ? 'bold' : 'normal', fillColor: st ? strong : undefined } },
    { content: rp(c), styles: { halign: 'right', fontStyle: st ? 'bold' : 'normal', fillColor: st ? strong : undefined } },
    { content: rp(p), styles: { halign: 'right' } },
    { content: pct(c, p), styles: { halign: 'right' } },
  ];
  const body = [
    row('Pendapatan', cur.revenue.total, prev.revenue.total),
    row('Beban Pokok Penjualan (HPP)', cur.cogs.total, prev.cogs.total),
    row('LABA KOTOR', cur.grossProfit, prev.grossProfit, true),
    row('Beban Operasional', cur.expense.total, prev.expense.total),
    row('LABA OPERASIONAL', cur.operatingProfit, prev.operatingProfit, true),
    row('Pendapatan Lain', cur.otherIncome.total, prev.otherIncome.total),
    row('Beban Lain', cur.otherExpense.total, prev.otherExpense.total),
    row('LABA (RUGI) BERSIH', cur.netIncome, prev.netIncome, true),
  ];
  autoTable(doc, { startY, head: [['Keterangan', curLabel, prevLabel, 'Δ %']], body, theme: 'grid', styles: BODY_STYLE, headStyles: tableHeadStyle({ fontSize: 8.8, halign: 'left' }), columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', cellWidth: 22 } }, margin: { left: 15, right: 15 } });
  drawFooter(doc);
  return doc;
}

/* --------- ARUS KAS (Cash Flow) --------- */
export function cashFlowPDF(d, company, periodLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawDocHeader(doc, { title: 'LAPORAN ARUS KAS', subtitle: periodLabel, company, centered: true });
  const strong = tStrong();
  const body = [
    ['Kas Awal Periode', { content: rp(d.beginningCash), styles: { halign: 'right' } }],
    ['Arus Kas dari Aktivitas Operasi', { content: rp(d.operating), styles: { halign: 'right' } }],
    ['Arus Kas dari Aktivitas Investasi', { content: rp(d.investing), styles: { halign: 'right' } }],
    ['Arus Kas dari Aktivitas Pendanaan', { content: rp(d.financing), styles: { halign: 'right' } }],
    [{ content: 'Kenaikan (Penurunan) Kas Bersih', styles: { fontStyle: 'bold' } }, { content: rp(d.netChange), styles: { halign: 'right', fontStyle: 'bold' } }],
    [{ content: 'Kas Akhir Periode', styles: { fontStyle: 'bold', fillColor: strong } }, { content: rp(d.endingCash), styles: { halign: 'right', fontStyle: 'bold', fillColor: strong } }],
  ];
  autoTable(doc, { startY, head: [['Keterangan', 'Jumlah']], body, theme: 'grid', styles: BODY_STYLE, headStyles: tableHeadStyle({ fontSize: 8.8, halign: 'left' }), columnStyles: { 1: { halign: 'right', cellWidth: 55 } }, margin: { left: 15, right: 15 } });
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(140);
  doc.text('Metode langsung — dikelompokkan berdasar kategori arus kas tiap akun lawan.', 15, doc.lastAutoTable.finalY + 6);
  drawFooter(doc);
  return doc;
}
