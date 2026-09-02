// One-off maintenance: for POs auto-created from Dropship SOs, make them consistent with the SO:
//   - po_number MIRRORS so_number (SO/YYYYMM/NNNN -> PO/YYYYMM/NNNN), collision-safe
//   - order_date = SO order_date, expected_date = SO expected_date
//   - auto GRN (notes = 'AUTO-SJ:<soId>') received_date = SO received date
//       (sales_order_receipts.received_date latest, else surat_jalan.delivery_date latest)
// Usage: node scripts/fix_dropship_po.js            (dry-run: report only)
//        node scripts/fix_dropship_po.js --apply     (write changes)
const fs = require('fs');
const { MongoClient } = require('mongodb');

function parseEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); out[m[1]] = v; }
    }
  } catch { /* ignore */ }
  return out;
}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL || 'mongodb://localhost:27017';
function dbNameFromUrl(url) { try { const m = String(url).match(/\/([^/?]+)(\?|$)/); return m ? m[1] : null; } catch { return null; } }
const DB_NAME = env.MONGO_DB_NAME || env.DB_NAME || dbNameFromUrl(MONGO_URL) || 'test';
const APPLY = process.argv.includes('--apply');
const fmt = (sec) => sec ? new Date(Number(sec) * 1000).toISOString().slice(0, 10) : '-';

(async () => {
  const client = new MongoClient(MONGO_URL, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`Connected db="${db.databaseName}" apply=${APPLY}`);

  const sos = await db.collection('sales_order').find({ fulfillment_type: 'dropship' }).toArray();
  const pos = await db.collection('purchase_order').find({}).toArray();
  const grns = await db.collection('grn').find({}).toArray();
  const receipts = await db.collection('sales_order_receipts').find({}).toArray();
  const sjs = await db.collection('surat_jalan').find({}).toArray();
  const poById = Object.fromEntries(pos.map(p => [p.id, p]));
  const poNumSet = new Set(pos.map(p => p.po_number));

  const latestBy = (arr, soKey, dateKey) => {
    const map = {};
    for (const r of arr) { const k = r[soKey]; if (!k) continue; const d = Number(r[dateKey] || 0); if (!(k in map) || d > map[k]) map[k] = d; }
    return map;
  };
  const recvBySo = latestBy(receipts, 'sales_order_id', 'received_date');
  const sjBySo = latestBy(sjs, 'sales_order_id', 'delivery_date');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync('/app/backups', { recursive: true });
  const backupFile = `/app/backups/dropship_po_backup_${ts}.json`;
  fs.writeFileSync(backupFile, JSON.stringify({ purchase_order: pos, grn: grns }, null, 2));
  console.log(`Backup -> ${backupFile} (dropshipSO=${sos.length}, PO=${pos.length}, GRN=${grns.length})\n`);

  const poUpdates = [], grnUpdates = [];
  for (const so of sos) {
    if (!so.auto_po_id) continue;
    const po = poById[so.auto_po_id];
    if (!po) { console.log(`  [skip] SO ${so.so_number}: linked PO ${so.auto_po_id} not found`); continue; }
    const set = {};
    // mirror number
    if (so.so_number && /^SO\//.test(so.so_number)) {
      const mirror = so.so_number.replace(/^SO\//, 'PO/');
      if (po.po_number !== mirror) {
        if (poNumSet.has(mirror)) console.log(`  [warn] SO ${so.so_number}: target ${mirror} already used, keep ${po.po_number}`);
        else { set.po_number = mirror; poNumSet.delete(po.po_number); poNumSet.add(mirror); }
      }
    }
    // dates
    if (so.order_date != null && po.order_date !== so.order_date) set.order_date = so.order_date;
    if ((so.expected_date ?? null) !== (po.expected_date ?? null)) set.expected_date = so.expected_date ?? null;
    if (Object.keys(set).length) poUpdates.push({ id: po.id, from: { po: po.po_number, order: fmt(po.order_date), exp: fmt(po.expected_date) }, set, soNum: so.so_number });

    // auto GRN received date
    const recv = recvBySo[so.id] || sjBySo[so.id] || null;
    if (recv) {
      const tag = `AUTO-SJ:${so.id}`;
      for (const g of grns.filter(x => x.purchase_order_id === po.id && x.notes === tag)) {
        if (g.received_date !== recv) grnUpdates.push({ id: g.id, from: fmt(g.received_date), to: fmt(recv), recv, soNum: so.so_number });
      }
    }
  }

  console.log(`=== PO updates: ${poUpdates.length} ===`);
  for (const u of poUpdates) console.log(`  ${u.soNum}: ${JSON.stringify(u.from)} => ${JSON.stringify({ ...u.set, order_date: u.set.order_date ? fmt(u.set.order_date) : undefined, expected_date: u.set.expected_date ? fmt(u.set.expected_date) : undefined })}`);
  console.log(`\n=== Auto-GRN received_date updates: ${grnUpdates.length} ===`);
  for (const g of grnUpdates) console.log(`  ${g.soNum}: received ${g.from} -> ${g.to}`);

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to write changes.'); await client.close(); return; }

  for (const u of poUpdates) await db.collection('purchase_order').updateOne({ id: u.id }, { $set: u.set });
  for (const g of grnUpdates) await db.collection('grn').updateOne({ id: g.id }, { $set: { received_date: g.recv } });
  console.log(`\nAPPLIED: ${poUpdates.length} PO, ${grnUpdates.length} GRN updated.`);
  await client.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
