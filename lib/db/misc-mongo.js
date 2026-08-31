// =====================================================================
// MISC TABLES -> MongoDB-authoritative (Migration Phase 10).
// -------------------------------------------------------------------
// Migrates the last SQLite-only tables into MongoDB using the SAME diff
// strategy as inventory/potx/tally-tx modules:
//   - hydrate = FK-OFF full replace of the per-pod SQLite mirror from Mongo
//   - captureSnapshot() records per-row signatures right AFTER hydrate & BEFORE
//     the mutation; persistSnapshotDiff() pushes ONLY added/changed/removed rows
//     back to Mongo (per-document upsert/delete => concurrency-safe across replicas).
//
// Tables (previously SQLite-only, persisted only via the whole-file GridFS backup):
//   notifications       (in-app bell notifications; user_id -> Mongo user, no SQLite FK)
//   contact_customers   (end customers owned by an Agen/Dropshipper contact)
//   contact_documents   (uploaded legal document metadata for a contact)
//   app_settings        (key-value JSON app settings) — NOTE: primary key is `key`, not `id`
//
// The primary key differs per table, so this module generalises tally-tx-mongo
// with a per-table `pk` column. contact_customers/contact_documents reference
// contacts(id); FK is OFF during hydrate so nothing external is touched.
// Columns are read via PRAGMA table_info (robust to future migrations).
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

// Each entry: SQLite table name (== Mongo collection name) + its primary key column.
const TABLES = [
  { name: 'notifications', pk: 'id' },
  { name: 'contact_customers', pk: 'id' },
  { name: 'contact_documents', pk: 'id' },
  { name: 'app_settings', pk: 'key' },
];
const META = 'mongo_migration';
const SEED_KEY = 'misc_v1';

const col = (t) => getMongoDb().collection(t);
const metaCol = () => getMongoDb().collection(META);
const pkOf = (t) => TABLES.find((x) => x.name === t).pk;

const _colsCache = {};
function tableCols(sqlite, t) {
  if (!_colsCache[t]) _colsCache[t] = sqlite.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);
  return _colsCache[t];
}
const pick = (row, c) => { const o = {}; for (const k of c) o[k] = row[k] === undefined ? null : row[k]; return o; };

// Per-request "before" snapshots, keyed by the Request object (auto-GC'd).
const _snap = new WeakMap();

let _indexed = false;
async function ensureIndexes() {
  if (_indexed) return;
  try { await Promise.all(TABLES.map(({ name, pk }) => col(name).createIndex({ [pk]: 1 }, { unique: true }))); _indexed = true; }
  catch { /* best-effort */ }
}
async function isSeeded(k) { try { const d = await metaCol().findOne({ key: k }); return !!d?.done; } catch { return false; } }
async function markSeeded(k) { try { await metaCol().updateOne({ key: k }, { $set: { key: k, done: true, at: Date.now() } }, { upsert: true }); } catch { /* ignore */ } }

// One-time migrate of existing per-pod SQLite rows into MongoDB.
async function seed(sqlite) {
  if (await isSeeded(SEED_KEY)) return;
  try {
    for (const { name, pk } of TABLES) {
      const c = tableCols(sqlite, name);
      const rows = sqlite.prepare(`SELECT * FROM ${name}`).all();
      if (rows.length) await col(name).bulkWrite(rows.map((r) => ({ replaceOne: { filter: { [pk]: r[pk] }, replacement: pick(r, c), upsert: true } })), { ordered: false });
    }
  } catch (e) { console.error('[misc-mongo] seed failed:', e?.message || e); }
  await markSeeded(SEED_KEY);
}

// Full replace of the per-pod SQLite mirror from MongoDB.
export async function hydrateToSqlite(sqlite) {
  const data = {};
  const _fetched = await Promise.all(TABLES.map(({ name }) => col(name).find({}, { projection: { _id: 0 } }).toArray()));
  TABLES.forEach(({ name }, i) => { data[name] = _fetched[i]; });
  const fkWasOn = Number(sqlite.pragma('foreign_keys', { simple: true })) === 1;
  if (fkWasOn) sqlite.pragma('foreign_keys = OFF');
  try {
    const tx = sqlite.transaction(() => {
      for (const { name } of TABLES) sqlite.prepare(`DELETE FROM ${name}`).run();
      for (const { name } of TABLES) {
        const c = tableCols(sqlite, name);
        const ins = sqlite.prepare(`INSERT OR REPLACE INTO ${name} (${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`);
        for (const r of data[name]) ins.run(...c.map((k) => (r[k] === undefined ? null : r[k])));
      }
    });
    tx();
  } finally {
    if (fkWasOn) sqlite.pragma('foreign_keys = ON');
  }
}

export async function ensureReady(sqlite) {
  try { await ensureIndexes(); await seed(sqlite); await hydrateToSqlite(sqlite); return true; }
  catch (e) { console.error('[misc-mongo] ensureReady failed:', e?.message || e); return false; }
}

// Snapshot current signatures for this request (call AFTER hydrate, BEFORE the mutation).
export function captureSnapshot(request, sqlite) {
  try {
    const m = {};
    for (const { name, pk } of TABLES) {
      const c = tableCols(sqlite, name);
      for (const r of sqlite.prepare(`SELECT * FROM ${name}`).all()) m[name + ':' + r[pk]] = JSON.stringify(pick(r, c));
    }
    _snap.set(request, m);
  } catch (e) { console.error('[misc-mongo] captureSnapshot failed:', e?.message || e); }
}

// Persist ONLY the rows added / changed / removed vs the snapshot. Per-document => concurrency-safe.
export async function persistSnapshotDiff(request, sqlite) {
  const before = _snap.get(request);
  if (!before) return false;
  _snap.delete(request);
  try {
    const opsByTable = {};
    const nowKeys = new Set();
    for (const { name, pk } of TABLES) {
      const c = tableCols(sqlite, name);
      for (const r of sqlite.prepare(`SELECT * FROM ${name}`).all()) {
        const key = name + ':' + r[pk];
        nowKeys.add(key);
        const sig = JSON.stringify(pick(r, c));
        if (before[key] !== sig) (opsByTable[name] ||= []).push({ replaceOne: { filter: { [pk]: r[pk] }, replacement: pick(r, c), upsert: true } });
      }
    }
    for (const key of Object.keys(before)) {
      if (!nowKeys.has(key)) {
        const i = key.indexOf(':');
        const name = key.slice(0, i);
        const pkVal = key.slice(i + 1);
        (opsByTable[name] ||= []).push({ deleteOne: { filter: { [pkOf(name)]: pkVal } } });
      }
    }
    let total = 0;
    for (const t of Object.keys(opsByTable)) { if (opsByTable[t].length) { await col(t).bulkWrite(opsByTable[t], { ordered: false }); total += opsByTable[t].length; } }
    return total;
  } catch (e) { console.error('[misc-mongo] persistSnapshotDiff failed:', e?.message || e); return false; }
}
