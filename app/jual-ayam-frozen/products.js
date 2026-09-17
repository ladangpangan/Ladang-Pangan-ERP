// Katalog produk untuk landing page "Jual Ayam Frozen".
// Harga di bawah ini adalah CONTOH/PLACEHOLDER untuk keperluan demo checkout —
// wajib disesuaikan dengan harga jual resmi Ladang pangan.id sebelum dipakai produksi.
export const PRODUCTS = [
  {
    id: 'karkas-frozen',
    name: 'Karkas Ayam Frozen',
    unit: 'per ekor (± 0.9–1 kg)',
    price: 32000,
    image: '/landing/produk-1.jpeg',
    description:
      'Ayam utuh yang dibekukan langsung setelah pemotongan di rumah potong ber-NKV, menjaga tekstur dan kesegaran daging hingga sampai di dapur Anda.',
  },
  {
    id: 'ceker-frozen',
    name: 'Ceker Ayam Frozen',
    unit: 'per kg',
    price: 25000,
    image: '/landing/produk-3.jpeg',
    description:
      'Ceker pilihan yang bersih dan higienis — favorit untuk kaldu, seblak, mie ayam, hingga camilan pedas.',
  },
]

export function findProduct(productId) {
  return PRODUCTS.find((p) => p.id === productId) || null
}

export function formatIDR(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount)
}
