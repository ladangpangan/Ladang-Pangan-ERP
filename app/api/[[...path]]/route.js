import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import nodePath from 'path';
import { eq, and, like, or, ne, desc, sql, inArray, isNotNull, isNull } from 'drizzle-orm';
import { getDb, getRawSqlite } from '@/lib/db';
import * as s from '@/lib/db/schema';
import { getAuth } from '@/lib/auth/auth';
import * as authUsers from '@/lib/auth/users';
import { headers } from 'next/headers';
import { runAgent, executeAction, canWrite } from '@/lib/ai/erp-agent';
import * as acct from '@/lib/accounting/engine';
import * as md from '@/lib/db/masterdata';
import { buildExportSheets } from '@/lib/export/queries';
import { importMasterData, IMPORT_TEMPLATES } from '@/lib/export/import';
import * as coaMongo from '@/lib/accounting/coa-mongo';
import * as jmongo from '@/lib/accounting/journal-mongo';
import * as salesMongo from '@/lib/db/sales-mongo';
import * as invMongo from '@/lib/db/inventory-mongo';
import * as potxMongo from '@/lib/db/potx-mongo';
import * as assetsOpnameMongo from '@/lib/db/assets-opname-mongo';
import * as woApprovalMongo from '@/lib/db/wo-approval-mongo';
import * as tallyTxMongo from '@/lib/db/tally-tx-mongo';
import * as miscMongo from '@/lib/db/misc-mongo';
import { getMongoDb } from '@/lib/db/mongo';
import { ensureHppBackfill } from '@/lib/db/hpp-backfill';
// -----------------------
// Helpers
// -----------------------
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  return res;
}

function json(data, init = {}) { return cors(NextResponse.json(data, init)); }
function err(msg, status = 400) { return json({ error: msg }, { status }); }

async function requireAuth() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return { error: err('Unauthorized', 401) };
    return { session };
  } catch (e) {
    return { error: err('Unauthorized', 401) };
  }
}

function requireRole(session, allowed) {
  if (!session?.user?.role) return false;
  // Akuntan memiliki akses setara Admin di seluruh modul (full access). Modul Akuntansi
  // punya pengecekan role eksplisit sendiri (FULL_ACCESS=['akuntan','direktur']) sehingga
  // trik ini tidak mengganggu pembatasan cashbook untuk admin/supervisor.
  if (session.user.role === 'akuntan' && allowed.includes('admin')) return true;
  return allowed.includes(session.user.role);
}

// -----------------------
// Stock Ledger (Kartu Stok) helper
// Records a per-product stock movement. Wrapped in try/catch so a ledger
// failure never breaks the primary operation.
// -----------------------
function recordLedger(db, entry) {
  const id = uuidv4();
  const ledgerDate = entry.ledgerDate || new Date();
  const createdAt = new Date();
  const vals = {
    id,
    ledgerDate,
    productId: entry.productId,
    coldStorageId: entry.coldStorageId || null,
    zoneId: entry.zoneId || null,
    movementType: entry.movementType,
    referenceType: entry.referenceType || null,
    referenceId: entry.referenceId || null,
    referenceNumber: entry.referenceNumber || null,
    qtyIn: Number(entry.qtyIn || 0),
    weightIn: Number(entry.weightIn || 0),
    qtyOut: Number(entry.qtyOut || 0),
    weightOut: Number(entry.weightOut || 0),
    hppPerKg: Number(entry.hppPerKg || 0),
    kodeSimpan: entry.kodeSimpan || null,
    transactionId: entry.transactionId || null,
    stockId: entry.stockId || null,
    notes: entry.notes || null,
    createdBy: entry.createdBy || null,
    createdAt,
  };
  try {
    db.insert(s.stockLedger).values(vals).run();
  } catch (e) {
    console.error('[stock_ledger] record failed:', e?.message || e);
  }
  // Mirror to MongoDB (shared Kartu Stok across replicas). Fire-and-forget;
  // stored in seconds to match the raw SQLite integer(timestamp) column.
  try {
    const toSec = (d) => Math.floor((d instanceof Date ? d.getTime() : new Date(d).getTime()) / 1000);
    jmongo.recordStockLedgerMongo({
      id,
      ledger_date: toSec(ledgerDate),
      product_id: vals.productId,
      cold_storage_id: vals.coldStorageId,
      zone_id: vals.zoneId,
      movement_type: vals.movementType,
      reference_type: vals.referenceType,
      reference_id: vals.referenceId,
      reference_number: vals.referenceNumber,
      qty_in: vals.qtyIn,
      weight_in: vals.weightIn,
      qty_out: vals.qtyOut,
      weight_out: vals.weightOut,
      hpp_per_kg: vals.hppPerKg,
      kode_simpan: vals.kodeSimpan,
      transaction_id: vals.transactionId,
      stock_id: vals.stockId,
      notes: vals.notes,
      created_by: vals.createdBy,
      created_at: toSec(createdAt),
    });
  } catch (e) { /* best-effort */ }
}

// -----------------------
// Contact categories (multi-select) helpers
// -----------------------
const VALID_CATEGORIES = ['Supplier', 'Customer', 'Agen', 'Dropshipper', 'RPH', 'Karyawan', 'Mitra'];

// Parse a contact DB row's categories into an array (backward compatible with legacy contactType).
function parseCategories(row) {
  let cats = [];
  if (row?.categories) {
    try { cats = JSON.parse(row.categories); } catch { cats = []; }
  }
  if (!Array.isArray(cats)) cats = [];
  if (cats.length === 0 && row?.contactType) cats = [row.contactType];
  return cats;
}

// Return an enriched contact object with `categories` array parsed (for API responses).
function withCategories(row) {
  if (!row) return row;
  return { ...row, categories: parseCategories(row) };
}

// From a POST/PATCH body, compute the categories array (or null if not provided in a partial PATCH).
function categoriesFromBody(body) {
  let cats = Array.isArray(body.categories) ? body.categories.filter(c => VALID_CATEGORIES.includes(c)) : null;
  if ((!cats || cats.length === 0) && body.contactType) cats = [body.contactType];
  if (cats && cats.length) cats = [...new Set(cats)];
  return cats && cats.length ? cats : null;
}

// Auto-generate a contact code based on its primary category, e.g. SUP-001, CUST-002.
const CONTACT_CODE_PREFIX = { Supplier: 'SUP', Customer: 'CUST', Agen: 'AGN', Dropshipper: 'DS', RPH: 'RPH', Karyawan: 'EMP', Mitra: 'MTR' };
function generateContactCode(db, category) {
  const prefix = CONTACT_CODE_PREFIX[category] || 'CT';
  const rows = db.select({ code: s.contacts.code }).from(s.contacts).all();
  const existing = new Set(rows.map(r => r.code));
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  for (const r of rows) { const m = re.exec(r.code || ''); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } }
  let n = max + 1;
  let code = `${prefix}-${String(n).padStart(3, '0')}`;
  while (existing.has(code)) { n++; code = `${prefix}-${String(n).padStart(3, '0')}`; }
  return code;
}

// MongoDB-authoritative variant used by the migrated /contacts endpoints (async).
async function generateContactCodeMongo(category) {
  const prefix = CONTACT_CODE_PREFIX[category] || 'CT';
  const codes = await md.mdPluck(md.MD.contacts, 'code');
  const existing = new Set(codes);
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  for (const c of codes) { const m = re.exec(c || ''); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } }
  let n = max + 1;
  let code = `${prefix}-${String(n).padStart(3, '0')}`;
  while (existing.has(code)) { n++; code = `${prefix}-${String(n).padStart(3, '0')}`; }
  return code;
}

// Root dir for uploaded contact documents (persistent, same volume as erp.db)
const CONTACT_DOCS_ROOT = nodePath.join(process.cwd(), 'data', 'uploads', 'contacts');
const ALLOWED_DOC_TYPES = ['NPWP', 'Akta Perusahaan', 'SK Perusahaan', 'KTP', 'Lainnya'];

// Safely resolve a stored document path inside CONTACT_DOCS_ROOT (guards against path traversal).
function path_join_safe(contactId, storedName) {
  const base = nodePath.join(CONTACT_DOCS_ROOT, String(contactId));
  const resolved = nodePath.join(base, nodePath.basename(String(storedName)));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}



export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })); }

// -----------------------
// Route dispatch
// -----------------------
// Rekomendasi kombinasi kode simpan (subset-sum) yang totalnya PALING MENDEKATI berat pesanan.
// 0/1 knapsack DP terskala (presisi 0,01 kg). Fallback greedy untuk input sangat besar.
function recommendStockCombo(lots, targetKg) {
  const items = (lots || []).map(l => ({ id: l.id, w: Math.round(Number(l.weight || 0) * 100) })).filter(l => l.w > 0);
  const T = Math.round(Number(targetKg || 0) * 100);
  if (!items.length || T <= 0) return { ids: new Set(), total: 0 };
  const maxW = items.reduce((m, l) => Math.max(m, l.w), 0);
  const BOUND = T + maxW; // izinkan overshoot maksimal satu lot ekstra
  if (BOUND > 600000 || items.length > 300 || BOUND * items.length > 6000000) {
    // fallback greedy (aproksimasi) untuk data sangat besar
    const sorted = [...items].sort((a, b) => b.w - a.w);
    const ids = new Set(); let sum = 0;
    for (const l of sorted) { if (sum >= T) break; if (sum + l.w <= T || Math.abs((sum + l.w) - T) <= Math.abs(sum - T)) { ids.add(l.id); sum += l.w; } }
    return { ids, total: sum / 100 };
  }
  const reach = new Uint8Array(BOUND + 1); reach[0] = 1;
  const from = new Int32Array(BOUND + 1).fill(-1);
  const prev = new Int32Array(BOUND + 1).fill(-1);
  for (let i = 0; i < items.length; i++) {
    const w = items[i].w;
    for (let sQ = BOUND; sQ >= w; sQ--) {
      if (reach[sQ - w] && !reach[sQ]) { reach[sQ] = 1; from[sQ] = i; prev[sQ] = sQ - w; }
    }
  }
  let best = -1, bestDiff = Infinity, bestOver = false;
  for (let sQ = 1; sQ <= BOUND; sQ++) {
    if (!reach[sQ]) continue;
    const diff = Math.abs(sQ - T); const over = sQ >= T;
    if (best === -1 || diff < bestDiff || (diff === bestDiff && over && !bestOver)) { best = sQ; bestDiff = diff; bestOver = over; }
  }
  const ids = new Set();
  let sQ = best;
  while (sQ > 0 && from[sQ] !== -1) { ids.add(items[from[sQ]].id); sQ = prev[sQ]; }
  return { ids, total: best / 100 };
}

// Top-level path prefixes (path[0]) whose handlers READ or WRITE inventory_stock.
// For these we hydrate the per-pod SQLite mirror from MongoDB and, on mutations,
// diff-persist the changed stock rows back to Mongo (Phase 4, multi-replica safe).
// Phase 3: path[0] prefixes whose handlers READ the Sales Order aggregate (sales_order + items +
// stock allocations + payments + returns). Sales data is MongoDB-authoritative; it is READ not only
// under /sales-orders & /tally-outbound (mutations) but also by the Dashboard (AR / today sales),
// sales & accounting reports and the contacts/commission views. Those read paths MUST hydrate the
// per-pod SQLite mirror from Mongo first, otherwise multi-replica pods serve stale per-pod sales
// numbers. Read-only full-replace hydrate => safe on any path (mutations still persist explicitly).
const SALES_PATHS = new Set([
  'sales-orders', 'tally-outbound',
  'dashboard', 'reports', 'accounting', 'sales-reports', 'inventory-reports', 'contacts',
]);

const INVENTORY_PATHS = new Set([
  'inventory', 'inventory-stocks', 'inventory-reports',
  'sales-orders', 'tally-outbound', 'tally-sessions', 'opnames',
  'accounting', 'dashboard', 'reports',
]);

// Phase 5: path[0] prefixes whose handlers READ or WRITE the PO aggregate / commission /
// SO-extra tables (surat jalan, retur, penerimaan). We hydrate the per-pod SQLite mirror from
// MongoDB and, on mutations, diff-persist only the changed rows (concurrency-safe). All writers to
// these tables live under these prefixes (verified: purchase-orders, grns, commissions, approvals,
// sales-orders dropship, tally-sessions, /inventory inbound-with-PO).
const POTX_PATHS = new Set([
  'purchase-orders', 'purchase-reports', 'grns', 'commissions',
  'sales-orders', 'tally-outbound', 'tally-sessions', 'inventory', 'inventory-reports',
  'approvals', 'accounting', 'dashboard', 'reports', 'sales-reports', 'production-reports',
]);

// Phase 6: path[0] prefixes that READ or WRITE fixed_assets / stock_opname(+items).
// fixed_assets CRUD lives under /accounting/fixed-assets; stock_opname under /opnames; the accounting
// reports/engine read both (depreciation + shrinkage auto journals). Diff-persist, concurrency-safe.
const ASSETS_OPNAME_PATHS = new Set(['accounting', 'opnames', 'dashboard', 'reports']);

// Phase 7: path[0] prefixes that READ or WRITE Work Order (produksi) tables + approvals.
// WO writers: work-orders, wo-stages, inventory (wo_outputs). Approvals are created via the
// createApproval() helper from purchase-orders / sales-orders / opnames, and approved/rejected under
// /approvals. The accounting engine reads work_order (finalized) for production journals; WO/approvals are
// also read on report/dashboard paths. Diff-persist, concurrency-safe.
const WO_APPROVAL_PATHS = new Set([
  'work-orders', 'wo-stages', 'inventory', 'sales-reports', 'production-reports',
  'accounting', 'dashboard', 'reports',
  'approvals', 'purchase-orders', 'sales-orders', 'opnames',
]);

// Phase 9: path[0] prefixes that READ or WRITE tally_session(+items) and/or inventory_transaction.
// inventory_transaction is the operation record written by every inbound (/inventory/inbound &
// /tally-sessions/:id/finalize via performInbound), outbound, transfer-cs/zone, opname approve, and
// SO status/returns; it is READ by PO detail (tally weight), inventory reports (damage recap, stock
// card) and dashboard. tally_session(+items) are created/edited/finalized under /tally-sessions.
// Migrating these to Mongo prevents cross-replica "Sesi tally tidak ditemukan" on finalize and makes
// inbound tally stock consistent across pods. Diff-persist, concurrency-safe.
const TALLY_TX_PATHS = new Set([
  'inventory', 'inventory-stocks', 'inventory-reports',
  'tally-sessions', 'tally-outbound', 'sales-orders', 'opnames',
  'purchase-orders', 'accounting', 'dashboard', 'reports',
]);

// Phase 10: path[0] prefixes that READ or WRITE the last SQLite-only tables now migrated to Mongo:
//   notifications        -> read/managed under /notifications; CREATED as a side-effect via the
//                           createApproval()/createNotification() helpers on purchase-orders,
//                           sales-orders, work-orders, opnames and approvals mutations.
//   contact_customers    -> managed under /contacts (pelanggan akhir Agen/Dropshipper)
//   contact_documents    -> managed under /contacts (dokumen legal)
//   app_settings         -> managed under /settings (key-value)
// Hydrate the per-pod SQLite mirror for these paths and, on mutations, snapshot so we diff-persist
// only the changed rows (concurrency-safe, multi-replica). All 4 tables are hydrated together
// whenever any of these prefixes is hit (they are tiny, so the extra reads are negligible).
const MISC_PATHS = new Set([
  'notifications', 'contacts', 'settings',
  'purchase-orders', 'sales-orders', 'tally-outbound', 'tally-sessions',
  'work-orders', 'wo-stages', 'opnames', 'approvals', 'inventory',
]);

async function handleRoute(request, { params }) {
  const { path = [] } = await params;
  const route = '/' + path.join('/');
  const method = request.method;
  const db = getDb();

  // [PERF] temporary instrumentation — logs any phase taking >80ms so we can find hydration bottlenecks.
  const __perfOn = process.env.PERF_TRACE === '1';
  let __ts = Date.now();
  const lap = (label) => { if (!__perfOn) return; const d = Date.now() - __ts; if (d > 80) console.log(`[PERF] ${method} ${route} :: ${label} = ${d}ms`); __ts = Date.now(); };


  // Ledger dirty-flag: any mutating request may change source data that the accounting ledger derives from.
  // We mark the ledger dirty so the next accounting read regenerates journals (autoSync); pure reads reuse
  // the last regeneration. This removes the heavy syncLedger() from EVERY accounting page load.
  if (method !== 'GET' && method !== 'HEAD') { globalThis.__ledgerDirty = true; }

  // Phase 2 (MongoDB): ensure master data (products/cold_storages/zones) is present in Mongo.
  // Idempotent + guarded (returns instantly after the first successful sync per process).
  try { await md.ensureMasterSync(); } catch (e) { /* non-fatal */ }
  lap('ensureMasterSync');

  // Mongo -> SQLite hydration for master data (products/cold_storages/zones). Mongo is authoritative;
  // this keeps every pod's SQLite mirror in sync so transaction joins (e.g. inventory kode simpan ->
  // product name) never resolve empty due to drift. Short TTL guard to bound overhead.
  try {
    const gm = (globalThis.__hydrateTs = globalThis.__hydrateTs || {});
    if (Date.now() - (gm.master || 0) > 300000) { await md.hydrateMasterFromMongo(); gm.master = Date.now(); }
  } catch (e) { /* non-fatal */ }
  lap('hydrateMaster');

  // Warm the in-memory notification-recipient cache in THIS module instance (boot.js primes a possibly
  // different instance in dev/multi-bundle). Idempotent + cheap (only queries Mongo when empty) so
  // createNotification() can reliably resolve supervisor/direktur recipients.
  try { await authUsers.ensureUserCache(); } catch (e) { /* non-fatal */ }
  lap('ensureUserCache');

  // ONE-TIME data fix (guarded by a mongo_migration marker): seed HPP onto existing stock & SO
  // allocations from product.base_price ("Harga Modal / HPP"). Runs directly on Mongo BEFORE the
  // hydration below, so the corrected cost basis flows into every replica's SQLite on hydrate and
  // existing Sales Orders show the right HPP / gross profit. No-op after it has run once.
  try { await ensureHppBackfill(); } catch (e) { /* non-fatal */ }
  lap('ensureHppBackfill');

  // Phase 3 (MongoDB): the Sales Order aggregate (sales_order + items + stock allocations + payments +
  // returns) is MongoDB-authoritative for multi-replica consistency. Hydrate the per-pod SQLite mirror
  // from Mongo before ANY request that READS or WRITES sales data (mutations under sales-orders/
  // tally-outbound; reads on dashboard, reports, accounting, sales-reports, inventory-reports, contacts)
  // so every pod serves the same SO numbers (AR, today sales, commissions). Read-only full-replace.
  // ---- PARALLEL Mongo->SQLite hydration for ALL matching phases (PERF) ----
  // Previously each phase (sales / inventory / potx / assets+opname / wo+approval / tally+tx / misc)
  // hydrated SEQUENTIALLY — a cold page load waited on ~6 full-collection round-trips to Atlas back to
  // back (~15-19s). We now fire the network reads for EVERY matching phase in PARALLEL. Each module's
  // better-sqlite3 write stays fully synchronous & atomic (no await between its pragma OFF/ON), so the
  // parallel awaits only overlap the NETWORK waits — never the SQLite writes — so no interleave/corruption.
  // Result: cold hydration time ~= max(phase) instead of sum(phases).
  {
    const g = (globalThis.__hydrateTs = globalThis.__hydrateTs || {});
    const isRead = method === 'GET' || method === 'HEAD';
    const isMut = !isRead;
    const p0 = path[0];
    const raw = getRawSqlite();
    // Per-phase read TTL (ms). inventory_stock reads are the slowest single Mongo query on the user's
    // Atlas tier (~3s for the full lot list), so it gets a longer TTL — its data is kept fresh on the
    // mutating pod anyway (mutations always force a re-hydrate), so a longer READ cache only affects how
    // quickly OTHER replicas see a change (bounded, acceptable for stock display).
    const TTLS = { inventory: 180000 };
    const stale = (k) => isMut || Date.now() - (g[k] || 0) > (TTLS[k] || 60000);

    // PERF: for the HOT transactional LIST/read endpoints we hydrate ONLY the collections that
    // handler actually reads (verified in code), instead of the broad defensive path-sets. This cuts
    // the biggest daily pages from ~6s to ~1-2s on a cold (TTL-expired) load. `only=null` => keep the
    // full defensive matching (used for mutations, detail views, and aggregator pages).
    // master data (products/cold_storages/zones/contacts) is hydrated separately above, so it is
    // always available regardless of `only`.
    let only = null;
    if (isRead) {
      if (route === '/sales-orders') only = new Set(['sales']);                 // reads sales_order + contacts(master)
      else if (route === '/purchase-orders') only = new Set(['potx']);          // reads purchase_order + contacts(master)
      else if (route === '/inventory/stocks') only = new Set(['inventory', 'sales']); // reads inventory_stock + Draft SO reservations
    }
    const want = (phase, broadHas) => (only ? only.has(phase) : broadHas);
    const tasks = [];
    const snappers = []; // captureSnapshot fns run AFTER all hydrations (mutations only)

    if (want('sales', SALES_PATHS.has(p0)) && stale('sales')) tasks.push((async () => { try { await salesMongo.ensureSalesReady(raw); g.sales = Date.now(); } catch { /* best-effort */ } })());
    if (want('inventory', INVENTORY_PATHS.has(p0))) {
      if (stale('inventory')) tasks.push((async () => { try { await invMongo.ensureInventoryReady(raw); g.inventory = Date.now(); } catch { /* best-effort */ } })());
      if (isMut) snappers.push(() => invMongo.captureSnapshot(request, raw));
    }
    if (want('potx', POTX_PATHS.has(p0))) {
      if (stale('potx')) tasks.push((async () => { try { await potxMongo.ensureReady(raw); g.potx = Date.now(); } catch { /* best-effort */ } })());
      if (isMut) snappers.push(() => potxMongo.captureSnapshot(request, raw));
    }
    if (want('assetsOpname', ASSETS_OPNAME_PATHS.has(p0))) {
      if (stale('assetsOpname')) tasks.push((async () => { try { await assetsOpnameMongo.ensureReady(raw); g.assetsOpname = Date.now(); } catch { /* best-effort */ } })());
      if (isMut) snappers.push(() => assetsOpnameMongo.captureSnapshot(request, raw));
    }
    if (want('woApproval', WO_APPROVAL_PATHS.has(p0))) {
      if (stale('woApproval')) tasks.push((async () => { try { await woApprovalMongo.ensureReady(raw); g.woApproval = Date.now(); } catch { /* best-effort */ } })());
      if (isMut) snappers.push(() => woApprovalMongo.captureSnapshot(request, raw));
    }
    if (want('tallyTx', TALLY_TX_PATHS.has(p0))) {
      if (stale('tallyTx')) tasks.push((async () => { try { await tallyTxMongo.ensureReady(raw); g.tallyTx = Date.now(); } catch { /* best-effort */ } })());
      if (isMut) snappers.push(() => tallyTxMongo.captureSnapshot(request, raw));
    }
    if (want('misc', MISC_PATHS.has(p0))) {
      if (stale('misc')) tasks.push((async () => { try { await miscMongo.ensureReady(raw); g.misc = Date.now(); } catch { /* best-effort */ } })());
      if (isMut) snappers.push(() => miscMongo.captureSnapshot(request, raw));
    }
    if (tasks.length) { try { await Promise.all(tasks); } catch { /* best-effort */ } }
    for (const fn of snappers) { try { fn(); } catch { /* best-effort */ } }
  }
  lap('phases-parallel');

  // VERIFICATION (multi-replica single-source-of-truth audit): for the read-only Dashboard &
  // Inventory report paths, print to the terminal that the data being served was hydrated straight
  // from MongoDB (the single source of truth) — with LIVE collection counts read directly from Mongo.
  // This makes it auditable that no stale per-pod SQLite data is served. Best-effort; never blocks.
  if (process.env.AUDIT_DATASOURCE_LOG === '1' && method === 'GET' && (path[0] === 'dashboard' || path[0] === 'inventory-reports')) {
    try {
      const mdb = getMongoDb();
      const [invStock, salesOrder, invTx, stockLedger] = await Promise.all([
        mdb.collection('inventory_stock').estimatedDocumentCount(),
        mdb.collection('sales_order').estimatedDocumentCount(),
        mdb.collection('inventory_transaction').estimatedDocumentCount(),
        mdb.collection('stock_ledger').estimatedDocumentCount(),
      ]);
      console.log(`[DATA-SOURCE=MongoDB] db="${mdb.databaseName}" route=${route} | live Mongo counts -> inventory_stock=${invStock}, sales_order=${salesOrder}, inventory_transaction=${invTx}, stock_ledger=${stockLedger} (SQLite is a per-request cache hydrated from these collections)`);
    } catch (e) { /* logging best-effort */ }
  }

  try {
    // Health
    if (route === '/' || route === '/root') return json({ ok: true, service: 'LPI ERP API' });

    // ---------- ARCHIVE (soft-archive) generic handlers ----------
    // Resource map: URL segment -> { table, roles allowed to archive/restore }
    const ARCHIVABLE = {
      'contacts':         { table: s.contacts,       roles: ['admin', 'supervisor'] },
      'products':         { table: s.products,       roles: ['admin', 'supervisor'] },
      'cold-storages':    { table: s.coldStorages,   roles: ['admin', 'supervisor'] },
      'purchase-orders':  { table: s.purchaseOrder,  roles: ['admin', 'supervisor'] },
      'sales-orders':     { table: s.salesOrder,     roles: ['admin', 'supervisor'] },
      'work-orders':      { table: s.workOrder,      roles: ['admin', 'supervisor'] },
      'inventory-stocks': { table: s.inventoryStock, roles: ['admin', 'supervisor'] },
      'users':            { table: s.user,           roles: ['admin', 'supervisor', 'direktur'] },
    };
    // Build the archived filter for a list GET based on ?archived= param.
    // default => only ACTIVE (archived_at IS NULL); '1'|'true' => only ARCHIVED; 'all' => both.
    const archivedCond = (table, url) => {
      const a = url.searchParams.get('archived');
      if (a === '1' || a === 'true') return isNotNull(table.archivedAt);
      if (a === 'all') return null;
      return isNull(table.archivedAt);
    };
    // POST /:resource/:id/archive  and  /:resource/:id/restore
    if (path.length === 3 && (path[2] === 'archive' || path[2] === 'restore') && method === 'POST' && ARCHIVABLE[path[0]]) {
      const { session, error } = await requireAuth(); if (error) return error;
      const cfg = ARCHIVABLE[path[0]];
      if (!requireRole(session, cfg.roles)) return err('Forbidden', 403);
      const id = path[1];
      const isArchive = path[2] === 'archive';
      // Users live in MongoDB (Better Auth) — archive/restore there, not SQLite.
      if (path[0] === 'users') {
        if (id === session.user.id) return err('Tidak bisa mengarsipkan akun sendiri', 400);
        const u = await authUsers.findUserRawById(id);
        if (!u) return err('Data tidak ditemukan', 404);
        await authUsers.updateUserById(id, { archivedAt: isArchive ? new Date() : null });
        return json({ ok: true, archived: isArchive });
      }
      const tbl = cfg.table;
      const existing = db.select().from(tbl).where(eq(tbl.id, id)).get();
      if (!existing) return err('Data tidak ditemukan', 404);
      try {
        const archivedAt = isArchive ? new Date() : null;
        // Master data (products/cold-storages) are Mongo-authoritative -> update Mongo first, mirror SQLite.
        const mdCol = path[0] === 'products' ? md.MD.products : (path[0] === 'cold-storages' ? md.MD.coldStorages : (path[0] === 'contacts' ? md.MD.contacts : null));
        if (mdCol) { try { await md.mdUpdate(mdCol, id, { archivedAt, updatedAt: new Date() }); } catch (e) { /* mirror below */ } }
        db.update(tbl).set({ archivedAt, updatedAt: new Date() }).where(eq(tbl.id, id)).run();
        return json({ ok: true, archived: isArchive });
      } catch (e) {
        return err('Gagal ' + (isArchive ? 'mengarsipkan' : 'memulihkan') + ': ' + String(e?.message || e), 400);
      }
    }

    // ================= EXPORT (Excel) — ekspor per modul untuk migrasi/backup =================
    if (path[0] === 'export' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const raw = getRawSqlite();
      if (path[1] === 'accounting') { try { await coaMongo.ensureCoaReady(raw); await jmongo.ensureJournalsReady(raw); await assetsOpnameMongo.ensureReady(raw); } catch (e) { /* best-effort */ } }
      if (path[1] === 'inventory') { try { await jmongo.ensureStockLedgerReady(raw); await invMongo.ensureInventoryReady(raw); } catch (e) { /* best-effort */ } }
      if (path[1] === 'sales-orders') { try { await salesMongo.ensureSalesReady(raw); await potxMongo.hydrateToSqlite(raw); } catch (e) { /* best-effort */ } }
      if (path[1] === 'purchase-orders') { try { await potxMongo.ensureReady(raw); } catch (e) { /* best-effort */ } }
      const out = buildExportSheets(raw, path[1]);
      if (!out) return err('Modul ekspor tidak dikenal', 404);
      return json({ data: out });
    }

    // ================= IMPORT (Master Data) — templates & upload =================
    // GET /api/import/templates -> daftar kolom template
    if (route === '/import/templates' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      return json({ data: IMPORT_TEMPLATES });
    }
    // POST /api/import/:module  body: { rows: [ {header:value} ] }
    if (path[0] === 'import' && path.length === 2 && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const module = path[1];
      const body = await request.json().catch(() => ({}));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (rows.length === 0) return err('Tidak ada baris data untuk diimpor');
      if (rows.length > 5000) return err('Maksimal 5000 baris per impor');
      const deps = {
        db, s, md, uuidv4, raw: getRawSqlite(),
        genContactCode: (cat) => generateContactCodeMongo(cat),
        insertSqlite: (table, doc) => { try { db.insert(table === 'products' ? s.products : s.contacts).values(doc).run(); } catch (e) { throw e; } },
        updateSqlite: (table, id, patch) => { const t = table === 'products' ? s.products : s.contacts; try { db.update(t).set(patch).where(eq(t.id, id)).run(); } catch (e) { /* row may not exist in mirror */ } },
      };
      const rep = await importMasterData(deps, module, rows);
      if (rep === null) return err('Modul impor tidak dikenal (products | contacts | chart-of-accounts)', 404);
      if (rep.error) return err(rep.error);
      // Jadwalkan backup SQLite -> Mongo GridFS (COA & mirror) bila tersedia
      try { const { scheduleBackup } = await import('@/lib/db/persistence'); scheduleBackup?.(); } catch (e) { /* optional */ }
      return json({ data: rep });
    }

    // ================= ACCOUNTING MODULE (SAK EP) =================
    if (path[0] === 'accounting') {
      const { session, error } = await requireAuth(); if (error) return error;
      const userRole = session.user?.role;
      
      // Permission tiers for accounting module:
      // - akuntan, direktur: FULL access to ALL accounting features (COA, journals, reports, cashbook + DELETE)
      // - admin, supervisor: ONLY cashbook access (read/write, NO delete)
      // - operator: no access
      const FULL_ACCESS = ['akuntan', 'direktur'];
      const CASHBOOK_ONLY = ['admin', 'supervisor'].includes(userRole);
      const CAN_DELETE_CASHBOOK = FULL_ACCESS; // Only akuntan & direktur can delete cashbook entries
      
      // Admin & Supervisor can ONLY access cashbook
      if (CASHBOOK_ONLY && path[1] !== 'cashbook') {
        return err('Admin dan Supervisor hanya dapat mengakses Pencatatan Keuangan Cepat', 403);
      }
      
      // Check general read permission (all accounting paths except cashbook-only users)
      if (!CASHBOOK_ONLY && !requireRole(session, FULL_ACCESS)) {
        return err('Forbidden', 403);
      }
      
      const raw = getRawSqlite();
      
      // 10-second TTL cache for accounting hydrations (GET/HEAD only, mutations bypass cache).
      // Reduces accounting page load from 10-26s to <1s by skipping redundant MongoDB hydration.
      const g = (globalThis.__hydrateTs = globalThis.__hydrateTs || {});
      const isRead = method === 'GET' || method === 'HEAD';
      
      // COA + Journals + Sales are all MongoDB-authoritative. Hydrate the per-pod SQLite mirror from
      // Mongo before any accounting read/report/sync so the engine joins use shared, up-to-date data.
      // Run the independent network reads in PARALLEL (60s TTL) to cut accounting cold load.
      {
        const acctTasks = [];
        if (!isRead || Date.now() - (g.coa || 0) > 60000) acctTasks.push((async () => { await coaMongo.ensureCoaReady(raw); g.coa = Date.now(); })());
        if (!isRead || Date.now() - (g.journals || 0) > 60000) acctTasks.push((async () => { await jmongo.ensureJournalsReady(raw); g.journals = Date.now(); })());
        if (!isRead || Date.now() - (g.sales || 0) > 60000) acctTasks.push((async () => { await salesMongo.ensureSalesReady(raw); g.sales = Date.now(); })());
        if (acctTasks.length) { try { await Promise.all(acctTasks); } catch { /* best-effort */ } }
      }

      // VERIFICATION (multi-replica single-source-of-truth audit for FINANCIAL REPORTS):
      // Just like the Dashboard & Inventory reports, print to the terminal that the accounting data
      // being served (Neraca / Laba-Rugi / Buku Besar / Neraca Saldo) was hydrated straight from
      // MongoDB — with LIVE collection counts read directly from Mongo (gl_accounts, journal_entries,
      // journal_lines, period_closings, sales_order). This makes it auditable that no stale per-pod
      // SQLite financial data is served across replicas. Best-effort; never blocks the request.
      if (process.env.AUDIT_DATASOURCE_LOG === '1' && method === 'GET') {
        try {
          const mdb = getMongoDb();
          const [glAccounts, journalEntries, journalLines, periodClosings, salesOrder] = await Promise.all([
            mdb.collection('gl_accounts').estimatedDocumentCount(),
            mdb.collection('journal_entries').estimatedDocumentCount(),
            mdb.collection('journal_lines').estimatedDocumentCount(),
            mdb.collection('period_closings').estimatedDocumentCount(),
            mdb.collection('sales_order').estimatedDocumentCount(),
          ]);
          console.log(`[DATA-SOURCE=MongoDB] db="${mdb.databaseName}" route=${route} | live Mongo counts -> gl_accounts=${glAccounts}, journal_entries=${journalEntries}, journal_lines=${journalLines}, period_closings=${periodClosings}, sales_order=${salesOrder} (SQLite is a per-request cache hydrated from these collections before Neraca/Laba-Rugi/Buku Besar is computed)`);
        } catch (e) { /* logging best-effort */ }
      }

      const uid = session.user.id;
      const sub = path[1] || '';
      const parseRange = (url) => ({
        from: acct.toSec(url.searchParams.get('from')),
        to: acct.toSec(url.searchParams.get('to')),
        asOf: acct.toSec(url.searchParams.get('asOf')),
      });
      // Auto-post (regenerate auto journals) before reads, if enabled.
      // Guarded by a dirty-flag + 20s TTL so we only run the heavy syncLedger() when source data actually
      // changed (any prior mutation set __ledgerDirty) or periodically (to catch cross-replica writes),
      // instead of on EVERY accounting read. force=true bypasses the guard (used right after mutations).
      const autoSync = (force = false) => {
        try {
          if (!acct.getAcctSettings(raw).autoPost) return;
          const lt = (globalThis.__ledgerSyncTs = globalThis.__ledgerSyncTs || { at: 0 });
          if (!force && !globalThis.__ledgerDirty && (Date.now() - lt.at) < 20000) return;
          acct.syncLedger(raw, { createdBy: uid });
          lt.at = Date.now();
          globalThis.__ledgerDirty = false;
        } catch (e) { console.error('autoSync', e?.message); }
      };

      // ---- Chart of Accounts (MongoDB-authoritative) ----
      if (sub === 'accounts') {
        // list
        if (path.length === 2 && method === 'GET') {
          const url = new URL(request.url);
          const a = url.searchParams.get('archived');
          let rows = await coaMongo.coaList({ includeArchived: true });
          if (a === '1' || a === 'true') rows = rows.filter(r => r.archived_at != null);
          else if (a !== 'all') rows = rows.filter(r => r.archived_at == null);
          return json({ data: rows });
        }
        // create
        if (path.length === 2 && method === 'POST') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          const code = String(b.code || '').trim();
          const name = String(b.name || '').trim();
          if (!code || !name) return err('Kode dan nama akun wajib diisi', 400);
          const type = b.type || 'asset';
          const nb = b.normalBalance || (['liability', 'equity', 'revenue', 'other_income'].includes(type) ? 'credit' : 'debit');
          if (await coaMongo.coaGetByCode(code)) return err('Kode akun sudah dipakai', 400);
          try {
            const doc = await coaMongo.coaInsert({
              code, name, type, normal_balance: nb, category: b.category || null, parent_code: b.parentCode || null,
              cash_flow_category: b.cashFlowCategory || 'operating', is_postable: b.isPostable === false ? 0 : 1,
              is_system: 0, opening_balance: Number(b.openingBalance || 0), description: b.description || null,
            });
            await coaMongo.hydrateCoaToSqlite(raw);
            return json({ data: doc });
          } catch (e) { return err('Gagal membuat akun: ' + (e?.message || e), 400); }
        }
        // update / archive / restore / delete
        const id = path[2];
        if (id && path.length === 3 && method === 'PATCH') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const cur = await coaMongo.coaGetById(id);
          if (!cur) return err('Akun tidak ditemukan', 404);
          const b = await request.json().catch(() => ({}));
          if (b.code && b.code !== cur.code) {
            if (cur.is_system) return err('Kode akun sistem tidak dapat diubah', 400);
            const dup = await coaMongo.coaGetByCode(b.code);
            if (dup && dup.id !== id) return err('Kode akun sudah dipakai', 400);
          }
          const fields = {
            code: cur.is_system ? cur.code : (b.code ?? cur.code),
            name: b.name ?? cur.name,
            type: cur.is_system ? cur.type : (b.type ?? cur.type),
            normal_balance: cur.is_system ? cur.normal_balance : (b.normalBalance ?? cur.normal_balance),
            category: b.category ?? cur.category,
            parent_code: b.parentCode ?? cur.parent_code,
            cash_flow_category: b.cashFlowCategory ?? cur.cash_flow_category,
            is_postable: b.isPostable == null ? cur.is_postable : (b.isPostable ? 1 : 0),
            opening_balance: b.openingBalance == null ? cur.opening_balance : Number(b.openingBalance),
            description: b.description ?? cur.description,
          };
          try {
            const doc = await coaMongo.coaUpdate(id, fields);
            await coaMongo.hydrateCoaToSqlite(raw);
            return json({ data: doc });
          } catch (e) { return err('Gagal memperbarui akun: ' + (e?.message || e), 400); }
        }
        if (id && path.length === 4 && (path[3] === 'archive' || path[3] === 'restore') && method === 'POST') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const cur = await coaMongo.coaGetById(id);
          if (!cur) return err('Akun tidak ditemukan', 404);
          if (cur.is_system && path[3] === 'archive') return err('Akun sistem tidak dapat diarsipkan', 400);
          await coaMongo.coaSetArchived(id, path[3] === 'archive' ? Math.floor(Date.now() / 1000) : null);
          await coaMongo.hydrateCoaToSqlite(raw);
          return json({ ok: true });
        }
        if (id && path.length === 3 && method === 'DELETE') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const cur = await coaMongo.coaGetById(id);
          if (!cur) return err('Akun tidak ditemukan', 404);
          if (cur.is_system) return err('Akun sistem tidak dapat dihapus (arsipkan saja)', 400);
          const used = raw.prepare('SELECT 1 FROM journal_lines WHERE account_id=? LIMIT 1').get(id);
          if (used) return err('Akun sudah dipakai di jurnal, tidak dapat dihapus. Arsipkan saja.', 400);
          await coaMongo.coaDelete(id);
          try { raw.prepare('DELETE FROM gl_accounts WHERE id=?').run(id); } catch (e) { /* mirror */ }
          return json({ ok: true });
        }
      }

      // ---- Mapping ----
      if (sub === 'mapping') {
        if (method === 'GET') return json({ data: acct.getMapping(raw), labels: acct.MAPPING_LABELS });
        if (method === 'PUT') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          return json({ data: acct.setMapping(raw, b.mapping || b) });
        }
      }

      // ---- Settings (PPN, opening date, autopost) ----
      if (sub === 'settings') {
        if (method === 'GET') return json({ data: acct.getAcctSettings(raw) });
        if (method === 'PUT') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          return json({ data: acct.setAcctSettings(raw, b.settings || b) });
        }
      }

      // ---- Sync (manual re-post) ----
      if (sub === 'sync' && method === 'POST') {
        try { const r = acct.syncLedger(raw, { createdBy: uid }); return json({ ok: true, ...r }); }
        catch (e) { return err('Gagal sinkronisasi jurnal: ' + (e?.message || e), 400); }
      }

      // ---- Journals ----
      if (sub === 'journals') {
        if (path.length === 2 && method === 'GET') {
          autoSync();
          const url = new URL(request.url);
          const { from, to } = parseRange(url);
          const rows = acct.listJournals(raw, { from, to, source: url.searchParams.get('source'), q: url.searchParams.get('q'), limit: Number(url.searchParams.get('limit') || 300) });
          return json({ data: rows });
        }
        if (path.length === 2 && method === 'POST') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          const r = acct.createManualJournal(raw, { date: b.date, description: b.description, lines: b.lines || [], createdBy: uid });
          if (r.error) return err(r.error, 400);
          await jmongo.persistJournalToMongo(raw, r.id);
          return json({ ok: true, ...r });
        }
        const jid = path[2];
        if (jid && path.length === 3 && method === 'GET') {
          const j = acct.getJournal(raw, jid);
          if (!j) return err('Jurnal tidak ditemukan', 404);
          return json({ data: j });
        }
        if (jid && path.length === 3 && method === 'DELETE') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const j = raw.prepare('SELECT * FROM journal_entries WHERE id=?').get(jid);
          if (!j) return err('Jurnal tidak ditemukan', 404);
          if (j.is_auto) return err('Jurnal otomatis tidak dapat dihapus manual (ubah dokumen sumbernya)', 400);
          raw.prepare('DELETE FROM journal_entries WHERE id=?').run(jid);
          await jmongo.deleteJournalFromMongo(jid);
          return json({ ok: true });
        }
      }

      // ---- Reports ----
      if (sub === 'overview' && method === 'GET') { autoSync(); return json({ data: acct.overview(raw) }); }
      if (sub === 'trial-balance' && method === 'GET') { autoSync(); const { to } = parseRange(new URL(request.url)); return json({ data: acct.trialBalance(raw, { to }) }); }
      if (sub === 'ledger' && method === 'GET') { autoSync(); const url = new URL(request.url); const { from, to } = parseRange(url); return json({ data: acct.ledger(raw, { accountId: url.searchParams.get('accountId'), from, to }) }); }
      if (sub === 'income-statement' && method === 'GET') { autoSync(); const { from, to } = parseRange(new URL(request.url)); return json({ data: acct.incomeStatement(raw, { from, to }) }); }
      if (sub === 'balance-sheet' && method === 'GET') { autoSync(); const { asOf } = parseRange(new URL(request.url)); return json({ data: acct.balanceSheet(raw, { asOf }) }); }
      if (sub === 'cash-flow' && method === 'GET') { autoSync(); const { from, to } = parseRange(new URL(request.url)); return json({ data: acct.cashFlow(raw, { from, to }) }); }

      // ---- Fixed Assets (Aset Tetap) ----
      if (sub === 'fixed-assets') {
        if (path.length === 2 && method === 'GET') {
          autoSync();
          const url = new URL(request.url);
          const a = url.searchParams.get('archived');
          let where = 'archived_at IS NULL';
          if (a === '1' || a === 'true') where = 'archived_at IS NOT NULL';
          const rows = raw.prepare(`SELECT * FROM fixed_assets WHERE ${where} ORDER BY acquisition_date DESC`).all();
          const data = rows.map((r) => ({ ...r, _status: acct.fixedAssetStatus(raw, r) }));
          return json({ data });
        }
        if (path.length === 2 && method === 'POST') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          if (!b.name) return err('Nama aset wajib diisi', 400);
          const acqDate = acct.toSec(b.acquisitionDate) || Math.floor(Date.now() / 1000);
          const id = uuidv4();
          raw.prepare(`INSERT INTO fixed_assets (id, code, name, category, acquisition_date, acquisition_cost, salvage_value, useful_life_months, method, asset_account_code, accum_account_code, expense_account_code, post_depreciation, status, notes, created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)`).run(
            id, b.code || null, b.name, b.category || null, acqDate, Number(b.acquisitionCost || 0), Number(b.salvageValue || 0),
            parseInt(b.usefulLifeMonths || 12, 10), b.method || 'straight_line', b.assetAccountCode || null, b.accumAccountCode || null,
            b.expenseAccountCode || null, b.postDepreciation === false ? 0 : 1, b.notes || null, uid);
          return json({ data: raw.prepare('SELECT * FROM fixed_assets WHERE id=?').get(id) });
        }
        const id = path[2];
        if (id && path.length === 3 && method === 'PATCH') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const cur = raw.prepare('SELECT * FROM fixed_assets WHERE id=?').get(id);
          if (!cur) return err('Aset tidak ditemukan', 404);
          const b = await request.json().catch(() => ({}));
          raw.prepare(`UPDATE fixed_assets SET code=?, name=?, category=?, acquisition_date=?, acquisition_cost=?, salvage_value=?, useful_life_months=?, asset_account_code=?, accum_account_code=?, expense_account_code=?, post_depreciation=?, notes=?, updated_at=unixepoch() WHERE id=?`)
            .run(
              b.code ?? cur.code, b.name ?? cur.name, b.category ?? cur.category,
              b.acquisitionDate ? acct.toSec(b.acquisitionDate) : cur.acquisition_date,
              b.acquisitionCost == null ? cur.acquisition_cost : Number(b.acquisitionCost),
              b.salvageValue == null ? cur.salvage_value : Number(b.salvageValue),
              b.usefulLifeMonths == null ? cur.useful_life_months : parseInt(b.usefulLifeMonths, 10),
              b.assetAccountCode ?? cur.asset_account_code, b.accumAccountCode ?? cur.accum_account_code, b.expenseAccountCode ?? cur.expense_account_code,
              b.postDepreciation == null ? cur.post_depreciation : (b.postDepreciation ? 1 : 0),
              b.notes ?? cur.notes, id);
          return json({ data: raw.prepare('SELECT * FROM fixed_assets WHERE id=?').get(id) });
        }
        if (id && path.length === 4 && (path[3] === 'archive' || path[3] === 'restore') && method === 'POST') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          raw.prepare('UPDATE fixed_assets SET archived_at=?, updated_at=unixepoch() WHERE id=?').run(path[3] === 'archive' ? Math.floor(Date.now() / 1000) : null, id);
          return json({ ok: true });
        }
        if (id && path.length === 4 && path[3] === 'dispose' && method === 'POST') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          const dd = acct.toSec(b.disposedDate) || Math.floor(Date.now() / 1000);
          raw.prepare('UPDATE fixed_assets SET status=?, disposed_date=?, updated_at=unixepoch() WHERE id=?').run(b.restore ? 'active' : 'disposed', b.restore ? null : dd, id);
          return json({ ok: true });
        }
        if (id && path.length === 3 && method === 'DELETE') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          raw.prepare(`DELETE FROM journal_entries WHERE source_type='DEPR' AND source_id=?`).run(id);
          raw.prepare('DELETE FROM fixed_assets WHERE id=?').run(id);
          return json({ ok: true });
        }
      }

      // ---- Period Closings (Tutup Buku) ----
      if (sub === 'closings') {
        if (path.length === 2 && method === 'GET') return json({ data: acct.listClosings(raw) });
        if (path.length === 2 && method === 'POST') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          try { if (acct.getAcctSettings(raw).autoPost) acct.syncLedger(raw, { createdBy: uid }); } catch (e) { console.error('closing sync', e?.message); }
          const r = acct.createClosing(raw, { period: b.period, createdBy: uid });
          if (r.error) return err(r.error, 400);
          await jmongo.persistJournalToMongo(raw, r.journalId);
          await jmongo.persistClosingToMongo(raw, r.id);
          return json({ ok: true, ...r });
        }
        const id = path[2];
        if (id && path.length === 3 && method === 'DELETE') {
          if (!requireRole(session, FULL_ACCESS)) return err('Forbidden', 403);
          const clRow = raw.prepare('SELECT * FROM period_closings WHERE id=?').get(id);
          const r = acct.deleteClosing(raw, id);
          if (r.error) return err(r.error, 400);
          if (clRow?.journal_id) await jmongo.deleteJournalFromMongo(clRow.journal_id);
          await jmongo.deleteClosingFromMongo(id);
          return json({ ok: true });
        }
      }

      // ---- Sales Profit Report (Laporan Laba Penjualan) ----
      if (sub === 'sales-profit' && method === 'GET') {
        autoSync();
        const { from, to } = parseRange(new URL(request.url));
        return json({ data: acct.salesProfitReport(raw, { from, to }) });
      }

      // ---- Pencatatan Cepat (Cash Book) ----
      if (sub === 'cashbook') {
        if (path.length === 2 && method === 'GET') {
          const url = new URL(request.url);
          const { from, to } = parseRange(url);
          let rows = acct.listCashbook(raw, { from, to, type: url.searchParams.get('type') });
          // Admin & Supervisor hanya melihat entri yang mereka input sendiri; Akuntan & Direktur lihat semua.
          if (['admin', 'supervisor'].includes(userRole)) {
            const meEmail = session.user?.email; const meId = session.user?.id;
            rows = (rows || []).filter(r => r.createdBy === meEmail || r.createdBy === meId || r.created_by === meEmail || r.created_by === meId);
          }
          return json({ data: rows });
        }
        if (path.length === 2 && method === 'POST') {
          // Admin, supervisor, akuntan, direktur can create cashbook entries
          if (!requireRole(session, [...FULL_ACCESS, 'admin', 'supervisor'])) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          const r = acct.createQuickEntry(raw, { ...b, createdBy: uid });
          if (r.error) return err(r.error, 400);
          await jmongo.persistJournalToMongo(raw, r.id);
          return json({ ok: true, ...r });
        }
        const id = path[2];
        if (id && path.length === 3 && (method === 'PUT' || method === 'PATCH')) {
          // Admin, supervisor, akuntan, direktur can update cashbook entries
          if (!requireRole(session, [...FULL_ACCESS, 'admin', 'supervisor'])) return err('Forbidden', 403);
          const b = await request.json().catch(() => ({}));
          const r = acct.updateQuickEntry(raw, id, { ...b, createdBy: uid });
          if (r.error) return err(r.error, 400);
          await jmongo.deleteJournalFromMongo(id);
          await jmongo.persistJournalToMongo(raw, r.id);
          return json({ ok: true, ...r });
        }
        if (id && path.length === 3 && method === 'DELETE') {
          // ONLY akuntan & direktur can delete cashbook entries (admin & supervisor cannot)
          if (!requireRole(session, CAN_DELETE_CASHBOOK)) {
            return err('Hanya user Akuntan dan Direktur yang dapat menghapus data Pencatatan Keuangan Cepat', 403);
          }
          const j = raw.prepare('SELECT * FROM journal_entries WHERE id=?').get(id);
          if (!j) return err('Transaksi tidak ditemukan', 404);
          if (j.is_auto) return err('Transaksi otomatis tidak dapat dihapus di sini', 400);
          raw.prepare('DELETE FROM journal_entries WHERE id=?').run(id);
          await jmongo.deleteJournalFromMongo(id);
          return json({ ok: true });
        }
        if (id && path.length === 4 && path[3] === 'attachment' && method === 'GET') {
          return json({ attachment: acct.getAttachment(raw, id) });
        }
      }

      return err('Rute akuntansi tidak ditemukan', 404);
    }



    // ---------- AGENTIC AI ASSISTANT ----------
    // POST /ai/chat  { message, sessionId, history:[{role,content}] }
    if (route === '/ai/chat' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      const body = await request.json().catch(() => ({}));
      const message = String(body?.message || '').trim();
      if (!message) return err('Pesan tidak boleh kosong', 400);
      const result = await runAgent({
        message,
        history: Array.isArray(body?.history) ? body.history : [],
        user: session.user,
        sessionId: String(body?.sessionId || session.user.id),
      });
      if (!result.ok) return err(result.error || 'Gagal memproses', 500);
      return json({
        ok: true,
        answer: result.answer,
        pendingActions: result.pendingActions || [],
        uiComponents: result.uiComponents || [],
        canWrite: canWrite(session.user),
      });
    }
    // POST /ai/execute  { action:{type,args} }  — run a confirmed write action
    if (route === '/ai/execute' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!canWrite(session.user)) return err('Peran Anda tidak diizinkan melakukan aksi ini', 403);
      const body = await request.json().catch(() => ({}));
      if (!body?.action?.type) return err('Aksi tidak valid', 400);
      const result = executeAction({ action: body.action, user: session.user });
      if (!result.ok) return err(result.message || 'Gagal menjalankan aksi', 400);
      return json({ ok: true, message: result.message, ref: result.ref || null, link: result.link || null });
    }

    // GET /ai/options — option lists for the interactive order builder (dropdowns)
    if (route === '/ai/options' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const rows = db.select().from(s.contacts).where(isNull(s.contacts.archivedAt)).orderBy(s.contacts.displayName).all();
      const inCat = (r, cat) => parseCategories(r).includes(cat);
      const map = (r) => ({ id: r.id, label: `${r.displayName} (${r.code})`, name: r.displayName });
      const customers = rows.filter(r => inCat(r, 'Customer')).map(map);
      const suppliers = rows.filter(r => inCat(r, 'Supplier')).map(map);
      const dropshippers = rows.filter(r => inCat(r, 'Dropshipper') || r.isDropshipper).map(map);
      const agents = rows.filter(r => inCat(r, 'Agen') || r.isAgent).map(map);
      const prods = db.select().from(s.products).where(isNull(s.products.archivedAt)).orderBy(s.products.name).all();
      const products = prods.map(p => ({ id: p.id, label: `${p.name} (${p.sku})`, name: p.name, sku: p.sku, basePrice: p.basePrice, unit: p.unit }));
      // Available stock (kode simpan) for stock-based SO — available = weight - reserved by Draft SOs
      const prodMap = {}; prods.forEach(p => { prodMap[p.id] = p; });
      const csRows = db.select({ id: s.coldStorages.id, code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).all();
      const csMap = {}; csRows.forEach(c => { csMap[c.id] = c; });
      const stockRows = db.select().from(s.inventoryStock).where(and(isNull(s.inventoryStock.archivedAt), eq(s.inventoryStock.status, 'active'))).all();
      const resRows = db.select({ sid: s.salesOrderItems.stockCodeId, w: sql`coalesce(sum(${s.salesOrderItems.weight}),0)` })
        .from(s.salesOrderItems).innerJoin(s.salesOrder, eq(s.salesOrder.id, s.salesOrderItems.salesOrderId))
        .where(eq(s.salesOrder.pipelineStatus, 'Draft')).groupBy(s.salesOrderItems.stockCodeId).all();
      const resMap = {}; resRows.forEach(r => { if (r.sid) resMap[r.sid] = Number(r.w || 0); });
      const stocks = stockRows.map(st => {
        const avail = Math.round((Number(st.weight || 0) - (resMap[st.id] || 0)) * 100) / 100;
        const p = prodMap[st.productId]; const cs = csMap[st.coldStorageId];
        return {
          id: st.id, productId: st.productId, productName: p ? p.name : null,
          kodeSimpan: st.kodeSimpan, coldStorage: cs ? cs.code : null,
          available: avail, hppPerKg: st.hppPerKg || 0,
          label: `${st.kodeSimpan} · ${p ? p.name : '-'}${cs ? ' · ' + cs.code : ''} · sisa ${avail} kg`,
        };
      }).filter(x => x.available > 0.0001);
      return json({
        ok: true,
        customers, suppliers, dropshippers, agents, products, stocks,
        poTypes: ['Live Bird', 'Packaging', 'Bahan Baku', 'Produk Jadi', 'Operasional'],
        fulfillmentTypes: [{ value: 'stock', label: 'Dari Stok' }, { value: 'dropship', label: 'Dropship (langsung dari supplier)' }],
      });
    }

    // ---------- Shared helpers (hoisted early so all route blocks can use) ----------
    // Broadcast in-app notifications to all users with any of the given roles.
    const createNotification = ({ roles = ['supervisor', 'direktur'], type = 'info', category, title, message, entityType, entityId, entityNumber, linkPath, refApprovalId, priority = 'normal' }) => {
      try {
        if (!Array.isArray(roles) || roles.length === 0) return;
        const recipients = authUsers.getCachedRecipients(roles);
        const now = new Date();
        for (const r of recipients) {
          if (r.status && r.status !== 'active') continue;
          db.insert(s.notifications).values({
            id: uuidv4(),
            userId: r.id,
            type,
            category,
            title,
            message: message || null,
            entityType: entityType || null,
            entityId: entityId || null,
            entityNumber: entityNumber || null,
            linkPath: linkPath || null,
            refApprovalId: refApprovalId || null,
            priority,
            isRead: false,
            createdAt: now,
          }).run();
        }
      } catch (e) {
        console.error('createNotification failed:', e?.message || e);
      }
    };

    // Create an approval concern row.
    // Supervisor is the approver (approve/reject → drives status).
    // Direktur is concern-only (view + optional acknowledge/flag).
    // Also auto-broadcasts in-app notifications to supervisor+direktur.
    const createApproval = ({ concernType, entityType, entityId, entityNumber, title, description, priority = 'normal', amount = 0, metadata = null, createdBy, notifyRoles }) => {
      const id = uuidv4();
      db.insert(s.approvals).values({
        id,
        concernType,
        entityType,
        entityId,
        entityNumber,
        requiredRole: 'both',
        title,
        description,
        priority,
        amount,
        metadata: metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
        status: 'pending',
        createdBy: createdBy || 'system',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run();
      // Auto notify (default: both supervisor & direktur)
      createNotification({
        roles: notifyRoles || ['supervisor', 'direktur'],
        type: 'approval',
        category: concernType,
        title,
        message: description,
        entityType,
        entityId,
        entityNumber,
        linkPath: '/dashboard/approvals',
        refApprovalId: id,
        priority,
      });
      return id;
    };

    // Compute reference HPP for a product from latest WO output or PO item.
    const getProductHpp = (productId) => {
      try {
        const wo = db.select({ hpp: s.woOutputs.hppPerKg }).from(s.woOutputs)
          .where(and(eq(s.woOutputs.productId, productId), sql`${s.woOutputs.hppPerKg} > 0`))
          .orderBy(desc(s.woOutputs.createdAt)).limit(5).all();
        if (wo.length > 0) {
          const avg = wo.reduce((a, b) => a + Number(b.hpp), 0) / wo.length;
          if (avg > 0) return avg;
        }
        const po = db.select({ hpp: s.purchaseOrderItems.hppPerKg }).from(s.purchaseOrderItems)
          .where(and(eq(s.purchaseOrderItems.productId, productId), sql`${s.purchaseOrderItems.hppPerKg} > 0`))
          .all();
        if (po.length > 0) {
          const avg = po.reduce((a, b) => a + Number(b.hpp), 0) / po.length;
          if (avg > 0) return avg;
        }
        // Fallback: product master "Harga Modal / HPP" (base_price). Used for opening stock / manual
        // Tally Inbound of products with no PO/WO cost history yet, so their sold stock carries a real
        // cost basis (accurate COGS & gross profit on the Sales Order invoice).
        const prod = db.select({ bp: s.products.basePrice }).from(s.products).where(eq(s.products.id, productId)).get();
        if (prod && Number(prod.bp) > 0) return Number(prod.bp);
      } catch (e) { /* ignore */ }
      return 0;
    };

    // ---- Komisi Dropshipper helpers ----
    // Hitung komisi untuk sebuah SO berdasarkan tipe & nilai. costOverride opsional (manual).
    const computeSoCommission = (soId, type, value, costOverride) => {
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      if (!so) return null;
      const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
      const totalWeight = items.reduce((a, b) => a + Number(b.weight || 0), 0);
      const revenue = Number(so.totalAmount || 0);
      // auto cost dari HPP stok yg dijual, fallback ke HPP produk
      let autoCost = 0;
      for (const it of items) {
        let hpp = 0;
        if (it.stockCodeId) {
          const stk = db.select({ hpp: s.inventoryStock.hppPerKg }).from(s.inventoryStock).where(eq(s.inventoryStock.id, it.stockCodeId)).get();
          hpp = Number(stk?.hpp || 0);
        }
        if (!hpp) hpp = getProductHpp(it.productId);
        autoCost += hpp * Number(it.weight || 0);
      }
      const hasOverride = costOverride !== undefined && costOverride !== null && costOverride !== '';
      const cost = hasOverride ? Number(costOverride) : autoCost;
      const profit = Math.max(0, revenue - cost);
      let basis = 0, amount = 0;
      if (type === 'per_kg') { basis = totalWeight; amount = Number(value || 0) * totalWeight; }
      else if (type === 'fixed') { basis = 0; amount = Number(value || 0); }
      else if (type === 'percent_profit') { basis = profit; amount = profit * Number(value || 0) / 100; }
      return { totalWeight, revenue, autoCost, cost, profit, basis, amount: Math.max(0, Math.round(amount)) };
    };

    const getCommissionSummary = (dropshipperId) => {
      const records = db.select().from(s.commissionRecords).where(eq(s.commissionRecords.dropshipperId, dropshipperId)).orderBy(desc(s.commissionRecords.createdAt)).all();
      const payments = db.select().from(s.commissionPayments).where(eq(s.commissionPayments.dropshipperId, dropshipperId)).orderBy(desc(s.commissionPayments.paymentDate)).all();
      const totalCommission = records.reduce((a, b) => a + Number(b.commissionAmount || 0), 0);
      const totalPaid = payments.reduce((a, b) => a + Number(b.amount || 0), 0);
      const unpaidAmount = records.filter(r => r.status === 'unpaid').reduce((a, b) => a + Number(b.commissionAmount || 0), 0);
      return { records, payments, summary: { totalCommission, totalPaid, outstanding: Math.round(totalCommission - totalPaid), unpaidAmount: Math.round(unpaidAmount), recordCount: records.length } };
    };

    // ---------- SEED (idempotent) ----------
    if (route === '/seed' && method === 'POST') {
      // Only allow if no admin exists yet, otherwise no-op (users live in MongoDB now)
      const existingAdmins = await authUsers.findUsersByRoles(['admin']);
      if (existingAdmins.length > 0) {
        return json({ ok: true, seeded: false, message: 'Admin already exists' });
      }

      // Create default users via better-auth (MongoDB)
      const defaults = [
        { email: 'admin@lpi.co.id', name: 'Administrator', password: 'admin123', role: 'admin' },
        { email: 'supervisor@lpi.co.id', name: 'Supervisor Ops', password: 'super123', role: 'supervisor' },
        { email: 'direktur@lpi.co.id', name: 'Direktur', password: 'direktur123', role: 'direktur' },
        { email: 'operator@lpi.co.id', name: 'Operator RPH', password: 'operator123', role: 'operator' },
      ];
      const created = [];
      for (const u of defaults) {
        try {
          await authUsers.createUser({ name: u.name, email: u.email, password: u.password, role: u.role, status: 'active' });
          created.push({ email: u.email, ok: true });
        } catch (e) {
          created.push({ email: u.email, error: String(e?.message || e) });
        }
      }

      // Seed some demo master data (idempotent by code/sku)
      const now = new Date();
      const upsertContact = (c) => {
        const found = db.select().from(s.contacts).where(eq(s.contacts.code, c.code)).all();
        const cats = Array.isArray(c.categories) && c.categories.length ? c.categories : (c.contactType ? [c.contactType] : ['Customer']);
        if (found.length === 0) db.insert(s.contacts).values({ id: uuidv4(), ...c, contactType: cats[0], categories: JSON.stringify(cats), isAgent: cats.includes('Agen'), isDropshipper: cats.includes('Dropshipper'), createdAt: now, updatedAt: now }).run();
      };
      upsertContact({ contactType: 'Supplier', code: 'SUP-001', displayName: 'PT Ayam Sejahtera', companyName: 'PT Ayam Sejahtera', phone: '021-5551001', city: 'Bekasi', taxStatus: 'PKP' });
      upsertContact({ contactType: 'RPH', code: 'RPH-001', displayName: 'RPH Cikarang Prima', companyName: 'RPH Cikarang Prima', phone: '021-5552002', city: 'Cikarang' });
      upsertContact({ contactType: 'Customer', code: 'CUST-001', displayName: 'Toko Fresh Meat Jaya', companyName: 'Toko Fresh Meat Jaya', creditLimit: 50000000, phone: '021-5553003', city: 'Jakarta' });
      upsertContact({ contactType: 'Customer', code: 'CUST-002', displayName: 'Rest Nusantara Chicken', isSubscriber: true, prepaidBalance: 25000000, phone: '021-5554004', city: 'Bandung' });
      upsertContact({ contactType: 'Karyawan', code: 'EMP-001', displayName: 'Budi Santoso', phone: '0812-1000-0001' });
      upsertContact({ contactType: 'Mitra', code: 'MTR-001', displayName: 'CV Logistik Bersama', phone: '021-5555005' });

      const upsertProduct = (p) => {
        const found = db.select().from(s.products).where(eq(s.products.sku, p.sku)).all();
        if (found.length === 0) db.insert(s.products).values({ id: uuidv4(), ...p, createdAt: now, updatedAt: now }).run();
      };
      upsertProduct({ sku: 'LB-001', name: 'Ayam Hidup Broiler', category: 'Live Bird', unit: 'kg', basePrice: 22000 });
      upsertProduct({ sku: 'KRK-001', name: 'Karkas Ayam Utuh', category: 'Karkas', unit: 'kg', basePrice: 38000, shelfLifeDays: 5 });
      upsertProduct({ sku: 'BN-001', name: 'Boneless Dada', category: 'Boneless', unit: 'kg', basePrice: 62000, shelfLifeDays: 5 });
      upsertProduct({ sku: 'PT-001', name: 'Parting Paha Atas', category: 'Parting', unit: 'kg', basePrice: 45000, shelfLifeDays: 5 });
      upsertProduct({ sku: 'RT-001', name: 'Retail Fillet 500g', category: 'Retail', unit: 'pack', basePrice: 35000, shelfLifeDays: 30 });

      const upsertCS = (c) => {
        const found = db.select().from(s.coldStorages).where(eq(s.coldStorages.code, c.code)).all();
        if (found.length === 0) {
          const id = uuidv4();
          db.insert(s.coldStorages).values({ id, ...c, createdAt: now, updatedAt: now }).run();
          return id;
        }
        return found[0].id;
      };
      const cs1 = upsertCS({ code: 'CS-01', name: 'Cold Storage Utama', location: 'Cikarang', temperatureRange: '-18 to -22 C', capacityKg: 50000 });
      const cs2 = upsertCS({ code: 'CS-02', name: 'Cold Storage Cadangan', location: 'Bekasi', temperatureRange: '-18 to -22 C', capacityKg: 30000 });

      const upsertZone = (z) => {
        const found = db.select().from(s.zones).where(and(eq(s.zones.coldStorageId, z.coldStorageId), eq(s.zones.code, z.code))).all();
        if (found.length === 0) db.insert(s.zones).values({ id: uuidv4(), ...z, createdAt: now, updatedAt: now }).run();
      };
      upsertZone({ coldStorageId: cs1, code: 'Z-A1', name: 'Zona A1 - Karkas' });
      upsertZone({ coldStorageId: cs1, code: 'Z-A2', name: 'Zona A2 - Boneless' });
      upsertZone({ coldStorageId: cs1, code: 'Z-B1', name: 'Zona B1 - Parting' });
      upsertZone({ coldStorageId: cs2, code: 'Z-C1', name: 'Zona C1 - Retail' });

      return json({ ok: true, seeded: true, users: created });
    }

    // ---------- ME ----------
    if (route === '/me' && method === 'GET') {
      const { session, error } = await requireAuth();
      if (error) return error;
      return json({ user: session.user });
    }

    // GET /cash-bank-accounts — daftar akun Kas & Bank (COA 1-11xx) untuk dropdown pembayaran SO/PO.
    // Dapat diakses semua peran manajemen (admin/supervisor perlu ini walau modul akunting dibatasi).
    if (route === '/cash-bank-accounts' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      try {
        const all = await coaMongo.coaList({ includeArchived: false });
        const rows = (all || [])
          .filter(a => String(a.code || '').startsWith('1-11') && a.archived_at == null && (a.is_postable == null || a.is_postable === 1 || a.is_postable === true))
          .map(a => ({ code: a.code, name: a.name }))
          .sort((x, y) => String(x.code).localeCompare(String(y.code)));
        return json({ data: rows });
      } catch (e) { return json({ data: [] }); }
    }

    // ---------- NOTIFICATIONS (in-app) ----------
    // GET /notifications?limit=50&unreadOnly=1
    if (route === '/notifications' && method === 'GET') {
      const { session, error } = await requireAuth();
      if (error) return error;
      const url = new URL(request.url);
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
      const unreadOnly = url.searchParams.get('unreadOnly') === '1' || url.searchParams.get('unreadOnly') === 'true';
      const conds = [eq(s.notifications.userId, session.user.id)];
      if (unreadOnly) conds.push(eq(s.notifications.isRead, false));
      const rows = db.select().from(s.notifications).where(and(...conds)).orderBy(desc(s.notifications.createdAt)).limit(limit).all();
      const unreadCount = db.select({ c: sql`count(*)` }).from(s.notifications).where(and(eq(s.notifications.userId, session.user.id), eq(s.notifications.isRead, false))).get()?.c || 0;
      return json({ data: rows, unreadCount: Number(unreadCount) });
    }

    // GET /notifications/unread-count
    if (route === '/notifications/unread-count' && method === 'GET') {
      const { session, error } = await requireAuth();
      if (error) return error;
      const c = db.select({ c: sql`count(*)` }).from(s.notifications).where(and(eq(s.notifications.userId, session.user.id), eq(s.notifications.isRead, false))).get();
      return json({ count: Number(c?.c || 0) });
    }

    // POST /notifications/read-all
    if (route === '/notifications/read-all' && method === 'POST') {
      const { session, error } = await requireAuth();
      if (error) return error;
      db.update(s.notifications).set({ isRead: true, readAt: new Date() })
        .where(and(eq(s.notifications.userId, session.user.id), eq(s.notifications.isRead, false)))
        .run();
      return json({ ok: true });
    }

    // POST /notifications/:id/read
    if (route.startsWith('/notifications/') && path.length === 3 && path[2] === 'read' && method === 'POST') {
      const { session, error } = await requireAuth();
      if (error) return error;
      const id = path[1];
      const row = db.select().from(s.notifications).where(and(eq(s.notifications.id, id), eq(s.notifications.userId, session.user.id))).get();
      if (!row) return err('Notifikasi tidak ditemukan', 404);
      db.update(s.notifications).set({ isRead: true, readAt: new Date() }).where(eq(s.notifications.id, id)).run();
      return json({ ok: true });
    }

    // DELETE /notifications/:id
    if (route.startsWith('/notifications/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth();
      if (error) return error;
      const id = path[1];
      const row = db.select().from(s.notifications).where(and(eq(s.notifications.id, id), eq(s.notifications.userId, session.user.id))).get();
      if (!row) return err('Notifikasi tidak ditemukan', 404);
      db.delete(s.notifications).where(eq(s.notifications.id, id)).run();
      return json({ ok: true });
    }

    // ---------- APPROVALS / CONCERNS ----------
    // GET /approvals - list concerns (supervisor + direktur + admin see all)
    if (route === '/approvals' && method === 'GET') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const status = url.searchParams.get('status'); // pending | approved | rejected | all
      const concernType = url.searchParams.get('type');
      const conds = [];
      if (status && status !== 'all') conds.push(eq(s.approvals.status, status));
      if (concernType) conds.push(eq(s.approvals.concernType, concernType));
      let query = db.select().from(s.approvals);
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.approvals.createdAt)).all();
      const enriched = rows.map(r => ({
        ...r,
        metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : null,
      }));
      // Also provide summary counts
      const allRows = db.select({ status: s.approvals.status }).from(s.approvals).all();
      const summary = {
        total: allRows.length,
        pending: allRows.filter(r => r.status === 'pending').length,
        approved: allRows.filter(r => r.status === 'approved').length,
        rejected: allRows.filter(r => r.status === 'rejected').length,
      };
      return json({ data: enriched, summary });
    }

    // POST /approvals/:id/action - take action (approve/reject as supervisor, acknowledge/flag as direktur)
    if (route.startsWith('/approvals/') && path.length === 3 && path[2] === 'action' && method === 'POST') {
      const { session, error } = await requireAuth();
      if (error) return error;
      const userRole = session.user.role;
      if (!['supervisor', 'direktur', 'akuntan'].includes(userRole)) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const { action, note } = body || {};
      const ap = db.select().from(s.approvals).where(eq(s.approvals.id, id)).get();
      if (!ap) return err('Concern tidak ditemukan', 404);

      const now = new Date();
      const upd = { updatedAt: now };

      if (userRole === 'akuntan') {
        // Akuntan adalah approver untuk konsern PERSETUJUAN PEMBAYARAN (payment_approval).
        // Untuk jenis konsern lain, akuntan tidak berwenang.
        if (ap.concernType !== 'payment_approval') {
          return err('Akuntan hanya dapat menyetujui konsern Persetujuan Pembayaran', 403);
        }
        if (!['approved', 'rejected'].includes(action)) return err('action harus approved atau rejected');
        if (ap.status !== 'pending') return err(`Konsern ini sudah ${ap.status}, tidak bisa diubah`);
        upd.supervisorAction = action;
        upd.supervisorNote = note || null;
        upd.supervisorActedAt = now;
        upd.supervisorActedBy = session.user.email;
        upd.status = action; // approved | rejected
        db.update(s.approvals).set(upd).where(eq(s.approvals.id, id)).run();
        // Setelah Akuntan menyetujui pembayaran → notifikasi INFO ke Supervisor & Direktur (tidak perlu approve lagi)
        if (action === 'approved') {
          createNotification({
            roles: ['supervisor', 'direktur'],
            type: 'info',
            category: 'payment_approved',
            title: `Pembayaran ${ap.entityNumber || ''} telah disetujui Akuntan`,
            message: `${ap.title}. Disetujui oleh ${session.user.email}${note ? ` · Catatan: ${note}` : ''}. Total Rp ${Number(ap.amount || 0).toLocaleString('id-ID')}.`,
            entityType: ap.entityType,
            entityId: ap.entityId,
            entityNumber: ap.entityNumber,
            linkPath: '/dashboard/approvals',
            priority: 'normal',
          });
        }
        const updated = db.select().from(s.approvals).where(eq(s.approvals.id, id)).get();
        return json({ data: { ...updated, metadata: updated.metadata ? (() => { try { return JSON.parse(updated.metadata); } catch { return null; } })() : null } });
      }

      if (userRole === 'supervisor') {
        // Supervisor can approve or reject (drives status)
        if (!['approved', 'rejected'].includes(action)) return err('action harus approved atau rejected untuk supervisor');
        if (ap.status !== 'pending') return err(`Concern ini sudah ${ap.status}, tidak bisa diubah`);
        upd.supervisorAction = action;
        upd.supervisorNote = note || null;
        upd.supervisorActedAt = now;
        upd.supervisorActedBy = session.user.email;
        upd.status = action; // approved | rejected
      } else if (userRole === 'direktur') {
        // Direktur: concern-only (add note, mark acknowledged/flagged, does NOT change status)
        if (!['acknowledged', 'flagged'].includes(action)) return err('action harus acknowledged atau flagged untuk direktur');
        upd.direkturAction = action;
        upd.direkturNote = note || null;
        upd.direkturActedAt = now;
        upd.direkturActedBy = session.user.email;
      }

      db.update(s.approvals).set(upd).where(eq(s.approvals.id, id)).run();
      const updated = db.select().from(s.approvals).where(eq(s.approvals.id, id)).get();
      return json({ data: { ...updated, metadata: updated.metadata ? (() => { try { return JSON.parse(updated.metadata); } catch { return null; } })() : null } });
    }

    // ---------- USERS ----------
    // GET /users - list users (supervisor/direktur)
    if (route === '/users' && method === 'GET') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const rows = await authUsers.listUsers(url.searchParams.get('archived'));
      return json({ data: rows });
    }

    // POST /users - create new user (supervisor/direktur only)
    if (route === '/users' && method === 'POST') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const body = await request.json();
      const { name, email, password, role, status = 'active' } = body || {};
      if (!name || !email || !password || !role) return err('name, email, password, role required');
      if (!['admin', 'supervisor', 'direktur', 'operator', 'akuntan'].includes(role)) return err('Invalid role');
      if (String(password).length < 6) return err('Password minimal 6 karakter');
      // Check duplicate email
      const existing = await authUsers.findUserRawByEmail(email);
      if (existing) return err('Email sudah terdaftar');
      try {
        const created = await authUsers.createUser({ name, email, password, role, status });
        return json({ data: created }, { status: 201 });
      } catch (e) {
        return err('Gagal membuat user: ' + String(e?.message || e), 400);
      }
    }

    // PATCH /users/:id - update user profile (name, role, status) - supervisor/direktur
    if (route.startsWith('/users/') && path.length === 2 && method === 'PATCH') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const targetRaw = await authUsers.findUserRawById(id);
      if (!targetRaw) return err('User tidak ditemukan', 404);
      const target = authUsers.serializeUser(targetRaw);
      // Prevent self-demote/deactivate to avoid lockout
      if (target.id === session.user.id && ((body.role && body.role !== target.role) || (body.status && body.status !== 'active'))) {
        return err('Tidak bisa mengubah role/status akun sendiri', 400);
      }
      const upd = {};
      if (body.name !== undefined) upd.name = body.name;
      if (body.role !== undefined) {
        if (!['admin', 'supervisor', 'direktur', 'operator', 'akuntan'].includes(body.role)) return err('Invalid role');
        upd.role = body.role;
      }
      if (body.status !== undefined) {
        if (!['active', 'inactive'].includes(body.status)) return err('Invalid status');
        upd.status = body.status;
      }
      if (Object.keys(upd).length === 0) return err('Tidak ada field yang diubah');
      await authUsers.updateUserById(id, upd);
      const updated = authUsers.serializeUser(await authUsers.findUserRawById(id));
      return json({ data: updated });
    }

    // POST /users/:id/reset-password - reset password (supervisor/direktur)
    if (route.startsWith('/users/') && path.length === 3 && path[2] === 'reset-password' && method === 'POST') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const { newPassword } = body || {};
      if (!newPassword || String(newPassword).length < 6) return err('Password minimal 6 karakter');
      const targetRaw = await authUsers.findUserRawById(id);
      if (!targetRaw) return err('User tidak ditemukan', 404);
      try {
        const ok = await authUsers.resetUserPassword(id, newPassword);
        if (!ok) throw new Error('Credential account not found');
        return json({ ok: true });
      } catch (e) {
        return err('Gagal reset password: ' + String(e?.message || e), 500);
      }
    }

    // DELETE /users/:id - delete user (supervisor/direktur, cannot delete self)
    if (route.startsWith('/users/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      if (id === session.user.id) return err('Tidak bisa menghapus akun sendiri', 400);
      const targetRaw = await authUsers.findUserRawById(id);
      if (!targetRaw) return err('User tidak ditemukan', 404);
      await authUsers.deleteUserById(id);
      return json({ ok: true });
    }

    // ---------- CONTACTS ----------
    if (route === '/contacts' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const type = url.searchParams.get('type');
      const q = url.searchParams.get('q');
      const filter = { ...md.mdArchivedFilter(url.searchParams.get('archived')) };
      if (q) {
        const rx = { $regex: q, $options: 'i' };
        filter.$or = [
          { displayName: rx }, { code: rx }, { companyName: rx }, { phone: rx }, { picPhone: rx },
        ];
      }
      let rows = (await md.mdList(md.MD.contacts, { filter, sort: { createdAt: -1 } })).map(withCategories);
      // Multi-category filter: match if the requested type is among the contact's categories
      if (type && type !== 'all') rows = rows.filter(r => r.categories.includes(type));
      return json({ data: rows });
    }
    if (route === '/contacts/next-code' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const category = new URL(request.url).searchParams.get('category') || 'Customer';
      return json({ code: await generateContactCodeMongo(category) });
    }
    if (route === '/contacts' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const body = await request.json();
      const cats = categoriesFromBody(body);
      if (!cats || !body.displayName) return err('categories (minimal 1) & displayName required');
      const now = new Date();
      delete body.id; delete body.createdAt;
      // Auto-generate code if not provided (editable by user before submit)
      if (!body.code || !String(body.code).trim()) body.code = await generateContactCodeMongo(cats[0]);
      // Unique code (Mongo authoritative)
      const dup = await md.mdFindOne(md.MD.contacts, { code: body.code });
      if (dup) return err(`Kode "${body.code}" sudah digunakan`, 409);
      // Derive backward-compatible fields from categories
      const derived = {
        contactType: cats[0],
        categories: JSON.stringify(cats),
        isAgent: cats.includes('Agen'),
        isDropshipper: cats.includes('Dropshipper'),
      };
      const row = { id: uuidv4(), ...body, ...derived, archivedAt: body.archivedAt ?? null, createdAt: now, updatedAt: now };
      try {
        await md.mdInsert(md.MD.contacts, row);
        try { db.insert(s.contacts).values(row).run(); } catch (e) { console.error('[contacts] SQLite mirror insert failed:', e?.message || e); }
        return json({ data: withCategories(row) }, { status: 201 });
      } catch (e) { return err('Failed to create: ' + e.message); }
    }
    // Transaction history for a contact
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'history' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const contact = await md.mdGet(md.MD.contacts, id);
      if (!contact) return err('Contact not found', 404);
      const salesOrders = db.select().from(s.salesOrder).where(eq(s.salesOrder.customerId, id)).orderBy(desc(s.salesOrder.orderDate)).all();
      const purchaseOrders = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.supplierId, id)).orderBy(desc(s.purchaseOrder.orderDate)).all();
      // Work orders linked via PO
      const poIds = purchaseOrders.map(p => p.id);
      let workOrders = [];
      if (poIds.length > 0) {
        for (const poId of poIds) {
          const wos = db.select().from(s.workOrder).where(eq(s.workOrder.purchaseOrderId, poId)).all();
          workOrders = workOrders.concat(wos);
        }
      }
      // Summary stats
      const totalSalesAmount = salesOrders.reduce((a, b) => a + Number(b.totalAmount || 0), 0);
      const totalPurchaseAmount = purchaseOrders.reduce((a, b) => a + Number(b.totalAmount || 0), 0);
      // Riwayat cashback (Faktur di-up) pelanggan ini
      const cashbackSOs = salesOrders.filter(o => o.markupEnabled && Number(o.cashbackAmount) > 0);
      let coaMap = {};
      if (cashbackSOs.length) { try { const coa = await coaMongo.coaList({ includeArchived: true }); for (const a of (coa || [])) coaMap[a.code] = a.name; } catch {} }
      const cashbackHistory = cashbackSOs.map(o => ({
        id: o.id, soNumber: o.soNumber, orderDate: o.orderDate, invoiceNumber: o.invoiceNumber,
        cashbackAmount: Number(o.cashbackAmount || 0),
        cashbackAccount: o.cashbackAccount, cashbackAccountName: o.cashbackAccount ? (coaMap[o.cashbackAccount] || o.cashbackAccount) : null,
        cashbackRecipient: o.cashbackRecipient,
        cashbackRefunded: !!o.cashbackRefunded, cashbackRefundedAt: o.cashbackRefundedAt,
        cashbackRefundNote: o.cashbackRefundNote, cashbackRefundedBy: o.cashbackRefundedBy,
        hasProof: !!o.cashbackProofKey, proofName: o.cashbackProofName,
        proofUrl: o.cashbackProofKey ? `/api/sales-orders/${o.id}/cashback-proof` : null,
      }));
      const totalCashback = cashbackHistory.reduce((a, b) => a + b.cashbackAmount, 0);
      const totalCashbackRefunded = cashbackHistory.filter(c => c.cashbackRefunded).reduce((a, b) => a + b.cashbackAmount, 0);
      return json({
        data: {
          contact: withCategories(contact),
          salesOrders,
          purchaseOrders,
          workOrders,
          cashbackHistory,
          summary: {
            salesCount: salesOrders.length,
            purchaseCount: purchaseOrders.length,
            workOrderCount: workOrders.length,
            totalSalesAmount,
            totalPurchaseAmount,
            cashbackCount: cashbackHistory.length,
            totalCashback,
            totalCashbackRefunded,
            totalCashbackPending: totalCashback - totalCashbackRefunded,
          },
        },
      });
    }
    if (route.startsWith('/contacts/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const row = await md.mdGet(md.MD.contacts, id);
      if (!row) return err('Not found', 404);
      return json({ data: withCategories(row) });
    }
    if (route.startsWith('/contacts/') && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt;
      // If categories (or contactType) provided, recompute derived fields
      const cats = (Array.isArray(body.categories) || body.contactType) ? categoriesFromBody(body) : null;
      if (cats) {
        body.contactType = cats[0];
        body.categories = JSON.stringify(cats);
        body.isAgent = cats.includes('Agen');
        body.isDropshipper = cats.includes('Dropshipper');
      } else {
        delete body.categories; // avoid writing a bad value
      }
      const patch = { ...body, updatedAt: new Date() };
      const row = await md.mdUpdate(md.MD.contacts, id, patch);
      if (!row) return err('Not found', 404);
      try { db.update(s.contacts).set(patch).where(eq(s.contacts.id, id)).run(); } catch (e) { console.error('[contacts] SQLite mirror update failed:', e?.message || e); }
      return json({ data: withCategories(row) });
    }
    if (route.startsWith('/contacts/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden - hanya admin', 403);
      const id = path[1];
      const contact = await md.mdGet(md.MD.contacts, id);
      if (!contact) return err('Kontak tidak ditemukan', 404);
      // Guard: kontak yang sudah dipakai transaksi / sub-data tidak boleh dihapus (jaga integritas)
      const refs = [
        ['Sales Order', db.select().from(s.salesOrder).where(eq(s.salesOrder.customerId, id)).all().length],
        ['Purchase Order', db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.supplierId, id)).all().length],
        ['Pelanggan Akhir', db.select().from(s.contactCustomers).where(eq(s.contactCustomers.parentContactId, id)).all().length],
        ['Komisi', db.select().from(s.commissionRecords).where(eq(s.commissionRecords.dropshipperId, id)).all().length],
      ].filter(([, n]) => n > 0);
      if (refs.length > 0) {
        const detail = refs.map(([name, n]) => `${name} (${n})`).join(', ');
        return err(`Kontak "${contact.displayName}" sudah dipakai: ${detail}. Tidak dapat dihapus. Arsipkan untuk menonaktifkan.`, 409);
      }
      await md.mdDelete(md.MD.contacts, id);
      try { db.delete(s.contacts).where(eq(s.contacts.id, id)).run(); } catch (e) { console.error('[contacts] SQLite mirror delete failed:', e?.message || e); }
      return json({ ok: true });
    }

    // ---------- CONTACT CUSTOMERS (pelanggan akhir Agen/Dropshipper) ----------
    // GET /contacts/:id/customers
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'customers' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const rows = db.select().from(s.contactCustomers).where(eq(s.contactCustomers.parentContactId, id)).orderBy(desc(s.contactCustomers.createdAt)).all();
      // Enrich linked customers with LIVE data from the referenced contact (not a copy)
      const enriched = rows.map(r => {
        if (r.linkedContactId) {
          const c = db.select().from(s.contacts).where(eq(s.contacts.id, r.linkedContactId)).get();
          if (c) {
            return {
              ...r,
              linkedContact: {
                id: c.id, code: c.code, displayName: c.displayName,
                companyName: c.companyName, phone: c.phone, picName: c.picName,
                address: c.address, city: c.city, contactType: c.contactType, mapsUrl: c.mapsUrl,
              },
              // surface live values for display convenience
              name: c.displayName || r.name,
              phone: c.phone || r.phone,
              address: c.address || r.address,
              city: c.city || r.city,
              picName: c.picName || r.picName,
              mapsUrl: c.mapsUrl || r.mapsUrl,
            };
          }
          return { ...r, linkedContact: null, linkedMissing: true };
        }
        return r;
      });
      return json({ data: enriched });
    }
    // POST /contacts/:id/customers
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'customers' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const id = path[1];
      // Kontak bersifat MongoDB-authoritative; mirror SQLite per-pod bisa belum ter-hydrate di
      // replika tertentu (menyebabkan "Kontak tidak ditemukan" yang intermittent). Fallback ke Mongo.
      let parent = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      if (!parent) { 
        try { 
          parent = await md.mdGet('contacts', id); 
          // Sync to SQLite mirror to satisfy foreign key constraints
          if (parent) {
            try { 
              // Convert MongoDB date strings to Date objects for SQLite
              const parentForSqlite = {
                ...parent,
                createdAt: parent.createdAt ? new Date(parent.createdAt) : new Date(),
                updatedAt: parent.updatedAt ? new Date(parent.updatedAt) : new Date(),
                archivedAt: parent.archivedAt ? new Date(parent.archivedAt) : null,
              };
              db.insert(s.contacts).values(parentForSqlite).run(); 
            } catch (e) { /* ignore duplicate or other SQLite errors */ }
          }
        } catch { /* ignore MongoDB fetch errors */ } 
      }
      if (!parent) return err('Kontak tidak ditemukan', 404);
      const body = await request.json();
      const now = new Date();

      // Mode "Pilih dari Kontak": tautkan ke kontak Customer yang sudah ada (bukan salinan)
      if (body.linkedContactId) {
        let linked = db.select().from(s.contacts).where(eq(s.contacts.id, body.linkedContactId)).get();
        if (!linked) { 
          try { 
            linked = await md.mdGet('contacts', body.linkedContactId); 
            // Sync to SQLite mirror to satisfy foreign key constraints
            if (linked) {
              try { 
                // Convert MongoDB date strings to Date objects for SQLite
                const linkedForSqlite = {
                  ...linked,
                  createdAt: linked.createdAt ? new Date(linked.createdAt) : new Date(),
                  updatedAt: linked.updatedAt ? new Date(linked.updatedAt) : new Date(),
                  archivedAt: linked.archivedAt ? new Date(linked.archivedAt) : null,
                };
                db.insert(s.contacts).values(linkedForSqlite).run(); 
              } catch (e) { /* ignore duplicate or other SQLite errors */ }
            }
          } catch { /* ignore MongoDB fetch errors */ } 
        }
        if (!linked) return err('Kontak yang dipilih tidak ditemukan', 404);
        if (linked.id === id) return err('Tidak boleh menautkan kontak ke dirinya sendiri', 400);
        // cegah duplikat tautan ke kontak yang sama
        const dup = db.select().from(s.contactCustomers)
          .where(and(eq(s.contactCustomers.parentContactId, id), eq(s.contactCustomers.linkedContactId, body.linkedContactId)))
          .get();
        if (dup) return err('Kontak ini sudah tertaut sebagai pelanggan', 400);
        const row = {
          id: uuidv4(), parentContactId: id, linkedContactId: linked.id,
          // simpan snapshot minimal sebagai fallback; sumber data hidup dari kontak tertaut
          name: linked.displayName || linked.companyName || 'Kontak',
          phone: linked.phone || null, address: linked.address || null,
          city: linked.city || null, picName: linked.picName || null,
          mapsUrl: linked.mapsUrl || null,
          notes: body.notes || null, status: 'active', createdAt: now, updatedAt: now,
        };
        db.insert(s.contactCustomers).values(row).run();
        return json({ data: { ...row, linkedContact: { id: linked.id, code: linked.code, displayName: linked.displayName, phone: linked.phone, contactType: linked.contactType, mapsUrl: linked.mapsUrl } } }, { status: 201 });
      }

      if (!body.name) return err('name required');
      const row = {
        id: uuidv4(), parentContactId: id, linkedContactId: null,
        name: body.name, phone: body.phone || null, address: body.address || null,
        city: body.city || null, picName: body.picName || null, notes: body.notes || null,
        mapsUrl: body.mapsUrl || null,
        status: 'active', createdAt: now, updatedAt: now,
      };
      db.insert(s.contactCustomers).values(row).run();
      return json({ data: row }, { status: 201 });
    }
    // PATCH /contacts/:id/customers/:cid
    if (route.startsWith('/contacts/') && path.length === 4 && path[2] === 'customers' && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const cid = path[3];
      const body = await request.json();
      delete body.id; delete body.parentContactId; delete body.createdAt;
      db.update(s.contactCustomers).set({ ...body, updatedAt: new Date() }).where(eq(s.contactCustomers.id, cid)).run();
      const row = db.select().from(s.contactCustomers).where(eq(s.contactCustomers.id, cid)).get();
      return json({ data: row });
    }
    // DELETE /contacts/:id/customers/:cid
    if (route.startsWith('/contacts/') && path.length === 4 && path[2] === 'customers' && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const cid = path[3];
      db.delete(s.contactCustomers).where(eq(s.contactCustomers.id, cid)).run();
      return json({ ok: true });
    }

    // ---------- CONTACT DOCUMENTS (dokumen legal opsional) ----------
    // GET /contacts/:id/documents/:docId/file  → stream/preview the file
    if (route.startsWith('/contacts/') && path.length === 5 && path[2] === 'documents' && path[4] === 'file' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1]; const docId = path[3];
      const doc = db.select().from(s.contactDocuments).where(and(eq(s.contactDocuments.id, docId), eq(s.contactDocuments.contactId, id))).get();
      if (!doc) return err('Dokumen tidak ditemukan', 404);
      const filePath = path_join_safe(id, doc.storedName);
      if (!filePath || !fs.existsSync(filePath)) return err('File tidak ada di server', 404);
      const buf = fs.readFileSync(filePath);
      const res = new NextResponse(buf, { status: 200, headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(doc.fileName)}"`,
        'Content-Length': String(buf.length),
      } });
      return cors(res);
    }
    // GET /contacts/:id/documents  → list metadata
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'documents' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const rows = db.select().from(s.contactDocuments).where(eq(s.contactDocuments.contactId, id)).orderBy(desc(s.contactDocuments.createdAt)).all();
      return json({ data: rows });
    }
    // POST /contacts/:id/documents  → multipart upload {file, docType}
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'documents' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const id = path[1];
      const parent = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      if (!parent) return err('Kontak tidak ditemukan', 404);
      let formData;
      try { formData = await request.formData(); } catch (e) { return err('Body harus multipart/form-data'); }
      const file = formData.get('file');
      let docType = formData.get('docType') || 'Lainnya';
      if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return err('File wajib diunggah');
      if (!ALLOWED_DOC_TYPES.includes(docType)) docType = 'Lainnya';
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length === 0) return err('File kosong');
      if (bytes.length > 10 * 1024 * 1024) return err('Ukuran file maksimal 10MB');
      const dir = nodePath.join(CONTACT_DOCS_ROOT, id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
      const safeName = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const storedName = `${uuidv4()}_${safeName}`;
      fs.writeFileSync(nodePath.join(dir, storedName), bytes);
      const now = new Date();
      const row = {
        id: uuidv4(), contactId: id, docType,
        fileName: file.name || safeName, storedName,
        mimeType: file.type || 'application/octet-stream', size: bytes.length,
        uploadedBy: session.user?.email || session.user?.id || null, createdAt: now,
      };
      db.insert(s.contactDocuments).values(row).run();
      return json({ data: row }, { status: 201 });
    }
    // DELETE /contacts/:id/documents/:docId
    if (route.startsWith('/contacts/') && path.length === 4 && path[2] === 'documents' && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const id = path[1]; const docId = path[3];
      const doc = db.select().from(s.contactDocuments).where(and(eq(s.contactDocuments.id, docId), eq(s.contactDocuments.contactId, id))).get();
      if (!doc) return err('Dokumen tidak ditemukan', 404);
      const filePath = path_join_safe(id, doc.storedName);
      try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      db.delete(s.contactDocuments).where(eq(s.contactDocuments.id, docId)).run();
      return json({ ok: true });
    }


    // ---------- DROPSHIPPER COMMISSIONS ----------
    // GET /contacts/:id/commissions - list records + payments + summary
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'commissions' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const contact = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      if (!contact) return err('Kontak tidak ditemukan', 404);
      const { records, payments, summary } = getCommissionSummary(id);
      return json({ data: { contact, records, payments, summary } });
    }
    // POST /contacts/:id/commissions - create commission record from an SO
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'commissions' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const id = path[1];
      const ds = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      if (!ds) return err('Dropshipper tidak ditemukan', 404);
      if (!(ds.isDropshipper || ds.contactType === 'Dropshipper')) return err('Kontak ini bukan Dropshipper', 400);
      const body = await request.json();
      if (!body.salesOrderId) return err('salesOrderId required');
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, body.salesOrderId)).get();
      if (!so) return err('Sales Order tidak ditemukan', 404);
      // Cegah duplikasi komisi untuk SO yang sama pada dropshipper yang sama
      const dup = db.select().from(s.commissionRecords).where(and(eq(s.commissionRecords.dropshipperId, id), eq(s.commissionRecords.salesOrderId, body.salesOrderId))).get();
      if (dup) return err(`Komisi untuk ${so.soNumber} sudah tercatat pada dropshipper ini`);
      const type = body.commissionType || ds.commissionType || 'per_kg';
      const value = body.commissionValue !== undefined && body.commissionValue !== null && body.commissionValue !== ''
        ? Number(body.commissionValue) : Number(ds.commissionValue || 0);
      const calc = computeSoCommission(body.salesOrderId, type, value, body.costAmount);
      if (!calc) return err('Gagal menghitung komisi');
      const now = new Date();
      const row = {
        id: uuidv4(), dropshipperId: id, salesOrderId: body.salesOrderId, soNumber: so.soNumber,
        commissionType: type, commissionValue: value,
        basisAmount: calc.basis, revenueAmount: calc.revenue, costAmount: calc.cost,
        commissionAmount: calc.amount, status: 'unpaid',
        notes: body.notes || null, createdBy: session.user.email, createdAt: now,
      };
      db.insert(s.commissionRecords).values(row).run();
      return json({ data: { ...row, calc } }, { status: 201 });
    }
    // DELETE /contacts/:id/commissions/:rid - delete a commission record (only unpaid)
    if (route.startsWith('/contacts/') && path.length === 4 && path[2] === 'commissions' && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const rid = path[3];
      const rec = db.select().from(s.commissionRecords).where(eq(s.commissionRecords.id, rid)).get();
      if (!rec) return err('Record komisi tidak ditemukan', 404);
      if (rec.status === 'paid') return err('Komisi yang sudah dibayar tidak dapat dihapus');
      db.delete(s.commissionRecords).where(eq(s.commissionRecords.id, rid)).run();
      return json({ ok: true });
    }
    // POST /contacts/:id/commission-payments - pay commission (per SO record or lunasi semua)
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'commission-payments' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const id = path[1];
      const ds = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      if (!ds) return err('Dropshipper tidak ditemukan', 404);
      const body = await request.json();
      // Tentukan record yang akan dilunasi
      let targets = [];
      if (body.commissionRecordId) {
        const rec = db.select().from(s.commissionRecords).where(eq(s.commissionRecords.id, body.commissionRecordId)).get();
        if (!rec) return err('Record komisi tidak ditemukan', 404);
        if (rec.status === 'paid') return err('Komisi ini sudah dibayar');
        targets = [rec];
      } else {
        // Lunasi semua yang unpaid (per total saldo)
        targets = db.select().from(s.commissionRecords).where(and(eq(s.commissionRecords.dropshipperId, id), eq(s.commissionRecords.status, 'unpaid'))).all();
      }
      if (targets.length === 0) return err('Tidak ada komisi yang perlu dibayar');
      const totalAmount = targets.reduce((a, b) => a + Number(b.commissionAmount || 0), 0);
      const now = new Date();
      const payId = uuidv4();
      db.insert(s.commissionPayments).values({
        id: payId, dropshipperId: id,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : now,
        amount: totalAmount, method: body.method || 'Transfer',
        reference: body.reference || null, notes: body.notes || null,
        createdBy: session.user.email, createdAt: now,
      }).run();
      for (const t of targets) {
        db.update(s.commissionRecords).set({ status: 'paid', paymentId: payId, paidAt: now }).where(eq(s.commissionRecords.id, t.id)).run();
      }
      return json({ data: { paymentId: payId, amount: totalAmount, recordsPaid: targets.length } }, { status: 201 });
    }

    // POST /commissions/preview - hitung komisi tanpa menyimpan (untuk form)
    if (route === '/commissions/preview' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.salesOrderId) return err('salesOrderId required');
      const calc = computeSoCommission(body.salesOrderId, body.commissionType || 'per_kg', Number(body.commissionValue || 0), body.costAmount);
      if (!calc) return err('SO tidak ditemukan', 404);
      return json({ data: calc });
    }

    // ---------- PRODUCTS ---------- (MongoDB-authoritative, mirrored to SQLite)
    if (route === '/products' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const url = new URL(request.url);
      const q = url.searchParams.get('q');
      const cat = url.searchParams.get('category');
      const filter = { ...md.mdArchivedFilter(url.searchParams.get('archived')) };
      if (cat && cat !== 'all') filter.category = cat;
      if (q) filter.$or = [{ name: { $regex: q, $options: 'i' } }, { sku: { $regex: q, $options: 'i' } }];
      const rows = await md.mdList(md.MD.products, { filter, sort: { createdAt: -1 } });
      // Rata-rata tertimbang HPP/kg dari stok aktif (referensi valuasi untuk SO) — tetap dari SQLite (inventory belum migrasi)
      const hppAgg = db.all(sql`SELECT product_id as pid, SUM(hpp_per_kg * weight) as v, SUM(weight) as w FROM inventory_stock WHERE status = 'active' AND (archived_at IS NULL) GROUP BY product_id`);
      const hppMap = {};
      for (const a of hppAgg) {
        const w = Number(a.w || 0);
        hppMap[a.pid] = w > 0 ? Math.round(Number(a.v || 0) / w) : 0;
      }
      const enriched = rows.map(r => ({ ...r, avgHppPerKg: hppMap[r.id] || 0 }));
      return json({ data: enriched });
    }
    if (route === '/products' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.sku || !body.name) return err('sku and name required');
      // Unique SKU (Mongo authoritative)
      const dup = await md.mdFindOne(md.MD.products, { sku: body.sku });
      if (dup) return err(`SKU "${body.sku}" sudah digunakan`, 409);
      const now = new Date();
      delete body.id; delete body.createdAt; delete body.avgHppPerKg;
      const row = { id: uuidv4(), ...body, archivedAt: body.archivedAt ?? null, createdAt: now, updatedAt: now };
      try {
        await md.mdInsert(md.MD.products, row);
        try { db.insert(s.products).values(row).run(); } catch (e) { console.error('[products] SQLite mirror insert failed:', e?.message || e); }
        return json({ data: row }, { status: 201 });
      } catch (e) { return err('Failed to create: ' + e.message); }
    }
    if (route.startsWith('/products/') && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const id = path[1];
      const row = await md.mdGet(md.MD.products, id);
      if (!row) return err('Not found', 404);
      return json({ data: row });
    }
    if (route.startsWith('/products/') && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt; delete body.avgHppPerKg;
      const patch = { ...body, updatedAt: new Date() };
      const row = await md.mdUpdate(md.MD.products, id, patch);
      if (!row) return err('Not found', 404);
      try { db.update(s.products).set(patch).where(eq(s.products.id, id)).run(); } catch (e) { console.error('[products] SQLite mirror update failed:', e?.message || e); }
      return json({ data: row });
    }
    if (route.startsWith('/products/') && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      const prod = await md.mdGet(md.MD.products, id);
      if (!prod) return err('Produk tidak ditemukan', 404);
      // Cek referensi di transaksi — produk yang sudah dipakai tidak boleh dihapus (jaga integritas data). Referensi masih di SQLite.
      const refs = [
        ['Sales Order', db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.productId, id)).all().length],
        ['Purchase Order', db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.productId, id)).all().length],
        ['Inventory (stok)', db.select().from(s.inventoryStock).where(eq(s.inventoryStock.productId, id)).all().length],
        ['Work Order', db.select().from(s.woOutputs).where(eq(s.woOutputs.productId, id)).all().length],
        ['Penerimaan', db.select().from(s.salesOrderReceiptItems).where(eq(s.salesOrderReceiptItems.productId, id)).all().length],
      ].filter(([, n]) => n > 0);
      if (refs.length > 0) {
        const detail = refs.map(([name, n]) => `${name} (${n})`).join(', ');
        return err(`Produk "${prod.name}" sudah dipakai di transaksi: ${detail}. Produk tidak dapat dihapus. Ubah statusnya menjadi "Inactive" untuk menonaktifkan.`, 409);
      }
      try {
        await md.mdDelete(md.MD.products, id);
        try { db.delete(s.products).where(eq(s.products.id, id)).run(); } catch (e) { console.error('[products] SQLite mirror delete failed:', e?.message || e); }
        return json({ ok: true });
      } catch (e) {
        return err('Gagal menghapus produk: ' + (e.message || 'terkait data lain'), 409);
      }
    }

    // ---------- COLD STORAGES ---------- (MongoDB-authoritative, mirrored to SQLite)
    if (route === '/cold-storages' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const url = new URL(request.url);
      const rows = await md.mdList(md.MD.coldStorages, { filter: md.mdArchivedFilter(url.searchParams.get('archived')), sort: { createdAt: -1 } });
      // Enrich with zone counts (dari Mongo)
      const withZones = await Promise.all(rows.map(async (cs) => {
        const zoneCount = await md.mdCount(md.MD.zones, { coldStorageId: cs.id });
        return { ...cs, zoneCount: Number(zoneCount || 0) };
      }));
      return json({ data: withZones });
    }
    if (route === '/cold-storages' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.code || !body.name) return err('code and name required');
      const dup = await md.mdFindOne(md.MD.coldStorages, { code: body.code });
      if (dup) return err(`Kode "${body.code}" sudah digunakan`, 409);
      const now = new Date();
      delete body.id; delete body.createdAt; delete body.zones; delete body.zoneCount;
      const row = { id: uuidv4(), ...body, archivedAt: body.archivedAt ?? null, createdAt: now, updatedAt: now };
      try {
        await md.mdInsert(md.MD.coldStorages, row);
        try { db.insert(s.coldStorages).values(row).run(); } catch (e) { console.error('[cold-storages] SQLite mirror insert failed:', e?.message || e); }
        return json({ data: row }, { status: 201 });
      } catch (e) { return err('Failed to create: ' + e.message); }
    }
    if (route.startsWith('/cold-storages/') && path.length === 2 && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const id = path[1];
      const row = await md.mdGet(md.MD.coldStorages, id);
      if (!row) return err('Not found', 404);
      const zones = await md.mdList(md.MD.zones, { filter: { coldStorageId: id }, sort: { code: 1 } });
      return json({ data: { ...row, zones } });
    }
    if (route.startsWith('/cold-storages/') && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt; delete body.zones; delete body.zoneCount;
      const patch = { ...body, updatedAt: new Date() };
      const row = await md.mdUpdate(md.MD.coldStorages, id, patch);
      if (!row) return err('Not found', 404);
      try { db.update(s.coldStorages).set(patch).where(eq(s.coldStorages.id, id)).run(); } catch (e) { console.error('[cold-storages] SQLite mirror update failed:', e?.message || e); }
      return json({ data: row });
    }
    if (route.startsWith('/cold-storages/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      await md.mdDelete(md.MD.coldStorages, id);
      // Cascade zones in Mongo (SQLite mirror has ON DELETE CASCADE)
      try { await md.mdDeleteMany(md.MD.zones, { coldStorageId: id }); } catch (e) { /* ignore */ }
      try { db.delete(s.coldStorages).where(eq(s.coldStorages.id, id)).run(); } catch (e) { console.error('[cold-storages] SQLite mirror delete failed:', e?.message || e); }
      return json({ ok: true });
    }

    // ---------- ZONES ---------- (MongoDB-authoritative, mirrored to SQLite)
    // GET  /zones?cold_storage_id=xxx
    if (route === '/zones' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const url = new URL(request.url);
      const csId = url.searchParams.get('cold_storage_id');
      const filter = {};
      if (csId) filter.coldStorageId = csId;
      const rows = await md.mdList(md.MD.zones, { filter, sort: { code: 1 } });
      return json({ data: rows });
    }
    if (route === '/zones' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.coldStorageId || !body.code || !body.name) return err('coldStorageId, code, name required');
      const now = new Date();
      delete body.id; delete body.createdAt;
      const row = { id: uuidv4(), ...body, createdAt: now, updatedAt: now };
      try {
        await md.mdInsert(md.MD.zones, row);
        try { db.insert(s.zones).values(row).run(); } catch (e) { console.error('[zones] SQLite mirror insert failed:', e?.message || e); }
        return json({ data: row }, { status: 201 });
      } catch (e) { return err('Failed to create: ' + e.message); }
    }
    if (route.startsWith('/zones/') && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt;
      const patch = { ...body, updatedAt: new Date() };
      const row = await md.mdUpdate(md.MD.zones, id, patch);
      if (!row) return err('Not found', 404);
      try { db.update(s.zones).set(patch).where(eq(s.zones.id, id)).run(); } catch (e) { console.error('[zones] SQLite mirror update failed:', e?.message || e); }
      return json({ data: row });
    }
    if (route.startsWith('/zones/') && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      await md.mdDelete(md.MD.zones, id);
      try { db.delete(s.zones).where(eq(s.zones.id, id)).run(); } catch (e) { console.error('[zones] SQLite mirror delete failed:', e?.message || e); }
      return json({ ok: true });
    }

    // ---------- STATS (basic dashboard) ----------
    if (route === '/stats' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const cnt = (t) => Number(db.select({ c: sql`count(*)` }).from(t).get()?.c || 0);
      const userCount = await authUsers.countUsers();
      return json({
        contacts: await md.mdCount(md.MD.contacts),
        products: await md.mdCount(md.MD.products, md.mdArchivedFilter()),
        coldStorages: await md.mdCount(md.MD.coldStorages, md.mdArchivedFilter()),
        zones: await md.mdCount(md.MD.zones),
        users: userCount,
        purchaseOrders: cnt(s.purchaseOrder),
      });
    }

    // =====================================================================
    // PURCHASE ORDERS (Pembelian)
    // =====================================================================
    const PO_STATUS = ['Draft', 'Menunggu Konfirmasi', 'Diproses', 'Dikirim', 'Tanda Terima', 'Selesai', 'Dibatalkan'];
    const PO_FLOW = {
      'Draft': ['Menunggu Konfirmasi', 'Dibatalkan'],
      'Menunggu Konfirmasi': ['Diproses', 'Dibatalkan'],
      'Diproses': ['Dikirim', 'Dibatalkan'],
      'Dikirim': ['Tanda Terima', 'Dibatalkan'],
      'Tanda Terima': ['Selesai', 'Dibatalkan'],
      'Selesai': [],
      'Dibatalkan': [],
    };
    const nextPoNumber = () => {
      const ym = new Date();
      const prefix = `PO/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const rows = db.select({ n: s.purchaseOrder.poNumber }).from(s.purchaseOrder).where(like(s.purchaseOrder.poNumber, `${prefix}%`)).all();
      let max = 0;
      for (const r of rows) { const suf = parseInt(String(r.n).slice(prefix.length), 10); if (!isNaN(suf) && suf > max) max = suf; }
      return `${prefix}${String(max + 1).padStart(4, '0')}`;
    };
    const nextGrnNumber = () => {
      const ym = new Date();
      const prefix = `GRN/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      // Gap-safe: ambil suffix numerik tertinggi lalu +1 (COUNT tidak aman jika ada GRN terhapus)
      const rows = db.select({ n: s.grn.grnNumber }).from(s.grn).where(like(s.grn.grnNumber, `${prefix}%`)).all();
      let max = 0;
      for (const r of rows) {
        const suf = Number(String(r.n || '').slice(prefix.length));
        if (Number.isFinite(suf) && suf > max) max = suf;
      }
      const seq = String(max + 1).padStart(4, '0');
      return `${prefix}${seq}`;
    };
    const nextReturnNumber = () => {
      const ym = new Date();
      const prefix = `RET/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.purchaseReturns).where(like(s.purchaseReturns.returnNumber, `${prefix}%`)).get();
      const seq = String((Number(row?.c || 0) + 1)).padStart(4, '0');
      return `${prefix}${seq}`;
    };

    // Recalculate HPP per item & totals on PO. Returns aggregate summary.
    const recalcPoHpp = (poId) => {
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, poId)).get();
      const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, poId)).all();
      if (!po || items.length === 0) return { totalAmount: 0, items: [], susutTotal: 0 };
      const isLB = po.poType === 'Live Bird';
      const method = po.method || 'Timbang Ulang';
      const addCost = Number(po.additionalCost || 0);
      const companyBorne = po.additionalCostBearer !== 'supplier';
      const utangFreight = (companyBorne && (po.additionalCostPayMethod || 'utang') === 'utang') ? addCost : 0;
      let totalAmount = 0;
      let susutTotal = 0;
      for (const it of items) {
        // For Live Bird: determine invoice-weight (billed) & actual-weight (received)
        let weightBilled, weightActual;
        if (isLB) {
          if (method === 'Timbang Ulang') {
            weightBilled = Number(it.weightRph || it.weight || 0);
            weightActual = weightBilled;
          } else {
            // Timbang Kandang
            weightBilled = Number(it.weightSupplier || it.weight || 0);
            weightActual = Number(it.weightRph || weightBilled);
          }
        } else {
          weightBilled = Number(it.weight || 0);
          weightActual = weightBilled;
        }
        const itemCost = Number(it.unitPrice) * weightBilled;
        // Ongkir/biaya tambahan TIDAK dikapitalisasi ke HPP (dibebankan sbg Beban Angkut Pembelian)
        const hppPerKg = weightActual > 0 ? itemCost / weightActual : 0;
        totalAmount += itemCost;
        if (isLB) {
          const s1 = Number(it.weightSupplier || 0);
          const s2 = Number(it.weightRph || 0);
          if (s1 > 0 && s2 > 0) susutTotal += Math.max(0, s1 - s2);
        }
        db.update(s.purchaseOrderItems).set({ additionalCostShare: 0, hppPerKg }).where(eq(s.purchaseOrderItems.id, it.id)).run();
      }
      const finalTotal = totalAmount + utangFreight; // ongkir hanya menambah total PO bila ditagih via Utang ke pemasok
      db.update(s.purchaseOrder).set({ totalAmount: finalTotal, updatedAt: new Date() }).where(eq(s.purchaseOrder.id, poId)).run();
      return { totalAmount: finalTotal, susutTotal };
    };

    // Compute PO billable total + HPP based on chosen weight basis.
    //  - basis 'shipped' -> billable weight = Surat Jalan (receivedWeight), fallback plan weight
    //  - basis 'tally'   -> billable weight = Tally Inbound (tallyWeight), fallback SJ, fallback plan
    // HPP/kg ALWAYS references actual tally weight (fallback to billable weight when no tally yet).
    const poBillWeight = (it, basis) => {
      const plan = Number(it.weight || 0);
      const sjW = Number(it.receivedWeight || 0) > 0 ? Number(it.receivedWeight) : plan;
      const tW = Number(it.tallyWeight || 0) > 0 ? Number(it.tallyWeight) : sjW;
      return basis === 'tally' ? tW : sjW;
    };
    // Peta berat "Penerimaan Customer (SO)" per produk untuk SO dropship (fallback: berat kirim / pesanan)
    const getSoRecvMap = (soId) => {
      const map = {};
      if (!soId) return map;
      // Aggregate received weight from sales_order_receipt_items (customer receipts)
      const receiptItems = db.select({
        productId: s.salesOrderReceiptItems.productId,
        receivedWeight: s.salesOrderReceiptItems.receivedWeight
      })
        .from(s.salesOrderReceiptItems)
        .innerJoin(s.salesOrderReceipts, eq(s.salesOrderReceiptItems.receiptId, s.salesOrderReceipts.id))
        .where(eq(s.salesOrderReceipts.salesOrderId, soId))
        .all();
      
      if (receiptItems.length > 0) {
        // Use actual receipt data if available
        for (const ri of receiptItems) {
          map[ri.productId] = (map[ri.productId] || 0) + Number(ri.receivedWeight || 0);
        }
      } else {
        // Fallback to shipped/ordered weight if no receipts
        const soItems = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
        for (const si of soItems) {
          const w = Number(si.shippedWeight || 0) > 0 ? Number(si.shippedWeight) : Number(si.weight || 0);
          map[si.productId] = (map[si.productId] || 0) + w;
        }
      }
      return map;
    };
    const computePoInvoice = (poId, basisArg) => {
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, poId)).get();
      if (!po) return { totalAmount: 0, basis: 'shipped' };
      const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, poId)).all();
      // Dropship: basis 'grn' (=Surat Jalan SO / GRN PO) atau 'so_receipt' (Penerimaan Customer SO). Non-dropship: 'shipped' / 'tally'.
      let basis;
      if (po.isDropship) {
        const cand = basisArg || po.invoiceWeightBasis;
        basis = ['grn', 'so_receipt'].includes(cand) ? cand : 'grn';
      } else {
        basis = ((basisArg || po.invoiceWeightBasis || 'shipped') === 'tally') ? 'tally' : 'shipped';
      }
      const addCost = Number(po.additionalCost || 0);
      const companyBorne = po.additionalCostBearer !== 'supplier';
      const utangFreight = (companyBorne && (po.additionalCostPayMethod || 'utang') === 'utang') ? addCost : 0;
      const soRecvMap = (po.isDropship && basis === 'so_receipt') ? getSoRecvMap(po.salesOrderId) : null;
      const billOf = (it) => {
        if (soRecvMap) return soRecvMap[it.productId] != null ? soRecvMap[it.productId] : poBillWeight(it, 'shipped');
        return poBillWeight(it, basis === 'grn' ? 'shipped' : basis);
      };
      let subtotal = 0;
      for (const it of items) {
        const billW = billOf(it);
        const itemCost = Number(it.unitPrice || 0) * billW;
        subtotal += itemCost;
        // HPP/kg dari berat riil (tally bila ada, jika tidak = berat tagih). Ongkir TIDAK dikapitalisasi.
        const tallyW = Number(it.tallyWeight || 0) > 0 ? Number(it.tallyWeight) : billW;
        const hppPerKg = tallyW > 0 ? itemCost / tallyW : 0;
        db.update(s.purchaseOrderItems).set({ additionalCostShare: 0, hppPerKg }).where(eq(s.purchaseOrderItems.id, it.id)).run();
      }
      const finalTotal = Math.round((subtotal + utangFreight) * 100) / 100;
      db.update(s.purchaseOrder).set({ totalAmount: finalTotal, invoiceWeightBasis: basis, updatedAt: new Date() }).where(eq(s.purchaseOrder.id, poId)).run();
      return { totalAmount: finalTotal, basis };
    };
    // Preview total for a given basis WITHOUT persisting (for UI selector)
    const previewPoTotal = (po, items, basis, soRecvMap) => {
      const addCost = Number(po.additionalCost || 0);
      const companyBorne = po.additionalCostBearer !== 'supplier';
      const utangFreight = (companyBorne && (po.additionalCostPayMethod || 'utang') === 'utang') ? addCost : 0;
      const subtotal = items.reduce((a, it) => {
        let w;
        if (basis === 'so_receipt' && soRecvMap) w = soRecvMap[it.productId] != null ? soRecvMap[it.productId] : poBillWeight(it, 'shipped');
        else w = poBillWeight(it, basis === 'grn' ? 'shipped' : basis);
        return a + Number(it.unitPrice || 0) * w;
      }, 0);
      return Math.round((subtotal + utangFreight) * 100) / 100;
    };

    // GET /purchase-orders - list with filters
    if (route === '/purchase-orders' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      // operator perlu baca daftar PO untuk melakukan Inbound Tally (berbasis PO) di /tally/inbound
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const type = url.searchParams.get('type');
      const supplier = url.searchParams.get('supplier');
      const q = url.searchParams.get('q');
      const conds = [];
      { const ac = archivedCond(s.purchaseOrder, url); if (ac) conds.push(ac); }
      if (status && status !== 'all') conds.push(eq(s.purchaseOrder.pipelineStatus, status));
      if (type && type !== 'all') conds.push(eq(s.purchaseOrder.poType, type));
      if (supplier) conds.push(eq(s.purchaseOrder.supplierId, supplier));
      if (q) conds.push(like(s.purchaseOrder.poNumber, `%${q}%`));
      let query = db.select().from(s.purchaseOrder);
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.purchaseOrder.createdAt)).all();
      // Enrich with supplier name (batch-load contacts once to avoid N+1)
      const supIds = [...new Set(rows.map(r => r.supplierId).filter(Boolean))];
      const cMap = {};
      if (supIds.length) for (const c of db.select({ id: s.contacts.id, code: s.contacts.code, name: s.contacts.displayName }).from(s.contacts).where(inArray(s.contacts.id, supIds)).all()) cMap[c.id] = { code: c.code, name: c.name };
      const enriched = rows.map(r => ({ ...r, supplier: cMap[r.supplierId] || null }));
      return json({ data: enriched });
    }

    // POST /purchase-orders - create
    if (route === '/purchase-orders' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.supplierId || !Array.isArray(body.items) || body.items.length === 0) return err('supplierId and items required');
      const now = new Date();
      const id = uuidv4();
      const poNumber = body.poNumber || nextPoNumber();
      const orderDate = body.orderDate ? new Date(body.orderDate) : now;
      const expectedDate = body.expectedDate ? new Date(body.expectedDate) : null;
      const row = {
        id, poNumber,
        supplierId: body.supplierId,
        poType: body.poType || 'Live Bird',
        method: body.poType === 'Live Bird' ? (body.method || 'Timbang Ulang') : null,
        orderDate, expectedDate,
        pipelineStatus: 'Draft',
        isDropship: !!body.isDropship,
        dropshipCustomerId: body.dropshipCustomerId || null,
        additionalCost: Number(body.additionalCost || 0),
        additionalCostBearer: ['company', 'supplier'].includes(body.additionalCostBearer) ? body.additionalCostBearer : 'company',
        additionalCostPayMethod: ['tunai', 'transfer', 'utang'].includes(body.additionalCostPayMethod) ? body.additionalCostPayMethod : 'utang',
        dpAmount: Number(body.dpAmount || 0),
        paymentTerm: body.paymentTerm || null,
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: now, updatedAt: now,
      };
      db.insert(s.purchaseOrder).values(row).run();
      for (const it of body.items) {
        db.insert(s.purchaseOrderItems).values({
          id: uuidv4(),
          purchaseOrderId: id,
          productId: it.productId,
          quantity: Number(it.quantity || 0),
          weight: Number(it.weight || 0),
          unitPrice: Number(it.unitPrice || 0),
        }).run();
      }
      recalcPoHpp(id);
      const created = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      // Info notification to supervisor + direktur
      const supplier = db.select().from(s.contacts).where(eq(s.contacts.id, body.supplierId)).get();
      createNotification({
        roles: ['supervisor', 'direktur'],
        type: 'info',
        category: 'po_new',
        title: `PO Baru · ${poNumber}`,
        message: `PO ${body.poType || 'Live Bird'} dari ${supplier?.displayName || 'supplier'} dibuat oleh ${session.user.name || session.user.email}.`,
        entityType: 'PO', entityId: id, entityNumber: poNumber,
        linkPath: `/dashboard/purchase-orders/${id}`,
      });
      return json({ data: created }, { status: 201 });
    }

    // GET /purchase-orders/:id - detail
    if (route.startsWith('/purchase-orders/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      // operator perlu baca detail PO (item + berat Surat Jalan) untuk Inbound Tally di /tally/inbound
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, id)).all();
      // Enrich items with product info
      const enrichedItems = items.map(it => {
        const p = db.select().from(s.products).where(eq(s.products.id, it.productId)).get();
        return { ...it, product: p };
      });
      const supplier = db.select().from(s.contacts).where(eq(s.contacts.id, po.supplierId)).get();
      const dropshipCustomer = po.dropshipCustomerId ? db.select().from(s.contacts).where(eq(s.contacts.id, po.dropshipCustomerId)).get() : null;
      const grnRowsRaw = db.select().from(s.grn).where(eq(s.grn.purchaseOrderId, id)).orderBy(desc(s.grn.receivedDate)).all();
      const grnRows = grnRowsRaw.map(gr => {
        const gItems = db.select().from(s.grnItems).where(eq(s.grnItems.grnId, gr.id)).all().map(gi => ({
          ...gi, product: db.select({ name: s.products.name, sku: s.products.sku }).from(s.products).where(eq(s.products.id, gi.productId)).get(),
        }));
        const docs = db.select().from(s.grnDocuments).where(eq(s.grnDocuments.grnId, gr.id)).all().map(d => ({
          id: d.id, originalName: d.originalName, contentType: d.contentType, sizeBytes: d.sizeBytes, viewUrl: `/api/documents/${d.id}`,
        }));
        return { ...gr, items: gItems, documents: docs };
      });
      const totalPlanWeight = enrichedItems.reduce((a, it) => a + Number(it.weight || 0), 0);
      const totalReceivedWeight = enrichedItems.reduce((a, it) => a + Number(it.receivedWeight || 0), 0);
      const weightConfirmed = grnRows.length > 0 && totalReceivedWeight > 0;
      const weightVariance = weightConfirmed ? Math.round((totalReceivedWeight - totalPlanWeight) * 100) / 100 : 0;
      // Tally reconciliation: sum of inbound (re-weigh) transactions for this PO vs Surat Jalan received weight
      const tallyRows = db.select({ w: sql`coalesce(sum(${s.inventoryTransaction.totalWeight}),0)`, c: sql`count(*)` })
        .from(s.inventoryTransaction)
        .where(and(eq(s.inventoryTransaction.transactionType, 'IN'), eq(s.inventoryTransaction.referenceType, 'PO'), eq(s.inventoryTransaction.referenceId, id))).get();
      const tallyWeight = Math.round((Number(tallyRows?.w || 0)) * 100) / 100;
      const tallyCount = Number(tallyRows?.c || 0);
      const tallyDone = tallyCount > 0;
      const tallyVariance = tallyDone ? Math.round((tallyWeight - totalReceivedWeight) * 100) / 100 : 0;
      const payments = db.select().from(s.purchasePayments).where(eq(s.purchasePayments.purchaseOrderId, id)).orderBy(desc(s.purchasePayments.paymentDate)).all();
      const returns = db.select().from(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, id)).orderBy(desc(s.purchaseReturns.returnDate)).all();
      const totalReturns = returns.reduce((a, b) => a + Number(b.totalAmount || 0), 0);
      const outstanding = Number(po.totalAmount || 0) - Number(po.paidAmount || 0) - totalReturns;
      const totalTallyWeight = Math.round(enrichedItems.reduce((a, it) => a + Number(it.tallyWeight || 0), 0) * 100) / 100;
      const invoiceWeightBasis = po.invoiceWeightBasis || (po.isDropship ? 'grn' : 'shipped');
      const invoiceShippedTotal = previewPoTotal(po, enrichedItems, 'shipped');
      const invoiceTallyTotal = previewPoTotal(po, enrichedItems, 'tally');
      // Dropship: preview basis GRN PO vs Penerimaan Customer (SO) + link ke SO
      let invoiceGrnTotal = null, invoiceSoReceiptTotal = null, linkedSalesOrder = null, dropshipShipVsRecv = null;
      if (po.isDropship) {
        const soRecvMap = getSoRecvMap(po.salesOrderId);
        invoiceGrnTotal = previewPoTotal(po, enrichedItems, 'grn');
        invoiceSoReceiptTotal = previewPoTotal(po, enrichedItems, 'so_receipt', soRecvMap);
        if (po.salesOrderId) {
          linkedSalesOrder = db.select({ id: s.salesOrder.id, soNumber: s.salesOrder.soNumber, pipelineStatus: s.salesOrder.pipelineStatus })
            .from(s.salesOrder).where(eq(s.salesOrder.id, po.salesOrderId)).get() || null;
          // Susut Dropship: berat kirim (GRN/SJ) vs berat diterima customer (Penerimaan SO)
          const shippedW = totalReceivedWeight; // GRN = Surat Jalan SO
          const custRecvW = Object.values(soRecvMap).reduce((a, b) => a + Number(b || 0), 0);
          const hasReceipt = db.select({ c: sql`count(*)` }).from(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.salesOrderId, po.salesOrderId)).get()?.c > 0;
          dropshipShipVsRecv = {
            shipped: Math.round(shippedW * 1000) / 1000,
            received: Math.round((hasReceipt ? custRecvW : shippedW) * 1000) / 1000,
            susut: Math.round((shippedW - (hasReceipt ? custRecvW : shippedW)) * 1000) / 1000,
            hasReceipt: !!hasReceipt,
          };
        }
      }
      // Berat tertagih per item (billedWeight) sesuai basis invoice terpilih -> dipakai PDF PO/Invoice
      {
        const eb = invoiceWeightBasis;
        const soRecvMapBill = (po.isDropship && eb === 'so_receipt') ? getSoRecvMap(po.salesOrderId) : null;
        for (const it of enrichedItems) {
          let bw;
          if (soRecvMapBill) bw = soRecvMapBill[it.productId] != null ? soRecvMapBill[it.productId] : poBillWeight(it, 'shipped');
          else bw = poBillWeight(it, eb === 'grn' ? 'shipped' : eb);
          it.billedWeight = Math.round(Number(bw || 0) * 1000) / 1000;
          it.billedBasis = eb;
        }
      }
      return json({ data: { ...po, items: enrichedItems, supplier, dropshipCustomer, grn: grnRows, payments, returns, outstanding, totalReturns, totalPlanWeight, totalReceivedWeight, totalTallyWeight, weightConfirmed, weightVariance, tallyWeight, tallyDone, tallyVariance, invoiceWeightBasis, invoiceShippedTotal, invoiceTallyTotal, invoiceGrnTotal, invoiceSoReceiptTotal, linkedSalesOrder, dropshipShipVsRecv } });
    }

    // PATCH /purchase-orders/:id - update (method locked once set)
    if (route.startsWith('/purchase-orders/') && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const existing = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!existing) return err('Not found', 404);
      if (existing.pipelineStatus === 'Selesai') return err('PO Selesai tidak dapat diubah');
      const body = await request.json();
      // Method lock: if PO already has method set, cannot change
      if (existing.method && body.method && body.method !== existing.method) return err(`Metode timbang terkunci sebagai "${existing.method}"`);
      const update = {};
      const fields = ['supplierId', 'poType', 'method', 'expectedDate', 'isDropship', 'dropshipCustomerId', 'additionalCost', 'additionalCostBearer', 'additionalCostPayMethod', 'dpAmount', 'paymentTerm', 'notes', 'invoiceNumber', 'invoiceDate', 'dueDate'];
      for (const f of fields) {
        if (body[f] !== undefined) {
          if (['expectedDate', 'invoiceDate', 'dueDate'].includes(f)) update[f] = body[f] ? new Date(body[f]) : null;
          else update[f] = body[f];
        }
      }
      if (body.orderDate) update.orderDate = new Date(body.orderDate);
      update.updatedAt = new Date();
      db.update(s.purchaseOrder).set(update).where(eq(s.purchaseOrder.id, id)).run();
      // Replace items if provided
      if (Array.isArray(body.items)) {
        db.delete(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, id)).run();
        for (const it of body.items) {
          db.insert(s.purchaseOrderItems).values({
            id: uuidv4(),
            purchaseOrderId: id,
            productId: it.productId,
            quantity: Number(it.quantity || 0),
            weight: Number(it.weight || 0),
            weightSupplier: Number(it.weightSupplier || 0),
            weightRph: Number(it.weightRph || 0),
            headSupplier: Number(it.headSupplier || 0),
            headRph: Number(it.headRph || 0),
            unitPrice: Number(it.unitPrice || 0),
          }).run();
        }
      }
      recalcPoHpp(id);
      const updated = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      return json({ data: updated });
    }

    // DELETE /purchase-orders/:id (only Draft)
    if (route.startsWith('/purchase-orders/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      if (po.pipelineStatus !== 'Draft') return err('Hanya PO Draft yang dapat dihapus');
      db.delete(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).run();
      return json({ ok: true });
    }

    // POST /purchase-orders/:id/status - transition
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'status' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const target = body.status;
      if (!PO_STATUS.includes(target)) return err('Status tidak valid');
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const allowed = PO_FLOW[po.pipelineStatus] || [];
      if (!allowed.includes(target)) return err(`Transisi ${po.pipelineStatus} -> ${target} tidak diizinkan`);
      db.update(s.purchaseOrder).set({ pipelineStatus: target, updatedAt: new Date() }).where(eq(s.purchaseOrder.id, id)).run();
      // Auto-create approval concern for PO Cancellation
      if (target === 'Dibatalkan' || target === 'Cancelled') {
        createApproval({
          concernType: 'po_cancel',
          entityType: 'PO',
          entityId: id,
          entityNumber: po.poNumber,
          title: `Pembatalan PO ${po.poNumber}`,
          description: `Purchase Order dibatalkan dari status ${po.pipelineStatus}. Total Rp ${Number(po.totalAmount || 0).toLocaleString('id-ID')}`,
          priority: Number(po.totalAmount || 0) > 10_000_000 ? 'high' : 'normal',
          amount: Number(po.totalAmount || 0),
          metadata: { previousStatus: po.pipelineStatus, poNumber: po.poNumber },
          createdBy: session.user.email,
        });
      }
      // Saat PO mencapai "Tanda Terima" (tahap invoice/siap bayar) → konsern PERSETUJUAN PEMBAYARAN untuk Akuntan.
      if (target === 'Tanda Terima') {
        createApproval({
          concernType: 'payment_approval',
          entityType: 'PO',
          entityId: id,
          entityNumber: po.poNumber,
          title: `Persetujuan Pembayaran — PO ${po.poNumber}`,
          description: `Purchase Order ${po.poNumber} telah sampai tahap Tanda Terima (siap dibayar ke supplier). Total Rp ${Number(po.totalAmount || 0).toLocaleString('id-ID')}. Menunggu persetujuan pembayaran oleh Akuntan.`,
          priority: Number(po.totalAmount || 0) > 10_000_000 ? 'high' : 'normal',
          amount: Number(po.totalAmount || 0),
          metadata: { poNumber: po.poNumber, docType: 'PO' },
          createdBy: session.user.email,
          notifyRoles: ['akuntan'],
        });
      }
      const updated = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      return json({ data: updated });
    }

    // POST /purchase-orders/:id/weighings - update per-item weighing (bulk)
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'weighings' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const body = await request.json();
      // body.items = [{ id, weightSupplier?, weightRph?, headSupplier?, headRph? }]
      if (!Array.isArray(body.items)) return err('items array required');
      for (const it of body.items) {
        const setObj = {};
        if (it.weightSupplier !== undefined) setObj.weightSupplier = Number(it.weightSupplier);
        if (it.weightRph !== undefined) setObj.weightRph = Number(it.weightRph);
        if (it.headSupplier !== undefined) setObj.headSupplier = Number(it.headSupplier);
        if (it.headRph !== undefined) setObj.headRph = Number(it.headRph);
        if (Object.keys(setObj).length > 0) db.update(s.purchaseOrderItems).set(setObj).where(eq(s.purchaseOrderItems.id, it.id)).run();
      }
      const summary = recalcPoHpp(id);
      return json({ data: { ok: true, summary } });
    }

    // POST /purchase-orders/:id/grn - create GRN
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'grn' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const body = await request.json();
      const poItems = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, id)).all();
      const bodyItems = Array.isArray(body.items) ? body.items : [];
      const recvMap = {}; const qtyMap = {};
      for (const bi of bodyItems) { if (bi.productId) { recvMap[bi.productId] = Number(bi.receivedWeight || 0); qtyMap[bi.productId] = Number(bi.receivedQuantity || 0); } }
      const totalReceived = poItems.reduce((a, it) => a + (recvMap[it.productId] != null ? recvMap[it.productId] : 0), 0);
      const g = {
        id: uuidv4(),
        grnNumber: nextGrnNumber(),
        purchaseOrderId: id,
        receivedDate: body.receivedDate ? new Date(body.receivedDate) : new Date(),
        receivedBy: body.receivedBy || session.user.name,
        sjNumber: body.sjNumber || null,
        driverName: body.driverName || null,
        vehicleNumber: body.vehicleNumber || null,
        totalReceivedWeight: totalReceived,
        notes: body.notes || null,
        status: 'confirmed',
        createdAt: new Date(),
      };
      db.insert(s.grn).values(g).run();
      // GRN line items + update PO item confirmed weight (Surat Jalan / berat dikirim)
      for (const it of poItems) {
        const hasRecv = recvMap[it.productId] != null;
        const recvW = hasRecv ? recvMap[it.productId] : Number(it.receivedWeight || 0);
        if (hasRecv) {
          db.insert(s.grnItems).values({
            id: uuidv4(), grnId: g.id, productId: it.productId,
            planWeight: Number(it.weight || 0), receivedWeight: recvW, receivedQuantity: qtyMap[it.productId] || 0,
          }).run();
          db.update(s.purchaseOrderItems).set({ receivedWeight: recvW }).where(eq(s.purchaseOrderItems.id, it.id)).run();
        }
      }
      // Recompute PO total + HPP based on the PO's chosen invoice basis (default Surat Jalan)
      const { totalAmount: poTotal } = computePoInvoice(id, po.invoiceWeightBasis);
      // Auto-transition to Tanda Terima if currently Dikirim
      if (po.pipelineStatus === 'Dikirim') {
        db.update(s.purchaseOrder).set({ pipelineStatus: 'Tanda Terima', updatedAt: new Date() }).where(eq(s.purchaseOrder.id, id)).run();
        // PO mencapai Tanda Terima via GRN → konsern Persetujuan Pembayaran untuk Akuntan.
        createApproval({
          concernType: 'payment_approval',
          entityType: 'PO',
          entityId: id,
          entityNumber: po.poNumber,
          title: `Persetujuan Pembayaran — PO ${po.poNumber}`,
          description: `Purchase Order ${po.poNumber} telah sampai tahap Tanda Terima (siap dibayar ke supplier). Total Rp ${Number(poTotal || po.totalAmount || 0).toLocaleString('id-ID')}. Menunggu persetujuan pembayaran oleh Akuntan.`,
          priority: Number(poTotal || po.totalAmount || 0) > 10_000_000 ? 'high' : 'normal',
          amount: Number(poTotal || po.totalAmount || 0),
          metadata: { poNumber: po.poNumber, docType: 'PO', via: 'grn' },
          createdBy: session.user.email,
          notifyRoles: ['akuntan'],
        });
      }
      return json({ data: { ...g, totalAmount: poTotal } }, { status: 201 });
    }

    // POST /grns/:grnId/documents - upload Surat Jalan file (multipart) -> persistent disk
    if (route.startsWith('/grns/') && path.length === 3 && path[2] === 'documents' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const grnId = path[1];
      const grnRow = db.select().from(s.grn).where(eq(s.grn.id, grnId)).get();
      if (!grnRow) return err('GRN tidak ditemukan', 404);
      let form; try { form = await request.formData(); } catch { return err('Body harus multipart/form-data', 400); }
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return err('file wajib diisi', 400);
      const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!ALLOWED.includes(file.type)) return err('Hanya PDF, JPG, PNG, atau WEBP', 400);
      const MAX = 10 * 1024 * 1024;
      if (!file.size || file.size > MAX) return err('Ukuran file maksimal 10MB', 400);
      const bytes = Buffer.from(new Uint8Array(await file.arrayBuffer()));
      const docId = uuidv4();
      const safeName = String(file.name || 'surat-jalan').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150);
      const relDir = `grn/${grnId}`;
      const uploadRoot = nodePath.join(process.cwd(), 'data', 'uploads');
      const absDir = nodePath.join(uploadRoot, relDir);
      fs.mkdirSync(absDir, { recursive: true });
      const storageKey = `${relDir}/${docId}_${safeName}`;
      fs.writeFileSync(nodePath.join(uploadRoot, storageKey), bytes);
      db.insert(s.grnDocuments).values({
        id: docId, grnId, storageKey, originalName: safeName,
        contentType: file.type, sizeBytes: file.size, createdAt: new Date(),
      }).run();
      return json({ data: { id: docId, grnId, originalName: safeName, contentType: file.type, sizeBytes: file.size, viewUrl: `/api/documents/${docId}` } }, { status: 201 });
    }

    // GET /documents/:id - serve an uploaded GRN document (authenticated)
    if (route.startsWith('/documents/') && path.length === 2 && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const doc = db.select().from(s.grnDocuments).where(eq(s.grnDocuments.id, path[1])).get();
      if (!doc) return err('Dokumen tidak ditemukan', 404);
      const abs = nodePath.join(process.cwd(), 'data', 'uploads', doc.storageKey);
      if (!fs.existsSync(abs)) return err('File tidak ditemukan di storage', 404);
      const buf = fs.readFileSync(abs);
      const disposition = (doc.contentType === 'application/pdf' || doc.contentType.startsWith('image/')) ? 'inline' : 'attachment';
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': doc.contentType,
          'Content-Length': String(doc.sizeBytes || buf.length),
          'Content-Disposition': `${disposition}; filename="${doc.originalName.replace(/"/g, '')}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // DELETE /documents/:id - remove an uploaded GRN document
    if (route.startsWith('/documents/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const doc = db.select().from(s.grnDocuments).where(eq(s.grnDocuments.id, path[1])).get();
      if (!doc) return err('Dokumen tidak ditemukan', 404);
      try { fs.unlinkSync(nodePath.join(process.cwd(), 'data', 'uploads', doc.storageKey)); } catch {}
      db.delete(s.grnDocuments).where(eq(s.grnDocuments.id, path[1])).run();
      return json({ ok: true });
    }

    // POST /purchase-orders/:id/payments - record payment
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'payments' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const body = await request.json();
      if (!body.amount || Number(body.amount) <= 0) return err('amount > 0 required');
      const p = {
        id: uuidv4(),
        purchaseOrderId: id,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
        amount: Number(body.amount),
        method: body.method || 'Transfer',
        accountCode: body.accountCode || null,
        reference: body.reference || null,
        isDp: !!body.isDp,
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.purchasePayments).values(p).run();
      // Update paid_amount + payment_status
      const paid = db.select({ sum: sql`coalesce(sum(amount),0)` }).from(s.purchasePayments).where(eq(s.purchasePayments.purchaseOrderId, id)).get();
      const totalPaid = Number(paid?.sum || 0);
      const totalReturnsRow = db.select({ sum: sql`coalesce(sum(total_amount),0)` }).from(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, id)).get();
      const totalReturns = Number(totalReturnsRow?.sum || 0);
      const netTotal = Number(po.totalAmount) - totalReturns;
      let ps = 'unpaid';
      if (totalPaid >= netTotal && netTotal > 0) ps = 'paid';
      else if (totalPaid > 0) ps = 'partial';
      const upd = { paidAmount: totalPaid, paymentStatus: ps, updatedAt: new Date() };
      // If fully paid AND status is Tanda Terima, auto move to Selesai
      if (ps === 'paid' && po.pipelineStatus === 'Tanda Terima') upd.pipelineStatus = 'Selesai';
      db.update(s.purchaseOrder).set(upd).where(eq(s.purchaseOrder.id, id)).run();
      return json({ data: p }, { status: 201 });
    }

    // POST /purchase-orders/:id/returns - create return (notif supervisor & direktur)
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'returns' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const body = await request.json();
      const r = {
        id: uuidv4(),
        returnNumber: nextReturnNumber(),
        purchaseOrderId: id,
        returnDate: body.returnDate ? new Date(body.returnDate) : new Date(),
        reason: body.reason || null,
        resolution: body.resolution || 'potong_invoice',
        totalAmount: Number(body.totalAmount || 0),
        totalWeight: Number(body.totalWeight || 0),
        status: 'open',
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.purchaseReturns).values(r).run();
      // Log notification (in-DB audit); actual send-out omitted for MVP
      // Recompute paid status based on new net total
      const paid = db.select({ sum: sql`coalesce(sum(amount),0)` }).from(s.purchasePayments).where(eq(s.purchasePayments.purchaseOrderId, id)).get();
      const totalPaid = Number(paid?.sum || 0);
      const totalReturnsRow = db.select({ sum: sql`coalesce(sum(total_amount),0)` }).from(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, id)).get();
      const totalReturns = Number(totalReturnsRow?.sum || 0);
      const netTotal = Number(po.totalAmount) - totalReturns;
      let ps = 'unpaid';
      if (totalPaid >= netTotal && netTotal > 0) ps = 'paid';
      else if (totalPaid > 0) ps = 'partial';
      db.update(s.purchaseOrder).set({ paymentStatus: ps, updatedAt: new Date() }).where(eq(s.purchaseOrder.id, id)).run();
      // Auto-create approval concern
      createApproval({
        concernType: 'purchase_return',
        entityType: 'PR',
        entityId: r.id,
        entityNumber: r.returnNumber,
        title: `Retur Pembelian ${r.returnNumber}`,
        description: `PO ${po.poNumber} · Alasan: ${r.reason || '-'} · Resolusi: ${r.resolution}`,
        priority: r.totalAmount > 5_000_000 ? 'high' : 'normal',
        amount: r.totalAmount,
        metadata: { poId: id, poNumber: po.poNumber, totalWeight: r.totalWeight },
        createdBy: session.user.email,
      });
      return json({ data: { ...r, notification: { to: ['supervisor', 'direktur'], subject: `Retur PO ${po.poNumber}` } } }, { status: 201 });
    }

    // GET /purchase-orders/:id/hpp - HPP calculation summary
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'hpp' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const itemsRaw = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, id)).all();
      // New flow when GRN (Surat Jalan) or Tally data exists -> HPP referenced from Tally
      const usesReconFlow = itemsRaw.some(it => Number(it.receivedWeight || 0) > 0 || Number(it.tallyWeight || 0) > 0);
      const basis = po.invoiceWeightBasis || 'shipped';
      if (usesReconFlow) computePoInvoice(id, basis); else recalcPoHpp(id);
      const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, id)).all();
      const rows = items.map(it => {
        const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, it.productId)).get();
        const isLB = po.poType === 'Live Bird';
        const method = po.method || 'Timbang Ulang';
        let weightBilled = it.weight, weightActual = it.weight, susut = 0;
        if (usesReconFlow) {
          const plan = Number(it.weight || 0);
          const sjW = Number(it.receivedWeight || 0) > 0 ? Number(it.receivedWeight) : plan;
          const tallyW = Number(it.tallyWeight || 0) > 0 ? Number(it.tallyWeight) : sjW;
          weightBilled = basis === 'tally' ? tallyW : sjW;
          weightActual = tallyW; // HPP references actual re-weigh (tally)
          susut = Math.round(Math.max(0, sjW - tallyW) * 100) / 100;
        } else if (isLB) {
          if (method === 'Timbang Ulang') { weightBilled = Number(it.weightRph || it.weight); weightActual = weightBilled; }
          else { weightBilled = Number(it.weightSupplier || it.weight); weightActual = Number(it.weightRph || weightBilled); }
          susut = Math.max(0, Number(it.weightSupplier || 0) - Number(it.weightRph || 0));
        }
        const itemCost = Number(it.unitPrice) * weightBilled;
        return {
          ...it, product: p,
          weightBilled, weightActual, susut,
          itemCost,
          additionalCostShare: Number(it.additionalCostShare || 0),
          hppTotal: itemCost + Number(it.additionalCostShare || 0),
          hppPerKg: Number(it.hppPerKg || 0),
        };
      });
      const totals = {
        subtotal: rows.reduce((a, b) => a + b.itemCost, 0),
        additionalCost: Number(po.additionalCost || 0),
        additionalCostBearer: po.additionalCostBearer || 'company',
        additionalCostPayMethod: po.additionalCostPayMethod || 'utang',
        totalWeightBilled: rows.reduce((a, b) => a + b.weightBilled, 0),
        totalWeightActual: rows.reduce((a, b) => a + b.weightActual, 0),
        totalSusut: rows.reduce((a, b) => a + b.susut, 0),
        totalHpp: rows.reduce((a, b) => a + b.hppTotal, 0),
        grandTotal: Number(po.totalAmount || 0),
        invoiceWeightBasis: basis,
        hppBasis: 'tally',
      };
      totals.avgHppPerKg = totals.totalWeightActual > 0 ? totals.totalHpp / totals.totalWeightActual : 0;
      return json({ data: { po, items: rows, totals } });
    }

    // POST /purchase-orders/:id/invoice - set invoice basis (Surat Jalan / Tally) & recompute total
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'invoice' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      const body = await request.json().catch(() => ({}));
      let basis;
      if (po.isDropship) basis = (body.basis === 'so_receipt') ? 'so_receipt' : 'grn';
      else basis = body.basis === 'tally' ? 'tally' : 'shipped';
      const res = computePoInvoice(id, basis);
      const upd = { invoiceWeightBasis: basis, updatedAt: new Date() };
      if (body.invoiceNumber !== undefined) upd.invoiceNumber = body.invoiceNumber || null;
      if (body.invoiceDate) upd.invoiceDate = new Date(body.invoiceDate);
      if (body.dueDate) upd.dueDate = new Date(body.dueDate);
      db.update(s.purchaseOrder).set(upd).where(eq(s.purchaseOrder.id, id)).run();
      return json({ data: { id, totalAmount: res.totalAmount, invoiceWeightBasis: basis } });
    }

    // ===================================================================== END PURCHASE

    // =====================================================================
    // SALES ORDERS (Penjualan)
    // =====================================================================
    const SO_STATUS = ['Draft', 'Confirmed', 'Packed', 'Shipped', 'Invoiced', 'Cancelled'];
    const SO_FLOW = {
      'Draft': ['Confirmed', 'Cancelled'],
      'Confirmed': ['Packed', 'Cancelled'],
      'Packed': ['Shipped', 'Cancelled'],
      'Shipped': ['Invoiced', 'Cancelled'],
      'Invoiced': [],
      'Cancelled': [],
    };
    const nextSoNumber = () => {
      const ym = new Date();
      const prefix = `SO/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const rows = db.select({ n: s.salesOrder.soNumber }).from(s.salesOrder).where(like(s.salesOrder.soNumber, `${prefix}%`)).all();
      let max = 0;
      for (const r of rows) { const suf = parseInt(String(r.n).slice(prefix.length), 10); if (!isNaN(suf) && suf > max) max = suf; }
      return `${prefix}${String(max + 1).padStart(4, '0')}`;
    };
    const nextInvoiceNumber = () => {
      const ym = new Date();
      const prefix = `INV/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.salesOrder).where(like(s.salesOrder.invoiceNumber, `${prefix}%`)).get();
      return `${prefix}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
    };
    const nextSjNumber = () => {
      const ym = new Date();
      const prefix = `SJ/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const rows = db.select({ n: s.suratJalan.sjNumber }).from(s.suratJalan).where(like(s.suratJalan.sjNumber, `${prefix}%`)).all();
      let maxNum = 0;
      for (const r of rows) {
        const n = parseInt(String(r.n).slice(prefix.length), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
      // guard terhadap tabrakan: naikkan sampai benar-benar unik
      let next = maxNum + 1;
      while (db.select({ n: s.suratJalan.sjNumber }).from(s.suratJalan).where(eq(s.suratJalan.sjNumber, `${prefix}${String(next).padStart(4, '0')}`)).get()) {
        next += 1;
      }
      return `${prefix}${String(next).padStart(4, '0')}`;
    };
    const nextSalesReturnNumber = () => {
      const ym = new Date();
      const prefix = `RET-S/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const rows = db.select({ n: s.salesReturns.returnNumber }).from(s.salesReturns).where(like(s.salesReturns.returnNumber, `${prefix}%`)).all();
      let maxNum = 0;
      for (const r of rows) {
        const suffix = String(r.n).slice(prefix.length);
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
      return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
    };
    const nextReceiptNumber = () => {
      const ym = new Date();
      const prefix = `RCP/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const rows = db.select({ n: s.salesOrderReceipts.receiptNumber }).from(s.salesOrderReceipts).where(like(s.salesOrderReceipts.receiptNumber, `${prefix}%`)).all();
      let maxNum = 0;
      for (const r of rows) {
        const suffix = String(r.n).slice(prefix.length);
        const n = parseInt(suffix, 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
      return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
    };

    const recalcSoTotals = (soId) => {
      const soRow = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
      let subtotal = 0, discountTotal = 0;
      for (const it of items) {
        const line = Number(it.unitPrice) * Number(it.weight || it.quantity || 0);
        const disc = Number(it.discount || 0);
        const st = line - disc;
        subtotal += line;
        discountTotal += disc;
        db.update(s.salesOrderItems).set({ subtotal: st }).where(eq(s.salesOrderItems.id, it.id)).run();
      }
      // Biaya kirim yang ditanggung PEMBELI ditambahkan ke total (tertagih ke pelanggan)
      const buyerShip = (soRow?.shippingBearer === 'buyer') ? Number(soRow.shippingCost || 0) : 0;
      const total = subtotal - discountTotal + buyerShip;
      db.update(s.salesOrder).set({ totalAmount: total, discountTotal, updatedAt: new Date() }).where(eq(s.salesOrder.id, soId)).run();
      return { subtotal, discountTotal, buyerShip, total };
    };

    const recomputeSoPaymentStatus = (soId) => {
      const soRow = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      const paid = db.select({ sum: sql`coalesce(sum(amount),0)` }).from(s.salesPayments).where(eq(s.salesPayments.salesOrderId, soId)).get();
      const totalPaid = Number(paid?.sum || 0);
      const retRow = db.select({ sum: sql`coalesce(sum(total_amount),0)` }).from(s.salesReturns).where(eq(s.salesReturns.salesOrderId, soId)).get();
      const totalReturns = Number(retRow?.sum || 0);
      // Customer membayar penuh nilai faktur di-up = total (harga asli) + cashback; cashback direfund terpisah.
      const billable = (soRow.markupEnabled && Number(soRow.cashbackAmount) > 0)
        ? Number(soRow.totalAmount) + Number(soRow.cashbackAmount) : Number(soRow.totalAmount);
      const netTotal = billable - totalReturns;
      let ps = 'unpaid';
      if (totalPaid >= netTotal && netTotal > 0) ps = 'paid';
      else if (totalPaid > 0) ps = 'partial';
      db.update(s.salesOrder).set({ paidAmount: totalPaid, paymentStatus: ps, updatedAt: new Date() }).where(eq(s.salesOrder.id, soId)).run();
      return { totalPaid, totalReturns, netTotal, paymentStatus: ps };
    };

    // Sinkronkan GRN PO Dropship agar SAMA dengan Surat Jalan SO (berat kirim riil per produk).
    // Membuat/menimpa satu GRN "auto" per SO, lalu recompute invoice PO + majukan status PO (siap invoice).
    const syncDropshipPoGrn = (soId, userName) => {
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      if (!so || so.fulfillmentType !== 'dropship' || !so.autoPoId) return;
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, so.autoPoId)).get();
      if (!po) return;
      const soItems = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
      const shippedByProduct = {};
      for (const it of soItems) {
        const eff = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0);
        shippedByProduct[it.productId] = (shippedByProduct[it.productId] || 0) + eff;
      }
      const tag = `AUTO-SJ:${soId}`;
      // hapus GRN auto lama untuk SO ini agar tidak dobel
      const oldGrns = db.select().from(s.grn).where(and(eq(s.grn.purchaseOrderId, po.id), eq(s.grn.notes, tag))).all();
      for (const og of oldGrns) {
        db.delete(s.grnItems).where(eq(s.grnItems.grnId, og.id)).run();
        db.delete(s.grn).where(eq(s.grn.id, og.id)).run();
      }
      const poItems = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, po.id)).all();
      const grnId = uuidv4();
      const totalRecv = poItems.reduce((a, it) => a + (shippedByProduct[it.productId] || 0), 0);
      const sjRef = db.select({ n: s.suratJalan.sjNumber }).from(s.suratJalan).where(eq(s.suratJalan.salesOrderId, soId)).orderBy(desc(s.suratJalan.createdAt)).get();
      db.insert(s.grn).values({
        id: grnId, grnNumber: nextGrnNumber(), purchaseOrderId: po.id,
        receivedDate: new Date(), receivedBy: userName || 'Sistem (Auto SJ)',
        sjNumber: sjRef?.n || null, driverName: null, vehicleNumber: null,
        totalReceivedWeight: totalRecv, notes: tag, status: 'confirmed', createdAt: new Date(),
      }).run();
      for (const it of poItems) {
        const recvW = shippedByProduct[it.productId] || 0;
        db.insert(s.grnItems).values({
          id: uuidv4(), grnId, productId: it.productId,
          planWeight: Number(it.weight || 0), receivedWeight: recvW, receivedQuantity: 0,
        }).run();
        db.update(s.purchaseOrderItems).set({ receivedWeight: recvW }).where(eq(s.purchaseOrderItems.id, it.id)).run();
      }
      // hitung ulang invoice PO memakai basis dropship (default grn = Surat Jalan SO / GRN PO)
      const basis = (po.invoiceWeightBasis === 'so_receipt') ? 'so_receipt' : 'grn';
      computePoInvoice(po.id, basis);
      // 5a: majukan status PO dropship ke 'Tanda Terima' (siap invoice) jika belum
      if (!['Tanda Terima', 'Selesai', 'Dibatalkan'].includes(po.pipelineStatus)) {
        db.update(s.purchaseOrder).set({ pipelineStatus: 'Tanda Terima', updatedAt: new Date() }).where(eq(s.purchaseOrder.id, po.id)).run();
      }
    };


    // GET /sales-orders
    if (route === '/sales-orders' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const customer = url.searchParams.get('customer');
      const q = url.searchParams.get('q');
      const conds = [];
      { const ac = archivedCond(s.salesOrder, url); if (ac) conds.push(ac); }
      if (status && status !== 'all') conds.push(eq(s.salesOrder.pipelineStatus, status));
      if (customer) conds.push(eq(s.salesOrder.customerId, customer));
      if (q) conds.push(or(like(s.salesOrder.soNumber, `%${q}%`), like(s.salesOrder.invoiceNumber, `%${q}%`)));
      let query = db.select().from(s.salesOrder);
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.salesOrder.createdAt)).all();
      // Batch-load customers once (avoid N+1 contacts lookup per SO row)
      const custIds = [...new Set(rows.map(r => r.customerId).filter(Boolean))];
      const cMap = {};
      if (custIds.length) for (const c of db.select({ id: s.contacts.id, code: s.contacts.code, name: s.contacts.displayName, isSubscriber: s.contacts.isSubscriber }).from(s.contacts).where(inArray(s.contacts.id, custIds)).all()) cMap[c.id] = { code: c.code, name: c.name, isSubscriber: c.isSubscriber };
      const enriched = rows.map(r => ({ ...r, customer: cMap[r.customerId] || null }));
      return json({ data: enriched });
    }

    // POST /sales-orders
    if (route === '/sales-orders' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.customerId || !Array.isArray(body.items) || body.items.length === 0) return err('customerId and items required');
      if (body.dropshipperId && body.dropshipperId === body.customerId) return err('Kontak yang sama tidak boleh menjadi pembeli sekaligus dropshipper dalam 1 SO');

      // Validate stock-linked items (considering reservations from other Draft SOs)
      const stockUsage = {}; // {stockId: totalWeightRequested}
      for (const it of body.items) {
        if (it.stockId) {
          const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, it.stockId)).get();
          if (!stk) return err(`Stock ${it.stockId} tidak ditemukan`);
          if (stk.status !== 'active') return err(`Stock ${stk.kodeSimpan} tidak aktif (status=${stk.status})`);
          // Compute existing reservations from OTHER draft SOs for this stock
          const otherReserved = db.select({
            w: sql`coalesce(sum(${s.salesOrderItems.weight}), 0)`,
          }).from(s.salesOrderItems)
            .innerJoin(s.salesOrder, eq(s.salesOrder.id, s.salesOrderItems.salesOrderId))
            .where(and(
              eq(s.salesOrderItems.stockCodeId, it.stockId),
              eq(s.salesOrder.pipelineStatus, 'Draft'),
            )).get();
          const reserved = Number(otherReserved?.w || 0);
          stockUsage[it.stockId] = (stockUsage[it.stockId] || 0) + Number(it.weight || 0);
          const available = Number(stk.weight || 0) - reserved;
          if (stockUsage[it.stockId] > available + 0.0001) {
            return err(`Berat ${stockUsage[it.stockId]} kg melebihi stok tersedia ${available.toFixed(2)} kg pada ${stk.kodeSimpan} (${reserved.toFixed(2)} kg sudah direservasi Draft SO lain)`);
          }
          // Auto-set productId from stock
          it.productId = stk.productId;
        }
        if (!it.productId) return err('Setiap item wajib memiliki produk atau kode simpan');
      }

      const now = new Date();
      const id = uuidv4();
      const soNumber = body.soNumber || nextSoNumber();
      const orderDate = body.orderDate ? new Date(body.orderDate) : now;
      const expectedDate = body.expectedDate ? new Date(body.expectedDate) : null;
      const row = {
        id, soNumber, customerId: body.customerId,
        orderDate, expectedDate,
        pipelineStatus: 'Draft',
        fulfillmentType: body.fulfillmentType === 'dropship' ? 'dropship' : 'stock',
        supplierId: body.fulfillmentType === 'dropship' ? (body.supplierId || null) : null,
        dpAmount: Number(body.dpAmount || 0),
        paymentTerm: body.paymentTerm || null,
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: now, updatedAt: now,
      };
      db.insert(s.salesOrder).values(row).run();
      for (const it of body.items) {
        const line = Number(it.unitPrice) * Number(it.weight || it.quantity || 0);
        const disc = Number(it.discount || 0);
        db.insert(s.salesOrderItems).values({
          id: uuidv4(), salesOrderId: id,
          productId: it.productId,
          quantity: Number(it.quantity || 0),
          weight: Number(it.weight || 0),
          unitPrice: Number(it.unitPrice || 0),
          discount: disc,
          subtotal: line - disc,
          stockCodeId: it.stockId || null,
        }).run();
      }
      recalcSoTotals(id);
      const created = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();

      // Dropship: auto-create PO (Draft, Produk Jadi) ke supplier, tertaut ke SO
      if (created.fulfillmentType === 'dropship' && body.supplierId) {
        try {
          const poId = uuidv4();
          const poNum = nextPoNumber();
          const nowP = new Date();
          db.insert(s.purchaseOrder).values({
            id: poId, poNumber: poNum, supplierId: body.supplierId,
            poType: 'Produk Jadi', method: null, orderDate: nowP, expectedDate: expectedDate,
            pipelineStatus: 'Draft', isDropship: true, dropshipCustomerId: body.customerId,
            salesOrderId: id,
            additionalCost: 0, dpAmount: 0, notes: `Auto dari SO Dropship ${soNumber}`,
            createdBy: session.user.email, createdAt: nowP, updatedAt: nowP,
          }).run();
          for (const it of body.items) {
            const buy = (it.buyPrice !== undefined && it.buyPrice !== null && it.buyPrice !== '')
              ? Number(it.buyPrice)
              : Number(it.unitPrice || 0);
            db.insert(s.purchaseOrderItems).values({
              id: uuidv4(), purchaseOrderId: poId, productId: it.productId,
              quantity: Number(it.quantity || 0), weight: Number(it.weight || 0), unitPrice: buy,
            }).run();
          }
          recalcPoHpp(poId);
          db.update(s.salesOrder).set({ autoPoId: poId, updatedAt: new Date() }).where(eq(s.salesOrder.id, id)).run();
          created.autoPoId = poId;
        } catch (e) { console.error('auto-PO failed:', e?.message || e); }
      }
      const discountTotal = body.items.reduce((a, it) => a + Number(it.discount || 0), 0);
      const grossTotal = body.items.reduce((a, it) => a + Number(it.unitPrice || 0) * Number(it.weight || it.quantity || 0), 0);
      const discountPct = grossTotal > 0 ? (discountTotal / grossTotal) * 100 : 0;
      if (discountTotal > 1_000_000 || discountPct > 10) {
        createApproval({
          concernType: 'so_large_discount',
          entityType: 'SO',
          entityId: id,
          entityNumber: soNumber,
          title: `Diskon Besar SO ${soNumber} · Rp ${Math.round(discountTotal).toLocaleString('id-ID')} (${discountPct.toFixed(2)}%)`,
          description: `Sales Order dengan diskon signifikan. Gross Rp ${Math.round(grossTotal).toLocaleString('id-ID')} · Diskon Rp ${Math.round(discountTotal).toLocaleString('id-ID')} · Net Rp ${Math.round(grossTotal - discountTotal).toLocaleString('id-ID')}`,
          priority: discountPct > 20 ? 'urgent' : discountPct > 10 ? 'high' : 'normal',
          amount: discountTotal,
          metadata: { soNumber, grossTotal, discountTotal, discountPct: Math.round(discountPct * 100) / 100 },
          createdBy: session.user.email,
        });
      }

      // Auto-create approval concern for SO price below HPP
      const belowHppItems = [];
      for (const it of body.items) {
        const hpp = getProductHpp(it.productId);
        const up = Number(it.unitPrice || 0);
        if (hpp > 0 && up > 0 && up < hpp) {
          const prod = db.select({ sku: s.products.sku, name: s.products.name }).from(s.products).where(eq(s.products.id, it.productId)).get();
          belowHppItems.push({
            productId: it.productId,
            sku: prod?.sku,
            name: prod?.name,
            unitPrice: up,
            hpp: Math.round(hpp),
            marginPerKg: Math.round(up - hpp),
            weight: Number(it.weight || 0),
          });
        }
      }
      if (belowHppItems.length > 0) {
        const totalLoss = belowHppItems.reduce((a, it) => a + (it.hpp - it.unitPrice) * it.weight, 0);
        createApproval({
          concernType: 'so_price_below_hpp',
          entityType: 'SO',
          entityId: id,
          entityNumber: soNumber,
          title: `Harga SO ${soNumber} di bawah HPP · ${belowHppItems.length} produk`,
          description: `${belowHppItems.length} produk memiliki harga jual di bawah HPP. Potensi kerugian ± Rp ${Math.round(totalLoss).toLocaleString('id-ID')}. Butuh approval Supervisor.`,
          priority: totalLoss > 5_000_000 ? 'urgent' : totalLoss > 1_000_000 ? 'high' : 'normal',
          amount: Math.round(totalLoss),
          metadata: { soNumber, items: belowHppItems, totalLoss: Math.round(totalLoss) },
          createdBy: session.user.email,
        });
      }

      // Info notification to supervisor + direktur
      const customer = db.select().from(s.contacts).where(eq(s.contacts.id, body.customerId)).get();
      const soTotal = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get()?.totalAmount || 0;
      createNotification({
        roles: ['supervisor', 'direktur'],
        type: 'info',
        category: 'so_new',
        title: `SO Baru · ${soNumber}`,
        message: `SO untuk ${customer?.displayName || 'customer'} · Total Rp ${Math.round(soTotal).toLocaleString('id-ID')} · dibuat oleh ${session.user.name || session.user.email}.`,
        entityType: 'SO', entityId: id, entityNumber: soNumber,
        linkPath: `/dashboard/sales-orders/${id}`,
      });

      // Dropshipper: auto-buat catatan komisi (tersimpan terpisah, SO tidak diubah)
      let commissionResult = null;
      if (body.dropshipperId) {
        try {
          if (body.dropshipperId === body.customerId) throw new Error('same-as-buyer');
          const ds = db.select().from(s.contacts).where(eq(s.contacts.id, body.dropshipperId)).get();
          if (ds && (ds.isDropshipper || ds.contactType === 'Dropshipper')) {
            const type = body.commissionType || ds.commissionType || 'per_kg';
            const value = body.commissionValue !== undefined && body.commissionValue !== null && body.commissionValue !== ''
              ? Number(body.commissionValue) : Number(ds.commissionValue || 0);
            const calc = computeSoCommission(id, type, value, body.commissionCost);
            if (calc) {
              const recId = uuidv4();
              db.insert(s.commissionRecords).values({
                id: recId, dropshipperId: body.dropshipperId, salesOrderId: id, soNumber,
                commissionType: type, commissionValue: value,
                basisAmount: calc.basis, revenueAmount: calc.revenue, costAmount: calc.cost,
                commissionAmount: calc.amount, status: 'unpaid',
                notes: `Auto dari pembuatan SO ${soNumber}`, createdBy: session.user.email, createdAt: now,
              }).run();
              commissionResult = { id: recId, dropshipperId: body.dropshipperId, ...calc };
            }
          }
        } catch (e) { console.error('commission auto-create failed:', e?.message || e); }
      }

      return json({ data: created, commission: commissionResult }, { status: 201 });
    }

    // GET /sales-orders/:id
    if (route.startsWith('/sales-orders/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
      const enrichedItems = items.map(it => {
        const product = db.select().from(s.products).where(eq(s.products.id, it.productId)).get();
        let stock = null;
        if (it.stockCodeId) {
          const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, it.stockCodeId)).get();
          if (stk) {
            const cs = stk.coldStorageId ? db.select().from(s.coldStorages).where(eq(s.coldStorages.id, stk.coldStorageId)).get() : null;
            const zone = stk.zoneId ? db.select().from(s.zones).where(eq(s.zones.id, stk.zoneId)).get() : null;
            stock = { id: stk.id, kodeSimpan: stk.kodeSimpan, weight: stk.weight, status: stk.status, expiredDate: stk.expiredDate, coldStorage: cs ? { code: cs.code, name: cs.name } : null, zone: zone ? { code: zone.code, name: zone.name } : null };
          }
        }
        return { ...it, product, stock };
      });
      // Alokasi kode simpan per item (Fase B) + COGS per item
      let cogsTotal = 0;
      for (const it of enrichedItems) {
        const allocs = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.soItemId, it.id)).all();
        it.allocations = allocs;
        it.allocatedWeight = Math.round(allocs.reduce((a, b) => a + Number(b.weight || 0), 0) * 100) / 100;
        it.allocatedQty = allocs.reduce((a, b) => a + Number(b.quantity || 0), 0);
        it.cogs = Math.round(allocs.reduce((a, b) => a + Number(b.hppPerKg || 0) * Number(b.weight || 0), 0));
        it.hppAvgPerKg = it.allocatedWeight > 0 ? Math.round(it.cogs / it.allocatedWeight) : 0;
        cogsTotal += it.cogs;
      }
      // Dropship: COGS = HPP PO Dropship (biaya beli ke supplier), bukan alokasi stok gudang
      if (so.fulfillmentType === 'dropship' && so.autoPoId) {
        const poRow = db.select({ total: s.purchaseOrder.totalAmount }).from(s.purchaseOrder).where(eq(s.purchaseOrder.id, so.autoPoId)).get();
        const poItems = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, so.autoPoId)).all();
        const poHppByProduct = {};
        for (const pit of poItems) poHppByProduct[pit.productId] = Number(pit.hppPerKg || 0);
        for (const it of enrichedItems) {
          const w = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0);
          const hpp = poHppByProduct[it.productId] || 0;
          it.cogs = Math.round(hpp * w);
          it.hppAvgPerKg = Math.round(hpp);
        }
        cogsTotal = Number(poRow?.total || enrichedItems.reduce((a, it) => a + Number(it.cogs || 0), 0));
      }
      const customer = db.select().from(s.contacts).where(eq(s.contacts.id, so.customerId)).get();
      const sjRows = db.select().from(s.suratJalan).where(eq(s.suratJalan.salesOrderId, id)).orderBy(desc(s.suratJalan.deliveryDate)).all();
      const payments = db.select().from(s.salesPayments).where(eq(s.salesPayments.salesOrderId, id)).orderBy(desc(s.salesPayments.paymentDate)).all();
      const returns = db.select().from(s.salesReturns).where(eq(s.salesReturns.salesOrderId, id)).orderBy(desc(s.salesReturns.returnDate)).all();
      const receiptRows = db.select().from(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.salesOrderId, id)).orderBy(desc(s.salesOrderReceipts.receivedDate)).all();
      const receipts = receiptRows.map(r => {
        const rItems = db.select().from(s.salesOrderReceiptItems).where(eq(s.salesOrderReceiptItems.receiptId, r.id)).all();
        const itemsWithProduct = rItems.map(li => {
          const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, li.productId)).get();
          return { ...li, product: p };
        });
        return { ...r, items: itemsWithProduct };
      });
      const totalReturns = returns.reduce((a, b) => a + Number(b.totalAmount || 0), 0);
      const totalShrinkageValue = receipts.reduce((a, b) => a + Number(b.totalShrinkageValue || 0), 0);
      const totalShrinkageWeight = receipts.reduce((a, b) => a + Number(b.totalShrinkageWeight || 0), 0);
      // Faktur di-up (cashback): customer bayar penuh di-up (= total asli + cashback); cashback direfund sbg kas keluar.
      // Pendapatan (bruto) = di-up; net (riil) = total asli. Laba pakai nilai riil.
      const cashbackAmt = (so.markupEnabled && Number(so.cashbackAmount) > 0) ? Number(so.cashbackAmount) : 0;
      const diupTotal = Number(so.totalAmount) + cashbackAmt;
      const outstanding = diupTotal - Number(so.paidAmount || 0) - totalReturns;
      const shippingCost = Number(so.shippingCost || 0);
      const buyerShipping = (so.shippingBearer === 'buyer') ? shippingCost : 0;   // ditambahkan ke tagihan pelanggan
      const sellerShipping = (so.shippingBearer === 'buyer') ? 0 : shippingCost;  // ditanggung penjual -> kurangi laba
      const revenue = diupTotal;                                         // pendapatan bruto (faktur di-up, sudah termasuk ongkir pembeli)
      const netRevenue = Number(so.totalAmount || 0);                    // total tagihan riil (termasuk ongkir pembeli)
      const goodsRevenue = netRevenue - buyerShipping;                   // pendapatan barang saja (ongkir pembeli netral thd margin)
      const grossProfit = Math.round(goodsRevenue - cogsTotal - sellerShipping);
      const grossMarginPct = goodsRevenue > 0 ? Math.round((grossProfit / goodsRevenue) * 1000) / 10 : 0;
      const allAllocated = enrichedItems.length > 0 && enrichedItems.every(it => Number(it.allocatedWeight || 0) > 0);
      // Susut Dropship: selisih berat kirim (Surat Jalan) vs berat diterima customer (Penerimaan)
      let dropshipShipVsRecv = null;
      if (so.fulfillmentType === 'dropship') {
        const shippedW = enrichedItems.reduce((a, it) => a + (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0)), 0);
        let receivedW = 0, hasReceipt = false;
        for (const r of receipts) for (const li of (r.items || [])) { receivedW += Number(li.receivedWeight || 0); hasReceipt = true; }
        const effReceived = hasReceipt ? receivedW : shippedW;
        dropshipShipVsRecv = {
          shipped: Math.round(shippedW * 1000) / 1000,
          received: Math.round(effReceived * 1000) / 1000,
          susut: Math.round((shippedW - effReceived) * 1000) / 1000,
          hasReceipt,
        };
      }
      // Link ke PO Dropship terkait (klik langsung pindah)
      let linkedPurchaseOrder = null;
      if (so.fulfillmentType === 'dropship' && so.autoPoId) {
        linkedPurchaseOrder = db.select({ id: s.purchaseOrder.id, poNumber: s.purchaseOrder.poNumber, pipelineStatus: s.purchaseOrder.pipelineStatus, totalAmount: s.purchaseOrder.totalAmount, invoiceWeightBasis: s.purchaseOrder.invoiceWeightBasis })
          .from(s.purchaseOrder).where(eq(s.purchaseOrder.id, so.autoPoId)).get() || null;
      }
      // Komisi Dropshipper yang tercatat untuk SO ini (dari commission_records), diperkaya nama dropshipper.
      const commissionRows = db.select().from(s.commissionRecords).where(eq(s.commissionRecords.salesOrderId, id)).all();
      const commissions = commissionRows.map(r => {
        const dsc = db.select({ id: s.contacts.id, code: s.contacts.code, displayName: s.contacts.displayName })
          .from(s.contacts).where(eq(s.contacts.id, r.dropshipperId)).get();
        return { ...r, dropshipper: dsc || null };
      });
      return json({ data: { ...so, items: enrichedItems, customer, suratJalan: sjRows, payments, returns, receipts, outstanding, totalReturns, totalShrinkageValue, totalShrinkageWeight, cogsTotal: Math.round(cogsTotal), shippingCost, sellerShipping, buyerShipping, goodsRevenue, revenue, netRevenue, cashbackAmount: cashbackAmt, grossProfit, grossMarginPct, allAllocated, linkedPurchaseOrder, dropshipShipVsRecv, commissions } });
    }

    // GET /sales-orders/:id/available-stocks?productId= - kode simpan aktif (belum dialokasikan) utk produk
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'available-stocks' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const productId = url.searchParams.get('productId');
      if (!productId) return err('productId required');
      const rows = db.select().from(s.inventoryStock)
        .where(and(eq(s.inventoryStock.productId, productId), eq(s.inventoryStock.status, 'active'), isNull(s.inventoryStock.archivedAt))).all();
      const stockHpp = (stk) => {
        let h = Number(stk.hppPerKg || 0);
        if (stk.sourceType === 'PO' && stk.sourceBatch) {
          const it = db.select({ hpp: s.purchaseOrderItems.hppPerKg }).from(s.purchaseOrderItems)
            .where(and(eq(s.purchaseOrderItems.purchaseOrderId, stk.sourceBatch), eq(s.purchaseOrderItems.productId, stk.productId))).get();
          if (Number(it?.hpp || 0) > 0) h = Number(it.hpp);
        }
        return Math.round(h);
      };
      const out = rows.map(r => {
        const cs = r.coldStorageId ? db.select({ code: s.coldStorages.code }).from(s.coldStorages).where(eq(s.coldStorages.id, r.coldStorageId)).get() : null;
        const hppPerKg = stockHpp(r);
        return {
          id: r.id, kodeSimpan: r.kodeSimpan, weight: Number(r.weight || 0), quantity: Number(r.quantity || 0),
          packagingType: r.packagingType, expiredDate: r.expiredDate, csCode: cs?.code || null,
          hppPerKg, stockValue: Math.round(hppPerKg * Number(r.weight || 0)),
        };
      }).sort((a, b) => (a.expiredDate ? new Date(a.expiredDate).getTime() : 9e15) - (b.expiredDate ? new Date(b.expiredDate).getTime() : 9e15));
      return json({ data: out });
    }

    // POST /sales-orders/:id/items/:itemId/allocate - set kode simpan (multi) utk item, kunci stok, revisi SO
    if (route.startsWith('/sales-orders/') && path.length === 5 && path[2] === 'items' && path[4] === 'allocate' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const soId = path[1], itemId = path[3];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      if (!so) return err('SO tidak ditemukan', 404);
      if (['Invoiced', 'Cancelled'].includes(so.pipelineStatus)) return err('SO tidak dapat dialokasi pada status ini');
      const item = db.select().from(s.salesOrderItems).where(and(eq(s.salesOrderItems.id, itemId), eq(s.salesOrderItems.salesOrderId, soId))).get();
      if (!item) return err('Item tidak ditemukan', 404);
      const body = await request.json();
      const stockIds = Array.isArray(body.stockIds) ? body.stockIds : [];
      // Bebaskan alokasi lama item ini (status stok -> active), hapus baris lama
      const prev = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.soItemId, itemId)).all();
      for (const pv of prev) {
        db.update(s.inventoryStock).set({ status: 'active', updatedAt: new Date() }).where(eq(s.inventoryStock.id, pv.stockId)).run();
      }
      db.delete(s.soItemStocks).where(eq(s.soItemStocks.soItemId, itemId)).run();
      const stockHpp = (stk) => {
        let h = Number(stk.hppPerKg || 0);
        if (stk.sourceType === 'PO' && stk.sourceBatch) {
          const it = db.select({ hpp: s.purchaseOrderItems.hppPerKg }).from(s.purchaseOrderItems)
            .where(and(eq(s.purchaseOrderItems.purchaseOrderId, stk.sourceBatch), eq(s.purchaseOrderItems.productId, stk.productId))).get();
          if (Number(it?.hpp || 0) > 0) h = Number(it.hpp);
        }
        return Math.round(h);
      };
      let totW = 0, totQ = 0;
      for (const sid of stockIds) {
        const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, sid)).get();
        if (!stk) return err(`Stok ${sid} tidak ditemukan`, 404);
        if (stk.productId !== item.productId) return err(`Kode simpan ${stk.kodeSimpan} bukan produk item ini`);
        if (stk.status !== 'active') return err(`Kode simpan ${stk.kodeSimpan} sudah dialokasikan / tidak aktif`);
        const w = Number(stk.weight || 0), q = Number(stk.quantity || 0);
        db.insert(s.soItemStocks).values({
          id: uuidv4(), salesOrderId: soId, soItemId: itemId, stockId: sid, productId: stk.productId,
          kodeSimpan: stk.kodeSimpan, weight: w, quantity: q, hppPerKg: stockHpp(stk), createdAt: new Date(),
        }).run();
        db.update(s.inventoryStock).set({ status: 'allocated', updatedAt: new Date() }).where(eq(s.inventoryStock.id, sid)).run();
        totW += w; totQ += q;
      }
      // Revisi item SO mengikuti total kode simpan terpilih
      totW = Math.round(totW * 100) / 100;
      const subtotal = Math.round(Number(item.unitPrice || 0) * totW - Number(item.discount || 0));
      db.update(s.salesOrderItems).set({ weight: totW, quantity: totQ, stockCodeId: stockIds[0] || null, subtotal, outboundTallyStatus: stockIds.length > 0 ? 'final' : 'none' }).where(eq(s.salesOrderItems.id, itemId)).run();
      recalcSoTotals(soId);
      const updatedItem = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.id, itemId)).get();
      return json({ data: { item: updatedItem, allocatedWeight: totW, allocatedQty: totQ, count: stockIds.length } });
    }

    // =============================================================
    // TALLY OUTBOUND (Mobile) — operator memilih kode simpan untuk item SO.
    // Alokasi kode simpan (mengunci stok) — pengurangan stok & Kartu Stok OUT tetap
    // terjadi saat SO dikonfirmasi supervisor. Data yang diekspos operator TANPA harga.
    // =============================================================
    // GET /tally-outbound/orders — SO Draft (stok gudang) yang belum teralokasi penuh
    if (route === '/tally-outbound/orders' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const sos = db.select().from(s.salesOrder)
        .where(and(eq(s.salesOrder.pipelineStatus, 'Draft'), eq(s.salesOrder.fulfillmentType, 'stock'), isNull(s.salesOrder.archivedAt)))
        .orderBy(desc(s.salesOrder.orderDate)).all();
      const out = [];
      for (const so of sos) {
        const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, so.id)).all();
        if (items.length === 0) continue;
        let finalCount = 0, draftCount = 0, totalW = 0;
        for (const it of items) {
          const st = it.outboundTallyStatus || 'none';
          if (st === 'final') finalCount++;
          else if (st === 'draft') draftCount++;
          totalW += Number(it.weight || 0);
        }
        if (finalCount >= items.length) continue; // semua item sudah final (disimpan) -> sembunyikan
        const cust = db.select({ name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, so.customerId)).get();
        out.push({
          id: so.id, soNumber: so.soNumber, customerName: cust?.name || '-',
          orderDate: so.orderDate, itemCount: items.length, allocatedItemCount: finalCount, draftItemCount: draftCount,
          totalWeight: Math.round(totalW * 100) / 100,
        });
      }
      return json({ data: out });
    }

    // GET /tally-outbound/orders/:id — detail item + status alokasi (tanpa harga)
    if (route.startsWith('/tally-outbound/orders/') && path.length === 3 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const soId = path[2];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      if (!so) return err('SO tidak ditemukan', 404);
      const cust = db.select({ name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, so.customerId)).get();
      const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
      const outItems = items.map(it => {
        const p = db.select({ name: s.products.name, sku: s.products.sku, unit: s.products.unit }).from(s.products).where(eq(s.products.id, it.productId)).get();
        const allocs = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.soItemId, it.id)).all();
        const allocatedWeight = Math.round(allocs.reduce((a, b) => a + Number(b.weight || 0), 0) * 100) / 100;
        return {
          id: it.id, productId: it.productId, productName: p?.name || '-', sku: p?.sku || '', unit: p?.unit || 'kg',
          orderedWeight: Number(it.weight || 0), orderedQty: Number(it.quantity || 0),
          allocations: allocs.map(a => ({ stockId: a.stockId, kodeSimpan: a.kodeSimpan, weight: Number(a.weight || 0) })),
          allocatedWeight, allocated: allocs.length > 0,
          tallyStatus: it.outboundTallyStatus || 'none', // none | draft (dicatat) | final (disimpan)
        };
      });
      return json({ data: { id: so.id, soNumber: so.soNumber, customerName: cust?.name || '-', orderDate: so.orderDate, pipelineStatus: so.pipelineStatus, items: outItems } });
    }

    // GET /tally-outbound/orders/:id/items/:itemId/stocks — kode simpan tersedia + rekomendasi (berat mendekati pesanan)
    if (route.startsWith('/tally-outbound/orders/') && path.length === 6 && path[3] === 'items' && path[5] === 'stocks' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const itemId = path[4];
      const item = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.id, itemId)).get();
      if (!item) return err('Item tidak ditemukan', 404);
      const ordered = Number(item.weight || 0);
      // Stok aktif (belum dialokasikan) untuk produk item ini
      const active = db.select().from(s.inventoryStock)
        .where(and(eq(s.inventoryStock.productId, item.productId), eq(s.inventoryStock.status, 'active'), isNull(s.inventoryStock.archivedAt))).all();
      // Stok yang sedang dialokasikan ke item INI (agar tampil tercentang)
      const mine = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.soItemId, itemId)).all();
      const mineIds = new Set(mine.map(m => m.stockId));
      const minesStocks = [];
      for (const m of mine) {
        const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, m.stockId)).get();
        if (stk) minesStocks.push(stk);
      }
      const csCode = (id) => id ? (db.select({ code: s.coldStorages.code }).from(s.coldStorages).where(eq(s.coldStorages.id, id)).get()?.code || null) : null;
      const zoneCode = (id) => id ? (db.select({ code: s.zones.code }).from(s.zones).where(eq(s.zones.id, id)).get()?.code || null) : null;
      const mapStock = (r, currentlyAllocated) => ({
        id: r.id, kodeSimpan: r.kodeSimpan, weight: Number(r.weight || 0), quantity: Number(r.quantity || 0),
        csCode: csCode(r.coldStorageId), zoneCode: zoneCode(r.zoneId), expiredDate: r.expiredDate,
        diff: Math.round((Number(r.weight || 0) - ordered) * 100) / 100, currentlyAllocated,
      });
      const list = [...minesStocks.map(r => mapStock(r, true)), ...active.filter(r => !mineIds.has(r.id)).map(r => mapStock(r, false))];
      // Rekomendasi kombinasi kode simpan yang totalnya paling mendekati berat pesanan
      // (hanya di antara stok yang belum dipilih ke item ini)
      const combo = recommendStockCombo(active.filter(r => !mineIds.has(r.id)), ordered);
      const recommendedIds = Array.from(combo.ids);
      const out = list.map(x => ({ ...x, recommended: combo.ids.has(x.id) }))
        .sort((a, b) => (Number(b.recommended) - Number(a.recommended)) || (Math.abs(a.diff) - Math.abs(b.diff)));
      return json({ data: {
        orderedWeight: ordered,
        recommendedIds,
        recommendedTotal: Math.round(combo.total * 100) / 100,
        recommendedCount: recommendedIds.length,
        stocks: out,
      } });
    }

    // POST /tally-outbound/orders/:id/items/:itemId/allocate — Catat (draft) / Simpan (final) kode simpan ke item (operator)
    // body: { stockIds: [], mode: 'draft' | 'final' }
    //  - 'draft' (Catat): simpan pilihan kode simpan TANPA mengunci stok & TANPA mengubah total SO. Bisa dilanjutkan.
    //  - 'final' (Simpan): kunci stok (status=allocated) + revisi berat/subtotal item mengikuti total lot terpilih.
    if (route.startsWith('/tally-outbound/orders/') && path.length === 6 && path[3] === 'items' && path[5] === 'allocate' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const soId = path[2], itemId = path[4];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      if (!so) return err('SO tidak ditemukan', 404);
      if (so.pipelineStatus !== 'Draft') return err('SO sudah dikonfirmasi/diproses, alokasi lewat Tally hanya untuk SO Draft');
      const item = db.select().from(s.salesOrderItems).where(and(eq(s.salesOrderItems.id, itemId), eq(s.salesOrderItems.salesOrderId, soId))).get();
      if (!item) return err('Item tidak ditemukan', 404);
      const body = await request.json();
      const stockIds = Array.isArray(body.stockIds) ? body.stockIds : [];
      const mode = body.mode === 'draft' ? 'draft' : 'final';
      // Bebaskan alokasi lama item ini: set stok -> active HANYA bila tidak dipakai item/SO lain, lalu hapus baris lama
      const prev = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.soItemId, itemId)).all();
      for (const pv of prev) {
        const usedByOther = db.select({ c: sql`count(*)` }).from(s.soItemStocks)
          .where(and(eq(s.soItemStocks.stockId, pv.stockId), ne(s.soItemStocks.soItemId, itemId))).get();
        if (Number(usedByOther?.c || 0) === 0) {
          db.update(s.inventoryStock).set({ status: 'active', updatedAt: new Date() }).where(eq(s.inventoryStock.id, pv.stockId)).run();
        }
      }
      db.delete(s.soItemStocks).where(eq(s.soItemStocks.soItemId, itemId)).run();
      const stockHpp = (stk) => {
        let h = Number(stk.hppPerKg || 0);
        if (stk.sourceType === 'PO' && stk.sourceBatch) {
          const it2 = db.select({ hpp: s.purchaseOrderItems.hppPerKg }).from(s.purchaseOrderItems)
            .where(and(eq(s.purchaseOrderItems.purchaseOrderId, stk.sourceBatch), eq(s.purchaseOrderItems.productId, stk.productId))).get();
          if (Number(it2?.hpp || 0) > 0) h = Number(it2.hpp);
        }
        return Math.round(h);
      };
      let totW = 0, totQ = 0;
      for (const sid of stockIds) {
        const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, sid)).get();
        if (!stk) return err(`Stok tidak ditemukan`, 404);
        if (stk.productId !== item.productId) return err(`Kode simpan ${stk.kodeSimpan} bukan produk item ini`);
        if (stk.status !== 'active') return err(`Kode simpan ${stk.kodeSimpan} sudah dialokasikan / tidak aktif`);
        const w = Number(stk.weight || 0), q = Number(stk.quantity || 0);
        db.insert(s.soItemStocks).values({
          id: uuidv4(), salesOrderId: soId, soItemId: itemId, stockId: sid, productId: stk.productId,
          kodeSimpan: stk.kodeSimpan, weight: w, quantity: q, hppPerKg: stockHpp(stk), createdAt: new Date(),
        }).run();
        // Kunci stok HANYA saat final (Simpan). Draft (Catat) tidak mengunci.
        if (mode === 'final') {
          db.update(s.inventoryStock).set({ status: 'allocated', updatedAt: new Date() }).where(eq(s.inventoryStock.id, sid)).run();
        }
        totW += w; totQ += q;
      }
      totW = Math.round(totW * 100) / 100;
      if (mode === 'final') {
        // Simpan: revisi item mengikuti total lot terpilih + hitung ulang total SO
        const subtotal = Math.round(Number(item.unitPrice || 0) * totW - Number(item.discount || 0));
        db.update(s.salesOrderItems).set({
          weight: totW, quantity: totQ, stockCodeId: stockIds[0] || null, subtotal,
          outboundTallyStatus: stockIds.length > 0 ? 'final' : 'none',
        }).where(eq(s.salesOrderItems.id, itemId)).run();
        recalcSoTotals(soId);
      } else {
        // Catat (draft): simpan status draft saja. Tidak mengubah berat/subtotal/total SO, stok tidak dikunci.
        db.update(s.salesOrderItems).set({
          outboundTallyStatus: stockIds.length > 0 ? 'draft' : 'none',
        }).where(eq(s.salesOrderItems.id, itemId)).run();
      }
      return json({ data: { allocatedWeight: totW, allocatedQty: totQ, count: stockIds.length, mode } });
    }

    // PATCH /sales-orders/:id
    if (route.startsWith('/sales-orders/') && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const existing = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!existing) return err('Not found', 404);
      if (['Invoiced', 'Cancelled'].includes(existing.pipelineStatus)) return err('SO tidak dapat diubah pada status ini');
      const body = await request.json();
      const update = {};
      const fields = ['customerId', 'expectedDate', 'dpAmount', 'paymentTerm', 'notes', 'invoiceNumber', 'invoiceDate', 'dueDate', 'shippingCost', 'shippingBearer', 'shippingPayMethod', 'shippingAccountCode'];
      for (const f of fields) {
        if (body[f] !== undefined) {
          if (['expectedDate', 'invoiceDate', 'dueDate'].includes(f)) update[f] = body[f] ? new Date(body[f]) : null;
          else if (f === 'shippingCost') update[f] = Number(body[f] || 0);
          else update[f] = body[f];
        }
      }
      if (body.orderDate) update.orderDate = new Date(body.orderDate);
      update.updatedAt = new Date();
      db.update(s.salesOrder).set(update).where(eq(s.salesOrder.id, id)).run();
      if (Array.isArray(body.items)) {
        // Prevent items edit after Draft (stock already deducted on Confirm)
        if (existing.pipelineStatus !== 'Draft') return err('Items hanya dapat diubah saat status Draft');
        // Validate stock linkage (excluding this SO's current reservations)
        const stockUsage = {};
        for (const it of body.items) {
          if (it.stockId) {
            const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, it.stockId)).get();
            if (!stk) return err(`Stock ${it.stockId} tidak ditemukan`);
            if (stk.status !== 'active') return err(`Stock ${stk.kodeSimpan} tidak aktif`);
            // Reservations from OTHER draft SOs (exclude this SO)
            const otherReserved = db.select({
              w: sql`coalesce(sum(${s.salesOrderItems.weight}), 0)`,
            }).from(s.salesOrderItems)
              .innerJoin(s.salesOrder, eq(s.salesOrder.id, s.salesOrderItems.salesOrderId))
              .where(and(
                eq(s.salesOrderItems.stockCodeId, it.stockId),
                eq(s.salesOrder.pipelineStatus, 'Draft'),
                sql`${s.salesOrder.id} != ${id}`,
              )).get();
            const reserved = Number(otherReserved?.w || 0);
            stockUsage[it.stockId] = (stockUsage[it.stockId] || 0) + Number(it.weight || 0);
            const available = Number(stk.weight || 0) - reserved;
            if (stockUsage[it.stockId] > available + 0.0001) {
              return err(`Berat melebihi stok tersedia ${available.toFixed(2)} kg pada ${stk.kodeSimpan}`);
            }
            it.productId = stk.productId;
          }
          if (!it.productId) return err('Setiap item wajib memiliki produk atau kode simpan');
        }
        db.delete(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).run();
        for (const it of body.items) {
          const line = Number(it.unitPrice) * Number(it.weight || it.quantity || 0);
          const disc = Number(it.discount || 0);
          db.insert(s.salesOrderItems).values({
            id: uuidv4(), salesOrderId: id,
            productId: it.productId,
            quantity: Number(it.quantity || 0),
            weight: Number(it.weight || 0),
            unitPrice: Number(it.unitPrice || 0),
            discount: disc,
            subtotal: line - disc,
            stockCodeId: it.stockId || null,
          }).run();
        }
      }
      recalcSoTotals(id);
      const updated = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      return json({ data: updated });
    }

    // DELETE /sales-orders/:id
    if (route.startsWith('/sales-orders/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      if (so.pipelineStatus !== 'Draft') return err('Hanya SO Draft yang dapat dihapus');
      db.delete(s.salesOrder).where(eq(s.salesOrder.id, id)).run();
      return json({ ok: true });
    }

    // POST /sales-orders/:id/status - transition
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'status' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const target = body.status;
      if (!SO_STATUS.includes(target)) return err('Status tidak valid');
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const allowed = SO_FLOW[so.pipelineStatus] || [];
      if (!allowed.includes(target)) return err(`Transisi ${so.pipelineStatus} -> ${target} tidak diizinkan`);
      const upd = { pipelineStatus: target, updatedAt: new Date() };
      // On Confirmed: konsumsi kode simpan yang dialokasikan (Fase B)
      if (target === 'Confirmed') {
        const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
        const isDropship = so.fulfillmentType === 'dropship';
        let totalW = 0, totalQ = 0;
        for (const it of items) {
          totalW += Number(it.weight || 0);
          totalQ += Number(it.quantity || 0);
          if (isDropship) continue;
          const allocs = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.soItemId, it.id)).all();
          if ((it.outboundTallyStatus || 'none') === 'draft') {
            const prod = db.select({ name: s.products.name }).from(s.products).where(eq(s.products.id, it.productId)).get();
            return err(`Item "${prod?.name || it.productId}" masih Draft (baru dicatat). Tekan "Simpan" untuk finalisasi kode simpan sebelum SO dikonfirmasi.`);
          }
          if (allocs.length === 0) {
            const prod = db.select({ name: s.products.name }).from(s.products).where(eq(s.products.id, it.productId)).get();
            return err(`Item "${prod?.name || it.productId}" belum dipilih kode simpannya. Alokasikan kode simpan dulu.`);
          }
          for (const al of allocs) {
            // Kode simpan dikonsumsi penuh (whole storage unit)
            const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, al.stockId)).get();
            recordLedger(db, {
              ledgerDate: new Date(),
              productId: al.productId || it.productId,
              coldStorageId: stk?.coldStorageId || null,
              zoneId: stk?.zoneId || null,
              movementType: 'OUT',
              referenceType: 'SO',
              referenceId: id,
              referenceNumber: so.soNumber,
              weightOut: Number(stk?.weight || al.weight || 0),
              qtyOut: Number(stk?.quantity || al.quantity || 0),
              hppPerKg: Number(stk?.hppPerKg || al.hppPerKg || 0),
              kodeSimpan: al.kodeSimpan || stk?.kodeSimpan || null,
              stockId: al.stockId,
              createdBy: session.user.email,
            });
            db.update(s.inventoryStock)
              .set({ status: 'used', updatedAt: new Date() })
              .where(eq(s.inventoryStock.id, al.stockId))
              .run();
          }
        }
        // Log ONE aggregate transaction for this SO
        db.insert(s.inventoryTransaction).values({
          id: uuidv4(),
          transactionDate: new Date(),
          transactionType: 'OUT',
          referenceId: id,
          referenceType: 'SO',
          totalWeight: totalW,
          totalQuantity: totalQ,
          notes: `Auto-deduction on SO confirm: ${so.soNumber}`,
          createdBy: session.user.email,
        }).run();
        // If subscriber, deduct prepaid balance for subtotal
        const cust = db.select().from(s.contacts).where(eq(s.contacts.id, so.customerId)).get();
        if (cust?.isSubscriber) {
          const newBal = Math.max(0, Number(cust.prepaidBalance || 0) - Number(so.totalAmount || 0));
          db.update(s.contacts).set({ prepaidBalance: newBal, updatedAt: new Date() }).where(eq(s.contacts.id, cust.id)).run();
        }
      }
      // On Invoiced: pilih basis berat (shipped/received) & recompute total, lalu auto-generate invoice
      if (target === 'Invoiced') {
        const basis = body.invoiceWeightBasis === 'received' ? 'received' : 'shipped';
        upd.invoiceWeightBasis = basis;
        const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
        // received per produk dari Receipts (auto), untuk basis 'received'
        let recvByProduct = {};
        if (basis === 'received') {
          const recs = db.select().from(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.salesOrderId, id)).all();
          for (const rc of recs) {
            const ri = db.select().from(s.salesOrderReceiptItems).where(eq(s.salesOrderReceiptItems.receiptId, rc.id)).all();
            for (const li of ri) recvByProduct[li.productId] = (recvByProduct[li.productId] || 0) + Number(li.receivedWeight || 0);
          }
        }
        let subtotal = 0, discountTotal = 0;
        for (const it of items) {
          let w;
          if (basis === 'received') {
            w = Number(it.receivedWeight || 0);
            if (!w && recvByProduct[it.productId] !== undefined) w = recvByProduct[it.productId]; // auto dari receipts
            if (!w) w = Number(it.shippedWeight || it.weight || 0);
            if (Number(it.receivedWeight || 0) === 0) db.update(s.salesOrderItems).set({ receivedWeight: w }).where(eq(s.salesOrderItems.id, it.id)).run();
          } else {
            w = Number(it.shippedWeight || it.weight || 0);
          }
          const line = Number(it.unitPrice) * w;
          const disc = Number(it.discount || 0);
          subtotal += line; discountTotal += disc;
          db.update(s.salesOrderItems).set({ subtotal: line - disc }).where(eq(s.salesOrderItems.id, it.id)).run();
        }
        upd.totalAmount = subtotal - discountTotal + ((so.shippingBearer === 'buyer') ? Number(so.shippingCost || 0) : 0);
        upd.discountTotal = discountTotal;
        if (!so.invoiceNumber) upd.invoiceNumber = nextInvoiceNumber();
        if (!so.invoiceDate) upd.invoiceDate = new Date();
        if (!so.dueDate && so.paymentTerm && /TOP (\d+)/.test(so.paymentTerm)) {
          const days = Number(so.paymentTerm.match(/TOP (\d+)/)[1]);
          upd.dueDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        }
      }
      db.update(s.salesOrder).set(upd).where(eq(s.salesOrder.id, id)).run();
      // Auto-create approval concern for SO Cancellation
      if (target === 'Cancelled') {
        // Bebaskan semua kode simpan milik SO ini kembali ke 'active'. Termasuk yang sudah DIKONSUMSI
        // (status 'used' saat SO Confirm/Packed/Shipped) — bukan hanya yang masih 'allocated'.
        // Untuk stok yang sudah 'used', balik juga Kartu Stok dengan entri IN reversal agar saldo benar.
        const allocs = db.select().from(s.soItemStocks).where(eq(s.soItemStocks.salesOrderId, id)).all();
        let restoredW = 0, restoredQ = 0, restoredCount = 0;
        for (const al of allocs) {
          const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, al.stockId)).get();
          if (!stk || (stk.status !== 'allocated' && stk.status !== 'used')) continue;
          const wasUsed = stk.status === 'used';
          db.update(s.inventoryStock).set({ status: 'active', updatedAt: new Date() }).where(eq(s.inventoryStock.id, al.stockId)).run();
          restoredCount++;
          if (wasUsed) {
            const w = Number(stk.weight || al.weight || 0);
            const q = Number(stk.quantity || al.quantity || 0);
            restoredW += w; restoredQ += q;
            recordLedger(db, {
              ledgerDate: new Date(),
              productId: al.productId || stk.productId,
              coldStorageId: stk.coldStorageId || null,
              zoneId: stk.zoneId || null,
              movementType: 'IN',
              referenceType: 'SO',
              referenceId: id,
              referenceNumber: so.soNumber,
              weightIn: w,
              qtyIn: q,
              hppPerKg: Number(stk.hppPerKg || al.hppPerKg || 0),
              kodeSimpan: al.kodeSimpan || stk.kodeSimpan || null,
              stockId: al.stockId,
              notes: `Reversal — pembatalan SO ${so.soNumber}`,
              createdBy: session.user.email,
            });
          }
        }
        // Aggregate transaction IN reversal (hanya jika ada stok yang benar-benar dikembalikan dari 'used')
        if (restoredW > 0 || restoredQ > 0) {
          db.insert(s.inventoryTransaction).values({
            id: uuidv4(),
            transactionDate: new Date(),
            transactionType: 'IN',
            referenceId: id,
            referenceType: 'SO',
            totalWeight: restoredW,
            totalQuantity: restoredQ,
            notes: `Reversal stok — pembatalan SO ${so.soNumber} (${restoredCount} kode simpan)`,
            createdBy: session.user.email,
          }).run();
        }
        createApproval({
          concernType: 'so_cancel',
          entityType: 'SO',
          entityId: id,
          entityNumber: so.soNumber,
          title: `Pembatalan SO ${so.soNumber}`,
          description: `Sales Order dibatalkan dari status ${so.pipelineStatus}. Total Rp ${Number(so.totalAmount || 0).toLocaleString('id-ID')}`,
          priority: Number(so.totalAmount || 0) > 10_000_000 ? 'high' : 'normal',
          amount: Number(so.totalAmount || 0),
          metadata: { previousStatus: so.pipelineStatus, soNumber: so.soNumber },
          createdBy: session.user.email,
        });
      }
      // Concern (Supervisor) when SO enters shipping stage
      if (target === 'Shipped') {
        createApproval({
          concernType: 'so_shipping',
          entityType: 'SO',
          entityId: id,
          entityNumber: so.soNumber,
          title: `SO ${so.soNumber} sedang Pengiriman`,
          description: `Sales Order ${so.soNumber} beralih ke status Shipped. Total Rp ${Number(so.totalAmount || 0).toLocaleString('id-ID')}. Concern Supervisor untuk memastikan proses pengiriman on-track.`,
          priority: 'normal',
          amount: Number(so.totalAmount || 0),
          metadata: { previousStatus: so.pipelineStatus, soNumber: so.soNumber, stage: 'shipping' },
          createdBy: session.user.email,
        });
      }
      const updated = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      // Saat SO menjadi Invoiced → buat konsern PERSETUJUAN PEMBAYARAN untuk role Akuntan.
      // Akuntan akan memvalidasi/approve pembayaran; setelah approve, Supervisor & Direktur diberi notifikasi.
      if (target === 'Invoiced') {
        createApproval({
          concernType: 'payment_approval',
          entityType: 'SO',
          entityId: id,
          entityNumber: updated?.invoiceNumber || so.soNumber,
          title: `Persetujuan Pembayaran — Invoice ${updated?.invoiceNumber || so.soNumber}`,
          description: `Sales Order ${so.soNumber} telah di-invoice (${updated?.invoiceNumber || '-'}). Total tagihan Rp ${Number(updated?.totalAmount || 0).toLocaleString('id-ID')}. Menunggu persetujuan pembayaran oleh Akuntan.`,
          priority: Number(updated?.totalAmount || 0) > 10_000_000 ? 'high' : 'normal',
          amount: Number(updated?.totalAmount || 0),
          metadata: { soNumber: so.soNumber, invoiceNumber: updated?.invoiceNumber || null, docType: 'SO' },
          createdBy: session.user.email,
          notifyRoles: ['akuntan'],
        });
      }
      return json({ data: updated });
    }

    // POST /sales-orders/:id/surat-jalan
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'surat-jalan' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const body = await request.json();
      // Tujuan pengiriman: bisa ke pelanggan akhir milik Agen/Dropshipper
      let shipTo = { shipToCustomerId: null, shipToName: null, shipToPhone: null, shipToAddress: null };
      if (body.shipToCustomerId) {
        const cc = db.select().from(s.contactCustomers).where(eq(s.contactCustomers.id, body.shipToCustomerId)).get();
        if (cc) {
          shipTo = { shipToCustomerId: cc.id, shipToName: cc.name, shipToPhone: cc.phone || null, shipToAddress: cc.address || null };
        }
      } else if (body.shipToName || body.shipToAddress) {
        shipTo = { shipToCustomerId: null, shipToName: body.shipToName || null, shipToPhone: body.shipToPhone || null, shipToAddress: body.shipToAddress || null };
      }
      const sj = {
        id: uuidv4(),
        sjNumber: nextSjNumber(),
        salesOrderId: id,
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : new Date(),
        driverName: body.driverName || null,
        vehicleNumber: body.vehicleNumber || null,
        ...shipTo,
        showReceivedColumn: !!body.showReceivedColumn,
        notes: body.notes || null,
        status: 'confirmed',
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.suratJalan).values(sj).run();
      // Catat berat kirim RIIL per item (hari-H) ke sales_order_items
      let anyShipped = false;
      if (Array.isArray(body.items)) {
        for (const it of body.items) {
          if (it.itemId && it.shippedWeight !== undefined && it.shippedWeight !== null && it.shippedWeight !== '') {
            db.update(s.salesOrderItems).set({ shippedWeight: Number(it.shippedWeight) }).where(eq(s.salesOrderItems.id, it.itemId)).run();
            anyShipped = true;
          }
        }
      }
      // Berat kirim RIIL mempengaruhi SO (total) DAN PO dropship terkait.
      if (anyShipped) {
        // 1) Recompute SO totals memakai berat kirim riil (fallback berat pesanan bila belum diisi)
        const soItemsNow = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
        let subT = 0, discT = 0;
        for (const it of soItemsNow) {
          const eff = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || it.quantity || 0);
          const line = Number(it.unitPrice) * eff;
          const disc = Number(it.discount || 0);
          subT += line; discT += disc;
          db.update(s.salesOrderItems).set({ subtotal: line - disc }).where(eq(s.salesOrderItems.id, it.id)).run();
        }
        db.update(s.salesOrder).set({ totalAmount: subT - discT, discountTotal: discT, updatedAt: new Date() }).where(eq(s.salesOrder.id, id)).run();
        // 2) Untuk SO Dropship: sinkronkan GRN PO otomatis = berat kirim Surat Jalan (SJ SO = GRN PO), lalu recompute HPP/total PO + majukan status PO
        if (so.fulfillmentType === 'dropship' && so.autoPoId) {
          syncDropshipPoGrn(id, session.user.name);
        }
      }
      // Auto-transition Packed -> Shipped when SJ created + create Shipping concern
      if (so.pipelineStatus === 'Packed') {
        db.update(s.salesOrder).set({ pipelineStatus: 'Shipped', updatedAt: new Date() }).where(eq(s.salesOrder.id, id)).run();
        createApproval({
          concernType: 'so_shipping',
          entityType: 'SO',
          entityId: id,
          entityNumber: so.soNumber,
          title: `SO ${so.soNumber} sedang Pengiriman`,
          description: `Surat Jalan ${sj.sjNumber} diterbitkan. SO ${so.soNumber} beralih ke Shipped. Total Rp ${Number(so.totalAmount || 0).toLocaleString('id-ID')}. Concern Supervisor untuk memantau proses pengiriman.`,
          priority: 'normal',
          amount: Number(so.totalAmount || 0),
          metadata: { previousStatus: 'Packed', soNumber: so.soNumber, sjNumber: sj.sjNumber, stage: 'shipping', driverName: sj.driverName, vehicleNumber: sj.vehicleNumber },
          createdBy: session.user.email,
        });
      }
      return json({ data: sj }, { status: 201 });
    }

    // PATCH /sales-orders/:id/surat-jalan/:sjId - edit an existing Surat Jalan (delivery note).
    if (route.startsWith('/sales-orders/') && path.length === 4 && path[2] === 'surat-jalan' && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const sjId = path[3];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const existingSj = db.select().from(s.suratJalan).where(eq(s.suratJalan.id, sjId)).get();
      if (!existingSj || existingSj.salesOrderId !== id) return err('Surat Jalan tidak ditemukan', 404);
      const body = await request.json();
      const update = {};
      if (body.deliveryDate !== undefined) update.deliveryDate = body.deliveryDate ? new Date(body.deliveryDate) : null;
      if (body.driverName !== undefined) update.driverName = body.driverName || null;
      if (body.vehicleNumber !== undefined) update.vehicleNumber = body.vehicleNumber || null;
      if (body.notes !== undefined) update.notes = body.notes || null;
      if (body.showReceivedColumn !== undefined) update.showReceivedColumn = !!body.showReceivedColumn;
      // Ship-to destination (customer of an Agen/Dropshipper, manual, or reset to default).
      if (body.shipToCustomerId !== undefined || body.shipToName !== undefined || body.shipToAddress !== undefined) {
        if (body.shipToCustomerId) {
          const cc = db.select().from(s.contactCustomers).where(eq(s.contactCustomers.id, body.shipToCustomerId)).get();
          if (cc) Object.assign(update, { shipToCustomerId: cc.id, shipToName: cc.name, shipToPhone: cc.phone || null, shipToAddress: cc.address || null });
        } else if (body.shipToName || body.shipToAddress) {
          Object.assign(update, { shipToCustomerId: null, shipToName: body.shipToName || null, shipToPhone: body.shipToPhone || null, shipToAddress: body.shipToAddress || null });
        } else {
          Object.assign(update, { shipToCustomerId: null, shipToName: null, shipToPhone: null, shipToAddress: null });
        }
      }
      if (Object.keys(update).length > 0) {
        db.update(s.suratJalan).set(update).where(eq(s.suratJalan.id, sjId)).run();
      }
      // Optional: edit RIIL shipped weight per item (recompute SO totals + dropship GRN sync, same as create).
      let anyShipped = false;
      if (Array.isArray(body.items)) {
        for (const it of body.items) {
          if (it.itemId && it.shippedWeight !== undefined && it.shippedWeight !== null && it.shippedWeight !== '') {
            db.update(s.salesOrderItems).set({ shippedWeight: Number(it.shippedWeight) }).where(eq(s.salesOrderItems.id, it.itemId)).run();
            anyShipped = true;
          }
        }
      }
      if (anyShipped) {
        const soItemsNow = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
        let subT = 0, discT = 0;
        for (const it of soItemsNow) {
          const eff = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || it.quantity || 0);
          const line = Number(it.unitPrice) * eff;
          const disc = Number(it.discount || 0);
          subT += line; discT += disc;
          db.update(s.salesOrderItems).set({ subtotal: line - disc }).where(eq(s.salesOrderItems.id, it.id)).run();
        }
        db.update(s.salesOrder).set({ totalAmount: subT - discT, discountTotal: discT, updatedAt: new Date() }).where(eq(s.salesOrder.id, id)).run();
        if (so.fulfillmentType === 'dropship' && so.autoPoId) syncDropshipPoGrn(id, session.user.name);
      }
      const updated = db.select().from(s.suratJalan).where(eq(s.suratJalan.id, sjId)).get();
      return json({ data: updated });
    }


    // POST /sales-orders/:id/payments
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'payments' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const body = await request.json();
      if (!body.amount || Number(body.amount) <= 0) return err('amount > 0 required');
      const p = {
        id: uuidv4(),
        salesOrderId: id,
        paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
        amount: Number(body.amount),
        method: body.method || 'Transfer',
        accountCode: body.accountCode || null,
        reference: body.reference || null,
        isDp: !!body.isDp,
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.salesPayments).values(p).run();
      const info = recomputeSoPaymentStatus(id);
      return json({ data: p, info }, { status: 201 });
    }

    // POST /sales-orders/:id/markup - set/unset Faktur di-up + Cashback (opsional, per item)
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'markup' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const body = await request.json().catch(() => ({}));
      const enabled = !!body.markupEnabled;
      const total = Number(so.totalAmount || 0);
      const soItems = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
      // Peta harga MARKUP (di-up) per item dari body.items: [{itemId, markupUnitPrice}]. Harga jual asli = unitPrice (dari SO).
      const mkMap = {};
      if (Array.isArray(body.items)) for (const it of body.items) { if (it && it.itemId != null) mkMap[it.itemId] = it.markupUnitPrice; }

      let realAmount = total, cashback = 0, recipient = null, cashbackAccount = null;
      if (enabled) {
        cashback = 0;
        for (const it of soItems) {
          const sub = Number(it.subtotal || 0);           // subtotal baris pada harga asli (sum = total_amount = nilai riil)
          const realUnit = Number(it.unitPrice || 0);     // harga jual asli
          let mkUnit = (mkMap[it.id] !== undefined && mkMap[it.id] !== null && mkMap[it.id] !== '') ? Number(mkMap[it.id]) : realUnit;
          if (isNaN(mkUnit) || mkUnit < 0) mkUnit = 0;
          if (mkUnit + 0.001 < realUnit) return err('Harga markup tidak boleh lebih rendah dari harga jual asli pada salah satu item', 400);
          db.update(s.salesOrderItems).set({ markupUnitPrice: mkUnit }).where(eq(s.salesOrderItems.id, it.id)).run();
          const ratio = realUnit > 0 ? mkUnit / realUnit : 1; // >= 1; cashback = subtotal*(ratio-1)
          cashback += sub * (ratio - 1);
        }
        realAmount = total;                                // nilai riil = total SO (harga asli)
        cashback = Math.round(cashback * 100) / 100;
        if (!(cashback > 0)) return err('Belum ada markup — isi harga markup lebih tinggi dari harga jual asli minimal pada satu item', 400);
        recipient = body.cashbackRecipient ? String(body.cashbackRecipient).slice(0, 200) : null;
        cashbackAccount = body.cashbackAccount ? String(body.cashbackAccount).slice(0, 20) : null;
      } else {
        // reset harga markup per item
        for (const it of soItems) db.update(s.salesOrderItems).set({ markupUnitPrice: 0 }).where(eq(s.salesOrderItems.id, it.id)).run();
      }
      db.update(s.salesOrder).set({
        markupEnabled: enabled,
        realAmount: enabled ? realAmount : 0,
        cashbackAmount: enabled ? cashback : 0,
        cashbackRecipient: enabled ? recipient : null,
        cashbackAccount: enabled ? cashbackAccount : null,
        updatedAt: new Date(),
      }).where(eq(s.salesOrder.id, id)).run();
      const info = recomputeSoPaymentStatus(id);
      const updated = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      return json({ data: updated, info });
    }

    // POST /sales-orders/:id/cashback-refund — tandai cashback SUDAH dikembalikan + unggah bukti transfer (multipart).
    // Ini pencatatan OPERASIONAL (bukti transfer nyata ke PIC). Jurnal akuntansi cashback sudah otomatis saat invoice.
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'cashback-refund' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      if (!so.markupEnabled || !(Number(so.cashbackAmount) > 0)) return err('SO ini tidak punya cashback (Faktur di-up)', 400);
      let form; try { form = await request.formData(); } catch { return err('Body harus multipart/form-data', 400); }
      const file = form.get('file');
      const note = form.get('note') ? String(form.get('note')).slice(0, 500) : null;
      const refundedAt = form.get('refundedAt') ? String(form.get('refundedAt')).slice(0, 30) : new Date().toISOString().slice(0, 10);
      const set = {
        cashbackRefunded: true,
        cashbackRefundedAt: refundedAt,
        cashbackRefundNote: note,
        cashbackRefundedBy: session.user?.email || session.user?.id || null,
        updatedAt: new Date(),
      };
      // File bukti opsional
      if (file && typeof file.arrayBuffer === 'function') {
        const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!ALLOWED.includes(file.type)) return err('Bukti hanya PDF, JPG, PNG, atau WEBP', 400);
        if (!file.size || file.size > 10 * 1024 * 1024) return err('Ukuran bukti maksimal 10MB', 400);
        const bytes = Buffer.from(new Uint8Array(await file.arrayBuffer()));
        const safeName = String(file.name || 'bukti-cashback').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150);
        const relDir = `cashback/${id}`;
        const uploadRoot = nodePath.join(process.cwd(), 'data', 'uploads');
        fs.mkdirSync(nodePath.join(uploadRoot, relDir), { recursive: true });
        // hapus bukti lama bila ada
        if (so.cashbackProofKey) { try { fs.unlinkSync(nodePath.join(uploadRoot, so.cashbackProofKey)); } catch {} }
        const storageKey = `${relDir}/${uuidv4()}_${safeName}`;
        fs.writeFileSync(nodePath.join(uploadRoot, storageKey), bytes);
        set.cashbackProofKey = storageKey;
        set.cashbackProofName = safeName;
        set.cashbackProofType = file.type;
      }
      db.update(s.salesOrder).set(set).where(eq(s.salesOrder.id, id)).run();
      const updated = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      return json({ data: { id, cashbackRefunded: true, cashbackRefundedAt: refundedAt, cashbackRefundNote: note, cashbackRefundedBy: set.cashbackRefundedBy, hasProof: !!updated.cashbackProofKey, proofName: updated.cashbackProofName, proofUrl: updated.cashbackProofKey ? `/api/sales-orders/${id}/cashback-proof` : null } }, { status: 201 });
    }

    // GET /sales-orders/:id/cashback-proof — sajikan file bukti pengembalian cashback (authenticated).
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'cashback-proof' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so || !so.cashbackProofKey) return err('Bukti tidak ditemukan', 404);
      const abs = nodePath.join(process.cwd(), 'data', 'uploads', so.cashbackProofKey);
      if (!fs.existsSync(abs)) return err('File bukti tidak ditemukan di storage', 404);
      const buf = fs.readFileSync(abs);
      const ct = so.cashbackProofType || 'application/octet-stream';
      const disposition = (ct === 'application/pdf' || ct.startsWith('image/')) ? 'inline' : 'attachment';
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Content-Length': String(buf.length),
          'Content-Disposition': `${disposition}; filename="${String(so.cashbackProofName || 'bukti-cashback').replace(/"/g, '')}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // DELETE /sales-orders/:id/cashback-refund — batalkan tanda pengembalian & hapus bukti.
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'cashback-refund' && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      if (so.cashbackProofKey) { try { fs.unlinkSync(nodePath.join(process.cwd(), 'data', 'uploads', so.cashbackProofKey)); } catch {} }
      db.update(s.salesOrder).set({
        cashbackRefunded: false, cashbackRefundedAt: null, cashbackRefundNote: null, cashbackRefundedBy: null,
        cashbackProofKey: null, cashbackProofName: null, cashbackProofType: null, updatedAt: new Date(),
      }).where(eq(s.salesOrder.id, id)).run();
      return json({ ok: true });
    }


    // POST /sales-orders/:id/returns - retur penjualan (kembalikan stok ke inventory)
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'returns' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const body = await request.json();

      // Get all SO items (for lookup by soItemId → stockCodeId)
      const soItems = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
      const soItemsMap = {};
      for (const it of soItems) soItemsMap[it.id] = it;

      // Optional line-items in body: [{ soItemId, weight, quantity }]
      // If provided, restore stock; sum totalWeight & totalAmount if not given
      let restoredCount = 0;
      let sumWeight = 0;
      let sumAmount = 0;
      const restoreLogs = [];
      if (Array.isArray(body.items) && body.items.length > 0) {
        for (const ri of body.items) {
          const soIt = soItemsMap[ri.soItemId];
          if (!soIt) return err(`SO item ${ri.soItemId} tidak ditemukan pada SO ini`);
          const w = Number(ri.weight || 0);
          const q = Number(ri.quantity || 0);
          if (w <= 0 && q <= 0) continue;
          if (w > Number(soIt.weight || 0) + 0.0001) return err(`Berat retur ${w} kg melebihi berat item asal ${soIt.weight} kg`);
          sumWeight += w;
          sumAmount += Number(soIt.unitPrice || 0) * w;
          // Restore stock if item linked to stockCodeId
          if (soIt.stockCodeId) {
            const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, soIt.stockCodeId)).get();
            if (stk) {
              const newWeight = Number(stk.weight || 0) + w;
              const newQty = Number(stk.quantity || 0) + q;
              const newStatus = (stk.status === 'used' && newWeight > 0.0001) ? 'active' : stk.status;
              db.update(s.inventoryStock)
                .set({ weight: newWeight, quantity: newQty, status: newStatus, updatedAt: new Date() })
                .where(eq(s.inventoryStock.id, stk.id))
                .run();
              recordLedger(db, {
                ledgerDate: body.returnDate ? new Date(body.returnDate) : new Date(),
                productId: stk.productId,
                coldStorageId: stk.coldStorageId,
                zoneId: stk.zoneId,
                movementType: 'RETURN_IN',
                referenceType: 'SR',
                referenceId: id,
                referenceNumber: `Retur ${so.soNumber}`,
                weightIn: w,
                qtyIn: q,
                hppPerKg: Number(stk.hppPerKg || 0),
                kodeSimpan: stk.kodeSimpan,
                stockId: stk.id,
                createdBy: session.user.email,
              });
              restoredCount++;
              restoreLogs.push({ kodeSimpan: stk.kodeSimpan, weightAdded: w, newWeight, statusChanged: stk.status !== newStatus ? `${stk.status}→${newStatus}` : null });
            }
          }
        }
      }

      const r = {
        id: uuidv4(),
        returnNumber: nextSalesReturnNumber(),
        salesOrderId: id,
        returnDate: body.returnDate ? new Date(body.returnDate) : new Date(),
        reason: body.reason || null,
        resolution: body.resolution || 'potong_invoice',
        totalAmount: Number(body.totalAmount || sumAmount || 0),
        totalWeight: Number(body.totalWeight || sumWeight || 0),
        status: 'open',
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.salesReturns).values(r).run();

      // Log aggregate inventory_transaction IN
      if (r.totalWeight > 0 || restoredCount > 0) {
        db.insert(s.inventoryTransaction).values({
          id: uuidv4(),
          transactionDate: new Date(),
          transactionType: 'IN',
          referenceId: r.id,
          referenceType: 'SR', // Sales Return
          totalWeight: r.totalWeight,
          totalQuantity: 0,
          notes: `Retur Penjualan ${r.returnNumber} (SO ${so.soNumber}) - ${restoredCount} stock rows restored`,
          createdBy: session.user.email,
        }).run();
      }

      // Auto-create approval concern for supervisor + direktur
      createApproval({
        concernType: 'sales_return',
        entityType: 'SR',
        entityId: r.id,
        entityNumber: r.returnNumber,
        title: `Retur Penjualan ${r.returnNumber}`,
        description: `SO ${so.soNumber} · Alasan: ${r.reason || '-'} · Resolusi: ${r.resolution} · ${restoredCount} stok dikembalikan`,
        priority: r.totalAmount > 5_000_000 ? 'high' : 'normal',
        amount: r.totalAmount,
        metadata: { soId: id, soNumber: so.soNumber, totalWeight: r.totalWeight, restoredCount },
        createdBy: session.user.email,
      });

      recomputeSoPaymentStatus(id);
      return json({
        data: {
          ...r,
          restoredStocks: restoreLogs,
          notification: { to: ['supervisor', 'direktur'], subject: `Retur Penjualan SO ${so.soNumber}` },
        },
      }, { status: 201 });
    }

    // POST /sales-orders/:id/receipts - Catat Penerimaan Customer + Penyusutan per SO per Produk
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'receipts' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('SO tidak ditemukan', 404);
      if (!['Shipped', 'Invoiced'].includes(so.pipelineStatus)) {
        return err('Penerimaan hanya bisa dicatat setelah SO dikirim (Shipped/Invoiced)');
      }
      const body = await request.json();
      if (!Array.isArray(body.items) || body.items.length === 0) return err('items required (per produk)');

      // Aggregate SO items by productId → basis = berat KIRIM riil (shipped) bila ada, jatuh ke berat SO
      const soItems = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
      const perProduct = {};
      for (const it of soItems) {
        if (!perProduct[it.productId]) perProduct[it.productId] = { orderedWeight: 0, totalValue: 0 };
        const effW = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0);
        perProduct[it.productId].orderedWeight += effW;
        perProduct[it.productId].totalValue += effW * Number(it.unitPrice || 0);
      }
      // avgUnitPrice = totalValue / orderedWeight
      for (const pid in perProduct) {
        const p = perProduct[pid];
        p.avgUnitPrice = p.orderedWeight > 0 ? p.totalValue / p.orderedWeight : 0;
      }

      // Validate each received item and compute shrinkage
      let totalOrdered = 0, totalReceived = 0, totalShrinkage = 0, totalShrinkageValue = 0;
      const lineItems = [];
      for (const ri of body.items) {
        if (!ri.productId) return err('productId required per line');
        const pp = perProduct[ri.productId];
        if (!pp) return err(`Produk ${ri.productId} tidak ada di SO`);
        const receivedWeight = Number(ri.receivedWeight || 0);
        if (receivedWeight < 0) return err('receivedWeight tidak boleh negatif');
        // Berat terima BOLEH melebihi berat kirim (mis. penambahan berat saat pengiriman produk beku).
        // Guard typo: tolak hanya jika > 2x berat kirim. Selisih (susut/kelebihan) diproses di bawah.
        if (pp.orderedWeight > 0 && receivedWeight > pp.orderedWeight * 2 + 0.0001) {
          return err(`Berat diterima (${receivedWeight} kg) tidak wajar (> 2x berat kirim ${pp.orderedWeight} kg). Periksa kembali.`);
        }
        const shrinkageWeight = pp.orderedWeight - receivedWeight; // + susut, - kelebihan
        const shrinkagePct = pp.orderedWeight > 0 ? (shrinkageWeight / pp.orderedWeight) * 100 : 0;
        const shrinkageValue = shrinkageWeight * pp.avgUnitPrice;
        totalOrdered += pp.orderedWeight;
        totalReceived += receivedWeight;
        totalShrinkage += shrinkageWeight;
        totalShrinkageValue += shrinkageValue;
        lineItems.push({
          id: uuidv4(),
          productId: ri.productId,
          orderedWeight: pp.orderedWeight,
          receivedWeight,
          shrinkageWeight,
          shrinkagePct: Math.round(shrinkagePct * 100) / 100,
          avgUnitPrice: pp.avgUnitPrice,
          shrinkageValue: Math.round(shrinkageValue),
          notes: ri.notes || null,
        });
      }

      const totalShrinkagePct = totalOrdered > 0 ? (totalShrinkage / totalOrdered) * 100 : 0;
      const statusValue = totalShrinkage <= 0.001 ? 'received' : (totalReceived <= 0.001 ? 'rejected' : 'partial');
      const applyToInvoice = !!body.applyToInvoice;

      const rec = {
        id: uuidv4(),
        receiptNumber: nextReceiptNumber(),
        salesOrderId: id,
        receivedDate: body.receivedDate ? new Date(body.receivedDate) : new Date(),
        totalOrderedWeight: totalOrdered,
        totalReceivedWeight: totalReceived,
        totalShrinkageWeight: totalShrinkage,
        totalShrinkagePct: Math.round(totalShrinkagePct * 100) / 100,
        totalShrinkageValue: Math.round(totalShrinkageValue),
        status: statusValue,
        applyToInvoice,
        receivedBy: body.receivedBy || null,
        notes: body.notes || null,
        photoUrl: body.photoUrl || null,
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.salesOrderReceipts).values(rec).run();
      for (const li of lineItems) {
        db.insert(s.salesOrderReceiptItems).values({ ...li, receiptId: rec.id }).run();
      }

      // Auto-create approval concern if shrinkage > 5%
      if (totalShrinkagePct > 5 || totalShrinkageValue > 500_000) {
        createApproval({
          concernType: 'high_shrinkage',
          entityType: 'RCP',
          entityId: rec.id,
          entityNumber: rec.receiptNumber,
          title: `Penyusutan Tinggi ${totalShrinkagePct.toFixed(2)}% pada ${so.soNumber}`,
          description: `Penerimaan ${rec.receiptNumber} · Susut ${totalShrinkage.toFixed(2)} kg dari ${totalOrdered.toFixed(2)} kg · Nilai Rp ${Math.round(totalShrinkageValue).toLocaleString('id-ID')}${applyToInvoice ? ' · dipotong dari invoice' : ''}`,
          priority: totalShrinkagePct > 10 ? 'urgent' : 'high',
          amount: totalShrinkageValue,
          metadata: { soId: id, soNumber: so.soNumber, shrinkagePct: totalShrinkagePct, shrinkageWeight: totalShrinkage, applyToInvoice },
          createdBy: session.user.email,
        });
      }

      // Kelebihan berat (surplus) di atas toleransi +10% -> minta approval (mirror susut tinggi).
      const surplusPct = -totalShrinkagePct;                    // positif bila terima > kirim
      const surplusValueTotal = Math.max(0, -totalShrinkageValue);
      if (surplusPct > 10 || surplusValueTotal > 500_000) {
        createApproval({
          concernType: 'high_surplus',
          entityType: 'RCP',
          entityId: rec.id,
          entityNumber: rec.receiptNumber,
          title: `Kelebihan Berat ${surplusPct.toFixed(2)}% pada ${so.soNumber}`,
          description: `Penerimaan ${rec.receiptNumber} · Kelebihan ${(-totalShrinkage).toFixed(2)} kg dari ${totalOrdered.toFixed(2)} kg · Nilai Rp ${Math.round(surplusValueTotal).toLocaleString('id-ID')}${applyToInvoice ? ' · ditambahkan ke invoice' : ''}`,
          priority: surplusPct > 20 ? 'urgent' : 'high',
          amount: surplusValueTotal,
          metadata: { soId: id, soNumber: so.soNumber, surplusPct, surplusWeight: -totalShrinkage, applyToInvoice },
          createdBy: session.user.email,
        });
      }

      // If applyToInvoice, treat shrinkageValue as an implicit return (potong outstanding via recompute)
      // We track this via `paymentStatus` recomputation which considers salesReturns; for MVP,
      // we auto-create a "shadow" sales return record so outstanding decreases.
      if (applyToInvoice && totalShrinkageValue > 0) {
        db.insert(s.salesReturns).values({
          id: uuidv4(),
          returnNumber: nextSalesReturnNumber(),
          salesOrderId: id,
          returnDate: rec.receivedDate,
          reason: `Penyusutan otomatis dari Penerimaan ${rec.receiptNumber}`,
          resolution: 'potong_invoice',
          totalAmount: Math.round(totalShrinkageValue),
          totalWeight: totalShrinkage,
          status: 'open',
          notes: `Auto-generated dari Receipt ${rec.receiptNumber}`,
          createdBy: session.user.email,
          createdAt: new Date(),
        }).run();
        recomputeSoPaymentStatus(id);
      }

      // Kelebihan berat (surplus) + applyToInvoice: tambahkan nilai kelebihan ke tagihan SO.
      // Pendapatan naik (SO_INV memakai total_amount); COGS TETAP pada berat kirim (so_item_stocks).
      if (applyToInvoice && totalShrinkageValue < -0.001) {
        const addVal = Math.round(-totalShrinkageValue);
        const soRow = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
        db.update(s.salesOrder).set({ totalAmount: Number(soRow.totalAmount || 0) + addVal, updatedAt: new Date() }).where(eq(s.salesOrder.id, id)).run();
        recomputeSoPaymentStatus(id);
      }

      return json({ data: { ...rec, items: lineItems } }, { status: 201 });
    }

    // GET /sales-orders/:id/receipts - list receipts
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'receipts' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const rows = db.select().from(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.salesOrderId, id)).orderBy(desc(s.salesOrderReceipts.receivedDate)).all();
      const enriched = rows.map(r => {
        const items = db.select().from(s.salesOrderReceiptItems).where(eq(s.salesOrderReceiptItems.receiptId, r.id)).all();
        const itemsWithProduct = items.map(li => {
          const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, li.productId)).get();
          return { ...li, product: p };
        });
        return { ...r, items: itemsWithProduct };
      });
      return json({ data: enriched });
    }

    // DELETE /sales-orders/:id/receipts/:receiptId - delete receipt (admin only)
    if (route.startsWith('/sales-orders/') && path.length === 4 && path[2] === 'receipts' && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const soId = path[1];
      const receiptId = path[3];
      const rec = db.select().from(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.id, receiptId)).get();
      if (!rec) return err('Receipt tidak ditemukan', 404);
      // Also remove associated shadow salesReturn if applyToInvoice was true
      if (rec.applyToInvoice) {
        db.delete(s.salesReturns).where(and(
          eq(s.salesReturns.salesOrderId, soId),
          like(s.salesReturns.notes, `Auto-generated dari Receipt ${rec.receiptNumber}%`),
        )).run();
        // Balikkan penambahan tagihan dari kelebihan berat (surplus) bila ada
        if (Number(rec.totalShrinkageValue || 0) < 0) {
          const soRow = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
          const back = Math.round(-Number(rec.totalShrinkageValue));
          db.update(s.salesOrder).set({ totalAmount: Math.max(0, Number(soRow.totalAmount || 0) - back), updatedAt: new Date() }).where(eq(s.salesOrder.id, soId)).run();
        }
      }
      db.delete(s.salesOrderReceipts).where(eq(s.salesOrderReceipts.id, receiptId)).run();
      recomputeSoPaymentStatus(soId);
      return json({ ok: true });
    }

    // =====================================================================
    // SALES REPORTS
    // =====================================================================
    if (route === '/sales-reports/daily' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const conds = [];
      // Exclude cancelled
      conds.push(sql`${s.salesOrder.pipelineStatus} != 'Cancelled'`);
      if (from) conds.push(sql`${s.salesOrder.orderDate} >= ${Math.floor(new Date(from).getTime() / 1000)}`);
      if (to) conds.push(sql`${s.salesOrder.orderDate} <= ${Math.floor(new Date(to).getTime() / 1000)}`);
      const rows = db.select({
        date: sql`date(${s.salesOrder.orderDate}, 'unixepoch')`,
        count: sql`count(*)`,
        total: sql`coalesce(sum(${s.salesOrder.totalAmount}), 0)`,
      }).from(s.salesOrder).where(and(...conds)).groupBy(sql`date(${s.salesOrder.orderDate}, 'unixepoch')`).all();
      const totalRevenue = rows.reduce((a, b) => a + Number(b.total), 0);
      const totalOrders = rows.reduce((a, b) => a + Number(b.count), 0);
      return json({ data: { rows, totalRevenue, totalOrders } });
    }

    if (route === '/sales-reports/ar-aging' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      // Get all Invoiced SOs with outstanding balance
      const invoiced = db.select().from(s.salesOrder).where(and(
        eq(s.salesOrder.pipelineStatus, 'Invoiced'),
      )).all();
      const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
      const details = [];
      const now = Date.now();
      for (const so of invoiced) {
        const returnsRow = db.select({ sum: sql`coalesce(sum(total_amount),0)` }).from(s.salesReturns).where(eq(s.salesReturns.salesOrderId, so.id)).get();
        const outstanding = Number(so.totalAmount) - Number(so.paidAmount || 0) - Number(returnsRow?.sum || 0);
        if (outstanding <= 0) continue;
        const invDate = so.invoiceDate ? new Date(so.invoiceDate).getTime() : now;
        const daysOld = Math.max(0, Math.floor((now - invDate) / (24 * 60 * 60 * 1000)));
        let bucket;
        if (daysOld <= 30) bucket = '0-30';
        else if (daysOld <= 60) bucket = '31-60';
        else if (daysOld <= 90) bucket = '61-90';
        else bucket = '90+';
        buckets[bucket] += outstanding;
        const customer = db.select({ code: s.contacts.code, name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, so.customerId)).get();
        details.push({ soId: so.id, soNumber: so.soNumber, invoiceNumber: so.invoiceNumber, invoiceDate: so.invoiceDate, dueDate: so.dueDate, outstanding, daysOld, bucket, customer });
      }
      return json({ data: { buckets, details, totalOutstanding: Object.values(buckets).reduce((a, b) => a + b, 0) } });
    }

    if (route === '/sales-reports/by-customer' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const rows = db.select({
        customerId: s.salesOrder.customerId,
        count: sql`count(*)`,
        total: sql`coalesce(sum(${s.salesOrder.totalAmount}), 0)`,
        paid: sql`coalesce(sum(${s.salesOrder.paidAmount}), 0)`,
      }).from(s.salesOrder).where(sql`${s.salesOrder.pipelineStatus} != 'Cancelled'`).groupBy(s.salesOrder.customerId).all();
      const enriched = rows.map(r => {
        const c = db.select({ code: s.contacts.code, name: s.contacts.displayName, isSubscriber: s.contacts.isSubscriber }).from(s.contacts).where(eq(s.contacts.id, r.customerId)).get();
        return { ...r, customer: c, outstanding: Number(r.total) - Number(r.paid) };
      }).sort((a, b) => Number(b.total) - Number(a.total));
      return json({ data: enriched });
    }

    if (route === '/sales-reports/by-product' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      // Join SO items with SO to filter cancelled
      const rows = db.select({
        productId: s.salesOrderItems.productId,
        totalQty: sql`coalesce(sum(${s.salesOrderItems.quantity}), 0)`,
        totalWeight: sql`coalesce(sum(${s.salesOrderItems.weight}), 0)`,
        totalRevenue: sql`coalesce(sum(${s.salesOrderItems.subtotal}), 0)`,
        orderCount: sql`count(distinct ${s.salesOrderItems.salesOrderId})`,
      }).from(s.salesOrderItems)
        .innerJoin(s.salesOrder, eq(s.salesOrder.id, s.salesOrderItems.salesOrderId))
        .where(sql`${s.salesOrder.pipelineStatus} != 'Cancelled'`)
        .groupBy(s.salesOrderItems.productId).all();
      const enriched = rows.map(r => {
        const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit, category: s.products.category }).from(s.products).where(eq(s.products.id, r.productId)).get();
        return { ...r, product: p };
      }).sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue));
      return json({ data: enriched });
    }
    // ===================================================================== END SALES

    // =====================================================================
    // WORK ORDERS (Produksi / Maklon)
    // =====================================================================
    const WO_STATUS = ['Draft', 'Disetujui', 'Dalam Proses', 'Selesai', 'Dibatalkan'];
    const WO_FLOW = {
      'Draft': ['Disetujui', 'Dibatalkan'],
      'Disetujui': ['Dalam Proses', 'Dibatalkan'],
      'Dalam Proses': ['Selesai', 'Dibatalkan'],
      'Selesai': [],
      'Dibatalkan': [],
    };
    const nextWoNumber = () => {
      const ym = new Date();
      const prefix = `WO/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.workOrder).where(like(s.workOrder.woNumber, `${prefix}%`)).get();
      return `${prefix}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
    };
    const nextKodeSimpan = () => {
      const d = new Date();
      const prefix = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const row = db.select({ c: sql`count(*)` }).from(s.inventoryStock).where(like(s.inventoryStock.kodeSimpan, `${prefix}%`)).get();
      return `${prefix}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
    };
    const recalcWoCosts = (woId) => {
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, woId)).get();
      const custom = db.select({ sum: sql`coalesce(sum(amount),0)` }).from(s.woCustomCosts).where(eq(s.woCustomCosts.workOrderId, woId)).get();
      const customCostTotal = Number(custom?.sum || 0);
      const maklonCost = wo.mode === 'Maklon' ? Number(wo.maklonRatePerKg || 0) * Number(wo.totalLiveBirdWeight || 0) : 0;
      const totalCost = Number(wo.baseCost || 0) + maklonCost + customCostTotal;
      db.update(s.workOrder).set({ maklonCost, customCostTotal, totalCost, updatedAt: new Date() }).where(eq(s.workOrder.id, woId)).run();
      return { baseCost: wo.baseCost, maklonCost, customCostTotal, totalCost };
    };
    const recalcWoOutputs = (woId) => {
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, woId)).get();
      const outputs = db.select().from(s.woOutputs).where(eq(s.woOutputs.workOrderId, woId)).all();
      const totalWeight = outputs.reduce((a, b) => a + Number(b.weight || 0), 0);
      const totalCost = Number(wo.totalCost || 0);
      const baseHpp = totalWeight > 0 ? totalCost / totalWeight : 0;
      for (const out of outputs) {
        const hppPerKg = baseHpp * Number(out.coefficient || 1);
        const hppTotal = hppPerKg * Number(out.weight || 0);
        db.update(s.woOutputs).set({ hppPerKg, hppTotal }).where(eq(s.woOutputs.id, out.id)).run();
      }
      db.update(s.workOrder).set({ totalRendemenWeight: totalWeight, updatedAt: new Date() }).where(eq(s.workOrder.id, woId)).run();
      // Validation check
      const outs = db.select().from(s.woOutputs).where(eq(s.woOutputs.workOrderId, woId)).all();
      const allocated = outs.reduce((a, b) => a + Number(b.hppTotal || 0), 0);
      return { totalCost, totalWeight, baseHpp, allocated, delta: totalCost - allocated };
    };

    // ---------- WO STAGES (Master Data) ----------
    // GET /wo-stages
    if (route === '/wo-stages' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      const url = new URL(request.url);
      const activeOnly = url.searchParams.get('active') === '1' || url.searchParams.get('activeOnly') === '1';
      const conds = [];
      if (activeOnly) conds.push(eq(s.woStages.isActive, true));
      let q = db.select().from(s.woStages);
      if (conds.length) q = q.where(and(...conds));
      const rows = q.orderBy(s.woStages.sequenceOrder, s.woStages.name).all();
      return json({ data: rows });
    }

    // GET /wo-stages/:id
    if (route.startsWith('/wo-stages/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      const row = db.select().from(s.woStages).where(eq(s.woStages.id, path[1])).get();
      if (!row) return err('Stage tidak ditemukan', 404);
      return json({ data: row });
    }

    // POST /wo-stages (admin)
    if (route === '/wo-stages' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.code || !body.name) return err('code dan name wajib', 400);
      const existing = db.select().from(s.woStages).where(eq(s.woStages.code, body.code)).get();
      if (existing) return err('Kode stage sudah dipakai', 400);
      // Validate fieldsSchema is array
      let fs = body.fieldsSchema || [];
      if (typeof fs === 'string') { try { fs = JSON.parse(fs); } catch (e) { fs = []; } }
      if (!Array.isArray(fs)) fs = [];
      const id = uuidv4();
      db.insert(s.woStages).values({
        id,
        code: body.code,
        name: body.name,
        description: body.description || null,
        sequenceOrder: Number(body.sequenceOrder || 0),
        fieldsSchema: JSON.stringify(fs),
        color: body.color || null,
        isActive: body.isActive !== false,
        createdBy: session.user.email,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run();
      return json({ data: db.select().from(s.woStages).where(eq(s.woStages.id, id)).get() }, { status: 201 });
    }

    // PUT /wo-stages/:id
    if (route.startsWith('/wo-stages/') && path.length === 2 && method === 'PUT') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const cur = db.select().from(s.woStages).where(eq(s.woStages.id, id)).get();
      if (!cur) return err('Stage tidak ditemukan', 404);
      const body = await request.json();
      const upd = { updatedAt: new Date() };
      if (body.code !== undefined && body.code !== cur.code) {
        const dup = db.select().from(s.woStages).where(and(eq(s.woStages.code, body.code), ne(s.woStages.id, id))).get();
        if (dup) return err('Kode stage sudah dipakai', 400);
        upd.code = body.code;
      }
      if (body.name !== undefined) upd.name = body.name;
      if (body.description !== undefined) upd.description = body.description;
      if (body.sequenceOrder !== undefined) upd.sequenceOrder = Number(body.sequenceOrder || 0);
      if (body.color !== undefined) upd.color = body.color;
      if (body.isActive !== undefined) upd.isActive = !!body.isActive;
      if (body.fieldsSchema !== undefined) {
        let fs = body.fieldsSchema;
        if (typeof fs === 'string') { try { fs = JSON.parse(fs); } catch (e) { fs = []; } }
        if (!Array.isArray(fs)) fs = [];
        upd.fieldsSchema = JSON.stringify(fs);
      }
      db.update(s.woStages).set(upd).where(eq(s.woStages.id, id)).run();
      return json({ data: db.select().from(s.woStages).where(eq(s.woStages.id, id)).get() });
    }

    // DELETE /wo-stages/:id
    if (route.startsWith('/wo-stages/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      const usedCount = db.select({ c: sql`count(*)` }).from(s.woStageRecords).where(eq(s.woStageRecords.stageId, id)).get()?.c || 0;
      if (Number(usedCount) > 0) return err(`Stage tidak bisa dihapus, ada ${usedCount} record terpakai. Nonaktifkan saja.`, 400);
      db.delete(s.woStages).where(eq(s.woStages.id, id)).run();
      return json({ ok: true });
    }

    // ---------- WO STAGE RECORDS (Tally per stage) ----------
    // GET /work-orders/:id/stage-records
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'stage-records' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      const woId = path[1];
      const rows = db.select().from(s.woStageRecords).where(eq(s.woStageRecords.workOrderId, woId)).orderBy(desc(s.woStageRecords.recordedAt)).all();
      // Enrich with stage details
      const stageIds = [...new Set(rows.map(r => r.stageId))];
      const stagesMap = {};
      if (stageIds.length) {
        const sts = db.select().from(s.woStages).where(inArray(s.woStages.id, stageIds)).all();
        sts.forEach(st => { stagesMap[st.id] = st; });
      }
      const enriched = rows.map(r => ({
        ...r,
        stage: stagesMap[r.stageId] || null,
        fieldValues: (() => { try { return JSON.parse(r.fieldValues || '{}'); } catch (e) { return {}; } })(),
      }));
      return json({ data: enriched });
    }

    // POST /work-orders/:id/stage-records - bulk create
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'stage-records' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      const woId = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, woId)).get();
      if (!wo) return err('Work Order tidak ditemukan', 404);
      const body = await request.json();
      const records = Array.isArray(body.records) ? body.records : (Array.isArray(body) ? body : [body]);
      if (records.length === 0) return err('Tidak ada record', 400);
      const now = new Date();
      const inserted = [];
      for (const r of records) {
        if (!r.stageId) continue;
        const stage = db.select().from(s.woStages).where(eq(s.woStages.id, r.stageId)).get();
        if (!stage) continue;
        // Validate required fields per stage schema
        let schema = [];
        try { schema = JSON.parse(stage.fieldsSchema || '[]'); } catch (e) {}
        const values = r.values || r.fieldValues || {};
        for (const f of schema) {
          if (f.required && (values[f.key] === undefined || values[f.key] === '' || values[f.key] === null)) {
            return err(`Field wajib '${f.label || f.key}' pada stage ${stage.name} belum diisi`, 400);
          }
        }
        const id = uuidv4();
        const recordedAt = r.recordedAt ? new Date(r.recordedAt) : now;
        db.insert(s.woStageRecords).values({
          id,
          workOrderId: woId,
          stageId: r.stageId,
          recordedAt,
          recordedBy: session.user.email,
          fieldValues: JSON.stringify(values),
          notes: r.notes || null,
          createdAt: now,
        }).run();
        inserted.push(id);
      }
      return json({ ok: true, inserted: inserted.length, ids: inserted }, { status: 201 });
    }

    // DELETE /work-orders/:id/stage-records/:recordId
    if (route.startsWith('/work-orders/') && path.length === 4 && path[2] === 'stage-records' && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const recordId = path[3];
      db.delete(s.woStageRecords).where(eq(s.woStageRecords.id, recordId)).run();
      return json({ ok: true });
    }

    // GET /work-orders
    if (route === '/work-orders' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const mode = url.searchParams.get('mode');
      const q = url.searchParams.get('q');
      const conds = [];
      { const ac = archivedCond(s.workOrder, url); if (ac) conds.push(ac); }
      if (status && status !== 'all') conds.push(eq(s.workOrder.pipelineStatus, status));
      if (mode && mode !== 'all') conds.push(eq(s.workOrder.mode, mode));
      if (q) conds.push(like(s.workOrder.woNumber, `%${q}%`));
      let query = db.select().from(s.workOrder);
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.workOrder.createdAt)).all();
      const enriched = rows.map(r => {
        const po = r.purchaseOrderId ? db.select({ poNumber: s.purchaseOrder.poNumber, method: s.purchaseOrder.method }).from(s.purchaseOrder).where(eq(s.purchaseOrder.id, r.purchaseOrderId)).get() : null;
        const maklon = r.maklonSupplierId ? db.select({ code: s.contacts.code, name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, r.maklonSupplierId)).get() : null;
        return { ...r, po, maklon };
      });
      return json({ data: enriched });
    }
    if (route === '/work-orders' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      const now = new Date();
      const id = uuidv4();
      const startDate = body.startDate ? new Date(body.startDate) : now;
      const row = {
        id, woNumber: body.woNumber || nextWoNumber(),
        purchaseOrderId: body.purchaseOrderId || null,
        mode: body.mode || 'Internal',
        maklonSupplierId: body.maklonSupplierId || null,
        maklonRatePerKg: Number(body.maklonRatePerKg || 0),
        startDate,
        baseCost: Number(body.baseCost || 0),
        pipelineStatus: 'Draft',
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: now, updatedAt: now,
      };
      db.insert(s.workOrder).values(row).run();
      recalcWoCosts(id);
      // Info notification to supervisor + direktur
      createNotification({
        roles: ['supervisor', 'direktur'],
        type: 'info',
        category: 'wo_new',
        title: `WO Baru · ${row.woNumber}`,
        message: `Work Order ${row.mode} dibuat oleh ${session.user.name || session.user.email}.`,
        entityType: 'WO', entityId: id, entityNumber: row.woNumber,
        linkPath: `/dashboard/work-orders/${id}`,
      });
      return json({ data: db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get() }, { status: 201 });
    }

    // GET /work-orders/pending-storage - list outputs ready to be stored
    // IMPORTANT: This must come BEFORE the generic GET /work-orders/:id route
    if (route === '/work-orders/pending-storage' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      const rows = db.select().from(s.woOutputs).where(sql`${s.woOutputs.storageStatus} IN ('pending_storage','partial')`).all();
      const enriched = rows.map(o => {
        const wo = db.select({ woNumber: s.workOrder.woNumber, mode: s.workOrder.mode, finalizedAt: s.workOrder.finalizedAt }).from(s.workOrder).where(eq(s.workOrder.id, o.workOrderId)).get();
        const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, o.productId)).get();
        return { ...o, wo, product: p, remainingWeight: Math.max(0, Number(o.weight || 0) - Number(o.storedWeight || 0)) };
      }).filter(r => r.remainingWeight > 0.001);
      return json({ data: enriched });
    }

    // GET /work-orders/:id
    if (route.startsWith('/work-orders/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      const po = wo.purchaseOrderId ? db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, wo.purchaseOrderId)).get() : null;
      const maklon = wo.maklonSupplierId ? db.select().from(s.contacts).where(eq(s.contacts.id, wo.maklonSupplierId)).get() : null;
      const stages = db.select().from(s.workOrderDetails).where(eq(s.workOrderDetails.workOrderId, id)).orderBy(s.workOrderDetails.recordedAt).all();
      const stagesWithData = stages.map(st => ({ ...st, rendemenData: st.rendemenData ? JSON.parse(st.rendemenData) : null }));
      const outputs = db.select().from(s.woOutputs).where(eq(s.woOutputs.workOrderId, id)).all();
      const outputsEnriched = outputs.map(o => ({ ...o, product: db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit, category: s.products.category, rendemenCoefficient: s.products.rendemenCoefficient }).from(s.products).where(eq(s.products.id, o.productId)).get() }));
      const customCosts = db.select().from(s.woCustomCosts).where(eq(s.woCustomCosts.workOrderId, id)).orderBy(s.woCustomCosts.createdAt).all();
      return json({ data: { ...wo, po, maklon, stages: stagesWithData, outputs: outputsEnriched, customCosts } });
    }

    // PATCH /work-orders/:id
    if (route.startsWith('/work-orders/') && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const existing = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!existing) return err('Not found', 404);
      if (existing.pipelineStatus === 'Selesai') return err('WO Selesai tidak dapat diubah');
      const body = await request.json();
      const upd = {};
      const fields = ['purchaseOrderId', 'mode', 'maklonSupplierId', 'maklonRatePerKg', 'baseCost', 'notes'];
      for (const f of fields) if (body[f] !== undefined) upd[f] = body[f];
      if (body.startDate) upd.startDate = new Date(body.startDate);
      upd.updatedAt = new Date();
      db.update(s.workOrder).set(upd).where(eq(s.workOrder.id, id)).run();
      recalcWoCosts(id);
      recalcWoOutputs(id);
      return json({ data: db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get() });
    }

    // DELETE /work-orders/:id (Draft only, admin)
    if (route.startsWith('/work-orders/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      if (wo.pipelineStatus !== 'Draft') return err('Hanya WO Draft yang dapat dihapus');
      db.delete(s.workOrder).where(eq(s.workOrder.id, id)).run();
      return json({ ok: true });
    }

    // POST /work-orders/:id/status - transition
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'status' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const target = body.status;
      if (!WO_STATUS.includes(target)) return err('Status tidak valid');
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      const allowed = WO_FLOW[wo.pipelineStatus] || [];
      if (!allowed.includes(target)) return err(`Transisi ${wo.pipelineStatus} -> ${target} tidak diizinkan`);
      const upd = { pipelineStatus: target, updatedAt: new Date() };
      if (target === 'Disetujui') { upd.approvedBy = session.user.email; upd.approvedAt = new Date(); }
      db.update(s.workOrder).set(upd).where(eq(s.workOrder.id, id)).run();
      return json({ data: db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get() });
    }

    // POST /work-orders/:id/arrival - record live bird arrival
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'arrival' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      const body = await request.json();
      const weight = Number(body.totalWeight || 0);
      const heads = Number(body.totalHeadCount || 0);
      const ekorMati = Number(body.ekorMati || 0);
      const bwAvg = heads > 0 ? weight / heads : 0;
      db.update(s.workOrder).set({
        totalLiveBirdWeight: weight,
        totalLiveBirdHeadCount: heads,
        bwAvg, ekorMati,
        arrivalRecordedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(s.workOrder.id, id)).run();
      // Log as stage record
      db.insert(s.workOrderDetails).values({
        id: uuidv4(), workOrderId: id, type: 'kedatangan', stageName: 'Kedatangan Live Bird',
        inputWeight: weight, outputWeight: weight, headCount: heads, bwAvg,
        rendemenData: JSON.stringify({ ekorMati, notes: body.notes }),
        recordedBy: session.user.email, recordedAt: new Date(),
      }).run();
      recalcWoCosts(id);
      // Ekor mati handling if linked to PO
      let ekorMatiImpact = null;
      if (wo.purchaseOrderId && ekorMati > 0) {
        const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, wo.purchaseOrderId)).get();
        if (po) {
          const impactType = po.method === 'Timbang Ulang' ? 'invoice_deduction' : 'hpp_increase';
          ekorMatiImpact = { poMethod: po.method, ekorMati, impact: impactType, note: impactType === 'invoice_deduction' ? 'Ekor mati mengurangi invoice supplier (Timbang Ulang)' : 'Ekor mati menaikkan HPP/kg (Timbang Kandang)' };
        }
      }
      return json({ data: { wo: db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get(), ekorMatiImpact } });
    }

    // POST /work-orders/:id/stage - record production stage
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'stage' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      const body = await request.json();
      // type: pemotongan | eviscerasi | karkas | boneless_parting | packing_plastik | abf | panen_abf | packing_karung
      const stageMap = {
        pemotongan: 'Stage 1 - Pemotongan',
        eviscerasi: 'Stage 2 - Eviscerasi',
        karkas: 'Stage 3 - Karkas',
        boneless_parting: 'Stage 4 - Boneless/Parting',
        packing_plastik: 'Packing Plastik',
        abf: 'ABF',
        panen_abf: 'Panen ABF',
        packing_karung: 'Packing Karung',
      };
      if (!stageMap[body.type]) return err('Stage type tidak valid');
      const stageRow = {
        id: uuidv4(), workOrderId: id, type: body.type, stageName: stageMap[body.type],
        inputWeight: Number(body.inputWeight || 0),
        outputWeight: Number(body.outputWeight || 0),
        headCount: Number(body.headCount || 0),
        bwAvg: Number(body.bwAvg || 0),
        rendemenData: body.rendemenData ? JSON.stringify(body.rendemenData) : null,
        recordedBy: session.user.email, recordedAt: new Date(),
      };
      db.insert(s.workOrderDetails).values(stageRow).run();
      return json({ data: stageRow }, { status: 201 });
    }

    // POST /work-orders/:id/outputs - upsert final outputs (with coefficient)
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'outputs' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      const body = await request.json();
      if (!Array.isArray(body.outputs)) return err('outputs array required');
      // Replace all outputs
      db.delete(s.woOutputs).where(eq(s.woOutputs.workOrderId, id)).run();
      for (const o of body.outputs) {
        if (!o.productId) continue;
        db.insert(s.woOutputs).values({
          id: uuidv4(), workOrderId: id,
          productId: o.productId,
          stage: o.stage || 'karkas',
          weight: Number(o.weight || 0),
          headCount: Number(o.headCount || 0),
          coefficient: Number(o.coefficient || 1),
          isPremium: !!o.isPremium,
          sizeGradingCode: o.sizeGradingCode || null,
          notes: o.notes || null,
        }).run();
      }
      const validation = recalcWoOutputs(id);
      return json({ data: { ok: true, validation } });
    }

    // POST /work-orders/:id/costs - add custom cost
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'costs' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      const body = await request.json();
      if (!body.name || !body.amount) return err('name & amount required');
      const row = {
        id: uuidv4(), workOrderId: id,
        name: body.name,
        amount: Number(body.amount),
        category: body.category || 'lain-lain',
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.woCustomCosts).values(row).run();
      recalcWoCosts(id);
      recalcWoOutputs(id);
      return json({ data: row }, { status: 201 });
    }

    // DELETE /work-orders/:id/costs/:costId
    if (route.startsWith('/work-orders/') && path.length === 4 && path[2] === 'costs' && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const woId = path[1]; const costId = path[3];
      db.delete(s.woCustomCosts).where(eq(s.woCustomCosts.id, costId)).run();
      recalcWoCosts(woId);
      recalcWoOutputs(woId);
      return json({ ok: true });
    }

    // GET /work-orders/:id/hpp - full HPP + validation
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'hpp' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      recalcWoCosts(id);
      const validation = recalcWoOutputs(id);
      const outputs = db.select().from(s.woOutputs).where(eq(s.woOutputs.workOrderId, id)).all();
      const outputsEnriched = outputs.map(o => ({ ...o, product: db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, o.productId)).get() }));
      return json({ data: { wo: db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get(), outputs: outputsEnriched, validation } });
    }

    // POST /work-orders/:id/finalize - mark outputs as pending_storage (Tally Inbound will store to CS)
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'finalize' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      if (wo.pipelineStatus === 'Selesai') return err('WO sudah Selesai');
      const outputs = db.select().from(s.woOutputs).where(eq(s.woOutputs.workOrderId, id)).all();
      if (outputs.length === 0) return err('Belum ada output. Isi outputs dulu.');
      // Mark all outputs as pending_storage (do NOT create inventory stock here — anti-dedup)
      for (const o of outputs) {
        db.update(s.woOutputs).set({
          storageStatus: 'pending_storage',
          storedWeight: 0,
        }).where(eq(s.woOutputs.id, o.id)).run();
      }
      // Transition WO status to Selesai
      db.update(s.workOrder).set({ pipelineStatus: 'Selesai', finalizedAt: new Date(), updatedAt: new Date() }).where(eq(s.workOrder.id, id)).run();
      return json({ data: { ok: true, outputCount: outputs.length, message: 'WO diselesaikan. Silakan Tally Inbound (source=WO) untuk menyimpan output ke Cold Storage.' } });
    }

    // GET /work-orders/:id/rendemen-report - actual rendemen %
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'rendemen-report' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      const outputs = db.select().from(s.woOutputs).where(eq(s.woOutputs.workOrderId, id)).all();
      const baseWeight = Number(wo.totalLiveBirdWeight || 0);
      const stages = db.select().from(s.workOrderDetails).where(eq(s.workOrderDetails.workOrderId, id)).all();
      const stagesSummary = stages.map(st => ({
        type: st.type, stageName: st.stageName, inputWeight: st.inputWeight, outputWeight: st.outputWeight,
        headCount: st.headCount, bwAvg: st.bwAvg,
        yieldPct: st.inputWeight > 0 ? (Number(st.outputWeight) / Number(st.inputWeight)) * 100 : 0,
        rendemenData: st.rendemenData ? JSON.parse(st.rendemenData) : null,
      }));
      const outputsWithPct = outputs.map(o => {
        const p = db.select({ sku: s.products.sku, name: s.products.name }).from(s.products).where(eq(s.products.id, o.productId)).get();
        return { ...o, product: p, rendemenPct: baseWeight > 0 ? (Number(o.weight) / baseWeight) * 100 : 0 };
      });
      const totalOutputWeight = outputs.reduce((a, b) => a + Number(b.weight || 0), 0);
      const overallRendemenPct = baseWeight > 0 ? (totalOutputWeight / baseWeight) * 100 : 0;
      return json({ data: {
        wo, stages: stagesSummary, outputs: outputsWithPct,
        summary: { baseWeight, totalOutputWeight, overallRendemenPct, ekorMati: wo.ekorMati, totalHeads: wo.totalLiveBirdHeadCount, bwAvg: wo.bwAvg },
      } });
    }
    // ===================================================================== END WO

    // =====================================================================
    // INVENTORY MODULE
    // =====================================================================
    const nextBaNumber = (prefix) => {
      const ym = new Date();
      const p = `${prefix}/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.inventoryTransaction).where(like(s.inventoryTransaction.baNumber, `${p}%`)).get();
      return `${p}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
    };
    const nextOpnameNumber = () => {
      const ym = new Date();
      const p = `OPN/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.stockOpname).where(like(s.stockOpname.opnameNumber, `${p}%`)).get();
      return `${p}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
    };

    // GET /inventory/stocks - list with filters + FIFO/FEFO
    if (route === '/inventory/stocks' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const productId = url.searchParams.get('product_id');
      const csId = url.searchParams.get('cold_storage_id');
      const zoneId = url.searchParams.get('zone_id');
      const status = url.searchParams.get('status') || 'active';
      const sort = url.searchParams.get('sort') || 'FEFO'; // FIFO | FEFO
      const q = url.searchParams.get('q');
      const conds = [];
      { const ac = archivedCond(s.inventoryStock, url); if (ac) conds.push(ac); }
      if (status !== 'all') conds.push(eq(s.inventoryStock.status, status));
      if (productId) conds.push(eq(s.inventoryStock.productId, productId));
      if (csId) conds.push(eq(s.inventoryStock.coldStorageId, csId));
      if (zoneId) conds.push(eq(s.inventoryStock.zoneId, zoneId));
      if (q) conds.push(like(s.inventoryStock.kodeSimpan, `%${q}%`));
      let query = db.select().from(s.inventoryStock);
      if (conds.length) query = query.where(and(...conds));
      // FIFO = order by createdAt asc; FEFO = order by expiredDate asc (nulls last)
      if (sort === 'FIFO') query = query.orderBy(s.inventoryStock.createdAt);
      else query = query.orderBy(sql`case when ${s.inventoryStock.expiredDate} is null then 1 else 0 end`, s.inventoryStock.expiredDate);
      const rows = query.all();
      // Compute reserved weights (from Draft SO items) in one pass
      const draftSoIds = db.select({ id: s.salesOrder.id }).from(s.salesOrder).where(eq(s.salesOrder.pipelineStatus, 'Draft')).all().map(r => r.id);
      const reservedMap = {};
      if (draftSoIds.length > 0) {
        const draftItems = db.select({
          stockId: s.salesOrderItems.stockCodeId,
          weight: s.salesOrderItems.weight,
          quantity: s.salesOrderItems.quantity,
          salesOrderId: s.salesOrderItems.salesOrderId,
        }).from(s.salesOrderItems).where(and(
          inArray(s.salesOrderItems.salesOrderId, draftSoIds),
          isNotNull(s.salesOrderItems.stockCodeId),
        )).all();
        for (const di of draftItems) {
          if (!reservedMap[di.stockId]) reservedMap[di.stockId] = { weight: 0, quantity: 0, sos: new Set() };
          reservedMap[di.stockId].weight += Number(di.weight || 0);
          reservedMap[di.stockId].quantity += Number(di.quantity || 0);
          reservedMap[di.stockId].sos.add(di.salesOrderId);
        }
      }
      // Optional: exclude a specific SO's own reservation (when editing that SO)
      const excludeSoId = url.searchParams.get('exclude_so');
      let excludeReserved = null;
      if (excludeSoId) {
        const ownItems = db.select({
          stockId: s.salesOrderItems.stockCodeId,
          weight: s.salesOrderItems.weight,
          quantity: s.salesOrderItems.quantity,
        }).from(s.salesOrderItems).where(and(
          eq(s.salesOrderItems.salesOrderId, excludeSoId),
          isNotNull(s.salesOrderItems.stockCodeId),
        )).all();
        excludeReserved = {};
        for (const oi of ownItems) {
          if (!excludeReserved[oi.stockId]) excludeReserved[oi.stockId] = { weight: 0, quantity: 0 };
          excludeReserved[oi.stockId].weight += Number(oi.weight || 0);
          excludeReserved[oi.stockId].quantity += Number(oi.quantity || 0);
        }
      }
      const _poReconMemo = {};
      const _hppMemo = {};
      const poItemHpp = (poId, productId) => {
        const key = poId + '|' + productId;
        if (_hppMemo[key] !== undefined) return _hppMemo[key];
        const it = db.select({ hpp: s.purchaseOrderItems.hppPerKg }).from(s.purchaseOrderItems)
          .where(and(eq(s.purchaseOrderItems.purchaseOrderId, poId), eq(s.purchaseOrderItems.productId, productId))).get();
        const v = Number(it?.hpp || 0);
        _hppMemo[key] = v;
        return v;
      };
      const poRecon = (poId) => {
        if (_poReconMemo[poId] !== undefined) return _poReconMemo[poId];
        const sj = db.select({ w: sql`coalesce(sum(${s.purchaseOrderItems.receivedWeight}),0)` }).from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, poId)).get();
        const tw = db.select({ w: sql`coalesce(sum(${s.inventoryTransaction.totalWeight}),0)` }).from(s.inventoryTransaction).where(and(eq(s.inventoryTransaction.transactionType, 'IN'), eq(s.inventoryTransaction.referenceType, 'PO'), eq(s.inventoryTransaction.referenceId, poId))).get();
        const sjWeight = Math.round(Number(sj?.w || 0) * 100) / 100;
        const tallyWeight = Math.round(Number(tw?.w || 0) * 100) / 100;
        const res = { sjWeight, tallyWeight, tallyVariance: Math.round((tallyWeight - sjWeight) * 100) / 100 };
        _poReconMemo[poId] = res;
        return res;
      };
      // Batch-load reference tables ONCE (avoid N+1: previously ~4 queries per stock row).
      const prodMap = {}; for (const p of db.select({ id: s.products.id, sku: s.products.sku, name: s.products.name, unit: s.products.unit, category: s.products.category }).from(s.products).all()) prodMap[p.id] = { sku: p.sku, name: p.name, unit: p.unit, category: p.category };
      const csMap = {}; for (const c of db.select({ id: s.coldStorages.id, code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).all()) csMap[c.id] = { code: c.code, name: c.name };
      const zoneMap = {}; for (const z of db.select({ id: s.zones.id, code: s.zones.code, name: s.zones.name }).from(s.zones).all()) zoneMap[z.id] = { code: z.code, name: z.name };
      const poMap = {}; for (const po of db.select({ id: s.purchaseOrder.id, number: s.purchaseOrder.poNumber, poType: s.purchaseOrder.poType, orderDate: s.purchaseOrder.orderDate }).from(s.purchaseOrder).all()) poMap[po.id] = po;
      const woMap = {}; for (const wo of db.select({ id: s.workOrder.id, number: s.workOrder.woNumber, mode: s.workOrder.mode, startDate: s.workOrder.startDate }).from(s.workOrder).all()) woMap[wo.id] = wo;
      const enriched = rows.map(r => {
        const p = prodMap[r.productId] || null;
        const cs = csMap[r.coldStorageId] || null;
        const zone = r.zoneId ? (zoneMap[r.zoneId] || null) : null;
        // Source lookup (PO/WO reference number for grouping)
        let source = null;
        if (r.sourceType === 'PO' && r.sourceBatch) {
          source = poMap[r.sourceBatch] || null;
          if (source) source = { ...source, ...poRecon(r.sourceBatch) };
        } else if (r.sourceType === 'WO' && r.sourceBatch) {
          source = woMap[r.sourceBatch] || null;
        }
        const daysToExpire = r.expiredDate ? Math.floor((new Date(r.expiredDate).getTime() - Date.now()) / (24*60*60*1000)) : null;
        const reserved = reservedMap[r.id] || { weight: 0, quantity: 0, sos: new Set() };
        let reservedWeight = reserved.weight;
        let reservedQty = reserved.quantity;
        if (excludeReserved && excludeReserved[r.id]) {
          reservedWeight -= excludeReserved[r.id].weight;
          reservedQty -= excludeReserved[r.id].quantity;
        }
        reservedWeight = Math.max(0, reservedWeight);
        reservedQty = Math.max(0, reservedQty);
        const availableWeight = Math.max(0, Number(r.weight || 0) - reservedWeight);
        const availableQty = Math.max(0, Number(r.quantity || 0) - reservedQty);
        // HPP: pakai HPP/kg live dari PO item (berbasis tally) bila ada, else nilai tersimpan di stok
        let hppPerKg = Number(r.hppPerKg || 0);
        if (r.sourceType === 'PO' && r.sourceBatch) {
          const liveHpp = poItemHpp(r.sourceBatch, r.productId);
          if (liveHpp > 0) hppPerKg = liveHpp;
        }
        hppPerKg = Math.round(hppPerKg);
        const qtyNum = Number(r.quantity || 0);
        const stockValue = Math.round(hppPerKg * Number(r.weight || 0));
        const hppPerKemasan = qtyNum > 0 ? Math.round(stockValue / qtyNum) : 0;
        return {
          ...r, product: p, coldStorage: cs, zone, source, daysToExpire,
          reservedWeight, reservedQty,
          reservedSoCount: reserved.sos ? reserved.sos.size : 0,
          availableWeight, availableQty,
          hppPerKg, stockValue, hppPerKemasan,
        };
      });
      // Summary
      const summary = {
        totalRows: enriched.length,
        totalWeight: enriched.reduce((a, b) => a + Number(b.weight || 0), 0),
        totalAvailableWeight: enriched.reduce((a, b) => a + Number(b.availableWeight || 0), 0),
        totalReservedWeight: enriched.reduce((a, b) => a + Number(b.reservedWeight || 0), 0),
        totalQty: enriched.reduce((a, b) => a + Number(b.quantity || 0), 0),
        totalValue: enriched.reduce((a, b) => a + Number(b.stockValue || 0), 0),
        nearExpiry: enriched.filter(r => r.daysToExpire !== null && r.daysToExpire <= 7 && r.daysToExpire >= 0).length,
        expired: enriched.filter(r => r.daysToExpire !== null && r.daysToExpire < 0).length,
      };
      return json({ data: enriched, summary });
    }

    // GET /inventory/stocks/:id - detail with traceability
    if (route.startsWith('/inventory/stocks/') && path.length === 3 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const id = path[2];
      const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, id)).get();
      if (!stk) return err('Not found', 404);
      const p = db.select().from(s.products).where(eq(s.products.id, stk.productId)).get();
      const cs = db.select().from(s.coldStorages).where(eq(s.coldStorages.id, stk.coldStorageId)).get();
      const zone = stk.zoneId ? db.select().from(s.zones).where(eq(s.zones.id, stk.zoneId)).get() : null;
      // Traceability
      let source = null;
      if (stk.sourceType === 'WO') source = db.select({ id: s.workOrder.id, number: s.workOrder.woNumber, mode: s.workOrder.mode, startDate: s.workOrder.startDate }).from(s.workOrder).where(eq(s.workOrder.id, stk.sourceBatch)).get();
      else if (stk.sourceType === 'PO') source = db.select({ id: s.purchaseOrder.id, number: s.purchaseOrder.poNumber, poType: s.purchaseOrder.poType, orderDate: s.purchaseOrder.orderDate }).from(s.purchaseOrder).where(eq(s.purchaseOrder.id, stk.sourceBatch)).get();
      // Movement history for this stock (via transactions that touched it)
      const inTx = stk.transactionId ? db.select().from(s.inventoryTransaction).where(eq(s.inventoryTransaction.id, stk.transactionId)).get() : null;
      // Children (packs from opened karung)
      const children = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.parentStockId, id)).all();
      const parent = stk.parentStockId ? db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, stk.parentStockId)).get() : null;
      return json({ data: { ...stk, product: p, coldStorage: cs, zone, source, inboundTransaction: inTx, children, parent } });
    }

    // PATCH /inventory/stocks/:id - edit a stock lot (product, expiry date, kode simpan).
    // Guardrails: only ACTIVE + UNALLOCATED lots can be edited (blocks opened/used/sold lots and lots
    // already reserved/allocated to any SO) so valuation & traceability stay intact. When the product is
    // changed the HPP/kg is reset to the NEW product's basePrice (Harga Modal). kode_simpan must be unique.
    if (route.startsWith('/inventory/stocks/') && path.length === 3 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[2];
      const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, id)).get();
      if (!stk) return err('Not found', 404);
      if (stk.status !== 'active') return err(`Kode simpan ${stk.kodeSimpan} tidak dapat diedit (status: ${stk.status}). Hanya lot aktif yang bisa diedit.`);
      // Block if allocated/reserved to ANY sales order (draft reservation or confirmed allocation).
      const alloc = db.select({ c: sql`count(*)` }).from(s.salesOrderItems).where(eq(s.salesOrderItems.stockCodeId, id)).get();
      if (Number(alloc?.c || 0) > 0) return err(`Kode simpan ${stk.kodeSimpan} sudah dialokasikan ke SO — tidak dapat diedit. Lepas alokasi terlebih dahulu.`);
      // Block if this lot is a split parent (has children).
      const kids = db.select({ c: sql`count(*)` }).from(s.inventoryStock).where(eq(s.inventoryStock.parentStockId, id)).get();
      if (Number(kids?.c || 0) > 0) return err(`Kode simpan ${stk.kodeSimpan} sudah dibuka (split) — tidak dapat diedit.`);

      const body = await request.json();
      const update = {};
      // Product change -> reset HPP/kg to new product's basePrice (a-ii).
      if (body.productId !== undefined && body.productId && body.productId !== stk.productId) {
        const np = db.select().from(s.products).where(eq(s.products.id, body.productId)).get();
        if (!np) return err('Produk tidak ditemukan', 400);
        update.productId = body.productId;
        update.hppPerKg = Number(np.basePrice || 0);
      }
      // Expiry date (allow clearing with null/empty).
      if (body.expiredDate !== undefined) {
        update.expiredDate = body.expiredDate ? new Date(body.expiredDate) : null;
      }
      // Kode simpan (must be unique across lots).
      if (body.kodeSimpan !== undefined) {
        const nk = String(body.kodeSimpan || '').trim();
        if (!nk) return err('Kode simpan tidak boleh kosong', 400);
        if (nk !== stk.kodeSimpan) {
          const dup = db.select({ id: s.inventoryStock.id }).from(s.inventoryStock).where(and(eq(s.inventoryStock.kodeSimpan, nk), sql`${s.inventoryStock.id} != ${id}`)).get();
          if (dup) return err(`Kode simpan "${nk}" sudah dipakai lot lain`, 400);
          update.kodeSimpan = nk;
        }
      }
      if (Object.keys(update).length === 0) return err('Tidak ada perubahan', 400);
      update.updatedAt = new Date();
      db.update(s.inventoryStock).set(update).where(eq(s.inventoryStock.id, id)).run();
      const updated = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, id)).get();
      const p = db.select().from(s.products).where(eq(s.products.id, updated.productId)).get();
      return json({ data: { ...updated, product: p } });
    }


    // GET /inventory/next-kode-simpan?count=N - preview upcoming kode simpan (does NOT consume)
    if (route === '/inventory/next-kode-simpan' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const count = Math.min(200, Math.max(1, Number(url.searchParams.get('count') || 1)));
      const d = new Date();
      const prefix = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const row = db.select({ c: sql`count(*)` }).from(s.inventoryStock).where(like(s.inventoryStock.kodeSimpan, `${prefix}%`)).get();
      const base = Number(row?.c || 0);
      const codes = [];
      for (let i = 1; i <= count; i++) codes.push(`${prefix}${String(base + i).padStart(4, '0')}`);
      return json({ data: { codes, prefix, base } });
    }


    // Helper: commit inbound (create inventory tx + stocks + PO tally accumulation).
    // Throws Error with .status on validation error. Reused by /inventory/inbound & tally-session finalize.
    const performInbound = (body, userEmail) => {
      // body: { referenceId(PO/WO id), referenceType, coldStorageId, zoneId?, items: [{productId, weight, quantity, expiredDate, packagingType, zoneId?}] }
      if (!Array.isArray(body.items) || body.items.length === 0) { const e = new Error('items required'); e.status = 400; throw e; }
      if (!body.coldStorageId) { const e = new Error('coldStorageId required'); e.status = 400; throw e; }
      const txId = uuidv4();
      const totalW = body.items.reduce((a, b) => a + Number(b.weight || 0), 0);
      const totalQ = body.items.reduce((a, b) => a + Number(b.quantity || 0), 0);
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(), transactionType: 'IN',
        referenceId: body.referenceId || null, referenceType: body.referenceType || 'MANUAL',
        toColdStorageId: body.coldStorageId, toZoneId: body.zoneId || null,
        totalWeight: totalW, totalQuantity: totalQ,
        notes: body.notes || null, status: 'confirmed',
        createdBy: userEmail, createdAt: new Date(),
      }).run();
      const createdStocks = [];
      let inboundRefNumber = null;
      if (body.referenceType === 'PO' && body.referenceId) inboundRefNumber = db.select({ n: s.purchaseOrder.poNumber }).from(s.purchaseOrder).where(eq(s.purchaseOrder.id, body.referenceId)).get()?.n || null;
      else if (body.referenceType === 'WO' && body.referenceId) inboundRefNumber = db.select({ n: s.workOrder.woNumber }).from(s.workOrder).where(eq(s.workOrder.id, body.referenceId)).get()?.n || null;
      for (const it of body.items) {
        // Anti-dedup for WO source: validate & deduct from WO output remaining
        if (body.referenceType === 'WO' && body.referenceId) {
          const outputs = db.select().from(s.woOutputs)
            .where(and(eq(s.woOutputs.workOrderId, body.referenceId), eq(s.woOutputs.productId, it.productId)))
            .all();
          const totalRemaining = outputs.reduce((a, o) => a + Math.max(0, Number(o.weight || 0) - Number(o.storedWeight || 0)), 0);
          if (totalRemaining <= 0) {
            const e = new Error('Produk ini sudah selesai disimpan dari WO tersebut (tidak ada sisa)'); e.status = 400; throw e;
          }
          if (Number(it.weight || 0) - totalRemaining > 0.01) {
            const e = new Error(`Berat ${it.weight}kg melebihi sisa output WO (${totalRemaining.toFixed(2)}kg tersisa)`); e.status = 400; throw e;
          }
          // Deduct across matching outputs (FIFO by created_at)
          let remainingToDeduct = Number(it.weight || 0);
          for (const o of outputs.sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
            if (remainingToDeduct <= 0) break;
            const oRem = Math.max(0, Number(o.weight || 0) - Number(o.storedWeight || 0));
            if (oRem <= 0) continue;
            const take = Math.min(oRem, remainingToDeduct);
            const newStored = Number(o.storedWeight || 0) + take;
            const fullyStored = newStored >= Number(o.weight || 0) - 0.001;
            db.update(s.woOutputs).set({
              storedWeight: newStored,
              storageStatus: fullyStored ? 'stored' : 'partial',
            }).where(eq(s.woOutputs.id, o.id)).run();
            remainingToDeduct -= take;
          }
        }
        const stkId = uuidv4();
        const kodeSimpan = (it.kodeSimpan && String(it.kodeSimpan).trim()) ? String(it.kodeSimpan).trim() : nextKodeSimpan();
        // Tentukan HPP/kg stok dari sumber (PO item / WO output) atau fallback HPP produk
        let hppPerKg = Number(it.hppPerKg || 0);
        if (!hppPerKg && body.referenceType === 'WO' && body.referenceId) {
          const o = db.select({ hpp: s.woOutputs.hppPerKg }).from(s.woOutputs)
            .where(and(eq(s.woOutputs.workOrderId, body.referenceId), eq(s.woOutputs.productId, it.productId), sql`${s.woOutputs.hppPerKg} > 0`)).get();
          if (o?.hpp) hppPerKg = Number(o.hpp);
        }
        if (!hppPerKg && body.referenceType === 'PO' && body.referenceId) {
          const pi = db.select({ hpp: s.purchaseOrderItems.hppPerKg }).from(s.purchaseOrderItems)
            .where(and(eq(s.purchaseOrderItems.purchaseOrderId, body.referenceId), eq(s.purchaseOrderItems.productId, it.productId), sql`${s.purchaseOrderItems.hppPerKg} > 0`)).get();
          if (pi?.hpp) hppPerKg = Number(pi.hpp);
        }
        if (!hppPerKg) hppPerKg = getProductHpp(it.productId);
        db.insert(s.inventoryStock).values({
          id: stkId, productId: it.productId,
          coldStorageId: body.coldStorageId, zoneId: it.zoneId || body.zoneId || null,
          kodeSimpan,
          packagingType: it.packagingType || 'karung',
          quantity: Number(it.quantity || 0),
          weight: Number(it.weight || 0),
          expiredDate: it.expiredDate ? new Date(it.expiredDate) : null,
          status: 'active',
          sourceBatch: body.referenceId || null, sourceType: body.referenceType || null,
          hppPerKg,
          transactionId: txId,
        }).run();
        createdStocks.push({ id: stkId, kodeSimpan, weight: Number(it.weight || 0), quantity: Number(it.quantity || 0), productId: it.productId });
        recordLedger(db, {
          ledgerDate: new Date(),
          productId: it.productId,
          coldStorageId: body.coldStorageId,
          zoneId: it.zoneId || body.zoneId || null,
          movementType: 'IN',
          referenceType: body.referenceType || 'MANUAL',
          referenceId: body.referenceId || null,
          referenceNumber: inboundRefNumber,
          weightIn: Number(it.weight || 0),
          qtyIn: Number(it.quantity || 0),
          hppPerKg,
          kodeSimpan,
          transactionId: txId,
          stockId: stkId,
          createdBy: userEmail,
        });
      }
      // For PO-sourced inbound: accumulate actual re-weigh (tally) weight per PO item, then
      // recompute PO total + HPP (HPP always references tally weight).
      if (body.referenceType === 'PO' && body.referenceId) {
        const perProduct = {};
        for (const it of body.items) {
          perProduct[it.productId] = (perProduct[it.productId] || 0) + Number(it.weight || 0);
        }
        for (const [productId, w] of Object.entries(perProduct)) {
          const poi = db.select().from(s.purchaseOrderItems)
            .where(and(eq(s.purchaseOrderItems.purchaseOrderId, body.referenceId), eq(s.purchaseOrderItems.productId, productId))).get();
          if (poi) {
            const newTally = Math.round((Number(poi.tallyWeight || 0) + w) * 100) / 100;
            db.update(s.purchaseOrderItems).set({ tallyWeight: newTally }).where(eq(s.purchaseOrderItems.id, poi.id)).run();
          }
        }
        try { computePoInvoice(body.referenceId); } catch (e) {}
        // Tandai PO selesai ditally jika diminta -> hilang dari pilihan referensi tally
        if (body.markTallyComplete) {
          db.update(s.purchaseOrder).set({ tallyCompletedAt: new Date(), updatedAt: new Date() }).where(eq(s.purchaseOrder.id, body.referenceId)).run();
        }
      }
      return { txId, createdStocks };
    };

    // POST /inventory/inbound - manual inbound (from PO GRN)
    if (route === '/inventory/inbound' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const body = await request.json();
      try {
        const { txId, createdStocks } = performInbound(body, session.user.email);
        return json({ data: { transactionId: txId, stocks: createdStocks, stockIds: createdStocks.map(s2 => s2.id) } }, { status: 201 });
      } catch (e) { return err(e.message || 'Gagal inbound', e.status || 400); }
    }

    // ================= TALLY SESSIONS (draft inbound yang bisa dilanjutkan) =================
    // Helper: enrich a session row with cs/ref/items summary
    const enrichTallySession = (r, withItems = false) => {
      const itemRows = db.select().from(s.tallySessionItems)
        .where(eq(s.tallySessionItems.sessionId, r.id)).orderBy(s.tallySessionItems.sortOrder).all();
      const cs = r.coldStorageId ? db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.coldStorageId)).get() : null;
      let refNumber = null;
      if (r.referenceType === 'PO' && r.referenceId) refNumber = db.select({ n: s.purchaseOrder.poNumber }).from(s.purchaseOrder).where(eq(s.purchaseOrder.id, r.referenceId)).get()?.n || null;
      if (r.referenceType === 'WO' && r.referenceId) refNumber = db.select({ n: s.workOrder.woNumber }).from(s.workOrder).where(eq(s.workOrder.id, r.referenceId)).get()?.n || null;
      const totalWeight = itemRows.reduce((a, b) => a + Number(b.weight || 0), 0);
      const base = { ...r, csCode: cs?.code || null, csName: cs?.name || null, refNumber, itemCount: itemRows.length, totalWeight };
      if (withItems) {
        base.items = itemRows.map(it => {
          const p = db.select({ name: s.products.name, sku: s.products.sku }).from(s.products).where(eq(s.products.id, it.productId)).get();
          const z = it.zoneId ? db.select({ code: s.zones.code }).from(s.zones).where(eq(s.zones.id, it.zoneId)).get() : null;
          return { ...it, productName: p?.name || null, productSku: p?.sku || null, zoneCode: z?.code || null };
        });
      }
      return base;
    };

    // GET /tally-sessions?status=draft  (default draft) — list resumable sessions
    if (route === '/tally-sessions' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      const u = new URL(request.url);
      const status = u.searchParams.get('status') || 'draft';
      const rows = db.select().from(s.tallySession)
        .where(eq(s.tallySession.status, status))
        .orderBy(desc(s.tallySession.updatedAt)).all();
      return json({ data: rows.map(r => enrichTallySession(r, false)) });
    }

    // GET /tally-sessions/:id — one session with items
    if (route.startsWith('/tally-sessions/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      const row = db.select().from(s.tallySession).where(eq(s.tallySession.id, path[1])).get();
      if (!row) return err('Sesi tally tidak ditemukan', 404);
      return json({ data: enrichTallySession(row, true) });
    }

    // POST /tally-sessions — create draft session (with items)
    if (route === '/tally-sessions' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.coldStorageId) return err('coldStorageId required');
      const id = uuidv4();
      db.insert(s.tallySession).values({
        id,
        coldStorageId: body.coldStorageId,
        zoneId: body.zoneId || null,
        referenceType: body.referenceType || 'MANUAL',
        referenceId: body.referenceId || null,
        notes: body.notes || null,
        status: 'draft',
        kodeBase: body.kodeBase || null,
        kodeBaseAt: Number(body.kodeBaseAt || 0),
        markTallyComplete: !!body.markTallyComplete,
        createdBy: session.user.email,
        createdAt: new Date(), updatedAt: new Date(),
      }).run();
      const items = Array.isArray(body.items) ? body.items : [];
      items.forEach((it, i) => {
        db.insert(s.tallySessionItems).values({
          id: uuidv4(), sessionId: id, productId: it.productId,
          weight: Number(it.weight || 0), quantity: Number(it.quantity || 1),
          packagingType: it.packagingType || 'colly',
          expiredDate: it.expiredDate ? new Date(it.expiredDate) : null,
          kodeSimpan: it.kodeSimpan || null, zoneId: it.zoneId || null,
          sortOrder: i, createdAt: new Date(),
        }).run();
      });
      const row = db.select().from(s.tallySession).where(eq(s.tallySession.id, id)).get();
      return json({ data: enrichTallySession(row, true) }, { status: 201 });
    }

    // PUT /tally-sessions/:id — update draft (header + replace items)
    if (route.startsWith('/tally-sessions/') && path.length === 2 && (method === 'PUT' || method === 'PATCH')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const existing = db.select().from(s.tallySession).where(eq(s.tallySession.id, path[1])).get();
      if (!existing) return err('Sesi tally tidak ditemukan', 404);
      if (existing.status === 'final') return err('Sesi sudah final, tidak bisa diubah', 400);
      const body = await request.json();
      db.update(s.tallySession).set({
        coldStorageId: body.coldStorageId ?? existing.coldStorageId,
        zoneId: body.zoneId !== undefined ? (body.zoneId || null) : existing.zoneId,
        referenceType: body.referenceType ?? existing.referenceType,
        referenceId: body.referenceId !== undefined ? (body.referenceId || null) : existing.referenceId,
        notes: body.notes !== undefined ? (body.notes || null) : existing.notes,
        kodeBase: body.kodeBase !== undefined ? (body.kodeBase || null) : existing.kodeBase,
        kodeBaseAt: body.kodeBaseAt !== undefined ? Number(body.kodeBaseAt || 0) : existing.kodeBaseAt,
        markTallyComplete: body.markTallyComplete !== undefined ? !!body.markTallyComplete : existing.markTallyComplete,
        updatedAt: new Date(),
      }).where(eq(s.tallySession.id, path[1])).run();
      if (Array.isArray(body.items)) {
        db.delete(s.tallySessionItems).where(eq(s.tallySessionItems.sessionId, path[1])).run();
        body.items.forEach((it, i) => {
          db.insert(s.tallySessionItems).values({
            id: uuidv4(), sessionId: path[1], productId: it.productId,
            weight: Number(it.weight || 0), quantity: Number(it.quantity || 1),
            packagingType: it.packagingType || 'colly',
            expiredDate: it.expiredDate ? new Date(it.expiredDate) : null,
            kodeSimpan: it.kodeSimpan || null, zoneId: it.zoneId || null,
            sortOrder: i, createdAt: new Date(),
          }).run();
        });
      }
      const row = db.select().from(s.tallySession).where(eq(s.tallySession.id, path[1])).get();
      return json({ data: enrichTallySession(row, true) });
    }

    // POST /tally-sessions/:id/finalize — commit to inventory + lock
    if (route.startsWith('/tally-sessions/') && path.length === 3 && path[2] === 'finalize' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const existing = db.select().from(s.tallySession).where(eq(s.tallySession.id, path[1])).get();
      if (!existing) return err('Sesi tally tidak ditemukan', 404);
      if (existing.status === 'final') return err('Sesi sudah final', 400);
      const itemRows = db.select().from(s.tallySessionItems)
        .where(eq(s.tallySessionItems.sessionId, path[1])).orderBy(s.tallySessionItems.sortOrder).all();
      if (itemRows.length === 0) return err('Belum ada item pada sesi ini', 400);
      const inboundBody = {
        coldStorageId: existing.coldStorageId,
        zoneId: existing.zoneId || undefined,
        referenceType: existing.referenceType || 'MANUAL',
        referenceId: existing.referenceId || undefined,
        notes: existing.notes || undefined,
        markTallyComplete: existing.referenceType === 'PO' && !!existing.markTallyComplete,
        items: itemRows.map(it => ({
          productId: it.productId, weight: Number(it.weight || 0), quantity: Number(it.quantity || 1),
          packagingType: it.packagingType, expiredDate: it.expiredDate || undefined,
          kodeSimpan: it.kodeSimpan || undefined, zoneId: it.zoneId || undefined,
        })),
      };
      let result;
      try { result = performInbound(inboundBody, session.user.email); }
      catch (e) { return err(e.message || 'Gagal finalisasi', e.status || 400); }
      db.update(s.tallySession).set({
        status: 'final', transactionId: result.txId, finalizedAt: new Date(), updatedAt: new Date(),
      }).where(eq(s.tallySession.id, path[1])).run();
      return json({ data: { transactionId: result.txId, stocks: result.createdStocks, stockIds: result.createdStocks.map(s2 => s2.id) } }, { status: 201 });
    }

    // DELETE /tally-sessions/:id — discard a draft
    if (route.startsWith('/tally-sessions/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const existing = db.select().from(s.tallySession).where(eq(s.tallySession.id, path[1])).get();
      if (!existing) return err('Sesi tally tidak ditemukan', 404);
      if (existing.status === 'final') return err('Sesi sudah final, tidak bisa dihapus', 400);
      db.delete(s.tallySessionItems).where(eq(s.tallySessionItems.sessionId, path[1])).run();
      db.delete(s.tallySession).where(eq(s.tallySession.id, path[1])).run();
      return json({ data: { deleted: true } });
    }

    // ================= APP SETTINGS (key-value JSON) =================
    const ALLOWED_SETTINGS = ['company', 'concern', 'approval', 'notifications', 'pdf', 'appearance'];
    // GET /settings/:key
    if (route.startsWith('/settings/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      const key = path[1];
      if (!ALLOWED_SETTINGS.includes(key)) return err('Setting tidak dikenal', 404);
      const row = db.select().from(s.appSettings).where(eq(s.appSettings.key, key)).get();
      let value = {};
      if (row?.value) { try { value = JSON.parse(row.value); } catch { value = {}; } }
      return json({ data: { key, value, updatedAt: row?.updatedAt || null } });
    }
    // PUT /settings/:key
    if (route.startsWith('/settings/') && path.length === 2 && (method === 'PUT' || method === 'POST')) {
      const { session, error } = await requireAuth(); if (error) return error;
      const key = path[1];
      if (!ALLOWED_SETTINGS.includes(key)) return err('Setting tidak dikenal', 404);
      const body = await request.json().catch(() => ({}));
      const val = JSON.stringify(body?.value !== undefined ? body.value : body);
      const existing = db.select().from(s.appSettings).where(eq(s.appSettings.key, key)).get();
      if (existing) db.update(s.appSettings).set({ value: val, updatedAt: new Date() }).where(eq(s.appSettings.key, key)).run();
      else db.insert(s.appSettings).values({ key, value: val, updatedAt: new Date() }).run();
      let value = {}; try { value = JSON.parse(val); } catch {}
      return json({ data: { key, value } });
    }

    // PUT /account/profile — update nama user sendiri
    if (route === '/account/profile' && (method === 'PUT' || method === 'POST')) {
      const { session, error } = await requireAuth(); if (error) return error;
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || '').trim();
      if (!name) return err('Nama wajib diisi');
      await authUsers.updateUserById(session.user.id, { name });
      return json({ data: { id: session.user.id, name } });
    }


    // POST /inventory/outbound - non-sales (sample) or damage
    if (route === '/inventory/outbound' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      // body: { stockIds: [], subtype: 'non_sales' | 'damage', reason, notes }
      if (!Array.isArray(body.stockIds) || body.stockIds.length === 0) return err('stockIds required');
      const subtype = body.subtype || 'non_sales';
      const stocks = body.stockIds.map(id => db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, id)).get()).filter(Boolean);
      if (stocks.length === 0) return err('No valid stocks found');
      const totalW = stocks.reduce((a, b) => a + Number(b.weight || 0), 0);
      const totalQ = stocks.reduce((a, b) => a + Number(b.quantity || 0), 0);
      const txId = uuidv4();
      // For damage: requires approval (status=pending). For non_sales: confirmed.
      const requiresApproval = subtype === 'damage';
      const isAdmin = session.user.role === 'admin';
      const outboundBaNo = nextBaNumber('BA');
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(),
        transactionType: subtype === 'damage' ? 'DAMAGE' : 'NON_SALES',
        baNumber: outboundBaNo,
        baType: subtype === 'damage' ? 'damage' : 'non_sales',
        fromColdStorageId: stocks[0].coldStorageId,
        totalWeight: totalW, totalQuantity: totalQ,
        reason: body.reason || null, notes: body.notes || null,
        status: requiresApproval && !isAdmin ? 'pending' : 'confirmed',
        approvedBy: isAdmin ? session.user.email : null,
        approvedAt: isAdmin ? new Date() : null,
        createdBy: session.user.email, createdAt: new Date(),
      }).run();
      // Only mark stocks as used/damaged if confirmed
      if (!requiresApproval || isAdmin) {
        for (const st of stocks) {
          db.update(s.inventoryStock).set({ status: subtype === 'damage' ? 'damaged' : 'used', updatedAt: new Date() }).where(eq(s.inventoryStock.id, st.id)).run();
          recordLedger(db, {
            ledgerDate: new Date(),
            productId: st.productId,
            coldStorageId: st.coldStorageId,
            zoneId: st.zoneId,
            movementType: subtype === 'damage' ? 'DAMAGE' : 'OUT',
            referenceType: subtype === 'damage' ? 'DAMAGE' : 'NON_SALES',
            referenceId: txId,
            referenceNumber: outboundBaNo,
            weightOut: Number(st.weight || 0),
            qtyOut: Number(st.quantity || 0),
            hppPerKg: Number(st.hppPerKg || 0),
            kodeSimpan: st.kodeSimpan,
            stockId: st.id,
            notes: body.reason || null,
            createdBy: session.user.email,
          });
        }
      }
      return json({ data: { transactionId: txId, status: requiresApproval && !isAdmin ? 'pending' : 'confirmed', notification: subtype === 'damage' ? { to: ['supervisor', 'direktur'], subject: `Kerusakan/Susut Stock: ${totalW}kg` } : null } }, { status: 201 });
    }

    // POST /inventory/transfer-cs - transfer between cold storages (BA required)
    if (route === '/inventory/transfer-cs' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!Array.isArray(body.stockIds) || !body.toColdStorageId) return err('stockIds and toColdStorageId required');
      const stocks = body.stockIds.map(id => db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, id)).get()).filter(Boolean);
      if (stocks.length === 0) return err('No valid stocks');
      const fromCsId = stocks[0].coldStorageId;
      if (fromCsId === body.toColdStorageId) return err('CS asal & tujuan sama');
      const totalW = stocks.reduce((a, b) => a + Number(b.weight || 0), 0);
      const totalQ = stocks.reduce((a, b) => a + Number(b.quantity || 0), 0);
      const txId = uuidv4();
      const transferBaNo = nextBaNumber('BA');
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(),
        transactionType: 'TRANSFER_CS',
        baNumber: transferBaNo, baType: 'transfer_cs',
        fromColdStorageId: fromCsId, toColdStorageId: body.toColdStorageId,
        toZoneId: body.toZoneId || null,
        totalWeight: totalW, totalQuantity: totalQ,
        notes: body.notes || null, status: 'confirmed',
        createdBy: session.user.email, createdAt: new Date(),
      }).run();
      // Update stock location
      for (const st of stocks) {
        recordLedger(db, {
          ledgerDate: new Date(), productId: st.productId,
          coldStorageId: fromCsId, zoneId: st.zoneId,
          movementType: 'TRANSFER_OUT', referenceType: 'TRANSFER_CS',
          referenceId: txId, referenceNumber: transferBaNo,
          weightOut: Number(st.weight || 0), qtyOut: Number(st.quantity || 0),
          hppPerKg: Number(st.hppPerKg || 0), kodeSimpan: st.kodeSimpan,
          stockId: st.id, createdBy: session.user.email,
        });
        recordLedger(db, {
          ledgerDate: new Date(), productId: st.productId,
          coldStorageId: body.toColdStorageId, zoneId: body.toZoneId || null,
          movementType: 'TRANSFER_IN', referenceType: 'TRANSFER_CS',
          referenceId: txId, referenceNumber: transferBaNo,
          weightIn: Number(st.weight || 0), qtyIn: Number(st.quantity || 0),
          hppPerKg: Number(st.hppPerKg || 0), kodeSimpan: st.kodeSimpan,
          stockId: st.id, createdBy: session.user.email,
        });
        db.update(s.inventoryStock).set({
          coldStorageId: body.toColdStorageId,
          zoneId: body.toZoneId || null,
          updatedAt: new Date(),
        }).where(eq(s.inventoryStock.id, st.id)).run();
      }
      return json({ data: { transactionId: txId, moved: stocks.length } }, { status: 201 });
    }

    // POST /inventory/transfer-zone - transfer between zones (no BA)
    if (route === '/inventory/transfer-zone' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!Array.isArray(body.stockIds) || !body.toZoneId) return err('stockIds and toZoneId required');
      const stocks = body.stockIds.map(id => db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, id)).get()).filter(Boolean);
      const totalW = stocks.reduce((a, b) => a + Number(b.weight || 0), 0);
      const totalQ = stocks.reduce((a, b) => a + Number(b.quantity || 0), 0);
      const txId = uuidv4();
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(), transactionType: 'TRANSFER_ZONE',
        fromColdStorageId: stocks[0]?.coldStorageId, toColdStorageId: stocks[0]?.coldStorageId,
        fromZoneId: stocks[0]?.zoneId, toZoneId: body.toZoneId,
        totalWeight: totalW, totalQuantity: totalQ, notes: body.notes || null, status: 'confirmed',
        createdBy: session.user.email, createdAt: new Date(),
      }).run();
      for (const st of stocks) {
        db.update(s.inventoryStock).set({ zoneId: body.toZoneId, updatedAt: new Date() }).where(eq(s.inventoryStock.id, st.id)).run();
      }
      return json({ data: { transactionId: txId, moved: stocks.length } }, { status: 201 });
    }

    // POST /inventory/split-karung - open karung, create child packs
    if (route === '/inventory/split-karung' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const body = await request.json();
      // body: { stockId, packs: [{ weight, quantity }] }
      const parent = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, body.stockId)).get();
      if (!parent) return err('Stock not found', 404);
      if (parent.packagingType !== 'karung' && parent.packagingType !== 'colly') return err('Hanya karung/colly yang bisa displit');
      if (parent.status !== 'active') return err('Karung tidak aktif');
      const packs = body.packs || [];
      if (packs.length === 0) return err('packs required');
      const VALID_PKG = ['karung', 'pack', 'box', 'curah', 'colly', 'keranjang', 'kardus'];
      // HPP/kg efektif karung asal: untuk stok PO ambil HPP live dari PO item (basis tally),
      // fallback ke nilai tersimpan di stok. Anak split mewarisi HPP ini (jangan 0).
      let effHpp = Number(parent.hppPerKg || 0);
      if (parent.sourceType === 'PO' && parent.sourceBatch) {
        const poIt = db.select({ hpp: s.purchaseOrderItems.hppPerKg }).from(s.purchaseOrderItems)
          .where(and(eq(s.purchaseOrderItems.purchaseOrderId, parent.sourceBatch), eq(s.purchaseOrderItems.productId, parent.productId))).get();
        if (Number(poIt?.hpp || 0) > 0) effHpp = Number(poIt.hpp);
      }
      // Pre-validate any MANUAL kode simpan supplied per pack: non-empty, unique vs existing lots and
      // vs other packs in this same split. Packs without a manual code fall back to auto nextKodeSimpan().
      const manualCodes = [];
      for (const p of packs) {
        if (p.kodeSimpan !== undefined && String(p.kodeSimpan || '').trim()) {
          const nk = String(p.kodeSimpan).trim();
          if (manualCodes.includes(nk)) return err(`Kode simpan "${nk}" terduplikasi di antara kemasan`, 400);
          const dup = db.select({ id: s.inventoryStock.id }).from(s.inventoryStock).where(eq(s.inventoryStock.kodeSimpan, nk)).get();
          if (dup) return err(`Kode simpan "${nk}" sudah dipakai lot lain`, 400);
          manualCodes.push(nk);
        }
      }
      const createdIds = [];
      for (const p of packs) {
        const pkg = VALID_PKG.includes(p.packagingType) ? p.packagingType : 'pack';
        const stkId = uuidv4();
        const kode = (p.kodeSimpan !== undefined && String(p.kodeSimpan || '').trim()) ? String(p.kodeSimpan).trim() : nextKodeSimpan();
        db.insert(s.inventoryStock).values({
          id: stkId,
          productId: parent.productId,
          coldStorageId: parent.coldStorageId,
          zoneId: parent.zoneId,
          kodeSimpan: kode,
          packagingType: pkg,
          parentStockId: parent.id,
          quantity: Number(p.quantity || 1),
          weight: Number(p.weight || 0),
          expiredDate: parent.expiredDate,
          status: 'active',
          sourceBatch: parent.sourceBatch, sourceType: parent.sourceType,
          hppPerKg: effHpp,
          transactionId: parent.transactionId,
        }).run();
        createdIds.push(stkId);
      }
      // Mark parent as opened (no longer counted in stock)
      db.update(s.inventoryStock).set({ status: 'opened', openedAt: new Date(), updatedAt: new Date() }).where(eq(s.inventoryStock.id, parent.id)).run();
      return json({ data: { parentStockId: parent.id, childStockIds: createdIds } }, { status: 201 });
    }

    // GET /inventory/transactions - list movements
    if (route === '/inventory/transactions' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const type = url.searchParams.get('type');
      const conds = [];
      if (type && type !== 'all') conds.push(eq(s.inventoryTransaction.transactionType, type));
      let query = db.select().from(s.inventoryTransaction);
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.inventoryTransaction.transactionDate)).all();
      const enriched = rows.map(r => {
        const from = r.fromColdStorageId ? db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.fromColdStorageId)).get() : null;
        const to = r.toColdStorageId ? db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.toColdStorageId)).get() : null;
        return { ...r, fromCs: from, toCs: to };
      });
      return json({ data: enriched });
    }

    // ===== STOCK OPNAME =====
    // POST /opnames - create opname
    if (route === '/opnames' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.coldStorageId) return err('coldStorageId required');
      const id = uuidv4();
      db.insert(s.stockOpname).values({
        id, opnameNumber: nextOpnameNumber(),
        opnameDate: body.opnameDate ? new Date(body.opnameDate) : new Date(),
        coldStorageId: body.coldStorageId,
        status: 'draft',
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: new Date(),
      }).run();
      // Auto-populate items from active stocks in that CS
      const stocks = db.select().from(s.inventoryStock).where(and(eq(s.inventoryStock.coldStorageId, body.coldStorageId), eq(s.inventoryStock.status, 'active'))).all();
      for (const st of stocks) {
        db.insert(s.stockOpnameItems).values({
          id: uuidv4(), opnameId: id, stockId: st.id,
          systemQty: Number(st.quantity), systemWeight: Number(st.weight),
          physicalQty: Number(st.quantity), physicalWeight: Number(st.weight),
          deltaQty: 0, deltaWeight: 0,
        }).run();
      }
      return json({ data: db.select().from(s.stockOpname).where(eq(s.stockOpname.id, id)).get() }, { status: 201 });
    }
    // GET /opnames - list
    if (route === '/opnames' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const rows = db.select().from(s.stockOpname).orderBy(desc(s.stockOpname.createdAt)).all();
      const enriched = rows.map(r => {
        const cs = db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.coldStorageId)).get();
        const itemCount = db.select({ c: sql`count(*)` }).from(s.stockOpnameItems).where(eq(s.stockOpnameItems.opnameId, r.id)).get();
        return { ...r, coldStorage: cs, itemCount: Number(itemCount?.c || 0) };
      });
      return json({ data: enriched });
    }
    // GET /opnames/:id
    if (route.startsWith('/opnames/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const op = db.select().from(s.stockOpname).where(eq(s.stockOpname.id, id)).get();
      if (!op) return err('Not found', 404);
      const items = db.select().from(s.stockOpnameItems).where(eq(s.stockOpnameItems.opnameId, id)).all();
      const enrichedItems = items.map(it => {
        const st = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, it.stockId)).get();
        const p = st ? db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, st.productId)).get() : null;
        return { ...it, stock: st, product: p };
      });
      const cs = db.select().from(s.coldStorages).where(eq(s.coldStorages.id, op.coldStorageId)).get();
      return json({ data: { ...op, coldStorage: cs, items: enrichedItems } });
    }
    // PATCH /opnames/:id/items - update physical count in bulk
    if (route.startsWith('/opnames/') && path.length === 3 && path[2] === 'items' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const opId = path[1];
      const body = await request.json();
      if (!Array.isArray(body.items)) return err('items array required');
      for (const it of body.items) {
        const cur = db.select().from(s.stockOpnameItems).where(eq(s.stockOpnameItems.id, it.id)).get();
        if (!cur) continue;
        const physicalQty = Number(it.physicalQty ?? cur.physicalQty);
        const physicalWeight = Number(it.physicalWeight ?? cur.physicalWeight);
        db.update(s.stockOpnameItems).set({
          physicalQty, physicalWeight,
          deltaQty: physicalQty - Number(cur.systemQty),
          deltaWeight: physicalWeight - Number(cur.systemWeight),
          notes: it.notes ?? cur.notes,
        }).where(eq(s.stockOpnameItems.id, it.id)).run();
      }
      // Update aggregate deltas
      const all = db.select().from(s.stockOpnameItems).where(eq(s.stockOpnameItems.opnameId, opId)).all();
      const totalDW = all.reduce((a, b) => a + Number(b.deltaWeight || 0), 0);
      const totalDQ = all.reduce((a, b) => a + Number(b.deltaQty || 0), 0);
      db.update(s.stockOpname).set({ totalDeltaWeight: totalDW, totalDeltaQty: totalDQ }).where(eq(s.stockOpname.id, opId)).run();
      return json({ data: { ok: true, totalDeltaWeight: totalDW, totalDeltaQty: totalDQ } });
    }
    // POST /opnames/:id/submit - submit for approval
    if (route.startsWith('/opnames/') && path.length === 3 && path[2] === 'submit' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const op = db.select().from(s.stockOpname).where(eq(s.stockOpname.id, id)).get();
      if (!op) return err('Not found', 404);
      if (op.status !== 'draft') return err('Hanya draft yang bisa submit');
      db.update(s.stockOpname).set({ status: 'submitted', submittedAt: new Date() }).where(eq(s.stockOpname.id, id)).run();
      // Auto-create approval concern if variance is significant
      const absVarianceKg = Math.abs(Number(op.totalDeltaWeight || 0));
      if (absVarianceKg > 0.01) {
        const sign = Number(op.totalDeltaWeight || 0) > 0 ? '+' : '';
        createApproval({
          concernType: 'opname_variance',
          entityType: 'OPNAME',
          entityId: id,
          entityNumber: op.opnameNumber,
          title: `Stock Opname ${op.opnameNumber} · Variance ${sign}${Number(op.totalDeltaWeight).toFixed(2)} kg`,
          description: `Selisih fisik vs sistem: ${sign}${Number(op.totalDeltaWeight).toFixed(2)} kg · ${sign}${Number(op.totalDeltaQty || 0)} qty · perlu review sebelum adjustment diterapkan`,
          priority: absVarianceKg > 100 ? 'urgent' : absVarianceKg > 20 ? 'high' : 'normal',
          amount: 0,
          metadata: { opnameNumber: op.opnameNumber, totalDeltaWeight: op.totalDeltaWeight, totalDeltaQty: op.totalDeltaQty },
          createdBy: session.user.email,
        });
      }
      return json({ data: { ok: true, notification: { to: ['supervisor', 'direktur'], subject: `Stock Opname ${op.opnameNumber} menunggu approval` } } });
    }
    // POST /opnames/:id/approve - supervisor/admin approve -> create adjustment tx + update stocks
    if (route.startsWith('/opnames/') && path.length === 3 && path[2] === 'approve' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const op = db.select().from(s.stockOpname).where(eq(s.stockOpname.id, id)).get();
      if (!op) return err('Not found', 404);
      if (op.status !== 'submitted') return err('Hanya opname submitted yang bisa di-approve');
      const items = db.select().from(s.stockOpnameItems).where(eq(s.stockOpnameItems.opnameId, id)).all();
      // Create adjustment transaction
      const txId = uuidv4();
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(), transactionType: 'OPNAME_ADJ',
        baNumber: nextBaNumber('BA-OPN'), baType: 'opname_adj',
        referenceId: id, referenceType: 'OPNAME',
        fromColdStorageId: op.coldStorageId,
        totalWeight: Number(op.totalDeltaWeight),
        totalQuantity: Number(op.totalDeltaQty),
        notes: `Stock Opname adjustment ${op.opnameNumber}`,
        status: 'confirmed',
        approvedBy: session.user.email, approvedAt: new Date(),
        createdBy: op.createdBy, createdAt: new Date(),
      }).run();
      // Apply adjustments to stock quantities/weights
      for (const it of items) {
        if (it.deltaQty !== 0 || it.deltaWeight !== 0) {
          const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, it.stockId)).get();
          const dw = Number(it.deltaWeight || 0);
          const dq = Number(it.deltaQty || 0);
          recordLedger(db, {
            ledgerDate: new Date(),
            productId: stk?.productId,
            coldStorageId: op.coldStorageId,
            zoneId: stk?.zoneId || null,
            movementType: 'ADJ',
            referenceType: 'OPNAME',
            referenceId: id,
            referenceNumber: op.opnameNumber,
            weightIn: dw > 0 ? dw : 0,
            weightOut: dw < 0 ? -dw : 0,
            qtyIn: dq > 0 ? dq : 0,
            qtyOut: dq < 0 ? -dq : 0,
            hppPerKg: Number(stk?.hppPerKg || 0),
            kodeSimpan: stk?.kodeSimpan || null,
            stockId: it.stockId,
            createdBy: op.createdBy,
          });
          db.update(s.inventoryStock).set({
            quantity: Number(it.physicalQty),
            weight: Number(it.physicalWeight),
            updatedAt: new Date(),
          }).where(eq(s.inventoryStock.id, it.stockId)).run();
        }
      }
      db.update(s.stockOpname).set({ status: 'approved', approvedBy: session.user.email, approvedAt: new Date() }).where(eq(s.stockOpname.id, id)).run();
      return json({ data: { ok: true, transactionId: txId, notification: { to: ['direktur'], subject: `Stock Opname ${op.opnameNumber} disetujui, delta: ${op.totalDeltaWeight}kg` } } });
    }
    // POST /opnames/:id/reject
    if (route.startsWith('/opnames/') && path.length === 3 && path[2] === 'reject' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      db.update(s.stockOpname).set({ status: 'rejected', approvedBy: session.user.email, approvedAt: new Date() }).where(eq(s.stockOpname.id, id)).run();
      return json({ data: { ok: true } });
    }
    // ===================================================================== END INVENTORY

    // =====================================================================
    // DASHBOARD SUMMARY
    // =====================================================================
    if (route === '/dashboard/summary' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator', 'akuntan'])) return err('Forbidden', 403);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
      // Today sales (non-Cancelled)
      const todaySalesRow = db.select({ count: sql`count(*)`, total: sql`coalesce(sum(${s.salesOrder.totalAmount}), 0)` })
        .from(s.salesOrder).where(and(sql`${s.salesOrder.orderDate} >= ${todayStart}`, sql`${s.salesOrder.pipelineStatus} != 'Cancelled'`)).get();
      const todayPaidRow = db.select({ total: sql`coalesce(sum(amount), 0)` }).from(s.salesPayments).where(sql`payment_date >= ${todayStart}`).get();
      // Active WO
      const activeWoStages = db.select({ status: s.workOrder.pipelineStatus, count: sql`count(*)` }).from(s.workOrder).where(sql`${s.workOrder.pipelineStatus} in ('Draft','Disetujui','Dalam Proses')`).groupBy(s.workOrder.pipelineStatus).all();
      // Today production
      const todayWoRow = db.select({ count: sql`count(*)`, totalWeight: sql`coalesce(sum(total_rendemen_weight), 0)`, baseWeight: sql`coalesce(sum(total_live_bird_weight), 0)` })
        .from(s.workOrder).where(sql`arrival_recorded_at >= ${todayStart}`).get();
      // Low stock / near expired
      const nearExpiredCount = db.select({ c: sql`count(*)` }).from(s.inventoryStock).where(and(eq(s.inventoryStock.status, 'active'), sql`expired_date is not null and expired_date < ${Math.floor(Date.now()/1000) + 7*24*3600}`)).get();
      const expiredCount = db.select({ c: sql`count(*)` }).from(s.inventoryStock).where(and(eq(s.inventoryStock.status, 'active'), sql`expired_date is not null and expired_date < ${Math.floor(Date.now()/1000)}`)).get();
      const damagedCount = db.select({ c: sql`count(*)`, w: sql`coalesce(sum(weight), 0)` }).from(s.inventoryStock).where(eq(s.inventoryStock.status, 'damaged')).get();
      // AR (piutang: Invoiced SOs outstanding)
      const arRows = db.select().from(s.salesOrder).where(eq(s.salesOrder.pipelineStatus, 'Invoiced')).all();
      let totalAR = 0;
      for (const so of arRows) {
        const retSum = db.select({ s: sql`coalesce(sum(total_amount),0)` }).from(s.salesReturns).where(eq(s.salesReturns.salesOrderId, so.id)).get();
        totalAR += Math.max(0, Number(so.totalAmount) - Number(so.paidAmount || 0) - Number(retSum?.s || 0));
      }
      // AP (utang: PO not fully paid, status not Dibatalkan)
      const apRows = db.select().from(s.purchaseOrder).where(sql`pipeline_status not in ('Dibatalkan','Draft') and payment_status != 'paid'`).all();
      let totalAP = 0;
      for (const po of apRows) {
        const retSum = db.select({ s: sql`coalesce(sum(total_amount),0)` }).from(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, po.id)).get();
        totalAP += Math.max(0, Number(po.totalAmount) - Number(po.paidAmount || 0) - Number(retSum?.s || 0));
      }
      // Inventory value — MUST match the Inventory module: sum of per-lot (hpp_per_kg * weight)
      // for active stock (previously used product.basePrice which caused a mismatch with Inventory).
      const invValRow = db.get(sql`SELECT COALESCE(SUM(hpp_per_kg * weight), 0) AS v FROM inventory_stock WHERE status = 'active' AND (archived_at IS NULL)`);
      const inventoryValue = Number(invValRow?.v || 0);
      return json({ data: {
        todaySales: { count: Number(todaySalesRow?.count || 0), total: Number(todaySalesRow?.total || 0), paidToday: Number(todayPaidRow?.total || 0) },
        activeWo: activeWoStages.reduce((a, b) => ({ ...a, [b.status]: Number(b.count) }), {}),
        todayProduction: {
          count: Number(todayWoRow?.count || 0),
          rendemenWeight: Number(todayWoRow?.totalWeight || 0),
          baseWeight: Number(todayWoRow?.baseWeight || 0),
          efficiency: Number(todayWoRow?.baseWeight || 0) > 0 ? (Number(todayWoRow.totalWeight) / Number(todayWoRow.baseWeight)) * 100 : 0,
        },
        alerts: { nearExpired: Number(nearExpiredCount?.c || 0), expired: Number(expiredCount?.c || 0), damaged: { count: Number(damagedCount?.c || 0), weight: Number(damagedCount?.w || 0) } },
        finance: { totalAR, totalAP, netPosition: totalAR - totalAP },
        inventoryValue,
      } });
    }

    // GET /dashboard/supplier-shrinkage - rekap susut (Surat Jalan vs Tally) per supplier
    if (route === '/dashboard/supplier-shrinkage' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const poItems = db.select().from(s.purchaseOrderItems).all();
      const bySupplier = {};
      for (const it of poItems) {
        const sjW = Number(it.receivedWeight || 0);
        if (sjW <= 0) continue;
        const po = db.select({ id: s.purchaseOrder.id, supplierId: s.purchaseOrder.supplierId, status: s.purchaseOrder.pipelineStatus })
          .from(s.purchaseOrder).where(eq(s.purchaseOrder.id, it.purchaseOrderId)).get();
        if (!po || po.status === 'Dibatalkan') continue;
        const key = po.supplierId;
        if (!bySupplier[key]) bySupplier[key] = { supplierId: key, sjWeight: 0, tallyWeight: 0, sjTallied: 0, susut: 0, tallyItems: 0, poSet: new Set() };
        const tW = Number(it.tallyWeight || 0);
        bySupplier[key].sjWeight += sjW;
        bySupplier[key].tallyWeight += tW;
        // susut hanya untuk item yang SUDAH ditally (tally > 0); item belum ditally tidak dianggap susut
        if (tW > 0) {
          bySupplier[key].sjTallied += sjW;
          bySupplier[key].susut += (sjW - tW);
          bySupplier[key].tallyItems += 1;
        }
        bySupplier[key].poSet.add(po.id);
      }
      const rows = Object.values(bySupplier).map(r => {
        const c = db.select({ displayName: s.contacts.displayName, code: s.contacts.code }).from(s.contacts).where(eq(s.contacts.id, r.supplierId)).get();
        const sjWeight = Math.round(r.sjWeight * 100) / 100;
        const tallyWeight = Math.round(r.tallyWeight * 100) / 100;
        const sjTallied = Math.round(r.sjTallied * 100) / 100;
        const tallyDone = r.tallyItems > 0;
        const susut = tallyDone ? Math.round(r.susut * 100) / 100 : 0;
        // % susut dihitung atas dasar berat SJ item yang sudah ditally (bukan total SJ)
        const susutPct = (tallyDone && sjTallied > 0) ? Math.round((susut / sjTallied) * 1000) / 10 : null;
        return {
          supplierId: r.supplierId,
          supplierName: c?.displayName || '-',
          supplierCode: c?.code || '-',
          poCount: r.poSet.size,
          sjWeight, tallyWeight, sjTallied, tallyDone, susut, susutPct,
        };
      }).sort((a, b) => (b.susut) - (a.susut));
      const sumSjTallied = Math.round(rows.reduce((a, b) => a + b.sjTallied, 0) * 100) / 100;
      const totals = {
        sjWeight: Math.round(rows.reduce((a, b) => a + b.sjWeight, 0) * 100) / 100,
        tallyWeight: Math.round(rows.reduce((a, b) => a + b.tallyWeight, 0) * 100) / 100,
        sjTallied: sumSjTallied,
        susut: Math.round(rows.reduce((a, b) => a + b.susut, 0) * 100) / 100,
      };
      totals.susutPct = sumSjTallied > 0 ? Math.round((totals.susut / sumSjTallied) * 1000) / 10 : 0;
      return json({ data: rows, totals } );
    }

    // GET /dashboard/supplier-shrinkage/:supplierId - rincian susut per PO & produk untuk 1 supplier
    if (route.startsWith('/dashboard/supplier-shrinkage/') && path.length === 3 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const supplierId = path[2];
      const supplier = db.select({ displayName: s.contacts.displayName, code: s.contacts.code }).from(s.contacts).where(eq(s.contacts.id, supplierId)).get();
      const pos = db.select().from(s.purchaseOrder)
        .where(and(eq(s.purchaseOrder.supplierId, supplierId), ne(s.purchaseOrder.pipelineStatus, 'Dibatalkan'))).all();
      const productName = (pid) => {
        const p = db.select({ name: s.products.name, sku: s.products.sku }).from(s.products).where(eq(s.products.id, pid)).get();
        return { name: p?.name || '-', sku: p?.sku || '-' };
      };
      const poRows = [];
      for (const po of pos) {
        const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, po.id)).all();
        const relItems = items.filter(it => Number(it.receivedWeight || 0) > 0);
        if (relItems.length === 0) continue;
        const itemRows = relItems.map(it => {
          const pn = productName(it.productId);
          const sjW = Math.round(Number(it.receivedWeight || 0) * 100) / 100;
          const tW = Math.round(Number(it.tallyWeight || 0) * 100) / 100;
          const done = tW > 0;
          const su = done ? Math.round((sjW - tW) * 100) / 100 : 0;
          return { productId: it.productId, productName: pn.name, sku: pn.sku, sjWeight: sjW, tallyWeight: tW, tallyDone: done, susut: su, susutPct: (done && sjW > 0) ? Math.round((su / sjW) * 1000) / 10 : null };
        });
        const sjWeight = Math.round(itemRows.reduce((a, b) => a + b.sjWeight, 0) * 100) / 100;
        const tallyWeight = Math.round(itemRows.reduce((a, b) => a + b.tallyWeight, 0) * 100) / 100;
        // dasar % susut = SJ item yang sudah ditally saja
        const sjTallied = Math.round(itemRows.filter(i => i.tallyDone).reduce((a, b) => a + b.sjWeight, 0) * 100) / 100;
        const susut = Math.round(itemRows.reduce((a, b) => a + b.susut, 0) * 100) / 100;
        const tallyDone = sjTallied > 0;
        poRows.push({
          poId: po.id, poNumber: po.poNumber, status: po.pipelineStatus,
          orderDate: po.orderDate, sjWeight, tallyWeight, sjTallied, tallyDone, susut,
          susutPct: (tallyDone && sjTallied > 0) ? Math.round((susut / sjTallied) * 1000) / 10 : null,
          items: itemRows,
        });
      }
      poRows.sort((a, b) => (b.orderDate ? new Date(b.orderDate).getTime() : 0) - (a.orderDate ? new Date(a.orderDate).getTime() : 0));
      const sumSjTallied = Math.round(poRows.reduce((a, b) => a + (b.sjTallied || 0), 0) * 100) / 100;
      const totals = {
        sjWeight: Math.round(poRows.reduce((a, b) => a + b.sjWeight, 0) * 100) / 100,
        tallyWeight: Math.round(poRows.reduce((a, b) => a + b.tallyWeight, 0) * 100) / 100,
        susut: Math.round(poRows.reduce((a, b) => a + b.susut, 0) * 100) / 100,
      };
      totals.susutPct = sumSjTallied > 0 ? Math.round((totals.susut / sumSjTallied) * 1000) / 10 : 0;
      return json({ data: { supplier: { name: supplier?.displayName || '-', code: supplier?.code || '-' }, pos: poRows, totals } });
    }



    // =====================================================================
    // PURCHASE REPORTS
    // =====================================================================
    if (route === '/purchase-reports/by-supplier' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const rows = db.select({
        supplierId: s.purchaseOrder.supplierId,
        count: sql`count(*)`,
        total: sql`coalesce(sum(${s.purchaseOrder.totalAmount}), 0)`,
        paid: sql`coalesce(sum(${s.purchaseOrder.paidAmount}), 0)`,
      }).from(s.purchaseOrder).where(sql`${s.purchaseOrder.pipelineStatus} != 'Dibatalkan'`).groupBy(s.purchaseOrder.supplierId).all();
      const enriched = rows.map(r => {
        const c = db.select({ code: s.contacts.code, name: s.contacts.displayName, contactType: s.contacts.contactType }).from(s.contacts).where(eq(s.contacts.id, r.supplierId)).get();
        return { ...r, supplier: c, outstanding: Number(r.total) - Number(r.paid) };
      }).sort((a, b) => Number(b.total) - Number(a.total));
      return json({ data: enriched });
    }
    if (route === '/purchase-reports/ap-aging' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const pos = db.select().from(s.purchaseOrder).where(sql`pipeline_status not in ('Dibatalkan','Draft') and payment_status != 'paid'`).all();
      const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
      const details = [];
      const now = Date.now();
      for (const po of pos) {
        const retSum = db.select({ s: sql`coalesce(sum(total_amount),0)` }).from(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, po.id)).get();
        const outstanding = Number(po.totalAmount) - Number(po.paidAmount || 0) - Number(retSum?.s || 0);
        if (outstanding <= 0) continue;
        const invDate = po.invoiceDate ? new Date(po.invoiceDate).getTime() : (po.orderDate ? new Date(po.orderDate).getTime() : now);
        const daysOld = Math.max(0, Math.floor((now - invDate) / (24*60*60*1000)));
        let bucket = daysOld <= 30 ? '0-30' : daysOld <= 60 ? '31-60' : daysOld <= 90 ? '61-90' : '90+';
        buckets[bucket] += outstanding;
        const supplier = db.select({ code: s.contacts.code, name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, po.supplierId)).get();
        details.push({ poId: po.id, poNumber: po.poNumber, invoiceNumber: po.invoiceNumber, orderDate: po.orderDate, outstanding, daysOld, bucket, supplier });
      }
      return json({ data: { buckets, details, totalOutstanding: Object.values(buckets).reduce((a, b) => a + b, 0) } });
    }
    if (route === '/purchase-reports/susut-recap' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      // For Live Bird PO items with weight difference
      const pos = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.poType, 'Live Bird')).all();
      const details = [];
      let totalSusut = 0, totalValue = 0;
      for (const po of pos) {
        const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, po.id)).all();
        for (const it of items) {
          const susut = Math.max(0, Number(it.weightSupplier || 0) - Number(it.weightRph || 0));
          if (susut > 0) {
            const value = susut * Number(it.unitPrice || 0);
            totalSusut += susut; totalValue += value;
            const sup = db.select({ code: s.contacts.code, name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, po.supplierId)).get();
            const p = db.select({ sku: s.products.sku, name: s.products.name }).from(s.products).where(eq(s.products.id, it.productId)).get();
            details.push({ poNumber: po.poNumber, method: po.method, orderDate: po.orderDate, supplier: sup, product: p, weightSupplier: it.weightSupplier, weightRph: it.weightRph, susut, value });
          }
        }
      }
      return json({ data: { details, summary: { totalSusut, totalValue, count: details.length } } });
    }

    // =====================================================================
    // PRODUCTION REPORTS
    // =====================================================================
    if (route === '/production-reports/batches' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const rows = db.select().from(s.workOrder).orderBy(desc(s.workOrder.startDate)).all();
      const enriched = rows.map(r => {
        const rendemen = r.totalLiveBirdWeight > 0 ? (Number(r.totalRendemenWeight) / Number(r.totalLiveBirdWeight)) * 100 : 0;
        const avgHpp = r.totalRendemenWeight > 0 ? Number(r.totalCost) / Number(r.totalRendemenWeight) : 0;
        const maklon = r.maklonSupplierId ? db.select({ code: s.contacts.code, name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, r.maklonSupplierId)).get() : null;
        return { ...r, rendemenPct: rendemen, avgHppPerKg: avgHpp, maklon };
      });
      const summary = {
        totalBatches: enriched.length,
        totalBaseWeight: enriched.reduce((a, b) => a + Number(b.totalLiveBirdWeight || 0), 0),
        totalOutputWeight: enriched.reduce((a, b) => a + Number(b.totalRendemenWeight || 0), 0),
        totalCost: enriched.reduce((a, b) => a + Number(b.totalCost || 0), 0),
        avgRendemenPct: 0,
      };
      if (summary.totalBaseWeight > 0) summary.avgRendemenPct = (summary.totalOutputWeight / summary.totalBaseWeight) * 100;
      return json({ data: { batches: enriched, summary } });
    }
    if (route === '/production-reports/efficiency' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      // Compare actual output per output product across batches
      const rows = db.select({
        productId: s.woOutputs.productId,
        stage: s.woOutputs.stage,
        totalWeight: sql`coalesce(sum(${s.woOutputs.weight}), 0)`,
        avgHpp: sql`avg(${s.woOutputs.hppPerKg})`,
        avgCoef: sql`avg(${s.woOutputs.coefficient})`,
        count: sql`count(*)`,
      }).from(s.woOutputs).groupBy(s.woOutputs.productId, s.woOutputs.stage).all();
      const enriched = rows.map(r => {
        const p = db.select({ sku: s.products.sku, name: s.products.name, rendemenCoefficient: s.products.rendemenCoefficient }).from(s.products).where(eq(s.products.id, r.productId)).get();
        return { ...r, product: p };
      }).sort((a, b) => Number(b.totalWeight) - Number(a.totalWeight));
      return json({ data: enriched });
    }

    // =====================================================================
    // INVENTORY REPORTS
    // =====================================================================
    if (route === '/inventory-reports/by-cs' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      // Read DIRECTLY from MongoDB (source of truth) => identical across all replicas.
      const mdb = getMongoDb();
      const agg = await mdb.collection('inventory_stock').aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$cold_storage_id', rowCount: { $sum: 1 }, totalWeight: { $sum: { $ifNull: ['$weight', 0] } }, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } },
      ]).toArray();
      const csIds = agg.map(a => a._id).filter(Boolean);
      const css = csIds.length ? await mdb.collection('cold_storages').find({ _id: { $in: csIds } }).toArray() : [];
      const cmap = {}; for (const cc of css) cmap[cc._id] = cc;
      const enriched = agg.map(r => {
        const cs = cmap[r._id] || null;
        const coldStorage = cs ? { id: cs._id, code: cs.code, name: cs.name, capacityKg: Number(cs.capacityKg || 0) } : null;
        return { coldStorageId: r._id, rowCount: r.rowCount, totalWeight: Number(r.totalWeight || 0), totalQty: Number(r.totalQty || 0), coldStorage, utilization: coldStorage?.capacityKg > 0 ? (Number(r.totalWeight) / Number(coldStorage.capacityKg)) * 100 : 0 };
      });
      return json({ data: enriched });
    }
    if (route === '/inventory-reports/by-product' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      // Read DIRECTLY from MongoDB (source of truth) so results are IDENTICAL across all replicas
      // (avoids per-pod SQLite cache divergence that made this report fluctuate on refresh).
      const mdb = getMongoDb();
      const agg = await mdb.collection('inventory_stock').aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$product_id', rowCount: { $sum: 1 }, totalWeight: { $sum: { $ifNull: ['$weight', 0] } }, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } },
      ]).toArray();
      const prodIds = agg.map(a => a._id).filter(Boolean);
      const prods = prodIds.length ? await mdb.collection('products').find({ _id: { $in: prodIds } }).toArray() : [];
      const pmap = {}; for (const p of prods) pmap[p._id] = p;
      const enriched = agg.map(r => {
        const p = pmap[r._id] || null;
        const product = p ? { id: p._id, sku: p.sku, name: p.name, unit: p.unit, category: p.category, basePrice: Number(p.basePrice || 0), minStock: Number(p.minStock || 0) } : null;
        return { productId: r._id, rowCount: r.rowCount, totalWeight: Number(r.totalWeight || 0), totalQty: Number(r.totalQty || 0), product, minStock: Number(p?.minStock || 0), lowStock: Number(r.totalWeight) < Number(p?.minStock || 0), estimatedValue: Number(r.totalWeight) * Number(p?.basePrice || 0) };
      }).sort((a, b) => Number(b.totalWeight) - Number(a.totalWeight));
      return json({ data: enriched });
    }
    if (route === '/inventory-reports/near-expired' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator', 'akuntan'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const days = Number(url.searchParams.get('days') || 7);
      const threshold = Math.floor(Date.now() / 1000) + days * 24 * 3600;
      const rows = db.select().from(s.inventoryStock).where(and(
        eq(s.inventoryStock.status, 'active'),
        sql`expired_date is not null and expired_date < ${threshold}`,
      )).orderBy(s.inventoryStock.expiredDate).all();
      const enriched = rows.map(r => {
        const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, r.productId)).get();
        const cs = db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.coldStorageId)).get();
        const daysToExpire = r.expiredDate ? Math.floor((new Date(r.expiredDate).getTime() - Date.now()) / (24 * 3600 * 1000)) : null;
        return { ...r, product: p, coldStorage: cs, daysToExpire };
      });
      return json({ data: enriched });
    }
    if (route === '/inventory-reports/damage-recap' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'akuntan'])) return err('Forbidden', 403);
      const rows = db.select().from(s.inventoryTransaction).where(eq(s.inventoryTransaction.transactionType, 'DAMAGE')).orderBy(desc(s.inventoryTransaction.transactionDate)).all();
      const enriched = rows.map(r => ({ ...r, coldStorage: r.fromColdStorageId ? db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.fromColdStorageId)).get() : null }));
      const totalDamage = rows.filter(r => r.status === 'confirmed').reduce((a, b) => a + Number(b.totalWeight || 0), 0);
      return json({ data: { items: enriched, summary: { totalRows: rows.length, totalWeight: totalDamage } } });
    }
    // Kartu Stok (Stock Card) - per-product movement ledger with running balance
    if (route === '/inventory-reports/stock-card' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator', 'akuntan'])) return err('Forbidden', 403);
      await jmongo.ensureStockLedgerReady(getRawSqlite());
      const url = new URL(request.url);
      const productId = url.searchParams.get('productId');
      if (!productId) return err('productId required');
      const csId = url.searchParams.get('coldStorageId') || null;
      const fromStr = url.searchParams.get('from');
      const toStr = url.searchParams.get('to');
      const fromTs = fromStr ? new Date(`${fromStr}T00:00:00`).getTime() : null;
      const toTs = toStr ? new Date(`${toStr}T23:59:59.999`).getTime() : null;
      const conds = [eq(s.stockLedger.productId, productId)];
      if (csId) conds.push(eq(s.stockLedger.coldStorageId, csId));
      const allRows = db.select().from(s.stockLedger).where(and(...conds))
        .orderBy(s.stockLedger.ledgerDate, s.stockLedger.createdAt).all();
      // Opening balance = net of all rows strictly before `from`
      let openW = 0, openQ = 0;
      for (const r of allRows) {
        const t = new Date(r.ledgerDate).getTime();
        if (fromTs && t < fromTs) {
          openW += Number(r.weightIn || 0) - Number(r.weightOut || 0);
          openQ += Number(r.qtyIn || 0) - Number(r.qtyOut || 0);
        }
      }
      const csCache = {};
      const csOf = (cid) => {
        if (!cid) return null;
        if (csCache[cid] === undefined) csCache[cid] = db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, cid)).get() || null;
        return csCache[cid];
      };
      let runW = openW, runQ = openQ;
      let totalInW = 0, totalOutW = 0, totalInQ = 0, totalOutQ = 0;
      const movements = [];
      for (const r of allRows) {
        const t = new Date(r.ledgerDate).getTime();
        if (fromTs && t < fromTs) continue;
        if (toTs && t > toTs) continue;
        const wIn = Number(r.weightIn || 0), wOut = Number(r.weightOut || 0);
        const qIn = Number(r.qtyIn || 0), qOut = Number(r.qtyOut || 0);
        runW += wIn - wOut; runQ += qIn - qOut;
        totalInW += wIn; totalOutW += wOut; totalInQ += qIn; totalOutQ += qOut;
        movements.push({ ...r, coldStorage: csOf(r.coldStorageId), balanceWeight: Math.round(runW * 1000) / 1000, balanceQty: Math.round(runQ * 1000) / 1000 });
      }
      const product = db.select().from(s.products).where(eq(s.products.id, productId)).get();
      return json({ data: {
        product: product ? { id: product.id, sku: product.sku, name: product.name, unit: product.unit, category: product.category } : null,
        coldStorage: csId ? csOf(csId) : null,
        opening: { weight: Math.round(openW * 1000) / 1000, qty: Math.round(openQ * 1000) / 1000 },
        movements,
        summary: {
          totalInWeight: Math.round(totalInW * 1000) / 1000,
          totalOutWeight: Math.round(totalOutW * 1000) / 1000,
          totalInQty: Math.round(totalInQ * 1000) / 1000,
          totalOutQty: Math.round(totalOutQ * 1000) / 1000,
          closingWeight: Math.round(runW * 1000) / 1000,
          closingQty: Math.round(runQ * 1000) / 1000,
          count: movements.length,
        },
      } });
    }
    // Logbook Stok — SEMUA pergerakan stok (lintas produk) dengan filter. Untuk modul Inventory.
    if (route === '/stock-ledger' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      await jmongo.ensureStockLedgerReady(getRawSqlite());
      const url = new URL(request.url);
      const productId = url.searchParams.get('productId') || null;
      const csId = url.searchParams.get('coldStorageId') || null;
      const mType = url.searchParams.get('movementType') || null;
      const fromStr = url.searchParams.get('from');
      const toStr = url.searchParams.get('to');
      const limit = Math.min(Number(url.searchParams.get('limit') || 300), 1000);
      const fromTs = fromStr ? new Date(`${fromStr}T00:00:00`).getTime() : null;
      const toTs = toStr ? new Date(`${toStr}T23:59:59.999`).getTime() : null;
      const conds = [];
      if (productId) conds.push(eq(s.stockLedger.productId, productId));
      if (csId) conds.push(eq(s.stockLedger.coldStorageId, csId));
      if (mType) conds.push(eq(s.stockLedger.movementType, mType));
      let q = db.select().from(s.stockLedger);
      if (conds.length) q = q.where(and(...conds));
      let rows = q.orderBy(desc(s.stockLedger.ledgerDate), desc(s.stockLedger.createdAt)).all();
      rows = rows.filter(r => {
        const t = new Date(r.ledgerDate).getTime();
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
        return true;
      });
      const total = rows.length;
      let inW = 0, outW = 0, inQ = 0, outQ = 0;
      for (const r of rows) { inW += Number(r.weightIn || 0); outW += Number(r.weightOut || 0); inQ += Number(r.qtyIn || 0); outQ += Number(r.qtyOut || 0); }
      const pCache = {}, cCache = {};
      const pOf = (id) => { if (!id) return null; if (pCache[id] === undefined) pCache[id] = db.select({ name: s.products.name, sku: s.products.sku, unit: s.products.unit }).from(s.products).where(eq(s.products.id, id)).get() || null; return pCache[id]; };
      const cOf = (id) => { if (!id) return null; if (cCache[id] === undefined) cCache[id] = db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, id)).get() || null; return cCache[id]; };
      const page = rows.slice(0, limit).map(r => { const p = pOf(r.productId); const c = cOf(r.coldStorageId); return {
        id: r.id, ledgerDate: r.ledgerDate, movementType: r.movementType, referenceType: r.referenceType, referenceNumber: r.referenceNumber,
        productId: r.productId, productName: p?.name || '-', sku: p?.sku || '', unit: p?.unit || 'kg', csCode: c?.code || null, kodeSimpan: r.kodeSimpan,
        qtyIn: Number(r.qtyIn || 0), weightIn: Number(r.weightIn || 0), qtyOut: Number(r.qtyOut || 0), weightOut: Number(r.weightOut || 0), hppPerKg: Number(r.hppPerKg || 0), notes: r.notes,
      }; });
      return json({ data: { movements: page, total, returned: page.length, summary: {
        totalInWeight: Math.round(inW * 1000) / 1000, totalOutWeight: Math.round(outW * 1000) / 1000,
        totalInQty: Math.round(inQ * 1000) / 1000, totalOutQty: Math.round(outQ * 1000) / 1000, count: total,
      } } });
    }
    // ===================================================================== END REPORTS

    return err(`Route ${route} not found`, 404);
  } catch (e) {
    console.error('API Error:', e);
    return err('Internal server error: ' + e.message, 500);
  }
}

export const GET = handleRoute;

// Wrap mutating methods so a durable backup (to MongoDB) is scheduled after each
// successful write. No-op in environments without MONGO_URL (e.g. preview sandbox).
async function handleRouteWithBackup(request, ctx) {
  const res = await handleRoute(request, ctx);
  try {
    if (res && typeof res.status === 'number' && res.status < 400) {
      const { scheduleBackup } = await import('@/lib/db/persistence');
      scheduleBackup();
      // Phase 3: after a successful SO-affecting mutation, persist the affected SO aggregate to MongoDB
      // (per-SO upsert — concurrency-safe). Covers /sales-orders/* and /tally-outbound/orders/*.
      await persistSalesAfterMutation(request, res);
      // Phase 4: diff-persist any inventory_stock rows this request added/changed/removed (concurrency-safe).
      try { await invMongo.persistSnapshotDiff(request, getRawSqlite()); } catch { /* best-effort */ }
      // Phase 5: diff-persist any PO / commission / SO-extra rows this request changed (concurrency-safe).
      try { await potxMongo.persistSnapshotDiff(request, getRawSqlite()); } catch { /* best-effort */ }
      // Phase 6: diff-persist any fixed_assets / stock_opname rows this request changed (concurrency-safe).
      try { await assetsOpnameMongo.persistSnapshotDiff(request, getRawSqlite()); } catch { /* best-effort */ }
      // Phase 7: diff-persist any Work Order / approvals rows this request changed (concurrency-safe).
      try { await woApprovalMongo.persistSnapshotDiff(request, getRawSqlite()); } catch { /* best-effort */ }
      // Phase 9: diff-persist any tally_session(+items) / inventory_transaction rows this request changed.
      try { await tallyTxMongo.persistSnapshotDiff(request, getRawSqlite()); } catch { /* best-effort */ }
      // Phase 10: diff-persist any notifications / contact_customers / contact_documents / app_settings rows.
      try { await miscMongo.persistSnapshotDiff(request, getRawSqlite()); } catch { /* best-effort */ }
    }
  } catch { /* never let post-write hooks break the response */ }
  return res;
}

// Determine which SO id(s) a just-completed mutating request touched, then push
// that SO aggregate from the local SQLite mirror to MongoDB.
async function persistSalesAfterMutation(request, res) {
  try {
    const parts = new URL(request.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const p0 = parts[0];
    const soIds = [];
    if (p0 === 'sales-orders') {
      if (parts.length === 1) {
        // POST /sales-orders (create) -> new id is in the response body { data: { id } }
        try { const b = await res.clone().json(); if (b?.data?.id) soIds.push(b.data.id); } catch { /* ignore */ }
      } else if (parts[1]) {
        soIds.push(parts[1]);
      }
    } else if (p0 === 'tally-outbound' && parts[1] === 'orders' && parts[2]) {
      soIds.push(parts[2]);
    } else {
      return;
    }
    if (!soIds.length) return;
    const raw = getRawSqlite();
    for (const id of soIds) await salesMongo.persistSalesOrderToMongo(raw, id);
  } catch (e) { console.error('[sales-mongo] persistSalesAfterMutation failed:', e?.message || e); }
}

export const POST = handleRouteWithBackup;
export const PUT = handleRouteWithBackup;
export const PATCH = handleRouteWithBackup;
export const DELETE = handleRouteWithBackup;
