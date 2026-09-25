'use client';

// Cetak (PDF) & Excel untuk Rekap Tagihan. Bentuknya meniru rekap Excel tim: header kuning,
// kolom JUMLAH (subtotal per tanggal) digabung per tanggal, baris "TAGIHAN YANG BELUM DIBAYAR".
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { recapLayout } from '@/lib/finance/recap-layout';
import { formatCell, fmtDate, fmtRp } from '@/lib/finance/recap-fields';

const YELLOW = [255, 255, 0];
const PEACH = [252, 213, 180];

// Font standar jsPDF (helvetica) tidak punya glyph panah/minus/emoji -> ganti ke ASCII.
const pdfText = (s) => String(s ?? '').replace(/→/g, '->').replace(/[−–—]/g, '-').replace(/[⚠️✅]/gu, '').trim();

const safeName = (s) => String(s || 'rekap').replace(/[\\/:*?"<>|]+/g, '-').trim();

function headerLabels(L) {
  const h = L.columns.map((c) => c.label);
  if (L.subtotalByDate) h.push('Jumlah');
  if (L.showNotes) h.push('Keterangan');
  return h;
}

export function recapPdf(recap, view) {
  const L = recapLayout(recap, view);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 14;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(L.title, 10, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(`${recap.recapNumber} · dibuat ${fmtDate(recap.createdAt)}${recap.createdBy ? ` oleh ${recap.createdBy}` : ''}`, pageW - 10, y, { align: 'right' });
  y += 6;
  if (L.subtitle) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(L.subtitle, pageW / 2, y, { align: 'center' }); y += 4; }
  const head = headerLabels(L);
  const nCols = head.length;
  const moneyIdx = new Set(L.columns.map((c, i) => (['money', 'weight', 'number'].includes(c.type) ? i : -1)).filter((i) => i >= 0));
  for (const sec of L.sections) {
    if (sec.heading) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); y += 4; doc.text(sec.heading, 10, y); y += 2; }
    const body = sec.body.map((b) => {
      const row = b.values.map((v, i) => {
        const f = L.columns[i];
        const text = f.key === 'total' ? fmtRp(v) : String(formatCell(f, v));
        const money = f.type === 'money';
        return { content: pdfText(text), styles: moneyIdx.has(i) ? { halign: 'right', ...(money ? { minCellWidth: 24 } : {}) } : {} };
      });
      if (L.subtotalByDate && b.groupSpan) row.push({ content: fmtRp(b.groupTotal), rowSpan: b.groupSpan, styles: { halign: 'center', valign: 'middle', fontStyle: 'bold', minCellWidth: 26 } });
      if (L.showNotes) row.push({ content: pdfText(b.notesText), styles: { fontSize: 7, textColor: [150, 70, 0], minCellWidth: 45 } });
      return row;
    });
    const labelSpan = Math.max(1, L.columns.length - 1);
    for (const line of sec.footer) {
      const row = [{ content: line.label, colSpan: labelSpan, styles: { halign: 'right', fontStyle: line.strong ? 'bold' : 'normal', fillColor: PEACH } },
        { content: fmtRp(line.value), styles: { halign: 'right', fontStyle: line.strong ? 'bold' : 'normal', fillColor: PEACH, minCellWidth: 26 } }];
      const rest = nCols - labelSpan - 1;
      if (rest > 0) row.push({ content: '', colSpan: rest, styles: { fillColor: PEACH } });
      body.push(row);
    }
    autoTable(doc, {
      startY: y + 2,
      head: [head],
      body,
      theme: 'grid',
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
      headStyles: { fillColor: YELLOW, textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', valign: 'middle' },
    });
    y = doc.lastAutoTable.finalY + 4;
  }
  if (L.grand) {
    const body = L.grand.map((l) => [{ content: l.label, styles: { halign: 'right', fontStyle: l.strong ? 'bold' : 'normal' } }, { content: fmtRp(l.value), styles: { halign: 'right', fontStyle: l.strong ? 'bold' : 'normal' } }]);
    autoTable(doc, { startY: y + 2, body, theme: 'grid', margin: { left: pageW - 10 - 130, right: 10 }, styles: { fontSize: 9, fillColor: PEACH, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] } });
    y = doc.lastAutoTable.finalY + 4;
  }
  if (recap.notes) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.text(`Catatan: ${recap.notes}`, 10, Math.min(y + 4, doc.internal.pageSize.getHeight() - 8)); }
  return { doc, filename: `${safeName(recap.recapNumber)} ${safeName(L.title)}.pdf` };
}

export function recapExcel(recap, view) {
  const L = recapLayout(recap, view);
  const head = headerLabels(L);
  const nCols = head.length;
  const aoa = [];
  const merges = [];
  const push = (row) => { aoa.push(row); return aoa.length - 1; };
  const blank = () => new Array(nCols).fill('');
  { const r = blank(); r[0] = L.title; r[nCols - 1] = recap.recapNumber; push(r); }
  if (L.subtitle) { const r = blank(); r[0] = L.subtitle; const i = push(r); merges.push({ s: { r: i, c: 0 }, e: { r: i, c: nCols - 1 } }); }
  const jumlahCol = L.columns.length;
  for (const sec of L.sections) {
    push(blank());
    if (sec.heading) { const r = blank(); r[0] = sec.heading; push(r); }
    push(head);
    for (const b of sec.body) {
      const r = b.values.map((v, i) => {
        const f = L.columns[i];
        if (v == null) return '';
        if (f.type === 'date') return fmtDate(v);
        if (['money', 'weight', 'number'].includes(f.type)) return Number(v);
        return v;
      });
      if (L.subtotalByDate) r.push(b.groupSpan ? b.groupTotal : '');
      if (L.showNotes) r.push(b.notesText);
      const i = push(r);
      if (L.subtotalByDate && b.groupSpan > 1) merges.push({ s: { r: i, c: jumlahCol }, e: { r: i + b.groupSpan - 1, c: jumlahCol } });
    }
    for (const line of sec.footer) {
      const r = blank(); r[0] = line.label; r[L.columns.length - 1] = line.value;
      const i = push(r);
      if (L.columns.length > 2) merges.push({ s: { r: i, c: 0 }, e: { r: i, c: L.columns.length - 2 } });
    }
  }
  if (L.grand) {
    push(blank());
    for (const line of L.grand) { const r = blank(); r[0] = line.label; r[L.columns.length - 1] = line.value; const i = push(r); if (L.columns.length > 2) merges.push({ s: { r: i, c: 0 }, e: { r: i, c: L.columns.length - 2 } }); }
  }
  if (recap.notes) { push(blank()); const r = blank(); r[0] = `Catatan: ${recap.notes}`; push(r); }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = head.map((h, i) => {
    const f = L.columns[i];
    if (!f) return { wch: h === 'Keterangan' ? 50 : 16 };
    return { wch: f.key === 'no' ? 5 : ['customer', 'shipAddress', 'item'].includes(f.key) ? 24 : f.type === 'money' ? 16 : 12 };
  });
  // Format angka: berat 2 desimal, uang tanpa desimal (pemisah ribuan mengikuti Excel lokal).
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R += 1) {
    for (let C = range.s.c; C <= range.e.c; C += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell || cell.t !== 'n') continue;
      const f = L.columns[C];
      cell.z = f?.type === 'weight' ? '#,##0.00' : f?.type === 'number' ? '0' : '#,##0';
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rekap');
  XLSX.writeFile(wb, `${safeName(recap.recapNumber)} ${safeName(L.title)}.xlsx`);
}
