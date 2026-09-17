import { NextResponse } from 'next/server'

// Lightweight liveness check for the platform's health probe — must NEVER touch
// the database (Mongo can be slow/unreachable) so it always answers instantly,
// which stops the platform from mistaking a slow DB for a dead container.
export async function GET() {
  return NextResponse.json({ ok: true })
}
