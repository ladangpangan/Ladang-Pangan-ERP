// Cleanup TEST data created by testing agents (app-native PO/SO/GRN + their inventory lots),
// then regenerate journals so the August pilot stays pristine.
// Idempotent. Usage (cwd=/app): node scripts/cleanup_test_data.mjs [run]
import Database from 'better-sqlite3';
import { syncLedger } from '/app/lib/accounting/engine.js';

const MODE = process.argv[2] || 'validate';
const db = new Database('/app/data/erp.db');
db.pragma('busy_timeout = 8000');

// Odoo imports use PO 'P00xxx' and SO 'S00xxx'. App-created test docs use 'PO/...', 'SO/...'.
const testPOs = db.prepare("SELECT id, po_number FROM purchase_order WHERE po_number LIKE 'PO/%' OR po_number LIKE '%/2026%/%'").all();
const testSOs = db.prepare("SELECT id, so_number FROM sales_order WHERE so_number LIKE 'SO/%'").all();
console.log('Test POs:', testPOs.map((p) => p.po_number));
console.log('Test SOs:', testSOs.map((s) => s.so_number));

if (MODE !== 'run') { console.log('(validate only)'); db.close(); process.exit(0); }

const tx = db.transaction(() => {
  for (const po of testPOs) {
    const grns = db.prepare('SELECT id FROM grn WHERE purchase_order_id=?').all(po.id);
    // inventory lots stored from this PO/GRN
    db.prepare('DELETE FROM inventory_stock WHERE source_batch=?').run(po.id);
    for (const g of grns) db.prepare('DELETE FROM inventory_stock WHERE source_batch=?').run(g.id);
    // inventory transactions referencing this PO or its GRNs
    db.prepare('DELETE FROM inventory_transaction WHERE reference_id=?').run(po.id);
    for (const g of grns) {
      db.prepare('DELETE FROM inventory_transaction WHERE reference_id=?').run(g.id);
      db.prepare('DELETE FROM grn_documents WHERE grn_id=?').run(g.id);
      db.prepare('DELETE FROM grn_items WHERE grn_id=?').run(g.id);
      db.prepare('DELETE FROM grn WHERE id=?').run(g.id);
    }
    // purchase payments / items / header
    try { db.prepare('DELETE FROM purchase_payments WHERE purchase_order_id=?').run(po.id); } catch (e) {}
    db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id=?').run(po.id);
    db.prepare('DELETE FROM purchase_order WHERE id=?').run(po.id);
  }
  for (const so of testSOs) {
    try { db.prepare('DELETE FROM sales_payments WHERE sales_order_id=?').run(so.id); } catch (e) {}
    try { db.prepare('DELETE FROM so_item_stocks WHERE sales_order_id=?').run(so.id); } catch (e) {}
    db.prepare('DELETE FROM sales_order_items WHERE sales_order_id=?').run(so.id);
    db.prepare('DELETE FROM sales_order WHERE id=?').run(so.id);
  }
});
tx();

console.log('\nRegenerating journals (syncLedger)...');
const sync = syncLedger(db, { createdBy: 'odoo-import' });
console.log('syncLedger:', JSON.stringify(sync));

const jbySrc = db.prepare('SELECT source_type, COUNT(*) c FROM journal_entries GROUP BY source_type ORDER BY source_type').all();
const inv = db.prepare("SELECT COUNT(*) c, ROUND(SUM(weight),2) w FROM inventory_stock WHERE status='active' AND archived_at IS NULL").get();
const dupes = db.prepare("SELECT p.sku, COUNT(*) c FROM inventory_stock s JOIN products p ON p.id=s.product_id WHERE s.status='active' GROUP BY p.sku HAVING c>1").all();
console.log('journals:', JSON.stringify(jbySrc));
console.log('active lots:', inv.c, 'weight:', inv.w, 'kg | dupes:', JSON.stringify(dupes));
db.close();
