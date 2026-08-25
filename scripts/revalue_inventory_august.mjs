// =====================================================================
// PHASE 2b — INVENTORY REVALUATION (align physical value to GL Persediaan)
// Scales each active lot's hpp_per_kg proportionally so that
//   SUM(weight * hpp_per_kg) == GL Persediaan (as-of 2026-08-31).
// Preserves relative per-product cost. Does NOT touch accounting journals.
// Idempotent. Usage (cwd=/app): node scripts/revalue_inventory_august.mjs [run]
// =====================================================================
import Database from 'better-sqlite3';
import * as acct from '/app/lib/accounting/engine.js';

const DB_PATH = '/app/data/erp.db';
const MODE = process.argv[2] || 'validate';
const AUG_TO = Math.floor(Date.UTC(2026, 7, 31, 23, 59, 59) / 1000);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 8000');

// GL Persediaan as-of Aug 31
const bs = acct.balanceSheet(db, { asOf: AUG_TO });
let persediaanGL = 0;
for (const g of bs.assets.groups) for (const it of g.items) if (it.code === '1-1300') persediaanGL = it.amount;
persediaanGL = r2(persediaanGL);

const lots = db.prepare("SELECT id, weight, hpp_per_kg FROM inventory_stock WHERE status='active' AND archived_at IS NULL").all();
const curValue = r2(lots.reduce((s, l) => s + l.weight * l.hpp_per_kg, 0));
const factor = curValue > 0 ? persediaanGL / curValue : 1;

console.log('GL Persediaan (1-1300) as-of 2026-08-31 :', persediaanGL.toLocaleString('id-ID'));
console.log('Current physical inventory value        :', curValue.toLocaleString('id-ID'));
console.log('Active lots                             :', lots.length);
console.log('Scale factor                            :', factor.toFixed(6));

if (MODE !== 'run') { console.log('\n(validate only — no changes). Run with "run" to apply.'); db.close(); process.exit(0); }

const upd = db.prepare('UPDATE inventory_stock SET hpp_per_kg=?, updated_at=unixepoch() WHERE id=?');
const tx = db.transaction(() => {
  let running = 0;
  const scaled = lots.map((l) => ({ id: l.id, weight: l.weight, newHpp: r2(l.hpp_per_kg * factor) }));
  for (const s of scaled) { upd.run(s.newHpp, s.id); running = r2(running + s.weight * s.newHpp); }
  // absorb rounding residual into the largest-value lot so total == persediaanGL exactly
  const residual = r2(persediaanGL - running);
  if (Math.abs(residual) >= 0.01) {
    const big = scaled.slice().sort((a, b) => b.weight * b.newHpp - a.weight * a.newHpp)[0];
    if (big && big.weight > 0) {
      const adjHpp = r2(big.newHpp + residual / big.weight);
      upd.run(adjHpp, big.id);
    }
  }
});
tx();

const after = db.prepare("SELECT ROUND(SUM(weight*hpp_per_kg),2) v, ROUND(SUM(weight),2) w, COUNT(*) c FROM inventory_stock WHERE status='active' AND archived_at IS NULL").get();
console.log('\n=== AFTER REVALUATION ===');
console.log('Physical inventory value:', after.v.toLocaleString('id-ID'), '| weight:', after.w, 'kg | lots:', after.c);
console.log('Matches GL Persediaan?  :', Math.abs(after.v - persediaanGL) < 1);
db.close();
