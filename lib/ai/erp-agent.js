// =============================================================
// ERP Agentic AI — tool definitions, executors & agent loop
// Uses emergentintegrations (Emergent LLM proxy) + Drizzle/SQLite
// =============================================================
import { LlmChat, UserMessage } from 'emergentintegrations';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, or, like, desc, asc, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import * as s from '@/lib/db/schema';

const MODEL = process.env.AI_MODEL || 'gpt-5.2';
const MAX_STEPS = 8;

// Roles allowed to perform write actions through the AI (each still confirmed by user).
// Matches the app's existing edit/archive permission model. Direktur & operator are read-only.
export const AI_WRITE_ROLES = ['admin', 'supervisor'];
// Roles allowed to read sensitive user-management data.
const AI_USER_READ_ROLES = ['admin', 'supervisor', 'direktur'];

export function canWrite(user) {
  return AI_WRITE_ROLES.includes(user?.role);
}

// -----------------------
// Formatting helpers
// -----------------------
const nf = new Intl.NumberFormat('id-ID');
function money(n) {
  const v = Number(n || 0);
  try { return 'Rp' + nf.format(Math.round(v)); } catch { return 'Rp' + Math.round(v); }
}
function num(n) {
  const v = Number(n || 0);
  try { return nf.format(v); } catch { return String(v); }
}
function dstr(d) {
  if (!d) return null;
  try {
    const date = d instanceof Date ? d : new Date(Number(d) * 1000);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  } catch { return null; }
}
function parseCats(row) {
  let cats = [];
  if (row?.categories) { try { cats = JSON.parse(row.categories); } catch { cats = []; } }
  if (!Array.isArray(cats)) cats = [];
  if (cats.length === 0 && row?.contactType) cats = [row.contactType];
  return cats;
}

// -----------------------
// READ tool executors
// -----------------------
function toolSearchContacts(db, args) {
  const q = (args.query || '').trim();
  const conds = [isNull(s.contacts.archivedAt)];
  if (q) conds.push(or(like(s.contacts.displayName, `%${q}%`), like(s.contacts.code, `%${q}%`), like(s.contacts.companyName, `%${q}%`), like(s.contacts.phone, `%${q}%`)));
  if (args.category) conds.push(or(like(s.contacts.categories, `%"${args.category}"%`), eq(s.contacts.contactType, args.category)));
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
  const rows = db.select().from(s.contacts).where(and(...conds)).orderBy(desc(s.contacts.createdAt)).limit(limit).all();
  return {
    ok: true,
    count: rows.length,
    contacts: rows.map(r => ({
      code: r.code, name: r.displayName, company: r.companyName || null,
      categories: parseCats(r), phone: r.phone || null, city: r.city || null,
      creditLimit: r.creditLimit, status: r.status,
    })),
  };
}

function toolSearchProducts(db, args) {
  const q = (args.query || '').trim();
  const conds = [isNull(s.products.archivedAt)];
  if (q) conds.push(or(like(s.products.name, `%${q}%`), like(s.products.sku, `%${q}%`)));
  if (args.category) conds.push(eq(s.products.category, args.category));
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
  const rows = db.select().from(s.products).where(and(...conds)).orderBy(desc(s.products.createdAt)).limit(limit).all();
  return {
    ok: true, count: rows.length,
    products: rows.map(r => ({
      sku: r.sku, name: r.name, category: r.category || null, subCategory: r.subCategory || null,
      unit: r.unit, basePrice: r.basePrice, minStock: r.minStock, status: r.status,
    })),
  };
}

function toolListColdStorages(db, args) {
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 50);
  const rows = db.select().from(s.coldStorages).where(isNull(s.coldStorages.archivedAt)).limit(limit).all();
  return {
    ok: true, count: rows.length,
    coldStorages: rows.map(r => ({ code: r.code, name: r.name, location: r.location || null, capacityKg: r.capacityKg, status: r.status })),
  };
}

function toolSearchSalesOrders(db, args) {
  const q = (args.query || '').trim();
  const conds = [isNull(s.salesOrder.archivedAt)];
  if (q) conds.push(like(s.salesOrder.soNumber, `%${q}%`));
  if (args.status) conds.push(eq(s.salesOrder.pipelineStatus, args.status));
  if (args.paymentStatus) conds.push(eq(s.salesOrder.paymentStatus, args.paymentStatus));
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
  const rows = db.select().from(s.salesOrder).where(and(...conds)).orderBy(desc(s.salesOrder.orderDate)).limit(limit).all();
  const custIds = [...new Set(rows.map(r => r.customerId))];
  const custMap = {};
  if (custIds.length) db.select({ id: s.contacts.id, name: s.contacts.displayName }).from(s.contacts).where(inArray(s.contacts.id, custIds)).all().forEach(c => { custMap[c.id] = c.name; });
  return {
    ok: true, count: rows.length,
    salesOrders: rows.map(r => ({
      soNumber: r.soNumber, customer: custMap[r.customerId] || r.customerId,
      orderDate: dstr(r.orderDate), status: r.pipelineStatus, paymentStatus: r.paymentStatus,
      totalAmount: r.totalAmount, paidAmount: r.paidAmount,
    })),
  };
}

function toolSearchPurchaseOrders(db, args) {
  const q = (args.query || '').trim();
  const conds = [isNull(s.purchaseOrder.archivedAt)];
  if (q) conds.push(like(s.purchaseOrder.poNumber, `%${q}%`));
  if (args.status) conds.push(eq(s.purchaseOrder.pipelineStatus, args.status));
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
  const rows = db.select().from(s.purchaseOrder).where(and(...conds)).orderBy(desc(s.purchaseOrder.orderDate)).limit(limit).all();
  const supIds = [...new Set(rows.map(r => r.supplierId))];
  const supMap = {};
  if (supIds.length) db.select({ id: s.contacts.id, name: s.contacts.displayName }).from(s.contacts).where(inArray(s.contacts.id, supIds)).all().forEach(c => { supMap[c.id] = c.name; });
  return {
    ok: true, count: rows.length,
    purchaseOrders: rows.map(r => ({
      poNumber: r.poNumber, supplier: supMap[r.supplierId] || r.supplierId, type: r.poType,
      orderDate: dstr(r.orderDate), status: r.pipelineStatus, paymentStatus: r.paymentStatus, totalAmount: r.totalAmount,
    })),
  };
}

function toolSearchWorkOrders(db, args) {
  const q = (args.query || '').trim();
  const conds = [isNull(s.workOrder.archivedAt)];
  if (q) conds.push(like(s.workOrder.woNumber, `%${q}%`));
  if (args.status) conds.push(eq(s.workOrder.pipelineStatus, args.status));
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
  const rows = db.select().from(s.workOrder).where(and(...conds)).orderBy(desc(s.workOrder.startDate)).limit(limit).all();
  return {
    ok: true, count: rows.length,
    workOrders: rows.map(r => ({
      woNumber: r.woNumber, mode: r.mode, startDate: dstr(r.startDate), status: r.pipelineStatus,
      totalCost: r.totalCost, totalRendemenWeight: r.totalRendemenWeight,
    })),
  };
}

function toolInventorySummary(db, args) {
  // Aggregate active stock by product.
  const conds = [isNull(s.inventoryStock.archivedAt), eq(s.inventoryStock.status, 'active')];
  const rows = db.select({
    productId: s.inventoryStock.productId,
    weight: sql`SUM(${s.inventoryStock.weight})`,
    qty: sql`SUM(${s.inventoryStock.quantity})`,
  }).from(s.inventoryStock).where(and(...conds)).groupBy(s.inventoryStock.productId).all();
  const prodIds = rows.map(r => r.productId);
  const prodMap = {};
  if (prodIds.length) db.select().from(s.products).where(inArray(s.products.id, prodIds)).all().forEach(p => { prodMap[p.id] = p; });
  let items = rows.map(r => {
    const p = prodMap[r.productId] || {};
    return {
      sku: p.sku || null, product: p.name || r.productId,
      totalWeightKg: Math.round((Number(r.weight) || 0) * 100) / 100,
      totalQty: Math.round((Number(r.qty) || 0) * 100) / 100,
      minStock: p.minStock || 0,
      belowMinStock: (p.minStock || 0) > 0 && (Number(r.weight) || 0) < (p.minStock || 0),
    };
  });
  const q = (args.productQuery || '').trim().toLowerCase();
  if (q) items = items.filter(i => (i.product || '').toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q));
  if (args.lowStockOnly) items = items.filter(i => i.belowMinStock);
  items.sort((a, b) => b.totalWeightKg - a.totalWeightKg);
  const totalWeight = items.reduce((a, b) => a + b.totalWeightKg, 0);
  return { ok: true, totalProducts: items.length, totalWeightKg: Math.round(totalWeight * 100) / 100, items: items.slice(0, 40) };
}

function toolListUsers(db, args, user) {
  if (!AI_USER_READ_ROLES.includes(user.role)) return { ok: false, code: 'FORBIDDEN', message: 'Anda tidak berhak melihat data user.' };
  const rows = db.select().from(s.user).where(isNull(s.user.archivedAt)).all();
  return { ok: true, count: rows.length, users: rows.map(r => ({ name: r.name, email: r.email, role: r.role, status: r.status })) };
}

function toolBusinessOverview(db) {
  const cnt = (tbl) => { try { return db.select({ c: sql`COUNT(*)` }).from(tbl).where(isNull(tbl.archivedAt)).all()[0]?.c || 0; } catch { return 0; } };
  const contacts = cnt(s.contacts);
  const products = cnt(s.products);
  const salesOrders = cnt(s.salesOrder);
  const purchaseOrders = cnt(s.purchaseOrder);
  const workOrders = cnt(s.workOrder);
  // Sales totals
  const soRows = db.select().from(s.salesOrder).where(isNull(s.salesOrder.archivedAt)).all();
  const totalSales = soRows.reduce((a, r) => a + (Number(r.totalAmount) || 0), 0);
  const outstandingAR = soRows.reduce((a, r) => a + Math.max(0, (Number(r.totalAmount) || 0) - (Number(r.paidAmount) || 0)), 0);
  const poRows = db.select().from(s.purchaseOrder).where(isNull(s.purchaseOrder.archivedAt)).all();
  const totalPurchase = poRows.reduce((a, r) => a + (Number(r.totalAmount) || 0), 0);
  const outstandingAP = poRows.reduce((a, r) => a + Math.max(0, (Number(r.totalAmount) || 0) - (Number(r.paidAmount) || 0)), 0);
  // Inventory total
  const invRows = db.select({ w: sql`SUM(${s.inventoryStock.weight})` }).from(s.inventoryStock).where(and(isNull(s.inventoryStock.archivedAt), eq(s.inventoryStock.status, 'active'))).all();
  const totalInvWeight = Math.round((Number(invRows[0]?.w) || 0) * 100) / 100;
  return {
    ok: true,
    counts: { contacts, products, salesOrders, purchaseOrders, workOrders },
    sales: { totalSalesValue: totalSales, outstandingReceivable: outstandingAR },
    purchase: { totalPurchaseValue: totalPurchase, outstandingPayable: outstandingAP },
    inventory: { totalActiveWeightKg: totalInvWeight },
    note: 'Nilai adalah akumulasi seluruh data aktif (belum difilter per periode).',
  };
}

// -----------------------
// WRITE tool preview builders (do NOT mutate — return confirmation payload)
// -----------------------
const SO_STATUSES = ['Draft', 'Confirmed', 'Packed', 'Shipped', 'Invoiced', 'Cancelled'];
const PO_STATUSES = ['Draft', 'Confirmed', 'Received', 'Invoiced', 'Cancelled'];
const WO_STATUSES = ['Draft', 'Disetujui', 'Dalam Proses', 'Selesai', 'Dibatalkan'];
const MODULE_TABLES = {
  contacts: { table: s.contacts, label: 'Kontak', numField: 'code' },
  products: { table: s.products, label: 'Produk', numField: 'sku' },
  'cold-storages': { table: s.coldStorages, label: 'Cold Storage', numField: 'code' },
  'sales-orders': { table: s.salesOrder, label: 'Sales Order', numField: 'soNumber' },
  'purchase-orders': { table: s.purchaseOrder, label: 'Purchase Order', numField: 'poNumber' },
  'work-orders': { table: s.workOrder, label: 'Work Order', numField: 'woNumber' },
};

function confirmPayload(action, summary, details) {
  return { ok: true, status: 'confirmation_required', action, summary, details: details || {} };
}

function previewCreateContact(args) {
  if (!args.displayName) return { ok: false, code: 'INVALID', message: 'Nama kontak (displayName) wajib diisi.' };
  const cat = args.category || 'Customer';
  return confirmPayload(
    { type: 'create_contact', args: { displayName: args.displayName, category: cat, phone: args.phone || null, email: args.email || null, address: args.address || null, city: args.city || null } },
    `Buat kontak baru: "${args.displayName}" (${cat})`,
    { Nama: args.displayName, Kategori: cat, Telepon: args.phone || '-', Kota: args.city || '-' },
  );
}

function previewCreateProduct(args) {
  if (!args.name) return { ok: false, code: 'INVALID', message: 'Nama produk wajib diisi.' };
  return confirmPayload(
    { type: 'create_product', args: { name: args.name, sku: args.sku || null, category: args.category || null, unit: args.unit || 'kg', basePrice: Number(args.basePrice) || 0, minStock: Number(args.minStock) || 0 } },
    `Buat produk baru: "${args.name}"`,
    { Nama: args.name, SKU: args.sku || '(otomatis)', Kategori: args.category || '-', Satuan: args.unit || 'kg', 'Harga Dasar': money(args.basePrice) },
  );
}

function previewUpdateOrderStatus(db, args) {
  const type = (args.orderType || '').toUpperCase();
  const number = (args.number || '').trim();
  const newStatus = (args.newStatus || '').trim();
  if (!type || !number || !newStatus) return { ok: false, code: 'INVALID', message: 'orderType, number, dan newStatus wajib diisi.' };
  let table, allowed, numField, label;
  if (type === 'SO') { table = s.salesOrder; allowed = SO_STATUSES; numField = s.salesOrder.soNumber; label = 'Sales Order'; }
  else if (type === 'PO') { table = s.purchaseOrder; allowed = PO_STATUSES; numField = s.purchaseOrder.poNumber; label = 'Purchase Order'; }
  else if (type === 'WO') { table = s.workOrder; allowed = WO_STATUSES; numField = s.workOrder.woNumber; label = 'Work Order'; }
  else return { ok: false, code: 'INVALID', message: 'orderType harus SO, PO, atau WO.' };
  if (!allowed.includes(newStatus)) return { ok: false, code: 'INVALID', message: `Status tidak valid untuk ${label}. Pilihan: ${allowed.join(', ')}.` };
  const row = db.select().from(table).where(eq(numField, number)).get();
  if (!row) return { ok: false, code: 'NOT_FOUND', message: `${label} ${number} tidak ditemukan.` };
  return confirmPayload(
    { type: 'update_order_status', args: { orderType: type, number, newStatus } },
    `Ubah status ${label} ${number}: ${row.pipelineStatus} → ${newStatus}`,
    { Dokumen: `${label} ${number}`, 'Status Sekarang': row.pipelineStatus, 'Status Baru': newStatus },
  );
}

function findByIdentifier(db, moduleKey, identifier) {
  const cfg = MODULE_TABLES[moduleKey];
  if (!cfg) return null;
  const id = (identifier || '').trim();
  const tbl = cfg.table;
  // Try natural key (code/number) first, then name/displayName.
  let row = db.select().from(tbl).where(eq(tbl[cfg.numField], id)).get();
  if (!row) {
    if (moduleKey === 'contacts') row = db.select().from(tbl).where(eq(tbl.displayName, id)).get();
    else if (moduleKey === 'products') row = db.select().from(tbl).where(eq(tbl.name, id)).get();
    else if (moduleKey === 'cold-storages') row = db.select().from(tbl).where(eq(tbl.name, id)).get();
  }
  return row;
}

function previewArchive(db, args, isArchive) {
  const moduleKey = args.module;
  const cfg = MODULE_TABLES[moduleKey];
  if (!cfg) return { ok: false, code: 'INVALID', message: `module tidak valid. Pilihan: ${Object.keys(MODULE_TABLES).join(', ')}.` };
  const row = findByIdentifier(db, moduleKey, args.identifier);
  if (!row) return { ok: false, code: 'NOT_FOUND', message: `${cfg.label} "${args.identifier}" tidak ditemukan.` };
  const label = row[cfg.numField] || row.displayName || row.name || row.id;
  if (isArchive && row.archivedAt) return { ok: false, code: 'ALREADY', message: `${cfg.label} ${label} sudah diarsipkan.` };
  if (!isArchive && !row.archivedAt) return { ok: false, code: 'ALREADY', message: `${cfg.label} ${label} sedang aktif (tidak perlu dipulihkan).` };
  return confirmPayload(
    { type: isArchive ? 'archive_record' : 'restore_record', args: { module: moduleKey, id: row.id } },
    `${isArchive ? 'Arsipkan' : 'Pulihkan'} ${cfg.label}: ${label}`,
    { Modul: cfg.label, Data: label },
  );
}

// -----------------------
// Local contact code generator (mirror of route.js logic)
// -----------------------
const CONTACT_CODE_PREFIX = { Supplier: 'SUP', Customer: 'CUST', Agen: 'AGN', Dropshipper: 'DS', RPH: 'RPH', Karyawan: 'EMP', Mitra: 'MTR' };
function genContactCode(db, category) {
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
function genSku(db) {
  const rows = db.select({ sku: s.products.sku }).from(s.products).all();
  const existing = new Set(rows.map(r => r.sku));
  let max = 0;
  for (const r of rows) { const m = /^PRD-(\d+)$/.exec(r.sku || ''); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } }
  let n = max + 1;
  let sku = `PRD-${String(n).padStart(3, '0')}`;
  while (existing.has(sku)) { n++; sku = `PRD-${String(n).padStart(3, '0')}`; }
  return sku;
}

// -----------------------
// Order helpers (resolve refs, numbering) — mirrors route.js logic
// -----------------------
function nextOrderNumber(db, kind) {
  const ym = new Date();
  const prefix = `${kind}/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
  const table = kind === 'PO' ? s.purchaseOrder : s.salesOrder;
  const col = kind === 'PO' ? s.purchaseOrder.poNumber : s.salesOrder.soNumber;
  const row = db.select({ c: sql`count(*)` }).from(table).where(like(col, `${prefix}%`)).get();
  return `${prefix}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
}
function resolveContact(db, term, categoryHint) {
  const t = (term || '').trim(); if (!t) return null;
  let row = db.select().from(s.contacts).where(and(isNull(s.contacts.archivedAt), eq(s.contacts.code, t))).get();
  if (!row) {
    const rows = db.select().from(s.contacts).where(and(isNull(s.contacts.archivedAt), or(like(s.contacts.displayName, `%${t}%`), like(s.contacts.companyName, `%${t}%`)))).all();
    if (categoryHint) { const pref = rows.filter(r => parseCats(r).includes(categoryHint)); row = pref[0] || rows[0]; }
    else row = rows[0];
  }
  return row || null;
}
function resolveProduct(db, term) {
  const t = (term || '').trim(); if (!t) return null;
  let row = db.select().from(s.products).where(and(isNull(s.products.archivedAt), eq(s.products.sku, t))).get();
  if (!row) {
    const rows = db.select().from(s.products).where(and(isNull(s.products.archivedAt), or(like(s.products.name, `%${t}%`), like(s.products.sku, `%${t}%`)))).all();
    row = rows[0];
  }
  return row || null;
}
// Resolve a list of order items into {productId, productName, quantity, weight, unitPrice, discount}.
function resolveOrderItems(db, items, withDiscount) {
  const resolved = [];
  const notFound = [];
  let total = 0;
  const detailLines = {};
  for (const it of (Array.isArray(items) ? items : [])) {
    const p = resolveProduct(db, it.product);
    if (!p) { notFound.push(it.product); continue; }
    const quantity = Number(it.quantity || 0);
    const weight = Number(it.weight || 0);
    const basis = weight || quantity;
    const unitPrice = it.unitPrice != null && it.unitPrice !== '' ? Number(it.unitPrice) : Number(p.basePrice || 0);
    const discount = withDiscount ? Number(it.discount || 0) : 0;
    const line = unitPrice * basis - discount;
    total += line;
    resolved.push({ productId: p.id, productName: p.name, sku: p.sku, quantity, weight, unitPrice, discount });
    const basisLabel = weight ? `${num(weight)} kg` : `${num(quantity)} unit`;
    detailLines[`${p.name}`] = `${basisLabel} × ${money(unitPrice)}${discount ? ` − ${money(discount)}` : ''} = ${money(line)}`;
  }
  return { resolved, notFound, total, detailLines };
}

function previewCreatePurchaseOrder(db, args) {
  const sup = resolveContact(db, args.supplier, 'Supplier');
  if (!sup) return { ok: false, code: 'NOT_FOUND', message: `Supplier "${args.supplier}" tidak ditemukan. Sebutkan nama/kode supplier yang valid.` };
  const { resolved, notFound, total, detailLines } = resolveOrderItems(db, args.items, false);
  if (notFound.length) return { ok: false, code: 'NOT_FOUND', message: `Produk tidak ditemukan: ${notFound.join(', ')}. Mohon perbaiki nama/SKU produk.` };
  if (resolved.length === 0) return { ok: false, code: 'INVALID', message: 'Minimal 1 item produk diperlukan (sebutkan produk, jumlah/berat, dan harga).' };
  const poType = args.poType || 'Bahan Baku';
  return confirmPayload(
    { type: 'create_purchase_order', args: { supplierId: sup.id, supplierName: sup.displayName, poType, notes: args.notes || null, items: resolved } },
    `Buat draft Purchase Order ke ${sup.displayName} — ${resolved.length} item, total ${money(total)}`,
    { Supplier: `${sup.displayName} (${sup.code})`, Tipe: poType, ...detailLines, 'TOTAL': money(total) },
  );
}

function previewCreateSalesOrder(db, args) {
  const cust = resolveContact(db, args.customer, 'Customer');
  if (!cust) return { ok: false, code: 'NOT_FOUND', message: `Customer "${args.customer}" tidak ditemukan. Sebutkan nama/kode customer yang valid.` };
  const { resolved, notFound, total, detailLines } = resolveOrderItems(db, args.items, true);
  if (notFound.length) return { ok: false, code: 'NOT_FOUND', message: `Produk tidak ditemukan: ${notFound.join(', ')}. Mohon perbaiki nama/SKU produk.` };
  if (resolved.length === 0) return { ok: false, code: 'INVALID', message: 'Minimal 1 item produk diperlukan (sebutkan produk, jumlah/berat, dan harga).' };
  return confirmPayload(
    { type: 'create_sales_order', args: { customerId: cust.id, customerName: cust.displayName, notes: args.notes || null, items: resolved } },
    `Buat draft Sales Order untuk ${cust.displayName} — ${resolved.length} item, total ${money(total)}`,
    { Customer: `${cust.displayName} (${cust.code})`, ...detailLines, 'TOTAL': money(total) },
  );
}

function previewOpenOrderBuilder(args) {
  let orderType = (args.orderType || '').toUpperCase();
  if (orderType !== 'SO' && orderType !== 'PO') orderType = null;
  return { ok: true, status: 'ui_builder', builder: { orderType } };
}

// -----------------------
// executeAction — the REAL mutation (called after user confirmation)
// Re-validates role & performs the DB write. Returns a result summary.
// -----------------------
export function executeAction({ action, user }) {
  if (!canWrite(user)) return { ok: false, message: 'Peran Anda tidak diizinkan melakukan aksi tulis.' };
  const db = getDb();
  const now = new Date();
  try {
    switch (action?.type) {
      case 'create_contact': {
        const a = action.args || {};
        if (!a.displayName) return { ok: false, message: 'Nama kontak kosong.' };
        const cat = a.category || 'Customer';
        const code = genContactCode(db, cat);
        const id = uuidv4();
        db.insert(s.contacts).values({
          id, contactType: cat, categories: JSON.stringify([cat]), code,
          displayName: a.displayName, companyName: a.companyName || null,
          phone: a.phone || null, email: a.email || null, address: a.address || null, city: a.city || null,
          status: 'active', createdAt: now, updatedAt: now,
        }).run();
        return { ok: true, message: `Kontak "${a.displayName}" berhasil dibuat (kode ${code}).`, ref: code, link: `/dashboard/contacts` };
      }
      case 'create_product': {
        const a = action.args || {};
        if (!a.name) return { ok: false, message: 'Nama produk kosong.' };
        let sku = (a.sku || '').trim();
        if (!sku) sku = genSku(db);
        const exists = db.select().from(s.products).where(eq(s.products.sku, sku)).get();
        if (exists) return { ok: false, message: `SKU ${sku} sudah dipakai.` };
        const id = uuidv4();
        db.insert(s.products).values({
          id, sku, name: a.name, category: a.category || null, unit: a.unit || 'kg',
          basePrice: Number(a.basePrice) || 0, minStock: Number(a.minStock) || 0,
          status: 'active', createdAt: now, updatedAt: now,
        }).run();
        return { ok: true, message: `Produk "${a.name}" berhasil dibuat (SKU ${sku}).`, ref: sku, link: `/dashboard/products` };
      }
      case 'update_order_status': {
        const a = action.args || {};
        const type = (a.orderType || '').toUpperCase();
        let table, allowed, numField, label;
        if (type === 'SO') { table = s.salesOrder; allowed = SO_STATUSES; numField = s.salesOrder.soNumber; label = 'Sales Order'; }
        else if (type === 'PO') { table = s.purchaseOrder; allowed = PO_STATUSES; numField = s.purchaseOrder.poNumber; label = 'Purchase Order'; }
        else if (type === 'WO') { table = s.workOrder; allowed = WO_STATUSES; numField = s.workOrder.woNumber; label = 'Work Order'; }
        else return { ok: false, message: 'orderType tidak valid.' };
        if (!allowed.includes(a.newStatus)) return { ok: false, message: 'Status tidak valid.' };
        const row = db.select().from(table).where(eq(numField, a.number)).get();
        if (!row) return { ok: false, message: `${label} ${a.number} tidak ditemukan.` };
        db.update(table).set({ pipelineStatus: a.newStatus, updatedAt: now }).where(eq(numField, a.number)).run();
        return { ok: true, message: `Status ${label} ${a.number} diubah menjadi "${a.newStatus}".`, ref: a.number };
      }
      case 'archive_record':
      case 'restore_record': {
        const a = action.args || {};
        const cfg = MODULE_TABLES[a.module];
        if (!cfg) return { ok: false, message: 'Modul tidak valid.' };
        const row = db.select().from(cfg.table).where(eq(cfg.table.id, a.id)).get();
        if (!row) return { ok: false, message: 'Data tidak ditemukan.' };
        const isArchive = action.type === 'archive_record';
        db.update(cfg.table).set({ archivedAt: isArchive ? now : null, updatedAt: now }).where(eq(cfg.table.id, a.id)).run();
        const label = row[cfg.numField] || row.displayName || row.name || row.id;
        return { ok: true, message: `${cfg.label} ${label} berhasil ${isArchive ? 'diarsipkan' : 'dipulihkan'}.`, ref: label };
      }
      case 'create_purchase_order': {
        const a = action.args || {};
        if (!a.supplierId || !Array.isArray(a.items) || a.items.length === 0) return { ok: false, message: 'Supplier & item wajib ada.' };
        const id = uuidv4();
        const poNumber = nextOrderNumber(db, 'PO');
        const poType = a.poType || 'Bahan Baku';
        db.insert(s.purchaseOrder).values({
          id, poNumber, supplierId: a.supplierId, poType,
          method: poType === 'Live Bird' ? 'Timbang Ulang' : null,
          orderDate: now, pipelineStatus: 'Draft', isDropship: false,
          additionalCost: 0, dpAmount: 0, notes: a.notes || null,
          createdBy: user.email, createdAt: now, updatedAt: now,
        }).run();
        let total = 0;
        for (const it of a.items) {
          const basis = Number(it.weight || it.quantity || 0);
          const price = Number(it.unitPrice || 0);
          const cost = price * basis;
          db.insert(s.purchaseOrderItems).values({
            id: uuidv4(), purchaseOrderId: id, productId: it.productId,
            quantity: Number(it.quantity || 0), weight: Number(it.weight || 0),
            unitPrice: price, hppPerKg: basis > 0 ? cost / basis : 0,
          }).run();
          total += cost;
        }
        db.update(s.purchaseOrder).set({ totalAmount: total, updatedAt: now }).where(eq(s.purchaseOrder.id, id)).run();
        return { ok: true, message: `Draft Purchase Order ${poNumber} berhasil dibuat (${a.items.length} item, total ${money(total)}).`, ref: poNumber, link: `/dashboard/purchase-orders/${id}` };
      }
      case 'create_sales_order': {
        const a = action.args || {};
        if (!a.customerId || !Array.isArray(a.items) || a.items.length === 0) return { ok: false, message: 'Customer & item wajib ada.' };
        const id = uuidv4();
        const soNumber = nextOrderNumber(db, 'SO');
        db.insert(s.salesOrder).values({
          id, soNumber, customerId: a.customerId, orderDate: now,
          pipelineStatus: 'Draft', fulfillmentType: 'stock',
          dpAmount: 0, notes: a.notes || null,
          createdBy: user.email, createdAt: now, updatedAt: now,
        }).run();
        let total = 0, discTotal = 0;
        for (const it of a.items) {
          const basis = Number(it.weight || it.quantity || 0);
          const price = Number(it.unitPrice || 0);
          const disc = Number(it.discount || 0);
          const line = price * basis;
          db.insert(s.salesOrderItems).values({
            id: uuidv4(), salesOrderId: id, productId: it.productId,
            quantity: Number(it.quantity || 0), weight: Number(it.weight || 0),
            unitPrice: price, discount: disc, subtotal: line - disc,
          }).run();
          total += line - disc; discTotal += disc;
        }
        db.update(s.salesOrder).set({ totalAmount: total, discountTotal: discTotal, updatedAt: now }).where(eq(s.salesOrder.id, id)).run();
        return { ok: true, message: `Draft Sales Order ${soNumber} berhasil dibuat (${a.items.length} item, total ${money(total)}).`, ref: soNumber, link: `/dashboard/sales-orders/${id}` };
      }
      default:
        return { ok: false, message: 'Jenis aksi tidak dikenal.' };
    }
  } catch (e) {
    return { ok: false, message: 'Gagal menjalankan aksi: ' + String(e?.message || e) };
  }
}

// -----------------------
// Tool schema definitions
// -----------------------
function fn(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required: required || [], additionalProperties: false } } };
}

const READ_TOOLS = [
  fn('search_contacts', 'Cari data kontak (Supplier, Customer, Agen, Dropshipper, RPH, Karyawan, Mitra).',
    { query: { type: ['string', 'null'], description: 'kata kunci nama/kode/telepon' }, category: { type: ['string', 'null'], description: 'Supplier|Customer|Agen|Dropshipper|RPH|Karyawan|Mitra' }, limit: { type: ['integer', 'null'] } }, ['query', 'category', 'limit']),
  fn('search_products', 'Cari data produk berdasarkan nama atau SKU.',
    { query: { type: ['string', 'null'] }, category: { type: ['string', 'null'], description: 'raw|WIP|FG|merch' }, limit: { type: ['integer', 'null'] } }, ['query', 'category', 'limit']),
  fn('list_cold_storages', 'Daftar gudang / cold storage.', { limit: { type: ['integer', 'null'] } }, ['limit']),
  fn('search_sales_orders', 'Cari Sales Order (penjualan). Bisa filter status pipeline & status pembayaran.',
    { query: { type: ['string', 'null'], description: 'nomor SO' }, status: { type: ['string', 'null'], description: 'Draft|Confirmed|Packed|Shipped|Invoiced|Cancelled' }, paymentStatus: { type: ['string', 'null'], description: 'unpaid|partial|paid' }, limit: { type: ['integer', 'null'] } }, ['query', 'status', 'paymentStatus', 'limit']),
  fn('search_purchase_orders', 'Cari Purchase Order (pembelian).',
    { query: { type: ['string', 'null'], description: 'nomor PO' }, status: { type: ['string', 'null'] }, limit: { type: ['integer', 'null'] } }, ['query', 'status', 'limit']),
  fn('search_work_orders', 'Cari Work Order (produksi).',
    { query: { type: ['string', 'null'], description: 'nomor WO' }, status: { type: ['string', 'null'] }, limit: { type: ['integer', 'null'] } }, ['query', 'status', 'limit']),
  fn('get_inventory_summary', 'Ringkasan stok inventory (total berat & qty per produk, deteksi stok di bawah minimum).',
    { productQuery: { type: ['string', 'null'], description: 'filter nama/SKU produk' }, lowStockOnly: { type: ['boolean', 'null'] } }, ['productQuery', 'lowStockOnly']),
  fn('list_users', 'Daftar pengguna sistem (hanya untuk manajemen).', { limit: { type: ['integer', 'null'] } }, ['limit']),
  fn('get_business_overview', 'Ringkasan bisnis menyeluruh: jumlah data per modul, total penjualan, piutang, pembelian, utang, total stok.', {}, []),
];

const WRITE_TOOLS = [
  fn('create_contact', 'Siapkan pembuatan kontak baru (butuh konfirmasi user sebelum disimpan).',
    { displayName: { type: 'string' }, category: { type: ['string', 'null'], description: 'Supplier|Customer|Agen|Dropshipper|RPH|Karyawan|Mitra' }, phone: { type: ['string', 'null'] }, email: { type: ['string', 'null'] }, address: { type: ['string', 'null'] }, city: { type: ['string', 'null'] } }, ['displayName', 'category', 'phone', 'email', 'address', 'city']),
  fn('create_product', 'Siapkan pembuatan produk baru (butuh konfirmasi user sebelum disimpan).',
    { name: { type: 'string' }, sku: { type: ['string', 'null'] }, category: { type: ['string', 'null'] }, unit: { type: ['string', 'null'] }, basePrice: { type: ['number', 'null'] }, minStock: { type: ['number', 'null'] } }, ['name', 'sku', 'category', 'unit', 'basePrice', 'minStock']),
  fn('update_order_status', 'Siapkan perubahan status pipeline sebuah order (butuh konfirmasi user).',
    { orderType: { type: 'string', description: 'SO|PO|WO' }, number: { type: 'string', description: 'nomor dokumen' }, newStatus: { type: 'string' } }, ['orderType', 'number', 'newStatus']),
  fn('archive_record', 'Siapkan pengarsipan (soft-delete) sebuah data (butuh konfirmasi user).',
    { module: { type: 'string', description: 'contacts|products|cold-storages|sales-orders|purchase-orders|work-orders' }, identifier: { type: 'string', description: 'kode/nomor/nama data' } }, ['module', 'identifier']),
  fn('restore_record', 'Siapkan pemulihan data yang diarsipkan (butuh konfirmasi user).',
    { module: { type: 'string' }, identifier: { type: 'string' } }, ['module', 'identifier']),
  fn('open_order_builder', 'Tampilkan FORMULIR INTERAKTIF dengan dropdown pilihan untuk membuat Purchase Order (PO) atau Sales Order (SO). Panggil ini setiap kali user ingin membuat PO/SO, agar user memilih customer/supplier/dropshipper/produk lewat dropdown (bukan mengetik). Lebih disukai daripada create_purchase_order/create_sales_order kecuali user sudah menyebutkan SEMUA detail lengkap dalam teks.',
    { orderType: { type: ['string', 'null'], description: "'SO' untuk Sales Order, 'PO' untuk Purchase Order, atau null jika belum ditentukan (form akan menanyakan)" } }, ['orderType']),
  {
    type: 'function',
    function: {
      name: 'create_purchase_order',
      description: 'Siapkan pembuatan DRAFT Purchase Order (pembelian) lengkap dengan item (butuh konfirmasi user). Tanyakan supplier, daftar produk beserta jumlah/berat dan harga sebelum memanggil tool ini.',
      parameters: {
        type: 'object',
        properties: {
          supplier: { type: 'string', description: 'nama atau kode supplier' },
          poType: { type: ['string', 'null'], description: 'Live Bird|Packaging|Bahan Baku|Produk Jadi|Operasional (default Bahan Baku)' },
          notes: { type: ['string', 'null'] },
          items: {
            type: 'array',
            description: 'daftar item pembelian',
            items: {
              type: 'object',
              properties: {
                product: { type: 'string', description: 'nama atau SKU produk' },
                quantity: { type: ['number', 'null'], description: 'jumlah unit' },
                weight: { type: ['number', 'null'], description: 'berat kg' },
                unitPrice: { type: ['number', 'null'], description: 'harga per kg/unit (opsional, default harga dasar produk)' },
              },
              required: ['product', 'quantity', 'weight', 'unitPrice'],
              additionalProperties: false,
            },
          },
        },
        required: ['supplier', 'poType', 'notes', 'items'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_sales_order',
      description: 'Siapkan pembuatan DRAFT Sales Order (penjualan) lengkap dengan item (butuh konfirmasi user). Tanyakan customer, daftar produk beserta jumlah/berat, harga, dan diskon (opsional) sebelum memanggil tool ini.',
      parameters: {
        type: 'object',
        properties: {
          customer: { type: 'string', description: 'nama atau kode customer' },
          notes: { type: ['string', 'null'] },
          items: {
            type: 'array',
            description: 'daftar item penjualan',
            items: {
              type: 'object',
              properties: {
                product: { type: 'string', description: 'nama atau SKU produk' },
                quantity: { type: ['number', 'null'] },
                weight: { type: ['number', 'null'], description: 'berat kg' },
                unitPrice: { type: ['number', 'null'], description: 'harga jual (opsional, default harga dasar produk)' },
                discount: { type: ['number', 'null'], description: 'diskon nominal per baris (opsional)' },
              },
              required: ['product', 'quantity', 'weight', 'unitPrice', 'discount'],
              additionalProperties: false,
            },
          },
        },
        required: ['customer', 'notes', 'items'],
        additionalProperties: false,
      },
    },
  },
];

function getTools(user) {
  return canWrite(user) ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS];
}

// -----------------------
// Tool dispatcher (read tools execute; write tools return confirmation payloads)
// -----------------------
function executeTool(name, args, user) {
  const db = getDb();
  switch (name) {
    case 'search_contacts': return toolSearchContacts(db, args);
    case 'search_products': return toolSearchProducts(db, args);
    case 'list_cold_storages': return toolListColdStorages(db, args);
    case 'search_sales_orders': return toolSearchSalesOrders(db, args);
    case 'search_purchase_orders': return toolSearchPurchaseOrders(db, args);
    case 'search_work_orders': return toolSearchWorkOrders(db, args);
    case 'get_inventory_summary': return toolInventorySummary(db, args);
    case 'list_users': return toolListUsers(db, args, user);
    case 'get_business_overview': return toolBusinessOverview(db);
    // WRITE (preview only)
    case 'create_contact':
    case 'create_product':
    case 'update_order_status':
    case 'archive_record':
    case 'restore_record':
    case 'create_purchase_order':
    case 'create_sales_order':
    case 'open_order_builder':
      if (!canWrite(user)) return { ok: false, code: 'FORBIDDEN', message: 'Peran Anda hanya bisa membaca data, tidak bisa melakukan aksi.' };
      if (name === 'create_contact') return previewCreateContact(args);
      if (name === 'create_product') return previewCreateProduct(args);
      if (name === 'update_order_status') return previewUpdateOrderStatus(db, args);
      if (name === 'archive_record') return previewArchive(db, args, true);
      if (name === 'restore_record') return previewArchive(db, args, false);
      if (name === 'create_purchase_order') return previewCreatePurchaseOrder(db, args);
      if (name === 'create_sales_order') return previewCreateSalesOrder(db, args);
      if (name === 'open_order_builder') return previewOpenOrderBuilder(args);
      return { ok: false, code: 'UNKNOWN', message: 'Aksi tidak dikenal.' };
    default:
      return { ok: false, code: 'UNKNOWN_TOOL', message: 'Tool tidak dikenal.' };
  }
}

// -----------------------
// System prompt
// -----------------------
function buildSystemPrompt(user) {
  const today = new Date().toISOString().slice(0, 10);
  const writer = canWrite(user);
  return `Anda adalah "Asisten ERP", asisten AI untuk sistem ERP PT Ladang Pangan Indonesia (perusahaan pengolahan ayam/pangan).
Tanggal hari ini: ${today}.
Pengguna saat ini: ${user.name || user.email} (peran: ${user.role}).

PERAN & IZIN:
- ${writer ? 'Pengguna ini BOLEH melakukan aksi tulis (buat data, ubah status, arsip) — TAPI setiap aksi tulis WAJIB dikonfirmasi pengguna melalui tombol konfirmasi.' : 'Pengguna ini HANYA boleh membaca data (read-only). Anda TIDAK memiliki tool untuk mengubah data. Jika diminta melakukan aksi, jelaskan dengan sopan bahwa peran mereka tidak diizinkan.'}

ATURAN PENTING:
1. SELALU gunakan tool untuk mengambil fakta dari database. JANGAN mengarang data, angka, atau nomor dokumen.
2. Untuk pertanyaan data, panggil tool yang sesuai lalu rangkum jawabannya dengan ringkas dan rapi (gunakan poin/tabel bila perlu).
3. Format angka uang dalam Rupiah (contoh: Rp1.250.000) dan berat dalam kg.
4. Untuk AKSI TULIS: panggil tool aksi yang sesuai SATU KALI. Tool akan mengembalikan status "confirmation_required" beserta ringkasan. Setelah itu, JANGAN panggil tool lagi — cukup jelaskan secara singkat aksi yang akan dilakukan dan beri tahu pengguna untuk menekan tombol "Konfirmasi" di bawah pesan. Sistem yang akan mengeksekusi setelah pengguna menekan konfirmasi.
5. Jika tool mengembalikan error (NOT_FOUND, INVALID, FORBIDDEN), jelaskan masalahnya dengan bahasa yang jelas dan sarankan langkah berikutnya. Jangan mengulang aksi destruktif otomatis.
6. Jawab SELALU dalam Bahasa Indonesia yang ringkas, profesional, dan ramah.
7. Jika pertanyaan ambigu, tanyakan klarifikasi singkat.
8. MEMBUAT ORDER (Purchase Order / Sales Order): PRIORITASKAN memanggil tool open_order_builder untuk menampilkan FORMULIR INTERAKTIF berisi dropdown (pilih customer/supplier/dropshipper/produk, jenis order, dll) sehingga user cukup memilih tanpa mengetik panjang. Tentukan orderType ('SO' atau 'PO') dari maksud user; jika belum jelas, kirim null. Setelah memanggil open_order_builder, cukup beri kalimat singkat mempersilakan user melengkapi formulir di bawah — JANGAN menanyakan detail satu per satu lewat teks. Gunakan tool create_purchase_order/create_sales_order (alur konfirmasi teks) HANYA bila user sudah menyebutkan seluruh detail lengkap dan meminta langsung dibuat.`;
}

// -----------------------
// Main agent loop
// -----------------------
export async function runAgent({ message, history = [], user, sessionId }) {
  const KEY = process.env.EMERGENT_LLM_KEY;
  if (!KEY) return { ok: false, error: 'EMERGENT_LLM_KEY belum dikonfigurasi.' };

  const systemPrompt = buildSystemPrompt(user);
  // Seed history (initialMessages REPLACES the system message, so include it first).
  const initial = [{ role: 'system', content: systemPrompt }];
  const recent = Array.isArray(history) ? history.slice(-10) : [];
  for (const h of recent) {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim()) {
      initial.push({ role: h.role, content: h.content });
    }
  }

  const chat = new LlmChat(KEY, sessionId || uuidv4(), systemPrompt, initial)
    .withModel('openai', MODEL)
    .withParams({ temperature: 0.1, max_tokens: 1500 })
    .withTools(getTools(user));

  const pendingActions = [];
  const uiComponents = [];
  const toolLog = [];
  try {
    let response = await chat.sendMessageWithTools(new UserMessage({ text: message }));
    let step = 0;
    while (response.tool_calls && response.tool_calls.length && step++ < MAX_STEPS) {
      for (const call of response.tool_calls) {
        let args = {};
        try { args = typeof call.arguments === 'string' ? JSON.parse(call.arguments || '{}') : (call.arguments || {}); } catch { args = {}; }
        const result = executeTool(call.name, args, user);
        toolLog.push({ name: call.name, args });
        if (result && result.status === 'confirmation_required') {
          pendingActions.push({ id: uuidv4(), action: result.action, summary: result.summary, details: result.details });
        }
        if (result && result.status === 'ui_builder') {
          uiComponents.push({ id: uuidv4(), type: 'order_builder', orderType: result.builder?.orderType || null });
          chat.addToolResult(call.id, JSON.stringify({ ok: true, status: 'ui_builder', note: 'Formulir order interaktif sudah ditampilkan ke pengguna. Persilakan pengguna melengkapi formulir dengan dropdown yang tersedia.' }));
          continue;
        }
        chat.addToolResult(call.id, JSON.stringify(result));
      }
      response = await chat.sendMessageWithTools();
    }
    const answer = response.content || 'Maaf, saya tidak dapat menghasilkan jawaban.';
    return { ok: true, answer, pendingActions, uiComponents, toolLog, usage: response.usage || null };
  } catch (e) {
    return { ok: false, error: 'Permintaan asisten gagal: ' + String(e?.message || e) };
  }
}
