import midtransClient from 'midtrans-client'
import { getLandingSettings } from '@/lib/db/landing-settings'

// Credentials are managed from the admin page (/dashboard/landing-page) and stored in Mongo,
// falling back to environment variables so the app still works before an admin sets them there.
async function resolveCredentials() {
  const settings = await getLandingSettings()
  const serverKey = settings.midtransServerKey || process.env.MIDTRANS_SERVER_KEY || ''
  const clientKey = settings.midtransClientKey || process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY || ''
  const isProduction = settings.midtransServerKey
    ? !!settings.midtransIsProduction
    : process.env.MIDTRANS_IS_PRODUCTION === 'true'
  return { serverKey, clientKey, isProduction }
}

export async function getSnapClient() {
  const { serverKey, clientKey, isProduction } = await resolveCredentials()
  if (!serverKey || !clientKey) {
    throw new Error(
      'Midtrans Server Key / Client Key belum diatur. Buka Dashboard > Landing Page Ayam Frozen untuk mengisinya.'
    )
  }
  return new midtransClient.Snap({ isProduction, serverKey, clientKey })
}

export async function getMidtransServerKey() {
  const { serverKey } = await resolveCredentials()
  if (!serverKey) {
    throw new Error('Midtrans Server Key belum diatur.')
  }
  return serverKey
}
