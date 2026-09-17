import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth/auth'
import { getAdminLandingSettings, updateLandingSettings } from '@/lib/db/landing-settings'

const ALLOWED_ROLES = ['admin', 'direktur']

async function requireAdmin() {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }) }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return { error: NextResponse.json({ error: 'Anda tidak punya akses ke halaman ini.' }, { status: 403 }) }
  }
  return { session }
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const settings = await getAdminLandingSettings()
  return NextResponse.json(settings)
}

export async function PUT(request) {
  const { error } = await requireAdmin()
  if (error) return error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body permintaan tidak valid.' }, { status: 400 })
  }

  try {
    const settings = await updateLandingSettings(body || {})
    return NextResponse.json(settings)
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Gagal menyimpan pengaturan.' }, { status: 400 })
  }
}
