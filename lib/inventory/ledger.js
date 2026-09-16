import { v4 as uuidv4 } from 'uuid';
import * as s from '@/lib/db/schema';
import * as jmongo from '@/lib/accounting/journal-mongo';

// -----------------------
// Stock Ledger (Kartu Stok) helper
// Records a per-product stock movement. Wrapped in try/catch so a ledger
// failure never breaks the primary operation.
// -----------------------
export function recordLedger(db, entry) {
  const id = uuidv4();
  const ledgerDate = entry.ledgerDate || new Date();
  const createdAt = new Date();
  const vals = {
    id,
    ledgerDate,
    productId: entry.productId,
    coldStorageId: entry.coldStorageId || null,
    zoneId: entry.zoneId || null,
    movementType: entry.movementType,
    referenceType: entry.referenceType || null,
    referenceId: entry.referenceId || null,
    referenceNumber: entry.referenceNumber || null,
    qtyIn: Number(entry.qtyIn || 0),
    weightIn: Number(entry.weightIn || 0),
    qtyOut: Number(entry.qtyOut || 0),
    weightOut: Number(entry.weightOut || 0),
    hppPerKg: Number(entry.hppPerKg || 0),
    kodeSimpan: entry.kodeSimpan || null,
    transactionId: entry.transactionId || null,
    stockId: entry.stockId || null,
    notes: entry.notes || null,
    createdBy: entry.createdBy || null,
    createdAt,
  };
  try {
    db.insert(s.stockLedger).values(vals).run();
  } catch (e) {
    console.error('[stock_ledger] record failed:', e?.message || e);
  }
  // Mirror to MongoDB (shared Kartu Stok across replicas). Fire-and-forget;
  // stored in seconds to match the raw SQLite integer(timestamp) column.
  try {
    const toSec = (d) => Math.floor((d instanceof Date ? d.getTime() : new Date(d).getTime()) / 1000);
    jmongo.recordStockLedgerMongo({
      id,
      ledger_date: toSec(ledgerDate),
      product_id: vals.productId,
      cold_storage_id: vals.coldStorageId,
      zone_id: vals.zoneId,
      movement_type: vals.movementType,
      reference_type: vals.referenceType,
      reference_id: vals.referenceId,
      reference_number: vals.referenceNumber,
      qty_in: vals.qtyIn,
      weight_in: vals.weightIn,
      qty_out: vals.qtyOut,
      weight_out: vals.weightOut,
      hpp_per_kg: vals.hppPerKg,
      kode_simpan: vals.kodeSimpan,
      transaction_id: vals.transactionId,
      stock_id: vals.stockId,
      notes: vals.notes,
      created_by: vals.createdBy,
      created_at: toSec(createdAt),
    });
  } catch (e) { /* best-effort */ }
}
