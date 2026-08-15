// Regenerate lib/db/seed-snapshot.json from the CURRENT (clean-slate) SQLite DB.
// This snapshot is what a fresh production container restores on first boot (see lib/db/seed.js).
// Usage (cwd=/app): node scripts/generate_seed_snapshot.mjs
import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('/app/data/erp.db', { readonly: true });

// Same table set the seed mechanism understands. Empty tables are kept as [] for clarity.
const TABLES = [
  'user', 'account', 'app_settings',
  'contacts', 'products', 'cold_storages', 'zones', 'wo_stages',
  'gl_accounts', 'journal_entries', 'journal_lines',
  'inventory_transaction', 'inventory_stock',
  'sales_order', 'sales_order_items',
  'purchase_order', 'purchase_order_items',
];

const out = {};
let total = 0;
for (const t of TABLES) {
  try {
    const rows = db.prepare(`SELECT * FROM "${t}"`).all();
    out[t] = rows;
    total += rows.length;
    console.log(`  ${t.padEnd(24)} ${rows.length}`);
  } catch (e) {
    console.log(`  ${t.padEnd(24)} SKIP (${e.message})`);
  }
}
db.close();

fs.writeFileSync('/app/lib/db/seed-snapshot.json', JSON.stringify(out, null, 0));
console.log(`\nWrote lib/db/seed-snapshot.json — ${total} rows across ${Object.keys(out).length} tables.`);
