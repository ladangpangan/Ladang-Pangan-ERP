import { NextResponse } from 'next/server'
import { getSnapClient } from '@/lib/midtrans'
import { findProduct } from '@/app/jual-ayam-frozen/products'

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body permintaan tidak valid.' }, { status: 400 })
  }

  const { productId, qty, customer } = body || {}
  const quantity = Number(qty)

  const product = findProduct(productId)
  if (!product) {
    return NextResponse.json({ error: 'Produk tidak ditemukan.' }, { status: 400 })
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    return NextResponse.json({ error: 'Jumlah pesanan tidak valid.' }, { status: 400 })
  }
  if (!customer?.name?.trim() || !customer?.phone?.trim()) {
    return NextResponse.json({ error: 'Nama dan nomor WhatsApp wajib diisi.' }, { status: 400 })
  }

  // Harga dihitung dari katalog server, bukan dari input klien, agar tidak bisa dimanipulasi.
  const grossAmount = product.price * quantity
  const orderId = `LPI-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`

  try {
    const snap = getSnapClient()
    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      item_details: [
        {
          id: product.id,
          name: product.name.slice(0, 50),
          price: product.price,
          quantity,
        },
      ],
      customer_details: {
        first_name: customer.name.trim().slice(0, 50),
        phone: customer.phone.trim(),
        billing_address: customer.address
          ? { address: customer.address.trim().slice(0, 200) }
          : undefined,
      },
    })

    return NextResponse.json({
      orderId,
      token: transaction.token,
      redirectUrl: transaction.redirect_url,
    })
  } catch (error) {
    console.error('Gagal membuat transaksi Midtrans:', error?.message || error)
    return NextResponse.json(
      { error: error?.message || 'Gagal membuat transaksi pembayaran.' },
      { status: 500 }
    )
  }
}
