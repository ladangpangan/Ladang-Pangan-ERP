// =====================================================================
// Master Data (MongoDB) — Phase 2 migration helpers.
//
// Strategy: DUAL-WRITE. MongoDB is the AUTHORITATIVE store for master data
// (products, cold_storages, zones). Every write is ALSO mirrored to the local
// SQLite tables (done by the caller in route.js) so that transaction modules
// that still read master data from SQLite keep working during the migration.
//
// - Reads for the master-data CRUD endpoints come from MongoDB (this module).
// - IDs are UUID strings, stored as the Mongo `_id` (no BSON ObjectId here) so
//   the exact same id is shared with the SQLite mirror & all transaction rows.
// - Dates are stored as JS Date and serialized to ISO strings on output.
// =====================================================================
import { getMongoDb } from '@/lib/db/mongo';
import { getDb } from '@/lib/db';
import * as s from '@/lib/db/schema';

// Mongo collection names (kept identical to the SQLite table names for clarity)
export const MD = {
  products: 'products',
  coldStorages: 'cold_storages',
  zones: 'zones',
};

const col = (name) => getMongoDb().collection(name);

const DATE_FIELDS = ['createdAt', 'updatedAt', 'archivedAt'];

// Map a Mongo document -> API object: `_id` becomes `id`, dates become ISO strings.
export function serialize(d) {
  if (!d) return null;
  const { _id, ...rest } = d;
  const out = { id: _id, ...rest };
  for (const k of DATE_FIELDS) {
    if (out[k] instanceof Date) out[k] = out[k].toISOString();
    else if (out[k] && typeof out[k] === 'object' && out[k] instanceof Object && out[k].getTime) {
      out[k] = new Date(out[k]).toISOString();
    }
  }
  return out;
}

// Build a Mongo doc from an API row ({id, ...}) -> {_id, ...} (strips duplicate id).
function toDoc(row) {
  const { id, ...rest } = row;
  return { _id: id, ...rest };
}

// archived filter: undefined/'0' => active only; '1'|'true' => archived only; 'all' => both.
// In Mongo `{ archivedAt: null }` matches both an explicit null AND a missing field.
export function mdArchivedFilter(archived) {
  if (archived === '1' || archived === 'true') return { archivedAt: { $ne: null } };
  if (archived === 'all') return {};
  return { archivedAt: null };
}

export async function mdList(name, { filter = {}, sort = { createdAt: -1 } } = {}) {
  const rows = await col(name).find(filter).sort(sort).toArray();
  return rows.map(serialize);
}
export async function mdGet(name, id) {
  return serialize(await col(name).findOne({ _id: id }));
}
export async function mdFindOne(name, filter) {
  return serialize(await col(name).findOne(filter));
}
export async function mdInsert(name, row) {
  await col(name).insertOne(toDoc(row));
  return row;
}
export async function mdUpdate(name, id, patch) {
  await col(name).updateOne({ _id: id }, { $set: patch });
  return mdGet(name, id);
}
export async function mdDelete(name, id) {
  const r = await col(name).deleteOne({ _id: id });
  return r.deletedCount > 0;
}
export async function mdDeleteMany(name, filter) {
  const r = await col(name).deleteMany(filter);
  return r.deletedCount;
}
export async function mdCount(name, filter = {}) {
  return col(name).countDocuments(filter);
}

// -----------------------
// One-time forward backfill: SQLite -> MongoDB.
// Runs once per process. If a Mongo master collection is EMPTY but the local
// SQLite mirror already has rows (e.g. existing preview DB with 52 products),
// copy them into Mongo preserving the same UUID ids. Never overwrites data
// that already exists in Mongo (idempotent & safe for repeated boots).
// -----------------------
let _synced = false;
let _syncing = null;

export async function ensureMasterSync() {
  if (_synced) return;
  if (_syncing) return _syncing;
  _syncing = (async () => {
    try {
      const db = getDb();
      const defs = [
        { name: MD.products, tbl: s.products },
        { name: MD.coldStorages, tbl: s.coldStorages },
        { name: MD.zones, tbl: s.zones },
      ];
      for (const d of defs) {
        const c = col(d.name);
        const mCount = await c.countDocuments({});
        if (mCount > 0) continue; // Mongo already authoritative for this collection
        const rows = db.select().from(d.tbl).all();
        if (!rows.length) continue;
        const docs = rows.map(toDoc);
        await c.insertMany(docs, { ordered: false });
        console.log(`[masterdata] backfilled ${docs.length} row(s) SQLite -> mongo.${d.name}`);
      }
      _synced = true;
    } catch (e) {
      console.error('[masterdata] ensureMasterSync failed:', e?.message || e);
      // leave _synced=false so a later request retries
    } finally {
      _syncing = null;
    }
  })();
  return _syncing;
}
