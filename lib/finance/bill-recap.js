// =====================================================================
// Rekap Tagihan (Keuangan) — logika server.
// -------------------------------------------------------------------
// buildPoLines(db, poIds)  -> baris per item PO (+ baris ongkir bila ditagih ke supplier) dengan SEMUA
//                             field rekap; dipakai saat generate (disimpan sbg snapshot terkunci) dan saat
//                             membuka rekap (dibandingkan dgn snapshot utk kolom Keterangan).
// buildRecapView(db, recap, items) -> rekap siap tampil: per supplier, baris snapshot + keterangan koreksi
//                             & status bayar terkini, subtotal, total setelah koreksi, sudah dibayar, sisa.
// Berat tagih mengikuti logika computePoInvoice() di route.js (basis grn/so_receipt utk dropship,
// shipped/tally utk non-dropship) supaya total baris = total invoice PO.
// =====================================================================
import { eq, inArray } from 'drizzle-orm';
import * as s from '@/lib/db/schema';
import { fmtDate, fmtNum, fmtRp } from '@/lib/finance/recap-fields';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const iso = (d) => { if (!d) return null; const t = d instanceof Date ? d : new Date(d); return isNaN(t.getTime()) ? null : t.toISOString(); };

// Sama dengan poBillWeight() di route.js.
function poBillWeight(it, basis) {
  const plan = Number(it.weight || 0);
  const sjW = Number(it.receivedWeight || 0) > 0 ? Number(it.receivedWeight) : plan;
  const tW = Number(it.tallyWeight || 0) > 0 ? Number(it.tallyWeight) : sjW;
  return basis === 'tally' ? tW : sjW;
}

export function freightOnBill(po) {
  const addCost = Number(po.additionalCost || 0);
  return (po.additionalCostBearer !== 'supplier' && (po.additionalCostPayMethod || 'utang') === 'utang') ? addCost : 0;
}

export function buildPoLines(db, poIds) {
  if (!poIds?.length) return [];
  const pos = db.select().from(s.purchaseOrder).where(inArray(s.purchaseOrder.id, poIds)).all();
  const contactCache = {};
  const contactOf = (id) => {
    if (!id) return null;
    if (!(id in contactCache)) contactCache[id] = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get() || null;
    return contactCache[id];
  };
  const productCache = {};
  const productOf = (id) => {
    if (!(id in productCache)) productCache[id] = db.select({ sku: s.products.sku, name: s.products.name }).from(s.products).where(eq(s.products.id, id)).get() || null;
    return productCache[id];
  };
  const lines = [];
  for (const po of pos) {
    const so = po.salesOrderId ? db.select().from(s.salesOrder).where(eq(s.salesOrder.id, po.salesOrderId)).get() : null;
    const supplier = contactOf(po.supplierId);
    const customer = contactOf(po.dropshipCustomerId || so?.customerId);
    const soShipped = {};
    const soReceived = {};
    let deliveryDate = null;
    if (so) {
      for (const si of db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, so.id)).all()) {
        soShipped[si.productId] = (soShipped[si.productId] || 0) + Number(si.shippedWeight || 0);
      }
      const recv = db.select({ productId: s.salesOrderReceiptItems.productId, receivedWeight: s.salesOrderReceiptItems.receivedWeight })
        .from(s.salesOrderReceiptItems)
        .innerJoin(s.salesOrderReceipts, eq(s.salesOrderReceiptItems.receiptId, s.salesOrderReceipts.id))
        .where(eq(s.salesOrderReceipts.salesOrderId, so.id)).all();
      for (const r of recv) soReceived[r.productId] = (soReceived[r.productId] || 0) + Number(r.receivedWeight || 0);
      const sjs = db.select({ d: s.suratJalan.deliveryDate }).from(s.suratJalan).where(eq(s.suratJalan.salesOrderId, so.id)).all();
      for (const sj of sjs) { const t = iso(sj.d); if (t && (!deliveryDate || t < deliveryDate)) deliveryDate = t; }
    }
    const basis = po.isDropship
      ? (po.invoiceWeightBasis === 'so_receipt' ? 'so_receipt' : 'grn')
      : (po.invoiceWeightBasis === 'tally' ? 'tally' : 'shipped');
    const base = {
      docId: po.id,
      supplierId: po.supplierId,
      supplierName: supplier?.displayName || supplier?.companyName || '-',
      date: iso(po.invoiceDate || po.orderDate),
      poDate: iso(po.orderDate),
      deliveryDate,
      invoiceNumber: po.invoiceNumber || null,
      poNumber: po.poNumber,
      soNumber: so?.soNumber || null,
      customer: customer?.displayName || customer?.companyName || null,
      customerCity: customer?.city || null,
      shipAddress: po.shippingAddress || null,
    };
    const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, po.id)).all();
    for (const it of items) {
      const shippedWeight = soShipped[it.productId] > 0 ? soShipped[it.productId] : poBillWeight(it, 'shipped');
      const receivedWeight = po.isDropship
        ? (soReceived[it.productId] != null ? soReceived[it.productId] : null)
        : (Number(it.tallyWeight || 0) > 0 ? Number(it.tallyWeight) : null);
      const billWeight = basis === 'so_receipt'
        ? (soReceived[it.productId] != null ? soReceived[it.productId] : poBillWeight(it, 'shipped'))
        : poBillWeight(it, basis === 'grn' ? 'shipped' : basis);
      const p = productOf(it.productId);
      lines.push({
        ...base,
        lineKey: it.id,
        sku: p?.sku || null,
        item: p?.name || '-',
        orderWeight: r2(it.weight),
        shippedWeight: r2(shippedWeight),
        receivedWeight: receivedWeight == null ? null : r2(receivedWeight),
        shrinkage: receivedWeight == null ? null : r2(shippedWeight - receivedWeight),
        billWeight: r2(billWeight),
        unitPrice: Number(it.unitPrice || 0),
        total: r2(Number(it.unitPrice || 0) * billWeight),
      });
    }
    const freight = freightOnBill(po);
    if (freight > 0) {
      lines.push({
        ...base, lineKey: `extra:${po.id}`, isExtra: true, sku: null, item: 'Ongkir / Biaya Tambahan',
        orderWeight: null, shippedWeight: null, receivedWeight: null, shrinkage: null, billWeight: null, unitPrice: null, total: r2(freight),
      });
    }
  }
  const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.invoiceNumber || a.poNumber).localeCompare(String(b.invoiceNumber || b.poNumber), undefined, { numeric: true });
  return lines.sort((a, b) => a.supplierName.localeCompare(b.supplierName) || byDate(a, b));
}

// Kenapa sebuah PO tidak boleh masuk rekap (null = boleh).
export function poRecapBlocker(po) {
  if (!po) return 'PO tidak ditemukan';
  if (po.pipelineStatus === 'Draft') return `${po.poNumber} masih Draft`;
  if (po.pipelineStatus === 'Dibatalkan') return `${po.poNumber} sudah dibatalkan`;
  if (po.archivedAt) return `${po.poNumber} sudah diarsipkan`;
  return null;
}

const CHANGE_FIELDS = [
  { key: 'shippedWeight', label: 'dikirim', fmt: (v) => `${fmtNum(v)} kg` },
  { key: 'receivedWeight', label: 'diterima', fmt: (v) => (v == null ? 'belum ada' : `${fmtNum(v)} kg`) },
  { key: 'unitPrice', label: 'harga', fmt: (v) => fmtRp(v) },
];

export function buildRecapView(db, recap, items) {
  const snapRows = items.slice().sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map((it) => ({ ...JSON.parse(it.snapshot), lineKey: it.lineKey, docId: it.docId, amount: Number(it.amount || 0) }));
  const docIds = [...new Set(snapRows.map((r) => r.docId))];
  const current = buildPoLines(db, docIds);
  const curByKey = {}; for (const c of current) curByKey[c.lineKey] = c;
  const snapKeys = new Set(snapRows.map((r) => r.lineKey));
  const pos = docIds.length ? db.select().from(s.purchaseOrder).where(inArray(s.purchaseOrder.id, docIds)).all() : [];
  const poById = {}; for (const p of pos) poById[p.id] = p;
  const lastPay = {};
  if (docIds.length) {
    for (const p of db.select().from(s.purchasePayments).where(inArray(s.purchasePayments.purchaseOrderId, docIds)).all()) {
      const t = iso(p.paymentDate);
      if (t && (!lastPay[p.purchaseOrderId] || t > lastPay[p.purchaseOrderId])) lastPay[p.purchaseOrderId] = t;
    }
  }
  const returnsOf = {};
  if (docIds.length) {
    for (const r of db.select().from(s.purchaseReturns).where(inArray(s.purchaseReturns.purchaseOrderId, docIds)).all()) {
      returnsOf[r.purchaseOrderId] = (returnsOf[r.purchaseOrderId] || 0) + Number(r.totalAmount || 0);
    }
  }

  // Keterangan per baris: koreksi data sesudah rekap dibuat.
  const correctedByDoc = {};
  const seenDoc = new Set();
  for (const row of snapRows) {
    const notes = [];
    const cur = curByKey[row.lineKey];
    const po = poById[row.docId];
    let curTotal = row.amount;
    if (!po) { notes.push({ tone: 'warn', text: 'PO sudah dihapus dari ERP' }); curTotal = 0; }
    else if (po.pipelineStatus === 'Dibatalkan') { notes.push({ tone: 'warn', text: 'PO dibatalkan' }); curTotal = 0; }
    else if (!cur) { notes.push({ tone: 'warn', text: 'Item ini sudah dihapus dari PO' }); curTotal = 0; }
    else {
      const diffs = [];
      for (const f of CHANGE_FIELDS) {
        const a = row[f.key]; const b = cur[f.key];
        const changed = (a == null) !== (b == null) || (a != null && Math.abs(Number(a) - Number(b)) > 0.004);
        if (changed) diffs.push(`${f.label} ${f.fmt(a)} → ${f.fmt(b)}`);
      }
      curTotal = cur.total;
      if (Math.abs(curTotal - row.amount) > 0.5 || diffs.length) {
        const delta = curTotal - row.amount;
        const tail = Math.abs(delta) > 0.5 ? `; total jadi ${fmtRp(curTotal)} (selisih ${delta > 0 ? '+' : '−'}${fmtRp(Math.abs(delta))})` : '';
        notes.push({ tone: 'warn', text: `Dikoreksi: ${diffs.join(', ') || 'nilai tagihan berubah'}${tail}` });
      }
    }
    row.currentTotal = r2(curTotal);
    correctedByDoc[row.docId] = (correctedByDoc[row.docId] || 0) + curTotal;
    // Status bayar — ditulis sekali di baris pertama tiap PO.
    if (po && !seenDoc.has(row.docId)) {
      seenDoc.add(row.docId);
      const paid = Number(po.paidAmount || 0);
      const when = lastPay[row.docId] ? ` ${fmtDate(lastPay[row.docId])}` : '';
      if (po.paymentStatus === 'paid') notes.push({ tone: 'ok', text: `${po.poNumber} sudah lunas dibayar${when}` });
      else if (paid > 0) notes.push({ tone: 'info', text: `${po.poNumber} dibayar sebagian ${fmtRp(paid)}${when}` });
      if (returnsOf[row.docId] > 0) notes.push({ tone: 'info', text: `Retur ${fmtRp(returnsOf[row.docId])} memotong tagihan` });
    }
    row.notes = notes;
  }
  // Item baru di PO yang belum ikut rekap.
  const extraNotesByDoc = {};
  for (const c of current) {
    if (snapKeys.has(c.lineKey)) continue;
    const po = poById[c.docId];
    if (!po || po.pipelineStatus === 'Dibatalkan') continue;
    correctedByDoc[c.docId] = (correctedByDoc[c.docId] || 0) + c.total;
    (extraNotesByDoc[c.docId] ||= []).push(c);
  }
  for (const [docId, list] of Object.entries(extraNotesByDoc)) {
    const first = snapRows.find((r) => r.docId === docId);
    if (first) for (const c of list) first.notes.push({ tone: 'warn', text: `Item baru di PO sesudah rekap dibuat: ${c.item} ${fmtRp(c.total)}` });
  }

  // Kelompok per supplier.
  const sections = [];
  const secBy = {};
  for (const row of snapRows) {
    let sec = secBy[row.supplierId];
    if (!sec) { sec = secBy[row.supplierId] = { supplierId: row.supplierId, supplierName: row.supplierName, rows: [], docIds: [] }; sections.push(sec); }
    sec.rows.push(row);
    if (!sec.docIds.includes(row.docId)) sec.docIds.push(row.docId);
  }
  const summarize = (docIdsList, rows) => {
    const snapshotTotal = r2(rows.reduce((a, r) => a + r.amount, 0));
    const correctedTotal = r2(docIdsList.reduce((a, d) => a + (correctedByDoc[d] || 0), 0));
    let paidTotal = 0;
    for (const d of docIdsList) {
      const po = poById[d];
      if (!po) continue;
      const settled = Number(po.paidAmount || 0) + Number(returnsOf[d] || 0);
      paidTotal += Math.min(Math.max(0, correctedByDoc[d] || 0), settled);
    }
    paidTotal = r2(paidTotal);
    return { snapshotTotal, correctedTotal, hasCorrection: Math.abs(correctedTotal - snapshotTotal) > 0.5, paidTotal, outstanding: r2(correctedTotal - paidTotal) };
  };
  for (const sec of sections) Object.assign(sec, summarize(sec.docIds, sec.rows));
  const totals = summarize(docIds, snapRows);
  return { sections, totals, docCount: docIds.length };
}
