// Receives new orders from the ladangpangan.id landing page (a separate app).
// Finds-or-creates a Contact by phone, then stores the order as a pending
// row in marketplace_orders — it does NOT create a Sales Order here. Staff
// convert a pending order into a real Draft SO from the "Market Place
// Order" page (app/dashboard/marketplace-orders) via the "Proses SO"
// button, which calls POST /api/marketplace-orders/:id/process.
//
// Auth: static `x-api-key` header (LANDING_ORDERS_API_KEY env var) instead
// of the session-cookie auth the rest of the API uses, since the caller is
// a server, not a logged-in user.
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import * as s from '@/lib/db/schema';
import * as md from '@/lib/db/masterdata';
import * as authUsers from '@/lib/auth/users';

function json(data, init = {}) {
  return NextResponse.json(data, init);
}
function err(msg, status = 400) {
  return json({ error: msg }, { status });
}

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  return digits;
}

async function generateCustomerCode() {
  const codes = await md.mdPluck(md.MD.contacts, 'code');
  const existing = new Set(codes);
  const re = /^CUST-(\d+)$/;
  let max = 0;
  for (const c of codes) {
    const m = re.exec(c || '');
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  let n = max + 1;
  let code = `CUST-${String(n).padStart(3, '0')}`;
  while (existing.has(code)) { n++; code = `CUST-${String(n).padStart(3, '0')}`; }
  return code;
}

function notifyStaff(db, { title, message, entityId }) {
  try {
    const recipients = authUsers.getCachedRecipients(['supervisor', 'direktur']);
    const now = new Date();
    for (const r of recipients) {
      if (r.status && r.status !== 'active') continue;
      db.insert(s.notifications).values({
        id: uuidv4(),
        userId: r.id,
        type: 'info',
        category: 'so_new',
        title,
        message,
        entityType: 'MarketplaceOrder',
        entityId,
        entityNumber: null,
        linkPath: '/dashboard/marketplace-orders',
        refApprovalId: null,
        priority: 'normal',
        isRead: false,
        createdAt: now,
      }).run();
    }
  } catch (e) {
    console.error('[landing-orders] notifyStaff failed:', e?.message || e);
  }
}

export async function POST(request) {
  const expected = process.env.LANDING_ORDERS_API_KEY;
  if (!expected) return err('LANDING_ORDERS_API_KEY belum diatur di server.', 500);
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey || apiKey !== expected) return err('Unauthorized.', 401);

  let body;
  try { body = await request.json(); } catch { return err('Body tidak valid.'); }

  const { orderId, customer, items, grossAmount } = body || {};
  if (!orderId || !customer?.name || !customer?.phone || !Array.isArray(items) || items.length === 0) {
    return err('orderId, customer{name,phone}, dan items wajib diisi.');
  }

  const db = getDb();

  // Idempotent: replaying the same orderId (e.g. a retried webhook) must not
  // create a duplicate contact/order.
  const existing = db.select().from(s.marketplaceOrders).where(eq(s.marketplaceOrders.orderId, orderId)).get();
  if (existing) return json({ ok: true, id: existing.id, duplicate: true }, { status: 200 });

  const phoneDigits = normalizePhone(customer.phone);

  // Find-or-create Contact by phone (last 10 digits, tolerant of 0/62 prefix differences).
  let contact = phoneDigits
    ? await md.mdFindOne(md.MD.contacts, { phone: { $regex: `${phoneDigits.slice(-10)}$` } })
    : null;

  if (!contact) {
    const now = new Date();
    const row = {
      id: uuidv4(),
      contactType: 'Customer',
      categories: JSON.stringify(['Customer']),
      code: await generateCustomerCode(),
      displayName: String(customer.name).slice(0, 100),
      isAgent: false,
      isDropshipper: false,
      address: customer.address || null,
      phone: phoneDigits || String(customer.phone),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await md.mdInsert(md.MD.contacts, row);
      try { db.insert(s.contacts).values(row).run(); } catch (e) { console.error('[landing-orders] SQLite contact mirror failed:', e?.message || e); }
      contact = row;
    } catch (e) {
      return err('Gagal membuat kontak: ' + (e?.message || e), 500);
    }
  }

  const id = uuidv4();
  const now = new Date();
  db.insert(s.marketplaceOrders).values({
    id,
    orderId,
    customerName: String(customer.name).slice(0, 100),
    customerPhone: phoneDigits || String(customer.phone),
    customerAddress: customer.address || null,
    contactId: contact.id,
    items: JSON.stringify(items),
    grossAmount: Number(grossAmount || 0),
    status: 'pending',
    salesOrderId: null,
    receivedAt: now,
  }).run();

  notifyStaff(db, {
    title: `Order Baru dari Landing Page · ${orderId}`,
    message: `${contact.displayName} — Rp ${Number(grossAmount || 0).toLocaleString('id-ID')}. Buka Market Place Order untuk proses SO.`,
    entityId: id,
  });

  return json({ ok: true, id, contactId: contact.id }, { status: 201 });
}
