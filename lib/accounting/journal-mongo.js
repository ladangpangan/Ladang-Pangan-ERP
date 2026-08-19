// =====================================================================
// JOURNAL & LEDGER — MongoDB-authoritative store (multi-replica safe).
// -------------------------------------------------------------------
// Rationale (same as coa-mongo.js): production runs >=2 replicas, so per-pod
// SQLite diverges. User-entered financial data must live in a SHARED store.
//
// What is stored in MongoDB (authoritative):
//   - journal_entries (is_auto=0)  -> Manual journals, Cashbook (Pencatatan
//     Cepat), Opening balances, Period-closing journals.
//   - journal_lines (of those manual entries).
//   - period_closings              -> Tutup Buku metadata.
//   - stock_ledger                 -> Kartu Stok (append-only movement log).
//
// What is NOT stored here: auto journals (is_auto=1). Those are DERIVED and
// regenerated on every read by acct.syncLedger() from the ERP source
// documents, so they never need to be persisted.
//
// The accounting engine keeps operating on the per-pod better-sqlite3 handle
// for aggregation speed; we HYDRATE that per-pod mirror from MongoDB before
// any accounting read/sync, and PERSIST to MongoDB after each write.
// Docs use the SAME snake_case field names as the SQLite columns for a 1:1
// hydrate (identical to the coa-mongo.js contract).
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';

const JE = 'journal_entries';
const JL = 'journal_lines';
const PC = 'period_closings';
const SL = 'stock_ledger';
const META = 'mongo_migration';

const JE_COLS = ['id', 'journal_number', 'entry_date', 'description', 'source_type', 'source_id', 'source_number', 'source_key', 'is_auto', 'status', 'total_debit', 'total_credit', 'attachment', 'created_by', 'created_at'];
const JL_COLS = ['id', 'journal_id', 'account_id', 'account_code', 'description', 'debit', 'credit', 'sort_order'];
const PC_COLS = ['id', 'period', 'closing_date', 'journal_id', 'net_income', 'status', 'created_by', 'created_at'];
const SL_COLS = ['id', 'ledger_date', 'product_id', 'cold_storage_id', 'zone_id', 'movement_type', 'reference_type', 'reference_id', 'reference_number', 'qty_in', 'weight_in', 'qty_out', 'weight_out', 'hpp_per_kg', 'kode_simpan', 'transaction_id', 'stock_id', 'notes', 'created_by', 'created_at'];

const jeCol = () => getMongoDb().collection(JE);
const jlCol = () => getMongoDb().collection(JL);
const pcCol = () => getMongoDb().collection(PC);
const slCol = () => getMongoDb().collection(SL);
const metaCol = () => getMongoDb().collection(META);

// Keep only the known snake_case columns (drops Mongo _id and any extras).
const pick = (row, cols) => { const o = {}; for (const c of cols) o[c] = row[c] === undefined ? null : row[c]; return o; };

let _indexed = false;
async function ensureIndexes() {
  if (_indexed) return;
  try {
    await jeCol().createIndex({ id: 1 }, { unique: true });
    await jeCol().createIndex({ is_auto: 1 });
    await jlCol().createIndex({ id: 1 }, { unique: true });
    await jlCol().createIndex({ journal_id: 1 });
    await pcCol().createIndex({ id: 1 }, { unique: true });
    await slCol().createIndex({ id: 1 }, { unique: true });
    _indexed = true;
  } catch { /* best-effort */ }
}

async function isSeeded(key) { try { const d = await metaCol().findOne({ key }); return !!d?.done; } catch { return false; } }
async function markSeeded(key) { try { await metaCol().updateOne({ key }, { $set: { key, done: true, at: Date.now() } }, { upsert: true }); } catch { /* ignore */ } }

async function bulkReplace(col, rows, cols) {
  if (!rows.length) return;
  await col.bulkWrite(rows.map((r) => ({ replaceOne: { filter: { id: r.id }, replacement: pick(r, cols), upsert: true } })), { ordered: false });
}

// One-time: migrate any EXISTING per-pod SQLite manual journals + closings +
// stock_ledger into MongoDB so we don't lose data the first time we switch on
// the Mongo-authoritative flow. Idempotent (guarded by the META marker).
export async function journalsEnsureSeeded(sqlite) {
  if (await isSeeded('journals_v1')) return { seeded: false };
  try {
    const entries = sqlite.prepare(`SELECT * FROM journal_entries WHERE is_auto=0`).all();
    await bulkReplace(jeCol(), entries, JE_COLS);
    if (entries.length) {
      const ids = entries.map((e) => e.id);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400));
      let lines = [];
      for (const ch of chunks) {
        lines = lines.concat(sqlite.prepare(`SELECT * FROM journal_lines WHERE journal_id IN (${ch.map(() => '?').join(',')})`).all(...ch));
      }
      await bulkReplace(jlCol(), lines, JL_COLS);
    }
    const closings = sqlite.prepare('SELECT * FROM period_closings').all();
    await bulkReplace(pcCol(), closings, PC_COLS);
    const sl = sqlite.prepare('SELECT * FROM stock_ledger').all();
    await bulkReplace(slCol(), sl, SL_COLS);
  } catch (e) { console.error('[journal-mongo] seed migrate failed:', e?.message || e); }
  await markSeeded('journals_v1');
  return { seeded: true };
}

// Refresh the per-pod SQLite mirror of MANUAL journals + period_closings from
// MongoDB (the shared source of truth). Auto journals (is_auto=1) are left
// untouched — they are regenerated by acct.syncLedger() right after this.
export async function hydrateJournalsToSqlite(sqlite) {
  const [entries, closings] = await Promise.all([
    jeCol().find({ is_auto: 0 }, { projection: { _id: 0 } }).toArray(),
    pcCol().find({}, { projection: { _id: 0 } }).toArray(),
  ]);
  const ids = entries.map((e) => e.id);
  let lines = [];
  if (ids.length) lines = await jlCol().find({ journal_id: { $in: ids } }, { projection: { _id: 0 } }).toArray();

  const insE = sqlite.prepare(`INSERT OR REPLACE INTO journal_entries (${JE_COLS.join(',')}) VALUES (${JE_COLS.map(() => '?').join(',')})`);
  const insL = sqlite.prepare(`INSERT OR REPLACE INTO journal_lines (${JL_COLS.join(',')}) VALUES (${JL_COLS.map(() => '?').join(',')})`);
  const insC = sqlite.prepare(`INSERT OR REPLACE INTO period_closings (${PC_COLS.join(',')}) VALUES (${PC_COLS.map(() => '?').join(',')})`);
  const tx = sqlite.transaction(() => {
    // FK cascade (foreign_keys=ON) removes manual lines when entries go.
    sqlite.prepare('DELETE FROM journal_entries WHERE is_auto=0').run();
    sqlite.prepare('DELETE FROM period_closings').run();
    for (const e of entries) insE.run(...JE_COLS.map((c) => (e[c] === undefined ? null : e[c])));
    for (const l of lines) insL.run(...JL_COLS.map((c) => (l[c] === undefined ? null : l[c])));
    for (const c of closings) insC.run(...PC_COLS.map((k) => (c[k] === undefined ? null : c[k])));
  });
  tx();
  return entries.length;
}

// Convenience: seed (first run) + hydrate. Best-effort — never throws so the
// engine falls back to the existing SQLite mirror if Mongo is unavailable.
export async function ensureJournalsReady(sqlite) {
  try {
    await ensureIndexes();
    await journalsEnsureSeeded(sqlite);
    await hydrateJournalsToSqlite(sqlite);
    return true;
  } catch (e) {
    console.error('[journal-mongo] ensureJournalsReady failed:', e?.message || e);
    return false;
  }
}

// Persist a single journal (entry + its lines) from SQLite -> MongoDB. Called
// right after the engine writes a manual journal to the local SQLite mirror.
export async function persistJournalToMongo(sqlite, journalId) {
  if (!journalId) return false;
  try {
    const e = sqlite.prepare('SELECT * FROM journal_entries WHERE id=?').get(journalId);
    if (!e) return false;
    const lines = sqlite.prepare('SELECT * FROM journal_lines WHERE journal_id=?').all(journalId);
    await jeCol().replaceOne({ id: e.id }, pick(e, JE_COLS), { upsert: true });
    await jlCol().deleteMany({ journal_id: journalId });
    if (lines.length) await jlCol().insertMany(lines.map((l) => pick(l, JL_COLS)), { ordered: false });
    return true;
  } catch (err) { console.error('[journal-mongo] persistJournalToMongo failed:', err?.message || err); return false; }
}

// Remove a journal (entry + lines) from MongoDB.
export async function deleteJournalFromMongo(journalId) {
  if (!journalId) return false;
  try {
    await jeCol().deleteOne({ id: journalId });
    await jlCol().deleteMany({ journal_id: journalId });
    return true;
  } catch (err) { console.error('[journal-mongo] deleteJournalFromMongo failed:', err?.message || err); return false; }
}

// Persist a period_closing metadata row from SQLite -> MongoDB.
export async function persistClosingToMongo(sqlite, closingId) {
  if (!closingId) return false;
  try {
    const c = sqlite.prepare('SELECT * FROM period_closings WHERE id=?').get(closingId);
    if (!c) return false;
    await pcCol().replaceOne({ id: c.id }, pick(c, PC_COLS), { upsert: true });
    return true;
  } catch (err) { console.error('[journal-mongo] persistClosingToMongo failed:', err?.message || err); return false; }
}

export async function deleteClosingFromMongo(closingId) {
  if (!closingId) return false;
  try { await pcCol().deleteOne({ id: closingId }); return true; }
  catch (err) { console.error('[journal-mongo] deleteClosingFromMongo failed:', err?.message || err); return false; }
}

// -------------------------------------------------------------------
// STOCK LEDGER (Kartu Stok) — append-only movement log.
// Written via fire-and-forget from recordLedger(); merge-hydrated on read.
// -------------------------------------------------------------------

// Fire-and-forget insert of one stock-ledger movement into MongoDB. Accepts a
// snake_case doc (already shaped like the SQLite row). Never throws.
export function recordStockLedgerMongo(doc) {
  try {
    const clean = pick(doc, SL_COLS);
    slCol().insertOne(clean).catch((e) => console.error('[journal-mongo] recordStockLedgerMongo failed:', e?.message || e));
  } catch (e) { console.error('[journal-mongo] recordStockLedgerMongo build failed:', e?.message || e); }
}

// Merge MongoDB stock_ledger docs into the per-pod SQLite mirror (upsert by id,
// no delete) so Kartu Stok shows movements recorded on ALL replicas. Append-only
// data => merge is safe and preserves any not-yet-flushed local rows.
export async function hydrateStockLedgerToSqlite(sqlite) {
  try {
    const rows = await slCol().find({}, { projection: { _id: 0 } }).toArray();
    if (!rows.length) return 0;
    const ins = sqlite.prepare(`INSERT OR REPLACE INTO stock_ledger (${SL_COLS.join(',')}) VALUES (${SL_COLS.map(() => '?').join(',')})`);
    const tx = sqlite.transaction(() => {
      for (const r of rows) ins.run(...SL_COLS.map((c) => (r[c] === undefined ? null : r[c])));
    });
    tx();
    return rows.length;
  } catch (e) { console.error('[journal-mongo] hydrateStockLedgerToSqlite failed:', e?.message || e); return 0; }
}

// Convenience for inventory (Kartu Stok) reads: one-time seed of existing local
// rows into Mongo (idempotent, shares the journals_v1 marker) + merge-hydrate.
export async function ensureStockLedgerReady(sqlite) {
  try {
    await ensureIndexes();
    await journalsEnsureSeeded(sqlite);
    await hydrateStockLedgerToSqlite(sqlite);
    return true;
  } catch (e) {
    console.error('[journal-mongo] ensureStockLedgerReady failed:', e?.message || e);
    return false;
  }
}
