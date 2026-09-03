// Repair orphaned stock allocations caused by the edit-draft-items bug:
//  - SO/202608/0035: delete its orphaned so_item_stocks (item.stock_code_id already null) and free lots.
//  - Global safety sweep: any inventory_stock with status='allocated' that is NOT referenced by ANY
//    so_item_stocks row is truly orphaned -> set back to 'active'.
// Usage: node scripts/repair_orphan_alloc.js            (dry-run)
//        node scripts/repair_orphan_alloc.js --apply
const fs = require('fs');
const { MongoClient } = require('mongodb');
function parseEnv(f){const o={};try{for(const l of fs.readFileSync(f,'utf8').split('\n')){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m){let v=m[2].trim();if((v[0]==='"'&&v.endsWith('"'))||(v[0]==="'"&&v.endsWith("'")))v=v.slice(1,-1);o[m[1]]=v;}}}catch{}return o;}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL;
const DB_NAME = env.MONGO_DB_NAME || (String(MONGO_URL).match(/\/([^/?]+)(\?|$)/)||[])[1];
const APPLY = process.argv.includes('--apply');

(async () => {
  const c = new MongoClient(MONGO_URL); await c.connect(); const d = c.db(DB_NAME);
  const ts = new Date().toISOString().replace(/[:.]/g,'-');
  fs.mkdirSync('/app/backups', { recursive: true });

  // ---- 1) SO/202608/0035 orphaned so_item_stocks ----
  const so = await d.collection('sales_order').findOne({ so_number: 'SO/202608/0035' });
  let so35sis = [];
  if (so) {
    so35sis = await d.collection('so_item_stocks').find({ sales_order_id: so.id }).toArray();
    const items = await d.collection('sales_order_items').find({ sales_order_id: so.id }).toArray();
    const activeStockCodes = new Set(items.map(i => i.stock_code_id).filter(Boolean));
    console.log(`SO/0035 status=${so.pipeline_status} item.stock_code_id set=[${[...activeStockCodes].join(',')}]`);
    console.log(`SO/0035 so_item_stocks (orphan candidates): ${so35sis.length} -> ${so35sis.map(s=>s.kode_simpan).join(', ')}`);
  } else { console.log('SO/202608/0035 not found'); }

  // ---- 2) Global: allocated lots with NO so_item_stocks reference ----
  const allAlloc = await d.collection('inventory_stock').find({ status: 'allocated' }).toArray();
  const refCounts = {};
  for (const st of allAlloc) refCounts[st.id] = await d.collection('so_item_stocks').countDocuments({ stock_id: st.id });
  // For the global sweep we must account for SO/0035 rows being deleted in this run:
  const so35StockIds = new Set(so35sis.map(x => x.stock_id));
  const orphanLots = allAlloc.filter(st => {
    let refs = refCounts[st.id];
    // subtract SO/0035 references we are about to delete
    const in35 = so35sis.filter(x => x.stock_id === st.id).length;
    refs -= in35;
    return refs <= 0;
  });
  console.log(`\nGlobal allocated lots=${allAlloc.length}; will free (no remaining ref)=${orphanLots.length}`);
  for (const l of orphanLots) console.log(`   free -> ${l.kode_simpan} (${l.weight}kg)`);

  fs.writeFileSync(`/app/backups/repair_orphan_${ts}.json`, JSON.stringify({ so35_so_item_stocks: so35sis, orphanLots: orphanLots.map(l=>({id:l.id,kode:l.kode_simpan,status:l.status})) }, null, 2));

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply.'); await c.close(); return; }

  if (so && so35sis.length) await d.collection('so_item_stocks').deleteMany({ sales_order_id: so.id });
  let freed = 0;
  for (const l of orphanLots) { const r = await d.collection('inventory_stock').updateOne({ id: l.id, status: 'allocated' }, { $set: { status: 'active', updated_at: Math.floor(Date.now()/1000) } }); freed += r.modifiedCount; }
  console.log(`\nAPPLIED: deleted SO/0035 so_item_stocks=${so35sis.length}; lots freed to active=${freed}.`);
  await c.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
