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
  category: text('category'), // raw | WIP | FG | merch
  subCategory: text('sub_category'), // Live Bird | Karkas | Boneless | Parting | Retail | Others
  unit: text('unit').notNull().default('kg'), // kg | ekor | pack | pcs
  basePrice: real('base_price').notNull().default(0),
  rendemenCoefficient: real('rendemen_coefficient').notNull().default(1),
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
  address: text('address'),
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
  expectedDate: integer('expected_date', { mode: 'timestamp' }),
  pipelineStatus: text('pipeline_status').notNull().default('Draft'), // Draft | Confirmed | Packed | Shipped | Invoiced | Cancelled
  dpAmount: real('dp_amount').notNull().default(0),
  discountTotal: real('discount_total').notNull().default(0),
  totalAmount: real('total_amount').notNull().default(0),
  paidAmount: real('paid_amount').notNull().default(0),
  paymentStatus: text('payment_status').notNull().default('unpaid'), // unpaid | partial | paid
  paymentTerm: text('payment_term'),
  invoiceNumber: text('invoice_number'),
  invoiceDate: integer('invoice_date', { mode: 'timestamp' }),
  dueDate: integer('due_date', { mode: 'timestamp' }),
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
  discount: real('discount').notNull().default(0),
  subtotal: real('subtotal').notNull().default(0),
  stockCodeId: text('stock_code_id'),
});

// Surat Jalan (Delivery Order)
export const suratJalan = sqliteTable('surat_jalan', {
  id: text('id').primaryKey(),
  sjNumber: text('sj_number').notNull().unique(),
  salesOrderId: text('sales_order_id').notNull().references(() => salesOrder.id, { onDelete: 'cascade' }),
  deliveryDate: integer('delivery_date', { mode: 'timestamp' }).notNull(),
  driverName: text('driver_name'),
  vehicleNumber: text('vehicle_number'),
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
  dropshipCustomerId: text('dropship_customer_id').references(() => contacts.id),
  additionalCost: real('additional_cost').notNull().default(0), // total ongkir dll
  totalAmount: real('total_amount').notNull().default(0),
  dpAmount: real('dp_amount').notNull().default(0),
  paidAmount: real('paid_amount').notNull().default(0),
  paymentStatus: text('payment_status').notNull().default('unpaid'), // unpaid | partial | paid
  paymentTerm: text('payment_term'), // Cash | TOP 7 | TOP 14 | TOP 30 dll
  invoiceNumber: text('invoice_number'),
  invoiceDate: integer('invoice_date', { mode: 'timestamp' }),
  dueDate: integer('due_date', { mode: 'timestamp' }),
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
});

// Goods Received Notes (Tanda Terima)
export const grn = sqliteTable('grn', {
  id: text('id').primaryKey(),
  grnNumber: text('grn_number').notNull().unique(),
  purchaseOrderId: text('purchase_order_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  receivedDate: integer('received_date', { mode: 'timestamp' }).notNull(),
  receivedBy: text('received_by'),
  notes: text('notes'),
  status: text('status').notNull().default('draft'), // draft | confirmed
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
  sourceBatch: text('source_batch'),
  sourceType: text('source_type'), // WO | PO
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
