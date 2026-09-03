// One-off ROLLBACK of a single Sales Order back to Draft, returning stock to inventory
// and removing ALL accounting/stock linkage. Financial journals (SO_INV, SPAY) are
// derived/auto-rebuilt by the accounting engine, so once the SO is Draft with no payments
// and no so_item_stocks, they disappear automatically on the next accounting sync.
//
// Usage: node scripts/rollback_so.js SO/202608/0037            (dry-run)
//        node scripts/rollback_so.js SO/202608/0037 --apply     (write changes)
const fs = require('fs');
const { MongoClient } = require('mongodb');
function parseEnv(f){const o={};try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m){let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}}catch{}return o;}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL;
const DB_NAME = env.MONGO_DB_NAME || (String(MONGO_URL).match(/\/([^/?]+)(\?|$)/)||[])[1];
const SO_NUMBER = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!SO_NUMBER || SO_NUMBER.startsWith('--')) { console.error('Usage: node scripts/rollback_so.js <SO_NUMBER> [--apply]'); process.exit(1); }

(async () => {
  const c = new MongoClient(MONGO_URL); await c.connect(); const d = c.db(DB_NAME);
  const so = await d.collection('sales_order').findOne({ so_number: SO_NUMBER });
  if (!so) { console.error('SO not found:', SO_NUMBER); await c.close(); return; }
  const soId = so.id;
  console.log(`SO ${SO_NUMBER} id=${soId} status=${so.pipeline_status} inv=${so.invoice_number} paid=${so.paid_amount} apply=${APPLY}`);

  const items = await d.collection('sales_order_items').find({ sales_order_id: soId }).toArray();
  const stocks = await d.collection('so_item_stocks').find({ sales_order_id: soId }).toArray();
  const payments = await d.collection('sales_payments').find({ sales_order_id: soId }).toArray();
  const sjs = await d.collection('surat_jalan').find({ sales_order_id: soId }).toArray();
  const receipts = await d.collection('sales_order_receipts').find({ sales_order_id: soId }).toArray();
  const ledger = await d.collection('stock_ledger').find({ reference_id: soId, reference_type: 'SO' }).toArray();
  const invtx = await d.collection('inventory_transaction').find({ reference_id: soId, reference_type: 'SO' }).toArray();
  // optional child item collections
  const sjIds = sjs.map(x => x.id);
  const rcIds = receipts.map(x => x.id);
  const sjItems = sjIds.length ? await d.collection('surat_jalan_items').find({ surat_jalan_id: { $in: sjIds } }).toArray() : [];
  const rcItems = rcIds.length ? await d.collection('sales_order_receipt_items').find({ receipt_id: { $in: rcIds } }).toArray() : [];

  console.log(`children: items=${items.length} so_item_stocks=${stocks.length} payments=${payments.length} sj=${sjs.length}(items ${sjItems.length}) receipts=${receipts.length}(items ${rcItems.length}) stock_ledger=${ledger.length} inv_tx=${invtx.length}`);
  console.log('lots to return -> active:', stocks.map(s => s.kode_simpan).join(', '));

  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  fs.mkdirSync('/app/backups', { recursive: true });
  const bf = `/app/backups/rollback_${SO_NUMBER.replace(/\//g,'_')}_${ts}.json`;
  fs.writeFileSync(bf, JSON.stringify({ sales_order: so, items, so_item_stocks: stocks, payments, surat_jalan: sjs, surat_jalan_items: sjItems, receipts, receipt_items: rcItems, stock_ledger: ledger, inventory_transaction: invtx }, null, 2));
  console.log('Backup ->', bf);

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to execute rollback.'); await c.close(); return; }

  // 1) return lots to inventory (active)
  let restored = 0;
  for (const st of stocks) {
    if (!st.stock_id) continue;
    const r = await d.collection('inventory_stock').updateOne({ id: st.stock_id, status: { $in: ['used','allocated'] } }, { $set: { status: 'active', updated_at: Math.floor(Date.now()/1000) } });
    restored += r.modifiedCount;
  }
  // 2) remove stock footprint
  await d.collection('stock_ledger').deleteMany({ reference_id: soId, reference_type: 'SO' });
  await d.collection('inventory_transaction').deleteMany({ reference_id: soId, reference_type: 'SO' });
  // 3) clear allocations, payments, delivery docs
  await d.collection('so_item_stocks').deleteMany({ sales_order_id: soId });
  await d.collection('sales_payments').deleteMany({ sales_order_id: soId });
  if (sjItems.length) await d.collection('surat_jalan_items').deleteMany({ surat_jalan_id: { $in: sjIds } });
  await d.collection('surat_jalan').deleteMany({ sales_order_id: soId });
  if (rcItems.length) await d.collection('sales_order_receipt_items').deleteMany({ receipt_id: { $in: rcIds } });
  await d.collection('sales_order_receipts').deleteMany({ sales_order_id: soId });
  // 4) reset items to draft/unallocated
  await d.collection('sales_order_items').updateMany({ sales_order_id: soId }, { $set: { stock_code_id: null, outbound_tally_status: 'none', shipped_weight: null, received_weight: null } });
  // 5) reset SO header to Draft, remove invoice + payment linkage
  await d.collection('sales_order').updateOne({ id: soId }, { $set: {
    pipeline_status: 'Draft', invoice_number: null, invoice_date: null, due_date: null,
    paid_amount: 0, payment_status: 'unpaid', updated_at: Math.floor(Date.now()/1000),
  } });

  console.log(`\nAPPLIED: lots returned to active=${restored}; deleted stock_ledger=${ledger.length}, inv_tx=${invtx.length}, so_item_stocks=${stocks.length}, payments=${payments.length}, sj=${sjs.length}, receipts=${receipts.length}.`);
  console.log('SO reset to Draft with invoice/payment linkage removed. Accounting journals (SO_INV/SPAY) will auto-drop on next accounting sync.');
  await c.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
