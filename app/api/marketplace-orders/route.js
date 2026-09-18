import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { desc } from 'drizzle-orm';
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

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;
  if (!requireRole(session, ['admin', 'supervisor', 'direktur', 'operator'])) return err('Forbidden', 403);

  const db = getDb();
  const rows = db.select().from(s.marketplaceOrders).orderBy(desc(s.marketplaceOrders.receivedAt)).all();
  const data = rows.map((r) => ({
    ...r,
    items: JSON.parse(r.items || '[]'),
  }));
  return json({ data });
}
