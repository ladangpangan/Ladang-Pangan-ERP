// =====================================================================
// TALLY SESSIONS + INVENTORY TRANSACTIONS -> MongoDB-authoritative (Migration Phase 9).
// -------------------------------------------------------------------
// Same DIFF strategy as inventory/potx/assets-opname/wo-approval:
//   - hydrate = FK-OFF full replace of the per-pod SQLite mirror from Mongo
//   - captureSnapshot() records per-row signatures right AFTER hydrate & BEFORE the
//     mutation; persistSnapshotDiff() pushes ONLY added/changed/removed rows back to
//     Mongo (per-document upsert/delete => concurrency-safe across replicas).
//
// Tables:
//   inventory_transaction  (IN / OUT / TRANSFER_CS / TRANSFER_ZONE / OPNAME_ADJ / DAMAGE / NON_SALES)
//   tally_session          (draft inbound sessions that can be resumed & finalized)
//   tally_session_items    (child of tally_session, ON DELETE CASCADE)
//
// WHY: in a multi-replica deploy a Tally draft created on Pod A may be finalized on
// Pod B. If the session isn't in Mongo, finalize throws "Sesi tally tidak ditemukan".
// inventory_transaction is the operation record every inbound (/inventory/inbound &
// /tally-sessions/:id/finalize via performInbound), outbound/transfer/opname writes; PO detail & inventory reports read it (tally weight, damage recap), so it must
// be Mongo-authoritative too. inventory_stock.transaction_id references inventory_transaction
// (and stock_opname_items.stock_id references inventory_stock) => FK OFF during hydrate so
// nothing external is wiped and CASCADE/RESTRICT don't fire.
// Columns read via PRAGMA table_info (robust to future migrations).
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

// Order = parent-before-child (insert respects it; FK is OFF during hydrate anyway).
const TABLES = ['inventory_transaction', 'tally_session', 'tally_session_items'];
const META = 'mongo_migration';
const SEED_KEY = 'tally_tx_v1';

const col = (t) => getMongoDb().collection(t);
const metaCol = () => getMongoDb().collection(META);

const _colsCache = {};
function tableCols(sqlite, t) { if (!_colsCache[t]) _colsCache[t] = sqlite.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name); return _colsCache[t]; }
const pick = (row, c) => { const o = {}; for (const k of c) o[k] = row[k] === undefined ? null : row[k]; return o; };

// Per-request "before" snapshots, keyed by the Request object (auto-GC'd).
const _snap = new WeakMap();

let _indexed = false;
async function ensureIndexes() { if (_indexed) return; try { await Promise.all(TABLES.map((t) => col(t).createIndex({ id: 1 }, { unique: true }))); _indexed = true; } catch { /* best-effort */ } }
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
  } catch (e) { console.error('[tally-tx-mongo] seed failed:', e?.message || e); }
  await markSeeded(SEED_KEY);
}

// Full replace of the per-pod SQLite mirror from MongoDB.
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
  catch (e) { console.error('[tally-tx-mongo] ensureReady failed:', e?.message || e); return false; }
}

// Snapshot current signatures for this request (call AFTER hydrate, BEFORE the mutation).
export function captureSnapshot(request, sqlite) {
  try {
    const m = {};
    for (const t of TABLES) {
      const c = tableCols(sqlite, t);
      for (const r of sqlite.prepare(`SELECT * FROM ${t}`).all()) m[t + ':' + r.id] = JSON.stringify(pick(r, c));
    }
    _snap.set(request, m);
  } catch (e) { console.error('[tally-tx-mongo] captureSnapshot failed:', e?.message || e); }
}

// Persist ONLY the rows added / changed / removed vs the snapshot. Per-document => concurrency-safe.
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
  } catch (e) { console.error('[tally-tx-mongo] persistSnapshotDiff failed:', e?.message || e); return false; }
}
