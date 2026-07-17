import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// =========================
// AUTH TABLES (Better Auth)
// =========================
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('operator'), // admin, supervisor, direktur, operator
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// =========================
// MASTER DATA
// =========================

// CONTACTS - Supplier, Customer, RPH, Karyawan, Mitra
export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  contactType: text('contact_type').notNull(), // Supplier | Customer | RPH | Karyawan | Mitra
  code: text('code').notNull().unique(),
  companyName: text('company_name'),
  displayName: text('display_name').notNull(),
  isSubscriber: integer('is_subscriber', { mode: 'boolean' }).notNull().default(false),
  creditLimit: real('credit_limit').notNull().default(0),
  prepaidBalance: real('prepaid_balance').notNull().default(0),
  taxStatus: text('tax_status'), // PKP / NonPKP
  npwp: text('npwp'),
  address: text('address'),
  city: text('city'),
  province: text('province'),
  postalCode: text('postal_code'),
  phone: text('phone'),
  email: text('email'),
  picName: text('pic_name'),
  picPhone: text('pic_phone'),
  bankName: text('bank_name'),
  bankAccount: text('bank_account'),
  bankHolder: text('bank_holder'),
  legalDocs: text('legal_docs'), // JSON string
  notes: text('notes'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// PRODUCTS
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  category: text('category'), // Live Bird | Karkas | Boneless | Parting | Retail | Others
  unit: text('unit').notNull().default('kg'), // kg | ekor | pack | pcs
  basePrice: real('base_price').notNull().default(0),
  minStock: real('min_stock').notNull().default(0),
  shelfLifeDays: integer('shelf_life_days').notNull().default(0),
  description: text('description'),
  imageUrl: text('image_url'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// COLD STORAGE
export const coldStorages = sqliteTable('cold_storages', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  location: text('location'),
  temperatureRange: text('temperature_range'), // e.g. '-18 to -22 C'
  capacityKg: real('capacity_kg').notNull().default(0),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ZONES (children of Cold Storage)
export const zones = sqliteTable('zones', {
  id: text('id').primaryKey(),
  coldStorageId: text('cold_storage_id').notNull().references(() => coldStorages.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// =========================
// TRANSACTIONAL TABLES (schema only - modules built later)
// =========================

export const salesOrder = sqliteTable('sales_order', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => contacts.id),
  soNumber: text('so_number').notNull().unique(),
  orderDate: integer('order_date', { mode: 'timestamp' }).notNull(),
  pipelineStatus: text('pipeline_status').notNull().default('Draft'), // Draft | Diproses | Dikirim | Selesai | Dibatalkan
  dpAmount: real('dp_amount').notNull().default(0),
  totalAmount: real('total_amount').notNull().default(0),
  paymentTerm: text('payment_term'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const salesOrderItems = sqliteTable('sales_order_items', {
  id: text('id').primaryKey(),
  salesOrderId: text('sales_order_id').notNull().references(() => salesOrder.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  quantity: real('quantity').notNull().default(0),
  weight: real('weight').notNull().default(0),
  unitPrice: real('unit_price').notNull().default(0),
  subtotal: real('subtotal').notNull().default(0),
  stockCodeId: text('stock_code_id'), // FK to inventory_stock, filled at Surat Jalan
});

export const purchaseOrder = sqliteTable('purchase_order', {
  id: text('id').primaryKey(),
  supplierId: text('supplier_id').notNull().references(() => contacts.id),
  poNumber: text('po_number').notNull().unique(),
  method: text('method'), // Timbang Ulang | Timbang Kandang
  orderDate: integer('order_date', { mode: 'timestamp' }).notNull(),
  pipelineStatus: text('pipeline_status').notNull().default('Draft'),
  isDropship: integer('is_dropship', { mode: 'boolean' }).notNull().default(false),
  totalAmount: real('total_amount').notNull().default(0),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const purchaseOrderItems = sqliteTable('purchase_order_items', {
  id: text('id').primaryKey(),
  purchaseOrderId: text('purchase_order_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  quantity: real('quantity').notNull().default(0),
  weight: real('weight').notNull().default(0),
  unitPrice: real('unit_price').notNull().default(0),
  additionalCost: real('additional_cost').notNull().default(0),
});

export const workOrder = sqliteTable('work_order', {
  id: text('id').primaryKey(),
  purchaseOrderId: text('purchase_order_id').references(() => purchaseOrder.id),
  woNumber: text('wo_number').notNull().unique(),
  mode: text('mode').notNull().default('Internal'), // Internal | Maklon
  startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
  pipelineStatus: text('pipeline_status').notNull().default('Draft'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const workOrderDetails = sqliteTable('work_order_details', {
  id: text('id').primaryKey(),
  workOrderId: text('work_order_id').notNull().references(() => workOrder.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // kedatangan | potong | karkas | boneless | parting
  stageName: text('stage_name').notNull(),
  inputWeight: real('input_weight').notNull().default(0),
  outputWeight: real('output_weight').notNull().default(0),
  headCount: integer('head_count').notNull().default(0),
  bwAvg: real('bw_avg').notNull().default(0),
  rendemenData: text('rendemen_data'), // JSON
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const inventoryTransaction = sqliteTable('inventory_transaction', {
  id: text('id').primaryKey(),
  transactionDate: integer('transaction_date', { mode: 'timestamp' }).notNull(),
  transactionType: text('transaction_type').notNull(), // IN | OUT | TRANSFER | ADJUSTMENT
  referenceId: text('reference_id'), // WO / PO / SO id
  referenceType: text('reference_type'), // WO | PO | SO | ADJ
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const inventoryStock = sqliteTable('inventory_stock', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id),
  coldStorageId: text('cold_storage_id').notNull().references(() => coldStorages.id),
  zoneId: text('zone_id').references(() => zones.id),
  kodeSimpan: text('kode_simpan').notNull().unique(), // YYMMDD+seq
  quantity: real('quantity').notNull().default(0),
  weight: real('weight').notNull().default(0),
  expiredDate: integer('expired_date', { mode: 'timestamp' }),
  status: text('status').notNull().default('active'), // active | used | damaged
  sourceBatch: text('source_batch'), // WO or PO id
  sourceType: text('source_type'), // WO | PO
  transactionId: text('transaction_id').references(() => inventoryTransaction.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
