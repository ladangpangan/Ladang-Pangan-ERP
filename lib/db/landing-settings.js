// Store for the public "/jual-ayam-frozen" landing page content + Midtrans credentials.
// Kept in its own Mongo collection (not wired into the SQLite-mirror sync in misc-mongo.js)
// since this is low-frequency admin-edited config, not hot transactional data.
//
// Uses its OWN MongoClient (same connection string as lib/db/mongo.js) with a short
// serverSelectionTimeoutMS instead of the app-wide shared client/timeout. The shared client's
// default ~30s server-selection timeout would otherwise make the public sales page hang for
// 30s on every request whenever Mongo is briefly unreachable — unacceptable for a page whose
// whole pitch is "tanpa ribet". AbortSignal does NOT help here: it only cancels an operation
// after a server has been selected, not during the initial topology-discovery wait.
import { MongoClient } from 'mongodb'
import { MONGO_DB_NAME } from '@/lib/db/mongo'
import { DEFAULT_PRODUCTS } from '@/app/jual-ayam-frozen/products'

const MONGO_URL = process.env.ATLAS_MONGO_URL || process.env.MONGO_URL || 'mongodb://localhost:27017'
const COLLECTION = 'landing_settings'
const DOC_ID = 'jual-ayam-frozen'

const DEFAULTS = {
  _id: DOC_ID,
  whatsappNumber: '6282229348883',
  waMessage: 'Halo Ladang pangan.id, saya ingin tanya-tanya soal ayam frozen.',
  products: DEFAULT_PRODUCTS,
  midtransServerKey: '',
  midtransClientKey: '',
  midtransIsProduction: false,
  updatedAt: null,
}

let _client
function col() {
  if (!_client) {
    _client = new MongoClient(MONGO_URL, {
      maxPoolSize: 3,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    })
  }
  return _client.db(MONGO_DB_NAME).collection(COLLECTION)
}

function sanitizeProducts(products) {
  if (!Array.isArray(products)) return DEFAULT_PRODUCTS
  return products
    .filter((p) => p && p.id && p.name)
    .map((p) => ({
      id: String(p.id).trim().slice(0, 60),
      name: String(p.name).trim().slice(0, 100),
      unit: String(p.unit || '').trim().slice(0, 60),
      price: Math.max(0, Math.round(Number(p.price) || 0)),
      image: String(p.image || '').trim().slice(0, 300) || '/landing/produk-1.jpeg',
      description: String(p.description || '').trim().slice(0, 500),
    }))
}

// Full settings, including the raw Midtrans keys. Server-side use only (checkout API,
// notification webhook, admin route) — never expose the raw result to a public route.
export async function getLandingSettings() {
  let doc = null
  try {
    doc = await col().findOne({ _id: DOC_ID })
  } catch (e) {
    console.error('[landing-settings] read failed:', e?.message || e)
  }
  return {
    ...DEFAULTS,
    ...doc,
    products: doc?.products?.length ? doc.products : DEFAULTS.products,
  }
}

// Subset safe to send to the public landing page / browser.
export async function getPublicLandingSettings() {
  const s = await getLandingSettings()
  return {
    whatsappNumber: s.whatsappNumber,
    waMessage: s.waMessage,
    products: s.products,
    midtransClientKey: s.midtransClientKey,
    midtransIsProduction: !!s.midtransIsProduction,
  }
}

// Subset safe to send to the admin settings form: keys are never echoed back raw.
export async function getAdminLandingSettings() {
  const s = await getLandingSettings()
  return {
    whatsappNumber: s.whatsappNumber,
    waMessage: s.waMessage,
    products: s.products,
    midtransClientKey: s.midtransClientKey,
    midtransIsProduction: !!s.midtransIsProduction,
    hasMidtransServerKey: !!s.midtransServerKey,
    midtransServerKeyPreview: s.midtransServerKey
      ? `••••${s.midtransServerKey.slice(-4)}`
      : null,
    updatedAt: s.updatedAt,
  }
}

export async function updateLandingSettings(input) {
  const update = { updatedAt: new Date().toISOString() }

  if (typeof input.whatsappNumber === 'string') {
    const digits = input.whatsappNumber.replace(/[^0-9]/g, '')
    if (!digits || digits.length < 8) throw new Error('Nomor WhatsApp tidak valid.')
    update.whatsappNumber = digits
  }
  if (typeof input.waMessage === 'string') {
    update.waMessage = input.waMessage.trim().slice(0, 300)
  }
  if (input.products !== undefined) {
    update.products = sanitizeProducts(input.products)
    if (!update.products.length) throw new Error('Minimal harus ada satu produk.')
  }
  if (typeof input.midtransClientKey === 'string') {
    update.midtransClientKey = input.midtransClientKey.trim()
  }
  // Blank/omitted server key means "keep the existing one" — never overwrite with empty.
  if (typeof input.midtransServerKey === 'string' && input.midtransServerKey.trim()) {
    update.midtransServerKey = input.midtransServerKey.trim()
  }
  if (typeof input.midtransIsProduction === 'boolean') {
    update.midtransIsProduction = input.midtransIsProduction
  }

  try {
    await col().updateOne(
      { _id: DOC_ID },
      { $set: update, $setOnInsert: { _id: DOC_ID } },
      { upsert: true }
    )
  } catch (e) {
    if (e.name === 'MongoServerSelectionError' || /timed? ?out/i.test(e.message || '')) {
      throw new Error('Gagal menyimpan: koneksi database timeout. Coba lagi.')
    }
    throw e
  }
  return getAdminLandingSettings()
}
