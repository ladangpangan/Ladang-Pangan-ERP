// PDF generators (Invoice, Sales Order, Surat Jalan, Purchase Order, Tally)
// for PT Ladang Pangan Indonesia. Shared look & feel + configurable
// components come from lib/pdf/theme.js (Setting > PDF & Dokumen).

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { pkgShort, pkgLabel } from '@/lib/constants';
import {
  drawDocHeader, drawFooter, drawWatermark, tableHeadStyle,
  getSettings, getCompany, accentRGB, tint, ellipsize,
  setPdfCompany, setPdfSettings,
} from './theme';

// Re-export branding setters so existing imports keep working.
export { setPdfCompany, setPdfSettings };

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const MARGIN = 15;

// Right-aligned key/value row inside the totals column. The value is fitted (ellipsized)
// to the space left of the label so a very large amount can never overlap its label.
function kvRow(doc, labelX, valueX, label, val, y, o = {}) {
  doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
  doc.setFontSize(o.size || 9);
  const c = o.color;
  if (Array.isArray(c)) doc.setTextColor(c[0], c[1], c[2]); else doc.setTextColor(c === undefined ? 40 : c);
  const labelW = doc.getTextWidth(String(label));
  const maxValW = Math.max(10, (valueX - labelX) - labelW - 3);
  doc.text(String(label), labelX, y);
  doc.text(ellipsize(doc, val, maxValW), valueX, y, { align: 'right' });
}

// A styled meta box (right side) with rows of label/value. Values are fitted to the
// space left of each label (ellipsized) so long numbers/codes never overlap the label.
function metaBox(doc, x, y, w, rows, accent) {
  const rowH = 5.4;
  const h = rows.length * rowH + 4;
  doc.setFillColor(...tint(accent, 0.93));
  doc.roundedRect(x, y, w, h, 2, 2, 'F');
  doc.setDrawColor(...tint(accent, 0.55)); doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 2, 2, 'S');
  doc.setFontSize(8);
  rows.forEach((line, idx) => {
    const ry = y + 5 + idx * rowH;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(105);
    const labelW = doc.getTextWidth(String(line[0]));
    doc.text(String(line[0]), x + 3, ry);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(30);
    const maxValW = Math.max(10, w - 6 - labelW - 2);
    doc.text(ellipsize(doc, line[1], maxValW), x + w - 3, ry, { align: 'right' });
  });
  return y + h;
}

// KEPADA/SUPPLIER party block (left side). The name is WRAPPED to maxW (so a long
// customer name cannot spill into the meta box) and the real bottom Y is returned so
// callers can start the table below it (no overlap regardless of address length).
function partyBlock(doc, x, y, label, name, lines, maxW = 90) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(130);
  doc.text(String(label), x, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(20);
  const nameLines = doc.splitTextToSize(String(name || '-'), maxW);
  doc.text(nameLines, x, y + 6);
  let cy = y + 6 + Math.max(0, nameLines.length - 1) * 5 + 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(85);
  (lines || []).forEach((ln) => {
    if (!ln) return;
    const arr = doc.splitTextToSize(String(ln), maxW);
    doc.text(arr, x, cy); cy += arr.length * 4.4;
  });
  return cy;
}

// Right-aligned party block (e.g. INVOICE TO on the right, matching the reference design).
function partyBlockRight(doc, xRight, y, label, name, lines, maxW = 66) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(140);
  doc.text(String(label), xRight, y, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(20);
  const nameLines = doc.splitTextToSize(String(name || '-'), maxW);
  doc.text(nameLines, xRight, y + 6, { align: 'right' });
  let cy = y + 6 + Math.max(0, nameLines.length - 1) * 5 + 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(90);
  (lines || []).forEach((ln) => {
    if (!ln) return;
    const arr = doc.splitTextToSize(String(ln), maxW);
    doc.text(arr, xRight, cy, { align: 'right' }); cy += arr.length * 4.2;
  });
  return cy;
}

// Row of accent-filled "tiles" (label + value), matching the reference invoice header.
// Values are ellipsized to the tile width so nothing overflows.
function drawMetaTiles(doc, x, y, w, tiles, accent) {
  const gap = 3;
  const n = tiles.length;
  const tw = (w - gap * (n - 1)) / n;
  const th = 19;
  tiles.forEach((t, i) => {
    const tx = x + i * (tw + gap);
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.roundedRect(tx, y, tw, th, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...tint(accent, 0.75));
    doc.text(ellipsize(doc, String(t[0]).toUpperCase(), tw - 4), tx + tw / 2, y + 7, { align: 'center' });
    doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
    doc.text(ellipsize(doc, String(t[1]), tw - 4), tx + tw / 2, y + 14, { align: 'center' });
  });
  doc.setTextColor(0);
  return y + th;
}

// Full teal "GRAND TOTAL" bar (label left, value right), value ellipsized safely.
function drawGrandTotal(doc, x, y, w, label, val, accent) {
  const h = 11;
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(255, 255, 255);
  doc.text(String(label), x + 4, y + 7.3);
  doc.setFontSize(12);
  const labelW = doc.getTextWidth(String(label));
  const maxValW = Math.max(20, w - 8 - labelW - 2);
  doc.text(ellipsize(doc, val, maxValW), x + w - 4, y + 7.3, { align: 'right' });
  doc.setTextColor(0);
  return y + h;
}

/** Sales Order invoice PDF. variant: 'asli' (internal/real) | 'diup' (customer/markup) | default. */
export function generateInvoicePDF(so, opts = {}) {
  const isAsli = opts.variant === 'asli';
  const isDiup = opts.variant === 'diup';
  const cashbackAmt = Number(so.cashbackAmount || 0);
  const unitOf = (it) => (isDiup && Number(it.markupUnitPrice) > 0 ? Number(it.markupUnitPrice) : Number(it.unitPrice || 0));
  // Berat tagihan yang dicetak: bisa dipilih manual saat unduh (opts.weightBasis — salah satu dari
  // 4 tier: allocated/Dipilih, ordered/Pesan, shipped/Kirim, received/Terima). Kalau tidak dipilih,
  // fallback ke basis invoice resmi SO (so.invoiceWeightBasis) seperti sebelumnya.
  const weightBasis = opts.weightBasis || (so.invoiceWeightBasis === 'received' ? 'received' : so.invoiceWeightBasis === 'ordered' ? 'ordered' : 'shipped');
  const billW = (it) => {
    if (weightBasis === 'allocated') return Number(it.allocatedWeight || 0) || Number(it.weight || 0);
    if (weightBasis === 'ordered') return Number(it.weight || 0);
    if (weightBasis === 'received') return Number(it.receivedWeight || 0) || Number(it.shippedWeight || 0) || Number(it.allocatedWeight || 0) || Number(it.weight || 0);
    return Number(it.shippedWeight || 0) || Number(it.allocatedWeight || 0) || Number(it.weight || 0); // 'shipped'
  };
  const st = getSettings();
  const co = getCompany();
  const accent = accentRGB();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const startY = drawDocHeader(doc, {
    title: 'INVOICE',
    docNumber: so.invoiceNumber || so.soNumber,
    subtitle: isAsli ? 'SALINAN INTERNAL · NILAI ASLI' : null,
  });
  if (isAsli && st.showWatermark) drawWatermark(doc, 'INTERNAL');

  const y0 = startY + 4;
  const cust = so.customer || {};
  const addr = [cust.address, cust.city, cust.province].filter(Boolean).join(', ');

  // LEFT: accent info tiles (No / Tgl Invoice / Jatuh Tempo) — reference style.
  const tilesW = pageWidth / 2 - MARGIN - 4;
  const total0 = isDiup ? Number(so.totalAmount || 0) + cashbackAmt : Number(so.totalAmount || 0);
  const tilesBottom = drawMetaTiles(doc, MARGIN, y0, tilesW, [
    ['Invoice No', so.invoiceNumber || so.soNumber || '-'],
    ['Tgl Invoice', so.invoiceDate ? format(new Date(so.invoiceDate), 'dd-MM-yyyy') : (so.orderDate ? format(new Date(so.orderDate), 'dd-MM-yyyy') : '-')],
    ['Jatuh Tempo', so.dueDate ? format(new Date(so.dueDate), 'dd-MM-yyyy') : (so.paymentTerm || '-')],
  ], accent);
  // small SO/term line under tiles
  const basisLabelInv = { allocated: 'Berat Dipilih', ordered: 'Berat Pesan', shipped: 'Berat Kirim (SJ)', received: 'Berat Terima' }[weightBasis];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
  doc.text(ellipsize(doc, `SO: ${so.soNumber || '-'}   ·   Term: ${so.paymentTerm || '-'}   ·   Basis Berat: ${basisLabelInv}`, tilesW), MARGIN, tilesBottom + 5);

  // RIGHT: INVOICE TO block (right-aligned)
  const partyBottom = partyBlockRight(doc, pageWidth - MARGIN, y0 + 1, 'INVOICE TO,', cust.displayName, [
    addr, cust.phone ? 'Telp: ' + cust.phone : '', cust.taxId ? 'NPWP: ' + cust.taxId : '',
  ], pageWidth / 2 - MARGIN - 4);

  const bodyTop = Math.max(tilesBottom + 8, partyBottom) + 6;

  const items = (so.items || []).map((it, idx) => {
    const w = billW(it);
    const unit = unitOf(it);
    const disc = Number(it.discount || 0);
    return [
      idx + 1,
      (it.product?.name || it.productName || '-') + (it.product?.sku ? `\n${it.product.sku}` : ''),
      Number(it.quantity || 0),
      pkgShort(it.product?.packagingType),
      w.toLocaleString('id-ID'),
      rupiah(unit),
      rupiah(disc),
      rupiah((w * unit) - disc),
    ];
  });

  autoTable(doc, {
    startY: bodyTop,
    head: [['#', 'Deskripsi', 'Qty', 'Kemasan', 'Berat (kg)', 'Harga/kg', 'Diskon', 'Subtotal']],
    body: items,
    theme: 'striped',
    headStyles: tableHeadStyle(),
    bodyStyles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: tint(accent, 0.96) },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 }, 1: { cellWidth: 48, overflow: 'linebreak' }, 2: { halign: 'right', cellWidth: 12 },
      3: { halign: 'center', cellWidth: 22 }, 4: { halign: 'right', cellWidth: 20 }, 5: { halign: 'right', cellWidth: 24 },
      6: { halign: 'right', cellWidth: 22 }, 7: { halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  // -- TOTALS --
  const finalY = doc.lastAutoTable.finalY + 6;
  const boxW = 84; const boxX = pageWidth - MARGIN - boxW;
  const labelX = boxX + 2; const valueX = pageWidth - MARGIN - 2;

  // GRAND TOTAL harus selalu dihitung dari baris item yang benar-benar dicetak (billW mengikuti
  // basis berat yang dipilih saat unduh) — TIDAK boleh diambil langsung dari so.totalAmount, karena
  // itu adalah nilai resmi ter-invoice pada basis yang berbeda (misal Berat Kirim) sementara PDF ini
  // bisa dicetak dengan basis lain (misal Berat Pesan), yang akan membuat baris item & Grand Total
  // tidak sinkron.
  const buyerShip = (so.shippingBearer === 'buyer') ? Number(so.shippingCost || 0) : 0;
  const subtotal = (so.items || []).reduce((a, it) => a + billW(it) * unitOf(it), 0);
  const discount = (so.items || []).reduce((a, it) => a + Number(it.discount || 0), 0);
  const netTotal = subtotal - discount + buyerShip;
  const total = isDiup ? netTotal + cashbackAmt : netTotal;
  const paid = Number(so.paidAmount || 0);
  const outstanding = (isDiup || isAsli) ? (total - paid) : Number(so.outstanding !== undefined ? so.outstanding : total - paid);
  const returns = isAsli ? 0 : Number(so.totalReturns || 0);

  let ty = finalY;
  kvRow(doc, labelX, valueX, 'Subtotal', rupiah(subtotal), ty); ty += 5;
  kvRow(doc, labelX, valueX, 'Diskon', '- ' + rupiah(discount), ty, { color: [180, 60, 60] }); ty += 5;
  if (buyerShip > 0) { kvRow(doc, labelX, valueX, 'Biaya Kirim', '+ ' + rupiah(buyerShip), ty); ty += 5; }
  if (returns > 0) { kvRow(doc, labelX, valueX, 'Retur', '- ' + rupiah(returns), ty, { color: [180, 60, 60] }); ty += 5; }
  // GRAND TOTAL teal bar (reference style)
  ty += 1;
  const gtBottom = drawGrandTotal(doc, boxX, ty, boxW, 'GRAND TOTAL', rupiah(total), accent);
  ty = gtBottom + 6;
  kvRow(doc, labelX, valueX, 'Sudah Dibayar', rupiah(paid), ty, { color: accent }); ty += 5;
  kvRow(doc, labelX, valueX, 'Outstanding', rupiah(outstanding), ty, { bold: true, color: outstanding > 0 ? [200, 30, 30] : 40 });

  // -- PAYMENT INFO (left) --
  if (st.showPayment) {
    const payLines = String(st.paymentInfo || co.bank || '').split('\n').filter(Boolean);
    const payY = finalY + 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30);
    doc.text('INFORMASI PEMBAYARAN', MARGIN, payY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(90);
    payLines.forEach((ln, i) => doc.text(doc.splitTextToSize(ln, boxX - MARGIN - 6), MARGIN, payY + 5 + i * 4.6));
  }

  // -- SIGNATURE --
  if (st.showSignature) {
    const sy = doc.internal.pageSize.getHeight() - 42;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(85);
    doc.text(st.signerLabel || 'Hormat kami,', pageWidth - MARGIN - 55, sy);
    doc.setDrawColor(150); doc.line(pageWidth - MARGIN - 55, sy + 18, pageWidth - MARGIN - 8, sy + 18);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(40);
    doc.text(ellipsize(doc, st.signerName || co.name, 47), pageWidth - MARGIN - 55, sy + 23);
  }

  drawFooter(doc);
  return doc;
}

/** Sales Order (Order Confirmation) PDF. */
export function generateSOPDF(so) {
  const st = getSettings(); const accent = accentRGB();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const startY = drawDocHeader(doc, { title: 'SALES ORDER', docNumber: so.soNumber || '-' });
  const y0 = startY + 4;
  const cust = so.customer || {};
  const addr = [cust.address, cust.city, cust.province].filter(Boolean).join(', ');
  const metaX = pageWidth - MARGIN - 70;
  const partyBottom = partyBlock(doc, MARGIN, y0, 'KEPADA:', cust.displayName, [addr, cust.phone ? 'Telp: ' + cust.phone : ''], metaX - MARGIN - 6);

  const metaBottom = metaBox(doc, metaX, y0, 70, [
    ['SO Number', so.soNumber || '-'],
    ['Order Date', so.orderDate ? format(new Date(so.orderDate), 'dd MMM yyyy') : '-'],
    ['Perkiraan Kirim', so.expectedDate ? format(new Date(so.expectedDate), 'dd MMM yyyy') : '-'],
    ['Payment Term', so.paymentTerm || '-'],
    ['Status', so.pipelineStatus || '-'],
  ], accent);
  const bodyTop = Math.max(partyBottom, metaBottom) + 6;

  const items = (so.items || []).map((it, idx) => {
    const w = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0);
    return [
      idx + 1,
      (it.product?.name || '-') + (it.product?.sku ? `\n${it.product.sku}` : '') + (it.stock?.kodeSimpan ? `\n[${it.stock.kodeSimpan}]` : ''),
      Number(it.quantity || 0), pkgShort(it.product?.packagingType), w.toLocaleString('id-ID'),
      rupiah(it.unitPrice), rupiah(it.discount || 0), rupiah((w * Number(it.unitPrice || 0)) - Number(it.discount || 0)),
    ];
  });

  autoTable(doc, {
    startY: bodyTop,
    head: [['#', 'Deskripsi', 'Qty', 'Kemasan', 'Berat (kg)', 'Harga/kg', 'Diskon', 'Subtotal']],
    body: items, theme: 'striped', headStyles: tableHeadStyle(), bodyStyles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: tint(accent, 0.96) },
    columnStyles: { 0: { halign: 'center', cellWidth: 8 }, 1: { cellWidth: 48, overflow: 'linebreak' }, 2: { halign: 'right', cellWidth: 12 }, 3: { halign: 'center', cellWidth: 22 }, 4: { halign: 'right', cellWidth: 20 }, 5: { halign: 'right', cellWidth: 24 }, 6: { halign: 'right', cellWidth: 22 }, 7: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  const boxW = 78; const boxX = pageWidth - MARGIN - boxW; const labelX = boxX + 2; const valueX = pageWidth - MARGIN - 2;
  const subtotal = (so.items || []).reduce((a, it) => a + (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0)) * Number(it.unitPrice || 0), 0);
  const discount = (so.items || []).reduce((a, it) => a + Number(it.discount || 0), 0);
  const total = Number(so.totalAmount || (subtotal - discount));
  let ty = finalY;
  kvRow(doc, labelX, valueX, 'Subtotal', rupiah(subtotal), ty); ty += 5;
  kvRow(doc, labelX, valueX, 'Diskon', '- ' + rupiah(discount), ty, { color: [180, 60, 60] }); ty += 6;
  doc.setFillColor(...tint(accent, 0.85)); doc.roundedRect(boxX, ty - 1, boxW, 8.5, 1.5, 1.5, 'F');
  kvRow(doc, labelX, valueX, 'TOTAL', rupiah(total), ty + 4.5, { bold: true, size: 11.5, color: accent });

  if (so.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30);
    doc.text('Catatan:', MARGIN, finalY);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(so.notes, boxX - MARGIN - 6), MARGIN, finalY + 5);
  }

  if (st.showSignature) {
    const sy = doc.internal.pageSize.getHeight() - 42;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(85);
    doc.text(st.signerLabel || 'Hormat kami,', pageWidth - MARGIN - 55, sy);
    doc.setDrawColor(150); doc.line(pageWidth - MARGIN - 55, sy + 18, pageWidth - MARGIN - 8, sy + 18);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(40);
    doc.text(st.signerName || getCompany().name, pageWidth - MARGIN - 55, sy + 23);
  }
  drawFooter(doc);
  return doc;
}

/** Surat Jalan (Delivery Note) PDF. */
export function generateSuratJalanPDF(sj, so) {
  const st = getSettings(); const accent = accentRGB();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const startY = drawDocHeader(doc, { title: 'SURAT JALAN', docNumber: sj.sjNumber || sj.suratJalanNumber || '-' });
  const y0 = startY + 4;
  const cust = so?.customer || {};
  const metaX = pageWidth - MARGIN - 70;
  const shipAddr = sj.shipToAddress || sj.shippingAddress || [cust.address, cust.city, cust.province].filter(Boolean).join(', ');
  const shipPhone = sj.shipToPhone || cust.phone;
  let py = partyBlock(doc, MARGIN, y0, 'DIKIRIM KEPADA:', sj.shipToName || cust.displayName, [shipAddr, shipPhone ? 'Telp: ' + shipPhone : ''], metaX - MARGIN - 6);
  if (sj.shipToName && cust.displayName && sj.shipToName !== cust.displayName) {
    doc.setFontSize(8); doc.setTextColor(120); doc.text('via ' + cust.displayName, MARGIN, py); py += 4;
  }
  const mapsUrl = sj.mapsUrl || cust.mapsUrl;
  if (mapsUrl) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.textWithLink('> Buka Lokasi di Google Maps', MARGIN, py + 1, { url: mapsUrl });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(85); py += 5;
  }

  const metaBottom = metaBox(doc, metaX, y0, 70, [
    ['No. SJ', sj.sjNumber || sj.suratJalanNumber || '-'],
    ['Tgl. Kirim', sj.deliveryDate ? format(new Date(sj.deliveryDate), 'dd MMM yyyy') : '-'],
    ['Ref. SO', so?.soNumber || '-'],
    ['Ekspedisi', sj.expedition || '-'],
    ['No. Kend.', sj.vehicleNumber || '-'],
    ['Driver', sj.driverName || '-'],
  ], accent);
  const bodyTop = Math.max(py, metaBottom) + 6;

  // "Tampilkan field kosong untuk penerimaan": when enabled, add an empty "Diterima" column per item
  // so the customer/receiver can hand-write the actually-received weight against each line.
  const showRecv = !!(sj.showReceivedColumn ?? sj.show_received_column);

  const items = (so?.items || []).map((it, idx) => {
    const allocs = it.allocations || [];
    const shipW = allocs.length > 0 ? allocs.reduce((a, b) => a + Number(b.weight || 0), 0) : (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0));
    const kodeLines = allocs.length > 0 ? allocs.map(a => `[${a.kodeSimpan} · ${Number(a.weight || 0).toFixed(1)} kg]`).join('\n') : (it.stock?.kodeSimpan ? `[${it.stock.kodeSimpan}]` : '');
    const row = [
      idx + 1,
      (it.product?.name || '-') + (it.product?.sku ? `\n${it.product.sku}` : '') + (kodeLines ? `\n${kodeLines}` : ''),
      allocs.length > 0 ? allocs.reduce((a, b) => a + Number(b.quantity || 0), 0) : Number(it.quantity || 0),
      pkgLabel(it.product?.packagingType), shipW.toLocaleString('id-ID') + ' kg',
    ];
    if (showRecv) row.push(''); // empty cell for manual "Diterima" entry
    row.push(it.stock?.coldStorage?.code ? `${it.stock.coldStorage.code}${it.stock.zone?.code ? ' / ' + it.stock.zone.code : ''}` : '-');
    return row;
  });

  const sjHead = showRecv
    ? [['#', 'Deskripsi Barang', 'Qty', 'Kemasan', 'Berat Kirim', 'Diterima', 'Lokasi Asal']]
    : [['#', 'Deskripsi Barang', 'Qty', 'Kemasan', 'Berat', 'Lokasi Asal']];
  const sjColStyles = showRecv
    ? { 0: { halign: 'center', cellWidth: 9 }, 1: { cellWidth: 54, overflow: 'linebreak' }, 2: { halign: 'right', cellWidth: 12 }, 3: { halign: 'center', cellWidth: 24 }, 4: { halign: 'right', cellWidth: 22 }, 5: { halign: 'center', cellWidth: 24 }, 6: { halign: 'center' } }
    : { 0: { halign: 'center', cellWidth: 10 }, 1: { cellWidth: 62, overflow: 'linebreak' }, 2: { halign: 'right', cellWidth: 14 }, 3: { halign: 'center', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 26 }, 5: { halign: 'center' } };

  autoTable(doc, {
    startY: bodyTop,
    head: sjHead,
    body: items, theme: 'striped', headStyles: tableHeadStyle(), bodyStyles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak', minCellHeight: showRecv ? 9 : undefined },
    alternateRowStyles: { fillColor: tint(accent, 0.96) },
    columnStyles: sjColStyles,
    margin: { left: MARGIN, right: MARGIN },
  });

  const totalW = (so?.items || []).reduce((a, it) => { const al = it.allocations || []; return a + (al.length > 0 ? al.reduce((x, b) => x + Number(b.weight || 0), 0) : (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0))); }, 0);
  const totalQ = (so?.items || []).reduce((a, it) => a + Number(it.quantity || 0), 0);
  const finalY = doc.lastAutoTable.finalY + 6;
  doc.setFillColor(...tint(accent, 0.85));
  const tBoxW = 84; const tBoxX = pageWidth - MARGIN - tBoxW;
  doc.roundedRect(tBoxX, finalY - 4, tBoxW, 8.5, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(`Total: ${totalQ} kemasan  ·  ${totalW.toFixed(1)} kg`, pageWidth - MARGIN - 2, finalY + 1.5, { align: 'right' });

  if (sj.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30);
    doc.text('Catatan:', MARGIN, finalY);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(sj.notes, tBoxX - MARGIN - 6), MARGIN, finalY + 5);
  }

  // Signature block (3 columns)
  const sigY = doc.internal.pageSize.getHeight() - 52;
  const colWidth = (pageWidth - MARGIN * 2) / 3;
  ['Diterima oleh,', 'Diantar oleh (Sopir),', 'Diserahkan oleh,'].forEach((label, i) => {
    const x = MARGIN + i * colWidth;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(85);
    doc.text(label, x + colWidth / 2, sigY, { align: 'center' });
    doc.setDrawColor(150); doc.line(x + 8, sigY + 20, x + colWidth - 8, sigY + 20);
    doc.setFontSize(8); doc.setTextColor(120);
    const sub = i === 0 ? 'Nama & Tanda Tangan Penerima' : i === 1 ? (sj.driverName || 'Sopir') : 'Petugas Gudang';
    doc.text(sub, x + colWidth / 2, sigY + 24, { align: 'center' });
  });

  drawFooter(doc, { note: 'Surat Jalan ini merupakan dokumen resmi ' + getCompany().name });
  return doc;
}

/** Purchase Order (or dropship supplier invoice) PDF. */
export function generatePOPDF(po) {
  const st = getSettings(); const accent = accentRGB();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const isDropPO = !!po.isDropship;

  const startY = drawDocHeader(doc, {
    title: isDropPO ? 'INVOICE SUPPLIER' : 'PURCHASE ORDER',
    docNumber: isDropPO ? (po.invoiceNumber || po.poNumber) : po.poNumber,
    subtitle: isDropPO ? `Ref PO: ${po.poNumber}` : null,
  });
  const y0 = startY + 4;
  const sup = po.supplier || {};
  const metaX = pageWidth - MARGIN - 70;
  const partyBottom = partyBlock(doc, MARGIN, y0, 'SUPPLIER:', sup.displayName, [sup.phone ? 'Telp: ' + sup.phone : '', sup.address], metaX - MARGIN - 6);

  const metaBottom = metaBox(doc, metaX, y0, 70, [
    ['Order Date', po.orderDate ? format(new Date(po.orderDate), 'dd MMM yyyy') : '-'],
    ['Expected', po.expectedDate ? format(new Date(po.expectedDate), 'dd MMM yyyy') : '-'],
    ['Payment Term', po.paymentTerm || '-'],
    ['Method', po.method || '-'],
    ['Type', po.poType || '-'],
  ], accent);
  const bodyTop = Math.max(partyBottom, metaBottom) + 6;

  const billedOf = (it) => { const b = it.billedWeight; return (b !== undefined && b !== null) ? Number(b) : Number(it.weight || 0); };
  const rows = (po.items || []).map((it, idx) => [
    idx + 1, (it.product?.name || '-') + (it.product?.sku ? `\n${it.product.sku}` : ''),
    Number(it.quantity || 0), pkgShort(it.product?.packagingType),
    billedOf(it).toLocaleString('id-ID', { maximumFractionDigits: 2 }), rupiah(it.unitPrice), rupiah(billedOf(it) * Number(it.unitPrice || 0)),
  ]);
  const basisLabel = { grn: 'GRN PO / Surat Jalan SO', so_receipt: 'Penerimaan Customer (SO)', tally: 'Rekonsiliasi Tally', shipped: 'Surat Jalan (Dikirim)' }[po.invoiceWeightBasis] || null;
  const weightColHeader = po.isDropship ? 'Berat Tagih (kg)' : 'Berat (kg)';

  autoTable(doc, {
    startY: bodyTop,
    head: [['#', 'Deskripsi', 'Qty', 'Kemasan', weightColHeader, 'Harga/kg', 'Subtotal']],
    body: rows, theme: 'striped', headStyles: tableHeadStyle(), bodyStyles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: tint(accent, 0.96) },
    columnStyles: { 0: { halign: 'center', cellWidth: 8 }, 1: { cellWidth: 58, overflow: 'linebreak' }, 2: { halign: 'right', cellWidth: 12 }, 3: { halign: 'center', cellWidth: 22 }, 4: { halign: 'right', cellWidth: 24 }, 5: { halign: 'right', cellWidth: 28 }, 6: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  const boxW = 78; const boxX = pageWidth - MARGIN - boxW; const labelX = boxX + 2; const valueX = pageWidth - MARGIN - 2;
  const subtotal = (po.items || []).reduce((a, it) => a + billedOf(it) * Number(it.unitPrice || 0), 0);
  const addCost = Number(po.additionalCost || 0);
  const total = Number(po.totalAmount || subtotal + addCost);
  if (basisLabel && (po.isDropship || Number(po.totalReceivedWeight || 0) > 0)) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Basis berat tagihan: ${basisLabel}`, MARGIN, finalY);
  }
  let ty = finalY;
  kvRow(doc, labelX, valueX, 'Subtotal', rupiah(subtotal), ty); ty += 5;
  const addInTotal = (po.additionalCostBearer !== 'supplier' && (po.additionalCostPayMethod || 'utang') === 'utang');
  if (addCost > 0 && addInTotal) { kvRow(doc, labelX, valueX, 'Biaya Tambahan / Ongkir', rupiah(addCost), ty); ty += 5; }
  ty += 1;
  doc.setFillColor(...tint(accent, 0.85)); doc.roundedRect(boxX, ty - 1, boxW, 8.5, 1.5, 1.5, 'F');
  kvRow(doc, labelX, valueX, 'TOTAL', rupiah(total), ty + 4.5, { bold: true, size: 11.5, color: accent });

  drawFooter(doc);
  return doc;
}

/** Tally Inbound (Laporan Penyimpanan) PDF. */
export function generateTallyInboundPDF(r) {
  const accent = accentRGB();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const startY = drawDocHeader(doc, { title: 'LAPORAN TALLY INBOUND', docNumber: r.time ? format(new Date(r.time), 'dd MMM yyyy HH:mm') : '-' });
  const y0 = startY + 3;
  const meta = [
    ['Cold Storage:', `${r.csCode || '-'} ${r.csName || ''}`.trim()],
    ['Zona:', r.zoneCode || '-'],
    ['Referensi:', r.refType === 'MANUAL' ? 'Manual' : `${r.refType} · ${r.refNumber || '-'}`],
    ['Operator:', r.operator || '-'],
  ];
  doc.setFontSize(9);
  meta.forEach((l, i) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(105); doc.text(l[0], MARGIN, y0 + i * 5.5);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(30);
    doc.text(ellipsize(doc, String(l[1]), pageWidth - MARGIN - (MARGIN + 32)), MARGIN + 32, y0 + i * 5.5);
  });

  const rows = (r.items || []).map((it, idx) => [
    idx + 1, it.kodeSimpan || '-', (it.productName || '-') + (it.productSku ? `\n${it.productSku}` : ''),
    pkgLabel(it.packagingType), Number(it.quantity || 0), Number(it.weight || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 }),
    it.expiredDate ? format(new Date(it.expiredDate), 'dd-MM-yyyy') : '-',
  ]);

  autoTable(doc, {
    startY: y0 + meta.length * 5.5 + 3,
    head: [['#', 'Kode Simpan', 'Produk', 'Kemasan', 'Qty', 'Berat (kg)', 'Kadaluarsa']],
    body: rows, theme: 'striped', headStyles: tableHeadStyle(), bodyStyles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
    alternateRowStyles: { fillColor: tint(accent, 0.96) },
    columnStyles: { 0: { halign: 'center', cellWidth: 8 }, 1: { cellWidth: 30, font: 'courier' }, 2: { cellWidth: 60, overflow: 'linebreak' }, 3: { halign: 'center', cellWidth: 24 }, 4: { halign: 'right', cellWidth: 14 }, 5: { halign: 'right', cellWidth: 24 }, 6: { halign: 'center' } },
    margin: { left: MARGIN, right: MARGIN },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  const totalQ = (r.items || []).reduce((a, it) => a + Number(it.quantity || 0), 0);
  doc.setFillColor(...tint(accent, 0.85));
  const tBoxW = 120; const tBoxX = pageWidth - MARGIN - tBoxW;
  doc.roundedRect(tBoxX, finalY - 4, tBoxW, 8.5, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(`TOTAL: ${(r.items || []).length} item · ${totalQ} kemasan · ${Number(r.totalWeight || 0).toFixed(1)} kg`, pageWidth - MARGIN - 2, finalY + 1.5, { align: 'right' });

  if (r.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30); doc.text('Catatan:', MARGIN, finalY + 12);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90); doc.text(doc.splitTextToSize(r.notes, pageWidth - MARGIN * 2), MARGIN, finalY + 17);
  }

  const sigY = doc.internal.pageSize.getHeight() - 42;
  const colWidth = (pageWidth - MARGIN * 2) / 2;
  ['Dicatat oleh (Petugas Tally),', 'Diketahui oleh (Supervisor),'].forEach((label, i) => {
    const x = MARGIN + i * colWidth;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(85); doc.text(label, x + colWidth / 2, sigY, { align: 'center' });
    doc.setDrawColor(150); doc.line(x + 15, sigY + 18, x + colWidth - 15, sigY + 18);
  });

  drawFooter(doc);
  return doc;
}
