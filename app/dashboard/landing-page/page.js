import fs from 'fs'
import path from 'path'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getAuth } from '@/lib/auth/auth'
import { getAdminLandingSettings } from '@/lib/db/landing-settings'
import LandingSettingsForm from './landing-settings-form'

const ALLOWED_ROLES = ['admin', 'direktur']

function listLandingImages() {
  try {
    const dir = path.join(process.cwd(), 'public', 'landing')
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => `/landing/${f}`)
      .sort()
  } catch {
    return []
  }
}

export default async function LandingPageAdmin() {
  let session = null
  try {
    session = await getAuth().api.getSession({ headers: await headers() })
  } catch {}
  if (!session?.user) redirect('/login')
  if (!ALLOWED_ROLES.includes(session.user.role)) redirect('/dashboard')

  const settings = await getAdminLandingSettings()
  const images = listLandingImages()

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Landing Page Ayam Frozen</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kelola konten halaman{' '}
          <a href="/jual-ayam-frozen" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            /jual-ayam-frozen
          </a>{' '}
          dan kredensial Midtrans. Perubahan langsung tayang setelah disimpan, tanpa perlu deploy ulang.
        </p>
      </div>
      <LandingSettingsForm initialSettings={settings} availableImages={images} />
    </div>
  )
}
