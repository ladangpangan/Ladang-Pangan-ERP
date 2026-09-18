// Receives new orders from the ladangpangan.id landing page (a separate app)
// and turns them into ERP data: find-or-create a Contact by phone, and — if
// every ordered item can be confidently matched to a real ERP product by
// name — a Draft Sales Order. If any item can't be matched, no Sales Order
// is created (to avoid corrupting real transactional data with a guessed
// product); instead staff get a notification with the raw order details so
// they can build the SO manually.
//
// Auth: static `x-api-key` header (LANDING_ORDERS_API_KEY env var) instead
// of the session-cookie auth the rest of the API uses, since the caller is
// a server, not a logged-in user.
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { eq, like } from 'drizzle-orm';
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

function nextSoNumber(db, dateArg) {
  const ym = dateArg ? new Date(dateArg) : new Date();
  const prefix = `SO/${ym.getFullYear()}${String(ym.getMonth() + 1).padStart(2, '0')}/`;
  const rows = db.select({ n: s.salesOrder.soNumber }).from(s.salesOrder).where(like(s.salesOrder.soNumber, `${prefix}%`)).all();
  let max = 0;
  for (const r of rows) { const suf = parseInt(String(r.n).slice(prefix.length), 10); if (!isNaN(suf) && suf > max) max = suf; }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function notifyStaff(db, { type = 'info', category, title, message, entityType, entityId, entityNumber, linkPath, priority = 'normal' }) {
  try {
    const recipients = authUsers.getCachedRecipients(['supervisor', 'direktur']);
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
        refApprovalId: null,
        priority,
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
  const phoneDigits = normalizePhone(customer.phone);

  // 1) Find-or-create Contact by phone (last 10 digits, tolerant of 0/62 prefix differences).
  let contact = phoneDigits
    ? await md.mdFindOne(md.MD.contacts, { phone: { $regex: `${phoneDigits.slice(-10)}$` } })
    : null;
  let contactCreated = false;

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
      contactCreated = true;
    } catch (e) {
      return err('Gagal membuat kontak: ' + (e?.message || e), 500);
    }
  }

  // 2) Try to match every ordered item to a real ERP product by name.
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
    else unmatchedItems.push(it);
  }

  // 3) All items matched -> create a real Draft Sales Order.
  let salesOrder = null;
  if (unmatchedItems.length === 0) {
    const now = new Date();
    const id = uuidv4();
    const soNumber = nextSoNumber(db, now);
    try {
      db.insert(s.salesOrder).values({
        id, soNumber, customerId: contact.id,
        orderDate: now, pipelineStatus: 'Draft', fulfillmentType: 'stock',
        notes: `Order dari ladangpangan.id — ${orderId}`,
        createdBy: 'landing-integration', createdAt: now, updatedAt: now,
      }).run();
      let totalAmount = 0;
      for (const it of matchedItems) {
        const qty = Number(it.qty || 0);
        const price = Number(it.price || 0);
        const subtotal = price * qty;
        totalAmount += subtotal;
        db.insert(s.salesOrderItems).values({
          id: uuidv4(), salesOrderId: id, productId: it.productId,
          quantity: qty, weight: qty, unitPrice: price, discount: 0, subtotal,
        }).run();
      }
      db.update(s.salesOrder).set({ totalAmount, updatedAt: new Date() }).where(eq(s.salesOrder.id, id)).run();
      salesOrder = { id, soNumber };

      notifyStaff(db, {
        type: 'info', category: 'so_new',
        title: `SO Baru dari Landing Page · ${soNumber}`,
        message: `Order online dari ${contact.displayName} (${orderId}) — Total Rp ${Math.round(totalAmount).toLocaleString('id-ID')}.`,
        entityType: 'SO', entityId: id, entityNumber: soNumber,
        linkPath: `/dashboard/sales-orders/${id}`,
      });
    } catch (e) {
      console.error('[landing-orders] gagal membuat SO:', e?.message || e);
      salesOrder = null;
    }
  }

  // 4) Couldn't confidently build a full SO -> leave it to staff, with full context.
  if (!salesOrder) {
    const itemsList = items
      .map((it) => `${it.qty}x ${it.name} @Rp${Number(it.price || 0).toLocaleString('id-ID')}`)
      .join(', ');
    notifyStaff(db, {
      type: 'warning', category: 'so_new', priority: 'high',
      title: `Order Landing Page perlu SO manual · ${orderId}`,
      message: `Kontak: ${contact.displayName} (${contact.phone}). Produk tidak cocok otomatis dengan katalog ERP — mohon buat SO manual. Item: ${itemsList}. Total Rp ${Number(grossAmount || 0).toLocaleString('id-ID')}.`,
      entityType: 'Contact', entityId: contact.id, entityNumber: contact.code,
      linkPath: `/dashboard/contacts/${contact.id}`,
    });
  }

  return json({
    ok: true,
    contactId: contact.id,
    contactCreated,
    salesOrderId: salesOrder?.id || null,
    soNumber: salesOrder?.soNumber || null,
    autoMatched: !!salesOrder,
  }, { status: 201 });
}
