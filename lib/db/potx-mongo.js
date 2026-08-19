// =====================================================================
// PURCHASE ORDER + COMMISSION + SO-EXTRA aggregate -> MongoDB-authoritative.
// (Migration Phase 5, multi-replica safe)
// -------------------------------------------------------------------
// Covers the remaining transactional tables so PO value / supplier debt and the
// full SO detail (surat jalan / retur / penerimaan) stay consistent across the
// >=2 production replicas. Same philosophy as sales-mongo / inventory-mongo.
//
// These tables are mutated from MANY handlers (purchase-orders, grns, commissions,
// approvals, sales-orders dropship, tally-sessions AND /inventory inbound with a
// PO reference), so — like inventory Phase 4 — writes use a DIFF strategy:
//   captureSnapshot(request, sqlite)  (after hydrate, before the mutation)
//   persistSnapshotDiff(request, sqlite) (push ONLY added/changed/removed rows)
// Per-document upsert+delete => concurrency-safe (a pod never rewrites stale
// copies of rows it didn't touch). To never miss a writer, the route captures a
// snapshot on EVERY mutating request; the diff is empty & cheap when nothing here
// changed.
//
// Read path: hydrateToSqlite() = full replace of all these tables from Mongo with
// foreign_keys temporarily OFF (they have ON DELETE CASCADE FKs to sales_order /
// purchase_order / grn / receipts, so a plain delete+reload would cascade/ fail).
// Columns are introspected via PRAGMA table_info (robust to addColIfMissing).
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

// Parent-first order (children reference earlier entries); insert respects it.
const TABLES = [
  // SO extra children (parent sales_order is owned by sales-mongo)
  'surat_jalan', 'sales_returns', 'sales_order_receipts', 'sales_order_receipt_items',
  // Purchase Order aggregate
  'purchase_order', 'purchase_order_items', 'grn', 'grn_items', 'grn_documents', 'purchase_payments', 'purchase_returns',
  // Commission (dropship)
  'commission_records', 'commission_payments',
];
const META = 'mongo_migration';
const SEED_KEY = 'potx_v1';

const col = (t) => getMongoDb().collection(t);
const metaCol = () => getMongoDb().collection(META);

const _colsCache = {};
function tableCols(sqlite, t) { if (!_colsCache[t]) _colsCache[t] = sqlite.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name); return _colsCache[t]; }
const pick = (row, c) => { const o = {}; for (const k of c) o[k] = row[k] === undefined ? null : row[k]; return o; };

// request -> snapshot signature map ({ "table:id": sig }). Auto-GC'd per request.
const _snap = new WeakMap();

let _indexed = false;
async function ensureIndexes() {
  if (_indexed) return;
  try { for (const t of TABLES) await col(t).createIndex({ id: 1 }, { unique: true }); _indexed = true; } catch { /* best-effort */ }
}
async function isSeeded(k) { try { const d = await metaCol().findOne({ key: k }); return !!d?.done; } catch { return false; } }
async function markSeeded(k) { try { await metaCol().updateOne({ key: k }, { $set: { key: k, done: true, at: Date.now() } }, { upsert: true }); } catch { /* ignore */ } }

// One-time migrate of existing per-pod SQLite rows into MongoDB.
async function seed(sqlite) {
  if (await isSeeded(SEED_KEY)) return;
  try {
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      const rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
      if (rows.length) await col(t).bulkWrite(rows.map((r) => ({ replaceOne: { filter: { id: r.id }, replacement: pick(r, c), upsert: true } })), { ordered: false });
    }
  } catch (e) { console.error('[potx-mongo] seed failed:', e?.message || e); }
  await markSeeded(SEED_KEY);
}

// Full replace of the per-pod SQLite mirror from MongoDB (FK OFF during reload).
export async function hydrateToSqlite(sqlite) {
  const data = {};
  for (const t of TABLES) data[t] = await col(t).find({}, { projection: { _id: 0 } }).toArray();
  const fkWasOn = Number(sqlite.pragma('foreign_keys', { simple: true })) === 1;
  if (fkWasOn) sqlite.pragma('foreign_keys = OFF');
  try {
    const tx = sqlite.transaction(() => {
      for (const t of [...TABLES].reverse()) sqlite.prepare(`DELETE FROM ${t}`).run(); // children first
      for (const t of TABLES) {
        const c = tableCols(sqlite, t);
        const ins = sqlite.prepare(`INSERT OR REPLACE INTO ${t} (${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`);
        for (const r of data[t]) ins.run(...c.map((k) => (r[k] === undefined ? null : r[k])));
      }
    });
    tx();
  } finally {
    if (fkWasOn) sqlite.pragma('foreign_keys = ON');
  }
}

export async function ensureReady(sqlite) {
  try { await ensureIndexes(); await seed(sqlite); await hydrateToSqlite(sqlite); return true; }
  catch (e) { console.error('[potx-mongo] ensureReady failed:', e?.message || e); return false; }
}

// Snapshot signatures of all tracked rows for this request (AFTER hydrate, BEFORE mutation).
export function captureSnapshot(request, sqlite) {
  try {
    const m = {};
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      const rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
      for (const r of rows) m[t + ':' + r.id] = JSON.stringify(pick(r, c));
    }
    _snap.set(request, m);
  } catch (e) { console.error('[potx-mongo] captureSnapshot failed:', e?.message || e); }
}

// Persist ONLY rows added/changed/removed vs the request snapshot. Concurrency-safe.
export async function persistSnapshotDiff(request, sqlite) {
  const before = _snap.get(request);
  if (!before) return false;
  _snap.delete(request);
  try {
    const opsByTable = {};
    const nowKeys = new Set();
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      const rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
      for (const r of rows) {
        const key = t + ':' + r.id;
        nowKeys.add(key);
        const sig = JSON.stringify(pick(r, c));
        if (before[key] !== sig) (opsByTable[t] ||= []).push({ replaceOne: { filter: { id: r.id }, replacement: pick(r, c), upsert: true } });
      }
    }
    for (const key of Object.keys(before)) {
      if (!nowKeys.has(key)) {
        const i = key.indexOf(':');
        const t = key.slice(0, i); const id = key.slice(i + 1);
        (opsByTable[t] ||= []).push({ deleteOne: { filter: { id } } });
      }
    }
    let total = 0;
    for (const t of Object.keys(opsByTable)) { if (opsByTable[t].length) { await col(t).bulkWrite(opsByTable[t], { ordered: false }); total += opsByTable[t].length; } }
    return total;
  } catch (e) { console.error('[potx-mongo] persistSnapshotDiff failed:', e?.message || e); return false; }
}
