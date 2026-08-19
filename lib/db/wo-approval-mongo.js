// =====================================================================
// WORK ORDER (Produksi) + APPROVALS -> MongoDB-authoritative (Migration Phase 7).
// -------------------------------------------------------------------
// Same DIFF strategy as inventory/potx/assets-opname (concurrency-safe per-document
// upsert/delete of only added/changed/removed rows; hydrate = FK-OFF full replace).
//
// Tables:
//   Production: work_order, work_order_details, wo_custom_costs, wo_outputs,
//               wo_stages (global stage definitions), wo_stage_records
//   Approvals:  approvals (workflow: created via createApproval() helper from
//               purchase-orders / sales-orders / opnames; approved/rejected under /approvals)
//
// The accounting engine reads work_order (finalized WOs) to post production auto
// journals, so work_order is hydrated before syncLedger (accounting path). wo_outputs
// references inventory_stock/products and wo_stage_records references wo_stages
// (RESTRICT) / work_order (CASCADE) — hence FK OFF during hydrate so nothing external
// (e.g. inventory_stock) is wiped and RESTRICT/CASCADE don't fire.
// Columns via PRAGMA table_info (robust to migrations).
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

// Order chosen so FK-references point to earlier entries (insert respects it; FK is OFF anyway).
const TABLES = ['wo_stages', 'work_order', 'work_order_details', 'wo_custom_costs', 'wo_outputs', 'wo_stage_records', 'approvals'];
const META = 'mongo_migration';
const SEED_KEY = 'wo_approval_v1';

const col = (t) => getMongoDb().collection(t);
const metaCol = () => getMongoDb().collection(META);

const _colsCache = {};
function tableCols(sqlite, t) { if (!_colsCache[t]) _colsCache[t] = sqlite.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name); return _colsCache[t]; }
const pick = (row, c) => { const o = {}; for (const k of c) o[k] = row[k] === undefined ? null : row[k]; return o; };

const _snap = new WeakMap();

let _indexed = false;
async function ensureIndexes() { if (_indexed) return; try { for (const t of TABLES) await col(t).createIndex({ id: 1 }, { unique: true }); _indexed = true; } catch { /* best-effort */ } }
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
  } catch (e) { console.error('[wo-approval-mongo] seed failed:', e?.message || e); }
  await markSeeded(SEED_KEY);
}

export async function hydrateToSqlite(sqlite) {
  const data = {};
  for (const t of TABLES) data[t] = await col(t).find({}, { projection: { _id: 0 } }).toArray();
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
  catch (e) { console.error('[wo-approval-mongo] ensureReady failed:', e?.message || e); return false; }
}

export function captureSnapshot(request, sqlite) {
  try {
    const m = {};
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      for (const r of sqlite.prepare(`SELECT * FROM ${t}`).all()) m[t + ':' + r.id] = JSON.stringify(pick(r, c));
    }
    _snap.set(request, m);
  } catch (e) { console.error('[wo-approval-mongo] captureSnapshot failed:', e?.message || e); }
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
  } catch (e) { console.error('[wo-approval-mongo] persistSnapshotDiff failed:', e?.message || e); return false; }
}
