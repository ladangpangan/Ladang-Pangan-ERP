// Converts one pending marketplace order into a real Draft Sales Order.
// Triggered by the "Proses SO" button on app/dashboard/marketplace-orders.
// Every ordered item must match a real ERP product by name — if any don't,
// nothing is created and the response lists which ones failed, so staff can
// either fix the product name or build the SO manually from Sales Orders.
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { headers } from 'next/headers';
import { eq, like } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import * as s from '@/lib/db/schema';
import { getAuth } from '@/lib/auth/auth';

function json(data, init = {}) {
  return NextResponse.json(data, init);
}
function err(msg, status = 400) {
  return json({ error: msg }, { status });
}

async function requireAuth() {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return { error: err('Unauthorized', 401) };
    return { session };
  } catch {
    return { error: err('Unauthorized', 401) };
  }
}

function requireRole(session, allowed) {
  if (!session?.user?.role) return false;
  if (session.user.role === 'akuntan' && allowed.includes('admin')) return true;
  return allowed.includes(session.user.role);
}

function nextSoNumber(db, dateArg) {
  const ym = dateArg ? new Date(dateArg) : new Date();
  const prefix = `SO/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
  const rows = db.select({ n: s.salesOrder.soNumber }).from(s.salesOrder).where(like(s.salesOrder.soNumber, `${prefix}%`)).all();
  let max = 0;
  for (const r of rows) { const suf = parseInt(String(r.n).slice(prefix.length), 10); if (!isNaN(suf) && suf > max) max = suf; }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export async function POST(request, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  if (!requireRole(session, ['admin', 'supervisor'])) return err('Forbidden - hanya admin & supervisor', 403);

  const { id } = await params;
  const db = getDb();
  const order = db.select().from(s.marketplaceOrders).where(eq(s.marketplaceOrders.id, id)).get();
  if (!order) return err('Order tidak ditemukan', 404);
  if (order.status === 'processed') {
    return json({ ok: true, alreadyProcessed: true, salesOrderId: order.salesOrderId });
  }
  if (!order.contactId) return err('Order ini belum tertaut ke kontak.', 400);

  const items = JSON.parse(order.items || '[]');
  if (!items.length) return err('Order ini tidak punya item.', 400);

  // Match every item to a real ERP product by name.
  const products = db.select().from(s.products).all();
  const norm = (v) => String(v || '').trim().toLowerCase();
  const matchedItems = [];
  const unmatchedItems = [];
  for (const it of items) {
    const name = norm(it.name);
    const found =
      products.find((p) => norm(p.name) === name) ||
      products.find((p) => norm(p.name).includes(name) || name.includes(norm(p.name)));
    if (found) matchedItems.push({ ...it, productId: found.id });
    else unmatchedItems.push(it.name);
  }

  if (unmatchedItems.length > 0) {
    return err(
      `Produk berikut tidak ditemukan di katalog ERP: ${unmatchedItems.join(', ')}. ` +
      `Samakan nama produknya di Products, atau buat SO manual dari halaman Sales Order.`,
      422
    );
  }

  const now = new Date();
  const soId = uuidv4();
  const soNumber = nextSoNumber(db, now);
  try {
    db.insert(s.salesOrder).values({
      id: soId, soNumber, customerId: order.contactId,
      orderDate: now, pipelineStatus: 'Draft', fulfillmentType: 'stock',
      notes: `Order dari ladangpangan.id — ${order.orderId}`,
      createdBy: session.user.email, createdAt: now, updatedAt: now,
    }).run();
    let totalAmount = 0;
    for (const it of matchedItems) {
      const qty = Number(it.qty || 0);
      const price = Number(it.price || 0);
      const subtotal = price * qty;
      totalAmount += subtotal;
      db.insert(s.salesOrderItems).values({
        id: uuidv4(), salesOrderId: soId, productId: it.productId,
        quantity: qty, weight: qty, unitPrice: price, discount: 0, subtotal,
      }).run();
    }
    db.update(s.salesOrder).set({ totalAmount, updatedAt: new Date() }).where(eq(s.salesOrder.id, soId)).run();
    db.update(s.marketplaceOrders).set({
      status: 'processed', salesOrderId: soId, processedAt: now, processedBy: session.user.email,
    }).where(eq(s.marketplaceOrders.id, id)).run();
  } catch (e) {
    console.error('[marketplace-orders/process] gagal membuat SO:', e?.message || e);
    return err('Gagal membuat Sales Order: ' + (e?.message || e), 500);
  }

  return json({ ok: true, salesOrderId: soId, soNumber });
}
