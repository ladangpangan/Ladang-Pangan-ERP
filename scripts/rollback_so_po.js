// Combined ROLLBACK of a Sales Order + its auto-generated (dropship) Purchase Order back to Draft.
// Deletes payments, delivery docs (Surat Jalan/Receipt), GRN, pending approvals, commission records,
// and related notifications. KEEPS the SO/PO line items (with allocation/weight/tally fields reset) so
// the user can re-edit from Draft. Accounting journals are auto-derived from the source tables, so they
// disappear on the next accounting sync once the source data is reset.
//
// Usage: node scripts/rollback_so_po.js SO/202608/0021            (dry-run)
//        node scripts/rollback_so_po.js SO/202608/0021 --apply     (write changes)
const fs = require('fs');
const { MongoClient } = require('mongodb');
function parseEnv(f){const o={};try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m){let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}}catch{}return o;}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL;
const DB_NAME = env.MONGO_DB_NAME || (String(MONGO_URL).match(/\/([^/?]+)(\?|$)/)||[])[1];
const SO_NUMBER = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!SO_NUMBER || SO_NUMBER.startsWith('--')) { console.error('Usage: node scripts/rollback_so_po.js <SO_NUMBER> [--apply]'); process.exit(1); }
const now = () => Math.floor(Date.now()/1000);

(async () => {
  const c = new MongoClient(MONGO_URL); await c.connect(); const d = c.db(DB_NAME);
  const so = await d.collection('sales_order').findOne({ so_number: SO_NUMBER });
  if (!so) { console.error('SO not found:', SO_NUMBER); await c.close(); return; }
  const soId = so.id;
  const poId = so.auto_po_id || null;
  const po = poId ? await d.collection('purchase_order').findOne({ id: poId }) : await d.collection('purchase_order').findOne({ sales_order_id: soId });
  const realPoId = po ? po.id : null;
  console.log(`SO ${SO_NUMBER} id=${soId} status=${so.pipeline_status} inv=${so.invoice_number} paid=${so.paid_amount}`);
  console.log(`PO ${po ? po.po_number : '(none)'} id=${realPoId} status=${po ? po.pipeline_status : '-'} paid=${po ? po.paid_amount : '-'}`);
  console.log('APPLY =', APPLY);

  // ---- Gather SO children ----
  const items = await d.collection('sales_order_items').find({ sales_order_id: soId }).toArray();
  const stocks = await d.collection('so_item_stocks').find({ sales_order_id: soId }).toArray();
  const payments = await d.collection('sales_payments').find({ sales_order_id: soId }).toArray();
  const sjs = await d.collection('surat_jalan').find({ sales_order_id: soId }).toArray();
  const receipts = await d.collection('sales_order_receipts').find({ sales_order_id: soId }).toArray();
  const soLedger = await d.collection('stock_ledger').find({ reference_id: soId, reference_type: 'SO' }).toArray();
  const soInvTx = await d.collection('inventory_transaction').find({ reference_id: soId, reference_type: 'SO' }).toArray();
  const sjIds = sjs.map(x => x.id);
  const rcIds = receipts.map(x => x.id);
  const sjItems = sjIds.length ? await d.collection('surat_jalan_items').find({ surat_jalan_id: { $in: sjIds } }).toArray() : [];
  const rcItems = rcIds.length ? await d.collection('sales_order_receipt_items').find({ receipt_id: { $in: rcIds } }).toArray() : [];
  const commRecords = await d.collection('commission_records').find({ sales_order_id: soId }).toArray();
  const commPayments = await d.collection('commission_payments').find({ sales_order_id: soId }).toArray();

  // ---- Gather PO children ----
  let poItems = [], grns = [], grnItems = [], poPayments = [], poLedger = [], poInvTx = [], grnDocs = [];
  if (realPoId) {
    poItems = await d.collection('purchase_order_items').find({ purchase_order_id: realPoId }).toArray();
    grns = await d.collection('grn').find({ purchase_order_id: realPoId }).toArray();
    const grnIds = grns.map(g => g.id);
    grnItems = grnIds.length ? await d.collection('grn_items').find({ grn_id: { $in: grnIds } }).toArray() : [];
    grnDocs = grnIds.length ? await d.collection('grn_documents').find({ grn_id: { $in: grnIds } }).toArray() : [];
    poPayments = await d.collection('purchase_payments').find({ purchase_order_id: realPoId }).toArray();
    poLedger = await d.collection('stock_ledger').find({ reference_id: realPoId, reference_type: 'PO' }).toArray();
    poInvTx = await d.collection('inventory_transaction').find({ reference_id: realPoId, reference_type: 'PO' }).toArray();
  }

  // ---- Approvals + notifications for both docs ----
  const idsForApproval = [soId, realPoId].filter(Boolean);
  const numsForNotif = [SO_NUMBER, so.invoice_number, po && po.po_number].filter(Boolean).map(x => String(x).split('/').slice(-2).join('/'));
  const approvals = await d.collection('approvals').find({ entity_id: { $in: idsForApproval } }).toArray();
  const notifRegex = numsForNotif.length ? numsForNotif.map(n => n.replace(/\//g,'\\/')).join('|') : 'NO_MATCH';
  const notifs = await d.collection('notifications').find({ $or: [ { message: { $regex: notifRegex } }, { metadata: { $regex: notifRegex } } ] }).toArray().catch(() => []);

  console.log('\n--- SO children ---');
  console.log(`items=${items.length} so_item_stocks=${stocks.length} payments=${payments.length} sj=${sjs.length}(items ${sjItems.length}) receipts=${receipts.length}(items ${rcItems.length}) stock_ledger=${soLedger.length} inv_tx=${soInvTx.length} commission_records=${commRecords.length} commission_payments=${commPayments.length}`);
  console.log('lots to return:', stocks.map(s => s.kode_simpan).join(', ') || '(none)');
  console.log('--- PO children ---');
  console.log(`items=${poItems.length} grn=${grns.length}(items ${grnItems.length}, docs ${grnDocs.length}) payments=${poPayments.length} stock_ledger=${poLedger.length} inv_tx=${poInvTx.length}`);
  console.log('--- shared ---');
  console.log(`approvals=${approvals.length} [${approvals.map(a=>a.concern_type+':'+a.status).join(', ')}] notifications=${notifs.length}`);

  // ---- Backup ----
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  fs.mkdirSync('/app/backups', { recursive: true });
  const bf = `/app/backups/rollback_SOPO_${SO_NUMBER.replace(/\//g,'_')}_${ts}.json`;
  fs.writeFileSync(bf, JSON.stringify({
    sales_order: so, sales_order_items: items, so_item_stocks: stocks, sales_payments: payments,
    surat_jalan: sjs, surat_jalan_items: sjItems, sales_order_receipts: receipts, sales_order_receipt_items: rcItems,
    so_stock_ledger: soLedger, so_inventory_transaction: soInvTx, commission_records: commRecords, commission_payments: commPayments,
    purchase_order: po, purchase_order_items: poItems, grn: grns, grn_items: grnItems, grn_documents: grnDocs,
    purchase_payments: poPayments, po_stock_ledger: poLedger, po_inventory_transaction: poInvTx,
    approvals, notifications: notifs,
  }, null, 2));
  console.log('\nBackup ->', bf);

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to execute.'); await c.close(); return; }

  // ================= APPLY =================
  // 1) Return any allocated lots to inventory (SO side)
  let restored = 0;
  for (const st of stocks) {
    if (!st.stock_id) continue;
    const r = await d.collection('inventory_stock').updateOne({ id: st.stock_id, status: { $in: ['used','allocated'] } }, { $set: { status: 'active', updated_at: now() } });
    restored += r.modifiedCount;
  }

  // 2) SO stock footprint
  await d.collection('stock_ledger').deleteMany({ reference_id: soId, reference_type: 'SO' });
  await d.collection('inventory_transaction').deleteMany({ reference_id: soId, reference_type: 'SO' });
  // 3) SO allocations, payments, delivery docs
  await d.collection('so_item_stocks').deleteMany({ sales_order_id: soId });
  await d.collection('sales_payments').deleteMany({ sales_order_id: soId });
  if (sjItems.length) await d.collection('surat_jalan_items').deleteMany({ surat_jalan_id: { $in: sjIds } });
  await d.collection('surat_jalan').deleteMany({ sales_order_id: soId });
  if (rcItems.length) await d.collection('sales_order_receipt_items').deleteMany({ receipt_id: { $in: rcIds } });
  await d.collection('sales_order_receipts').deleteMany({ sales_order_id: soId });
  // 4) commission records/payments (re-created when SO re-processed with correct commission)
  await d.collection('commission_payments').deleteMany({ sales_order_id: soId });
  await d.collection('commission_records').deleteMany({ sales_order_id: soId });
  // 5) reset SO items
  await d.collection('sales_order_items').updateMany({ sales_order_id: soId }, { $set: { stock_code_id: null, outbound_tally_status: 'none', shipped_weight: null, received_weight: null } });
  // 6) reset SO header to Draft
  await d.collection('sales_order').updateOne({ id: soId }, { $set: {
    pipeline_status: 'Draft', invoice_number: null, invoice_date: null, due_date: null,
    paid_amount: 0, payment_status: 'unpaid', updated_at: now(),
  } });

  // ---- PO side ----
  let grnDeleted = 0;
  if (realPoId) {
    const grnIds = grns.map(g => g.id);
    // PO stock footprint (defensive; dropship GRN normally creates none)
    await d.collection('stock_ledger').deleteMany({ reference_id: realPoId, reference_type: 'PO' });
    await d.collection('inventory_transaction').deleteMany({ reference_id: realPoId, reference_type: 'PO' });
    // GRN + children
    if (grnIds.length) {
      await d.collection('grn_items').deleteMany({ grn_id: { $in: grnIds } });
      await d.collection('grn_documents').deleteMany({ grn_id: { $in: grnIds } });
      const r = await d.collection('grn').deleteMany({ purchase_order_id: realPoId });
      grnDeleted = r.deletedCount;
    }
    // PO payments
    await d.collection('purchase_payments').deleteMany({ purchase_order_id: realPoId });
    // reset PO items received weight
    await d.collection('purchase_order_items').updateMany({ purchase_order_id: realPoId }, { $set: { received_weight: null } });
    // reset PO header to Draft
    await d.collection('purchase_order').updateOne({ id: realPoId }, { $set: {
      pipeline_status: 'Draft', invoice_number: null, invoice_date: null, due_date: null,
      paid_amount: 0, payment_status: 'unpaid', tally_completed_at: null, updated_at: now(),
    } });
  }

  // ---- shared: delete pending approvals + notifications ----
  const apDel = await d.collection('approvals').deleteMany({ entity_id: { $in: idsForApproval } });
  const noDel = notifs.length ? await d.collection('notifications').deleteMany({ id: { $in: notifs.map(n => n.id) } }) : { deletedCount: 0 };

  console.log('\n=== APPLIED ===');
  console.log(`SO -> Draft. lots restored=${restored}, so_ledger/tx cleared, payments/sj/receipts/allocations deleted, commissions deleted.`);
  console.log(`PO -> Draft. grn deleted=${grnDeleted}, po payments/ledger/tx cleared, received_weight reset.`);
  console.log(`approvals deleted=${apDel.deletedCount}, notifications deleted=${noDel.deletedCount}.`);
  console.log('Accounting journals are auto-derived and will drop on next accounting sync.');
  await c.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
