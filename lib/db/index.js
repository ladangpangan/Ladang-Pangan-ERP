import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
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
  ];
  for (const s of stmts) sqlite.exec(s);
}
