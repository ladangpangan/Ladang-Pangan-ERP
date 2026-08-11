// PDF generators for financial statements (SAK EP) with company letterhead.
// Uses jsPDF + jspdf-autotable. Company profile comes from Setting > Profil Perusahaan.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

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

function drawHeader(doc, company, title, subtitle) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const co = {
    name: company?.name || 'PT LADANG PANGAN INDONESIA',
    address: company?.address || '',
    contact: company?.contact || '',
    logo: company?.logo || null,
  };
  if (co.logo) {
    try { const fmt = /png/i.test(co.logo) ? 'PNG' : 'JPEG'; doc.addImage(co.logo, fmt, margin, 9, 20, 20, undefined, 'FAST'); } catch (e) { /* skip */ }
  }
  const tx = margin + (co.logo ? 24 : 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(16, 122, 87);
  doc.text(co.name, tx, 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(80);
  if (co.address) doc.text(String(co.address), tx, 22, { maxWidth: pageWidth - margin - tx });
  if (co.contact) doc.text(String(co.contact), tx, 27);
  doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(margin, 32, pageWidth - margin, 32);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(0);
  doc.text(title, pageWidth / 2, 40, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  if (subtitle) doc.text(subtitle, pageWidth / 2, 45, { align: 'center' });
  return 50;
}

function footer(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(`Dicetak: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 15, pageHeight - 8);
    doc.text(`Halaman ${i} / ${n}`, pageWidth - 15, pageHeight - 8, { align: 'right' });
  }
}

const BODY_STYLE = { fontSize: 8.6, cellPadding: 1.4, lineColor: [225, 225, 225] };
const HEAD_STYLE = { fillColor: [16, 122, 87], textColor: 255, fontSize: 8.8 };

/* --------- NERACA (Balance Sheet) --------- */
export function balanceSheetPDF(d, company, asOfLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawHeader(doc, company, 'LAPORAN POSISI KEUANGAN (NERACA)', `Per ${asOfLabel}`);
  const body = [];
  const side = (label, s) => {
    body.push([{ content: label.toUpperCase(), colSpan: 2, styles: { fontStyle: 'bold', fillColor: [235, 245, 240] } }]);
    (s.groups || []).forEach((g) => {
      body.push([{ content: g.category, colSpan: 2, styles: { fontStyle: 'bold', textColor: [60, 60, 60] } }]);
      (g.items || []).forEach((it) => body.push([`    ${it.code}  ${it.name}`, { content: rp(it.amount), styles: { halign: 'right' } }]));
      body.push([{ content: `    Subtotal ${g.category}`, styles: { fontStyle: 'italic' } }, { content: rp(g.total), styles: { halign: 'right', fontStyle: 'italic' } }]);
    });
    body.push([{ content: `TOTAL ${label.toUpperCase()}`, styles: { fontStyle: 'bold' } }, { content: rp(s.total), styles: { halign: 'right', fontStyle: 'bold' } }]);
  };
  side('Aset', d.assets);
  side('Liabilitas', d.liabilities);
  side('Ekuitas', d.equity);
  body.push([{ content: 'TOTAL LIABILITAS & EKUITAS', styles: { fontStyle: 'bold', fillColor: [220, 240, 230] } }, { content: rp(d.totalLiabilitiesEquity), styles: { halign: 'right', fontStyle: 'bold', fillColor: [220, 240, 230] } }]);
  autoTable(doc, { startY, head: [['Akun', 'Jumlah']], body, theme: 'grid', styles: BODY_STYLE, headStyles: HEAD_STYLE, columnStyles: { 1: { halign: 'right', cellWidth: 45 } }, margin: { left: 15, right: 15 } });
  footer(doc);
  return doc;
}

/* --------- LABA RUGI (Income Statement) — single period --------- */
export function incomeStatementPDF(d, company, periodLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawHeader(doc, company, 'LAPORAN LABA RUGI', periodLabel);
  const body = [];
  const section = (title, sec) => {
    body.push([{ content: title, colSpan: 2, styles: { fontStyle: 'bold', fillColor: [235, 245, 240] } }]);
    (sec.items || []).forEach((it) => body.push([`    ${it.code}  ${it.name}`, { content: rp(it.amount), styles: { halign: 'right' } }]));
    if (!sec.items || sec.items.length === 0) body.push([{ content: '    —', colSpan: 2, styles: { textColor: [150, 150, 150] } }]);
  };
  const total = (label, val, strong) => body.push([{ content: label, styles: { fontStyle: strong ? 'bold' : 'normal', fillColor: strong ? [220, 240, 230] : undefined } }, { content: rp(val), styles: { halign: 'right', fontStyle: strong ? 'bold' : 'normal', fillColor: strong ? [220, 240, 230] : undefined } }]);
  section('PENDAPATAN', d.revenue); total('Total Pendapatan', d.revenue.total);
  section('BEBAN POKOK PENJUALAN (HPP)', d.cogs); total('Total HPP', d.cogs.total);
  total('LABA KOTOR', d.grossProfit, true);
  section('BEBAN OPERASIONAL', d.expense); total('Total Beban Operasional', d.expense.total);
  total('LABA OPERASIONAL', d.operatingProfit, true);
  section('PENDAPATAN LAIN', d.otherIncome);
  section('BEBAN LAIN', d.otherExpense);
  total('LABA (RUGI) BERSIH', d.netIncome, true);
  autoTable(doc, { startY, head: [['Keterangan', 'Jumlah']], body, theme: 'grid', styles: BODY_STYLE, headStyles: HEAD_STYLE, columnStyles: { 1: { halign: 'right', cellWidth: 50 } }, margin: { left: 15, right: 15 } });
  footer(doc);
  return doc;
}

/* --------- LABA RUGI PERBANDINGAN (comparison) --------- */
export function incomeStatementComparisonPDF(cur, prev, company, curLabel, prevLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawHeader(doc, company, 'LAPORAN LABA RUGI (PERBANDINGAN)', `${curLabel}  vs  ${prevLabel}`);
  const row = (label, c, p, strong) => [
    { content: label, styles: { fontStyle: strong ? 'bold' : 'normal', fillColor: strong ? [220, 240, 230] : undefined } },
    { content: rp(c), styles: { halign: 'right', fontStyle: strong ? 'bold' : 'normal', fillColor: strong ? [220, 240, 230] : undefined } },
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
  autoTable(doc, { startY, head: [['Keterangan', curLabel, prevLabel, 'Δ %']], body, theme: 'grid', styles: BODY_STYLE, headStyles: HEAD_STYLE, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', cellWidth: 22 } }, margin: { left: 15, right: 15 } });
  footer(doc);
  return doc;
}

/* --------- ARUS KAS (Cash Flow) --------- */
export function cashFlowPDF(d, company, periodLabel) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const startY = drawHeader(doc, company, 'LAPORAN ARUS KAS', periodLabel);
  const body = [
    ['Kas Awal Periode', { content: rp(d.beginningCash), styles: { halign: 'right' } }],
    ['Arus Kas dari Aktivitas Operasi', { content: rp(d.operating), styles: { halign: 'right' } }],
    ['Arus Kas dari Aktivitas Investasi', { content: rp(d.investing), styles: { halign: 'right' } }],
    ['Arus Kas dari Aktivitas Pendanaan', { content: rp(d.financing), styles: { halign: 'right' } }],
    [{ content: 'Kenaikan (Penurunan) Kas Bersih', styles: { fontStyle: 'bold' } }, { content: rp(d.netChange), styles: { halign: 'right', fontStyle: 'bold' } }],
    [{ content: 'Kas Akhir Periode', styles: { fontStyle: 'bold', fillColor: [220, 240, 230] } }, { content: rp(d.endingCash), styles: { halign: 'right', fontStyle: 'bold', fillColor: [220, 240, 230] } }],
  ];
  autoTable(doc, { startY, head: [['Keterangan', 'Jumlah']], body, theme: 'grid', styles: BODY_STYLE, headStyles: HEAD_STYLE, columnStyles: { 1: { halign: 'right', cellWidth: 55 } }, margin: { left: 15, right: 15 } });
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(140);
  doc.text('Metode langsung — dikelompokkan berdasar kategori arus kas tiap akun lawan.', 15, doc.lastAutoTable.finalY + 6);
  footer(doc);
  return doc;
}
