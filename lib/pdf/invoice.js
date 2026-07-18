// PDF Invoice generator using jsPDF + jsPDF-autotable
// Designed for Sales Order invoices for PT Ladang Pangan Indonesia

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

/**
 * Generate a Sales Order invoice PDF
 * @param {Object} so - Sales order detail (with items, customer, payments)
 * @returns {jsPDF} - the doc (call doc.save('invoice.pdf'))
 */
export function generateInvoicePDF(so) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  // -- HEADER --
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(16, 122, 87);
  doc.text('PT LADANG PANGAN INDONESIA', margin, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text('Jl. Raya Cikarang No. 123, Bekasi, Jawa Barat 17530', margin, 26);
  doc.text('Telp: 021-5551000  ·  Email: info@lpi.co.id  ·  NPWP: 01.234.567.8-XXX.000', margin, 31);

  // Invoice title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(0);
  doc.text('INVOICE', pageWidth - margin, 22, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(so.invoiceNumber || so.soNumber, pageWidth - margin, 30, { align: 'right' });

  // Divider
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(margin, 37, pageWidth - margin, 37);

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
  const items = (so.items || []).map((it, idx) => [
    idx + 1,
    (it.product?.name || it.productName || '-') + (it.product?.sku ? `\n${it.product.sku}` : ''),
    Number(it.quantity || 0),
    (Number(it.weight || 0)).toLocaleString('id-ID'),
    rupiah(it.unitPrice),
    rupiah(it.discount || 0),
    rupiah((Number(it.weight || 0) * Number(it.unitPrice || 0)) - Number(it.discount || 0)),
  ]);

  autoTable(doc, {
    startY: y0 + 40,
    head: [['#', 'Deskripsi', 'Qty', 'Berat (kg)', 'Harga/kg', 'Diskon', 'Subtotal']],
    body: items,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 60 },
      2: { halign: 'right', cellWidth: 15 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 25 },
      5: { halign: 'right', cellWidth: 25 },
      6: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  // -- TOTALS --
  const finalY = doc.lastAutoTable.finalY + 5;
  const totalX = pageWidth - margin - 60;

  const drawRow = (label, val, y, opts = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.big ? 11 : 9);
    doc.setTextColor(opts.color || 0);
    doc.text(label, totalX, y);
    doc.text(val, pageWidth - margin, y, { align: 'right' });
  };

  const subtotal = (so.items || []).reduce((a, it) => a + Number(it.weight || 0) * Number(it.unitPrice || 0), 0);
  const discount = (so.items || []).reduce((a, it) => a + Number(it.discount || 0), 0);
  const total = Number(so.totalAmount || (subtotal - discount));
  const paid = Number(so.paidAmount || 0);
  const outstanding = Number(so.outstanding !== undefined ? so.outstanding : total - paid);
  const returns = Number(so.totalReturns || 0);

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
  doc.text('PT LADANG PANGAN INDONESIA', margin, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text('Jl. Raya Cikarang No. 123, Bekasi, Jawa Barat 17530', margin, 26);
  doc.text('Telp: 021-5551000  ·  Email: info@lpi.co.id  ·  NPWP: 01.234.567.8-XXX.000', margin, 31);

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

  const items = (so.items || []).map((it, idx) => [
    idx + 1,
    (it.product?.name || '-') +
      (it.product?.sku ? `\n${it.product.sku}` : '') +
      (it.stock?.kodeSimpan ? `\n[${it.stock.kodeSimpan}]` : ''),
    Number(it.quantity || 0),
    (Number(it.weight || 0)).toLocaleString('id-ID'),
    rupiah(it.unitPrice),
    rupiah(it.discount || 0),
    rupiah((Number(it.weight || 0) * Number(it.unitPrice || 0)) - Number(it.discount || 0)),
  ]);

  autoTable(doc, {
    startY: y0 + 40,
    head: [['#', 'Deskripsi', 'Qty', 'Berat (kg)', 'Harga/kg', 'Diskon', 'Subtotal']],
    body: items,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 60 },
      2: { halign: 'right', cellWidth: 15 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 25 },
      5: { halign: 'right', cellWidth: 25 },
      6: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  const finalY = doc.lastAutoTable.finalY + 5;
  const totalX = pageWidth - margin - 60;
  const subtotal = (so.items || []).reduce((a, it) => a + Number(it.weight || 0) * Number(it.unitPrice || 0), 0);
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
  doc.text('PT LADANG PANGAN INDONESIA', margin, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text('Jl. Raya Cikarang No. 123, Bekasi, Jawa Barat 17530', margin, 26);
  doc.text('Telp: 021-5551000  ·  info@lpi.co.id', margin, 31);

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
  doc.text(so?.customer?.displayName || '-', margin, y0 + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  const cust = so?.customer || {};
  const shipAddr = sj.shippingAddress || [cust.address, cust.city, cust.province].filter(Boolean).join(', ');
  if (shipAddr) doc.text(doc.splitTextToSize(shipAddr, 90), margin, y0 + 11);
  if (cust.phone) doc.text('Telp: ' + cust.phone, margin, y0 + 22);

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

  // Items (from SO items)
  const items = (so?.items || []).map((it, idx) => [
    idx + 1,
    (it.product?.name || '-') +
      (it.product?.sku ? `\n${it.product.sku}` : '') +
      (it.stock?.kodeSimpan ? `\n[${it.stock.kodeSimpan}]` : ''),
    Number(it.quantity || 0) + ' ' + (it.product?.unit || 'pcs'),
    Number(it.weight || 0).toLocaleString('id-ID') + ' kg',
    it.stock?.coldStorage?.code
      ? `${it.stock.coldStorage.code}${it.stock.zone?.code ? ' / ' + it.stock.zone.code : ''}`
      : '-',
  ]);

  autoTable(doc, {
    startY: y0 + 40,
    head: [['#', 'Deskripsi Barang', 'Qty', 'Berat', 'Lokasi Asal']],
    body: items,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 80 },
      2: { halign: 'right', cellWidth: 25 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'center' },
    },
    margin: { left: margin, right: margin },
  });

  const totalW = (so?.items || []).reduce((a, it) => a + Number(it.weight || 0), 0);
  const totalQ = (so?.items || []).reduce((a, it) => a + Number(it.quantity || 0), 0);

  const finalY = doc.lastAutoTable.finalY + 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0);
  doc.text(`Total: ${totalQ} unit  ·  ${totalW.toFixed(1)} kg`, pageWidth - margin, finalY, { align: 'right' });

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
  doc.text('PT LADANG PANGAN INDONESIA', margin, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text('Jl. Raya Cikarang No. 123, Bekasi  ·  021-5551000  ·  info@lpi.co.id', margin, 26);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(0);
  doc.text('PURCHASE ORDER', pageWidth - margin, 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(po.poNumber, pageWidth - margin, 30, { align: 'right' });

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

  const rows = (po.items || []).map((it, idx) => [
    idx + 1,
    (it.product?.name || '-') + (it.product?.sku ? `\n${it.product.sku}` : ''),
    Number(it.quantity || 0),
    Number(it.weight || 0).toLocaleString('id-ID'),
    rupiah(it.unitPrice),
    rupiah(Number(it.weight || 0) * Number(it.unitPrice || 0)),
  ]);

  autoTable(doc, {
    startY: y0 + 40,
    head: [['#', 'Deskripsi', 'Qty', 'Berat (kg)', 'Harga/kg', 'Subtotal']],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [16, 122, 87], textColor: 255, fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 70 },
      2: { halign: 'right', cellWidth: 15 },
      3: { halign: 'right', cellWidth: 25 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  const finalY = doc.lastAutoTable.finalY + 5;
  const totalX = pageWidth - margin - 60;
  const subtotal = (po.items || []).reduce((a, it) => a + Number(it.weight || 0) * Number(it.unitPrice || 0), 0);
  const addCost = Number(po.additionalCost || 0);
  const total = Number(po.totalAmount || subtotal + addCost);

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
