// Change the SELL price (unit_price) of ONE product line in a Sales Order, then recompute the SO total
// exactly like the app's recalcSoTotals(). Writes to MongoDB (source of truth). Backup first.
//
// Usage: node scripts/edit_so_item_price.js SO/202608/0023 BLD-01 49500            (dry-run)
//        node scripts/edit_so_item_price.js SO/202608/0023 BLD-01 49500 --apply     (write)
// The 2nd arg matches the product by SKU (exact) OR name (case-insensitive contains).
const fs = require('fs');
const { MongoClient } = require('mongodb');
function parseEnv(f){const o={};try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m){let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}}catch{}return o;}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL;
const DB_NAME = env.MONGO_DB_NAME || (String(MONGO_URL).match(/\/([^/?]+)(\?|$)/)||[])[1];
const SO_NUMBER = process.argv[2];
const PROD_KEY = process.argv[3];
const NEW_PRICE = Number(process.argv[4]);
const APPLY = process.argv.includes('--apply');
if (!SO_NUMBER || !PROD_KEY || !Number.isFinite(NEW_PRICE)) { console.error('Usage: node scripts/edit_so_item_price.js <SO_NUMBER> <SKU_or_NAME> <NEW_PRICE> [--apply]'); process.exit(1); }

(async () => {
  const c = new MongoClient(MONGO_URL); await c.connect(); const d = c.db(DB_NAME);
  const so = await d.collection('sales_order').findOne({ so_number: SO_NUMBER });
  if (!so) { console.error('SO not found:', SO_NUMBER); await c.close(); return; }
  const items = await d.collection('sales_order_items').find({ sales_order_id: so.id }).toArray();
  // resolve product names
  const prodOf = {};
  for (const it of items) { const p = await d.collection('products').findOne({ _id: it.product_id }); prodOf[it.product_id] = p || {}; }
  const key = String(PROD_KEY).toLowerCase();
  const target = items.find(it => {
    const p = prodOf[it.product_id];
    return (p.sku && String(p.sku).toLowerCase() === key) || (p.name && String(p.name).toLowerCase().includes(key));
  });
  if (!target) { console.error('Item not found by SKU/name:', PROD_KEY, '| available:', items.map(it => `${prodOf[it.product_id].name} (${prodOf[it.product_id].sku})`)); await c.close(); return; }

  console.log(`SO ${SO_NUMBER} status=${so.pipeline_status} invoice=${so.invoice_number||'-'} paid=${so.paid_amount} fulfillment=${so.fulfillment_type}`);
  console.log(`TARGET item: ${prodOf[target.product_id].name} (${prodOf[target.product_id].sku})  weight=${target.weight}kg  OLD unit_price=${target.unit_price} -> NEW=${NEW_PRICE}`);

  // recompute exactly like recalcSoTotals(): line = unit_price * (weight || quantity); item subtotal = line - discount
  const newItems = items.map(it => ({ ...it }));
  const t = newItems.find(x => x.id === target.id);
  t.unit_price = NEW_PRICE;
  let subtotal = 0, discountTotal = 0;
  const itemUpdates = [];
  for (const it of newItems) {
    const line = Number(it.unit_price) * Number(it.weight || it.quantity || 0);
    const disc = Number(it.discount || 0);
    const st = line - disc;
    subtotal += line; discountTotal += disc;
    itemUpdates.push({ id: it.id, subtotal: st });
  }
  const buyerShip = (so.shipping_bearer === 'buyer') ? Number(so.shipping_cost || 0) : 0;
  const newTotal = subtotal - discountTotal + buyerShip;
  console.log(`\nOLD SO total_amount=${so.total_amount}`);
  console.log(`NEW: subtotal=${subtotal} discountTotal=${discountTotal} buyerShip=${buyerShip} => total_amount=${newTotal}`);
  console.log('item subtotals ->', itemUpdates.map(u => `${u.id.slice(0,8)}:${u.subtotal}`).join(', '));

  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  fs.mkdirSync('/app/backups', { recursive: true });
  const bf = `/app/backups/EDITPRICE_${SO_NUMBER.replace(/\//g,'_')}_${ts}.json`;
  fs.writeFileSync(bf, JSON.stringify({ sales_order: so, sales_order_items: items }, null, 2));
  console.log('Backup ->', bf);

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to write.'); await c.close(); return; }

  await d.collection('sales_order_items').updateOne({ id: target.id }, { $set: { unit_price: NEW_PRICE } });
  for (const u of itemUpdates) await d.collection('sales_order_items').updateOne({ id: u.id }, { $set: { subtotal: u.subtotal } });
  await d.collection('sales_order').updateOne({ id: so.id }, { $set: { total_amount: newTotal, discount_total: discountTotal, updated_at: Math.floor(Date.now()/1000) } });
  console.log('\n=== APPLIED ===  unit_price & subtotal & SO total updated in MongoDB.');
  await c.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
