// Chart of Accounts (gl_accounts) — MongoDB-authoritative store (multi-replica safe).
// Rationale: production runs >=2 replicas, so per-pod SQLite diverges. COA now lives in MongoDB
// (shared across all replicas). The accounting engine still reads gl_accounts from SQLite for its
// relational joins, so we hydrate the per-pod SQLite mirror from MongoDB before engine/report runs.
// Docs use the SAME snake_case field names as the SQLite gl_accounts columns for a 1:1 hydrate.
import { getMongoDb } from '@/lib/db/mongo';
import { DEFAULT_COA } from '@/lib/accounting/engine';
import { v4 as uuidv4 } from 'uuid';

const COL = 'gl_accounts';
const nowSec = () => Math.floor(Date.now() / 1000);
const COLS = ['id', 'code', 'name', 'type', 'normal_balance', 'category', 'parent_code', 'cash_flow_category', 'is_postable', 'is_system', 'opening_balance', 'description', 'sort_order', 'status', 'archived_at', 'created_at', 'updated_at'];

function coaCol() { return getMongoDb().collection(COL); }
const strip = (d) => { if (d && d._id !== undefined) { const { _id, ...rest } = d; return rest; } return d; };

// Build Mongo docs from the built-in default chart of accounts.
function defaultDocs() {
  const now = nowSec();
  return DEFAULT_COA.map((a, i) => ({
    id: uuidv4(), code: a.code, name: a.name, type: a.type, normal_balance: a.nb,
    category: a.cat || null, parent_code: a.parent || null, cash_flow_category: a.cf || 'operating',
    is_postable: a.h ? 0 : 1, is_system: a.s ? 1 : 0, opening_balance: 0, description: null,
    sort_order: i + 1, status: 'active', archived_at: null, created_at: now, updated_at: now,
  }));
}

// Seed MongoDB COA once. Prefer migrating any EXISTING local SQLite COA (preserves ids/opening
// balances/user edits); otherwise seed the built-in defaults. Idempotent (no-op if Mongo has data).
export async function coaEnsureSeeded(sqlite) {
  const col = coaCol();
  const n = await col.countDocuments({});
  if (n > 0) return { seeded: false, count: n };
  let docs = [];
  try {
    if (sqlite) {
      const rows = sqlite.prepare('SELECT * FROM gl_accounts').all();
      if (rows.length > 0) docs = rows.map(r => { const o = {}; for (const c of COLS) o[c] = r[c] === undefined ? null : r[c]; return o; });
    }
  } catch { /* ignore */ }
  if (docs.length === 0) docs = defaultDocs();
  if (docs.length > 0) await col.insertMany(docs, { ordered: false });
  return { seeded: true, count: docs.length };
}

// Also insert any built-in accounts missing from Mongo (e.g. new 5-1300 Beban Angkut Pembelian).
export async function coaEnsureMissingDefaults() {
  const col = coaCol();
  const existing = new Set((await col.find({}, { projection: { code: 1 } }).toArray()).map(r => r.code));
  const missing = defaultDocs().filter(d => !existing.has(d.code));
  if (missing.length > 0) await col.insertMany(missing, { ordered: false });
  return missing.length;
}

export async function coaList({ includeArchived = false } = {}) {
  const q = includeArchived ? {} : { archived_at: null };
  const rows = await coaCol().find(q).sort({ code: 1 }).toArray();
  return rows.map(strip);
}
export async function coaGetById(id) { return strip(await coaCol().findOne({ id })); }
export async function coaGetByCode(code) { return strip(await coaCol().findOne({ code })); }

export async function coaInsert(doc) {
  const now = nowSec();
  const full = {
    id: doc.id || uuidv4(), code: doc.code, name: doc.name, type: doc.type,
    normal_balance: doc.normal_balance, category: doc.category ?? null, parent_code: doc.parent_code ?? null,
    cash_flow_category: doc.cash_flow_category || 'operating', is_postable: doc.is_postable ?? 1, is_system: doc.is_system ?? 0,
    opening_balance: Number(doc.opening_balance || 0), description: doc.description ?? null,
    sort_order: doc.sort_order ?? 999, status: doc.status || 'active', archived_at: null,
    created_at: now, updated_at: now,
  };
  await coaCol().insertOne({ ...full });
  return full;
}
export async function coaUpdate(id, patch) {
  const set = { ...patch, updated_at: nowSec() };
  delete set._id; delete set.id; delete set.created_at;
  await coaCol().updateOne({ id }, { $set: set });
  return coaGetById(id);
}
export async function coaSetArchived(id, archivedAtSec) {
  await coaCol().updateOne({ id }, { $set: { archived_at: archivedAtSec, updated_at: nowSec() } });
  return coaGetById(id);
}
export async function coaDelete(id) { await coaCol().deleteOne({ id }); }

// Upsert by code (used by Excel import).
export async function coaUpsertByCode(doc) {
  const existing = await coaGetByCode(doc.code);
  if (existing) { await coaUpdate(existing.id, doc); return { created: false }; }
  await coaInsert(doc); return { created: true };
}

// Refresh the per-pod SQLite gl_accounts mirror from MongoDB so the accounting engine (which joins
// journal_lines -> gl_accounts by account_id) reads the shared, up-to-date COA. Preserves ids.
export async function hydrateCoaToSqlite(sqlite) {
  const docs = await coaCol().find({}, { projection: { _id: 0 } }).toArray();
  if (!docs.length) return 0;
  const ins = sqlite.prepare(`INSERT INTO gl_accounts (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM gl_accounts').run();
    for (const d of docs) ins.run(...COLS.map(c => (d[c] === undefined ? null : d[c])));
  });
  tx();
  return docs.length;
}

// Convenience: ensure Mongo seeded + defaults present, then hydrate SQLite. Safe to call before
// COA reads / engine runs. Best-effort: never throws (falls back to existing SQLite mirror).
export async function ensureCoaReady(sqlite) {
  try {
    await coaEnsureSeeded(sqlite);
    await coaEnsureMissingDefaults();
    await hydrateCoaToSqlite(sqlite);
    return true;
  } catch (e) {
    console.error('[coa-mongo] ensureCoaReady failed:', e?.message || e);
    return false;
  }
}
