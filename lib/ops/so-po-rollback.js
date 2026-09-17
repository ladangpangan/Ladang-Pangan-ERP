// =====================================================================
// Rollback & Hapus Total untuk Sales Order + Purchase Order (Fitur #1).
// -------------------------------------------------------------------
// Menggantikan scripts/rollback_so_po.js & scripts/delete_so_po.js (yang
// salah asumsi PO ada di MongoDB — PO sebenarnya bagian dari aggregate
// lib/db/potx-mongo.js, dihidrasi/di-diff-persist otomatis oleh
// captureSnapshot/persistSnapshotDiff di route.js selama request berjalan
// di path /sales-orders atau /purchase-orders). Modul ini HANYA menulis ke
// SQLite lewat `db` (Drizzle) — sinkronisasi ke Mongo untuk SO (sales-mongo),
// PO/komisi/SO-extra (potx-mongo), inventory_stock (inventory-mongo),
// inventory_transaction (tally-tx-mongo), approvals (wo-approval-mongo) dan
// notifications (misc-mongo) semuanya terjadi otomatis lewat mekanisme
// snapshot-diff sentral di route.js setelah handler ini selesai — TIDAK perlu
// dipanggil manual di sini. Satu-satunya yang perlu didorong manual ke Mongo
// adalah stock_ledger (Kartu Stok, di lib/accounting/journal-mongo.js) karena
// modul itu pakai insert fire-and-forget + merge-hydrate, bukan diff-persist.
//
// Jurnal akuntansi (journal_entries) TIDAK disentuh di sini sama sekali:
// semua jurnal terkait SO/PO (faktur, pembayaran, cashback, komisi, retur)
// selalu is_auto=1, diregenerasi ulang oleh acct.syncLedger() dari tabel
// sumber setiap kali `globalThis.__ledgerDirty` true (otomatis untuk semua
// request non-GET, lihat route.js). Menghapus baris sumbernya di sini sudah
// cukup — jurnalnya otomatis hilang di render berikutnya.
// =====================================================================
import fs from 'fs';
import nodePath from 'path';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, inArray } from 'drizzle-orm';
import * as s from '@/lib/db/schema';
import { getMongoDb } from '@/lib/db/mongo';
import { recordLedger } from '@/lib/inventory/ledger';

const BACKUP_DIR = nodePath.join(process.cwd(), 'data', 'backups');
const UPLOADS_DIR = nodePath.join(process.cwd(), 'data', 'uploads');

function unlinkSafe(relPath) {
  if (!relPath) return;
  try { fs.unlinkSync(nodePath.join(UPLOADS_DIR, relPath)); } catch { /* best-effort */ }
}

export function writeBackup(kind, number, payload) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeNumber = String(number || 'unknown').replace(/[\\/]/g, '_');
  const fileName = `${kind}_${safeNumber}_${ts}.json`;
  fs.writeFileSync(nodePath.join(BACKUP_DIR, fileName), JSON.stringify(payload, null, 2));
  return fileName;
}

// Hapus jejak Kartu Stok (stock_ledger) + catatan transaksi (inventory_transaction) untuk
// referensi SO/PO ini — termasuk entri reversal yang baru saja ditulis oleh
// freeSoStockAllocations()/di atas (SO-nya sendiri sudah balik ke Draft atau lenyap, jadi entri
// "reversal karena rollback/hapus SO X" tidak relevan dipertahankan sebagai riwayat permanen).
// inventory_transaction ikut mekanisme diff-persist otomatis (tally-tx-mongo, lihat komentar di
// atas) jadi cukup dihapus lokal di sini. stock_ledger TIDAK ikut mekanisme itu (insert
// fire-and-forget + merge-hydrate di journal-mongo.js) — harus dihapus manual di kedua sisi
// (SQLite lokal + koleksi Mongo) supaya tidak "hidup lagi" saat hydrate berikutnya.
async function deleteStockMovementsForRef(db, referenceType, referenceId) {
  db.delete(s.stockLedger).where(and(eq(s.stockLedger.referenceType, referenceType), eq(s.stockLedger.referenceId, referenceId))).run();
  db.delete(s.inventoryTransaction).where(and(eq(s.inventoryTransaction.referenceType, referenceType), eq(s.inventoryTransaction.referenceId, referenceId))).run();
  try { await getMongoDb().collection('stock_ledger').deleteMany({ reference_type: referenceType, reference_id: referenceId }); }
  catch (e) { console.error('[so-po-rollback] gagal hapus stock_ledger di Mongo:', e?.message || e); }
}

export function findLinkedPo(db, so) {
  if (!so) return null;
  if (so.autoPoId) {
    const byAuto = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, so.autoPoId)).get();
    if (byAuto) return byAuto;
  }
  return db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.salesOrderId, so.id)).get() || null;
}

export function findWorkOrdersForPo(db, poId) {
  return db.select().from(s.workOrder).where(eq(s.workOrder.purchaseOrderId, poId)).all();
}

// ---------------------------------------------------------------------
// Bundle gathering (dipakai untuk preview & isi file backup)
// ---------------------------------------------------------------------
export function gatherSoChildren(db, soId) {
  const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
  const stocks = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.salesOrderId, soId)).all();
  const payments = db.select().from(s.salesPayments).where(eq(s.salesPayments.salesOrderId, soId)).all();
  const sjs = db.select().from(s.suratJalan).where(eq(s.suratJalan.salesOrderId, soId)).all();
  const receipts = db.select().from(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.salesOrderId, soId)).all();
  const rcIds = receipts.map((x) => x.id);
  const receiptItems = rcIds.length ? db.select().from(s.salesOrderReceiptItems).where(inArray(s.salesOrderReceiptItems.receiptId, rcIds)).all() : [];
  const returns = db.select().from(s.salesReturns).where(eq(s.salesReturns.salesOrderId, soId)).all();
  const commissionRecords = db.select().from(s.commissionRecords).where(eq(s.commissionRecords.salesOrderId, soId)).all();
  const approvals = db.select().from(s.approvals).where(eq(s.approvals.entityId, soId)).all();
  const notifications = db.select().from(s.notifications).where(eq(s.notifications.entityId, soId)).all();
  return { items, stocks, payments, sjs, receipts, receiptItems, returns, commissionRecords, approvals, notifications };
}

export function gatherPoChildren(db, poId) {
  const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, poId)).all();
  const grns = db.select().from(s.grn).where(eq(s.grn.purchaseOrderId, poId)).all();
  const grnIds = grns.map((x) => x.id);
  const grnItems = grnIds.length ? db.select().from(s.grnItems).where(inArray(s.grnItems.grnId, grnIds)).all() : [];
  const grnDocuments = grnIds.length ? db.select().from(s.grnDocuments).where(inArray(s.grnDocuments.grnId, grnIds)).all() : [];
  const payments = db.select().from(s.purchasePayments).where(eq(s.purchasePayments.purchaseOrderId, poId)).all();
  const returns = db.select().from(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, poId)).all();
  const inboundStocks = db.select().from(s.inventoryStock).where(and(eq(s.inventoryStock.sourceType, 'PO'), eq(s.inventoryStock.sourceBatch, poId))).all();
  const workOrders = findWorkOrdersForPo(db, poId);
  const approvals = db.select().from(s.approvals).where(eq(s.approvals.entityId, poId)).all();
  const notifications = db.select().from(s.notifications).where(eq(s.notifications.entityId, poId)).all();
  return { items, grns, grnItems, grnDocuments, payments, returns, inboundStocks, workOrders, approvals, notifications };
}

// ---------------------------------------------------------------------
// Reversal helpers (stok)
// ---------------------------------------------------------------------

// Bebaskan semua kode simpan yang teralokasi/terpakai oleh SO ini kembali ke 'active',
// dengan reversal Kartu Stok untuk yang sudah 'used' — sama persis dengan logika
// pembatalan SO (POST /sales-orders/:id/status -> Cancelled) di route.js.
function freeSoStockAllocations(db, soId, soNumber, userEmail) {
  const allocs = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.salesOrderId, soId)).all();
  let restoredW = 0, restoredQ = 0, restoredCount = 0;
  for (const al of allocs) {
    const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, al.stockId)).get();
    if (!stk || (stk.status !== 'allocated' && stk.status !== 'used')) continue;
    const wasUsed = stk.status === 'used';
    db.update(s.inventoryStock).set({ status: 'active', updatedAt: new Date() }).where(eq(s.inventoryStock.id, al.stockId)).run();
    restoredCount++;
    if (wasUsed) {
      const w = Number(stk.weight || al.weight || 0);
      const q = Number(stk.quantity || al.quantity || 0);
      restoredW += w; restoredQ += q;
      recordLedger(db, {
        productId: al.productId || stk.productId,
        coldStorageId: stk.coldStorageId || null,
        zoneId: stk.zoneId || null,
        movementType: 'IN',
        referenceType: 'SO',
        referenceId: soId,
        referenceNumber: soNumber,
        weightIn: w,
        qtyIn: q,
        hppPerKg: Number(stk.hppPerKg || al.hppPerKg || 0),
        kodeSimpan: al.kodeSimpan || stk.kodeSimpan || null,
        stockId: al.stockId,
        notes: `Reversal — rollback/hapus SO ${soNumber}`,
        createdBy: userEmail,
      });
    }
  }
  if (restoredW > 0 || restoredQ > 0) {
    db.insert(s.inventoryTransaction).values({
      id: uuidv4(), transactionDate: new Date(), transactionType: 'IN',
      referenceId: soId, referenceType: 'SO', totalWeight: restoredW, totalQuantity: restoredQ,
      notes: `Reversal stok — rollback/hapus SO ${soNumber} (${restoredCount} kode simpan)`,
      createdBy: userEmail,
    }).run();
  }
  return { restoredCount, restoredW, restoredQ };
}

// Validasi MURNI (tidak menulis apa pun) — dipanggil SEBELUM mutasi apa pun dimulai, supaya kalau PO
// ini punya kode simpan yang sudah bergerak (allocated/used oleh transaksi lain, mis. SO lain), aksi
// gagal SEBELUM SO/PO sempat berubah sebagian (mencegah state nyangkut setengah jalan).
function assertPoStockReversible(db, poId, poNumber) {
  const lots = db.select().from(s.inventoryStock).where(and(eq(s.inventoryStock.sourceType, 'PO'), eq(s.inventoryStock.sourceBatch, poId))).all();
  const notActive = lots.filter((l) => l.status !== 'active');
  if (notActive.length) {
    const list = notActive.map((l) => `${l.kodeSimpan} (${l.status})`).join(', ');
    const e = new Error(`PO ${poNumber}: ${notActive.length} kode simpan hasil inbound PO ini sudah bergerak (${list}) — tidak bisa rollback/hapus otomatis. Selesaikan/rollback transaksi yang memakainya dulu.`);
    e.status = 409;
    throw e;
  }
  return lots;
}

// Mutasi murni — hapus lot yang sudah divalidasi assertPoStockReversible() lebih dulu.
function deletePoInboundStockLots(db, poId) {
  const lots = db.select().from(s.inventoryStock).where(and(eq(s.inventoryStock.sourceType, 'PO'), eq(s.inventoryStock.sourceBatch, poId))).all();
  for (const l of lots) db.delete(s.inventoryStock).where(eq(s.inventoryStock.id, l.id)).run();
  return { removedLots: lots.length };
}

function assertNoLinkedWorkOrder(db, po) {
  const wos = findWorkOrdersForPo(db, po.id);
  if (wos.length) {
    const list = wos.map((w) => w.woNumber).join(', ');
    const e = new Error(`PO ${po.poNumber} dipakai oleh Work Order (Maklon): ${list}. Lepas/hapus referensi WO tersebut dulu sebelum rollback/hapus PO ini.`);
    e.status = 409;
    throw e;
  }
}

function deleteSoChildren(db, soId) {
  const children = gatherSoChildren(db, soId);
  const rcIds = children.receipts.map((x) => x.id);
  if (rcIds.length) db.delete(s.salesOrderReceiptItems).where(inArray(s.salesOrderReceiptItems.receiptId, rcIds)).run();
  db.delete(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.salesOrderId, soId)).run();
  db.delete(s.suratJalan).where(eq(s.suratJalan.salesOrderId, soId)).run();
  db.delete(s.salesReturns).where(eq(s.salesReturns.salesOrderId, soId)).run();
  db.delete(s.salesPayments).where(eq(s.salesPayments.salesOrderId, soId)).run();
  db.delete(s.soItemStocks).where(eq(s.soItemStocks.salesOrderId, soId)).run();
  // Komisi: yang BELUM dibayar aman dihapus (tidak pernah dijurnal — lihat lib/accounting/engine.js
  // syncLedger, jurnal komisi hanya lahir dari commission_payments saat status='paid'). Yang SUDAH
  // dibayar TETAP DIPERTAHANKAN (uangnya sudah benar-benar keluar & tercatat di commission_payments,
  // yang bisa mencakup SO lain juga) — hanya lepaskan tautannya ke SO ini (skema sudah menyediakan
  // onDelete:'set null' untuk pola ini).
  const unpaidCommIds = children.commissionRecords.filter((c) => c.status !== 'paid').map((c) => c.id);
  if (unpaidCommIds.length) db.delete(s.commissionRecords).where(inArray(s.commissionRecords.id, unpaidCommIds)).run();
  const paidCommIds = children.commissionRecords.filter((c) => c.status === 'paid').map((c) => c.id);
  if (paidCommIds.length) db.update(s.commissionRecords).set({ salesOrderId: null }).where(inArray(s.commissionRecords.id, paidCommIds)).run();
  return { ...children, paidCommissionsOrphaned: paidCommIds.length };
}

function deletePoChildren(db, poId) {
  const grns = db.select().from(s.grn).where(eq(s.grn.purchaseOrderId, poId)).all();
  const grnIds = grns.map((x) => x.id);
  if (grnIds.length) {
    const docs = db.select().from(s.grnDocuments).where(inArray(s.grnDocuments.grnId, grnIds)).all();
    for (const d of docs) unlinkSafe(d.storageKey);
    db.delete(s.grnDocuments).where(inArray(s.grnDocuments.grnId, grnIds)).run();
    db.delete(s.grnItems).where(inArray(s.grnItems.grnId, grnIds)).run();
  }
  db.delete(s.grn).where(eq(s.grn.purchaseOrderId, poId)).run();
  db.delete(s.purchasePayments).where(eq(s.purchasePayments.purchaseOrderId, poId)).run();
  db.delete(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, poId)).run();
}

function deleteApprovalsAndNotifications(db, entityIds) {
  const ids = entityIds.filter(Boolean);
  if (!ids.length) return;
  db.delete(s.approvals).where(inArray(s.approvals.entityId, ids)).run();
  db.delete(s.notifications).where(inArray(s.notifications.entityId, ids)).run();
}

function resetSoItemsToDraft(db, soId) {
  const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
  for (const it of items) {
    db.update(s.salesOrderItems).set({ stockCodeId: null, outboundTallyStatus: 'none', shippedWeight: 0, receivedWeight: 0 }).where(eq(s.salesOrderItems.id, it.id)).run();
  }
}

function resetPoItemsToDraft(db, poId) {
  const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, poId)).all();
  for (const it of items) {
    db.update(s.purchaseOrderItems).set({ receivedWeight: 0, tallyWeight: 0 }).where(eq(s.purchaseOrderItems.id, it.id)).run();
  }
}

// ---------------------------------------------------------------------
// Orkestrasi utama — dipanggil dari route.js. `apply=false` (default) TIDAK
// menulis apa pun, hanya mengembalikan bundle untuk preview.
// ---------------------------------------------------------------------
export async function runSoRollback(db, soId, { apply = false, full = false, userEmail } = {}) {
  const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
  if (!so) { const e = new Error('Sales Order tidak ditemukan'); e.status = 404; throw e; }
  const po = findLinkedPo(db, so);
  if (po) {
    assertNoLinkedWorkOrder(db, po);
    assertPoStockReversible(db, po.id, po.poNumber); // validasi murni — lempar error SEBELUM mutasi apa pun
  }

  const soChildren = gatherSoChildren(db, soId);
  const poChildren = po ? gatherPoChildren(db, po.id) : null;

  if (!apply) return { so, po, soChildren, poChildren };

  const backupFile = writeBackup(full ? 'DELETE_SOPO' : 'ROLLBACK_SOPO', so.soNumber, { so, po, soChildren, poChildren });

  const soReversal = freeSoStockAllocations(db, soId, so.soNumber, userEmail);
  let poReversal = null;
  if (po) poReversal = deletePoInboundStockLots(db, po.id);

  const deletedSoChildren = deleteSoChildren(db, soId);
  if (po) deletePoChildren(db, po.id);
  deleteApprovalsAndNotifications(db, [soId, po?.id]);
  await deleteStockMovementsForRef(db, 'SO', soId);
  if (po) await deleteStockMovementsForRef(db, 'PO', po.id);

  if (full) {
    db.delete(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).run();
    db.delete(s.salesOrder).where(eq(s.salesOrder.id, soId)).run();
    if (po) {
      db.delete(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, po.id)).run();
      db.delete(s.purchaseOrder).where(eq(s.purchaseOrder.id, po.id)).run();
    }
  } else {
    resetSoItemsToDraft(db, soId);
    db.update(s.salesOrder).set({
      pipelineStatus: 'Draft', invoiceNumber: null, invoiceDate: null, dueDate: null,
      paidAmount: 0, paymentStatus: 'unpaid', updatedAt: new Date(),
    }).where(eq(s.salesOrder.id, soId)).run();
    if (po) {
      resetPoItemsToDraft(db, po.id);
      db.update(s.purchaseOrder).set({
        pipelineStatus: 'Draft', invoiceNumber: null, invoiceDate: null, dueDate: null,
        paidAmount: 0, paymentStatus: 'unpaid', tallyCompletedAt: null, updatedAt: new Date(),
      }).where(eq(s.purchaseOrder.id, po.id)).run();
    }
  }

  return { backupFile, so, po, soReversal, poReversal, paidCommissionsOrphaned: deletedSoChildren.paidCommissionsOrphaned };
}

export async function runPoRollback(db, poId, { apply = false, full = false, userEmail } = {}) {
  const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, poId)).get();
  if (!po) { const e = new Error('Purchase Order tidak ditemukan'); e.status = 404; throw e; }
  assertNoLinkedWorkOrder(db, po);
  // Kalau PO ini adalah PO dropship otomatis milik sebuah SO, arahkan lewat SO supaya SO ikut
  // dirollback/dihapus juga (satu aksi, sesuai keputusan produk) — bukan PO sendirian yang jadi yatim.
  if (po.salesOrderId) {
    const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, po.salesOrderId)).get();
    if (so) return runSoRollback(db, so.id, { apply, full, userEmail });
  }
  assertPoStockReversible(db, poId, po.poNumber); // validasi murni — lempar error SEBELUM mutasi apa pun

  const poChildren = gatherPoChildren(db, poId);
  if (!apply) return { po, poChildren };

  const backupFile = writeBackup(full ? 'DELETE_PO' : 'ROLLBACK_PO', po.poNumber, { po, poChildren });
  const poReversal = deletePoInboundStockLots(db, poId);
  deletePoChildren(db, poId);
  deleteApprovalsAndNotifications(db, [poId]);
  await deleteStockMovementsForRef(db, 'PO', poId);

  if (full) {
    db.delete(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, poId)).run();
    db.delete(s.purchaseOrder).where(eq(s.purchaseOrder.id, poId)).run();
  } else {
    resetPoItemsToDraft(db, poId);
    db.update(s.purchaseOrder).set({
      pipelineStatus: 'Draft', invoiceNumber: null, invoiceDate: null, dueDate: null,
      paidAmount: 0, paymentStatus: 'unpaid', tallyCompletedAt: null, updatedAt: new Date(),
    }).where(eq(s.purchaseOrder.id, poId)).run();
  }

  return { backupFile, po, poReversal };
}
