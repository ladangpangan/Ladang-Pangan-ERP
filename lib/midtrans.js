import midtransClient from 'midtrans-client'

const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true'

export function getSnapClient() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY
  if (!serverKey || !clientKey) {
    throw new Error(
      'MIDTRANS_SERVER_KEY / NEXT_PUBLIC_MIDTRANS_CLIENT_KEY belum diset. Tambahkan di environment variables sebelum menerima pembayaran.'
    )
  }
  return new midtransClient.Snap({ isProduction, serverKey, clientKey })
}

export function getMidtransServerKey() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY
  if (!serverKey) {
    throw new Error('MIDTRANS_SERVER_KEY belum diset.')
  }
  return serverKey
}

export const midtransIsProduction = isProduction
