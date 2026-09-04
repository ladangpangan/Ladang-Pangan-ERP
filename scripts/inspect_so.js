// Read-only inspection of a Sales Order + its linked dropship PO(s) + accounting footprint.
// Usage: node scripts/inspect_so.js SO/202608/0021
const fs = require('fs');
const { MongoClient } = require('mongodb');
function parseEnv(f){const o={};try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m){let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}}catch{}return o;}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL;
const DB_NAME = env.MONGO_DB_NAME || (String(MONGO_URL).match(/\/([^/?]+)(\?|$)/)||[])[1];
const SO_NUMBER = process.argv[2];
if (!SO_NUMBER) { console.error('Usage: node scripts/inspect_so.js <SO_NUMBER>'); process.exit(1); }

(async () => {
  const c = new MongoClient(MONGO_URL); await c.connect(); const d = c.db(DB_NAME);
  const so = await d.collection('sales_order').findOne({ so_number: SO_NUMBER });
  if (!so) { console.error('SO not found:', SO_NUMBER); await c.close(); return; }
  const soId = so.id;
  console.log('=== SALES ORDER ===');
  console.log(JSON.stringify({ id: so.id, so_number: so.so_number, status: so.pipeline_status, invoice: so.invoice_number, order_date: so.order_date, paid: so.paid_amount, payment_status: so.payment_status, is_dropship: so.is_dropship, dropship_po: so.dropship_po_number, customer_id: so.customer_id }, null, 2));

  const items = await d.collection('sales_order_items').find({ sales_order_id: soId }).toArray();
  const stocks = await d.collection('so_item_stocks').find({ sales_order_id: soId }).toArray();
  const payments = await d.collection('sales_payments').find({ sales_order_id: soId }).toArray();
  const sjs = await d.collection('surat_jalan').find({ sales_order_id: soId }).toArray();
  const receipts = await d.collection('sales_order_receipts').find({ sales_order_id: soId }).toArray();
  console.log(`\nchildren: items=${items.length} so_item_stocks=${stocks.length} payments=${payments.length} sj=${sjs.length} receipts=${receipts.length}`);
  console.log('lots:', stocks.map(s => `${s.kode_simpan}(${s.stock_id})`).join(', '));
  console.log('payments:', JSON.stringify(payments.map(p=>({id:p.id,amount:p.amount,method:p.method,account:p.account_code,date:p.payment_date})),null,2));

  // Find linked dropship PO(s): match by source_so_id or dropship_po_number, or PO referencing this SO
  const posBySo = await d.collection('purchase_order').find({ $or: [ { source_so_id: soId }, { source_sales_order_id: soId }, { so_number: SO_NUMBER } ] }).toArray();
  let posByNum = [];
  if (so.dropship_po_number) posByNum = await d.collection('purchase_order').find({ po_number: so.dropship_po_number }).toArray();
  const allPos = [...posBySo, ...posByNum.filter(p=>!posBySo.find(x=>x.id===p.id))];
  console.log('\n=== LINKED PURCHASE ORDERS ===', allPos.length);
  for (const po of allPos) {
    console.log(JSON.stringify({ id: po.id, po_number: po.po_number, status: po.pipeline_status, order_date: po.order_date, paid: po.paid_amount, payment_status: po.payment_status, source_so_id: po.source_so_id||po.source_sales_order_id, supplier_id: po.supplier_id }, null, 2));
    const ppay = await d.collection('purchase_payments').find({ purchase_order_id: po.id }).toArray();
    console.log('  po payments:', JSON.stringify(ppay.map(p=>({amount:p.amount,method:p.method,account:p.account_code})),null,2));
  }

  // Accounting journals touching this SO / PO
  const jSo = await d.collection('journal_entries').find({ $or: [ { reference_id: soId }, { source_id: soId } ] }).toArray();
  console.log('\n=== JOURNAL ENTRIES (SO) ===', jSo.length);
  jSo.forEach(j=>console.log(JSON.stringify({id:j.id,date:j.date,source_type:j.source_type,desc:j.description,amount:j.amount})));

  // Commission / cashback
  const comm = await d.collection('commission_payments').find({ sales_order_id: soId }).toArray();
  console.log('\ncommission_payments:', comm.length, JSON.stringify(comm.map(x=>({amount:x.amount,account:x.account_code})),null,2));

  await c.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
