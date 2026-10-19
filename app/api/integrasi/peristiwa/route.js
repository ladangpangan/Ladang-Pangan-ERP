// GET /api/integrasi/peristiwa?sejak=<kursor>
// Endpoint TARIK untuk Productivity App (pengaman bila webhook terlewat). Wajib header
// "Authorization: Bearer <INTEGRASI_TOKEN>". Mengembalikan peristiwa berurutan setelah kursor (nomor urut outbox).
// Tidak memakai sesi login ERP; tanpa token yang benar = 401. Token tidak pernah ditulis ke log.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getMongoDb } from '@/lib/db/mongo';
import { buatPenyimpananMongo } from '@/lib/integrasi/penyimpanan';
import { bacaKonfig } from '@/lib/integrasi/jalan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function tokenCocok(header, token) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  if (!m || !token) return false;
  const a = Buffer.from(m[1].trim()); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request) {
  const cfg = bacaKonfig();
  if (!cfg.token) return NextResponse.json({ error: 'Integrasi tarik tidak aktif (INTEGRASI_TOKEN belum diisi).' }, { status: 404 });
  if (!tokenCocok(request.headers.get('authorization'), cfg.token)) return NextResponse.json({ error: 'Token tidak sah.' }, { status: 401 });
  const url = new URL(request.url);
  const sejak = Math.max(0, parseInt(url.searchParams.get('sejak') || '0', 10) || 0);
  const batas = Math.min(500, Math.max(1, parseInt(url.searchParams.get('batas') || '500', 10) || 500));
  try {
    const rows = await buatPenyimpananMongo(getMongoDb).sejak(sejak, batas);
    const peristiwa = rows.map((r) => ({ id: r.id, jenis: r.jenis, waktu: r.waktu, uji: !!r.uji, data: r.data, kursor: String(r.seq) }));
    return NextResponse.json({ peristiwa, kursor: peristiwa.length ? peristiwa[peristiwa.length - 1].kursor : String(sejak) });
  } catch (e) {
    console.error('[integrasi] tarik gagal:', e?.message || e);
    return NextResponse.json({ error: 'Gagal membaca antrean peristiwa.' }, { status: 500 });
  }
}
