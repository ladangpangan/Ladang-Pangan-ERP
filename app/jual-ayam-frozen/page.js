import Image from 'next/image'
import {
  Award,
  BadgePercent,
  CheckCircle2,
  MapPin,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Truck,
} from 'lucide-react'
import OrderForm from './order-form'
import { formatIDR } from './products'
import { getPublicLandingSettings } from '@/lib/db/landing-settings'

// Konten (nomor WA, produk, kredensial Midtrans) diedit lewat Dashboard > Landing Page Ayam
// Frozen dan disimpan di database, jadi halaman ini harus selalu dirender ulang per-request.
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Ladang pangan.id — Ayam Frozen Segar Langsung dari Peternak',
  description:
    'Beli ayam frozen berkualitas langsung dari peternak mitra Ladang pangan.id. Bersertifikat Halal & NKV, harga bersaing, pesan dan bayar online tanpa ribet.',
}

const VALUE_PROPS = [
  {
    icon: BadgePercent,
    title: 'Harga Bersaing',
    body: 'Langsung dari peternak mitra tanpa rantai tengkulak berlapis, sehingga harga tetap kompetitif untuk usaha maupun rumah tangga.',
  },
  {
    icon: Sparkles,
    title: 'Mudah & Tanpa Ribet',
    body: 'Pilih produk, bayar online dalam hitungan detik — tanpa perlu tawar-menawar panjang atau menunggu konfirmasi manual.',
  },
  {
    icon: PackageCheck,
    title: 'Fleksibel',
    body: 'Melayani pembelian eceran untuk kebutuhan dapur rumah hingga partai besar untuk restoran, katering, dan distributor.',
  },
  {
    icon: ShieldCheck,
    title: 'Higienis & Bersertifikat',
    body: 'Diproses di rumah potong ber-NKV, terjamin halal, dan dikemas dalam kondisi beku sempurna menjaga kesegaran.',
  },
]

const STEPS = [
  {
    title: 'Pilih & Bayar Online',
    body: 'Tentukan produk dan jumlah pesanan, lalu selesaikan pembayaran langsung di halaman ini — QRIS, transfer bank, atau e-wallet.',
  },
  {
    title: 'Pesanan Diproses',
    body: 'Tim kami langsung menyiapkan pesanan Anda dari cold storage, dikemas rapi dalam kondisi beku sempurna.',
  },
  {
    title: 'Diterima Tanpa Ribet',
    body: 'Pesanan dikirim ke alamat Anda — tidak perlu bolak-balik chat, tanpa proses rumit, tinggal terima dan simpan di freezer.',
  },
]

const CERTIFICATIONS = [
  { icon: Award, label: 'Bersertifikat Halal Indonesia' },
  { icon: ShieldCheck, label: 'NKV (Nomor Kontrol Veteriner)' },
  { icon: Snowflake, label: 'Rantai Dingin (Cold Chain) Terjaga' },
  { icon: MapPin, label: 'Diproduksi di Sidoarjo, Jawa Timur' },
]

export default async function LandingPage() {
  const settings = await getPublicLandingSettings()
  const products = settings.products
  const waMessage = encodeURIComponent(settings.waMessage)
  const WA_LINK = `https://wa.me/${settings.whatsappNumber}?text=${waMessage}`

  return (
    <div className="min-h-screen bg-[#FBF6EE] text-[#241C15]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,600;1,9..144,500&family=Jost:wght@300;400;500;600&display=swap');
        .lpi-landing { font-family: 'Jost', ui-sans-serif, system-ui, sans-serif; }
        .lpi-landing .font-serif { font-family: 'Fraunces', ui-serif, Georgia, serif; }
      `}</style>

      <div className="lpi-landing">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-[#E7D9C4]/70 bg-[#FBF6EE]/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
            <span className="font-serif text-xl font-medium tracking-tight text-[#241C15]">
              Ladang <span className="text-[#7C9C7B]">pangan.id</span>
            </span>
            <nav className="hidden items-center gap-8 text-sm font-medium text-[#3B2C21]/80 md:flex">
              <a href="#produk" className="transition hover:text-[#B3402A]">Produk</a>
              <a href="#keunggulan" className="transition hover:text-[#B3402A]">Keunggulan</a>
              <a href="#pesan" className="transition hover:text-[#B3402A]">Pesan &amp; Bayar</a>
              <a href="#jaminan" className="transition hover:text-[#B3402A]">Jaminan Mutu</a>
            </nav>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#B3402A] px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-[#B3402A]/20 transition hover:bg-[#96311D] sm:px-5"
            >
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Chat WhatsApp</span>
              <span className="sm:hidden">WA</span>
            </a>
          </div>
        </header>

        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#DCE7D6] blur-3xl" />
          <div className="pointer-events-none absolute -left-32 top-40 h-80 w-80 rounded-full bg-[#F3D9C4] blur-3xl" />

          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#E7D9C4] bg-white/70 px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-[#7C9C7B]">
                Produsen Ayam Langsung dari Peternak
              </span>
              <h1 className="mt-6 font-serif text-4xl font-medium leading-tight text-[#241C15] sm:text-5xl lg:text-[3.4rem]">
                Beli, Bayar, <span className="italic text-[#B3402A]">Terima</span> — Ayam Frozen Tanpa Ribet
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#6B5D4F]">
                Ayam frozen higienis dari peternakan mitra kami di Sidoarjo, dibekukan sempurna untuk
                menjaga kesegaran. Pesan dan bayar langsung online dalam hitungan menit — pesanan
                Anda diproses tanpa perlu tawar-menawar panjang.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#pesan"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#B3402A] px-8 py-4 text-base font-medium text-white shadow-lg shadow-[#B3402A]/25 transition hover:bg-[#96311D]"
                >
                  <ShieldCheck className="h-5 w-5" />
                  Pesan &amp; Bayar Sekarang
                </a>
                <a
                  href={WA_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[#E7D9C4] bg-white px-8 py-4 text-base font-medium text-[#3B2C21] transition hover:border-[#B3402A] hover:text-[#B3402A]"
                >
                  <MessageCircle className="h-5 w-5" />
                  Tanya via WhatsApp
                </a>
              </div>
              <p className="mt-5 text-sm text-[#9C8A76]">
                Dipercaya pelaku usaha kuliner, katering &amp; rumah tangga di Jawa Timur
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-sm">
              <div className="overflow-hidden rounded-[2rem] border border-[#E7D9C4] bg-white shadow-[0_30px_80px_-30px_rgba(59,32,18,0.4)]">
                <Image
                  src="/landing/produk-5.jpeg"
                  alt="Kemasan ayam frozen Ladang pangan.id, bersertifikat Halal dan NKV"
                  width={800}
                  height={1200}
                  className="aspect-[4/5] w-full object-cover"
                  priority
                />
              </div>
              <div className="absolute -bottom-6 -left-6 flex items-center gap-3 rounded-2xl border border-[#E7D9C4] bg-white px-4 py-3 shadow-lg">
                <ShieldCheck className="h-8 w-8 text-[#7C9C7B]" />
                <div>
                  <p className="text-sm font-medium text-[#241C15]">Halal &amp; NKV</p>
                  <p className="text-xs text-[#9C8A76]">Bersertifikat resmi</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust strip */}
        <section className="border-y border-[#E7D9C4]/70 bg-[#F4EADB]">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-8 sm:px-8 md:grid-cols-4">
            {CERTIFICATIONS.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <Icon className="h-6 w-6 shrink-0 text-[#B3402A]" />
                <span className="text-sm font-medium text-[#3B2C21]">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Value props */}
        <section id="keunggulan" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-medium uppercase tracking-wider text-[#7C9C7B]">Kenapa Ladang pangan.id</span>
            <h2 className="mt-3 font-serif text-3xl font-medium text-[#241C15] sm:text-4xl">
              Bersaing, Mudah, dan Fleksibel
            </h2>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-[#E7D9C4] bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#F1E4D3] text-[#B3402A]">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="font-serif text-lg font-medium text-[#241C15]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6B5D4F]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Products */}
        <section id="produk" className="bg-[#F4EADB] py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-sm font-medium uppercase tracking-wider text-[#7C9C7B]">Produk Unggulan</span>
              <h2 className="mt-3 font-serif text-3xl font-medium text-[#241C15] sm:text-4xl">
                Segar dari Peternakan, Beku Sempurna
              </h2>
            </div>
            <div className="mt-12 grid gap-8 sm:grid-cols-2">
              {products.map((p) => (
                <div
                  key={p.id}
                  className="group overflow-hidden rounded-3xl border border-[#E7D9C4] bg-white shadow-sm transition hover:shadow-xl"
                >
                  <div className="overflow-hidden">
                    <Image
                      src={p.image}
                      alt={p.name}
                      width={900}
                      height={700}
                      className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-serif text-xl font-medium text-[#241C15]">{p.name}</h3>
                      <span className="whitespace-nowrap rounded-full bg-[#F1E4D3] px-3 py-1 text-sm font-medium text-[#B3402A]">
                        {formatIDR(p.price)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-wide text-[#9C8A76]">{p.unit}</p>
                    <p className="mt-3 text-sm leading-relaxed text-[#6B5D4F]">{p.description}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-[#6B5D4F]">
              Cari potongan lain (dada, paha, sayap) untuk kebutuhan usaha Anda?{' '}
              <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="font-medium text-[#B3402A] underline underline-offset-4">
                Tanyakan ke tim kami
              </a>
              .
            </p>
          </div>
        </section>

        {/* Order & pay */}
        <section id="pesan" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-sm font-medium uppercase tracking-wider text-[#7C9C7B]">Pesan &amp; Bayar Online</span>
            <h2 className="mt-3 font-serif text-3xl font-medium text-[#241C15] sm:text-4xl">
              Tanpa Ribet — Bayar Sekarang, Terima Beres
            </h2>
            <p className="mt-4 text-[#6B5D4F]">
              Selesaikan pesanan dan pembayaran langsung di sini. Kami proses pesanan Anda segera setelah pembayaran dikonfirmasi.
            </p>
          </div>
          <div className="mt-12">
            <OrderForm
              products={products}
              midtransClientKey={settings.midtransClientKey}
              midtransIsProduction={settings.midtransIsProduction}
            />
          </div>

          <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="text-center">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#B3402A] font-serif text-sm text-white">
                  {i + 1}
                </div>
                <h4 className="font-medium text-[#241C15]">{step.title}</h4>
                <p className="mt-1.5 text-sm leading-relaxed text-[#6B5D4F]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Quality guarantee */}
        <section id="jaminan" className="bg-[#F4EADB] py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
            <div className="overflow-hidden rounded-3xl border border-[#E7D9C4] shadow-lg">
              <Image
                src="/landing/produk-2.jpeg"
                alt="Sertifikasi Halal dan NKV pada kemasan ayam frozen Ladang pangan.id"
                width={900}
                height={1100}
                className="aspect-[4/5] w-full object-cover"
              />
            </div>
            <div>
              <span className="text-sm font-medium uppercase tracking-wider text-[#7C9C7B]">Jaminan Mutu</span>
              <h2 className="mt-3 font-serif text-3xl font-medium text-[#241C15] sm:text-4xl">
                Kualitas yang Bisa Anda Percaya
              </h2>
              <ul className="mt-8 space-y-5">
                {[
                  'Dipotong dan diproses di rumah potong unggas ber-Nomor Kontrol Veteriner (NKV).',
                  'Bersertifikat Halal Indonesia, aman dan sesuai syariat.',
                  'Dikemas dan dibekukan segera untuk menjaga rantai dingin (cold chain) dari produksi hingga pengiriman.',
                  'Diproduksi oleh mitra peternak di Kabupaten Sidoarjo, Jawa Timur.',
                ].map((text) => (
                  <li key={text} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#7C9C7B]" />
                    <span className="text-[#3B2C21]">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* CTA banner */}
        <section className="relative overflow-hidden bg-[#B3402A] py-16">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 text-center sm:px-8">
            <Truck className="h-10 w-10 text-white/90" />
            <h2 className="font-serif text-3xl font-medium text-white sm:text-4xl">
              Siap Belanja Ayam Frozen Berkualitas?
            </h2>
            <p className="max-w-xl text-white/85">
              Melayani pembelian eceran hingga partai besar. Pesan &amp; bayar online sekarang, atau
              hubungi tim kami untuk kebutuhan pasokan rutin usaha Anda.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="#pesan"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-base font-medium text-[#B3402A] shadow-lg transition hover:bg-[#FBF6EE]"
              >
                <ShieldCheck className="h-5 w-5" />
                Pesan &amp; Bayar Sekarang
              </a>
              <a
                href={WA_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/40 px-8 py-4 text-base font-medium text-white transition hover:bg-white/10"
              >
                <MessageCircle className="h-5 w-5" />
                Chat WhatsApp
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-[#241C15] py-14 text-[#E7D9C4]">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="flex flex-col items-start justify-between gap-8 sm:flex-row">
              <div>
                <span className="font-serif text-xl font-medium text-white">
                  Ladang <span className="text-[#9CC49A]">pangan.id</span>
                </span>
                <p className="mt-3 max-w-xs text-sm text-[#C8B9A4]">
                  Produsen ayam frozen langsung dari peternak. Bersaing, mudah, dan fleksibel.
                </p>
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <a href="#produk" className="transition hover:text-white">Produk</a>
                <a href="#pesan" className="transition hover:text-white">Pesan &amp; Bayar</a>
                <a href="#jaminan" className="transition hover:text-white">Jaminan Mutu</a>
                <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="transition hover:text-white">
                  WhatsApp
                </a>
              </div>
              <div className="flex items-start gap-2 text-sm text-[#C8B9A4]">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Kabupaten Sidoarjo, Jawa Timur, Indonesia</span>
              </div>
            </div>
            <div className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-[#9C8A76]">
              © {new Date().getFullYear()} PT Ladang Pangan Indonesia. Seluruh hak cipta dilindungi.
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
