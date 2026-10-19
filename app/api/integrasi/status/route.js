// GET /api/integrasi/status — ringkasan kesehatan integrasi Productivity App (hanya admin/direktur yang login).
// Tidak menampilkan rahasia/token; hanya apakah sudah diisi, jumlah kabar per status, dan galat terakhir.
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/auth';
import { getMongoDb } from '@/lib/db/mongo';
import { buatPenyimpananMongo } from '@/lib/integrasi/penyimpanan';
import { bacaKonfig } from '@/lib/integrasi/jalan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  let session = null;
  try { session = await getAuth().api.getSession({ headers: await headers() }); } catch { session = null; }
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['admin', 'direktur', 'akuntan'].includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const cfg = bacaKonfig();
  const out = { aktif: cfg.aktif, webhook: !!cfg.url && !!cfg.rahasia, tarik: !!cfg.token, uji: cfg.uji, rahasiaTerlaluPendek: cfg.rahasiaTerlaluPendek };
  try {
    const store = buatPenyimpananMongo(getMongoDb);
    Object.assign(out, await store.ringkas(), { mulai: (await store.meta('mulai'))?.tgl || null });
  } catch (e) { out.galatPenyimpanan = e?.message || String(e); }
  return NextResponse.json({ data: out });
}
