'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Minus, Plus, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { formatIDR } from './products'

export default function OrderForm({ products, midtransClientKey, midtransIsProduction }) {
  const snapSrc = midtransIsProduction
    ? 'https://app.midtrans.com/snap/snap.js'
    : 'https://app.sandbox.midtrans.com/snap/snap.js'
  const [productId, setProductId] = useState(products[0].id)
  const [qty, setQty] = useState(2)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [snapReady, setSnapReady] = useState(false)

  useEffect(() => {
    if (!midtransClientKey || typeof window === 'undefined') return
    if (window.snap) {
      setSnapReady(true)
      return
    }
    const script = document.createElement('script')
    script.src = snapSrc
    script.setAttribute('data-client-key', midtransClientKey)
    script.async = true
    script.onload = () => setSnapReady(true)
    document.head.appendChild(script)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midtransClientKey])

  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId])
  const total = product ? product.price * qty : 0

  async function handlePay(e) {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) {
      toast.error('Mohon isi nama dan nomor WhatsApp Anda.')
      return
    }
    if (!midtransClientKey) {
      toast.error('Payment gateway belum dikonfigurasi oleh admin. Silakan pesan via WhatsApp.')
      return
    }
    if (!snapReady || !window.snap) {
      toast.error('Payment gateway masih dimuat, coba lagi sebentar lagi.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          qty,
          customer: { name, phone, address },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal membuat transaksi.')

      window.snap.pay(data.token, {
        onSuccess: () => toast.success('Pembayaran berhasil! Terima kasih sudah memesan.'),
        onPending: () => toast.info('Pembayaran tertunda. Selesaikan pembayaran Anda.'),
        onError: () => toast.error('Pembayaran gagal. Silakan coba lagi.'),
        onClose: () => toast.message('Kamu menutup jendela pembayaran sebelum selesai.'),
      })
    } catch (error) {
      toast.error(error.message || 'Terjadi kesalahan, silakan coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handlePay}
      className="mx-auto grid w-full max-w-3xl gap-6 rounded-3xl border border-[#E7D9C4] bg-white/90 p-6 shadow-[0_20px_60px_-30px_rgba(59,32,18,0.35)] sm:p-8"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#3B2C21]">Pilih Produk</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full rounded-xl border border-[#E7D9C4] bg-[#FBF6EE] px-4 py-3 text-[#3B2C21] outline-none focus:border-[#B3402A] focus:ring-2 focus:ring-[#B3402A]/20"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatIDR(p.price)} ({p.unit})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#3B2C21]">Jumlah</span>
          <div className="flex items-center overflow-hidden rounded-xl border border-[#E7D9C4] bg-[#FBF6EE]">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="flex h-12 w-12 items-center justify-center text-[#3B2C21] transition hover:bg-[#F1E4D3]"
              aria-label="Kurangi jumlah"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              type="number"
              min={1}
              max={500}
              value={qty}
              onChange={(e) => setQty(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
              className="h-12 w-full flex-1 bg-transparent text-center text-[#3B2C21] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(500, q + 1))}
              className="flex h-12 w-12 items-center justify-center text-[#3B2C21] transition hover:bg-[#F1E4D3]"
              aria-label="Tambah jumlah"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#3B2C21]">Nama Lengkap</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama Anda"
            className="w-full rounded-xl border border-[#E7D9C4] bg-[#FBF6EE] px-4 py-3 text-[#3B2C21] outline-none placeholder:text-[#9C8A76] focus:border-[#B3402A] focus:ring-2 focus:ring-[#B3402A]/20"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#3B2C21]">Nomor WhatsApp</span>
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="08xxxxxxxxxx"
            className="w-full rounded-xl border border-[#E7D9C4] bg-[#FBF6EE] px-4 py-3 text-[#3B2C21] outline-none placeholder:text-[#9C8A76] focus:border-[#B3402A] focus:ring-2 focus:ring-[#B3402A]/20"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-[#3B2C21]">
          Alamat Pengiriman <span className="text-[#9C8A76]">(opsional)</span>
        </span>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={2}
          placeholder="Alamat lengkap untuk pengiriman"
          className="w-full resize-none rounded-xl border border-[#E7D9C4] bg-[#FBF6EE] px-4 py-3 text-[#3B2C21] outline-none placeholder:text-[#9C8A76] focus:border-[#B3402A] focus:ring-2 focus:ring-[#B3402A]/20"
        />
      </label>

      <div className="flex flex-col items-stretch justify-between gap-4 border-t border-dashed border-[#E7D9C4] pt-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm text-[#6B5D4F]">Total pembayaran</p>
          <p className="font-serif text-3xl text-[#B3402A]">{formatIDR(total)}</p>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#B3402A] px-8 py-4 text-base font-medium text-white shadow-lg shadow-[#B3402A]/25 transition hover:bg-[#96311D] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
          Bayar Sekarang
        </button>
      </div>
      <p className="text-center text-xs text-[#9C8A76]">
        Pembayaran diproses aman melalui Midtrans — mendukung QRIS, transfer bank, dan e-wallet.
      </p>
    </form>
  )
}
