// PDF Invoice generator using jsPDF + jsPDF-autotable
// Designed for Sales Order invoices for PT Ladang Pangan Indonesia

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { pkgShort, pkgLabel } from '@/lib/constants';

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

// Info perusahaan untuk header PDF (di-set dari Setting > Profil Perusahaan)
let PDF_COMPANY = null;
export function setPdfCompany(c) { PDF_COMPANY = c && (c.name || c.address || c.contact || c.logo) ? c : null; }
const CO = () => ({
  name: (PDF_COMPANY?.name || 'PT LADANG PANGAN INDONESIA'),
  address: (PDF_COMPANY?.address || 'Jl. Raya Cikarang No. 123, Bekasi, Jawa Barat 17530'),
  contact: (PDF_COMPANY?.contact || 'Telp: 021-5551000  ·  Email: info@lpi.co.id  ·  NPWP: 01.234.567.8-XXX.000'),
  logo: PDF_COMPANY?.logo || null,
});
// Gambar logo perusahaan (data URL base64) di pojok kiri-atas bila tersedia
const drawLogo = (doc, margin) => {
  const logo = CO().logo;
  if (!logo) return;
  try {
    const fmt = /png/i.test(logo) ? 'PNG' : 'JPEG';
    doc.addImage(logo, fmt, margin, 10, 22, 22, undefined, 'FAST');
  } catch (e) { /* abaikan logo rusak */ }
};

/**
 * Generate a Sales Order invoice PDF
 * @param {Object} so - Sales order detail (with items, customer, payments)
 * @returns {jsPDF} - the doc (call doc.save('invoice.pdf'))
 */
export function generateInvoicePDF(so, opts = {}) {
  const isAsli = opts.variant === 'asli';   // Faktur Asli/Internal (harga jual asli + watermark)
  const isDiup = opts.variant === 'diup';   // Faktur Customer di-up (harga markup)
  const cashbackAmt = Number(so.cashbackAmount || 0);
  // Harga per baris: di-up pakai markupUnitPrice; selain itu pakai unitPrice (harga asli)
  const unitOf = (it) => (isDiup && Number(it.markupUnitPrice) > 0 ? Number(it.markupUnitPrice) : Number(it.unitPrice || 0));
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  // -- HEADER --
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 87);
  drawLogo(doc, margin);
  doc.text(CO().name, margin + (CO().logo ? 26 : 0), 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(CO().address, margin, 26);
  doc.text(CO().contact, margin + (CO().logo ? 26 : 0), 31);

  // Invoice title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(0);
  doc.text('INVOICE', pageWidth - margin, 22, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(so.invoiceNumber || so.soNumber, pageWidth - margin, 30, { align: 'right' });
  if (isAsli) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(180, 40, 40);
    doc.text('SALINAN INTERNAL / NILAI ASLI', pageWidth - margin, 35, { align: 'right' });
  }

  // Divider
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(margin, 37, pageWidth - margin, 37);

  // -- WATERMARK (Faktur Asli/Internal) --
  if (isAsli) {
    try {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(60);
      doc.setTextColor(240, 210, 210);
      doc.text('INTERNAL', pageWidth / 2, 170, { align: 'center', angle: 35 });
    } catch (e) { /* abaikan */ }
    doc.setTextColor(0);
  }

  // -- BILL-TO & META --
  const y0 = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('KEPADA:', margin, y0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(so.customer?.displayName || '-', margin, y0 + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  const cust = so.customer || {};
  const addr = [cust.address, cust.city, cust.province].filter(Boolean).join(', ');
  if (addr) doc.text(doc.splitTextToSize(addr, 90), margin, y0 + 11);
  if (cust.phone) doc.text('Telp: ' + cust.phone, margin, y0 + 20);
  if (cust.taxId) doc.text('NPWP: ' + cust.taxId, margin, y0 + 25);

  // Right side meta box
  const metaX = pageWidth - margin - 70;
  const metaBoxY = y0;
  doc.setDrawColor(220);
  doc.roundedRect(metaX, metaBoxY, 70, 32, 2, 2);

  const metaLines = [
    ['SO Number:', so.soNumber || '-'],
    ['Order Date:', so.orderDate ? format(new Date(so.orderDate), 'dd MMM yyyy') : '-'],
    ['Invoice Date:', so.invoiceDate ? format(new Date(so.invoiceDate), 'dd MMM yyyy') : '-'],
    ['Due Date:', so.dueDate ? format(new Date(so.dueDate), 'dd MMM yyyy') : '-'],
    ['Term:', so.paymentTerm || '-'],
  ];
  doc.setFontSize(8);
  metaLines.forEach((line, idx) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(line[0], metaX + 3, metaBoxY + 5 + idx * 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text(String(line[1]), metaX + 68, metaBoxY + 5 + idx * 5.5, { align: 'right' });
  });

  // -- ITEMS TABLE --
  const items = (so.items || []).map((it, idx) => {
    const w = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0);
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
    startY: y0 + 40,
    head: [['#', 'Deskripsi', 'Qty', 'Kemasan', 'Berat (kg)', 'Harga/kg', 'Diskon', 'Subtotal']],
    body: items,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { cellWidth: 48 },
      2: { halign: 'right', cellWidth: 12 },
      3: { halign: 'center', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 20 },
      5: { halign: 'right', cellWidth: 24 },
      6: { halign: 'right', cellWidth: 22 },
      7: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  // -- TOTALS --
  const finalY = doc.lastAutoTable.finalY + 5;
  const totalX = pageWidth - margin - 60;

  const drawRow = (label, val, y, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.big ? 11 : 9);
    const c = opts.color;
    if (Array.isArray(c)) doc.setTextColor(c[0], c[1], c[2]);
    else doc.setTextColor(c || 0);
    doc.text(label, totalX, y);
    doc.text(val, pageWidth - margin, y, { align: 'right' });
  };

  const subtotal = (so.items || []).reduce((a, it) => a + (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0)) * unitOf(it), 0);
  const discount = (so.items || []).reduce((a, it) => a + Number(it.discount || 0), 0);
  const total = isDiup
    ? Number(so.totalAmount || 0) + cashbackAmt
    : (isAsli ? Number(so.totalAmount || (subtotal - discount)) : Number(so.totalAmount || (subtotal - discount)));
  const paid = Number(so.paidAmount || 0);
  const outstanding = (isDiup || isAsli) ? (total - paid) : Number(so.outstanding !== undefined ? so.outstanding : total - paid);
  const returns = isAsli ? 0 : Number(so.totalReturns || 0);

  drawRow('Subtotal', rupiah(subtotal), finalY);
  drawRow('Diskon', '- ' + rupiah(discount), finalY + 5, { color: 200 });
  if (returns > 0) drawRow('Retur', '- ' + rupiah(returns), finalY + 10, { color: 200 });
  const totalY = finalY + (returns > 0 ? 16 : 11);
  doc.setDrawColor(200);
  doc.line(totalX, totalY - 1, pageWidth - margin, totalY - 1);
  drawRow('TOTAL', rupiah(total), totalY + 4, { bold: true, big: true, color: [16, 122, 87] });

  const payY = totalY + 12;
  drawRow('Sudah Dibayar', rupiah(paid), payY, { color: [16, 122, 87] });
  drawRow('Outstanding', rupiah(outstanding), payY + 5, { bold: true, color: outstanding > 0 ? [200, 30, 30] : 0 });

  // -- PAYMENT INFO --
  const payInfoY = payY + 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text('INFORMASI PEMBAYARAN', margin, payInfoY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text('Transfer ke: Bank BCA · a/n PT Ladang Pangan Indonesia · No. Rek: 1234-567-890', margin, payInfoY + 5);
  doc.text('Konfirmasi pembayaran: keuangan@lpi.co.id / WA 0811-XXXX', margin, payInfoY + 10);

  // -- FOOTER --
  const footY = 275;
  doc.setDrawColor(200);
  doc.line(margin, footY, pageWidth - margin, footY);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text('Dokumen ini digenerate otomatis oleh sistem ERP PT Ladang Pangan Indonesia', margin, footY + 5);
  doc.text('Dicetak: ' + format(new Date(), 'dd MMM yyyy HH:mm'), pageWidth - margin, footY + 5, { align: 'right' });

  // -- Signature area --
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text('Hormat kami,', pageWidth - margin - 50, footY - 25);
  doc.text('PT Ladang Pangan Indonesia', pageWidth - margin - 50, footY - 5);
  doc.setFont('helvetica', 'bold');
  doc.text('_______________________', pageWidth - margin - 50, footY - 10);

  return doc;
}

/**
 * Generate a Sales Order (Order Confirmation / Konfirmasi Pesanan) PDF
 */
export function generateSOPDF(so) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 87);
  drawLogo(doc, margin);
  doc.text(CO().name, margin + (CO().logo ? 26 : 0), 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(CO().address, margin, 26);
  doc.text(CO().contact, margin + (CO().logo ? 26 : 0), 31);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(0);
  doc.text('SALES ORDER', pageWidth - margin, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(so.soNumber || '-', pageWidth - margin, 30, { align: 'right' });

  doc.setDrawColor(200);
  doc.line(margin, 37, pageWidth - margin, 37);

  const y0 = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('KEPADA:', margin, y0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(so.customer?.displayName || '-', margin, y0 + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  const cust = so.customer || {};
  const addr = [cust.address, cust.city, cust.province].filter(Boolean).join(', ');
  if (addr) doc.text(doc.splitTextToSize(addr, 90), margin, y0 + 11);
  if (cust.phone) doc.text('Telp: ' + cust.phone, margin, y0 + 20);

  const metaX = pageWidth - margin - 70;
  doc.setDrawColor(220);
  doc.roundedRect(metaX, y0, 70, 32, 2, 2);
  const metaLines = [
    ['SO Number:', so.soNumber || '-'],
    ['Order Date:', so.orderDate ? format(new Date(so.orderDate), 'dd MMM yyyy') : '-'],
    ['Perkiraan Kirim:', so.expectedDate ? format(new Date(so.expectedDate), 'dd MMM yyyy') : '-'],
    ['Payment Term:', so.paymentTerm || '-'],
    ['Status:', so.pipelineStatus || '-'],
  ];
  doc.setFontSize(8);
  metaLines.forEach((line, idx) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    doc.text(line[0], metaX + 3, y0 + 5 + idx * 5.5);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text(String(line[1]), metaX + 68, y0 + 5 + idx * 5.5, { align: 'right' });
  });

  const items = (so.items || []).map((it, idx) => {
    const w = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0);
    return [
      idx + 1,
      (it.product?.name || '-') +
        (it.product?.sku ? `\n${it.product.sku}` : '') +
        (it.stock?.kodeSimpan ? `\n[${it.stock.kodeSimpan}]` : ''),
      Number(it.quantity || 0),
      pkgShort(it.product?.packagingType),
      w.toLocaleString('id-ID'),
      rupiah(it.unitPrice),
      rupiah(it.discount || 0),
      rupiah((w * Number(it.unitPrice || 0)) - Number(it.discount || 0)),
    ];
  });

  autoTable(doc, {
    startY: y0 + 40,
    head: [['#', 'Deskripsi', 'Qty', 'Kemasan', 'Berat (kg)', 'Harga/kg', 'Diskon', 'Subtotal']],
    body: items,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { cellWidth: 48 },
      2: { halign: 'right', cellWidth: 12 },
      3: { halign: 'center', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 20 },
      5: { halign: 'right', cellWidth: 24 },
      6: { halign: 'right', cellWidth: 22 },
      7: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  const finalY = doc.lastAutoTable.finalY + 5;
  const totalX = pageWidth - margin - 60;
  const subtotal = (so.items || []).reduce((a, it) => a + (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0)) * Number(it.unitPrice || 0), 0);
  const discount = (so.items || []).reduce((a, it) => a + Number(it.discount || 0), 0);
  const total = Number(so.totalAmount || (subtotal - discount));

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text('Subtotal', totalX, finalY);
  doc.text(rupiah(subtotal), pageWidth - margin, finalY, { align: 'right' });
  doc.text('Diskon', totalX, finalY + 5);
  doc.setTextColor(200, 30, 30);
  doc.text('- ' + rupiah(discount), pageWidth - margin, finalY + 5, { align: 'right' });
  doc.setTextColor(0);
  const totalY = finalY + 11;
  doc.setDrawColor(200);
  doc.line(totalX, totalY - 1, pageWidth - margin, totalY - 1);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(16, 122, 87);
  doc.text('TOTAL', totalX, totalY + 4);
  doc.text(rupiah(total), pageWidth - margin, totalY + 4, { align: 'right' });

  if (so.notes) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0);
    doc.text('Catatan:', margin, totalY + 15);
    doc.setTextColor(80);
    doc.text(doc.splitTextToSize(so.notes, pageWidth - margin*2), margin, totalY + 20);
  }

  // Footer + signature
  doc.setFontSize(9); doc.setTextColor(80);
  doc.text('Hormat kami,', pageWidth - margin - 50, 250);
  doc.text('PT Ladang Pangan Indonesia', pageWidth - margin - 50, 270);
  doc.text('_______________________', pageWidth - margin - 50, 265);

  doc.setDrawColor(200);
  doc.line(margin, 275, pageWidth - margin, 275);
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Dokumen ini digenerate otomatis oleh sistem ERP PT Ladang Pangan Indonesia', margin, 280);
  doc.text('Dicetak: ' + format(new Date(), 'dd MMM yyyy HH:mm'), pageWidth - margin, 280, { align: 'right' });

  return doc;
}

/**
 * Generate a Surat Jalan (Delivery Note) PDF
 */
export function generateSuratJalanPDF(sj, so) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 87);
  drawLogo(doc, margin);
  doc.text(CO().name, margin + (CO().logo ? 26 : 0), 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(CO().address, margin, 26);
  doc.text(CO().contact, margin + (CO().logo ? 26 : 0), 31);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(0);
  doc.text('SURAT JALAN', pageWidth - margin, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(sj.sjNumber || sj.suratJalanNumber || '-', pageWidth - margin, 30, { align: 'right' });

  doc.setDrawColor(200);
  doc.line(margin, 37, pageWidth - margin, 37);

  // Bill-to and delivery details
  const y0 = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('DIKIRIM KEPADA:', margin, y0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(sj.shipToName || so?.customer?.displayName || '-', margin, y0 + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  const cust = so?.customer || {};
  const shipAddr = sj.shipToAddress || sj.shippingAddress || [cust.address, cust.city, cust.province].filter(Boolean).join(', ');
  if (shipAddr) doc.text(doc.splitTextToSize(shipAddr, 90), margin, y0 + 11);
  const shipPhone = sj.shipToPhone || cust.phone;
  if (shipPhone) doc.text('Telp: ' + shipPhone, margin, y0 + 22);
  if (sj.shipToName && so?.customer?.displayName && sj.shipToName !== so.customer.displayName) {
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text('via ' + so.customer.displayName, margin, y0 + 26);
  }
  // Clickable Google Maps link (memudahkan sopir membuka lokasi)
  const mapsUrl = sj.mapsUrl || cust.mapsUrl;
  if (mapsUrl) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(16, 122, 87);
    doc.textWithLink('> Buka Lokasi di Google Maps', margin, y0 + 32, { url: mapsUrl });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
  }

  // Right box: shipping meta
  const metaX = pageWidth - margin - 70;
  doc.setDrawColor(220);
  doc.roundedRect(metaX, y0, 70, 34, 2, 2);
  const meta = [
    ['No. SJ:', sj.sjNumber || sj.suratJalanNumber || '-'],
    ['Tgl. Kirim:', sj.deliveryDate ? format(new Date(sj.deliveryDate), 'dd MMM yyyy') : '-'],
    ['Ref. SO:', so?.soNumber || '-'],
    ['Ekspedisi:', sj.expedition || '-'],
    ['No. Kend.:', sj.vehicleNumber || '-'],
    ['Driver:', sj.driverName || '-'],
  ];
  doc.setFontSize(8);
  meta.forEach((line, idx) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    doc.text(line[0], metaX + 3, y0 + 5 + idx * 5);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text(String(line[1]), metaX + 68, y0 + 5 + idx * 5, { align: 'right' });
  });

  // Items (from SO items) — rinci kode simpan teralokasi + beratnya (model alokasi multi-stock)
  const items = (so?.items || []).map((it, idx) => {
    const allocs = it.allocations || [];
    const shipW = allocs.length > 0
      ? allocs.reduce((a, b) => a + Number(b.weight || 0), 0)
      : (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0));
    const kodeLines = allocs.length > 0
      ? allocs.map(a => `[${a.kodeSimpan} · ${Number(a.weight || 0).toFixed(1)} kg]`).join('\n')
      : (it.stock?.kodeSimpan ? `[${it.stock.kodeSimpan}]` : '');
    return [
      idx + 1,
      (it.product?.name || '-') +
        (it.product?.sku ? `\n${it.product.sku}` : '') +
        (kodeLines ? `\n${kodeLines}` : ''),
      allocs.length > 0 ? allocs.reduce((a, b) => a + Number(b.quantity || 0), 0) : Number(it.quantity || 0),
      pkgLabel(it.product?.packagingType),
      shipW.toLocaleString('id-ID') + ' kg',
      it.stock?.coldStorage?.code
        ? `${it.stock.coldStorage.code}${it.stock.zone?.code ? ' / ' + it.stock.zone.code : ''}`
        : '-',
    ];
  });

  autoTable(doc, {
    startY: y0 + 40,
    head: [['#', 'Deskripsi Barang', 'Qty', 'Kemasan', 'Berat', 'Lokasi Asal']],
    body: items,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 62 },
      2: { halign: 'right', cellWidth: 14 },
      3: { halign: 'center', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 26 },
      5: { halign: 'center' },
    },
    margin: { left: margin, right: margin },
  });

  const totalW = (so?.items || []).reduce((a, it) => {
    const allocs = it.allocations || [];
    return a + (allocs.length > 0
      ? allocs.reduce((x, b) => x + Number(b.weight || 0), 0)
      : (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0)));
  }, 0);
  const totalQ = (so?.items || []).reduce((a, it) => a + Number(it.quantity || 0), 0);

  const finalY = doc.lastAutoTable.finalY + 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text(`Total: ${totalQ} kemasan  ·  ${totalW.toFixed(1)} kg`, pageWidth - margin, finalY, { align: 'right' });

  if (sj.notes) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Catatan:', margin, finalY + 8);
    doc.setTextColor(80);
    doc.text(doc.splitTextToSize(sj.notes, pageWidth - margin*2), margin, finalY + 13);
  }

  // Signature block (Pengirim / Sopir / Penerima)
  const sigY = 230;
  const colWidth = (pageWidth - margin * 2) / 3;
  ['Diterima oleh,', 'Diantar oleh (Sopir),', 'Diserahkan oleh,'].forEach((label, i) => {
    const x = margin + i * colWidth;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80);
    doc.text(label, x + colWidth / 2, sigY, { align: 'center' });
    doc.text('(_______________________)', x + colWidth / 2, sigY + 25, { align: 'center' });
    doc.setFontSize(8); doc.setTextColor(120);
    const sub = i === 0 ? 'Nama & Tanda Tangan Penerima' : i === 1 ? sj.driverName || 'Sopir' : 'Petugas Gudang';
    doc.text(sub, x + colWidth / 2, sigY + 30, { align: 'center' });
  });

  doc.setDrawColor(200);
  doc.line(margin, 275, pageWidth - margin, 275);
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Surat Jalan ini merupakan dokumen resmi PT Ladang Pangan Indonesia', margin, 280);
  doc.text('Dicetak: ' + format(new Date(), 'dd MMM yyyy HH:mm'), pageWidth - margin, 280, { align: 'right' });

  return doc;
}

export function generatePOPDF(po) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 87);
  drawLogo(doc, margin);
  doc.text(CO().name, margin + (CO().logo ? 26 : 0), 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(CO().address, margin, 26);

  const isDropPO = !!po.isDropship;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isDropPO ? 15 : 20);
  doc.setTextColor(0);
  doc.text(isDropPO ? 'INVOICE / TAGIHAN SUPPLIER' : 'PURCHASE ORDER', pageWidth - margin, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(isDropPO ? (po.invoiceNumber || po.poNumber) : po.poNumber, pageWidth - margin, 30, { align: 'right' });
  if (isDropPO) {
    doc.setFontSize(8);
    doc.setTextColor(110);
    const invDate = po.invoiceDate || po.orderDate;
    doc.text(`Tgl Invoice: ${invDate ? format(new Date(invDate), 'dd MMM yyyy') : '-'}  ·  Ref PO: ${po.poNumber}`, pageWidth - margin, 34.5, { align: 'right' });
  }

  doc.setDrawColor(200);
  doc.line(margin, 37, pageWidth - margin, 37);

  const y0 = 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('SUPPLIER:', margin, y0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(po.supplier?.displayName || '-', margin, y0 + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  if (po.supplier?.phone) doc.text('Telp: ' + po.supplier.phone, margin, y0 + 12);
  if (po.supplier?.address) doc.text(doc.splitTextToSize(po.supplier.address, 90), margin, y0 + 17);

  const metaX = pageWidth - margin - 70;
  doc.setDrawColor(220);
  doc.roundedRect(metaX, y0, 70, 30, 2, 2);
  const meta = [
    ['Order Date:', po.orderDate ? format(new Date(po.orderDate), 'dd MMM yyyy') : '-'],
    ['Expected:', po.expectedDate ? format(new Date(po.expectedDate), 'dd MMM yyyy') : '-'],
    ['Payment Term:', po.paymentTerm || '-'],
    ['Method:', po.method || '-'],
    ['Type:', po.poType || '-'],
  ];
  doc.setFontSize(8);
  meta.forEach((l, i) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    doc.text(l[0], metaX + 3, y0 + 5 + i * 5.2);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text(String(l[1]), metaX + 67, y0 + 5 + i * 5.2, { align: 'right' });
  });

  const billedOf = (it) => {
    const b = it.billedWeight;
    return (b !== undefined && b !== null) ? Number(b) : Number(it.weight || 0);
  };
  const rows = (po.items || []).map((it, idx) => [
    idx + 1,
    (it.product?.name || '-') + (it.product?.sku ? `\n${it.product.sku}` : ''),
    Number(it.quantity || 0),
    pkgShort(it.product?.packagingType),
    billedOf(it).toLocaleString('id-ID', { maximumFractionDigits: 2 }),
    rupiah(it.unitPrice),
    rupiah(billedOf(it) * Number(it.unitPrice || 0)),
  ]);
  const basisLabel = { grn: 'GRN PO / Surat Jalan SO', so_receipt: 'Penerimaan Customer (SO)', tally: 'Rekonsiliasi Tally', shipped: 'Surat Jalan (Dikirim)' }[po.invoiceWeightBasis] || null;
  const weightColHeader = po.isDropship ? 'Berat Tagih (kg)' : 'Berat (kg)';

  autoTable(doc, {
    startY: y0 + 40,
    head: [['#', 'Deskripsi', 'Qty', 'Kemasan', weightColHeader, 'Harga/kg', 'Subtotal']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { cellWidth: 58 },
      2: { halign: 'right', cellWidth: 12 },
      3: { halign: 'center', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 24 },
      5: { halign: 'right', cellWidth: 28 },
      6: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  const finalY = doc.lastAutoTable.finalY + 5;
  const totalX = pageWidth - margin - 60;
  const subtotal = (po.items || []).reduce((a, it) => a + billedOf(it) * Number(it.unitPrice || 0), 0);
  const addCost = Number(po.additionalCost || 0);
  const total = Number(po.totalAmount || subtotal + addCost);
  // Caption basis berat tagihan (dropship / setelah GRN)
  if (basisLabel && (po.isDropship || Number(po.totalReceivedWeight || 0) > 0)) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Basis berat tagihan: ${basisLabel}`, margin, finalY);
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text('Subtotal', totalX, finalY);
  doc.text(rupiah(subtotal), pageWidth - margin, finalY, { align: 'right' });
  if (addCost > 0) {
    doc.text('Biaya Tambahan', totalX, finalY + 5);
    doc.text(rupiah(addCost), pageWidth - margin, finalY + 5, { align: 'right' });
  }
  const totalY = finalY + (addCost > 0 ? 11 : 6);
  doc.setDrawColor(200);
  doc.line(totalX, totalY - 1, pageWidth - margin, totalY - 1);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(16, 122, 87);
  doc.text('TOTAL', totalX, totalY + 4);
  doc.text(rupiah(total), pageWidth - margin, totalY + 4, { align: 'right' });

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Dokumen ini digenerate otomatis oleh sistem ERP PT Ladang Pangan Indonesia', margin, 275);
  doc.text('Dicetak: ' + format(new Date(), 'dd MMM yyyy HH:mm'), pageWidth - margin, 275, { align: 'right' });

  return doc;
}

/**
 * Generate a Tally Inbound (Laporan Penyimpanan) PDF
 * @param {Object} r - report object from Tally Inbound page
 */
export function generateTallyInboundPDF(r) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 87);
  drawLogo(doc, margin);
  doc.text(CO().name, margin + (CO().logo ? 26 : 0), 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(CO().address, margin, 26);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0);
  doc.text('LAPORAN TALLY INBOUND', pageWidth - margin, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(r.time ? format(new Date(r.time), 'dd MMM yyyy HH:mm') : '-', pageWidth - margin, 29, { align: 'right' });

  doc.setDrawColor(200);
  doc.line(margin, 34, pageWidth - margin, 34);

  // Meta block
  const y0 = 41;
  const meta = [
    ['Cold Storage:', `${r.csCode || '-'} ${r.csName || ''}`.trim()],
    ['Zona:', r.zoneCode || '-'],
    ['Referensi:', r.refType === 'MANUAL' ? 'Manual' : `${r.refType} · ${r.refNumber || '-'}`],
    ['Operator:', r.operator || '-'],
  ];
  doc.setFontSize(9);
  meta.forEach((l, i) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    doc.text(l[0], margin, y0 + i * 5.5);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text(String(l[1]), margin + 32, y0 + i * 5.5);
  });

  const rows = (r.items || []).map((it, idx) => [
    idx + 1,
    it.kodeSimpan || '-',
    (it.productName || '-') + (it.productSku ? `\n${it.productSku}` : ''),
    pkgLabel(it.packagingType),
    Number(it.quantity || 0),
    Number(it.weight || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 }),
    it.expiredDate ? format(new Date(it.expiredDate), 'dd-MM-yyyy') : '-',
  ]);

  autoTable(doc, {
    startY: y0 + meta.length * 5.5 + 3,
    head: [['#', 'Kode Simpan', 'Produk', 'Kemasan', 'Qty', 'Berat (kg)', 'Kadaluarsa']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { cellWidth: 30, font: 'courier' },
      2: { cellWidth: 60 },
      3: { halign: 'center', cellWidth: 24 },
      4: { halign: 'right', cellWidth: 14 },
      5: { halign: 'right', cellWidth: 24 },
      6: { halign: 'center' },
    },
    margin: { left: margin, right: margin },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  const totalQ = (r.items || []).reduce((a, it) => a + Number(it.quantity || 0), 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(16, 122, 87);
  doc.text(`TOTAL: ${(r.items || []).length} item · ${totalQ} kemasan · ${Number(r.totalWeight || 0).toFixed(1)} kg`, pageWidth - margin, finalY, { align: 'right' });

  if (r.notes) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0);
    doc.text('Catatan:', margin, finalY + 8);
    doc.setTextColor(80);
    doc.text(doc.splitTextToSize(r.notes, pageWidth - margin * 2), margin, finalY + 13);
  }

  // Signature
  const sigY = 245;
  const colWidth = (pageWidth - margin * 2) / 2;
  ['Dicatat oleh (Petugas Tally),', 'Diketahui oleh (Supervisor),'].forEach((label, i) => {
    const x = margin + i * colWidth;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80);
    doc.text(label, x + colWidth / 2, sigY, { align: 'center' });
    doc.text('(_______________________)', x + colWidth / 2, sigY + 22, { align: 'center' });
  });

  doc.setDrawColor(200);
  doc.line(margin, 275, pageWidth - margin, 275);
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text('Dokumen ini digenerate otomatis oleh sistem ERP PT Ladang Pangan Indonesia', margin, 280);
  doc.text('Dicetak: ' + format(new Date(), 'dd MMM yyyy HH:mm'), pageWidth - margin, 280, { align: 'right' });

  return doc;
}
