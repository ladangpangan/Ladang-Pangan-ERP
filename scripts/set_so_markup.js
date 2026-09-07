// Set/replace MARKUP (Faktur di-up) + Cashback on a Sales Order, replicating the app's
// POST /sales-orders/:id/markup logic exactly. Writes to MongoDB (source of truth). Backup first.
//
// Usage: node scripts/set_so_markup.js SO/202608/0023 BLD-01=50000 "Daud Harsa" 1-1121            (dry-run)
//        node scripts/set_so_markup.js SO/202608/0023 BLD-01=50000 "Daud Harsa" 1-1121 --apply     (write)
// Markup arg format: SKU=markupUnitPrice (repeat comma-separated for multiple items), e.g. BLD-01=50000,XYZ=12000
const fs = require('fs');
const { MongoClient } = require('mongodb');
function parseEnv(f){const o={};try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m){let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}}catch{}return o;}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL;
const DB_NAME = env.MONGO_DB_NAME || (String(MONGO_URL).match(/\/([^/?]+)(\?|$)/)||[])[1];
const args = process.argv.slice(2).filter(a => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const SO_NUMBER = args[0];
const MK_SPEC = args[1];
const RECIPIENT = args[2] || null;
const ACCOUNT = args[3] || null;
if (!SO_NUMBER || !MK_SPEC) { console.error('Usage: node scripts/set_so_markup.js <SO_NUMBER> <SKU=markupPrice[,...]> [recipient] [accountCode] [--apply]'); process.exit(1); }
const mkBySku = {};
for (const part of MK_SPEC.split(',')) { const [sku, price] = part.split('='); if (sku && price) mkBySku[sku.trim().toLowerCase()] = Number(price); }

(async () => {
  const c = new MongoClient(MONGO_URL); await c.connect(); const d = c.db(DB_NAME);
  const so = await d.collection('sales_order').findOne({ so_number: SO_NUMBER });
  if (!so) { console.error('SO not found:', SO_NUMBER); await c.close(); return; }
  const items = await d.collection('sales_order_items').find({ sales_order_id: so.id }).toArray();
  const prodOf = {};
  for (const it of items) { const p = await d.collection('products').findOne({ _id: it.product_id }); prodOf[it.product_id] = p || {}; }
  // account name for display
  let acctName = ACCOUNT;
  if (ACCOUNT) { const a = await d.collection('gl_accounts').findOne({ code: ACCOUNT }); acctName = a ? `${a.code} ${a.name}` : `${ACCOUNT} (kode tidak ditemukan!)`; }

  const total = Number(so.total_amount || 0);
  let cashback = 0; const itemSets = [];
  for (const it of items) {
    const p = prodOf[it.product_id];
    const sku = (p.sku || '').toLowerCase();
    const sub = Number(it.subtotal || 0);
    const realUnit = Number(it.unit_price || 0);
    let mkUnit = (mkBySku[sku] !== undefined) ? Number(mkBySku[sku]) : realUnit;
    if (isNaN(mkUnit) || mkUnit < 0) mkUnit = 0;
    if (mkUnit + 0.001 < realUnit) { console.error(`ERROR: markup ${mkUnit} < harga jual asli ${realUnit} pada ${p.name}`); await c.close(); process.exit(1); }
    const ratio = realUnit > 0 ? mkUnit / realUnit : 1;
    const cb = sub * (ratio - 1);
    cashback += cb;
    itemSets.push({ id: it.id, name: p.name, sku: p.sku, realUnit, mkUnit, weight: it.weight, cbLine: Math.round(cb) });
  }
  cashback = Math.round(cashback * 100) / 100;
  if (!(cashback > 0)) { console.error('ERROR: cashback tidak > 0 (harga markup harus lebih tinggi dari harga jual asli pada minimal 1 item)'); await c.close(); process.exit(1); }

  console.log(`SO ${SO_NUMBER} status=${so.pipeline_status} total(real)=${total}`);
  console.log(`Recipient: ${RECIPIENT || '(kosong → default nama pelanggan)'}   Account: ${acctName || '(kosong)'}`);
  itemSets.forEach(x => console.log(`  ${x.name} (${x.sku}): real ${x.realUnit} -> di-up ${x.mkUnit} /kg  x ${x.weight}kg  => cashback baris ${x.cbLine}`));
  console.log(`\n=> markup_enabled=1  real_amount=${total}  cashback_amount=${cashback}  (pelanggan ditagih ${total + cashback})`);

  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  fs.mkdirSync('/app/backups', { recursive: true });
  const bf = `/app/backups/MARKUP_${SO_NUMBER.replace(/\//g,'_')}_${ts}.json`;
  fs.writeFileSync(bf, JSON.stringify({ sales_order: so, sales_order_items: items }, null, 2));
  console.log('Backup ->', bf);

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to write.'); await c.close(); return; }

  for (const x of itemSets) await d.collection('sales_order_items').updateOne({ id: x.id }, { $set: { markup_unit_price: x.mkUnit } });
  await d.collection('sales_order').updateOne({ id: so.id }, { $set: {
    markup_enabled: 1,
    real_amount: total,
    cashback_amount: cashback,
    cashback_recipient: RECIPIENT || null,
    cashback_account: ACCOUNT || null,
    updated_at: Math.floor(Date.now()/1000),
  } });
  console.log('\n=== APPLIED === markup + cashback saved to MongoDB.');
  await c.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
