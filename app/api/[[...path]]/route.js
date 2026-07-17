import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, like, or, desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import * as s from '@/lib/db/schema';
import { getAuth } from '@/lib/auth/auth';
import { headers } from 'next/headers';

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
  return allowed.includes(session.user.role);
}

export async function OPTIONS() { return cors(new NextResponse(null, { status: 200 })); }

// -----------------------
// Route dispatch
// -----------------------
async function handleRoute(request, { params }) {
  const { path = [] } = await params;
  const route = '/' + path.join('/');
  const method = request.method;
  const db = getDb();

  try {
    // Health
    if (route === '/' || route === '/root') return json({ ok: true, service: 'LPI ERP API' });

    // ---------- SEED (idempotent) ----------
    if (route === '/seed' && method === 'POST') {
      const auth = getAuth();
      // Only allow if no admin exists yet, otherwise no-op
      const existing = db.select().from(s.user).where(eq(s.user.role, 'admin')).all();
      if (existing.length > 0) {
        return json({ ok: true, seeded: false, message: 'Admin already exists' });
      }

      // Create default users via better-auth
      const defaults = [
        { email: 'admin@lpi.co.id', name: 'Administrator', password: 'admin123', role: 'admin' },
        { email: 'supervisor@lpi.co.id', name: 'Supervisor Ops', password: 'super123', role: 'supervisor' },
        { email: 'direktur@lpi.co.id', name: 'Direktur', password: 'direktur123', role: 'direktur' },
        { email: 'operator@lpi.co.id', name: 'Operator RPH', password: 'operator123', role: 'operator' },
      ];
      const created = [];
      for (const u of defaults) {
        try {
          const res = await auth.api.signUpEmail({
            body: { email: u.email, password: u.password, name: u.name, role: u.role, status: 'active' },
          });
          created.push({ email: u.email, ok: true });
          // Ensure role is set (better-auth may ignore additional fields on sign-up)
          db.update(s.user).set({ role: u.role, status: 'active' }).where(eq(s.user.email, u.email)).run();
        } catch (e) {
          created.push({ email: u.email, error: String(e?.message || e) });
        }
      }

      // Seed some demo master data (idempotent by code/sku)
      const now = new Date();
      const upsertContact = (c) => {
        const found = db.select().from(s.contacts).where(eq(s.contacts.code, c.code)).all();
        if (found.length === 0) db.insert(s.contacts).values({ id: uuidv4(), ...c, createdAt: now, updatedAt: now }).run();
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

    // ---------- USERS (admin only, list) ----------
    if (route === '/users' && method === 'GET') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin', 'direktur'])) return err('Forbidden', 403);
      const rows = db.select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, status: s.user.status, createdAt: s.user.createdAt }).from(s.user).orderBy(desc(s.user.createdAt)).all();
      return json({ data: rows });
    }

    // ---------- CONTACTS ----------
    if (route === '/contacts' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const type = url.searchParams.get('type');
      const q = url.searchParams.get('q');
      let query = db.select().from(s.contacts);
      const conds = [];
      if (type && type !== 'all') conds.push(eq(s.contacts.contactType, type));
      if (q) conds.push(or(
        like(s.contacts.displayName, `%${q}%`),
        like(s.contacts.code, `%${q}%`),
        like(s.contacts.companyName, `%${q}%`),
        like(s.contacts.phone, `%${q}%`),
        like(s.contacts.picPhone, `%${q}%`),
      ));
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.contacts.createdAt)).all();
      return json({ data: rows });
    }
    if (route === '/contacts' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const body = await request.json();
      if (!body.contactType || !body.displayName || !body.code) return err('contactType, code, displayName required');
      const now = new Date();
      const row = { id: uuidv4(), createdAt: now, updatedAt: now, ...body };
      try {
        db.insert(s.contacts).values(row).run();
        return json({ data: row }, { status: 201 });
      } catch (e) { return err('Failed to create: ' + e.message); }
    }
    // Transaction history for a contact
    if (route.startsWith('/contacts/') && path.length === 3 && path[2] === 'history' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const contact = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
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
      return json({
        data: {
          contact,
          salesOrders,
          purchaseOrders,
          workOrders,
          summary: {
            salesCount: salesOrders.length,
            purchaseCount: purchaseOrders.length,
            workOrderCount: workOrders.length,
            totalSalesAmount,
            totalPurchaseAmount,
          },
        },
      });
    }
    if (route.startsWith('/contacts/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const row = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      if (!row) return err('Not found', 404);
      return json({ data: row });
    }
    if (route.startsWith('/contacts/') && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt;
      db.update(s.contacts).set({ ...body, updatedAt: new Date() }).where(eq(s.contacts.id, id)).run();
      const row = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      return json({ data: row });
    }
    if (route.startsWith('/contacts/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden - hanya admin', 403);
      const id = path[1];
      db.delete(s.contacts).where(eq(s.contacts.id, id)).run();
      return json({ ok: true });
    }

    // ---------- PRODUCTS ----------
    if (route === '/products' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const url = new URL(request.url);
      const q = url.searchParams.get('q');
      const cat = url.searchParams.get('category');
      let query = db.select().from(s.products);
      const conds = [];
      if (cat && cat !== 'all') conds.push(eq(s.products.category, cat));
      if (q) conds.push(or(like(s.products.name, `%${q}%`), like(s.products.sku, `%${q}%`)));
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.products.createdAt)).all();
      return json({ data: rows });
    }
    if (route === '/products' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.sku || !body.name) return err('sku and name required');
      const now = new Date();
      const row = { id: uuidv4(), createdAt: now, updatedAt: now, ...body };
      try { db.insert(s.products).values(row).run(); return json({ data: row }, { status: 201 }); }
      catch (e) { return err('Failed to create: ' + e.message); }
    }
    if (route.startsWith('/products/') && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const id = path[1];
      const row = db.select().from(s.products).where(eq(s.products.id, id)).get();
      if (!row) return err('Not found', 404);
      return json({ data: row });
    }
    if (route.startsWith('/products/') && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt;
      db.update(s.products).set({ ...body, updatedAt: new Date() }).where(eq(s.products.id, id)).run();
      const row = db.select().from(s.products).where(eq(s.products.id, id)).get();
      return json({ data: row });
    }
    if (route.startsWith('/products/') && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      db.delete(s.products).where(eq(s.products.id, id)).run();
      return json({ ok: true });
    }

    // ---------- COLD STORAGES ----------
    if (route === '/cold-storages' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const rows = db.select().from(s.coldStorages).orderBy(desc(s.coldStorages.createdAt)).all();
      // Enrich with zone counts
      const withZones = rows.map(cs => {
        const zoneCount = db.select({ c: sql`count(*)` }).from(s.zones).where(eq(s.zones.coldStorageId, cs.id)).get();
        return { ...cs, zoneCount: Number(zoneCount?.c || 0) };
      });
      return json({ data: withZones });
    }
    if (route === '/cold-storages' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.code || !body.name) return err('code and name required');
      const now = new Date();
      const row = { id: uuidv4(), createdAt: now, updatedAt: now, ...body };
      try { db.insert(s.coldStorages).values(row).run(); return json({ data: row }, { status: 201 }); }
      catch (e) { return err('Failed to create: ' + e.message); }
    }
    if (route.startsWith('/cold-storages/') && path.length === 2 && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const id = path[1];
      const row = db.select().from(s.coldStorages).where(eq(s.coldStorages.id, id)).get();
      if (!row) return err('Not found', 404);
      const zones = db.select().from(s.zones).where(eq(s.zones.coldStorageId, id)).all();
      return json({ data: { ...row, zones } });
    }
    if (route.startsWith('/cold-storages/') && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt; delete body.zones; delete body.zoneCount;
      db.update(s.coldStorages).set({ ...body, updatedAt: new Date() }).where(eq(s.coldStorages.id, id)).run();
      const row = db.select().from(s.coldStorages).where(eq(s.coldStorages.id, id)).get();
      return json({ data: row });
    }
    if (route.startsWith('/cold-storages/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      db.delete(s.coldStorages).where(eq(s.coldStorages.id, id)).run();
      return json({ ok: true });
    }

    // ---------- ZONES ----------
    // GET  /zones?cold_storage_id=xxx
    if (route === '/zones' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const url = new URL(request.url);
      const csId = url.searchParams.get('cold_storage_id');
      let query = db.select().from(s.zones);
      if (csId) query = query.where(eq(s.zones.coldStorageId, csId));
      const rows = query.orderBy(s.zones.code).all();
      return json({ data: rows });
    }
    if (route === '/zones' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.coldStorageId || !body.code || !body.name) return err('coldStorageId, code, name required');
      const now = new Date();
      const row = { id: uuidv4(), createdAt: now, updatedAt: now, ...body };
      try { db.insert(s.zones).values(row).run(); return json({ data: row }, { status: 201 }); }
      catch (e) { return err('Failed to create: ' + e.message); }
    }
    if (route.startsWith('/zones/') && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt;
      db.update(s.zones).set({ ...body, updatedAt: new Date() }).where(eq(s.zones.id, id)).run();
      const row = db.select().from(s.zones).where(eq(s.zones.id, id)).get();
      return json({ data: row });
    }
    if (route.startsWith('/zones/') && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      db.delete(s.zones).where(eq(s.zones.id, id)).run();
      return json({ ok: true });
    }

    // ---------- STATS (basic dashboard) ----------
    if (route === '/stats' && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const cnt = (t) => Number(db.select({ c: sql`count(*)` }).from(t).get()?.c || 0);
      return json({
        contacts: cnt(s.contacts),
        products: cnt(s.products),
        coldStorages: cnt(s.coldStorages),
        zones: cnt(s.zones),
        users: cnt(s.user),
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
      const row = db.select({ c: sql`count(*)` }).from(s.purchaseOrder).where(like(s.purchaseOrder.poNumber, `${prefix}%`)).get();
      const seq = String((Number(row?.c || 0) + 1)).padStart(4, '0');
      return `${prefix}${seq}`;
    };
    const nextGrnNumber = () => {
      const ym = new Date();
      const prefix = `GRN/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.grn).where(like(s.grn.grnNumber, `${prefix}%`)).get();
      const seq = String((Number(row?.c || 0) + 1)).padStart(4, '0');
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
      // basis for proportional distribution = planned weight (or supplier weight if planned=0)
      const totalPlanned = items.reduce((a, b) => a + Number(b.weight || b.weightSupplier || 0), 0) || 1;
      let totalAmount = 0;
      let susutTotal = 0;
      for (const it of items) {
        const planned = Number(it.weight || it.weightSupplier || 0);
        const share = totalPlanned > 0 ? (planned / totalPlanned) * addCost : 0;
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
        const hppTotal = itemCost + share;
        const hppPerKg = weightActual > 0 ? hppTotal / weightActual : 0;
        totalAmount += itemCost;
        if (isLB) {
          const s1 = Number(it.weightSupplier || 0);
          const s2 = Number(it.weightRph || 0);
          if (s1 > 0 && s2 > 0) susutTotal += Math.max(0, s1 - s2);
        }
        db.update(s.purchaseOrderItems).set({ additionalCostShare: share, hppPerKg }).where(eq(s.purchaseOrderItems.id, it.id)).run();
      }
      const finalTotal = totalAmount + addCost;
      db.update(s.purchaseOrder).set({ totalAmount: finalTotal, updatedAt: new Date() }).where(eq(s.purchaseOrder.id, poId)).run();
      return { totalAmount: finalTotal, susutTotal };
    };

    // GET /purchase-orders - list with filters
    if (route === '/purchase-orders' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const type = url.searchParams.get('type');
      const supplier = url.searchParams.get('supplier');
      const q = url.searchParams.get('q');
      const conds = [];
      if (status && status !== 'all') conds.push(eq(s.purchaseOrder.pipelineStatus, status));
      if (type && type !== 'all') conds.push(eq(s.purchaseOrder.poType, type));
      if (supplier) conds.push(eq(s.purchaseOrder.supplierId, supplier));
      if (q) conds.push(like(s.purchaseOrder.poNumber, `%${q}%`));
      let query = db.select().from(s.purchaseOrder);
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.purchaseOrder.createdAt)).all();
      // Enrich with supplier name
      const enriched = rows.map(r => {
        const sup = db.select({ code: s.contacts.code, name: s.contacts.displayName }).from(s.contacts).where(eq(s.contacts.id, r.supplierId)).get();
        return { ...r, supplier: sup };
      });
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
      return json({ data: created }, { status: 201 });
    }

    // GET /purchase-orders/:id - detail
    if (route.startsWith('/purchase-orders/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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
      const grnRows = db.select().from(s.grn).where(eq(s.grn.purchaseOrderId, id)).orderBy(desc(s.grn.receivedDate)).all();
      const payments = db.select().from(s.purchasePayments).where(eq(s.purchasePayments.purchaseOrderId, id)).orderBy(desc(s.purchasePayments.paymentDate)).all();
      const returns = db.select().from(s.purchaseReturns).where(eq(s.purchaseReturns.purchaseOrderId, id)).orderBy(desc(s.purchaseReturns.returnDate)).all();
      const totalReturns = returns.reduce((a, b) => a + Number(b.totalAmount || 0), 0);
      const outstanding = Number(po.totalAmount || 0) - Number(po.paidAmount || 0) - totalReturns;
      return json({ data: { ...po, items: enrichedItems, supplier, dropshipCustomer, grn: grnRows, payments, returns, outstanding, totalReturns } });
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
      const fields = ['supplierId', 'poType', 'method', 'expectedDate', 'isDropship', 'dropshipCustomerId', 'additionalCost', 'dpAmount', 'paymentTerm', 'notes', 'invoiceNumber', 'invoiceDate', 'dueDate'];
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
      const g = {
        id: uuidv4(),
        grnNumber: nextGrnNumber(),
        purchaseOrderId: id,
        receivedDate: body.receivedDate ? new Date(body.receivedDate) : new Date(),
        receivedBy: body.receivedBy || session.user.name,
        notes: body.notes || null,
        status: 'confirmed',
        createdAt: new Date(),
      };
      db.insert(s.grn).values(g).run();
      // Auto-transition to Tanda Terima if currently Dikirim
      if (po.pipelineStatus === 'Dikirim') {
        db.update(s.purchaseOrder).set({ pipelineStatus: 'Tanda Terima', updatedAt: new Date() }).where(eq(s.purchaseOrder.id, id)).run();
      }
      return json({ data: g }, { status: 201 });
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
      return json({ data: { ...r, notification: { to: ['supervisor', 'direktur'], subject: `Retur PO ${po.poNumber}` } } }, { status: 201 });
    }

    // GET /purchase-orders/:id/hpp - HPP calculation summary
    if (route.startsWith('/purchase-orders/') && path.length === 3 && path[2] === 'hpp' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const po = db.select().from(s.purchaseOrder).where(eq(s.purchaseOrder.id, id)).get();
      if (!po) return err('Not found', 404);
      recalcPoHpp(id);
      const items = db.select().from(s.purchaseOrderItems).where(eq(s.purchaseOrderItems.purchaseOrderId, id)).all();
      const rows = items.map(it => {
        const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit }).from(s.products).where(eq(s.products.id, it.productId)).get();
        const isLB = po.poType === 'Live Bird';
        const method = po.method || 'Timbang Ulang';
        let weightBilled = it.weight, weightActual = it.weight;
        if (isLB) {
          if (method === 'Timbang Ulang') { weightBilled = Number(it.weightRph || it.weight); weightActual = weightBilled; }
          else { weightBilled = Number(it.weightSupplier || it.weight); weightActual = Number(it.weightRph || weightBilled); }
        }
        const itemCost = Number(it.unitPrice) * weightBilled;
        const susut = isLB ? Math.max(0, Number(it.weightSupplier || 0) - Number(it.weightRph || 0)) : 0;
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
        totalWeightBilled: rows.reduce((a, b) => a + b.weightBilled, 0),
        totalWeightActual: rows.reduce((a, b) => a + b.weightActual, 0),
        totalSusut: rows.reduce((a, b) => a + b.susut, 0),
        totalHpp: rows.reduce((a, b) => a + b.hppTotal, 0),
        grandTotal: Number(po.totalAmount || 0),
      };
      totals.avgHppPerKg = totals.totalWeightActual > 0 ? totals.totalHpp / totals.totalWeightActual : 0;
      return json({ data: { po, items: rows, totals } });
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
      const row = db.select({ c: sql`count(*)` }).from(s.salesOrder).where(like(s.salesOrder.soNumber, `${prefix}%`)).get();
      return `${prefix}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
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
      const row = db.select({ c: sql`count(*)` }).from(s.suratJalan).where(like(s.suratJalan.sjNumber, `${prefix}%`)).get();
      return `${prefix}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
    };
    const nextSalesReturnNumber = () => {
      const ym = new Date();
      const prefix = `RET-S/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.salesReturns).where(like(s.salesReturns.returnNumber, `${prefix}%`)).get();
      return `${prefix}${String((Number(row?.c || 0) + 1)).padStart(4, '0')}`;
    };

    const recalcSoTotals = (soId) => {
      const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, soId)).all();
      let subtotal = 0, discountTotal = 0;
      for (const it of items) {
        const line = Number(it.unitPrice) * Number(it.quantity || it.weight || 0);
        const disc = Number(it.discount || 0);
        const st = line - disc;
        subtotal += line;
        discountTotal += disc;
        db.update(s.salesOrderItems).set({ subtotal: st }).where(eq(s.salesOrderItems.id, it.id)).run();
      }
      const total = subtotal - discountTotal;
      db.update(s.salesOrder).set({ totalAmount: total, discountTotal, updatedAt: new Date() }).where(eq(s.salesOrder.id, soId)).run();
      return { subtotal, discountTotal, total };
    };

    const recomputeSoPaymentStatus = (soId) => {
      const soRow = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, soId)).get();
      const paid = db.select({ sum: sql`coalesce(sum(amount),0)` }).from(s.salesPayments).where(eq(s.salesPayments.salesOrderId, soId)).get();
      const totalPaid = Number(paid?.sum || 0);
      const retRow = db.select({ sum: sql`coalesce(sum(total_amount),0)` }).from(s.salesReturns).where(eq(s.salesReturns.salesOrderId, soId)).get();
      const totalReturns = Number(retRow?.sum || 0);
      const netTotal = Number(soRow.totalAmount) - totalReturns;
      let ps = 'unpaid';
      if (totalPaid >= netTotal && netTotal > 0) ps = 'paid';
      else if (totalPaid > 0) ps = 'partial';
      db.update(s.salesOrder).set({ paidAmount: totalPaid, paymentStatus: ps, updatedAt: new Date() }).where(eq(s.salesOrder.id, soId)).run();
      return { totalPaid, totalReturns, netTotal, paymentStatus: ps };
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
      if (status && status !== 'all') conds.push(eq(s.salesOrder.pipelineStatus, status));
      if (customer) conds.push(eq(s.salesOrder.customerId, customer));
      if (q) conds.push(or(like(s.salesOrder.soNumber, `%${q}%`), like(s.salesOrder.invoiceNumber, `%${q}%`)));
      let query = db.select().from(s.salesOrder);
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.salesOrder.createdAt)).all();
      const enriched = rows.map(r => {
        const c = db.select({ code: s.contacts.code, name: s.contacts.displayName, isSubscriber: s.contacts.isSubscriber }).from(s.contacts).where(eq(s.contacts.id, r.customerId)).get();
        return { ...r, customer: c };
      });
      return json({ data: enriched });
    }

    // POST /sales-orders
    if (route === '/sales-orders' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.customerId || !Array.isArray(body.items) || body.items.length === 0) return err('customerId and items required');
      const now = new Date();
      const id = uuidv4();
      const soNumber = body.soNumber || nextSoNumber();
      const orderDate = body.orderDate ? new Date(body.orderDate) : now;
      const expectedDate = body.expectedDate ? new Date(body.expectedDate) : null;
      const row = {
        id, soNumber, customerId: body.customerId,
        orderDate, expectedDate,
        pipelineStatus: 'Draft',
        dpAmount: Number(body.dpAmount || 0),
        paymentTerm: body.paymentTerm || null,
        notes: body.notes || null,
        createdBy: session.user.email,
        createdAt: now, updatedAt: now,
      };
      db.insert(s.salesOrder).values(row).run();
      for (const it of body.items) {
        const line = Number(it.unitPrice) * Number(it.quantity || it.weight || 0);
        const disc = Number(it.discount || 0);
        db.insert(s.salesOrderItems).values({
          id: uuidv4(), salesOrderId: id,
          productId: it.productId,
          quantity: Number(it.quantity || 0),
          weight: Number(it.weight || 0),
          unitPrice: Number(it.unitPrice || 0),
          discount: disc,
          subtotal: line - disc,
        }).run();
      }
      recalcSoTotals(id);
      const created = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      return json({ data: created }, { status: 201 });
    }

    // GET /sales-orders/:id
    if (route.startsWith('/sales-orders/') && path.length === 2 && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
      const enrichedItems = items.map(it => ({ ...it, product: db.select().from(s.products).where(eq(s.products.id, it.productId)).get() }));
      const customer = db.select().from(s.contacts).where(eq(s.contacts.id, so.customerId)).get();
      const sjRows = db.select().from(s.suratJalan).where(eq(s.suratJalan.salesOrderId, id)).orderBy(desc(s.suratJalan.deliveryDate)).all();
      const payments = db.select().from(s.salesPayments).where(eq(s.salesPayments.salesOrderId, id)).orderBy(desc(s.salesPayments.paymentDate)).all();
      const returns = db.select().from(s.salesReturns).where(eq(s.salesReturns.salesOrderId, id)).orderBy(desc(s.salesReturns.returnDate)).all();
      const totalReturns = returns.reduce((a, b) => a + Number(b.totalAmount || 0), 0);
      const outstanding = Number(so.totalAmount) - Number(so.paidAmount || 0) - totalReturns;
      return json({ data: { ...so, items: enrichedItems, customer, suratJalan: sjRows, payments, returns, outstanding, totalReturns } });
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
      const fields = ['customerId', 'expectedDate', 'dpAmount', 'paymentTerm', 'notes', 'invoiceNumber', 'invoiceDate', 'dueDate'];
      for (const f of fields) {
        if (body[f] !== undefined) {
          if (['expectedDate', 'invoiceDate', 'dueDate'].includes(f)) update[f] = body[f] ? new Date(body[f]) : null;
          else update[f] = body[f];
        }
      }
      if (body.orderDate) update.orderDate = new Date(body.orderDate);
      update.updatedAt = new Date();
      db.update(s.salesOrder).set(update).where(eq(s.salesOrder.id, id)).run();
      if (Array.isArray(body.items)) {
        db.delete(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).run();
        for (const it of body.items) {
          const line = Number(it.unitPrice) * Number(it.quantity || it.weight || 0);
          const disc = Number(it.discount || 0);
          db.insert(s.salesOrderItems).values({
            id: uuidv4(), salesOrderId: id,
            productId: it.productId,
            quantity: Number(it.quantity || 0),
            weight: Number(it.weight || 0),
            unitPrice: Number(it.unitPrice || 0),
            discount: disc,
            subtotal: line - disc,
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
      // On Confirmed: auto stock deduction (create inventory_transaction OUT record for audit)
      if (target === 'Confirmed') {
        const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
        const txId = uuidv4();
        db.insert(s.inventoryTransaction).values({
          id: txId,
          transactionDate: new Date(),
          transactionType: 'OUT',
          referenceId: id,
          referenceType: 'SO',
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
      // On Invoiced: auto-generate invoice number & date if not set
      if (target === 'Invoiced') {
        if (!so.invoiceNumber) upd.invoiceNumber = nextInvoiceNumber();
        if (!so.invoiceDate) upd.invoiceDate = new Date();
        if (!so.dueDate && so.paymentTerm && /TOP (\d+)/.test(so.paymentTerm)) {
          const days = Number(so.paymentTerm.match(/TOP (\d+)/)[1]);
          upd.dueDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        }
      }
      db.update(s.salesOrder).set(upd).where(eq(s.salesOrder.id, id)).run();
      const updated = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
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
      const sj = {
        id: uuidv4(),
        sjNumber: nextSjNumber(),
        salesOrderId: id,
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : new Date(),
        driverName: body.driverName || null,
        vehicleNumber: body.vehicleNumber || null,
        notes: body.notes || null,
        status: 'confirmed',
        createdBy: session.user.email,
        createdAt: new Date(),
      };
      db.insert(s.suratJalan).values(sj).run();
      // Auto-transition Packed -> Shipped when SJ created
      if (so.pipelineStatus === 'Packed') {
        db.update(s.salesOrder).set({ pipelineStatus: 'Shipped', updatedAt: new Date() }).where(eq(s.salesOrder.id, id)).run();
      }
      return json({ data: sj }, { status: 201 });
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

    // POST /sales-orders/:id/returns - retur penjualan (notif supervisor + direktur)
    if (route.startsWith('/sales-orders/') && path.length === 3 && path[2] === 'returns' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const id = path[1];
      const so = db.select().from(s.salesOrder).where(eq(s.salesOrder.id, id)).get();
      if (!so) return err('Not found', 404);
      const body = await request.json();
      const r = {
        id: uuidv4(),
        returnNumber: nextSalesReturnNumber(),
        salesOrderId: id,
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
      db.insert(s.salesReturns).values(r).run();
      recomputeSoPaymentStatus(id);
      return json({ data: { ...r, notification: { to: ['supervisor', 'direktur'], subject: `Retur Penjualan SO ${so.soNumber}` } } }, { status: 201 });
    }

    // =====================================================================
    // SALES REPORTS
    // =====================================================================
    if (route === '/sales-reports/daily' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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

    return err(`Route ${route} not found`, 404);
  } catch (e) {
    console.error('API Error:', e);
    return err('Internal server error: ' + e.message, 500);
  }
}

export const GET = handleRoute;
export const POST = handleRoute;
export const PUT = handleRoute;
export const PATCH = handleRoute;
export const DELETE = handleRoute;
