// One-off maintenance: mirror Invoice numbers to their SO numbers (INV = SO with prefix swapped),
// and DIAGNOSE Purchase Orders whose po_number month != order_date month.
// Usage: node scripts/renumber_invoices.js            (dry-run: report only)
//        node scripts/renumber_invoices.js --apply     (write changes to MongoDB)
// Backs up sales_order {id, so_number, invoice_number} + purchase_order {id, po_number, order_date}
// to /app/backups before applying.
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// --- parse /app/.env for connection vars (standalone node has no Next env loading) ---
function parseEnv(file) {
  const out = {};
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); out[m[1]] = v; }
    }
  } catch (e) { /* ignore */ }
  return out;
}
const env = { ...parseEnv('/app/.env'), ...process.env };
const MONGO_URL = env.ATLAS_MONGO_URL || env.MONGO_URL || 'mongodb://localhost:27017';
function dbNameFromUrl(url) { try { const m = String(url).match(/\/([^/?]+)(\?|$)/); return m ? m[1] : null; } catch { return null; } }
const DB_NAME = env.MONGO_DB_NAME || env.DB_NAME || dbNameFromUrl(MONGO_URL) || 'test';
const APPLY = process.argv.includes('--apply');

function monthPrefixFromSeconds(sec) {
  const d = new Date(Number(sec) * 1000);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

(async () => {
  const client = new MongoClient(MONGO_URL, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`Connected db="${db.databaseName}" apply=${APPLY}`);

  const sos = await db.collection('sales_order').find({}, { projection: { _id: 0, id: 1, so_number: 1, invoice_number: 1 } }).toArray();
  const pos = await db.collection('purchase_order').find({}, { projection: { _id: 0, id: 1, po_number: 1, order_date: 1 } }).toArray();

  // backup
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync('/app/backups', { recursive: true });
  const backupFile = `/app/backups/inv_renumber_backup_${ts}.json`;
  fs.writeFileSync(backupFile, JSON.stringify({ sales_order: sos, purchase_order: pos }, null, 2));
  console.log(`Backup -> ${backupFile}  (SO=${sos.length}, PO=${pos.length})`);

  // ---- INVOICE mirror ----
  const invChanges = [];
  for (const so of sos) {
    if (!so.invoice_number) continue; // only invoiced SOs
    if (!so.so_number || !/^SO\//.test(so.so_number)) continue;
    const mirror = so.so_number.replace(/^SO\//, 'INV/');
    if (mirror !== so.invoice_number) invChanges.push({ id: so.id, so: so.so_number, from: so.invoice_number, to: mirror });
  }
  // collision check (mirror should be unique because so_number is unique)
  const mirrorSet = new Set(invChanges.map(c => c.to));
  console.log(`\n=== INVOICE mirror: ${invChanges.length} to change (of ${sos.filter(s => s.invoice_number).length} invoiced) ===`);
  for (const c of invChanges.slice(0, 50)) console.log(`  ${c.so}: ${c.from} -> ${c.to}`);
  if (invChanges.length > 50) console.log(`  ... (+${invChanges.length - 50} more)`);
  if (mirrorSet.size !== invChanges.length) console.log('  WARNING: duplicate target invoice numbers detected!');

  // ---- PO month diagnostic ----
  const poMismatch = [];
  for (const po of pos) {
    if (!po.po_number || !/^PO\/(\d{6})\//.test(po.po_number)) continue;
    const cur = po.po_number.match(/^PO\/(\d{6})\//)[1];
    const want = monthPrefixFromSeconds(po.order_date);
    if (want && want !== cur) poMismatch.push({ id: po.id, po: po.po_number, curMonth: cur, orderMonth: want });
  }
  console.log(`\n=== PO month mismatch (po_number month != order_date month): ${poMismatch.length} ===`);
  for (const p of poMismatch.slice(0, 50)) console.log(`  ${p.po}  curMonth=${p.curMonth} orderMonth=${p.orderMonth}`);

  if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to write invoice changes.'); await client.close(); return; }

  // apply invoice changes
  let done = 0;
  for (const c of invChanges) {
    await db.collection('sales_order').updateOne({ id: c.id }, { $set: { invoice_number: c.to } });
    done++;
  }
  console.log(`\nAPPLIED invoice mirror: ${done} updated.`);
  console.log(`PO mismatches were REPORTED only (not modified) — see list above.`);
  await client.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
