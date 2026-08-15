// =====================================================================
// PHASE 2 — PHYSICAL INVENTORY RECONSTRUCTION (AUGUST 2026) from manual recap
// Policy: physical-first (2b). Recap (Google Sheet) = source of truth for stock qty/kg.
// - Updates per-product inventory_stock lots to recap end-of-August on-hand (kg + colly)
// - Records August movement ledger (IN=produksi, OUT=SO, TRANSFER_CS=transfer) for the stock card
// - Does NOT change the accounting journals (kept from the August accounting pilot)
// Idempotent. Usage (cwd=/app):
//   node scripts/reconstruct_inventory_august.mjs validate
//   node scripts/reconstruct_inventory_august.mjs run
// =====================================================================
import fs from 'fs';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

const DB_PATH = '/app/data/erp.db';
const DATA = JSON.parse(fs.readFileSync('/root/odoo_mig/sheet_data.json', 'utf8'));
// normalize: support both old ({balance:{end_kg}}) and new ({balance_full:{net_kg}}) formats
const BAL = DATA.balance_full || DATA.balance;
const getEndKg = (b) => (b.net_kg !== undefined ? b.net_kg : b.end_kg);
const getEndColly = (b) => (b.net_colly !== undefined ? b.net_colly : b.end_colly);
const MODE = process.argv[2] || 'validate';

// sheet product name -> ERP SKU
const ALIAS = {
  'BLD-01': 'BLD-01', 'BLD-02': 'BLD-02', 'BLP-01': 'BLP-01', 'BLPK': 'BLPK-01',
  'Brankas 1,2': 'AYAM UTUH-12', 'Ceker': 'CKR-01',
  'Karkas 0,6': 'KRK-06', 'Karkas 0,7': 'KRK-07', 'Karkas 0,8': 'KRK-08', 'Karkas 0,9': 'KRK-09',
  'Karkas 1,0': 'KRK-10', 'Karkas 1,1': 'KRK-11', 'Karkas 1,2': 'KRK-12', 'Karkas 1,3': 'KRK-13',
  'Karkas 1,4': 'KRK-14', 'Karkas 1,5': 'KRK-15', 'Karkas 1,6': 'KRK-16',
  'Kepala Leher': 'KPL-01', 'Kerongkong': 'KRG-01', 'Kulit Dada': 'KLD-01', 'Kulit Paha': 'KLP-01',
  'Parting 1,0': 'CUT-10', 'Parting 1,0 - PM': 'CUT-10-PM', 'Parting 1,1': 'CUT-11', 'Parting 1,2': 'CUT-12',
  'Sayap - 01': 'SYP-01', 'Sayap - 02': 'SYP-02', 'TLP': 'TLP-01', 'Trimming Paha': 'TRM-01', 'Tunggir': 'TGR-01',
};

// sheet SO 'SO202'/'SM221' -> ERP so_number 'S00202'
function soNumberOf(so) {
  if (!so || so === 'TRANSFER') return null;
  const m = String(so).match(/(\d+)/);
  if (!m) return null;
  return 'S' + m[1].padStart(5, '0');
}
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const toSec = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 8000');

// build SKU -> product
const prods = db.prepare('SELECT id, name, sku FROM products').all();
const bySku = {}; for (const p of prods) bySku[p.sku] = p;
function prodOf(sheetName) {
  const sku = ALIAS[sheetName];
  return sku ? bySku[sku] : null;
}

// ---- validate mapping ----
const balProducts = Object.keys(BAL);
const allSheetProducts = new Set([...balProducts, ...DATA.inbound.map((i) => i.product), ...DATA.outbound.map((o) => o.product)]);
const unmapped = [...allSheetProducts].filter((p) => !prodOf(p));
console.log('Sheet products:', allSheetProducts.size, '| unmapped:', unmapped.length, unmapped);

// ERP active lots per product
const activeLots = db.prepare("SELECT s.id, s.product_id, s.kode_simpan, s.weight, s.quantity, s.hpp_per_kg, p.sku, p.name FROM inventory_stock s JOIN products p ON p.id=s.product_id WHERE s.status='active' AND s.archived_at IS NULL").all();
const lotBySku = {}; for (const l of activeLots) lotBySku[l.sku] = l;

console.log('\n=== TARGET end-Aug on-hand per product (recap) vs current ERP lot ===');
let tgtTot = 0, curTot = 0;
for (const sheetName of balProducts) {
  const p = prodOf(sheetName); if (!p) continue;
  const b = BAL[sheetName];
  const cur = lotBySku[p.sku];
  tgtTot += getEndKg(b); curTot += cur ? cur.weight : 0;
  const flag = cur ? '' : '  <== NEW LOT';
  console.log(`  ${sheetName.padEnd(18)} sku=${p.sku.padEnd(12)} recapEnd=${getEndKg(b).toFixed(2).padStart(9)} kg | curERP=${(cur ? cur.weight : 0).toFixed(2).padStart(9)}${flag}`);
}
console.log(`  TOTAL recapEnd=${tgtTot.toFixed(2)} kg | curERP=${curTot.toFixed(2)} kg`);

const augIn = DATA.inbound.filter((i) => i.ym === '2026-08');
const augOut = DATA.outbound.filter((o) => o.ym === '2026-08');
console.log(`\nAug inbound rows=${augIn.length} outbound rows=${augOut.length} (transfer=${augOut.filter((o) => o.is_transfer).length})`);

if (MODE !== 'run') { console.log('\n(validate only — no changes). Run with "run" to apply.'); db.close(); process.exit(0); }
if (unmapped.length) { console.error('ABORT: unmapped products exist.'); db.close(); process.exit(1); }

// ---- APPLY ----
const now = Math.floor(Date.now() / 1000);
const csRow = db.prepare("SELECT id, name FROM cold_storages WHERE status='active' ORDER BY created_at LIMIT 1").get();
const CS_ID = csRow.id;
const defaultZone = db.prepare('SELECT id FROM zones WHERE cold_storage_id=? ORDER BY created_at LIMIT 1').get(CS_ID)?.id || null;

const tx = db.transaction(() => {
  // rename cold storage to match sheet
  db.prepare("UPDATE cold_storages SET name='CS Surabaya' WHERE id=?").run(CS_ID);

  // create zones for distinct pallete codes (idempotent)
  const palletes = new Set();
  for (const i of DATA.inbound) if (i.pallete) palletes.add(i.pallete);
  for (const o of DATA.outbound) if (o.pallete) palletes.add(o.pallete);
  const zoneByCode = {};
  for (const z of db.prepare('SELECT id, code FROM zones WHERE cold_storage_id=?').all(CS_ID)) zoneByCode[z.code] = z.id;
  const insZone = db.prepare('INSERT INTO zones (id, cold_storage_id, code, name, status, created_at, updated_at) VALUES (?,?,?,?,\'active\',?,?)');
  for (const code of palletes) {
    if (!zoneByCode[code]) { const zid = randomUUID(); insZone.run(zid, CS_ID, code, `Pallet ${code}`, now, now); zoneByCode[code] = zid; }
  }

  // update / create per-product lots to recap end-of-August
  const updLot = db.prepare('UPDATE inventory_stock SET weight=?, quantity=?, cold_storage_id=?, updated_at=? WHERE id=?');
  const insLot = db.prepare(`INSERT INTO inventory_stock (id, product_id, cold_storage_id, zone_id, kode_simpan, quantity, weight, status, source_type, hpp_per_kg, packaging_type, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?, 'active', 'RECAP_AUG', ?, 'karung', ?, ?)`);
  const archiveLot = db.prepare("UPDATE inventory_stock SET status='out', weight=0, quantity=0, archived_at=?, updated_at=? WHERE id=?");
  const handledSku = new Set();
  for (const sheetName of balProducts) {
    const p = prodOf(sheetName); if (!p) continue;
    const b = BAL[sheetName];
    handledSku.add(p.sku);
    const cur = lotBySku[p.sku];
    const endKg = r2(Math.max(0, getEndKg(b)));
    const endColly = Math.max(0, Math.round(getEndColly(b)));
    if (cur) updLot.run(endKg, endColly, CS_ID, now, cur.id);
    else insLot.run(randomUUID(), p.id, CS_ID, defaultZone, `CS-${p.sku}`, endColly, endKg, 0, now, now);
  }
  // any active lot whose product not in recap -> leave as-is (none expected)

  // clear previous reconstruction ledger, then insert August movement ledger
  db.prepare("DELETE FROM inventory_transaction WHERE tx_number LIKE 'RCP-%'").run();
  const insTx = db.prepare(`INSERT INTO inventory_transaction
    (id, transaction_date, transaction_type, reference_id, reference_type, notes, created_by, created_at, tx_number, from_cold_storage_id, to_cold_storage_id, from_zone_id, to_zone_id, total_weight, total_quantity, status)
    VALUES (@id,@date,@type,@ref_id,@ref_type,@notes,'odoo-import',@created,@txn,@from_cs,@to_cs,@from_z,@to_z,@w,@q,'confirmed')`);
  let seq = 0;
  const nextTxn = () => 'RCP-' + String(++seq).padStart(5, '0');

  // inbound (production)
  for (const i of augIn) {
    const p = prodOf(i.product); if (!p) continue;
    insTx.run({ id: randomUUID(), date: toSec(i.date), type: 'IN', ref_id: null, ref_type: 'WO',
      notes: `Produksi ${i.kode_produksi || ''} | ${p.sku} | colly ${i.kode || ''}`.trim(),
      created: now, txn: nextTxn(), from_cs: null, to_cs: CS_ID, from_z: null, to_z: (i.pallete && zoneByCode[i.pallete]) || defaultZone,
      w: r2(Math.abs(i.weight)), q: Math.abs(i.colly) });
  }
  // outbound (sales + transfer)
  const soIdByNumber = {};
  for (const r of db.prepare("SELECT id, so_number FROM sales_order").all()) soIdByNumber[r.so_number] = r.id;
  let linkedSO = 0, tfCount = 0;
  for (const o of augOut) {
    const p = prodOf(o.product); if (!p) continue;
    if (o.is_transfer) {
      tfCount++;
      insTx.run({ id: randomUUID(), date: toSec(o.date), type: 'TRANSFER_CS', ref_id: null, ref_type: 'TRANSFER',
        notes: `Transfer internal | ${p.sku} | colly ${o.kode || ''}`.trim(), created: now, txn: nextTxn(),
        from_cs: CS_ID, to_cs: null, from_z: (o.pallete && zoneByCode[o.pallete]) || defaultZone, to_z: null,
        w: r2(Math.abs(o.weight)), q: Math.abs(o.colly) });
    } else {
      const erpNo = soNumberOf(o.so);
      const soId = erpNo ? soIdByNumber[erpNo] : null;
      if (soId) linkedSO++;
      insTx.run({ id: randomUUID(), date: toSec(o.date), type: 'OUT', ref_id: soId, ref_type: 'SO',
        notes: `Penjualan ${o.so || ''}${o.customer ? ' - ' + o.customer : ''} | ${p.sku} | colly ${o.kode || ''}`.trim(),
        created: now, txn: nextTxn(), from_cs: CS_ID, to_cs: null, from_z: (o.pallete && zoneByCode[o.pallete]) || defaultZone, to_z: null,
        w: r2(Math.abs(o.weight)), q: Math.abs(o.colly) });
    }
  }
  return { zones: palletes.size, inbound: augIn.length, outbound: augOut.length, tfCount, linkedSO };
});

const res = tx();
console.log('\n=== APPLIED ===', JSON.stringify(res));

// verify
const after = db.prepare("SELECT p.sku, s.weight FROM inventory_stock s JOIN products p ON p.id=s.product_id WHERE s.status='active' AND s.archived_at IS NULL").all();
const afterBySku = {}; for (const a of after) afterBySku[a.sku] = (afterBySku[a.sku] || 0) + a.weight;
let ok = 0, bad = 0;
for (const sheetName of balProducts) {
  const p = prodOf(sheetName); if (!p) continue;
  const tgt = r2(Math.max(0, getEndKg(BAL[sheetName])));
  const got = r2(afterBySku[p.sku] || 0);
  if (Math.abs(tgt - got) < 0.5) ok++; else { bad++; console.log(`  MISMATCH ${p.sku}: target=${tgt} got=${got}`); }
}
const totActive = db.prepare("SELECT COUNT(*) c, SUM(weight) w FROM inventory_stock WHERE status='active' AND archived_at IS NULL").get();
const totTx = db.prepare("SELECT COUNT(*) c FROM inventory_transaction WHERE tx_number LIKE 'RCP-%'").get();
console.log(`Verify: products matched=${ok}, mismatched=${bad}`);
console.log(`Active lots=${totActive.c}, total on-hand=${totActive.w?.toFixed(2)} kg | ledger tx=${totTx.c}`);
db.close();
