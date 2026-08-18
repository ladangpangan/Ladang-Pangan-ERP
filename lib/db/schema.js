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
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
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
  contactType: text('contact_type').notNull(), // primary category (kompatibilitas): Supplier | Customer | RPH | Karyawan | Mitra | Agen | Dropshipper
  categories: text('categories'), // JSON array of categories (multi-select). Source of truth.
  code: text('code').notNull().unique(),
  companyName: text('company_name'),
  displayName: text('display_name').notNull(),
  isSubscriber: integer('is_subscriber', { mode: 'boolean' }).notNull().default(false),
  creditLimit: real('credit_limit').notNull().default(0),
  prepaidBalance: real('prepaid_balance').notNull().default(0),
  // Agen: harga khusus (diskon persen otomatis saat transaksi)
  isAgent: integer('is_agent', { mode: 'boolean' }).notNull().default(false),
  agentDiscountPct: real('agent_discount_pct').notNull().default(0),
  // Dropshipper: skema komisi
  isDropshipper: integer('is_dropshipper', { mode: 'boolean' }).notNull().default(false),
  commissionType: text('commission_type'), // per_kg | fixed | percent_profit
  commissionValue: real('commission_value').notNull().default(0),
  taxStatus: text('tax_status'), // PKP / NonPKP
  npwp: text('npwp'),
  address: text('address'),
  city: text('city'),
  province: text('province'),
  postalCode: text('postal_code'),
  mapsUrl: text('maps_url'),
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
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// PRODUCTS
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  category: text('category'), // raw | WIP | FG | merch
  subCategory: text('sub_category'), // Live Bird | Karkas | Boneless | Parting | Retail | Others
  unit: text('unit').notNull().default('kg'), // kg | ekor | pack | pcs (legacy - kompatibilitas transaksi)
  weightUnit: text('weight_unit').notNull().default('kg'), // kg | gram | ton (Satuan Berat)
  packagingType: text('packaging_type'), // colly | pack | keranjang | kardus (Jenis Kemasan)
  basePrice: real('base_price').notNull().default(0),
  rendemenCoefficient: real('rendemen_coefficient').notNull().default(1),
  minStock: real('min_stock').notNull().default(0),
  shelfLifeDays: integer('shelf_life_days').notNull().default(0),
  description: text('description'),
  imageUrl: text('image_url'),
  status: text('status').notNull().default('active'),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// COLD STORAGE
export const coldStorages = sqliteTable('cold_storages', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  location: text('location'),
  address: text('address'),
  temperatureRange: text('temperature_range'), // e.g. '-18 to -22 C'
  capacityKg: real('capacity_kg').notNull().default(0),
  status: text('status').notNull().default('active'),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
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
  expectedDate: integer('expected_date', { mode: 'timestamp' }),
  pipelineStatus: text('pipeline_status').notNull().default('Draft'), // Draft | Confirmed | Packed | Shipped | Invoiced | Cancelled
  fulfillmentType: text('fulfillment_type').notNull().default('stock'), // stock | dropship
  supplierId: text('supplier_id'),
  autoPoId: text('auto_po_id'),
  invoiceWeightBasis: text('invoice_weight_basis').notNull().default('shipped'), // shipped | received
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  dpAmount: real('dp_amount').notNull().default(0),
  discountTotal: real('discount_total').notNull().default(0),
  totalAmount: real('total_amount').notNull().default(0),
  paidAmount: real('paid_amount').notNull().default(0),
  paymentStatus: text('payment_status').notNull().default('unpaid'), // unpaid | partial | paid
  paymentTerm: text('payment_term'),
  shippingCost: real('shipping_cost').notNull().default(0),
  shippingBearer: text('shipping_bearer').notNull().default('seller'), // seller | buyer
  shippingPayMethod: text('shipping_pay_method').notNull().default('transfer'), // tunai | transfer (sumber kas bayar kurir)
  invoiceNumber: text('invoice_number'),
  invoiceDate: integer('invoice_date', { mode: 'timestamp' }),
  dueDate: integer('due_date', { mode: 'timestamp' }),
  notes: text('notes'),
  // Faktur di-up + Cashback (opsional, hanya sebagian customer). totalAmount = nilai faktur customer (di-up).
  markupEnabled: integer('markup_enabled', { mode: 'boolean' }).notNull().default(false),
  realAmount: real('real_amount').notNull().default(0), // nilai asli/net yang benar-benar dibayar customer
  cashbackAmount: real('cashback_amount').notNull().default(0), // selisih di-up (default totalAmount - realAmount, bisa manual)
  cashbackRecipient: text('cashback_recipient'), // nama PIC penerima (opsional)
  cashbackAccount: text('cashback_account'), // kode akun kas/bank sumber pengembalian cashback
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
  realUnitPrice: real('real_unit_price').notNull().default(0), // (deprecated) tidak dipakai
  markupUnitPrice: real('markup_unit_price').notNull().default(0), // harga di-up (faktur customer). cashback/kg = markupUnitPrice - unitPrice
  discount: real('discount').notNull().default(0),
  shippedWeight: real('shipped_weight').notNull().default(0),
  receivedWeight: real('received_weight').notNull().default(0),
  subtotal: real('subtotal').notNull().default(0),
  stockCodeId: text('stock_code_id'),
  outboundTallyStatus: text('outbound_tally_status').notNull().default('none'), // none | draft (dicatat) | final (disimpan operator)
});

// Alokasi kode simpan (stock) ke item SO — 1 item bisa banyak kode simpan (Fase B)
export const soItemStocks = sqliteTable('so_item_stocks', {
  id: text('id').primaryKey(),
  salesOrderId: text('sales_order_id').notNull(),
  soItemId: text('so_item_id').notNull(),
  stockId: text('stock_id').notNull(),
  productId: text('product_id').notNull(),
  kodeSimpan: text('kode_simpan'),
  weight: real('weight').notNull().default(0),
  quantity: real('quantity').notNull().default(0),
  hppPerKg: real('hpp_per_kg').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// SJ columns added dynamically; extend suratJalan schema for query building


// Surat Jalan (Delivery Order)
export const suratJalan = sqliteTable('surat_jalan', {
  id: text('id').primaryKey(),
  sjNumber: text('sj_number').notNull().unique(),
  salesOrderId: text('sales_order_id').notNull().references(() => salesOrder.id, { onDelete: 'cascade' }),
  deliveryDate: integer('delivery_date', { mode: 'timestamp' }).notNull(),
  driverName: text('driver_name'),
  vehicleNumber: text('vehicle_number'),
  // Tujuan pengiriman (bisa ke pelanggan akhir milik Agen/Dropshipper)
  shipToCustomerId: text('ship_to_customer_id'),
  shipToName: text('ship_to_name'),
  shipToPhone: text('ship_to_phone'),
  shipToAddress: text('ship_to_address'),
  showReceivedColumn: integer('show_received_column', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  status: text('status').notNull().default('draft'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Sales Payments
export const salesPayments = sqliteTable('sales_payments', {
  id: text('id').primaryKey(),
  salesOrderId: text('sales_order_id').notNull().references(() => salesOrder.id, { onDelete: 'cascade' }),
  paymentDate: integer('payment_date', { mode: 'timestamp' }).notNull(),
  amount: real('amount').notNull().default(0),
  method: text('method').notNull().default('Transfer'), // Transfer | Tunai | QRIS
  reference: text('reference'),
  isDp: integer('is_dp', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Sales Returns
export const salesReturns = sqliteTable('sales_returns', {
  id: text('id').primaryKey(),
  returnNumber: text('return_number').notNull().unique(),
  salesOrderId: text('sales_order_id').notNull().references(() => salesOrder.id, { onDelete: 'cascade' }),
  returnDate: integer('return_date', { mode: 'timestamp' }).notNull(),
  reason: text('reason'),
  resolution: text('resolution').notNull().default('potong_invoice'), // potong_invoice | kirim_pengganti
  totalAmount: real('total_amount').notNull().default(0),
  totalWeight: real('total_weight').notNull().default(0),
  status: text('status').notNull().default('open'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Sales Order Receipts (Penerimaan Customer + Penyusutan per SO per Produk)
export const salesOrderReceipts = sqliteTable('sales_order_receipts', {
  id: text('id').primaryKey(),
  receiptNumber: text('receipt_number').notNull().unique(),
  salesOrderId: text('sales_order_id').notNull().references(() => salesOrder.id, { onDelete: 'cascade' }),
  receivedDate: integer('received_date', { mode: 'timestamp' }).notNull(),
  totalOrderedWeight: real('total_ordered_weight').notNull().default(0),
  totalReceivedWeight: real('total_received_weight').notNull().default(0),
  totalShrinkageWeight: real('total_shrinkage_weight').notNull().default(0),
  totalShrinkagePct: real('total_shrinkage_pct').notNull().default(0),
  totalShrinkageValue: real('total_shrinkage_value').notNull().default(0),
  status: text('status').notNull().default('received'), // received | partial | rejected
  applyToInvoice: integer('apply_to_invoice', { mode: 'boolean' }).notNull().default(false),
  receivedBy: text('received_by'),
  notes: text('notes'),
  photoUrl: text('photo_url'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Per-product breakdown of a receipt (penyusutan per produk)
export const salesOrderReceiptItems = sqliteTable('sales_order_receipt_items', {
  id: text('id').primaryKey(),
  receiptId: text('receipt_id').notNull().references(() => salesOrderReceipts.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  orderedWeight: real('ordered_weight').notNull().default(0),
  receivedWeight: real('received_weight').notNull().default(0),
  shrinkageWeight: real('shrinkage_weight').notNull().default(0),
  shrinkagePct: real('shrinkage_pct').notNull().default(0),
  avgUnitPrice: real('avg_unit_price').notNull().default(0),
  shrinkageValue: real('shrinkage_value').notNull().default(0),
  notes: text('notes'),
});

// Approvals / Concerns — tindakan yang butuh konfirmasi supervisor / direktur
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  concernType: text('concern_type').notNull(), // sales_return | purchase_return | so_cancel | po_cancel | high_shrinkage | opname_variance | so_large_discount
  entityType: text('entity_type'),              // SO | PO | WO | SR | PR | RCP | OPNAME
  entityId: text('entity_id'),
  entityNumber: text('entity_number'),          // display number
  requiredRole: text('required_role').notNull(), // supervisor | direktur | both
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority').notNull().default('normal'), // low | normal | high | urgent
  amount: real('amount').default(0),
  metadata: text('metadata'),                    // JSON string
  status: text('status').notNull().default('pending'), // pending | approved | rejected | resolved
  supervisorAction: text('supervisor_action'),
  supervisorNote: text('supervisor_note'),
  supervisorActedAt: integer('supervisor_acted_at', { mode: 'timestamp' }),
  supervisorActedBy: text('supervisor_acted_by'),
  direkturAction: text('direktur_action'),
  direkturNote: text('direktur_note'),
  direkturActedAt: integer('direktur_acted_at', { mode: 'timestamp' }),
  direkturActedBy: text('direktur_acted_by'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Notifications - in-app notifications per user
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('info'), // info | approval | concern
  category: text('category').notNull(),         // so_new | po_new | wo_new | so_return | po_return | high_shrinkage | so_cancel | po_cancel | opname_variance | so_large_discount | so_price_below_hpp | so_shipping
  title: text('title').notNull(),
  message: text('message'),
  entityType: text('entity_type'),               // SO | PO | WO | SR | PR | RCP | OPNAME | APPROVAL
  entityId: text('entity_id'),
  entityNumber: text('entity_number'),
  linkPath: text('link_path'),                   // path to navigate on click
  refApprovalId: text('ref_approval_id'),        // if triggered by an approval, reference id
  priority: text('priority').notNull().default('normal'), // low | normal | high | urgent
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  readAt: integer('read_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});


export const purchaseOrder = sqliteTable('purchase_order', {
  id: text('id').primaryKey(),
  supplierId: text('supplier_id').notNull().references(() => contacts.id),
  poNumber: text('po_number').notNull().unique(),
  poType: text('po_type').notNull().default('Live Bird'), // Live Bird | Packaging | Bahan Baku | Produk Jadi | Operasional
  method: text('method'), // Timbang Ulang | Timbang Kandang (locked after first save when poType='Live Bird')
  orderDate: integer('order_date', { mode: 'timestamp' }).notNull(),
  expectedDate: integer('expected_date', { mode: 'timestamp' }),
  pipelineStatus: text('pipeline_status').notNull().default('Draft'),
  isDropship: integer('is_dropship', { mode: 'boolean' }).notNull().default(false),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  dropshipCustomerId: text('dropship_customer_id').references(() => contacts.id),
  salesOrderId: text('sales_order_id'), // link balik ke SO Dropship yang meng-generate PO ini
  additionalCost: real('additional_cost').notNull().default(0), // total ongkir dll
  totalAmount: real('total_amount').notNull().default(0),
  dpAmount: real('dp_amount').notNull().default(0),
  paidAmount: real('paid_amount').notNull().default(0),
  paymentStatus: text('payment_status').notNull().default('unpaid'), // unpaid | partial | paid
  paymentTerm: text('payment_term'), // Cash | TOP 7 | TOP 14 | TOP 30 dll
  invoiceNumber: text('invoice_number'),
  invoiceDate: integer('invoice_date', { mode: 'timestamp' }),
  dueDate: integer('due_date', { mode: 'timestamp' }),
  invoiceWeightBasis: text('invoice_weight_basis').notNull().default('shipped'), // shipped (Surat Jalan) | tally (Rekonsiliasi Tally) | grn | so_receipt (dropship)
  tallyCompletedAt: integer('tally_completed_at', { mode: 'timestamp' }), // ditandai saat tally selesai -> hilang dari referensi tally
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
  weight: real('weight').notNull().default(0), // PO planned weight
  weightSupplier: real('weight_supplier').notNull().default(0), // point 1 (kandang)
  weightRph: real('weight_rph').notNull().default(0), // point 2 (RPH)
  headSupplier: integer('head_supplier').notNull().default(0),
  headRph: integer('head_rph').notNull().default(0),
  unitPrice: real('unit_price').notNull().default(0),
  additionalCostShare: real('additional_cost_share').notNull().default(0), // proportional
  hppPerKg: real('hpp_per_kg').notNull().default(0),
  receivedWeight: real('received_weight').notNull().default(0), // confirmed weight from GRN / supplier surat jalan
  tallyWeight: real('tally_weight').notNull().default(0), // accumulated actual re-weigh weight from Tally Inbound
});

// Goods Received Notes (Tanda Terima)
export const grn = sqliteTable('grn', {
  id: text('id').primaryKey(),
  grnNumber: text('grn_number').notNull().unique(),
  purchaseOrderId: text('purchase_order_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  receivedDate: integer('received_date', { mode: 'timestamp' }).notNull(),
  receivedBy: text('received_by'),
  sjNumber: text('sj_number'), // supplier's Surat Jalan number
  driverName: text('driver_name'),
  vehicleNumber: text('vehicle_number'),
  totalReceivedWeight: real('total_received_weight').notNull().default(0),
  notes: text('notes'),
  status: text('status').notNull().default('draft'), // draft | confirmed
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// GRN line items — received weight per product (from supplier Surat Jalan)
export const grnItems = sqliteTable('grn_items', {
  id: text('id').primaryKey(),
  grnId: text('grn_id').notNull().references(() => grn.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  planWeight: real('plan_weight').notNull().default(0), // PO planned weight snapshot
  receivedWeight: real('received_weight').notNull().default(0),
  receivedQuantity: real('received_quantity').notNull().default(0),
});

// GRN attached documents (Surat Jalan scans/photos) stored on persistent disk
export const grnDocuments = sqliteTable('grn_documents', {
  id: text('id').primaryKey(),
  grnId: text('grn_id').notNull().references(() => grn.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(), // relative path under uploads dir
  originalName: text('original_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Purchase Payments
export const purchasePayments = sqliteTable('purchase_payments', {
  id: text('id').primaryKey(),
  purchaseOrderId: text('purchase_order_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  paymentDate: integer('payment_date', { mode: 'timestamp' }).notNull(),
  amount: real('amount').notNull().default(0),
  method: text('method').notNull().default('Transfer'), // Transfer | Tunai | QRIS
  reference: text('reference'),
  isDp: integer('is_dp', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Purchase Returns
export const purchaseReturns = sqliteTable('purchase_returns', {
  id: text('id').primaryKey(),
  returnNumber: text('return_number').notNull().unique(),
  purchaseOrderId: text('purchase_order_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  returnDate: integer('return_date', { mode: 'timestamp' }).notNull(),
  reason: text('reason'),
  resolution: text('resolution').notNull().default('potong_invoice'), // potong_invoice | kirim_pengganti
  totalAmount: real('total_amount').notNull().default(0),
  totalWeight: real('total_weight').notNull().default(0),
  status: text('status').notNull().default('open'), // open | resolved
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const workOrder = sqliteTable('work_order', {
  id: text('id').primaryKey(),
  purchaseOrderId: text('purchase_order_id').references(() => purchaseOrder.id),
  woNumber: text('wo_number').notNull().unique(),
  mode: text('mode').notNull().default('Internal'), // Internal | Maklon
  maklonSupplierId: text('maklon_supplier_id').references(() => contacts.id),
  maklonRatePerKg: real('maklon_rate_per_kg').notNull().default(0),
  startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  // Arrival data
  totalLiveBirdWeight: real('total_live_bird_weight').notNull().default(0),
  totalLiveBirdHeadCount: integer('total_live_bird_head_count').notNull().default(0),
  bwAvg: real('bw_avg').notNull().default(0),
  ekorMati: integer('ekor_mati').notNull().default(0),
  arrivalRecordedAt: integer('arrival_recorded_at', { mode: 'timestamp' }),
  // Costs & Yield
  baseCost: real('base_cost').notNull().default(0), // from PO or manual
  maklonCost: real('maklon_cost').notNull().default(0), // auto = rate * total_weight
  customCostTotal: real('custom_cost_total').notNull().default(0),
  totalCost: real('total_cost').notNull().default(0),
  totalRendemenWeight: real('total_rendemen_weight').notNull().default(0),
  finalizedAt: integer('finalized_at', { mode: 'timestamp' }),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  pipelineStatus: text('pipeline_status').notNull().default('Draft'), // Draft | Disetujui | Dalam Proses | Selesai | Dibatalkan
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const workOrderDetails = sqliteTable('work_order_details', {
  id: text('id').primaryKey(),
  workOrderId: text('work_order_id').notNull().references(() => workOrder.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // kedatangan | lairage | pemotongan | eviscerasi | karkas | boneless_parting | packing_plastik | abf | panen_abf | packing_karung | inventory
  stageName: text('stage_name').notNull(),
  inputWeight: real('input_weight').notNull().default(0),
  outputWeight: real('output_weight').notNull().default(0),
  headCount: integer('head_count').notNull().default(0),
  bwAvg: real('bw_avg').notNull().default(0),
  rendemenData: text('rendemen_data'), // JSON with stage-specific fields
  recordedBy: text('recorded_by'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// WO Custom Costs (biaya tambahan bebas)
export const woCustomCosts = sqliteTable('wo_custom_costs', {
  id: text('id').primaryKey(),
  workOrderId: text('work_order_id').notNull().references(() => workOrder.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  amount: real('amount').notNull().default(0),
  category: text('category'), // maklon | operasional | lain-lain
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// WO Outputs (final products with coefficient & HPP)
export const woOutputs = sqliteTable('wo_outputs', {
  id: text('id').primaryKey(),
  workOrderId: text('work_order_id').notNull().references(() => workOrder.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  stage: text('stage').notNull(), // karkas | boneless | parting | by-product
  weight: real('weight').notNull().default(0),
  headCount: integer('head_count').notNull().default(0),
  coefficient: real('coefficient').notNull().default(1),
  hppPerKg: real('hpp_per_kg').notNull().default(0),
  hppTotal: real('hpp_total').notNull().default(0),
  isPremium: integer('is_premium', { mode: 'boolean' }).notNull().default(false),
  sizeGradingCode: text('size_grading_code'),
  notes: text('notes'),
  // Storage tracking (anti-dedup WO → Cold Storage)
  storageStatus: text('storage_status').notNull().default('pending_storage'), // pending_storage | partial | stored
  storedWeight: real('stored_weight').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// WO Stages Master (fully custom stage definitions per admin)
export const woStages = sqliteTable('wo_stages', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),          // e.g., CHILL, EVISC
  name: text('name').notNull(),                    // e.g., Chilling
  description: text('description'),
  sequenceOrder: integer('sequence_order').notNull().default(0),
  fieldsSchema: text('fields_schema').notNull().default('[]'), // JSON array of field defs
  color: text('color'),                            // hex/tailwind color for badge
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// WO Stage Records (tally records per stage per WO)
export const woStageRecords = sqliteTable('wo_stage_records', {
  id: text('id').primaryKey(),
  workOrderId: text('work_order_id').notNull().references(() => workOrder.id, { onDelete: 'cascade' }),
  stageId: text('stage_id').notNull().references(() => woStages.id, { onDelete: 'restrict' }),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
  recordedBy: text('recorded_by'),                 // user email/id
  fieldValues: text('field_values').notNull().default('{}'),  // JSON with field values keyed by fieldsSchema.key
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const inventoryTransaction = sqliteTable('inventory_transaction', {
  id: text('id').primaryKey(),
  txNumber: text('tx_number'), // TX/YYMM/NNNN
  baNumber: text('ba_number'), // Berita Acara number if applicable
  baType: text('ba_type'), // transfer_cs | non_sales | opname_adj | damage
  transactionDate: integer('transaction_date', { mode: 'timestamp' }).notNull(),
  transactionType: text('transaction_type').notNull(), // IN | OUT | TRANSFER_CS | TRANSFER_ZONE | OPNAME_ADJ | DAMAGE | NON_SALES
  referenceId: text('reference_id'),
  referenceType: text('reference_type'), // WO | PO | SO | OPNAME | MANUAL
  fromColdStorageId: text('from_cold_storage_id').references(() => coldStorages.id),
  toColdStorageId: text('to_cold_storage_id').references(() => coldStorages.id),
  fromZoneId: text('from_zone_id').references(() => zones.id),
  toZoneId: text('to_zone_id').references(() => zones.id),
  totalWeight: real('total_weight').notNull().default(0),
  totalQuantity: real('total_quantity').notNull().default(0),
  reason: text('reason'),
  status: text('status').notNull().default('confirmed'), // pending | confirmed | rejected
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const inventoryStock = sqliteTable('inventory_stock', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull().references(() => products.id),
  coldStorageId: text('cold_storage_id').notNull().references(() => coldStorages.id),
  zoneId: text('zone_id').references(() => zones.id),
  kodeSimpan: text('kode_simpan').notNull().unique(),
  packagingType: text('packaging_type').notNull().default('karung'), // karung | pack | box | curah
  parentStockId: text('parent_stock_id'), // for pack split from karung
  quantity: real('quantity').notNull().default(0),
  weight: real('weight').notNull().default(0),
  expiredDate: integer('expired_date', { mode: 'timestamp' }),
  status: text('status').notNull().default('active'), // active | used | damaged | opened
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  sourceBatch: text('source_batch'),
  sourceType: text('source_type'), // WO | PO
  hppPerKg: real('hpp_per_kg').notNull().default(0),
  transactionId: text('transaction_id').references(() => inventoryTransaction.id),
  openedAt: integer('opened_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Stock Opname
export const stockOpname = sqliteTable('stock_opname', {
  id: text('id').primaryKey(),
  opnameNumber: text('opname_number').notNull().unique(),
  opnameDate: integer('opname_date', { mode: 'timestamp' }).notNull(),
  coldStorageId: text('cold_storage_id').notNull().references(() => coldStorages.id),
  status: text('status').notNull().default('draft'), // draft | submitted | approved | rejected
  totalDeltaWeight: real('total_delta_weight').notNull().default(0),
  totalDeltaQty: real('total_delta_qty').notNull().default(0),
  notes: text('notes'),
  createdBy: text('created_by'),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const stockOpnameItems = sqliteTable('stock_opname_items', {
  id: text('id').primaryKey(),
  opnameId: text('opname_id').notNull().references(() => stockOpname.id, { onDelete: 'cascade' }),
  stockId: text('stock_id').notNull().references(() => inventoryStock.id),
  systemQty: real('system_qty').notNull().default(0),
  systemWeight: real('system_weight').notNull().default(0),
  physicalQty: real('physical_qty').notNull().default(0),
  physicalWeight: real('physical_weight').notNull().default(0),
  deltaQty: real('delta_qty').notNull().default(0),
  deltaWeight: real('delta_weight').notNull().default(0),
  notes: text('notes'),
});

// Stock Ledger (Kartu Stok) - per-product movement log for auditable stock card.
// Populated at every stock mutation point (IN/OUT/TRANSFER/ADJ/DAMAGE/RETURN).
export const stockLedger = sqliteTable('stock_ledger', {
  id: text('id').primaryKey(),
  ledgerDate: integer('ledger_date', { mode: 'timestamp' }).notNull(),
  productId: text('product_id').notNull().references(() => products.id),
  coldStorageId: text('cold_storage_id').references(() => coldStorages.id),
  zoneId: text('zone_id').references(() => zones.id),
  movementType: text('movement_type').notNull(), // IN | OUT | TRANSFER_IN | TRANSFER_OUT | ADJ | DAMAGE | RETURN_IN
  referenceType: text('reference_type'), // PO | WO | SO | SR | TRANSFER_CS | OPNAME | NON_SALES | DAMAGE | MANUAL | OPENING
  referenceId: text('reference_id'),
  referenceNumber: text('reference_number'),
  qtyIn: real('qty_in').notNull().default(0),
  weightIn: real('weight_in').notNull().default(0),
  qtyOut: real('qty_out').notNull().default(0),
  weightOut: real('weight_out').notNull().default(0),
  hppPerKg: real('hpp_per_kg').notNull().default(0),
  kodeSimpan: text('kode_simpan'),
  transactionId: text('transaction_id'),
  stockId: text('stock_id'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});


// =========================
// AGEN / DROPSHIPPER EXTENSIONS
// =========================

// Pelanggan akhir milik Agen / Dropshipper (untuk komunikasi & tujuan pengiriman)
export const contactCustomers = sqliteTable('contact_customers', {
  id: text('id').primaryKey(),
  parentContactId: text('parent_contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  // Jika di-tautkan ke kontak Customer yang sudah ada (bukan salinan). Sumber data hidup dari kontak tsb.
  linkedContactId: text('linked_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  mapsUrl: text('maps_url'),
  picName: text('pic_name'),
  notes: text('notes'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Dokumen legal kontak (opsional): NPWP, Akta Perusahaan, SK Perusahaan, KTP, Lainnya
export const contactDocuments = sqliteTable('contact_documents', {
  id: text('id').primaryKey(),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  docType: text('doc_type').notNull(), // NPWP | Akta Perusahaan | SK Perusahaan | KTP | Lainnya
  fileName: text('file_name').notNull(),
  storedName: text('stored_name').notNull(),
  mimeType: text('mime_type'),
  size: integer('size').notNull().default(0),
  uploadedBy: text('uploaded_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});


// Catatan komisi Dropshipper (melekat ke kontak Dropshipper, menunjuk ke SO sebagai referensi)
export const commissionRecords = sqliteTable('commission_records', {
  id: text('id').primaryKey(),
  dropshipperId: text('dropshipper_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  salesOrderId: text('sales_order_id').references(() => salesOrder.id, { onDelete: 'set null' }),
  soNumber: text('so_number'),
  commissionType: text('commission_type').notNull(), // per_kg | fixed | percent_profit
  commissionValue: real('commission_value').notNull().default(0),
  basisAmount: real('basis_amount').notNull().default(0),   // berat (per_kg) / profit (percent_profit) / 0 (fixed)
  revenueAmount: real('revenue_amount').notNull().default(0),
  costAmount: real('cost_amount').notNull().default(0),
  commissionAmount: real('commission_amount').notNull().default(0),
  status: text('status').notNull().default('unpaid'), // unpaid | paid
  paymentId: text('payment_id'),
  paidAt: integer('paid_at', { mode: 'timestamp' }),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Pembayaran komisi ke Dropshipper
export const commissionPayments = sqliteTable('commission_payments', {
  id: text('id').primaryKey(),
  dropshipperId: text('dropshipper_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  paymentDate: integer('payment_date', { mode: 'timestamp' }).notNull(),
  amount: real('amount').notNull().default(0),
  method: text('method').notNull().default('Transfer'), // Transfer | Tunai | QRIS
  reference: text('reference'),
  notes: text('notes'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// =========================
// TALLY SESSIONS (draft inbound yang bisa disimpan & dilanjutkan; final = commit ke inventory)
// =========================
export const tallySession = sqliteTable('tally_session', {
  id: text('id').primaryKey(),
  coldStorageId: text('cold_storage_id'),
  zoneId: text('zone_id'),
  referenceType: text('reference_type').notNull().default('MANUAL'), // MANUAL | PO | WO
  referenceId: text('reference_id'),
  notes: text('notes'),
  status: text('status').notNull().default('draft'), // draft | final
  kodeBase: text('kode_base'),
  kodeBaseAt: integer('kode_base_at').notNull().default(0),
  markTallyComplete: integer('mark_tally_complete', { mode: 'boolean' }).notNull().default(false),
  transactionId: text('transaction_id'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  finalizedAt: integer('finalized_at', { mode: 'timestamp' }),
});

export const tallySessionItems = sqliteTable('tally_session_items', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => tallySession.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  weight: real('weight').notNull().default(0),
  quantity: real('quantity').notNull().default(0),
  packagingType: text('packaging_type').notNull().default('colly'),
  expiredDate: integer('expired_date', { mode: 'timestamp' }),
  kodeSimpan: text('kode_simpan'),
  zoneId: text('zone_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// =========================
// APP SETTINGS (key-value JSON: company, concern, approval, notifications)
// =========================
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'), // JSON string
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
