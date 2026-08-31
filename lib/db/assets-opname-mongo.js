// =====================================================================
// FIXED ASSETS + STOCK OPNAME -> MongoDB-authoritative (Migration Phase 6).
// -------------------------------------------------------------------
// Both are READ by the accounting engine (syncLedger): fixed_assets drives the
// monthly depreciation (DEPR) auto journals, and stock_opname(+items) drive the
// shrinkage/susut adjustment journals. So they must be hydrated before the engine
// runs, otherwise those auto journals differ per replica.
//
// Same DIFF strategy as inventory/potx (concurrency-safe per-document upsert of
// only added/changed/removed rows). Writers:
//   - fixed_assets : /accounting/fixed-assets (raw SQL CRUD)  -> path[0]='accounting'
//   - stock_opname(+items) : /opnames                          -> path[0]='opnames'
// Both tables are also read on those paths + the accounting reports path.
//
// hydrateToSqlite() = full replace with foreign_keys OFF, because
// stock_opname_items.stock_id references inventory_stock (NO ACTION) and
// opname_id cascades from stock_opname. Columns via PRAGMA table_info.
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

// Parent-first (stock_opname before its items). fixed_assets is standalone.
const TABLES = ['fixed_assets', 'stock_opname', 'stock_opname_items'];
const META = 'mongo_migration';
const SEED_KEY = 'assets_opname_v1';

const col = (t) => getMongoDb().collection(t);
const metaCol = () => getMongoDb().collection(META);

const _colsCache = {};
function tableCols(sqlite, t) { if (!_colsCache[t]) _colsCache[t] = sqlite.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name); return _colsCache[t]; }
const pick = (row, c) => { const o = {}; for (const k of c) o[k] = row[k] === undefined ? null : row[k]; return o; };

const _snap = new WeakMap();

let _indexed = false;
async function ensureIndexes() { if (_indexed) return; try { await Promise.all(TABLES.map((t) => col(t).createIndex({ id: 1 }, { unique: true }))); _indexed = true; } catch { /* best-effort */ } }
async function isSeeded(k) { try { const d = await metaCol().findOne({ key: k }); return !!d?.done; } catch { return false; } }
async function markSeeded(k) { try { await metaCol().updateOne({ key: k }, { $set: { key: k, done: true, at: Date.now() } }, { upsert: true }); } catch { /* ignore */ } }

async function seed(sqlite) {
  if (await isSeeded(SEED_KEY)) return;
  try {
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      const rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
      if (rows.length) await col(t).bulkWrite(rows.map((r) => ({ replaceOne: { filter: { id: r.id }, replacement: pick(r, c), upsert: true } })), { ordered: false });
    }
  } catch (e) { console.error('[assets-opname-mongo] seed failed:', e?.message || e); }
  await markSeeded(SEED_KEY);
}

export async function hydrateToSqlite(sqlite) {
  const data = {};
  const _fetched = await Promise.all(TABLES.map((t) => col(t).find({}, { projection: { _id: 0 } }).toArray()));
  TABLES.forEach((t, i) => { data[t] = _fetched[i]; });
  const fkWasOn = Number(sqlite.pragma('foreign_keys', { simple: true })) === 1;
  if (fkWasOn) sqlite.pragma('foreign_keys = OFF');
  try {
    const tx = sqlite.transaction(() => {
      for (const t of [...TABLES].reverse()) sqlite.prepare(`DELETE FROM ${t}`).run();
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
  catch (e) { console.error('[assets-opname-mongo] ensureReady failed:', e?.message || e); return false; }
}

export function captureSnapshot(request, sqlite) {
  try {
    const m = {};
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      for (const r of sqlite.prepare(`SELECT * FROM ${t}`).all()) m[t + ':' + r.id] = JSON.stringify(pick(r, c));
    }
    _snap.set(request, m);
  } catch (e) { console.error('[assets-opname-mongo] captureSnapshot failed:', e?.message || e); }
}

export async function persistSnapshotDiff(request, sqlite) {
  const before = _snap.get(request);
  if (!before) return false;
  _snap.delete(request);
  try {
    const opsByTable = {};
    const nowKeys = new Set();
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      for (const r of sqlite.prepare(`SELECT * FROM ${t}`).all()) {
        const key = t + ':' + r.id;
        nowKeys.add(key);
        const sig = JSON.stringify(pick(r, c));
        if (before[key] !== sig) (opsByTable[t] ||= []).push({ replaceOne: { filter: { id: r.id }, replacement: pick(r, c), upsert: true } });
      }
    }
    for (const key of Object.keys(before)) {
      if (!nowKeys.has(key)) { const i = key.indexOf(':'); (opsByTable[key.slice(0, i)] ||= []).push({ deleteOne: { filter: { id: key.slice(i + 1) } } }); }
    }
    let total = 0;
    for (const t of Object.keys(opsByTable)) { if (opsByTable[t].length) { await col(t).bulkWrite(opsByTable[t], { ordered: false }); total += opsByTable[t].length; } }
    return total;
  } catch (e) { console.error('[assets-opname-mongo] persistSnapshotDiff failed:', e?.message || e); return false; }
}
