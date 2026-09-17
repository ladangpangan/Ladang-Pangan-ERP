import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getMidtransServerKey } from '@/lib/midtrans'

// Webhook resmi Midtrans (HTTP notification). Daftarkan URL ini
// (https://<domain-anda>/api/midtrans/notification) di dashboard Midtrans
// pada Settings > Configuration > Payment Notification URL.
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body tidak valid.' }, { status: 400 })
  }

  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } =
    body || {}

  if (!order_id || !status_code || !gross_amount || !signature_key) {
    return NextResponse.json({ error: 'Payload notifikasi tidak lengkap.' }, { status: 400 })
  }

  let serverKey
  try {
    serverKey = getMidtransServerKey()
  } catch (error) {
    console.error(error.message)
    return NextResponse.json({ error: 'Server belum dikonfigurasi.' }, { status: 500 })
  }

  const expectedSignature = crypto
    .createHash('sha512')
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest('hex')

  if (expectedSignature !== signature_key) {
    console.warn('Signature notifikasi Midtrans tidak cocok untuk order:', order_id)
    return NextResponse.json({ error: 'Signature tidak valid.' }, { status: 403 })
  }

  // TODO: simpan/ubah status pesanan di database sesuai kebutuhan bisnis Anda.
  console.log(
    `[Midtrans] order=${order_id} status=${transaction_status} fraud=${fraud_status || '-'} amount=${gross_amount}`
  )

  return NextResponse.json({ received: true })
}
