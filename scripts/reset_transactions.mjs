// FULL RESET — empty all transactional data, keep master data only.
// KEEP: contacts (+docs/customers), products, cold_storages, zones, gl_accounts (structure, balances zeroed),
//       user/account/session/verification (auth), app_settings, wo_stages.
// Backup already taken by main agent. Usage (cwd=/app): node scripts/reset_transactions.mjs run
import Database from 'better-sqlite3';
import { syncLedger } from '/app/lib/accounting/engine.js';

const MODE = process.argv[2] || 'validate';
const db = new Database('/app/data/erp.db');
db.pragma('busy_timeout = 8000');

const WIPE = [
  // sales
  'so_item_stocks', 'sales_payments', 'sales_order_receipt_items', 'sales_order_receipts',
  'sales_returns', 'surat_jalan', 'sales_order_items', 'sales_order',
  // purchase
  'purchase_payments', 'purchase_returns', 'purchase_order_items', 'purchase_order',
  // grn
  'grn_documents', 'grn_items', 'grn',
  // work order / tally
  'wo_custom_costs', 'wo_outputs', 'wo_stage_records', 'work_order_details', 'work_order',
  'tally_session_items', 'tally_session',
  // inventory
  'inventory_transaction', 'inventory_stock',
  'stock_opname_items', 'stock_opname',
  // accounting
  'journal_lines', 'journal_entries', 'period_closings',
  // misc transactional
  'commission_records', 'commission_payments', 'fixed_assets', 'approvals', 'notifications',
];

const before = {};
for (const t of WIPE) { try { before[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch (e) { before[t] = 'N/A'; } }
console.log('Rows to wipe:', JSON.stringify(before));

if (MODE !== 'run') { console.log('(validate only — no changes)'); db.close(); process.exit(0); }

const tx = db.transaction(() => {
  db.pragma('foreign_keys = OFF');
  for (const t of WIPE) { try { db.prepare(`DELETE FROM "${t}"`).run(); } catch (e) { console.log('skip', t, e.message); } }
  // zero out chart-of-account balances (keep account structure)
  try { db.prepare('UPDATE gl_accounts SET opening_balance=0').run(); } catch (e) {}
  try { db.prepare('UPDATE gl_accounts SET current_balance=0').run(); } catch (e) {}
});
tx();

// regenerate ledger from (now empty) source docs -> should be 0 journals
const sync = syncLedger(db, { createdBy: 'system-reset' });
console.log('\nsyncLedger after reset:', JSON.stringify(sync));

console.log('\n=== AFTER RESET ===');
const keep = ['contacts', 'products', 'cold_storages', 'zones', 'gl_accounts', 'user', 'app_settings', 'wo_stages'];
for (const t of keep) { try { console.log('  KEEP', t.padEnd(16), db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c); } catch (e) {} }
for (const t of ['sales_order', 'purchase_order', 'inventory_stock', 'inventory_transaction', 'journal_entries', 'journal_lines', 'grn', 'work_order']) {
  try { console.log('  WIPED', t.padEnd(16), db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c); } catch (e) {}
}
console.log('  gl opening_balance sum:', db.prepare('SELECT COALESCE(SUM(opening_balance),0) s FROM gl_accounts').get().s);
db.close();
console.log('\nDONE — clean slate with master data only.');
