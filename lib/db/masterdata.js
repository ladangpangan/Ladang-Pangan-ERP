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
import { eq, and, ne } from 'drizzle-orm';

// Mongo collection names (kept identical to the SQLite table names for clarity)
export const MD = {
  products: 'products',
  coldStorages: 'cold_storages',
  zones: 'zones',
  contacts: 'contacts',
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
export async function mdPluck(name, field, filter = {}) {
  const rows = await col(name).find(filter).project({ [field]: 1 }).toArray();
  return rows.map((r) => r[field]).filter((v) => v != null);
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
        { name: MD.contacts, tbl: s.contacts },
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

// -----------------------
// Mongo -> SQLite hydration for master data (products/cold_storages/zones).
// MongoDB is AUTHORITATIVE. The per-pod SQLite mirror can drift (stale seed, or rows
// created on another replica / directly in Mongo were never dual-written to THIS pod),
// which makes transaction joins (e.g. inventory kode simpan -> product name) resolve empty.
// This UPSERTs every Mongo master row into SQLite by id (safe: no deletes, so FK RESTRICT
// on referenced products/cold-storages is never violated). Called with a short TTL guard.
// -----------------------
const _toDate = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; };
const mapProduct = (d) => ({
  id: d._id, sku: d.sku, name: d.name, category: d.category ?? null, subCategory: d.subCategory ?? null,
  unit: d.unit || 'kg', weightUnit: d.weightUnit || 'kg', packagingType: d.packagingType ?? null,
  basePrice: Number(d.basePrice || 0), rendemenCoefficient: Number(d.rendemenCoefficient ?? 1),
  minStock: Number(d.minStock || 0), shelfLifeDays: Number(d.shelfLifeDays || 0),
  description: d.description ?? null, imageUrl: d.imageUrl ?? null, status: d.status || 'active',
  archivedAt: _toDate(d.archivedAt), createdAt: _toDate(d.createdAt) || new Date(), updatedAt: _toDate(d.updatedAt) || new Date(),
});
const mapColdStorage = (d) => ({
  id: d._id, code: d.code, name: d.name, location: d.location ?? null, address: d.address ?? null,
  temperatureRange: d.temperatureRange ?? null, capacityKg: Number(d.capacityKg || 0), status: d.status || 'active',
  archivedAt: _toDate(d.archivedAt), notes: d.notes ?? null,
  createdAt: _toDate(d.createdAt) || new Date(), updatedAt: _toDate(d.updatedAt) || new Date(),
});
const mapZone = (d) => ({
  id: d._id, coldStorageId: d.coldStorageId, code: d.code, name: d.name, description: d.description ?? null,
  status: d.status || 'active', createdAt: _toDate(d.createdAt) || new Date(), updatedAt: _toDate(d.updatedAt) || new Date(),
});
const _json = (v) => (v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v)));
const mapContact = (d) => ({
  id: d._id, contactType: d.contactType || 'Customer', categories: _json(d.categories), code: d.code,
  companyName: d.companyName ?? null, displayName: d.displayName || d.companyName || d.code || 'Kontak',
  isSubscriber: !!d.isSubscriber, creditLimit: Number(d.creditLimit || 0), prepaidBalance: Number(d.prepaidBalance || 0),
  isAgent: !!d.isAgent, agentDiscountPct: Number(d.agentDiscountPct || 0), isDropshipper: !!d.isDropshipper,
  commissionType: d.commissionType ?? null, commissionValue: Number(d.commissionValue || 0), taxStatus: d.taxStatus ?? null,
  npwp: d.npwp ?? null, address: d.address ?? null, city: d.city ?? null, province: d.province ?? null,
  postalCode: d.postalCode ?? null, mapsUrl: d.mapsUrl ?? null, phone: d.phone ?? null, email: d.email ?? null,
  picName: d.picName ?? null, picPhone: d.picPhone ?? null, bankName: d.bankName ?? null, bankAccount: d.bankAccount ?? null,
  bankHolder: d.bankHolder ?? null, legalDocs: _json(d.legalDocs), notes: d.notes ?? null, status: d.status || 'active',
  archivedAt: _toDate(d.archivedAt), createdAt: _toDate(d.createdAt) || new Date(), updatedAt: _toDate(d.updatedAt) || new Date(),
});

export async function hydrateMasterFromMongo() {
  const db = getDb();
  const defs = [
    { name: MD.products, tbl: s.products, map: mapProduct, uniq: s.products.sku, uniqKey: 'sku' },
    { name: MD.coldStorages, tbl: s.coldStorages, map: mapColdStorage, uniq: s.coldStorages.code, uniqKey: 'code' },
    { name: MD.zones, tbl: s.zones, map: mapZone, uniq: null, uniqKey: null },
    { name: MD.contacts, tbl: s.contacts, map: mapContact, uniq: s.contacts.code, uniqKey: 'code' },
  ];
  // Fetch all master collections from Mongo in PARALLEL (was N sequential round-trips).
  const _docsArr = await Promise.all(defs.map((d) => col(d.name).find({}).toArray().catch(() => null)));
  for (let di = 0; di < defs.length; di++) {
    const d = defs[di];
    try {
      const docs = _docsArr[di];
      if (!docs || !docs.length) continue; // safety: never mirror from an empty/failed collection
      const existing = new Set(db.select({ id: d.tbl.id }).from(d.tbl).all().map((r) => r.id));
      const writeRow = (vals) => {
        if (existing.has(vals.id)) { const { id, ...set } = vals; db.update(d.tbl).set(set).where(eq(d.tbl.id, vals.id)).run(); }
        else db.insert(d.tbl).values(vals).run();
      };
      // Pre-dedupe the UNIQUE column DETERMINISTICALLY. MongoDB is the source of truth but may contain
      // duplicate sku/code across two distinct ids (a data issue). SQLite enforces UNIQUE, so all-but-one
      // get a stable suffixed value derived from their id. Deterministic => no churn on repeated runs.
      const claimed = new Set();
      const ordered = d.uniqKey ? [...docs].sort((a, b) => String(a._id).localeCompare(String(b._id))) : docs;
      for (const doc of ordered) {
        try {
          const vals = d.map(doc);
          if (!vals.id) continue;
          if (d.uniqKey && vals[d.uniqKey] != null) {
            let uv = String(vals[d.uniqKey]);
            if (claimed.has(uv)) uv = `${uv}__dup_${String(vals.id).slice(0, 8)}`;
            claimed.add(uv);
            vals[d.uniqKey] = uv;
          }
          try {
            writeRow(vals);
          } catch (e) {
            // Safety net: a stale SQLite row (different id, absent from Mongo) still holds this unique
            // value. Free it by renaming that other row (id preserved => FK stays valid), then retry once.
            const msg = String(e?.message || '');
            if (d.uniq && d.uniqKey && vals[d.uniqKey] && /UNIQUE/i.test(msg) && msg.includes(d.uniqKey)) {
              db.update(d.tbl)
                .set({ [d.uniqKey]: `${vals[d.uniqKey]}__stale_${Math.random().toString(36).slice(2, 7)}` })
                .where(and(eq(d.uniq, vals[d.uniqKey]), ne(d.tbl.id, vals.id))).run();
              writeRow(vals);
            } else { throw e; }
          }
        } catch (e) { console.error(`[masterdata] hydrate row ${d.name}:`, e?.message || e); }
      }
    } catch (e) { console.error(`[masterdata] hydrateMasterFromMongo ${d.name} failed:`, e?.message || e); }
  }
}
