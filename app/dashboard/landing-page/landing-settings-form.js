'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Plus, Trash2, ExternalLink, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { CurrencyInput } from '@/components/ui/currency-input'

let uid = 0
const newProduct = () => ({
  id: `produk-${Date.now()}-${uid++}`,
  name: '',
  unit: '',
  price: 0,
  image: '',
  description: '',
})

export default function LandingSettingsForm({ initialSettings, availableImages }) {
  const [whatsappNumber, setWhatsappNumber] = useState(initialSettings.whatsappNumber || '')
  const [waMessage, setWaMessage] = useState(initialSettings.waMessage || '')
  const [products, setProducts] = useState(initialSettings.products || [])
  const [clientKey, setClientKey] = useState(initialSettings.midtransClientKey || '')
  const [serverKey, setServerKey] = useState('')
  const [isProduction, setIsProduction] = useState(!!initialSettings.midtransIsProduction)
  const [hasServerKey, setHasServerKey] = useState(initialSettings.hasMidtransServerKey)
  const [serverKeyPreview, setServerKeyPreview] = useState(initialSettings.midtransServerKeyPreview)
  const [saving, setSaving] = useState(false)

  function updateProduct(id, patch) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }
  function removeProduct(id) {
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }
  function addProduct() {
    setProducts((prev) => [...prev, newProduct()])
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!products.length) {
      toast.error('Minimal harus ada satu produk.')
      return
    }
    for (const p of products) {
      if (!p.name.trim()) {
        toast.error('Nama produk tidak boleh kosong.')
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/landing-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsappNumber,
          waMessage,
          products,
          midtransClientKey: clientKey,
          midtransServerKey: serverKey, // kosong = pertahankan key lama (ditangani di server)
          midtransIsProduction: isProduction,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan.')

      setHasServerKey(data.hasMidtransServerKey)
      setServerKeyPreview(data.midtransServerKeyPreview)
      setServerKey('')
      toast.success('Pengaturan landing page berhasil disimpan.')
    } catch (error) {
      toast.error(error.message || 'Gagal menyimpan pengaturan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 pb-10">
      <Card>
        <CardHeader>
          <CardTitle>Kontak WhatsApp</CardTitle>
          <CardDescription>Nomor dan pesan default untuk semua tombol WhatsApp di landing page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-number">Nomor WhatsApp</Label>
            <Input
              id="wa-number"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="6282229348883"
            />
            <p className="text-xs text-muted-foreground">Format internasional tanpa &quot;+&quot;, contoh 6282229348883.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wa-message">Pesan Default</Label>
            <Textarea id="wa-message" rows={2} value={waMessage} onChange={(e) => setWaMessage(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Produk</CardTitle>
          <CardDescription>Produk yang tampil di halaman, termasuk harga yang dipakai saat checkout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {products.map((p, idx) => (
            <div key={p.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Produk {idx + 1}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(p.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Nama Produk</Label>
                  <Input value={p.name} onChange={(e) => updateProduct(p.id, { name: e.target.value })} placeholder="Karkas Ayam Frozen" />
                </div>
                <div className="space-y-1.5">
                  <Label>Satuan</Label>
                  <Input value={p.unit} onChange={(e) => updateProduct(p.id, { unit: e.target.value })} placeholder="per ekor (± 0.9–1 kg)" />
                </div>
                <div className="space-y-1.5">
                  <Label>Harga (Rp)</Label>
                  <CurrencyInput value={p.price} onChange={(v) => updateProduct(p.id, { price: v })} placeholder="32.000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Path Gambar</Label>
                  <Input value={p.image} onChange={(e) => updateProduct(p.id, { image: e.target.value })} placeholder="/landing/produk-1.jpeg" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Deskripsi</Label>
                <Textarea rows={2} value={p.description} onChange={(e) => updateProduct(p.id, { description: e.target.value })} />
              </div>
              {availableImages.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Pilih dari foto yang tersedia</Label>
                  <div className="flex flex-wrap gap-2">
                    {availableImages.map((src) => (
                      <button
                        type="button"
                        key={src}
                        onClick={() => updateProduct(p.id, { image: src })}
                        className={`overflow-hidden rounded-md border-2 transition ${
                          p.image === src ? 'border-primary' : 'border-transparent hover:border-muted-foreground/30'
                        }`}
                        title={src}
                      >
                        <Image src={src} alt="" width={56} height={56} className="h-14 w-14 object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" onClick={addProduct} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Tambah Produk
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment Gateway (Midtrans)</CardTitle>
          <CardDescription>
            Ambil Server Key &amp; Client Key dari dashboard Midtrans Anda (Settings &gt; Access Keys). Gunakan mode
            Sandbox dulu untuk uji coba sebelum mengaktifkan Production.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="client-key">Client Key</Label>
            <Input
              id="client-key"
              value={clientKey}
              onChange={(e) => setClientKey(e.target.value)}
              placeholder="SB-Mid-client-xxxxxxxxxxxx"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="server-key">Server Key</Label>
            <Input
              id="server-key"
              type="password"
              value={serverKey}
              onChange={(e) => setServerKey(e.target.value)}
              placeholder={hasServerKey ? `Tersimpan (${serverKeyPreview}) — kosongkan untuk mempertahankan` : 'SB-Mid-server-xxxxxxxxxxxx'}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {hasServerKey
                ? 'Server key sudah tersimpan dan tidak ditampilkan ulang demi keamanan. Isi field ini hanya jika ingin menggantinya.'
                : 'Belum ada server key tersimpan — checkout tidak akan berfungsi sampai diisi.'}
            </p>
          </div>
          <Separator />
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Mode Production</p>
              <p className="text-xs text-muted-foreground">
                {isProduction
                  ? 'AKTIF — pembayaran nyata akan diproses. Pastikan key di atas adalah Production key.'
                  : 'Nonaktif (Sandbox) — aman untuk uji coba, tidak ada uang nyata yang berpindah.'}
              </p>
            </div>
            <Switch checked={isProduction} onCheckedChange={setIsProduction} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <a
          href="/jual-ayam-frozen"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Lihat halaman <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Simpan Pengaturan
        </Button>
      </div>
    </form>
  )
}
