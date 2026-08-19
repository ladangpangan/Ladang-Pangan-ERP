// =====================================================================
// INVENTORY STOCK — MongoDB-authoritative store (Phase 4, multi-replica safe).
// -------------------------------------------------------------------
// Same mirror/hydration philosophy as coa-mongo / journal-mongo / sales-mongo,
// but WRITES use a DIFF strategy instead of a full-collection replace because
// inventory_stock is mutated (status active/allocated/sold, qty, zone, split,
// opname) from MANY handlers (sales-orders, tally-outbound, inventory, opnames).
//
// Read path:  hydrateInventoryToSqlite() = full replace of the per-pod SQLite
//   inventory_stock mirror from Mongo (foreign_keys OFF during the delete+reload
//   because stock_opname_items.stock_id / so_item_stocks.stock_id reference it).
// Write path: captureSnapshot() records a per-request signature map of every
//   stock row (keyed by the Request object via a WeakMap) right AFTER hydrate and
//   BEFORE the mutation; persistSnapshotDiff() then pushes ONLY the rows that were
//   added / changed / removed. Per-document upsert+delete => concurrency-safe: a
//   pod never re-writes stale copies of rows it did not touch, so it cannot
//   clobber another replica's status/qty change.
//
// Scope: inventory_stock (physical stock lots + allocation status + quantities).
// stock_ledger (Kartu Stok) is already Mongo-authoritative (Phase 2). Operation
// records (inventory_transaction, stock_opname, grn) remain SQLite for now — the
// resulting inventory_stock changes they cause ARE captured by the diff-persist.
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

const TABLE = 'inventory_stock';
const META = 'mongo_migration';
const SEED_KEY = 'inventory_v1';

const col = () => getMongoDb().collection(TABLE);
const metaCol = () => getMongoDb().collection(META);

let _cols = null;
function cols(sqlite) { if (!_cols) _cols = sqlite.prepare(`PRAGMA table_info(${TABLE})`).all().map((r) => r.name); return _cols; }
const pick = (row, c) => { const o = {}; for (const k of c) o[k] = row[k] === undefined ? null : row[k]; return o; };

// Per-request "before" snapshots, keyed by the Request object (auto-GC'd).
const _snap = new WeakMap();

let _indexed = false;
async function ensureIndexes() { if (_indexed) return; try { await col().createIndex({ id: 1 }, { unique: true }); _indexed = true; } catch { /* best-effort */ } }
async function isSeeded(k) { try { const d = await metaCol().findOne({ key: k }); return !!d?.done; } catch { return false; } }
async function markSeeded(k) { try { await metaCol().updateOne({ key: k }, { $set: { key: k, done: true, at: Date.now() } }, { upsert: true }); } catch { /* ignore */ } }

// One-time migrate of existing per-pod SQLite stock into MongoDB.
export async function inventoryEnsureSeeded(sqlite) {
  if (await isSeeded(SEED_KEY)) return { seeded: false };
  try {
    const c = cols(sqlite);
    const rows = sqlite.prepare(`SELECT * FROM ${TABLE}`).all();
    if (rows.length) await col().bulkWrite(rows.map((r) => ({ replaceOne: { filter: { id: r.id }, replacement: pick(r, c), upsert: true } })), { ordered: false });
  } catch (e) { console.error('[inventory-mongo] seed migrate failed:', e?.message || e); }
  await markSeeded(SEED_KEY);
  return { seeded: true };
}

// Full replace of the per-pod SQLite inventory_stock mirror from MongoDB.
export async function hydrateInventoryToSqlite(sqlite) {
  const rows = await col().find({}, { projection: { _id: 0 } }).toArray();
  const c = cols(sqlite);
  const fkWasOn = Number(sqlite.pragma('foreign_keys', { simple: true })) === 1;
  if (fkWasOn) sqlite.pragma('foreign_keys = OFF');
  try {
    const ins = sqlite.prepare(`INSERT OR REPLACE INTO ${TABLE} (${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`);
    const tx = sqlite.transaction(() => {
      sqlite.prepare(`DELETE FROM ${TABLE}`).run();
      for (const r of rows) ins.run(...c.map((k) => (r[k] === undefined ? null : r[k])));
    });
    tx();
  } finally {
    if (fkWasOn) sqlite.pragma('foreign_keys = ON');
  }
  return rows.length;
}

export async function ensureInventoryReady(sqlite) {
  try {
    await ensureIndexes();
    await inventoryEnsureSeeded(sqlite);
    await hydrateInventoryToSqlite(sqlite);
    return true;
  } catch (e) {
    console.error('[inventory-mongo] ensureInventoryReady failed:', e?.message || e);
    return false;
  }
}

// Snapshot current stock signatures for this request (call AFTER hydrate, BEFORE
// the mutation). Cheap JSON signature per row so we can diff at the end.
export function captureSnapshot(request, sqlite) {
  try {
    const c = cols(sqlite);
    const rows = sqlite.prepare(`SELECT * FROM ${TABLE}`).all();
    const m = {};
    for (const r of rows) m[r.id] = JSON.stringify(pick(r, c));
    _snap.set(request, m);
  } catch (e) { console.error('[inventory-mongo] captureSnapshot failed:', e?.message || e); }
}

// Persist ONLY the stock rows that were added / changed / removed vs the snapshot
// taken at the start of this request. Per-document ops => concurrency-safe.
export async function persistSnapshotDiff(request, sqlite) {
  const before = _snap.get(request);
  if (!before) return false;
  _snap.delete(request);
  try {
    const c = cols(sqlite);
    const rows = sqlite.prepare(`SELECT * FROM ${TABLE}`).all();
    const nowIds = new Set();
    const ops = [];
    for (const r of rows) {
      nowIds.add(r.id);
      const sig = JSON.stringify(pick(r, c));
      if (before[r.id] !== sig) ops.push({ replaceOne: { filter: { id: r.id }, replacement: pick(r, c), upsert: true } });
    }
    for (const id of Object.keys(before)) { if (!nowIds.has(id)) ops.push({ deleteOne: { filter: { id } } }); }
    if (ops.length) await col().bulkWrite(ops, { ordered: false });
    return ops.length;
  } catch (e) { console.error('[inventory-mongo] persistSnapshotDiff failed:', e?.message || e); return false; }
}
