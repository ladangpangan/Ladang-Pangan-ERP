// One-time Odoo 18 -> ERP (SQLite) migration.
//   PHASE 1: master data (Contacts + Products)
//   PHASE 2: opening stock (from stock_valuation_layer) + opening balances (as of 31-07-2026)
// Usage (run with cwd=/app):
//   node scripts/odoo-migrate.mjs parse   # parse + map + print preview (NO DB writes)
//   node scripts/odoo-migrate.mjs run     # wipe demo + import everything (writes to DB)

import fs from 'fs';
import readline from 'readline';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { setAcctSettings, syncLedger, trialBalance } from '../lib/accounting/engine.js';

const DUMP = '/root/odoo_mig/dump.sql';
const DB_PATH = '/app/data/erp.db';
const MODE = process.argv[2] || 'parse';
const OPENING_DATE = '2026-07-31';

// Approved opening balances (per 31-07-2026, from Odoo trial balance). Persediaan is
// computed from the imported opening stock so GL == inventory sub-ledger.
const OPENING_BAL = {
  '1-1110': 789664,       // Kas (Besar + Kecil)
  '1-1120': 118644895,    // Bank (BCA + Mandiri x2)
  '1-1200': 7244530,      // Piutang Usaha
  '1-1600': 75127846,     // Biaya Dibayar Dimuka (Sewa Gedung + Inventaris)
  '3-1100': 384244000,    // Modal Disetor
  // '1-1300' Persediaan -> set dynamically from stock
  // '3-1200' Laba Ditahan -> auto plug by engine
};

// ---------- pg_dump COPY parser ----------
function unesc(v) {
  if (v === '\\N') return null;
  if (v.indexOf('\\') === -1) return v;
  let o = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '\\' && i + 1 < v.length) { const n = v[++i]; o += n === 't' ? '\t' : n === 'n' ? '\n' : n === 'r' ? '\r' : n === '\\' ? '\\' : n; }
    else o += c;
  }
  return o;
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
      if (wanted) { const p = line.split('\t'); const row = {}; for (let i = 0; i < cols.length; i++) row[cols[i]] = unesc(p[i] ?? '\\N'); out[cur].rows.push(row); }
      continue;
    }
    const m = re.exec(line);
    if (m) { cur = m[1]; cols = m[2].split(',').map((s) => s.trim()); wanted = want.has(cur); if (wanted) out[cur] = { cols, rows: [] }; }
  }
  return out;
}

function trans(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.startsWith('{') && s.includes('"')) { try { const o = JSON.parse(s); return o.id_ID || o.en_US || Object.values(o)[0] || s; } catch { return s; } }
  return s;
}
const isT = (v) => v === 't';
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function classifyUnit(name) { const s = (name || '').toLowerCase(); if (s.includes('kg') || s.includes('kilogram')) return 'kg'; if (s.includes('ekor')) return 'ekor'; if (s.includes('pack') || s.includes('pak')) return 'pack'; if (s.includes('unit') || s.includes('pcs') || s.includes('satuan')) return 'pcs'; return 'kg'; }
const padCode = (p, n) => `${p}-${String(n).padStart(4, '0')}`;
const norm = (s) => (s || '').toString().trim().toLowerCase();

async function build() {
  const data = await parseCopy(['res_partner', 'product_template', 'product_product', 'res_country_state', 'uom_uom', 'stock_valuation_layer']);
  const stateMap = {}; for (const r of (data.res_country_state?.rows || [])) stateMap[r.id] = trans(r.name);
  const uomMap = {}; for (const r of (data.uom_uom?.rows || [])) uomMap[r.id] = trans(r.name);

  // ----- CONTACTS -----
  const usedCode = new Set(); let cS = 0, sS = 0; const contacts = [];
  for (const r of (data.res_partner?.rows || [])) {
    const cr = parseInt(r.customer_rank || '0', 10) || 0; const sr = parseInt(r.supplier_rank || '0', 10) || 0;
    if (cr <= 0 && sr <= 0) continue;
    const name = (r.name || '').trim(); if (!name) continue;
    const primary = cr > 0 ? 'Customer' : 'Supplier';
    const cats = []; if (cr > 0) cats.push('Customer'); if (sr > 0) cats.push('Supplier'); if (/karyawan|kary\./i.test(name)) cats.push('Karyawan');
    let code = (r.ref || '').trim();
    if (!code || usedCode.has(code)) { const mk = () => primary === 'Customer' ? padCode('CUST', ++cS) : padCode('SUPP', ++sS); code = mk(); while (usedCode.has(code)) code = mk(); }
    usedCode.add(code);
    let province = r.state_id ? (stateMap[r.state_id] || null) : null;
    if (province === 'Indonesia') province = null; // Odoo catch-all, not a real province
    contacts.push({ id: randomUUID(), contactType: primary, categories: JSON.stringify(cats), code,
      companyName: isT(r.is_company) ? name : (r.company_name || null), displayName: name, npwp: r.vat || null,
      taxStatus: isT(r.l10n_id_pkp) ? 'PKP' : null, address: [r.street, r.street2].filter(Boolean).join(', ') || null,
      city: r.city || null, province, postalCode: r.zip || null, phone: r.phone || r.mobile || null,
      picPhone: (r.phone && r.mobile && r.phone !== r.mobile) ? r.mobile : null, email: r.email || null, status: 'active' });
  }

  // ----- PRODUCTS (physical goods only) -----
  const usedSku = new Set(); let pS = 0; const products = []; const skuById = {}; const nameById = {};
  const FEE_RE = /biaya|materai|operasional|ongkir|admin bank|jasa kirim/i;
  for (const r of (data.product_template?.rows || [])) {
    if (r.type !== 'consu') continue;
    const name = trans(r.name) || 'Tanpa Nama'; if (FEE_RE.test(name)) continue;
    let sku = (r.default_code || '').trim(); if (!sku || usedSku.has(sku)) { sku = padCode('PRD', ++pS); while (usedSku.has(sku)) sku = padCode('PRD', ++pS); }
    usedSku.add(sku);
    const id = randomUUID();
    products.push({ id, sku, name, category: 'FG', unit: classifyUnit(uomMap[r.uom_id]), weightUnit: 'kg', basePrice: num(r.list_price), status: 'active' });
    skuById[sku] = id; nameById[norm(name)] = id;
  }

  // ----- OPENING STOCK (from stock_valuation_layer remaining) -----
  const ppTmpl = {}; for (const r of (data.product_product?.rows || [])) ppTmpl[r.id] = r.product_tmpl_id;
  const tmpl = {}; for (const r of (data.product_template?.rows || [])) tmpl[r.id] = { name: trans(r.name), type: r.type, code: (r.default_code || '').trim() };
  const agg = {}; // tmplId -> {q,v}
  for (const r of (data.stock_valuation_layer?.rows || [])) {
    const t = ppTmpl[r.product_id]; if (!t) continue;
    (agg[t] = agg[t] || { q: 0, v: 0 }); agg[t].q += num(r.remaining_qty); agg[t].v += num(r.remaining_value);
  }
  const openingStock = [];
  for (const [t, a] of Object.entries(agg)) {
    if (a.q <= 0 || a.v === 0) continue; const info = tmpl[t] || {}; if (info.type !== 'consu') continue;
    openingStock.push({ sku: info.code || null, name: info.name, qty: round2(a.q), value: round2(a.v), hpp: round2(a.v / a.q) });
  }
  return { contacts, products, skuById, nameById, openingStock };
}

function printPreview(d) {
  console.log(`\nParsed: contacts=${d.contacts.length}, products=${d.products.length}, openingStock lines=${d.openingStock.length}`);
  const stockVal = d.openingStock.reduce((s, x) => s + x.value, 0);
  console.log(`Opening stock total value = Rp ${Math.round(stockVal).toLocaleString('id-ID')} (${d.openingStock.length} produk)`);
  // match check
  const unmatched = d.openingStock.filter((s) => !(s.sku && d.skuById[s.sku]) && !d.nameById[norm(s.name)]);
  console.log(`Opening stock unmatched to ERP product: ${unmatched.length}`, unmatched.slice(0, 5).map((x) => x.sku || x.name));
  console.log('\nOpening balances to set:');
  const bal = { ...OPENING_BAL, '1-1300': Math.round(stockVal) };
  let d0 = 0; for (const [k, v] of Object.entries(bal)) { console.log(`  ${k}: Rp ${v.toLocaleString('id-ID')}`); }
  const debits = bal['1-1110'] + bal['1-1120'] + bal['1-1200'] + bal['1-1300'] + bal['1-1600'];
  const credits = bal['3-1100'];
  const plug = debits - credits;
  console.log(`  => Laba Ditahan (auto plug) = ${plug >= 0 ? 'KREDIT' : 'DEBIT (defisit)'} Rp ${Math.abs(plug).toLocaleString('id-ID')}`);
}

// ---------- DB ops ----------
const WIPE = ['contact_customers','contact_documents','contacts','products',
  'so_item_stocks','sales_order_receipt_items','sales_order_receipts','sales_returns','sales_payments','surat_jalan','sales_order_items','sales_order',
  'grn_documents','grn_items','grn','purchase_returns','purchase_payments','purchase_order_items','purchase_order',
  'wo_stage_records','wo_outputs','wo_custom_costs','work_order_details','work_order',
  'stock_opname_items','stock_opname','inventory_transaction','inventory_stock',
  'tally_session_items','tally_session','commission_payments','commission_records','approvals','notifications',
  'journal_lines','journal_entries'];
const exists = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

function run(d) {
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 8000');
  db.pragma('foreign_keys = OFF');
  const before = {}; for (const t of ['contacts','products','sales_order','purchase_order','journal_entries','inventory_stock']) if (exists(db, t)) before[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

  // cold storage + zone for opening stock
  const cs = db.prepare('SELECT id FROM cold_storages ORDER BY created_at LIMIT 1').get();
  const csId = cs ? cs.id : (() => { const id = randomUUID(); db.prepare(`INSERT INTO cold_storages (id,code,name,location,capacity_kg,status,created_at,updated_at) VALUES (?,?,?,?,?,?,unixepoch(),unixepoch())`).run(id,'CS-01','Cold Storage Utama','Gudang Pusat',50000,'active'); return id; })();
  const zn = db.prepare('SELECT id FROM zones WHERE cold_storage_id=? ORDER BY created_at LIMIT 1').get(csId);
  const znId = zn ? zn.id : (() => { const id = randomUUID(); db.prepare(`INSERT INTO zones (id,cold_storage_id,code,name,status,created_at,updated_at) VALUES (?,?,?,?,?,unixepoch(),unixepoch())`).run(id,csId,'Z-A','Zona A','active'); return id; })();

  let stockInserted = 0, stockValue = 0, stockSkipped = [];
  const tx = db.transaction(() => {
    for (const t of WIPE) if (exists(db, t)) db.prepare(`DELETE FROM ${t}`).run();
    if (exists(db, 'gl_accounts')) db.prepare('UPDATE gl_accounts SET opening_balance=0').run();

    const ci = db.prepare(`INSERT INTO contacts (id,contact_type,categories,code,company_name,display_name,npwp,tax_status,address,city,province,postal_code,phone,pic_phone,email,status,created_at,updated_at)
      VALUES (@id,@contactType,@categories,@code,@companyName,@displayName,@npwp,@taxStatus,@address,@city,@province,@postalCode,@phone,@picPhone,@email,@status,unixepoch(),unixepoch())`);
    for (const c of d.contacts) ci.run(c);
    const pi = db.prepare(`INSERT INTO products (id,sku,name,category,unit,weight_unit,base_price,status,created_at,updated_at)
      VALUES (@id,@sku,@name,@category,@unit,@weightUnit,@basePrice,@status,unixepoch(),unixepoch())`);
    for (const p of d.products) pi.run(p);

    // opening stock
    const txId = randomUUID();
    let kNo = 0;
    const si = db.prepare(`INSERT INTO inventory_stock (id,product_id,cold_storage_id,zone_id,kode_simpan,packaging_type,quantity,weight,status,hpp_per_kg,transaction_id,source_batch,created_at,updated_at)
      VALUES (@id,@productId,@csId,@znId,@kode,'curah',@qty,@weight,'active',@hpp,@txId,'SALDO-AWAL-ODOO',unixepoch(),unixepoch())`);
    for (const s of d.openingStock) {
      const pid = (s.sku && d.skuById[s.sku]) || d.nameById[norm(s.name)];
      if (!pid) { stockSkipped.push(s.sku || s.name); continue; }
      si.run({ id: randomUUID(), productId: pid, csId, znId, kode: padCode('SA', ++kNo), qty: 1, weight: s.qty, hpp: s.hpp, txId });
      stockInserted++; stockValue += s.value;
    }
    stockValue = round2(stockValue);
    if (stockInserted && exists(db, 'inventory_transaction')) {
      db.prepare(`INSERT INTO inventory_transaction (id,tx_number,transaction_date,transaction_type,reference_type,to_cold_storage_id,to_zone_id,total_weight,total_quantity,reason,status,created_at)
        VALUES (?,?,?, 'IN','MANUAL',?,?,?,?,?, 'confirmed', unixepoch())`).run(txId,'TX-SALDO-AWAL', Math.floor(new Date(OPENING_DATE).getTime()/1000), csId, znId, round2(d.openingStock.reduce((a,x)=>a+x.qty,0)), stockInserted, 'Saldo awal migrasi Odoo');
    }

    // opening balances
    const setBal = db.prepare('UPDATE gl_accounts SET opening_balance=? WHERE code=?');
    for (const [code, val] of Object.entries(OPENING_BAL)) setBal.run(val, code);
    setBal.run(stockValue, '1-1300'); // Persediaan = actual imported stock value
  });
  tx();

  // opening date + post opening journal via engine
  db.pragma('foreign_keys = ON');
  setAcctSettings(db, { openingDate: OPENING_DATE });
  const sync = syncLedger(db, { createdBy: null });
  const tb = trialBalance(db, {});
  const tbal = (tb.rows || tb || []);
  let td = 0, tc = 0; for (const r of (Array.isArray(tbal) ? tbal : [])) { td += (r.debit || 0); tc += (r.credit || 0); }

  const after = {}; for (const t of Object.keys(before)) after[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  // laba ditahan opening line
  const ld = db.prepare(`SELECT jl.debit d, jl.credit c FROM journal_lines jl JOIN journal_entries je ON jl.journal_id=je.id JOIN gl_accounts g ON jl.account_id=g.id WHERE je.source_type='OPENING' AND g.code='3-1200'`).get();
  db.close();

  console.log('\n=== DB COUNTS (before -> after) ===');
  for (const t of Object.keys(before)) console.log(`  ${t.padEnd(18)} ${before[t]} -> ${after[t]}`);
  console.log(`\nImported: contacts=${d.contacts.length}, products=${d.products.length}`);
  console.log(`Opening stock: inserted=${stockInserted}, value(Persediaan)=Rp ${stockValue.toLocaleString('id-ID')}, skipped=${stockSkipped.length}`, stockSkipped.slice(0,5));
  console.log(`Opening journal posted: ${sync ? JSON.stringify(sync) : 'n/a'}`);
  if (ld) console.log(`Laba Ditahan (3-1200) opening line: debit=${(ld.d||0).toLocaleString('id-ID')} credit=${(ld.c||0).toLocaleString('id-ID')}`);
  console.log(`Trial balance (posted): totalDebit=${Math.round(td).toLocaleString('id-ID')} totalCredit=${Math.round(tc).toLocaleString('id-ID')} balanced=${Math.round(td)===Math.round(tc)}`);
}

(async () => {
  const d = await build();
  printPreview(d);
  if (MODE === 'run') { run(d); console.log('\n✅ MIGRATION (Tahap 1 + 2) done.'); }
  else console.log('\n(parse-only; no DB changes) — run with "run" to apply.');
})();
