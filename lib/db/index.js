import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import { seedAccounting } from '@/lib/accounting/engine';
import fs from 'fs';
import path from 'path';

const DB_PATH = '/app/data/erp.db';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let _sqlite;
let _db;

function getSqlite() {
  if (!_sqlite) {
    _sqlite = new Database(DB_PATH);
    _sqlite.pragma('journal_mode = WAL');
    _sqlite.pragma('foreign_keys = ON');
    initSchema(_sqlite);
  }
  return _sqlite;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getSqlite(), { schema });
  }
  return _db;
}

// Raw better-sqlite3 handle (used by the accounting engine for aggregation queries)
export function getRawSqlite() {
  return getSqlite();
}

// Direct schema init using raw SQL (avoids needing drizzle-kit at runtime)
function initSchema(sqlite) {
  const stmts = [
    // AUTH
    `CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      role TEXT NOT NULL DEFAULT 'operator',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      password TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    )`,
    // CONTACTS
    `CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      contact_type TEXT NOT NULL,
      categories TEXT,
      code TEXT NOT NULL UNIQUE,
      company_name TEXT,
      display_name TEXT NOT NULL,
      is_subscriber INTEGER NOT NULL DEFAULT 0,
      credit_limit REAL NOT NULL DEFAULT 0,
      prepaid_balance REAL NOT NULL DEFAULT 0,
      tax_status TEXT,
      npwp TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      postal_code TEXT,
      maps_url TEXT,
      phone TEXT,
      email TEXT,
      pic_name TEXT,
      pic_phone TEXT,
      bank_name TEXT,
      bank_account TEXT,
      bank_holder TEXT,
      legal_docs TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // PRODUCTS
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL DEFAULT 'kg',
      base_price REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      shelf_life_days INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // COLD STORAGE
    `CREATE TABLE IF NOT EXISTS cold_storages (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      location TEXT,
      temperature_range TEXT,
      capacity_kg REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // ZONES
    `CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      cold_storage_id TEXT NOT NULL REFERENCES cold_storages(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // SALES ORDER
    `CREATE TABLE IF NOT EXISTS sales_order (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES contacts(id),
      so_number TEXT NOT NULL UNIQUE,
      order_date INTEGER NOT NULL,
      pipeline_status TEXT NOT NULL DEFAULT 'Draft',
      dp_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      payment_term TEXT,
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS sales_order_items (
      id TEXT PRIMARY KEY,
      sales_order_id TEXT NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      stock_code_id TEXT
    )`,
    // PURCHASE ORDER
    `CREATE TABLE IF NOT EXISTS purchase_order (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL REFERENCES contacts(id),
      po_number TEXT NOT NULL UNIQUE,
      method TEXT,
      order_date INTEGER NOT NULL,
      pipeline_status TEXT NOT NULL DEFAULT 'Draft',
      is_dropship INTEGER NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      additional_cost REAL NOT NULL DEFAULT 0
    )`,
    // WORK ORDER
    `CREATE TABLE IF NOT EXISTS work_order (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT REFERENCES purchase_order(id),
      wo_number TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'Internal',
      start_date INTEGER NOT NULL,
      pipeline_status TEXT NOT NULL DEFAULT 'Draft',
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS work_order_details (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      stage_name TEXT NOT NULL,
      input_weight REAL NOT NULL DEFAULT 0,
      output_weight REAL NOT NULL DEFAULT 0,
      head_count INTEGER NOT NULL DEFAULT 0,
      bw_avg REAL NOT NULL DEFAULT 0,
      rendemen_data TEXT,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // INVENTORY
    `CREATE TABLE IF NOT EXISTS inventory_transaction (
      id TEXT PRIMARY KEY,
      transaction_date INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      reference_id TEXT,
      reference_type TEXT,
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS inventory_stock (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      cold_storage_id TEXT NOT NULL REFERENCES cold_storages(id),
      zone_id TEXT REFERENCES zones(id),
      kode_simpan TEXT NOT NULL UNIQUE,
      quantity REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      expired_date INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      source_batch TEXT,
      source_type TEXT,
      transaction_id TEXT REFERENCES inventory_transaction(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // GRN (Goods Received Notes)
    `CREATE TABLE IF NOT EXISTS grn (
      id TEXT PRIMARY KEY,
      grn_number TEXT NOT NULL UNIQUE,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
      received_date INTEGER NOT NULL,
      received_by TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Purchase Payments
    `CREATE TABLE IF NOT EXISTS purchase_payments (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
      payment_date INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'Transfer',
      reference TEXT,
      is_dp INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Purchase Returns
    `CREATE TABLE IF NOT EXISTS purchase_returns (
      id TEXT PRIMARY KEY,
      return_number TEXT NOT NULL UNIQUE,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
      return_date INTEGER NOT NULL,
      reason TEXT,
      resolution TEXT NOT NULL DEFAULT 'potong_invoice',
      total_amount REAL NOT NULL DEFAULT 0,
      total_weight REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Surat Jalan (Delivery Order)
    `CREATE TABLE IF NOT EXISTS surat_jalan (
      id TEXT PRIMARY KEY,
      sj_number TEXT NOT NULL UNIQUE,
      sales_order_id TEXT NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
      delivery_date INTEGER NOT NULL,
      driver_name TEXT,
      vehicle_number TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Sales Payments
    `CREATE TABLE IF NOT EXISTS sales_payments (
      id TEXT PRIMARY KEY,
      sales_order_id TEXT NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
      payment_date INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'Transfer',
      reference TEXT,
      is_dp INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Sales Returns
    `CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      return_number TEXT NOT NULL UNIQUE,
      sales_order_id TEXT NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
      return_date INTEGER NOT NULL,
      reason TEXT,
      resolution TEXT NOT NULL DEFAULT 'potong_invoice',
      total_amount REAL NOT NULL DEFAULT 0,
      total_weight REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Sales Order Receipts (Penerimaan Customer + Penyusutan per SO per Produk) - HEADER
    `DROP TABLE IF EXISTS sales_order_receipts_v1`,
    `CREATE TABLE IF NOT EXISTS sales_order_receipts (
      id TEXT PRIMARY KEY,
      receipt_number TEXT NOT NULL UNIQUE,
      sales_order_id TEXT NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
      received_date INTEGER NOT NULL,
      total_ordered_weight REAL NOT NULL DEFAULT 0,
      total_received_weight REAL NOT NULL DEFAULT 0,
      total_shrinkage_weight REAL NOT NULL DEFAULT 0,
      total_shrinkage_pct REAL NOT NULL DEFAULT 0,
      total_shrinkage_value REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'received',
      apply_to_invoice INTEGER NOT NULL DEFAULT 0,
      received_by TEXT,
      notes TEXT,
      photo_url TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // If old schema exists (per-SO), migrate columns via ALTER (best-effort, safe if columns exist)
    // We simply create new columns if missing.
    // Per-Product breakdown line items
    `CREATE TABLE IF NOT EXISTS sales_order_receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL REFERENCES sales_order_receipts(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      ordered_weight REAL NOT NULL DEFAULT 0,
      received_weight REAL NOT NULL DEFAULT 0,
      shrinkage_weight REAL NOT NULL DEFAULT 0,
      shrinkage_pct REAL NOT NULL DEFAULT 0,
      avg_unit_price REAL NOT NULL DEFAULT 0,
      shrinkage_value REAL NOT NULL DEFAULT 0,
      notes TEXT
    )`,
    // Approvals / Concerns
    `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      concern_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      entity_number TEXT,
      required_role TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      amount REAL DEFAULT 0,
      metadata TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      supervisor_action TEXT,
      supervisor_note TEXT,
      supervisor_acted_at INTEGER,
      supervisor_acted_by TEXT,
      direktur_action TEXT,
      direktur_note TEXT,
      direktur_acted_at INTEGER,
      direktur_acted_by TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // WO Custom Costs
    `CREATE TABLE IF NOT EXISTS wo_custom_costs (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT,
      notes TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // WO Outputs
    `CREATE TABLE IF NOT EXISTS wo_outputs (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      stage TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      head_count INTEGER NOT NULL DEFAULT 0,
      coefficient REAL NOT NULL DEFAULT 1,
      hpp_per_kg REAL NOT NULL DEFAULT 0,
      hpp_total REAL NOT NULL DEFAULT 0,
      is_premium INTEGER NOT NULL DEFAULT 0,
      size_grading_code TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Stock Opname
    `CREATE TABLE IF NOT EXISTS stock_opname (
      id TEXT PRIMARY KEY,
      opname_number TEXT NOT NULL UNIQUE,
      opname_date INTEGER NOT NULL,
      cold_storage_id TEXT NOT NULL REFERENCES cold_storages(id),
      status TEXT NOT NULL DEFAULT 'draft',
      total_delta_weight REAL NOT NULL DEFAULT 0,
      total_delta_qty REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by TEXT,
      submitted_at INTEGER,
      approved_by TEXT,
      approved_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    // Notifications
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      entity_type TEXT,
      entity_id TEXT,
      entity_number TEXT,
      link_path TEXT,
      ref_approval_id TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notif_user_read ON notifications (user_id, is_read, created_at)`,
    `CREATE TABLE IF NOT EXISTS stock_opname_items (
      id TEXT PRIMARY KEY,
      opname_id TEXT NOT NULL REFERENCES stock_opname(id) ON DELETE CASCADE,
      stock_id TEXT NOT NULL REFERENCES inventory_stock(id),
      system_qty REAL NOT NULL DEFAULT 0,
      system_weight REAL NOT NULL DEFAULT 0,
      physical_qty REAL NOT NULL DEFAULT 0,
      physical_weight REAL NOT NULL DEFAULT 0,
      delta_qty REAL NOT NULL DEFAULT 0,
      delta_weight REAL NOT NULL DEFAULT 0,
      notes TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS tally_session (
      id TEXT PRIMARY KEY,
      cold_storage_id TEXT,
      zone_id TEXT,
      reference_type TEXT NOT NULL DEFAULT 'MANUAL',
      reference_id TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      kode_base TEXT,
      kode_base_at INTEGER NOT NULL DEFAULT 0,
      mark_tally_complete INTEGER NOT NULL DEFAULT 0,
      transaction_id TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      finalized_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS tally_session_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES tally_session(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 0,
      packaging_type TEXT NOT NULL DEFAULT 'colly',
      expired_date INTEGER,
      kode_simpan TEXT,
      zone_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
  ];
  for (const s of stmts) sqlite.exec(s);

  // ALTER TABLE - add columns for existing tables (idempotent)
  const addColIfMissing = (table, column, definition) => {
    const info = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.find(c => c.name === column)) {
      try { sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
      catch (e) { console.error('ALTER failed:', table, column, e.message); }
    }
  };
  // products: subCategory, rendemenCoefficient
  addColIfMissing('products', 'sub_category', 'TEXT');
  addColIfMissing('products', 'rendemen_coefficient', 'REAL NOT NULL DEFAULT 1');
  addColIfMissing('products', 'weight_unit', "TEXT NOT NULL DEFAULT 'kg'");
  addColIfMissing('products', 'packaging_type', 'TEXT');
  // cold_storages: address
  addColIfMissing('cold_storages', 'address', 'TEXT');
  // purchase_order: new columns
  addColIfMissing('purchase_order', 'po_type', "TEXT NOT NULL DEFAULT 'Live Bird'");
  addColIfMissing('purchase_order', 'expected_date', 'INTEGER');
  addColIfMissing('purchase_order', 'dropship_customer_id', 'TEXT');
  addColIfMissing('purchase_order', 'additional_cost', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order', 'dp_amount', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order', 'paid_amount', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order', 'payment_status', "TEXT NOT NULL DEFAULT 'unpaid'");
  addColIfMissing('purchase_order', 'payment_term', 'TEXT');
  addColIfMissing('purchase_order', 'invoice_number', 'TEXT');
  addColIfMissing('purchase_order', 'invoice_date', 'INTEGER');
  addColIfMissing('purchase_order', 'due_date', 'INTEGER');
  addColIfMissing('purchase_order', 'invoice_weight_basis', "TEXT NOT NULL DEFAULT 'shipped'");
  addColIfMissing('purchase_order', 'tally_completed_at', 'INTEGER');
  addColIfMissing('purchase_order', 'sales_order_id', 'TEXT');
  // Backfill link balik PO Dropship -> SO (dari auto_po_id pada SO)
  try {
    sqlite.exec(`UPDATE purchase_order SET sales_order_id = (SELECT so.id FROM sales_order so WHERE so.auto_po_id = purchase_order.id) WHERE sales_order_id IS NULL AND EXISTS (SELECT 1 FROM sales_order so2 WHERE so2.auto_po_id = purchase_order.id)`);
  } catch (e) { /* ignore backfill errors */ }
  // purchase_order_items: new columns
  addColIfMissing('purchase_order_items', 'weight_supplier', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order_items', 'weight_rph', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order_items', 'head_supplier', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order_items', 'head_rph', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order_items', 'additional_cost_share', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order_items', 'hpp_per_kg', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order_items', 'received_weight', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('purchase_order_items', 'tally_weight', 'REAL NOT NULL DEFAULT 0');
  // grn: supplier surat jalan fields
  addColIfMissing('grn', 'sj_number', 'TEXT');
  addColIfMissing('grn', 'driver_name', 'TEXT');
  addColIfMissing('grn', 'vehicle_number', 'TEXT');
  addColIfMissing('grn', 'total_received_weight', 'REAL NOT NULL DEFAULT 0');
  // sales_order: shipping cost + bearer (Fase C)
  addColIfMissing('sales_order', 'shipping_cost', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sales_order', 'shipping_bearer', "TEXT NOT NULL DEFAULT 'seller'");
  // sales_order_item -> stock allocation (multi kode simpan per item) (Fase B)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS so_item_stocks (
    id TEXT PRIMARY KEY,
    sales_order_id TEXT NOT NULL,
    so_item_id TEXT NOT NULL,
    stock_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    kode_simpan TEXT,
    weight REAL NOT NULL DEFAULT 0,
    quantity REAL NOT NULL DEFAULT 0,
    hpp_per_kg REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  // grn line items + documents (Surat Jalan)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS grn_items (
    id TEXT PRIMARY KEY,
    grn_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    plan_weight REAL NOT NULL DEFAULT 0,
    received_weight REAL NOT NULL DEFAULT 0,
    received_quantity REAL NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS grn_documents (
    id TEXT PRIMARY KEY,
    grn_id TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON grn_items (grn_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_grn_documents_grn ON grn_documents (grn_id)`);
  // sales_order: new columns
  addColIfMissing('sales_order', 'expected_date', 'INTEGER');
  addColIfMissing('sales_order', 'discount_total', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sales_order', 'paid_amount', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sales_order', 'payment_status', "TEXT NOT NULL DEFAULT 'unpaid'");
  addColIfMissing('sales_order', 'invoice_number', 'TEXT');
  addColIfMissing('sales_order', 'invoice_date', 'INTEGER');
  addColIfMissing('sales_order', 'due_date', 'INTEGER');
  // sales_order_items: discount
  addColIfMissing('sales_order_items', 'discount', 'REAL NOT NULL DEFAULT 0');
  // work_order: extend
  addColIfMissing('work_order', 'maklon_supplier_id', 'TEXT');
  addColIfMissing('work_order', 'maklon_rate_per_kg', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'approved_by', 'TEXT');
  addColIfMissing('work_order', 'approved_at', 'INTEGER');
  addColIfMissing('work_order', 'total_live_bird_weight', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'total_live_bird_head_count', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'bw_avg', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'ekor_mati', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'arrival_recorded_at', 'INTEGER');
  addColIfMissing('work_order', 'base_cost', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'maklon_cost', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'custom_cost_total', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'total_cost', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'total_rendemen_weight', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('work_order', 'finalized_at', 'INTEGER');
  // work_order_details: recorded_by
  addColIfMissing('work_order_details', 'recorded_by', 'TEXT');
  // inventory_transaction: BA fields
  addColIfMissing('inventory_transaction', 'tx_number', 'TEXT');
  addColIfMissing('inventory_transaction', 'ba_number', 'TEXT');
  addColIfMissing('inventory_transaction', 'ba_type', 'TEXT');
  addColIfMissing('inventory_transaction', 'from_cold_storage_id', 'TEXT');
  addColIfMissing('inventory_transaction', 'to_cold_storage_id', 'TEXT');
  addColIfMissing('inventory_transaction', 'from_zone_id', 'TEXT');
  addColIfMissing('inventory_transaction', 'to_zone_id', 'TEXT');
  addColIfMissing('inventory_transaction', 'total_weight', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('inventory_transaction', 'total_quantity', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('inventory_transaction', 'reason', 'TEXT');
  addColIfMissing('inventory_transaction', 'status', "TEXT NOT NULL DEFAULT 'confirmed'");
  addColIfMissing('inventory_transaction', 'approved_by', 'TEXT');
  addColIfMissing('inventory_transaction', 'approved_at', 'INTEGER');
  // inventory_stock: packaging fields
  addColIfMissing('inventory_stock', 'packaging_type', "TEXT NOT NULL DEFAULT 'karung'");
  addColIfMissing('inventory_stock', 'parent_stock_id', 'TEXT');
  addColIfMissing('inventory_stock', 'opened_at', 'INTEGER');
  // wo_outputs: storage tracking (anti-dedup)
  addColIfMissing('wo_outputs', 'storage_status', "TEXT NOT NULL DEFAULT 'pending_storage'");
  addColIfMissing('wo_outputs', 'stored_weight', 'REAL NOT NULL DEFAULT 0');
  // contacts: Agen (harga khusus) + Dropshipper (komisi) + peran ganda
  addColIfMissing('contacts', 'is_agent', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('contacts', 'maps_url', 'TEXT');
  addColIfMissing('contacts', 'is_dropshipper', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('contacts', 'agent_discount_pct', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('contacts', 'commission_type', 'TEXT');
  addColIfMissing('contacts', 'commission_value', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('contacts', 'categories', 'TEXT');
  // Backfill role flags from legacy contactType (idempotent)
  try {
    sqlite.exec("UPDATE contacts SET is_agent = 1 WHERE contact_type = 'Agen' AND is_agent = 0");
    sqlite.exec("UPDATE contacts SET is_dropshipper = 1 WHERE contact_type = 'Dropshipper' AND is_dropshipper = 0");
  } catch (e) { /* ignore */ }
  // Backfill categories JSON from legacy contact_type + role flags (idempotent - only where NULL/empty)
  try {
    const rows = sqlite.prepare("SELECT id, contact_type, is_agent, is_dropshipper FROM contacts WHERE categories IS NULL OR categories = ''").all();
    const upd = sqlite.prepare("UPDATE contacts SET categories = ? WHERE id = ?");
    for (const r of rows) {
      const cats = [];
      if (r.contact_type) cats.push(r.contact_type);
      if (r.is_agent && !cats.includes('Agen')) cats.push('Agen');
      if (r.is_dropshipper && !cats.includes('Dropshipper')) cats.push('Dropshipper');
      if (cats.length === 0) cats.push('Customer');
      upd.run(JSON.stringify(cats), r.id);
    }
  } catch (e) { /* ignore */ }
  // inventory_stock: HPP tracking (untuk perhitungan profit komisi)
  addColIfMissing('inventory_stock', 'hpp_per_kg', 'REAL NOT NULL DEFAULT 0');
  // ARCHIVE (soft-archive) — kolom archived_at pada semua modul list
  addColIfMissing('user', 'archived_at', 'INTEGER');
  addColIfMissing('contacts', 'archived_at', 'INTEGER');
  addColIfMissing('products', 'archived_at', 'INTEGER');
  addColIfMissing('cold_storages', 'archived_at', 'INTEGER');
  addColIfMissing('sales_order', 'archived_at', 'INTEGER');
  addColIfMissing('purchase_order', 'archived_at', 'INTEGER');
  addColIfMissing('work_order', 'archived_at', 'INTEGER');
  addColIfMissing('inventory_stock', 'archived_at', 'INTEGER');
  // surat_jalan: tujuan pengiriman (pelanggan akhir Agen/Dropshipper)
  addColIfMissing('surat_jalan', 'ship_to_customer_id', 'TEXT');
  addColIfMissing('surat_jalan', 'ship_to_name', 'TEXT');
  addColIfMissing('surat_jalan', 'ship_to_phone', 'TEXT');
  addColIfMissing('surat_jalan', 'ship_to_address', 'TEXT');
  addColIfMissing('surat_jalan', 'show_received_column', 'INTEGER NOT NULL DEFAULT 0');
  // sales_order: dropship (tanpa stok, langsung supplier->customer) + basis invoice
  addColIfMissing('sales_order', 'fulfillment_type', "TEXT NOT NULL DEFAULT 'stock'"); // stock | dropship
  addColIfMissing('sales_order', 'supplier_id', 'TEXT');
  addColIfMissing('sales_order', 'auto_po_id', 'TEXT');
  addColIfMissing('sales_order', 'invoice_weight_basis', "TEXT NOT NULL DEFAULT 'shipped'"); // shipped | received
  // sales_order_items: berat kirim riil (hari-H) + berat diterima
  addColIfMissing('sales_order_items', 'shipped_weight', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sales_order_items', 'received_weight', 'REAL NOT NULL DEFAULT 0');
  // Pelanggan akhir milik Agen/Dropshipper
  sqlite.exec(`CREATE TABLE IF NOT EXISTS contact_customers (
    id TEXT PRIMARY KEY,
    parent_contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    linked_contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    maps_url TEXT,
    pic_name TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_contact_customers_parent ON contact_customers (parent_contact_id)`);
  // idempotent add for existing DBs
  addColIfMissing('contact_customers', 'linked_contact_id', 'TEXT');
  addColIfMissing('contact_customers', 'maps_url', 'TEXT');
  // Dokumen legal kontak (opsional)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS contact_documents (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    uploaded_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_contact_documents_contact ON contact_documents (contact_id)`);
  // Komisi Dropshipper
  sqlite.exec(`CREATE TABLE IF NOT EXISTS commission_records (
    id TEXT PRIMARY KEY,
    dropshipper_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    sales_order_id TEXT REFERENCES sales_order(id) ON DELETE SET NULL,
    so_number TEXT,
    commission_type TEXT NOT NULL,
    commission_value REAL NOT NULL DEFAULT 0,
    basis_amount REAL NOT NULL DEFAULT 0,
    revenue_amount REAL NOT NULL DEFAULT 0,
    cost_amount REAL NOT NULL DEFAULT 0,
    commission_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'unpaid',
    payment_id TEXT,
    paid_at INTEGER,
    notes TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_commission_records_ds ON commission_records (dropshipper_id, status)`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS commission_payments (
    id TEXT PRIMARY KEY,
    dropshipper_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    payment_date INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'Transfer',
    reference TEXT,
    notes TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_commission_payments_ds ON commission_payments (dropshipper_id)`);
  // wo_stages master + records
  sqlite.exec(`CREATE TABLE IF NOT EXISTS wo_stages (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    sequence_order INTEGER NOT NULL DEFAULT 0,
    fields_schema TEXT NOT NULL DEFAULT '[]',
    color TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS wo_stage_records (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
    stage_id TEXT NOT NULL REFERENCES wo_stages(id),
    recorded_at INTEGER NOT NULL,
    recorded_by TEXT,
    field_values TEXT NOT NULL DEFAULT '{}',
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_wo_stage_rec_wo ON wo_stage_records (work_order_id, stage_id)`);

  // =========================
  // ACCOUNTING MODULE (SAK EP) — Chart of Accounts, Journal Entries, Journal Lines
  // =========================
  sqlite.exec(`CREATE TABLE IF NOT EXISTS gl_accounts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,                 -- asset | liability | equity | revenue | cogs | expense | other_income | other_expense
    normal_balance TEXT NOT NULL DEFAULT 'debit', -- debit | credit
    category TEXT,                      -- report grouping label (e.g. 'Aset Lancar')
    parent_code TEXT,
    cash_flow_category TEXT DEFAULT 'operating', -- operating | investing | financing | none
    is_postable INTEGER NOT NULL DEFAULT 1,
    is_system INTEGER NOT NULL DEFAULT 0,
    opening_balance REAL NOT NULL DEFAULT 0,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    archived_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    journal_number TEXT NOT NULL UNIQUE,
    entry_date INTEGER NOT NULL,
    description TEXT,
    source_type TEXT NOT NULL DEFAULT 'MANUAL', -- MANUAL | OPENING | SO_INV | PO_INV | SPAY | PPAY | SRET | PRET | OPN | WO
    source_id TEXT,
    source_number TEXT,
    source_key TEXT,
    is_auto INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'posted', -- posted | void
    total_debit REAL NOT NULL DEFAULT 0,
    total_credit REAL NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS journal_lines (
    id TEXT PRIMARY KEY,
    journal_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    account_code TEXT,
    description TEXT,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON journal_lines (journal_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines (account_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries (entry_date)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_journal_entries_auto ON journal_entries (is_auto, source_type)`);
  // Fixed Assets (Aset Tetap) + monthly depreciation source
  sqlite.exec(`CREATE TABLE IF NOT EXISTS fixed_assets (
    id TEXT PRIMARY KEY,
    code TEXT,
    name TEXT NOT NULL,
    category TEXT,
    acquisition_date INTEGER NOT NULL,
    acquisition_cost REAL NOT NULL DEFAULT 0,
    salvage_value REAL NOT NULL DEFAULT 0,
    useful_life_months INTEGER NOT NULL DEFAULT 12,
    method TEXT NOT NULL DEFAULT 'straight_line',
    asset_account_code TEXT,
    accum_account_code TEXT,
    expense_account_code TEXT,
    post_depreciation INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',   -- active | disposed
    disposed_date INTEGER,
    notes TEXT,
    archived_at INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  // Period closings (Tutup Buku)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS period_closings (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL UNIQUE,        -- YYYY-MM
    closing_date INTEGER NOT NULL,
    journal_id TEXT,
    net_income REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'closed',
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);
  // Seed default Chart of Accounts + mapping + settings (idempotent)
  try { seedAccounting(sqlite); } catch (e) { console.error('seedAccounting failed:', e?.message || e); }
}
