import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, like, or, desc, sql, inArray, isNotNull } from 'drizzle-orm';
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

    // ---------- USERS ----------
    // GET /users - list users (admin/direktur)
    if (route === '/users' && method === 'GET') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin', 'direktur'])) return err('Forbidden', 403);
      const rows = db.select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, status: s.user.status, createdAt: s.user.createdAt }).from(s.user).orderBy(desc(s.user.createdAt)).all();
      return json({ data: rows });
    }

    // POST /users - create new user (admin only)
    if (route === '/users' && method === 'POST') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const body = await request.json();
      const { name, email, password, role, status = 'active' } = body || {};
      if (!name || !email || !password || !role) return err('name, email, password, role required');
      if (!['admin', 'supervisor', 'direktur', 'operator'].includes(role)) return err('Invalid role');
      if (String(password).length < 6) return err('Password minimal 6 karakter');
      // Check duplicate email
      const existing = db.select().from(s.user).where(eq(s.user.email, email)).all();
      if (existing.length > 0) return err('Email sudah terdaftar');
      try {
        const auth = getAuth();
        await auth.api.signUpEmail({ body: { email, password, name } });
        db.update(s.user).set({ role, status, updatedAt: new Date() }).where(eq(s.user.email, email)).run();
        const created = db.select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, status: s.user.status, createdAt: s.user.createdAt }).from(s.user).where(eq(s.user.email, email)).all();
        return json({ data: created[0] }, { status: 201 });
      } catch (e) {
        return err('Gagal membuat user: ' + String(e?.message || e), 400);
      }
    }

    // PATCH /users/:id - update user profile (name, role, status) - admin only
    if (route.startsWith('/users/') && path.length === 2 && method === 'PATCH') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const target = db.select().from(s.user).where(eq(s.user.id, id)).all();
      if (target.length === 0) return err('User tidak ditemukan', 404);
      // Prevent self-demote/deactivate to avoid lockout
      if (target[0].id === session.user.id && (body.role && body.role !== target[0].role || body.status && body.status !== 'active')) {
        return err('Tidak bisa mengubah role/status akun sendiri', 400);
      }
      const upd = {};
      if (body.name !== undefined) upd.name = body.name;
      if (body.role !== undefined) {
        if (!['admin', 'supervisor', 'direktur', 'operator'].includes(body.role)) return err('Invalid role');
        upd.role = body.role;
      }
      if (body.status !== undefined) {
        if (!['active', 'inactive'].includes(body.status)) return err('Invalid status');
        upd.status = body.status;
      }
      if (Object.keys(upd).length === 0) return err('Tidak ada field yang diubah');
      upd.updatedAt = new Date();
      db.update(s.user).set(upd).where(eq(s.user.id, id)).run();
      const updated = db.select({ id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, status: s.user.status, createdAt: s.user.createdAt }).from(s.user).where(eq(s.user.id, id)).all();
      return json({ data: updated[0] });
    }

    // POST /users/:id/reset-password - reset password (admin only)
    if (route.startsWith('/users/') && path.length === 3 && path[2] === 'reset-password' && method === 'POST') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      const { newPassword } = body || {};
      if (!newPassword || String(newPassword).length < 6) return err('Password minimal 6 karakter');
      const target = db.select().from(s.user).where(eq(s.user.id, id)).all();
      if (target.length === 0) return err('User tidak ditemukan', 404);
      try {
        // better-auth stores password hash in account table with providerId='credential'
        const bcrypt = await import('better-auth/crypto').catch(() => null);
        // Better-auth exposes its context; simplest approach: update via drizzle using its hash function
        const authCtx = getAuth().$context ? await getAuth().$context : null;
        const hashed = authCtx?.password?.hash ? await authCtx.password.hash(newPassword) : null;
        if (!hashed) throw new Error('Hash function not available');
        db.update(s.account)
          .set({ password: hashed, updatedAt: new Date() })
          .where(and(eq(s.account.userId, id), eq(s.account.providerId, 'credential')))
          .run();
        return json({ ok: true });
      } catch (e) {
        return err('Gagal reset password: ' + String(e?.message || e), 500);
      }
    }

    // DELETE /users/:id - delete user (admin only, cannot delete self)
    if (route.startsWith('/users/') && path.length === 2 && method === 'DELETE') {
      const { session, error } = await requireAuth();
      if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
      const id = path[1];
      if (id === session.user.id) return err('Tidak bisa menghapus akun sendiri', 400);
      const target = db.select().from(s.user).where(eq(s.user.id, id)).all();
      if (target.length === 0) return err('User tidak ditemukan', 404);
      // Cascade will remove session and account rows via FK
      db.delete(s.user).where(eq(s.user.id, id)).run();
      return json({ ok: true });
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
    const nextReceiptNumber = () => {
      const ym = new Date();
      const prefix = `RCP/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
      const row = db.select({ c: sql`count(*)` }).from(s.salesOrderReceipts).where(like(s.salesOrderReceipts.receiptNumber, `${prefix}%`)).get();
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
          stockCodeId: it.stockId || null,
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
      const outstanding = Number(so.totalAmount) - Number(so.paidAmount || 0) - totalReturns;
      return json({ data: { ...so, items: enrichedItems, customer, suratJalan: sjRows, payments, returns, receipts, outstanding, totalReturns, totalShrinkageValue, totalShrinkageWeight } });
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
      // On Confirmed: auto stock deduction (create inventory_transaction OUT record for audit)
      if (target === 'Confirmed') {
        const items = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
        // Deduct stock rows linked via stockCodeId
        let totalW = 0, totalQ = 0;
        for (const it of items) {
          totalW += Number(it.weight || 0);
          totalQ += Number(it.quantity || 0);
          if (!it.stockCodeId) continue;
          const stk = db.select().from(s.inventoryStock).where(eq(s.inventoryStock.id, it.stockCodeId)).get();
          if (!stk) continue;
          const remainingWeight = Math.max(0, Number(stk.weight || 0) - Number(it.weight || 0));
          const remainingQty = Math.max(0, Number(stk.quantity || 0) - Number(it.quantity || 0));
          const newStatus = remainingWeight <= 0.001 ? 'used' : stk.status;
          db.update(s.inventoryStock)
            .set({ weight: remainingWeight, quantity: remainingQty, status: newStatus, updatedAt: new Date() })
            .where(eq(s.inventoryStock.id, stk.id))
            .run();
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

      // Aggregate SO items by productId → orderedWeight + avgUnitPrice (weighted by weight)
      const soItems = db.select().from(s.salesOrderItems).where(eq(s.salesOrderItems.salesOrderId, id)).all();
      const perProduct = {};
      for (const it of soItems) {
        if (!perProduct[it.productId]) perProduct[it.productId] = { orderedWeight: 0, totalValue: 0 };
        perProduct[it.productId].orderedWeight += Number(it.weight || 0);
        perProduct[it.productId].totalValue += Number(it.weight || 0) * Number(it.unitPrice || 0);
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
        if (receivedWeight > pp.orderedWeight + 0.0001) {
          return err(`Berat diterima (${receivedWeight} kg) melebihi berat SO (${pp.orderedWeight} kg) untuk produk ini`);
        }
        const shrinkageWeight = pp.orderedWeight - receivedWeight;
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

    // GET /work-orders
    if (route === '/work-orders' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const mode = url.searchParams.get('mode');
      const q = url.searchParams.get('q');
      const conds = [];
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

    // POST /work-orders - create
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
      return json({ data: db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get() }, { status: 201 });
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

    // POST /work-orders/:id/finalize - move outputs to inventory
    if (route.startsWith('/work-orders/') && path.length === 3 && path[2] === 'finalize' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const wo = db.select().from(s.workOrder).where(eq(s.workOrder.id, id)).get();
      if (!wo) return err('Not found', 404);
      if (wo.pipelineStatus === 'Selesai') return err('WO sudah Selesai');
      const outputs = db.select().from(s.woOutputs).where(eq(s.woOutputs.workOrderId, id)).all();
      if (outputs.length === 0) return err('Belum ada output. Isi outputs dulu.');
      const body = await request.json().catch(() => ({}));
      const coldStorageId = body.coldStorageId;
      const zoneId = body.zoneId || null;
      if (!coldStorageId) return err('coldStorageId required');
      // Create inventory transaction
      const txId = uuidv4();
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(), transactionType: 'IN', referenceId: id, referenceType: 'WO',
        notes: `Finalize WO ${wo.woNumber} to inventory`, createdBy: session.user.email,
      }).run();
      // Insert stock rows
      for (const o of outputs) {
        db.insert(s.inventoryStock).values({
          id: uuidv4(),
          productId: o.productId,
          coldStorageId, zoneId,
          kodeSimpan: nextKodeSimpan(),
          quantity: Number(o.headCount || 0),
          weight: Number(o.weight || 0),
          status: 'active',
          sourceBatch: id, sourceType: 'WO',
          transactionId: txId,
        }).run();
      }
      // Transition status
      db.update(s.workOrder).set({ pipelineStatus: 'Selesai', finalizedAt: new Date(), updatedAt: new Date() }).where(eq(s.workOrder.id, id)).run();
      return json({ data: { ok: true, outputCount: outputs.length, transactionId: txId } });
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
      const enriched = rows.map(r => {
        const p = db.select({ sku: s.products.sku, name: s.products.name, unit: s.products.unit, category: s.products.category }).from(s.products).where(eq(s.products.id, r.productId)).get();
        const cs = db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.coldStorageId)).get();
        const zone = r.zoneId ? db.select({ code: s.zones.code, name: s.zones.name }).from(s.zones).where(eq(s.zones.id, r.zoneId)).get() : null;
        // Source lookup (PO/WO reference number for grouping)
        let source = null;
        if (r.sourceType === 'PO' && r.sourceBatch) {
          source = db.select({ id: s.purchaseOrder.id, number: s.purchaseOrder.poNumber, poType: s.purchaseOrder.poType, orderDate: s.purchaseOrder.orderDate }).from(s.purchaseOrder).where(eq(s.purchaseOrder.id, r.sourceBatch)).get();
        } else if (r.sourceType === 'WO' && r.sourceBatch) {
          source = db.select({ id: s.workOrder.id, number: s.workOrder.woNumber, mode: s.workOrder.mode, startDate: s.workOrder.startDate }).from(s.workOrder).where(eq(s.workOrder.id, r.sourceBatch)).get();
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
        return {
          ...r, product: p, coldStorage: cs, zone, source, daysToExpire,
          reservedWeight, reservedQty,
          reservedSoCount: reserved.sos ? reserved.sos.size : 0,
          availableWeight, availableQty,
        };
      });
      // Summary
      const summary = {
        totalRows: enriched.length,
        totalWeight: enriched.reduce((a, b) => a + Number(b.weight || 0), 0),
        totalAvailableWeight: enriched.reduce((a, b) => a + Number(b.availableWeight || 0), 0),
        totalReservedWeight: enriched.reduce((a, b) => a + Number(b.reservedWeight || 0), 0),
        totalQty: enriched.reduce((a, b) => a + Number(b.quantity || 0), 0),
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

    // POST /inventory/inbound - manual inbound (from PO GRN)
    if (route === '/inventory/inbound' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'operator'])) return err('Forbidden', 403);
      const body = await request.json();
      // body: { referenceId(PO/WO id), referenceType, coldStorageId, zoneId?, items: [{productId, weight, quantity, expiredDate, packagingType}] }
      if (!Array.isArray(body.items) || body.items.length === 0) return err('items required');
      if (!body.coldStorageId) return err('coldStorageId required');
      const txId = uuidv4();
      const totalW = body.items.reduce((a, b) => a + Number(b.weight || 0), 0);
      const totalQ = body.items.reduce((a, b) => a + Number(b.quantity || 0), 0);
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(), transactionType: 'IN',
        referenceId: body.referenceId || null, referenceType: body.referenceType || 'MANUAL',
        toColdStorageId: body.coldStorageId, toZoneId: body.zoneId || null,
        totalWeight: totalW, totalQuantity: totalQ,
        notes: body.notes || null, status: 'confirmed',
        createdBy: session.user.email, createdAt: new Date(),
      }).run();
      const createdStocks = [];
      for (const it of body.items) {
        const stkId = uuidv4();
        const kodeSimpan = nextKodeSimpan();
        db.insert(s.inventoryStock).values({
          id: stkId, productId: it.productId,
          coldStorageId: body.coldStorageId, zoneId: body.zoneId || null,
          kodeSimpan,
          packagingType: it.packagingType || 'karung',
          quantity: Number(it.quantity || 0),
          weight: Number(it.weight || 0),
          expiredDate: it.expiredDate ? new Date(it.expiredDate) : null,
          status: 'active',
          sourceBatch: body.referenceId || null, sourceType: body.referenceType || null,
          transactionId: txId,
        }).run();
        createdStocks.push({ id: stkId, kodeSimpan, weight: Number(it.weight || 0), quantity: Number(it.quantity || 0), productId: it.productId });
      }
      return json({ data: { transactionId: txId, stocks: createdStocks, stockIds: createdStocks.map(s => s.id) } }, { status: 201 });
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
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(),
        transactionType: subtype === 'damage' ? 'DAMAGE' : 'NON_SALES',
        baNumber: nextBaNumber('BA'),
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
      db.insert(s.inventoryTransaction).values({
        id: txId, transactionDate: new Date(),
        transactionType: 'TRANSFER_CS',
        baNumber: nextBaNumber('BA'), baType: 'transfer_cs',
        fromColdStorageId: fromCsId, toColdStorageId: body.toColdStorageId,
        toZoneId: body.toZoneId || null,
        totalWeight: totalW, totalQuantity: totalQ,
        notes: body.notes || null, status: 'confirmed',
        createdBy: session.user.email, createdAt: new Date(),
      }).run();
      // Update stock location
      for (const st of stocks) {
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
      if (parent.packagingType !== 'karung') return err('Hanya karung yang bisa displit');
      if (parent.status !== 'active') return err('Karung tidak aktif');
      const packs = body.packs || [];
      if (packs.length === 0) return err('packs required');
      const createdIds = [];
      for (const p of packs) {
        const stkId = uuidv4();
        db.insert(s.inventoryStock).values({
          id: stkId,
          productId: parent.productId,
          coldStorageId: parent.coldStorageId,
          zoneId: parent.zoneId,
          kodeSimpan: nextKodeSimpan(),
          packagingType: 'pack',
          parentStockId: parent.id,
          quantity: Number(p.quantity || 1),
          weight: Number(p.weight || 0),
          expiredDate: parent.expiredDate,
          status: 'active',
          sourceBatch: parent.sourceBatch, sourceType: parent.sourceType,
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
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
      // Inventory value (sum weight * hpp not tracked yet — use base_price of product as approx)
      const stockRows = db.select({ productId: s.inventoryStock.productId, w: sql`sum(${s.inventoryStock.weight})` }).from(s.inventoryStock).where(eq(s.inventoryStock.status, 'active')).groupBy(s.inventoryStock.productId).all();
      let inventoryValue = 0;
      for (const r of stockRows) {
        const p = db.select({ price: s.products.basePrice }).from(s.products).where(eq(s.products.id, r.productId)).get();
        inventoryValue += Number(r.w || 0) * Number(p?.price || 0);
      }
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

    // =====================================================================
    // PURCHASE REPORTS
    // =====================================================================
    if (route === '/purchase-reports/by-supplier' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const rows = db.select({
        coldStorageId: s.inventoryStock.coldStorageId,
        rowCount: sql`count(*)`,
        totalWeight: sql`coalesce(sum(${s.inventoryStock.weight}), 0)`,
        totalQty: sql`coalesce(sum(${s.inventoryStock.quantity}), 0)`,
      }).from(s.inventoryStock).where(eq(s.inventoryStock.status, 'active')).groupBy(s.inventoryStock.coldStorageId).all();
      const enriched = rows.map(r => {
        const cs = db.select().from(s.coldStorages).where(eq(s.coldStorages.id, r.coldStorageId)).get();
        return { ...r, coldStorage: cs, utilization: cs?.capacityKg > 0 ? (Number(r.totalWeight) / Number(cs.capacityKg)) * 100 : 0 };
      });
      return json({ data: enriched });
    }
    if (route === '/inventory-reports/by-product' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const rows = db.select({
        productId: s.inventoryStock.productId,
        rowCount: sql`count(*)`,
        totalWeight: sql`coalesce(sum(${s.inventoryStock.weight}), 0)`,
        totalQty: sql`coalesce(sum(${s.inventoryStock.quantity}), 0)`,
      }).from(s.inventoryStock).where(eq(s.inventoryStock.status, 'active')).groupBy(s.inventoryStock.productId).all();
      const enriched = rows.map(r => {
        const p = db.select().from(s.products).where(eq(s.products.id, r.productId)).get();
        return { ...r, product: p, minStock: Number(p?.minStock || 0), lowStock: Number(r.totalWeight) < Number(p?.minStock || 0), estimatedValue: Number(r.totalWeight) * Number(p?.basePrice || 0) };
      }).sort((a, b) => Number(b.totalWeight) - Number(a.totalWeight));
      return json({ data: enriched });
    }
    if (route === '/inventory-reports/near-expired' && method === 'GET') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);
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
      if (!requireRole(session, ['admin', 'supervisor', 'direktur'])) return err('Forbidden', 403);
      const rows = db.select().from(s.inventoryTransaction).where(eq(s.inventoryTransaction.transactionType, 'DAMAGE')).orderBy(desc(s.inventoryTransaction.transactionDate)).all();
      const enriched = rows.map(r => ({ ...r, coldStorage: r.fromColdStorageId ? db.select({ code: s.coldStorages.code, name: s.coldStorages.name }).from(s.coldStorages).where(eq(s.coldStorages.id, r.fromColdStorageId)).get() : null }));
      const totalDamage = rows.filter(r => r.status === 'confirmed').reduce((a, b) => a + Number(b.totalWeight || 0), 0);
      return json({ data: { items: enriched, summary: { totalRows: rows.length, totalWeight: totalDamage } } });
    }
    // ===================================================================== END REPORTS

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
