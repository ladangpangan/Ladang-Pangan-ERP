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
      const { error } = await requireAuth(); if (error) return error;
      const url = new URL(request.url);
      const type = url.searchParams.get('type');
      const q = url.searchParams.get('q');
      let query = db.select().from(s.contacts);
      const conds = [];
      if (type && type !== 'all') conds.push(eq(s.contacts.contactType, type));
      if (q) conds.push(or(like(s.contacts.displayName, `%${q}%`), like(s.contacts.code, `%${q}%`), like(s.contacts.companyName, `%${q}%`)));
      if (conds.length) query = query.where(and(...conds));
      const rows = query.orderBy(desc(s.contacts.createdAt)).all();
      return json({ data: rows });
    }
    if (route === '/contacts' && method === 'POST') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const body = await request.json();
      if (!body.contactType || !body.displayName || !body.code) return err('contactType, code, displayName required');
      const now = new Date();
      const row = { id: uuidv4(), createdAt: now, updatedAt: now, ...body };
      try {
        db.insert(s.contacts).values(row).run();
        return json({ data: row }, { status: 201 });
      } catch (e) { return err('Failed to create: ' + e.message); }
    }
    if (route.startsWith('/contacts/') && method === 'GET') {
      const { error } = await requireAuth(); if (error) return error;
      const id = path[1];
      const row = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      if (!row) return err('Not found', 404);
      return json({ data: row });
    }
    if (route.startsWith('/contacts/') && (method === 'PATCH' || method === 'PUT')) {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden', 403);
      const id = path[1];
      const body = await request.json();
      delete body.id; delete body.createdAt;
      db.update(s.contacts).set({ ...body, updatedAt: new Date() }).where(eq(s.contacts.id, id)).run();
      const row = db.select().from(s.contacts).where(eq(s.contacts.id, id)).get();
      return json({ data: row });
    }
    if (route.startsWith('/contacts/') && method === 'DELETE') {
      const { session, error } = await requireAuth(); if (error) return error;
      if (!requireRole(session, ['admin'])) return err('Forbidden', 403);
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
      });
    }

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
