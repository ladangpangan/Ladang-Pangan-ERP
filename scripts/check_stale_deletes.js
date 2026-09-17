// READ-ONLY diagnostic: checks whether SO/PO records that were "deleted" by the old
// scripts/delete_so_po.js (which writes to MongoDB collections) still linger in the LIVE SQLite
// database. Purchase Order data is SQLite-only in the current app (no Mongo mirror exists for
// it — see backups/DELETE_SOPO_*.json for the ids checked here), so if delete_so_po.js was ever
// run against a Mongo `purchase_order` collection the app doesn't actually read, the PO could
// still be sitting in SQLite even though the script reported it "DELETED".
//
// Makes NO changes to any database. Safe to run any time.
// Usage: node scripts/check_stale_deletes.js
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function parseEnv(f) {
  const o = {};
  try {
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) { let v = m[2].trim(); if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1); o[m[1]] = v; }
    }
  } catch {}
  return o;
}
const env = { ...parseEnv(path.join(process.cwd(), '.env')), ...process.env };
const DB_PATH = env.DB_PATH || '/app/data/erp.db';

// Known SO+PO id pairs from backups/DELETE_SOPO_*.json (the 3 documents the old script reported
// as fully deleted). Add more pairs here if other delete/rollback backups exist.
const CHECKS = [
  { soNumber: 'SO/202608/0021', soId: '7db66d75-e019-4e5e-bd9d-a9a04a98b6d4', poNumber: 'PO/202608/0021', poId: '8d54a03b-40a1-44d7-8fa0-c104209d792a' },
  { soNumber: 'SO/202608/0028', soId: '5e15c756-8077-41a2-8c8d-5334dfe4a4a8', poNumber: 'PO/202608/0028', poId: '7dbf5096-f4b6-4c75-9600-ec679f505f72' },
  { soNumber: 'SO/202608/0029', soId: '5deaafc5-453f-4bfe-8df6-4d062c69af28', poNumber: 'PO/202608/0029', poId: 'ce0460f6-f603-4b4e-ae90-45b30866b39b' },
];

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

function existsById(table, id) {
  try {
    const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
    return !!row;
  } catch (e) {
    return `error: ${e.message}`;
  }
}

console.log(`Checking against local SQLite: ${DB_PATH}\n`);
let anyStale = false;
for (const c of CHECKS) {
  const soLingers = existsById('sales_order', c.soId);
  const poLingers = existsById('purchase_order', c.poId);
  console.log(`${c.soNumber} / ${c.poNumber}`);
  console.log(`  sales_order row still present?    ${soLingers}`);
  console.log(`  purchase_order row still present? ${poLingers}`);
  if (soLingers === true || poLingers === true) anyStale = true;
}
db.close();

console.log('\n' + (anyStale
  ? 'FOUND stale rows still in SQLite despite the old script reporting them deleted (see above).'
  : 'No stale rows found for these 3 known cases — SQLite is clean for them.'));
