// =====================================================================
// SALES ORDER — MongoDB-authoritative store (Phase 3, multi-replica safe).
// -------------------------------------------------------------------
// Same mirror/hydration pattern as coa-mongo.js / journal-mongo.js.
// MongoDB is the SHARED source of truth for the SO aggregate so it stays
// consistent across the >=2 production replicas; per-pod better-sqlite3 is a
// compute mirror hydrated before reads and updated per-SO after writes.
//
// Scope (Phase 3, as requested): the SO aggregate keyed by sales_order id:
//   - sales_order              (parent)
//   - sales_order_items        (child, sales_order_id)
//   - so_item_stocks           (child, sales_order_id — stock allocations)
//   - sales_payments           (child, sales_order_id)
//
// NOT in this phase (still per-pod SQLite): surat_jalan, sales_returns,
// sales_order_receipts(+items). Those tables have ON DELETE CASCADE FKs to
// sales_order, so hydrate temporarily DISABLES foreign_keys before the
// delete+reload of the SO tables to avoid cascade-wiping them.
//
// Columns are introspected at runtime via PRAGMA table_info so the module is
// robust to the many addColIfMissing() migrations on these tables.
// Persist is PER-SO (upsert one aggregate) — never a full-collection replace —
// so concurrent writes to different SOs on different pods never clobber.
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

const PARENT = 'sales_order';
const CHILDREN = ['sales_order_items', 'so_item_stocks', 'sales_payments'];
const TABLES = [PARENT, ...CHILDREN];
const META = 'mongo_migration';
const SEED_KEY = 'sales_v1';

const col = (t) => getMongoDb().collection(t);
const metaCol = () => getMongoDb().collection(META);

const _colsCache = {};
function tableCols(sqlite, table) {
  if (!_colsCache[table]) _colsCache[table] = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  return _colsCache[table];
}
const pick = (row, cols) => { const o = {}; for (const c of cols) o[c] = row[c] === undefined ? null : row[c]; return o; };

let _indexed = false;
async function ensureIndexes() {
  if (_indexed) return;
  try {
    await col(PARENT).createIndex({ id: 1 }, { unique: true });
    for (const t of CHILDREN) {
      await col(t).createIndex({ id: 1 }, { unique: true });
      await col(t).createIndex({ sales_order_id: 1 });
    }
    _indexed = true;
  } catch { /* best-effort */ }
}

async function isSeeded(key) { try { const d = await metaCol().findOne({ key }); return !!d?.done; } catch { return false; } }
async function markSeeded(key) { try { await metaCol().updateOne({ key }, { $set: { key, done: true, at: Date.now() } }, { upsert: true }); } catch { /* ignore */ } }

// One-time migrate of any EXISTING per-pod SQLite SO aggregate into MongoDB so
// we don't lose data the first time the Mongo-authoritative flow turns on.
export async function salesEnsureSeeded(sqlite) {
  if (await isSeeded(SEED_KEY)) return { seeded: false };
  try {
    for (const t of TABLES) {
      const cols = tableCols(sqlite, t);
      const rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
      if (rows.length) {
        await col(t).bulkWrite(rows.map((r) => ({ replaceOne: { filter: { id: r.id }, replacement: pick(r, cols), upsert: true } })), { ordered: false });
      }
    }
  } catch (e) { console.error('[sales-mongo] seed migrate failed:', e?.message || e); }
  await markSeeded(SEED_KEY);
  return { seeded: true };
}

// Refresh the per-pod SQLite mirror of the SO aggregate from MongoDB (full
// replace of the 4 SO tables). foreign_keys is toggled OFF during the
// delete+reload so the not-yet-migrated SO children (surat_jalan / returns /
// receipts) are NOT cascade-deleted.
export async function hydrateSalesToSqlite(sqlite) {
  const data = {};
  for (const t of TABLES) data[t] = await col(t).find({}, { projection: { _id: 0 } }).toArray();

  const fkWasOn = Number(sqlite.pragma('foreign_keys', { simple: true })) === 1;
  if (fkWasOn) sqlite.pragma('foreign_keys = OFF');
  try {
    const tx = sqlite.transaction(() => {
      // delete children first, parent last (defensive even with FK off)
      for (const t of [...CHILDREN, PARENT]) sqlite.prepare(`DELETE FROM ${t}`).run();
      for (const t of TABLES) {
        const cols = tableCols(sqlite, t);
        const ins = sqlite.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        for (const r of data[t]) ins.run(...cols.map((c) => (r[c] === undefined ? null : r[c])));
      }
    });
    tx();
  } finally {
    if (fkWasOn) sqlite.pragma('foreign_keys = ON');
  }
  return data[PARENT].length;
}

// seed (first run) + hydrate. Best-effort — never throws so the engine/reads
// gracefully fall back to the existing SQLite mirror if Mongo is unavailable.
export async function ensureSalesReady(sqlite) {
  try {
    await ensureIndexes();
    await salesEnsureSeeded(sqlite);
    await hydrateSalesToSqlite(sqlite);
    return true;
  } catch (e) {
    console.error('[sales-mongo] ensureSalesReady failed:', e?.message || e);
    return false;
  }
}

// Persist ONE SO aggregate (parent + its children) from SQLite -> MongoDB.
// If the SO no longer exists locally (was deleted) it is removed from Mongo.
export async function persistSalesOrderToMongo(sqlite, soId) {
  if (!soId) return false;
  try {
    const so = sqlite.prepare(`SELECT * FROM ${PARENT} WHERE id=?`).get(soId);
    if (!so) { await deleteSalesOrderFromMongo(soId); return true; }
    await col(PARENT).replaceOne({ id: soId }, pick(so, tableCols(sqlite, PARENT)), { upsert: true });
    for (const t of CHILDREN) {
      const cols = tableCols(sqlite, t);
      const rows = sqlite.prepare(`SELECT * FROM ${t} WHERE sales_order_id=?`).all(soId);
      await col(t).deleteMany({ sales_order_id: soId });
      if (rows.length) await col(t).insertMany(rows.map((r) => pick(r, cols)), { ordered: false });
    }
    return true;
  } catch (e) { console.error('[sales-mongo] persistSalesOrderToMongo failed:', e?.message || e); return false; }
}

// Remove an SO aggregate (parent + children) from MongoDB.
export async function deleteSalesOrderFromMongo(soId) {
  if (!soId) return false;
  try {
    await col(PARENT).deleteOne({ id: soId });
    for (const t of CHILDREN) await col(t).deleteMany({ sales_order_id: soId });
    return true;
  } catch (e) { console.error('[sales-mongo] deleteSalesOrderFromMongo failed:', e?.message || e); return false; }
}
