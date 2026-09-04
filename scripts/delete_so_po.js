// FULL DELETE of a Sales Order + its linked (dropship) Purchase Order + ALL remaining children.
// Accounting journals are auto-derived from these source tables, so they disappear once the
// source docs are gone. Makes a full JSON backup first.
//
// Usage: node scripts/delete_so_po.js SO/202608/0021            (dry-run)
//        node scripts/delete_so_po.js SO/202608/0021 --apply     (delete)
const fs = require('fs');
const { MongoClient } = require('mongodb');
function parseEnv(f){const o={};try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m){let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}}catch{}return o;}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL;
const DB_NAME = env.MONGO_DB_NAME || (String(MONGO_URL).match(/\/([^/?]+)(\?|$)/)||[])[1];
const SO_NUMBER = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!SO_NUMBER || SO_NUMBER.startsWith('--')) { console.error('Usage: node scripts/delete_so_po.js <SO_NUMBER> [--apply]'); process.exit(1); }

(async () => {
  const c = new MongoClient(MONGO_URL); await c.connect(); const d = c.db(DB_NAME);
  const so = await d.collection('sales_order').findOne({ so_number: SO_NUMBER });
  if (!so) { console.error('SO not found:', SO_NUMBER); await c.close(); return; }
  const soId = so.id;
  const po = so.auto_po_id ? await d.collection('purchase_order').findOne({ id: so.auto_po_id }) : await d.collection('purchase_order').findOne({ sales_order_id: soId });
  const poId = po ? po.id : null;
  console.log(`SO ${SO_NUMBER} id=${soId} status=${so.pipeline_status}  PO ${po?po.po_number:'(none)'} id=${poId} status=${po?po.pipeline_status:'-'}  APPLY=${APPLY}`);

  // Gather everything for backup
  const grab = async (coll, q) => await d.collection(coll).find(q).toArray();
  const soItems = await grab('sales_order_items', { sales_order_id: soId });
  const soStocks = await grab('so_item_stocks', { sales_order_id: soId });
  const soPays = await grab('sales_payments', { sales_order_id: soId });
  const sjs = await grab('surat_jalan', { sales_order_id: soId }); const sjIds = sjs.map(x=>x.id);
  const sjItems = sjIds.length ? await grab('surat_jalan_items', { surat_jalan_id: { $in: sjIds } }) : [];
  const receipts = await grab('sales_order_receipts', { sales_order_id: soId }); const rcIds = receipts.map(x=>x.id);
  const rcItems = rcIds.length ? await grab('sales_order_receipt_items', { receipt_id: { $in: rcIds } }) : [];
  const salesReturns = await grab('sales_returns', { sales_order_id: soId });
  const commRecords = await grab('commission_records', { sales_order_id: soId });
  const commPays = await grab('commission_payments', { sales_order_id: soId });
  const soLedger = await grab('stock_ledger', { reference_id: soId, reference_type: 'SO' });
  const soTx = await grab('inventory_transaction', { reference_id: soId, reference_type: 'SO' });

  let poItems=[], grns=[], grnItems=[], grnDocs=[], poPays=[], poReturns=[], poLedger=[], poTx=[];
  if (poId) {
    poItems = await grab('purchase_order_items', { purchase_order_id: poId });
    grns = await grab('grn', { purchase_order_id: poId }); const gIds = grns.map(x=>x.id);
    grnItems = gIds.length ? await grab('grn_items', { grn_id: { $in: gIds } }) : [];
    grnDocs = gIds.length ? await grab('grn_documents', { grn_id: { $in: gIds } }) : [];
    poPays = await grab('purchase_payments', { purchase_order_id: poId });
    poReturns = await grab('purchase_returns', { purchase_order_id: poId });
    poLedger = await grab('stock_ledger', { reference_id: poId, reference_type: 'PO' });
    poTx = await grab('inventory_transaction', { reference_id: poId, reference_type: 'PO' });
  }
  const ids = [soId, poId].filter(Boolean);
  const approvals = await grab('approvals', { entity_id: { $in: ids } });

  console.log(`SO children: items=${soItems.length} stocks=${soStocks.length} pays=${soPays.length} sj=${sjs.length}(i${sjItems.length}) receipts=${receipts.length}(i${rcItems.length}) salesReturns=${salesReturns.length} comm=${commRecords.length}/${commPays.length} ledger=${soLedger.length} tx=${soTx.length}`);
  console.log(`PO children: items=${poItems.length} grn=${grns.length}(i${grnItems.length},doc${grnDocs.length}) pays=${poPays.length} returns=${poReturns.length} ledger=${poLedger.length} tx=${poTx.length}`);
  console.log(`approvals=${approvals.length}`);

  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  fs.mkdirSync('/app/backups', { recursive: true });
  const bf = `/app/backups/DELETE_SOPO_${SO_NUMBER.replace(/\//g,'_')}_${ts}.json`;
  fs.writeFileSync(bf, JSON.stringify({ sales_order: so, purchase_order: po, soItems, soStocks, soPays, sjs, sjItems, receipts, rcItems, salesReturns, commRecords, commPays, soLedger, soTx, poItems, grns, grnItems, grnDocs, poPays, poReturns, poLedger, poTx, approvals }, null, 2));
  console.log('Backup ->', bf);

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to DELETE.'); await c.close(); return; }

  const del = async (coll, q) => { const r = await d.collection(coll).deleteMany(q); return r.deletedCount; };
  // Return any allocated lots first (defensive)
  for (const st of soStocks) { if (st.stock_id) await d.collection('inventory_stock').updateOne({ id: st.stock_id, status: { $in: ['used','allocated'] } }, { $set: { status: 'active', updated_at: Math.floor(Date.now()/1000) } }); }

  const gIds = grns.map(x=>x.id);
  const out = {};
  out.so_item_stocks = await del('so_item_stocks', { sales_order_id: soId });
  out.sales_payments = await del('sales_payments', { sales_order_id: soId });
  if (sjIds.length) out.surat_jalan_items = await del('surat_jalan_items', { surat_jalan_id: { $in: sjIds } });
  out.surat_jalan = await del('surat_jalan', { sales_order_id: soId });
  if (rcIds.length) out.receipt_items = await del('sales_order_receipt_items', { receipt_id: { $in: rcIds } });
  out.receipts = await del('sales_order_receipts', { sales_order_id: soId });
  out.sales_returns = await del('sales_returns', { sales_order_id: soId });
  out.commission_payments = await del('commission_payments', { sales_order_id: soId });
  out.commission_records = await del('commission_records', { sales_order_id: soId });
  out.so_stock_ledger = await del('stock_ledger', { reference_id: soId, reference_type: 'SO' });
  out.so_inv_tx = await del('inventory_transaction', { reference_id: soId, reference_type: 'SO' });
  out.sales_order_items = await del('sales_order_items', { sales_order_id: soId });
  out.sales_order = await del('sales_order', { id: soId });
  if (poId) {
    if (gIds.length) { out.grn_items = await del('grn_items', { grn_id: { $in: gIds } }); out.grn_documents = await del('grn_documents', { grn_id: { $in: gIds } }); }
    out.grn = await del('grn', { purchase_order_id: poId });
    out.purchase_payments = await del('purchase_payments', { purchase_order_id: poId });
    out.purchase_returns = await del('purchase_returns', { purchase_order_id: poId });
    out.po_stock_ledger = await del('stock_ledger', { reference_id: poId, reference_type: 'PO' });
    out.po_inv_tx = await del('inventory_transaction', { reference_id: poId, reference_type: 'PO' });
    out.purchase_order_items = await del('purchase_order_items', { purchase_order_id: poId });
    out.purchase_order = await del('purchase_order', { id: poId });
  }
  out.approvals = await del('approvals', { entity_id: { $in: ids } });

  console.log('\n=== DELETED ===');
  console.log(JSON.stringify(out, null, 2));
  console.log('Accounting journals are auto-derived and will drop on next accounting sync.');
  await c.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
