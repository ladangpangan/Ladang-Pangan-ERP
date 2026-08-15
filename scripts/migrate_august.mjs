// =====================================================================
// PILOT MIGRATION — AUGUST 2026 (Policy A: recognize on delivery)
// One-time, idempotent. Un-migrates Aug 2026 SO/PO so the ERP accounting
// engine auto-generates journals (revenue + COGS + purchase + payments).
// Opening Balance (31 Jul 2026) is NOT touched.
// Usage (cwd=/app so better-sqlite3 & uuid resolve):
//   node /root/odoo_mig/migrate_august.mjs parse   # dry-run
//   node /root/odoo_mig/migrate_august.mjs run     # apply + sync ledger
// =====================================================================
import fs from 'fs';
import readline from 'readline';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { syncLedger } from '/app/lib/accounting/engine.js';

const DUMP = '/root/odoo_mig/dump.sql';
const DB_PATH = '/app/data/erp.db';
const MODE = process.argv[2] || 'parse';
const AUG = '2026-08';

// ---------- pg_dump COPY parser ----------
function unescape(v) {
  if (v === '\\N') return null;
  if (v.indexOf('\\') === -1) return v;
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '\\' && i + 1 < v.length) {
      const n = v[++i];
      out += n === 't' ? '\t' : n === 'n' ? '\n' : n === 'r' ? '\r' : n === '\\' ? '\\' : n;
    } else out += c;
  }
  return out;
}
async function parseCopy(wantList) {
  const want = new Set(wantList);
  const out = {};
  const rl = readline.createInterface({ input: fs.createReadStream(DUMP), crlfDelay: Infinity });
  let cur = null, cols = null, wanted = false;
  const re = /^COPY public\.([a-zA-Z0-9_]+) \(([^)]*)\) FROM stdin;/;
  for await (const line of rl) {
    if (cur) {
      if (line === '\\.') { cur = null; cols = null; wanted = false; continue; }
      if (wanted) {
        const parts = line.split('\t');
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = unescape(parts[i] ?? '\\N');
        out[cur].rows.push(row);
      }
      continue;
    }
    const m = re.exec(line);
    if (m) {
      cur = m[1];
      cols = m[2].split(',').map((x) => x.trim());
      wanted = want.has(cur);
      if (wanted) out[cur] = { cols, rows: [] };
    }
  }
  return out;
}
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
function toSec(dstr) {
  if (!dstr) return null;
  const str = dstr.slice(0, 19).replace(' ', 'T') + 'Z';
  const t = Date.parse(str);
  return isFinite(t) ? Math.floor(t / 1000) : null;
}

async function buildOdoo() {
  const d = await parseCopy([
    'sale_order', 'sale_order_line', 'purchase_order', 'purchase_order_line',
    'stock_move', 'stock_valuation_layer', 'account_move',
  ]);
  // maps
  const soName = {}; for (const r of d.sale_order.rows) soName[r.id] = r.name;
  const lineOrder = {}; for (const r of d.sale_order_line.rows) lineOrder[r.id] = soName[r.order_id];
  const poName = {}; for (const r of d.purchase_order.rows) poName[r.id] = r.name;
  const plineOrder = {}; for (const r of d.purchase_order_line.rows) plineOrder[r.id] = poName[r.order_id];
  const smSaleLine = {}, smPurchLine = {};
  for (const r of d.stock_move.rows) { smSaleLine[r.id] = r.sale_line_id; smPurchLine[r.id] = r.purchase_line_id; }

  // COGS per SO name (outgoing svl linked to a sale line)
  const cogsBySo = {};
  for (const r of d.stock_valuation_layer.rows) {
    const smid = r.stock_move_id; if (!smid) continue;
    const sl = smSaleLine[smid]; if (!sl) continue;
    const order = lineOrder[sl]; if (!order) continue;
    const val = num(r.value);
    if (val < 0) cogsBySo[order] = (cogsBySo[order] || 0) + (-val);
  }

  // Invoice info per SO / PO from posted account_move
  const invBySo = {}, billByPo = {};
  for (const r of d.account_move.rows) {
    if (r.state !== 'posted') continue;
    const origin = r.invoice_origin; if (!origin) continue;
    if (r.move_type === 'out_invoice') {
      invBySo[origin] = { number: r.name, date: toSec(r.invoice_date || r.date), residual: num(r.amount_residual), total: num(r.amount_total) };
    } else if (r.move_type === 'in_invoice') {
      billByPo[origin] = { number: r.name, date: toSec(r.invoice_date || r.date), residual: num(r.amount_residual), total: num(r.amount_total) };
    }
  }
  return { cogsBySo, invBySo, billByPo };
}

function run(odoo, sqlite) {
  sqlite.pragma('busy_timeout = 8000');
  const augSO = sqlite.prepare(`SELECT * FROM sales_order WHERE strftime('%Y-%m', order_date, 'unixepoch')=?`).all(AUG);
  const augPO = sqlite.prepare(`SELECT * FROM purchase_order WHERE strftime('%Y-%m', order_date, 'unixepoch')=?`).all(AUG);

  const soItems = sqlite.prepare(`SELECT id, product_id, weight, subtotal FROM sales_order_items WHERE sales_order_id=?`);
  const log = [];

  const tx = sqlite.transaction(() => {
    // --- Sales Orders ---
    const updSO = sqlite.prepare(`UPDATE sales_order SET migrated=0, pipeline_status='Invoiced',
      invoice_number=@invoice_number, invoice_date=@invoice_date,
      paid_amount=@paid_amount, payment_status=@payment_status WHERE id=@id`);
    const delSIS = sqlite.prepare(`DELETE FROM so_item_stocks WHERE sales_order_id=?`);
    const insSIS = sqlite.prepare(`INSERT INTO so_item_stocks (id, sales_order_id, so_item_id, stock_id, product_id, kode_simpan, weight, quantity, hpp_per_kg, created_at)
      VALUES (?,?,?,?,?,?,?,?,?, unixepoch())`);
    const delSPAY = sqlite.prepare(`DELETE FROM sales_payments WHERE sales_order_id=?`);
    const insSPAY = sqlite.prepare(`INSERT INTO sales_payments (id, sales_order_id, payment_date, amount, method, reference, is_dp, notes, created_by, created_at)
      VALUES (?,?,?,?,?,?,0,?,?, unixepoch())`);

    for (const so of augSO) {
      const cogs = Math.round((odoo.cogsBySo[so.so_number] || 0) * 100) / 100;
      const inv = odoo.invBySo[so.so_number];
      // S00204 in Odoo is an out_refund (credit note), not a normal invoice -> treat as normal delivered sale, unpaid.
      const invoicedPaid = inv && inv.residual <= 0.009 && inv.total > 0; // fully-paid customer invoice
      const invoice_number = inv && inv.total > 0 ? inv.number : null;
      const invoice_date = inv && inv.total > 0 ? inv.date : null;
      const paid_amount = invoicedPaid ? Math.round(so.total_amount * 100) / 100 : 0;
      const payment_status = invoicedPaid ? 'paid' : 'unpaid';
      updSO.run({ id: so.id, invoice_number, invoice_date, paid_amount, payment_status });

      // COGS via one so_item_stocks row linked to first item
      delSIS.run(so.id);
      if (cogs > 0) {
        const items = soItems.all(so.id);
        const first = items[0];
        insSIS.run(randomUUID(), so.id, first ? first.id : so.id, `odoo-aug-${so.so_number}`,
          first ? first.product_id : (items[0]?.product_id || 'unknown'), null, 1, 0, cogs);
      }
      // Payment (only fully-paid Odoo invoices)
      delSPAY.run(so.id);
      if (invoicedPaid) {
        insSPAY.run(randomUUID(), so.id, invoice_date || so.order_date, Math.round(so.total_amount * 100) / 100,
          'Transfer', invoice_number, 'Pelunasan (Odoo Aug import)', 'odoo-import');
      }
      log.push(`SO ${so.so_number}: total=${so.total_amount} cogs=${cogs} inv=${invoice_number || '-'} paid=${paid_amount}`);
    }

    // --- Purchase Orders ---
    const updPO = sqlite.prepare(`UPDATE purchase_order SET migrated=0, pipeline_status='Selesai',
      invoice_number=@invoice_number, invoice_date=@invoice_date, paid_amount=0, payment_status='unpaid' WHERE id=@id`);
    const delPPAY = sqlite.prepare(`DELETE FROM purchase_payments WHERE purchase_order_id=?`);
    for (const po of augPO) {
      const bill = odoo.billByPo[po.po_number];
      const invoice_number = bill ? bill.number : null;
      const invoice_date = bill ? bill.date : null;
      updPO.run({ id: po.id, invoice_number, invoice_date });
      delPPAY.run(po.id);
      log.push(`PO ${po.po_number}: total=${po.total_amount} bill=${invoice_number || '-'} (unpaid per Odoo)`);
    }
  });
  tx();
  return { augSO: augSO.length, augPO: augPO.length, log };
}

(async () => {
  console.log('Parsing Odoo dump (this takes ~1 min)...');
  const odoo = await buildOdoo();
  const cogsCount = Object.keys(odoo.cogsBySo).length;
  console.log(`Parsed: COGS entries=${cogsCount}, customer invoices=${Object.keys(odoo.invBySo).length}, supplier bills=${Object.keys(odoo.billByPo).length}`);

  const sqlite = new Database(DB_PATH);
  const augSO = sqlite.prepare(`SELECT so_number, total_amount FROM sales_order WHERE strftime('%Y-%m', order_date, 'unixepoch')=?`).all(AUG);
  console.log(`\nAug SO in ERP: ${augSO.length}, Aug PO in ERP: ${sqlite.prepare(`SELECT COUNT(*) c FROM purchase_order WHERE strftime('%Y-%m', order_date, 'unixepoch')=?`).get(AUG).c}`);
  let totRev = 0, totCogs = 0;
  for (const so of augSO) { totRev += so.total_amount; totCogs += (odoo.cogsBySo[so.so_number] || 0); }
  console.log(`Projected Aug: Revenue=${totRev.toLocaleString('id-ID')}, COGS=${Math.round(totCogs).toLocaleString('id-ID')}, GrossProfit=${Math.round(totRev - totCogs).toLocaleString('id-ID')}`);

  if (MODE === 'run') {
    const res = run(odoo, sqlite);
    console.log(`\nUpdated ${res.augSO} SOs and ${res.augPO} POs.`);
    console.log('Running syncLedger...');
    const sync = syncLedger(sqlite, { createdBy: 'odoo-import' });
    console.log('syncLedger:', JSON.stringify(sync));
    const jc = sqlite.prepare(`SELECT COUNT(*) c FROM journal_entries`).get().c;
    const jbySrc = sqlite.prepare(`SELECT source_type, COUNT(*) c FROM journal_entries GROUP BY source_type ORDER BY source_type`).all();
    console.log('journal_entries total:', jc, JSON.stringify(jbySrc));
    console.log('\nDONE.');
  } else {
    console.log('\n(parse-only; no DB changes) — run with "run" to apply.');
  }
  sqlite.close();
})();
