// =====================================================================
// ACCOUNTING ENGINE — SAK EP (Standar Akuntansi Keuangan Entitas Privat)
// Double-entry bookkeeping, accrual basis, perpetual inventory.
// Idempotent auto-posting from all ERP modules + financial reports.
// Operates directly on the better-sqlite3 handle for aggregation speed.
// =====================================================================
import { v4 as uuidv4 } from 'uuid';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nowSec = () => Math.floor(Date.now() / 1000);
export const toSec = (d) => {
  if (d == null || d === '') return null;
  if (typeof d === 'number') return d > 1e12 ? Math.floor(d / 1000) : Math.floor(d);
  const t = new Date(d).getTime();
  return isNaN(t) ? null : Math.floor(t / 1000);
};

// ---------------------------------------------------------------------
// DEFAULT CHART OF ACCOUNTS (SAK EP)
// type: asset | liability | equity | revenue | cogs | expense | other_income | other_expense
// cf: operating | investing | financing | none
// h = header (not postable). s = system (protected from delete).
// ---------------------------------------------------------------------
export const DEFAULT_COA = [
  // ---- ASET (1) ----
  { code: '1-0000', name: 'ASET', type: 'asset', nb: 'debit', cat: 'Aset', cf: 'none', h: true, s: true },
  { code: '1-1000', name: 'Aset Lancar', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', h: true, s: true, parent: '1-0000' },
  { code: '1-1110', name: 'Kas', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', s: true, parent: '1-1000' },
  { code: '1-1120', name: 'Bank', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', s: true, parent: '1-1000' },
  { code: '1-1200', name: 'Piutang Usaha', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', s: true, parent: '1-1000' },
  { code: '1-1250', name: 'Piutang Lain-lain', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', parent: '1-1000' },
  { code: '1-1300', name: 'Persediaan', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', s: true, parent: '1-1000' },
  { code: '1-1400', name: 'Uang Muka Pembelian', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', s: true, parent: '1-1000' },
  { code: '1-1500', name: 'PPN Masukan', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', s: true, parent: '1-1000' },
  { code: '1-1600', name: 'Biaya Dibayar Dimuka', type: 'asset', nb: 'debit', cat: 'Aset Lancar', cf: 'operating', parent: '1-1000' },
  { code: '1-2000', name: 'Aset Tetap', type: 'asset', nb: 'debit', cat: 'Aset Tetap', cf: 'investing', h: true, s: true, parent: '1-0000' },
  { code: '1-2100', name: 'Peralatan & Mesin', type: 'asset', nb: 'debit', cat: 'Aset Tetap', cf: 'investing', parent: '1-2000' },
  { code: '1-2200', name: 'Kendaraan', type: 'asset', nb: 'debit', cat: 'Aset Tetap', cf: 'investing', parent: '1-2000' },
  { code: '1-2300', name: 'Bangunan', type: 'asset', nb: 'debit', cat: 'Aset Tetap', cf: 'investing', parent: '1-2000' },
  { code: '1-2900', name: 'Akumulasi Penyusutan', type: 'asset', nb: 'credit', cat: 'Aset Tetap', cf: 'investing', parent: '1-2000' },

  // ---- LIABILITAS (2) ----
  { code: '2-0000', name: 'LIABILITAS', type: 'liability', nb: 'credit', cat: 'Liabilitas', cf: 'none', h: true, s: true },
  { code: '2-1000', name: 'Liabilitas Jangka Pendek', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Pendek', cf: 'operating', h: true, s: true, parent: '2-0000' },
  { code: '2-1100', name: 'Utang Usaha', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Pendek', cf: 'operating', s: true, parent: '2-1000' },
  { code: '2-1200', name: 'PPN Keluaran', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Pendek', cf: 'operating', s: true, parent: '2-1000' },
  { code: '2-1300', name: 'Uang Muka Penjualan', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Pendek', cf: 'operating', s: true, parent: '2-1000' },
  { code: '2-1400', name: 'Utang Biaya Produksi', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Pendek', cf: 'operating', s: true, parent: '2-1000' },
  { code: '2-1500', name: 'Utang Pajak', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Pendek', cf: 'operating', parent: '2-1000' },
  { code: '2-1600', name: 'Utang Gaji', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Pendek', cf: 'operating', parent: '2-1000' },
  { code: '2-2000', name: 'Liabilitas Jangka Panjang', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Panjang', cf: 'financing', h: true, s: true, parent: '2-0000' },
  { code: '2-2100', name: 'Utang Bank', type: 'liability', nb: 'credit', cat: 'Liabilitas Jangka Panjang', cf: 'financing', parent: '2-2000' },

  // ---- EKUITAS (3) ----
  { code: '3-0000', name: 'EKUITAS', type: 'equity', nb: 'credit', cat: 'Ekuitas', cf: 'financing', h: true, s: true },
  { code: '3-1100', name: 'Modal Disetor', type: 'equity', nb: 'credit', cat: 'Ekuitas', cf: 'financing', s: true, parent: '3-0000' },
  { code: '3-1200', name: 'Laba Ditahan', type: 'equity', nb: 'credit', cat: 'Ekuitas', cf: 'financing', s: true, parent: '3-0000' },
  { code: '3-1300', name: 'Prive / Pengambilan Pemilik', type: 'equity', nb: 'debit', cat: 'Ekuitas', cf: 'financing', parent: '3-0000' },
  { code: '3-9000', name: 'Laba (Rugi) Tahun Berjalan', type: 'equity', nb: 'credit', cat: 'Ekuitas', cf: 'none', h: true, s: true, parent: '3-0000' },

  // ---- PENDAPATAN (4) ----
  { code: '4-0000', name: 'PENDAPATAN', type: 'revenue', nb: 'credit', cat: 'Pendapatan', cf: 'operating', h: true, s: true },
  { code: '4-1100', name: 'Penjualan', type: 'revenue', nb: 'credit', cat: 'Pendapatan', cf: 'operating', s: true, parent: '4-0000' },
  { code: '4-1200', name: 'Retur Penjualan', type: 'revenue', nb: 'debit', cat: 'Pendapatan', cf: 'operating', s: true, parent: '4-0000' },
  { code: '4-1300', name: 'Diskon Penjualan', type: 'revenue', nb: 'debit', cat: 'Pendapatan', cf: 'operating', s: true, parent: '4-0000' },

  // ---- BEBAN POKOK PENJUALAN (5) ----
  { code: '5-0000', name: 'BEBAN POKOK PENJUALAN', type: 'cogs', nb: 'debit', cat: 'Beban Pokok Penjualan', cf: 'operating', h: true, s: true },
  { code: '5-1100', name: 'Harga Pokok Penjualan', type: 'cogs', nb: 'debit', cat: 'Beban Pokok Penjualan', cf: 'operating', s: true, parent: '5-0000' },
  { code: '5-1200', name: 'Selisih / Susut Persediaan', type: 'cogs', nb: 'debit', cat: 'Beban Pokok Penjualan', cf: 'operating', s: true, parent: '5-0000' },
  { code: '5-1300', name: 'Beban Angkut Pembelian', type: 'cogs', nb: 'debit', cat: 'Beban Pokok Penjualan', cf: 'operating', s: true, parent: '5-0000' },

  // ---- BEBAN OPERASIONAL (6) ----
  { code: '6-0000', name: 'BEBAN OPERASIONAL', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', h: true, s: true },
  { code: '6-1100', name: 'Beban Gaji & Upah', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', parent: '6-0000' },
  { code: '6-1200', name: 'Beban Operasional Umum', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', s: true, parent: '6-0000' },
  { code: '6-1300', name: 'Beban Pengiriman / Ongkir', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', s: true, parent: '6-0000' },
  { code: '6-1400', name: 'Beban Komisi', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', s: true, parent: '6-0000' },
  { code: '6-1500', name: 'Beban Produksi / Maklon', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', parent: '6-0000' },
  { code: '6-1600', name: 'Beban Penyusutan', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', parent: '6-0000' },
  { code: '6-1700', name: 'Beban Sewa', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', parent: '6-0000' },
  { code: '6-1800', name: 'Beban Listrik & Utilitas', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', parent: '6-0000' },
  { code: '6-1900', name: 'Beban Administrasi & Umum', type: 'expense', nb: 'debit', cat: 'Beban Operasional', cf: 'operating', parent: '6-0000' },

  // ---- PENDAPATAN & BEBAN LAIN (7) ----
  { code: '7-0000', name: 'PENDAPATAN & BEBAN LAIN', type: 'other_income', nb: 'credit', cat: 'Pendapatan & Beban Lain', cf: 'operating', h: true, s: true },
  { code: '7-1100', name: 'Pendapatan Lain-lain', type: 'other_income', nb: 'credit', cat: 'Pendapatan & Beban Lain', cf: 'operating', s: true, parent: '7-0000' },
  { code: '7-2100', name: 'Beban Lain-lain', type: 'other_expense', nb: 'debit', cat: 'Pendapatan & Beban Lain', cf: 'operating', s: true, parent: '7-0000' },
  { code: '7-2200', name: 'Beban Bunga', type: 'other_expense', nb: 'debit', cat: 'Pendapatan & Beban Lain', cf: 'financing', parent: '7-0000' },
];

// Mapping keys -> default account codes
export const DEFAULT_MAPPING = {
  kas: '1-1110',
  bank: '1-1120',
  piutang_usaha: '1-1200',
  persediaan: '1-1300',
  uang_muka_pembelian: '1-1400',
  ppn_masukan: '1-1500',
  utang_usaha: '2-1100',
  ppn_keluaran: '2-1200',
  uang_muka_penjualan: '2-1300',
  utang_biaya_produksi: '2-1400',
  modal: '3-1100',
  laba_ditahan: '3-1200',
  penjualan: '4-1100',
  retur_penjualan: '4-1200',
  diskon_penjualan: '4-1300',
  hpp: '5-1100',
  selisih_persediaan: '5-1200',
  beban_angkut_beli: '5-1300',
  beban_ongkir: '6-1300',
  beban_komisi: '6-1400',
  beban_produksi: '6-1500',
  beban_operasional: '6-1200',
  beban_penyusutan: '6-1600',
  akumulasi_penyusutan: '1-2900',
  aset_tetap: '1-2100',
  pendapatan_lain: '7-1100',
  beban_lain: '7-2100',
};

export const MAPPING_LABELS = {
  kas: 'Kas (penerimaan/pengeluaran tunai)',
  bank: 'Bank (transfer / QRIS)',
  piutang_usaha: 'Piutang Usaha (tagihan pelanggan)',
  persediaan: 'Persediaan (nilai stok)',
  uang_muka_pembelian: 'Uang Muka Pembelian (DP ke supplier)',
  ppn_masukan: 'PPN Masukan',
  utang_usaha: 'Utang Usaha (utang ke supplier)',
  ppn_keluaran: 'PPN Keluaran',
  uang_muka_penjualan: 'Uang Muka Penjualan (DP pelanggan)',
  utang_biaya_produksi: 'Utang Biaya Produksi (maklon/olah)',
  modal: 'Modal Disetor',
  laba_ditahan: 'Laba Ditahan',
  penjualan: 'Penjualan',
  retur_penjualan: 'Retur Penjualan',
  diskon_penjualan: 'Diskon Penjualan',
  hpp: 'Harga Pokok Penjualan (HPP)',
  selisih_persediaan: 'Selisih / Susut Persediaan',
  beban_angkut_beli: 'Beban Angkut Pembelian (ongkir beli ditanggung kita)',
  beban_ongkir: 'Beban Pengiriman / Ongkir',
  beban_komisi: 'Beban Komisi',
  beban_produksi: 'Beban Produksi / Maklon',
  beban_operasional: 'Beban Operasional Umum',
  beban_penyusutan: 'Beban Penyusutan',
  akumulasi_penyusutan: 'Akumulasi Penyusutan',
  aset_tetap: 'Aset Tetap',
  pendapatan_lain: 'Pendapatan Lain-lain',
  beban_lain: 'Beban Lain-lain',
};

const DEFAULT_SETTINGS = () => ({
  ppnEnabled: false,
  ppnRate: 11,
  openingDate: `${new Date().getFullYear()}-01-01`,
  autoPost: true,
});

// ---------------------------------------------------------------------
// SEEDING
// ---------------------------------------------------------------------
export function seedAccounting(sqlite) {
  const cnt = sqlite.prepare('SELECT COUNT(*) c FROM gl_accounts').get().c;
  if (cnt === 0) {
    const ins = sqlite.prepare(`INSERT INTO gl_accounts
      (id, code, name, type, normal_balance, category, parent_code, cash_flow_category, is_postable, is_system, opening_balance, sort_order, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?, 'active')`);
    const tx = sqlite.transaction(() => {
      DEFAULT_COA.forEach((a, i) => {
        ins.run(uuidv4(), a.code, a.name, a.type, a.nb, a.cat || null, a.parent || null,
          a.cf || 'operating', a.h ? 0 : 1, a.s ? 1 : 0, i);
      });
    });
    tx();
  }
  // Idempotent: sisipkan akun COA baru yang belum ada (mis. 5-1300 Beban Angkut Pembelian)
  try {
    const existing = new Set(sqlite.prepare('SELECT code FROM gl_accounts').all().map(r => r.code));
    const missing = DEFAULT_COA.filter(a => !existing.has(a.code));
    if (missing.length > 0) {
      const insMissing = sqlite.prepare(`INSERT INTO gl_accounts
        (id, code, name, type, normal_balance, category, parent_code, cash_flow_category, is_postable, is_system, opening_balance, sort_order, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,0,?, 'active')`);
      const maxSort = Number(sqlite.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM gl_accounts').get()?.m || 0);
      const tx2 = sqlite.transaction(() => {
        missing.forEach((a, i) => {
          insMissing.run(uuidv4(), a.code, a.name, a.type, a.nb, a.cat || null, a.parent || null,
            a.cf || 'operating', a.h ? 0 : 1, a.s ? 1 : 0, maxSort + 1 + i);
        });
      });
      tx2();
    }
  } catch (e) { console.error('seedAccounting ensure-missing failed:', e?.message || e); }
  // mapping
  const m = sqlite.prepare(`SELECT value FROM app_settings WHERE key='accounting_mapping'`).get();
  if (!m) {
    sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('accounting_mapping', ?, unixepoch())`)
      .run(JSON.stringify(DEFAULT_MAPPING));
  }
  const st = sqlite.prepare(`SELECT value FROM app_settings WHERE key='accounting_settings'`).get();
  if (!st) {
    sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('accounting_settings', ?, unixepoch())`)
      .run(JSON.stringify(DEFAULT_SETTINGS()));
  }
}

export function getMapping(sqlite) {
  try {
    const row = sqlite.prepare(`SELECT value FROM app_settings WHERE key='accounting_mapping'`).get();
    return { ...DEFAULT_MAPPING, ...(row?.value ? JSON.parse(row.value) : {}) };
  } catch { return { ...DEFAULT_MAPPING }; }
}

export function setMapping(sqlite, mapping) {
  const merged = { ...DEFAULT_MAPPING, ...(mapping || {}) };
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('accounting_mapping', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=unixepoch()`).run(JSON.stringify(merged));
  return merged;
}

export function getAcctSettings(sqlite) {
  try {
    const row = sqlite.prepare(`SELECT value FROM app_settings WHERE key='accounting_settings'`).get();
    return { ...DEFAULT_SETTINGS(), ...(row?.value ? JSON.parse(row.value) : {}) };
  } catch { return DEFAULT_SETTINGS(); }
}

export function setAcctSettings(sqlite, settings) {
  const merged = { ...DEFAULT_SETTINGS(), ...(settings || {}) };
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('accounting_settings', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=unixepoch()`).run(JSON.stringify(merged));
  return merged;
}

// ---------------------------------------------------------------------
// ACCOUNT HELPERS
// ---------------------------------------------------------------------
function loadAccounts(sqlite) {
  const rows = sqlite.prepare('SELECT * FROM gl_accounts').all();
  const byCode = {}, byId = {};
  for (const r of rows) { byCode[r.code] = r; byId[r.id] = r; }
  return { rows, byCode, byId };
}

// ---------------------------------------------------------------------
// LOW-LEVEL JOURNAL INSERT (assumes lines reference account codes)
// lines: [{code, debit, credit, description}]
// ---------------------------------------------------------------------
function insertJournalByCode(sqlite, byCode, opts) {
  const { date, description, sourceType, sourceId = null, sourceNumber = null, sourceKey = null, isAuto = 0, createdBy = null, journalNumber } = opts;
  const norm = (opts.lines || [])
    .map((l) => {
      const acc = byCode[l.code];
      if (!acc) return null;
      return { acc, debit: round2(l.debit), credit: round2(l.credit), description: l.description || '' };
    })
    .filter((l) => l && (l.debit !== 0 || l.credit !== 0));
  if (norm.length < 2) return null;
  const totalDebit = round2(norm.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(norm.reduce((s, l) => s + l.credit, 0));
  const jid = uuidv4();
  const num = journalNumber || sourceKey || `JV-${jid.slice(0, 8)}`;
  sqlite.prepare(`INSERT INTO journal_entries
    (id, journal_number, entry_date, description, source_type, source_id, source_number, source_key, is_auto, status, total_debit, total_credit, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?, 'posted', ?, ?, ?, unixepoch())`)
    .run(jid, num, date, description || null, sourceType, sourceId, sourceNumber, sourceKey, isAuto ? 1 : 0, totalDebit, totalCredit, createdBy);
  const insL = sqlite.prepare(`INSERT INTO journal_lines (id, journal_id, account_id, account_code, description, debit, credit, sort_order)
    VALUES (?,?,?,?,?,?,?,?)`);
  norm.forEach((l, i) => insL.run(uuidv4(), jid, l.acc.id, l.acc.code, l.description || null, l.debit, l.credit, i));
  return jid;
}

// ---------------------------------------------------------------------
// SYNC LEDGER — regenerate ALL auto journals from ERP source documents.
// Manual journals (is_auto=0) are preserved. Idempotent.
// ---------------------------------------------------------------------
export function syncLedger(sqlite, { createdBy = null } = {}) {
  const { byCode } = loadAccounts(sqlite);
  const map = getMapping(sqlite);
  const st = getAcctSettings(sqlite);
  const acc = (key) => map[key]; // returns account CODE
  const has = (code) => !!byCode[code];

  const ppn = !!st.ppnEnabled;
  const rate = Number(st.ppnRate || 11) / 100;
  const splitTax = (total) => {
    if (!ppn || rate <= 0) return { dpp: round2(total), tax: 0 };
    const dpp = round2(total / (1 + rate));
    return { dpp, tax: round2(total - dpp) };
  };

  const tx = sqlite.transaction(() => {
    // wipe existing auto journals (lines cascade)
    sqlite.prepare(`DELETE FROM journal_entries WHERE is_auto=1`).run();

    let n = 0;
    const post = (o) => { const id = insertJournalByCode(sqlite, byCode, { ...o, isAuto: 1, createdBy }); if (id) n++; return id; };
    const cashAcc = (method) => (String(method || '').toLowerCase().includes('tunai') ? acc('kas') : acc('bank'));
    // Pilih akun Kas/Bank dari account_code pembayaran bila valid (mempengaruhi jurnal); fallback ke metode.
    const payAcc = (p) => (p.account_code && has(p.account_code)) ? p.account_code : cashAcc(p.method);

    // 1) OPENING BALANCES ------------------------------------------------
    try {
      const openRows = sqlite.prepare(`SELECT id, code, normal_balance, opening_balance FROM gl_accounts WHERE opening_balance != 0 AND is_postable=1`).all();
      if (openRows.length) {
        const openDate = toSec(st.openingDate) || toSec(`${new Date().getFullYear()}-01-01`);
        const lines = [];
        let d = 0, c = 0;
        for (const r of openRows) {
          const bal = round2(r.opening_balance);
          if (r.normal_balance === 'credit') { lines.push({ code: r.code, debit: 0, credit: bal }); c += bal; }
          else { lines.push({ code: r.code, debit: bal, credit: 0 }); d += bal; }
        }
        const diff = round2(d - c);
        if (diff !== 0 && has(acc('laba_ditahan'))) {
          if (diff > 0) lines.push({ code: acc('laba_ditahan'), debit: 0, credit: diff });
          else lines.push({ code: acc('laba_ditahan'), debit: -diff, credit: 0 });
        }
        post({ date: openDate, description: 'Saldo Awal (Neraca Pembukaan)', sourceType: 'OPENING', sourceKey: 'OPENING', sourceNumber: 'Saldo Awal', journalNumber: 'OPENING', lines });
      }
    } catch (e) { console.error('sync opening', e?.message); }

    // 2) SALES INVOICE (revenue + COGS) ---------------------------------
    try {
      const sos = sqlite.prepare(`SELECT * FROM sales_order WHERE (archived_at IS NULL) AND COALESCE(migrated,0)=0
        AND (invoice_number IS NOT NULL OR pipeline_status IN ('Shipped','Invoiced','Selesai'))`).all();
      const cogsStockStmt = sqlite.prepare(`SELECT COALESCE(SUM(weight*hpp_per_kg),0) v FROM so_item_stocks WHERE sales_order_id=?`);
      const linkedPoStmt = sqlite.prepare(`SELECT total_amount FROM purchase_order WHERE sales_order_id=? OR id=? LIMIT 1`);
      for (const so of sos) {
        try {
          const total = round2(so.total_amount);
          if (total <= 0) continue;
          const date = so.invoice_date || so.order_date;
          // Faktur di-up: pendapatan/piutang diakui pada nilai di-up (= total asli + cashback). Cashback direfund terpisah (section 2b).
          const cashbackAmt = (so.markup_enabled && Number(so.cashback_amount) > 0) ? round2(so.cashback_amount) : 0;
          const invAmt = round2(total + cashbackAmt);
          const { dpp, tax } = splitTax(invAmt);
          const lines = [{ code: acc('piutang_usaha'), debit: invAmt, credit: 0, description: `Piutang ${so.so_number}` }];
          lines.push({ code: acc('penjualan'), debit: 0, credit: dpp, description: `Penjualan ${so.so_number}` });
          if (tax > 0) lines.push({ code: acc('ppn_keluaran'), debit: 0, credit: tax });
          // COGS
          let cogs = 0;
          if (String(so.fulfillment_type) === 'dropship') {
            const po = linkedPoStmt.get(so.id, so.auto_po_id || '');
            cogs = round2(po?.total_amount || 0);
          } else {
            cogs = round2(cogsStockStmt.get(so.id)?.v || 0);
          }
          if (cogs > 0) {
            lines.push({ code: acc('hpp'), debit: cogs, credit: 0, description: `HPP ${so.so_number}` });
            lines.push({ code: acc('persediaan'), debit: 0, credit: cogs });
          }
          post({ date, description: `Faktur Penjualan ${so.so_number}`, sourceType: 'SO_INV', sourceId: so.id, sourceNumber: so.so_number, sourceKey: `SO_INV:${so.id}`, lines });

          // BIAYA KIRIM / ONGKIR: perusahaan membayar kurir (kas keluar) -> selalu dicatat sbg beban.
          // Ditanggung PEMBELI: reimbursement sudah masuk ke total_amount (Penjualan) -> margin operasional netral.
          // Ditanggung PENJUAL: tidak ditagih -> beban murni mengurangi laba.
          const shipCost = round2(so.shipping_cost || 0);
          if (shipCost > 0 && has(acc('beban_ongkir'))) {
            const shipCash = String(so.shipping_pay_method || 'transfer').toLowerCase().includes('tunai') ? acc('kas') : acc('bank');
            if (has(shipCash)) {
              const bearerTxt = so.shipping_bearer === 'buyer' ? 'ditagih ke pembeli' : 'ditanggung penjual';
              post({
                date, description: `Biaya kirim ${so.so_number} (${bearerTxt})`,
                sourceType: 'SO_SHIP', sourceId: so.id, sourceNumber: so.so_number, sourceKey: `SO_SHIP:${so.id}`,
                lines: [
                  { code: acc('beban_ongkir'), debit: shipCost, credit: 0, description: `Ongkir ${so.so_number}` },
                  { code: shipCash, debit: 0, credit: shipCost, description: `Bayar ongkir ${so.so_number}` },
                ],
              });
            }
          }
        } catch (e) { console.error('sync so', so?.so_number, e?.message); }
      }
    } catch (e) { console.error('sync sales', e?.message); }

    // 2b) CASHBACK / FAKTUR DI-UP (opsional) ---------------------------
    // Customer transfer nilai di-up penuh, lalu selisih (cashback) dikembalikan.
    // Dr Beban Komisi/Cashback ; Cr Kas/Bank (kas benar-benar keluar).
    try {
      const cbSos = sqlite.prepare(`SELECT * FROM sales_order WHERE archived_at IS NULL AND COALESCE(migrated,0)=0 AND markup_enabled=1 AND cashback_amount > 0
        AND (invoice_number IS NOT NULL OR pipeline_status IN ('Shipped','Invoiced','Selesai'))`).all();
      for (const so of cbSos) {
        try {
          const cashback = round2(so.cashback_amount || 0);
          if (cashback <= 0) continue;
          const cashCode = (so.cashback_account && has(so.cashback_account)) ? so.cashback_account : (has(acc('bank')) ? acc('bank') : acc('kas'));
          if (!has(acc('beban_komisi')) || !has(cashCode)) continue;
          const date = so.invoice_date || so.order_date;
          post({
            date, description: `Cashback faktur di-up ${so.so_number}${so.cashback_recipient ? ' - ' + so.cashback_recipient : ''}`,
            sourceType: 'CASHBACK', sourceId: so.id, sourceNumber: so.so_number, sourceKey: `CASHBACK:${so.id}`,
            lines: [
              { code: acc('beban_komisi'), debit: cashback, credit: 0, description: `Cashback ${so.so_number}` },
              { code: cashCode, debit: 0, credit: cashback, description: `Refund cashback ${so.so_number}` },
            ],
          });
        } catch (e) { console.error('sync cashback', so?.so_number, e?.message); }
      }
    } catch (e) { console.error('sync cashback section', e?.message); }

    // 3) SALES PAYMENTS -------------------------------------------------
    try {
      const rows = sqlite.prepare(`SELECT sp.*, so.so_number so_number, so.invoice_number inv FROM sales_payments sp
        JOIN sales_order so ON so.id = sp.sales_order_id`).all();
      for (const p of rows) {
        try {
          const amt = round2(p.amount); if (amt <= 0) continue;
          const invoiced = !!p.inv;
          const lines = [
            { code: payAcc(p), debit: amt, credit: 0, description: `Penerimaan ${p.so_number}` },
            { code: invoiced ? acc('piutang_usaha') : acc('uang_muka_penjualan'), debit: 0, credit: amt },
          ];
          post({ date: p.payment_date, description: `Penerimaan Pembayaran ${p.so_number}`, sourceType: 'SPAY', sourceId: p.id, sourceNumber: p.so_number, sourceKey: `SPAY:${p.id}`, lines });
        } catch (e) { console.error('sync spay', e?.message); }
      }
    } catch (e) { console.error('sync spays', e?.message); }

    // 4) PURCHASE INVOICE / RECEIPT (inventory/expense + AP) -------------
    try {
      const pos = sqlite.prepare(`SELECT po.* FROM purchase_order po WHERE (po.archived_at IS NULL) AND COALESCE(po.migrated,0)=0
        AND (po.invoice_number IS NOT NULL
             OR EXISTS (SELECT 1 FROM grn g WHERE g.purchase_order_id=po.id)
             OR po.pipeline_status IN ('Received','Diterima','Invoiced','Selesai','Completed'))`).all();
      const grnDateStmt = sqlite.prepare(`SELECT MIN(received_date) d FROM grn WHERE purchase_order_id=?`);
      for (const po of pos) {
        try {
          const total = round2(po.total_amount); if (total <= 0) continue;
          const date = po.invoice_date || grnDateStmt.get(po.id)?.d || po.order_date;
          const addCost = round2(po.additional_cost || 0);
          const companyBorne = po.additional_cost_bearer !== 'supplier';
          const payMethod = po.additional_cost_pay_method || 'utang';
          // Ongkir/biaya tambahan yang ditanggung KITA & ditagih via Utang pemasok -> masuk total & jadi Beban Angkut
          const utangFreight = (companyBorne && payMethod === 'utang') ? addCost : 0;
          const goodsTotal = round2(total - utangFreight); // porsi barang saja (total sudah termasuk utangFreight)
          const { dpp, tax } = splitTax(goodsTotal);
          const debitCode = String(po.po_type) === 'Operasional' ? acc('beban_operasional') : acc('persediaan');
          const lines = [{ code: debitCode, debit: dpp, credit: 0, description: `Pembelian ${po.po_number}` }];
          if (tax > 0) lines.push({ code: acc('ppn_masukan'), debit: tax, credit: 0 });
          if (utangFreight > 0 && has(acc('beban_angkut_beli'))) {
            lines.push({ code: acc('beban_angkut_beli'), debit: utangFreight, credit: 0, description: `Ongkir/biaya tambahan ${po.po_number}` });
          }
          lines.push({ code: acc('utang_usaha'), debit: 0, credit: round2(goodsTotal + (has(acc('beban_angkut_beli')) ? utangFreight : 0)), description: `Utang ${po.po_number}` });
          post({ date, description: `Faktur Pembelian ${po.po_number}`, sourceType: 'PO_INV', sourceId: po.id, sourceNumber: po.po_number, sourceKey: `PO_INV:${po.id}`, lines });

          // Ongkir ditanggung KITA & dibayar tunai/transfer ke kurir/pihak ketiga -> jurnal terpisah (kas keluar)
          const cashFreight = (companyBorne && payMethod !== 'utang') ? addCost : 0;
          if (cashFreight > 0 && has(acc('beban_angkut_beli'))) {
            const cashCode = payMethod === 'tunai' ? acc('kas') : acc('bank');
            if (has(cashCode)) {
              post({
                date, description: `Biaya angkut pembelian ${po.po_number}`,
                sourceType: 'PO_SHIP', sourceId: po.id, sourceNumber: po.po_number, sourceKey: `PO_SHIP:${po.id}`,
                lines: [
                  { code: acc('beban_angkut_beli'), debit: cashFreight, credit: 0, description: `Ongkir beli ${po.po_number}` },
                  { code: cashCode, debit: 0, credit: cashFreight, description: `Bayar ongkir beli ${po.po_number}` },
                ],
              });
            }
          }
        } catch (e) { console.error('sync po', po?.po_number, e?.message); }
      }
    } catch (e) { console.error('sync purch', e?.message); }

    // 5) PURCHASE PAYMENTS ----------------------------------------------
    try {
      const rows = sqlite.prepare(`SELECT pp.*, po.po_number po_number, po.invoice_number inv FROM purchase_payments pp
        JOIN purchase_order po ON po.id = pp.purchase_order_id`).all();
      for (const p of rows) {
        try {
          const amt = round2(p.amount); if (amt <= 0) continue;
          const invoiced = !!p.inv;
          const lines = [
            { code: invoiced ? acc('utang_usaha') : acc('uang_muka_pembelian'), debit: amt, credit: 0, description: `Bayar ${p.po_number}` },
            { code: payAcc(p), debit: 0, credit: amt },
          ];
          post({ date: p.payment_date, description: `Pembayaran ke Supplier ${p.po_number}`, sourceType: 'PPAY', sourceId: p.id, sourceNumber: p.po_number, sourceKey: `PPAY:${p.id}`, lines });
        } catch (e) { console.error('sync ppay', e?.message); }
      }
    } catch (e) { console.error('sync ppays', e?.message); }

    // 6) SALES RETURNS --------------------------------------------------
    try {
      const rows = sqlite.prepare(`SELECT sr.*, so.so_number so_number FROM sales_returns sr
        JOIN sales_order so ON so.id = sr.sales_order_id`).all();
      for (const r of rows) {
        try {
          const amt = round2(r.total_amount); if (amt <= 0) continue;
          const lines = [
            { code: acc('retur_penjualan'), debit: amt, credit: 0, description: `Retur ${r.return_number}` },
            { code: acc('piutang_usaha'), debit: 0, credit: amt },
          ];
          post({ date: r.return_date, description: `Retur Penjualan ${r.return_number}`, sourceType: 'SRET', sourceId: r.id, sourceNumber: r.return_number, sourceKey: `SRET:${r.id}`, lines });
        } catch (e) { console.error('sync sret', e?.message); }
      }
    } catch (e) { console.error('sync srets', e?.message); }

    // 7) PURCHASE RETURNS -----------------------------------------------
    try {
      const rows = sqlite.prepare(`SELECT pr.*, po.po_number po_number FROM purchase_returns pr
        JOIN purchase_order po ON po.id = pr.purchase_order_id`).all();
      for (const r of rows) {
        try {
          const amt = round2(r.total_amount); if (amt <= 0) continue;
          const lines = [
            { code: acc('utang_usaha'), debit: amt, credit: 0, description: `Retur ${r.return_number}` },
            { code: acc('persediaan'), debit: 0, credit: amt },
          ];
          post({ date: r.return_date, description: `Retur Pembelian ${r.return_number}`, sourceType: 'PRET', sourceId: r.id, sourceNumber: r.return_number, sourceKey: `PRET:${r.id}`, lines });
        } catch (e) { console.error('sync pret', e?.message); }
      }
    } catch (e) { console.error('sync prets', e?.message); }

    // 8) STOCK OPNAME (approved) — inventory variance -------------------
    try {
      const rows = sqlite.prepare(`SELECT * FROM stock_opname WHERE status='approved'`).all();
      const valStmt = sqlite.prepare(`SELECT COALESCE(SUM(soi.delta_weight * COALESCE(ist.hpp_per_kg,0)),0) v
        FROM stock_opname_items soi LEFT JOIN inventory_stock ist ON ist.id = soi.stock_id WHERE soi.opname_id=?`);
      for (const o of rows) {
        try {
          const val = round2(valStmt.get(o.id)?.v || 0);
          if (val === 0) continue;
          let lines;
          if (val < 0) lines = [{ code: acc('selisih_persediaan'), debit: -val, credit: 0, description: `Susut ${o.opname_number}` }, { code: acc('persediaan'), debit: 0, credit: -val }];
          else lines = [{ code: acc('persediaan'), debit: val, credit: 0, description: `Lebih ${o.opname_number}` }, { code: acc('selisih_persediaan'), debit: 0, credit: val }];
          post({ date: o.opname_date, description: `Penyesuaian Stok Opname ${o.opname_number}`, sourceType: 'OPN', sourceId: o.id, sourceNumber: o.opname_number, sourceKey: `OPN:${o.id}`, lines });
        } catch (e) { console.error('sync opn', e?.message); }
      }
    } catch (e) { console.error('sync opns', e?.message); }

    // 9) WORK ORDER (finalized) — conversion cost capitalized -----------
    try {
      const rows = sqlite.prepare(`SELECT * FROM work_order WHERE finalized_at IS NOT NULL OR pipeline_status='Selesai'`).all();
      for (const w of rows) {
        try {
          const added = round2((w.maklon_cost || 0) + (w.custom_cost_total || 0));
          if (added <= 0) continue;
          const lines = [
            { code: acc('persediaan'), debit: added, credit: 0, description: `Biaya olah ${w.wo_number}` },
            { code: acc('utang_biaya_produksi'), debit: 0, credit: added },
          ];
          post({ date: w.finalized_at || w.start_date, description: `Biaya Produksi (WO) ${w.wo_number}`, sourceType: 'WO', sourceId: w.id, sourceNumber: w.wo_number, sourceKey: `WO:${w.id}`, lines });
        } catch (e) { console.error('sync wo', e?.message); }
      }
    } catch (e) { console.error('sync wos', e?.message); }

    // 10) FIXED ASSET DEPRECIATION (monthly, straight-line) -------------
    try {
      const assets = sqlite.prepare(`SELECT * FROM fixed_assets WHERE archived_at IS NULL AND post_depreciation=1`).all();
      const now = new Date();
      const curYM = now.getFullYear() * 12 + now.getMonth(); // months since year 0
      for (const a of assets) {
        try {
          const life = Math.max(1, parseInt(a.useful_life_months || 0, 10));
          const cost = round2(a.acquisition_cost);
          const salvage = round2(a.salvage_value);
          const depreciable = round2(cost - salvage);
          if (depreciable <= 0) continue;
          const perMonth = round2(depreciable / life);
          const acq = new Date((a.acquisition_date || 0) * 1000);
          const acqYM = acq.getFullYear() * 12 + acq.getMonth();
          // last month to depreciate (inclusive): min(now, acq+life-1, disposed month)
          let endYM = Math.min(curYM, acqYM + life - 1);
          if (a.status === 'disposed' && a.disposed_date) {
            const dd = new Date(a.disposed_date * 1000);
            endYM = Math.min(endYM, dd.getFullYear() * 12 + dd.getMonth());
          }
          const expCode = a.expense_account_code || acc('beban_penyusutan');
          const accumCode = a.accum_account_code || acc('akumulasi_penyusutan');
          let posted = 0;
          for (let ym = acqYM; ym <= endYM; ym++) {
            const idx = ym - acqYM; // 0-based month index
            let amt = perMonth;
            // last installment rounds off remainder
            if (idx === life - 1) amt = round2(depreciable - perMonth * (life - 1));
            if (amt <= 0) continue;
            const y = Math.floor(ym / 12);
            const mo = ym % 12; // 0-11
            const lastDay = new Date(y, mo + 1, 0);
            const dateSec = Math.floor(lastDay.getTime() / 1000);
            const label = `${y}-${String(mo + 1).padStart(2, '0')}`;
            const lines = [
              { code: expCode, debit: amt, credit: 0, description: `Penyusutan ${a.name} (${label})` },
              { code: accumCode, debit: 0, credit: amt },
            ];
            const id = post({ date: dateSec, description: `Penyusutan ${a.name} — ${label}`, sourceType: 'DEPR', sourceId: a.id, sourceNumber: a.code || a.name, sourceKey: `DEPR:${a.id}:${label}`, lines });
            if (id) posted++;
          }
        } catch (e) { console.error('sync depr', a?.name, e?.message); }
      }
    } catch (e) { console.error('sync deprs', e?.message); }

    return n;
  });

  const count = tx();
  return { ok: true, count };
}

// ---------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------

// Balances aggregated from posted journals, optionally within [from,to].
function aggregate(sqlite, { from = null, to = null, excludeSources = null } = {}) {
  let where = `je.status='posted'`;
  const args = [];
  if (from != null) { where += ` AND je.entry_date >= ?`; args.push(from); }
  if (to != null) { where += ` AND je.entry_date <= ?`; args.push(to); }
  if (excludeSources && excludeSources.length) {
    where += ` AND je.source_type NOT IN (${excludeSources.map(() => '?').join(',')})`;
    args.push(...excludeSources);
  }
  const rows = sqlite.prepare(`SELECT jl.account_id, SUM(jl.debit) d, SUM(jl.credit) c
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
    WHERE ${where} GROUP BY jl.account_id`).all(...args);
  const map = {};
  for (const r of rows) map[r.account_id] = { debit: round2(r.d), credit: round2(r.c) };
  return map;
}

function accountsSorted(sqlite) {
  return sqlite.prepare(`SELECT * FROM gl_accounts ORDER BY code`).all();
}

// Net income (revenue - expenses) within a period
function netIncome(sqlite, { from = null, to = null, excludeClosing = false } = {}) {
  const agg = aggregate(sqlite, { from, to, excludeSources: excludeClosing ? ['CLOSING'] : null });
  const accs = accountsSorted(sqlite);
  let revenue = 0, cogs = 0, expense = 0, otherInc = 0, otherExp = 0;
  for (const a of accs) {
    const b = agg[a.id]; if (!b) continue;
    const net = round2(b.debit - b.credit);
    if (a.type === 'revenue') revenue += -net;         // credit-normal net positive
    else if (a.type === 'cogs') cogs += net;
    else if (a.type === 'expense') expense += net;
    else if (a.type === 'other_income') otherInc += -net;
    else if (a.type === 'other_expense') otherExp += net;
  }
  const grossProfit = round2(revenue - cogs);
  const operatingProfit = round2(grossProfit - expense);
  const net = round2(operatingProfit + otherInc - otherExp);
  return { revenue: round2(revenue), cogs: round2(cogs), grossProfit, expense: round2(expense), operatingProfit, otherIncome: round2(otherInc), otherExpense: round2(otherExp), netIncome: net };
}

export function trialBalance(sqlite, { to = null } = {}) {
  const agg = aggregate(sqlite, { to });
  const accs = accountsSorted(sqlite).filter((a) => a.is_postable);
  const rows = [];
  let totalDebit = 0, totalCredit = 0;
  for (const a of accs) {
    const b = agg[a.id] || { debit: 0, credit: 0 };
    const net = round2(b.debit - b.credit);
    if (b.debit === 0 && b.credit === 0) continue;
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    totalDebit += debit; totalCredit += credit;
    rows.push({ id: a.id, code: a.code, name: a.name, type: a.type, debit: round2(debit), credit: round2(credit) });
  }
  return { rows, totalDebit: round2(totalDebit), totalCredit: round2(totalCredit) };
}

export function ledger(sqlite, { accountId, from = null, to = null } = {}) {
  const a = sqlite.prepare(`SELECT * FROM gl_accounts WHERE id=?`).get(accountId);
  if (!a) return { account: null, opening: 0, rows: [], closing: 0 };
  // opening = balance before `from`
  let opening = 0;
  if (from != null) {
    const pre = sqlite.prepare(`SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id
      WHERE jl.account_id=? AND je.status='posted' AND je.entry_date < ?`).get(accountId, from);
    opening = a.normal_balance === 'credit' ? round2(pre.c - pre.d) : round2(pre.d - pre.c);
  }
  const args = [accountId];
  let where = `jl.account_id=? AND je.status='posted'`;
  if (from != null) { where += ` AND je.entry_date >= ?`; args.push(from); }
  if (to != null) { where += ` AND je.entry_date <= ?`; args.push(to); }
  const lines = sqlite.prepare(`SELECT je.entry_date, je.journal_number, je.source_type, je.source_number, je.description je_desc, jl.description ln_desc, jl.debit, jl.credit
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id
    WHERE ${where} ORDER BY je.entry_date, je.created_at`).all(...args);
  let running = opening;
  const rows = lines.map((l) => {
    const delta = a.normal_balance === 'credit' ? (l.credit - l.debit) : (l.debit - l.credit);
    running = round2(running + delta);
    return { date: l.entry_date, journalNumber: l.journal_number, sourceType: l.source_type, sourceNumber: l.source_number, description: l.ln_desc || l.je_desc, debit: round2(l.debit), credit: round2(l.credit), balance: running };
  });
  return { account: { id: a.id, code: a.code, name: a.name, type: a.type, normalBalance: a.normal_balance }, opening: round2(opening), rows, closing: running };
}

export function incomeStatement(sqlite, { from = null, to = null } = {}) {
  const agg = aggregate(sqlite, { from, to, excludeSources: ['CLOSING'] });
  const accs = accountsSorted(sqlite);
  const section = (types, sign) => {
    const items = [];
    let total = 0;
    for (const a of accs) {
      if (!a.is_postable || !types.includes(a.type)) continue;
      const b = agg[a.id]; if (!b) continue;
      const net = round2(b.debit - b.credit);
      const val = sign === 'credit' ? -net : net;
      if (val === 0) continue;
      items.push({ code: a.code, name: a.name, amount: round2(val) });
      total += val;
    }
    return { items, total: round2(total) };
  };
  const revenue = section(['revenue'], 'credit');
  const cogs = section(['cogs'], 'debit');
  const expense = section(['expense'], 'debit');
  const otherIncome = section(['other_income'], 'credit');
  const otherExpense = section(['other_expense'], 'debit');
  const grossProfit = round2(revenue.total - cogs.total);
  const operatingProfit = round2(grossProfit - expense.total);
  const netIncomeVal = round2(operatingProfit + otherIncome.total - otherExpense.total);
  return { revenue, cogs, grossProfit, expense, operatingProfit, otherIncome, otherExpense, netIncome: netIncomeVal };
}

export function balanceSheet(sqlite, { asOf = null } = {}) {
  const agg = aggregate(sqlite, { to: asOf });
  const accs = accountsSorted(sqlite);
  const groups = { asset: {}, liability: {}, equity: {} };
  const build = (type) => {
    const cats = {};
    for (const a of accs) {
      if (!a.is_postable || a.type !== type) continue;
      const b = agg[a.id]; if (!b) continue;
      const net = round2(b.debit - b.credit);
      const val = type === 'asset' ? net : -net; // liab/equity credit-normal
      if (val === 0) continue;
      const cat = a.category || 'Lainnya';
      if (!cats[cat]) cats[cat] = { category: cat, items: [], total: 0 };
      cats[cat].items.push({ code: a.code, name: a.name, amount: round2(val) });
      cats[cat].total = round2(cats[cat].total + val);
    }
    const arr = Object.values(cats);
    const total = round2(arr.reduce((s, g) => s + g.total, 0));
    return { groups: arr, total };
  };
  const assets = build('asset');
  const liabilities = build('liability');
  const equity = build('equity');
  // current period P&L (cumulative up to asOf) -> add to equity
  const ni = netIncome(sqlite, { to: asOf }).netIncome;
  equity.groups.push({ category: 'Laba (Rugi) Berjalan', items: [{ code: '3-9000', name: 'Laba (Rugi) Tahun Berjalan', amount: ni }], total: ni });
  equity.total = round2(equity.total + ni);
  const totalLiabEquity = round2(liabilities.total + equity.total);
  return { assets, liabilities, equity, totalAssets: assets.total, totalLiabilitiesEquity: totalLiabEquity, balanced: Math.abs(assets.total - totalLiabEquity) < 1 };
}

export function cashFlow(sqlite, { from = null, to = null } = {}) {
  const map = getMapping(sqlite);
  const { byCode } = loadAccounts(sqlite);
  const cashIds = new Set();
  for (const key of ['kas', 'bank']) { const a = byCode[map[key]]; if (a) cashIds.add(a.id); }
  // also include any other account named cash-like? keep to mapping for clarity

  const beginBal = (() => {
    if (from == null) return 0;
    let s = 0;
    for (const id of cashIds) {
      const r = sqlite.prepare(`SELECT COALESCE(SUM(jl.debit-jl.credit),0) v FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id WHERE jl.account_id=? AND je.status='posted' AND je.entry_date < ?`).get(id, from);
      s += r.v;
    }
    return round2(s);
  })();

  // gather journals in period that touch cash
  const args = [];
  let where = `je.status='posted'`;
  if (from != null) { where += ` AND je.entry_date >= ?`; args.push(from); }
  if (to != null) { where += ` AND je.entry_date <= ?`; args.push(to); }
  const entries = sqlite.prepare(`SELECT DISTINCT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_id=je.id
    WHERE ${where} AND jl.account_id IN (${[...cashIds].map(() => '?').join(',') || "''"})`).all(...args, ...[...cashIds]);

  const cats = { operating: 0, investing: 0, financing: 0 };
  const lineStmt = sqlite.prepare(`SELECT jl.*, ga.type gtype, ga.cash_flow_category cf FROM journal_lines jl JOIN gl_accounts ga ON ga.id=jl.account_id WHERE jl.journal_id=?`);
  for (const e of entries) {
    const lines = lineStmt.all(e.id);
    let cashDelta = 0;
    let counterCat = 'operating';
    let bestAmt = -1;
    for (const l of lines) {
      if (cashIds.has(l.account_id)) { cashDelta += (l.debit - l.credit); }
      else {
        const amt = Math.abs(l.debit - l.credit);
        if (amt > bestAmt) { bestAmt = amt; counterCat = l.cf || 'operating'; }
      }
    }
    cashDelta = round2(cashDelta);
    if (cashDelta === 0) continue;
    const cat = ['operating', 'investing', 'financing'].includes(counterCat) ? counterCat : 'operating';
    cats[cat] = round2(cats[cat] + cashDelta);
  }
  const netChange = round2(cats.operating + cats.investing + cats.financing);
  return { beginningCash: beginBal, operating: cats.operating, investing: cats.investing, financing: cats.financing, netChange, endingCash: round2(beginBal + netChange) };
}

// Overview KPIs for the accounting dashboard
export function overview(sqlite) {
  const map = getMapping(sqlite);
  const { byCode } = loadAccounts(sqlite);
  const now = nowSec();
  const agg = aggregate(sqlite, { to: now });
  const balOf = (code, positiveSide) => {
    const a = byCode[code]; if (!a) return 0;
    const b = agg[a.id]; if (!b) return 0;
    const net = round2(b.debit - b.credit);
    return positiveSide === 'credit' ? -net : net;
  };
  // Kas & Bank: sum ALL accounts in the cash/bank block (code prefix 1-11xx) so that
  // user-added Kas/Bank accounts are included too (previously only the 2 default codes 1-1110 & 1-1120).
  const sumPrefix = (prefix) => {
    let t = 0;
    for (const code in byCode) {
      if (!code.startsWith(prefix)) continue;
      const b = agg[byCode[code].id]; if (!b) continue;
      t += round2(b.debit - b.credit);
    }
    return round2(t);
  };
  const kas = sumPrefix('1-111');          // Kas family (1-1110, 1-111x)
  const cashTotal = sumPrefix('1-11');     // entire Kas & Bank block (1-11xx)
  const bank = round2(cashTotal - kas);    // everything else in the block = Bank accounts
  const piutang = balOf(map.piutang_usaha, 'debit');
  const utang = balOf(map.utang_usaha, 'credit');
  const persediaan = balOf(map.persediaan, 'debit');
  const year = new Date().getFullYear();
  const ytdFrom = toSec(`${year}-01-01`);
  const monthFrom = toSec(`${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`);
  const ni = netIncome(sqlite, { from: ytdFrom, to: now, excludeClosing: true });
  const niM = netIncome(sqlite, { from: monthFrom, to: now, excludeClosing: true });
  const jCount = sqlite.prepare(`SELECT COUNT(*) c FROM journal_entries WHERE status='posted'`).get().c;
  return {
    cash: round2(kas + bank), kas: round2(kas), bank: round2(bank),
    piutang: round2(piutang), utang: round2(utang), persediaan: round2(persediaan),
    netIncomeYtd: ni.netIncome, revenueYtd: ni.revenue, netIncomeMonth: niM.netIncome,
    journalCount: jCount,
  };
}

// Create a manual journal entry (validated & balanced). lines: [{accountId, debit, credit, description}]
export function createManualJournal(sqlite, { date, description, lines = [], createdBy = null }) {
  const { byId } = loadAccounts(sqlite);
  const norm = lines
    .map((l) => {
      const acc = byId[l.accountId];
      if (!acc || !acc.is_postable) return null;
      return { acc, debit: round2(l.debit || 0), credit: round2(l.credit || 0), description: l.description || '' };
    })
    .filter((l) => l && (l.debit !== 0 || l.credit !== 0));
  if (norm.length < 2) return { error: 'Minimal 2 baris akun dengan nilai.' };
  const td = round2(norm.reduce((s, l) => s + l.debit, 0));
  const tc = round2(norm.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(td - tc) > 0.01) return { error: `Jurnal tidak seimbang: Debit ${td} ≠ Kredit ${tc}.` };
  const entryDate = toSec(date) || nowSec();
  // manual journal number: JU-YYMM-NNN
  const d = new Date(entryDate * 1000);
  const ym = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `JU-${ym}-`;
  const last = sqlite.prepare(`SELECT journal_number FROM journal_entries WHERE journal_number LIKE ? ORDER BY journal_number DESC LIMIT 1`).get(prefix + '%');
  let seq = 1;
  if (last) { const m = /-(\d+)$/.exec(last.journal_number); if (m) seq = parseInt(m[1], 10) + 1; }
  const num = `${prefix}${String(seq).padStart(3, '0')}`;
  const jid = uuidv4();
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO journal_entries (id, journal_number, entry_date, description, source_type, is_auto, status, total_debit, total_credit, created_by, created_at)
      VALUES (?,?,?,?, 'MANUAL', 0, 'posted', ?, ?, ?, unixepoch())`).run(jid, num, entryDate, description || null, td, tc, createdBy);
    const insL = sqlite.prepare(`INSERT INTO journal_lines (id, journal_id, account_id, account_code, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)`);
    norm.forEach((l, i) => insL.run(uuidv4(), jid, l.acc.id, l.acc.code, l.description || null, l.debit, l.credit, i));
  });
  tx();
  return { ok: true, id: jid, journalNumber: num };
}

export function getJournal(sqlite, id) {
  const je = sqlite.prepare(`SELECT * FROM journal_entries WHERE id=?`).get(id);
  if (!je) return null;
  const lines = sqlite.prepare(`SELECT jl.*, ga.name account_name FROM journal_lines jl LEFT JOIN gl_accounts ga ON ga.id=jl.account_id WHERE jl.journal_id=? ORDER BY jl.sort_order`).all(id);
  return { ...je, lines };
}

export function listJournals(sqlite, { from = null, to = null, source = null, q = null, limit = 200 } = {}) {
  const args = [];
  let where = `1=1`;
  if (from != null) { where += ` AND entry_date >= ?`; args.push(from); }
  if (to != null) { where += ` AND entry_date <= ?`; args.push(to); }
  if (source) { where += ` AND source_type = ?`; args.push(source); }
  if (q) { where += ` AND (journal_number LIKE ? OR description LIKE ? OR source_number LIKE ?)`; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = sqlite.prepare(`SELECT * FROM journal_entries WHERE ${where} ORDER BY entry_date DESC, created_at DESC LIMIT ?`).all(...args, limit);
  return rows;
}

// ---------------------------------------------------------------------
// SALES PROFIT REPORT (Laporan Laba Penjualan) — gross profit by period & customer
// ---------------------------------------------------------------------
export function salesProfitReport(sqlite, { from = null, to = null } = {}) {
  const sos = sqlite.prepare(`SELECT so.*, COALESCE(c.display_name, c.company_name) customer_name FROM sales_order so
    LEFT JOIN contacts c ON c.id = so.customer_id
    WHERE (so.archived_at IS NULL)
      AND (so.invoice_number IS NOT NULL OR so.pipeline_status IN ('Shipped','Invoiced','Selesai'))`).all();
  const cogsStock = sqlite.prepare(`SELECT COALESCE(SUM(weight*hpp_per_kg),0) v FROM so_item_stocks WHERE sales_order_id=?`);
  const linkedPo = sqlite.prepare(`SELECT total_amount FROM purchase_order WHERE sales_order_id=? OR id=? LIMIT 1`);
  const byCustomer = {}, byMonth = {};
  const orders = [];
  let tRev = 0, tCogs = 0, tShip = 0, cnt = 0;
  for (const so of sos) {
    const date = so.invoice_date || so.order_date;
    if (from != null && date < from) continue;
    if (to != null && date > to) continue;
    const shipCost = round2(so.shipping_cost || 0);
    const buyerShip = (so.shipping_bearer === 'buyer') ? shipCost : 0;   // pass-through (netral)
    const sellerShip = (so.shipping_bearer === 'buyer') ? 0 : shipCost;  // ditanggung penjual -> kurangi laba
    const revenue = round2(Number(so.total_amount) - buyerShip);          // pendapatan barang (kecualikan ongkir pembeli)
    if (revenue <= 0) continue;
    let cogs = 0;
    if (String(so.fulfillment_type) === 'dropship') cogs = round2(linkedPo.get(so.id, so.auto_po_id || '')?.total_amount || 0);
    else cogs = round2(cogsStock.get(so.id)?.v || 0);
    const gp = round2(revenue - cogs - sellerShip);
    const ck = so.customer_id || '-';
    if (!byCustomer[ck]) byCustomer[ck] = { customerId: ck, customer: so.customer_name || '(Tanpa nama)', orders: 0, revenue: 0, cogs: 0, shipping: 0, grossProfit: 0 };
    byCustomer[ck].orders++; byCustomer[ck].revenue += revenue; byCustomer[ck].cogs += cogs; byCustomer[ck].shipping += sellerShip; byCustomer[ck].grossProfit += gp;
    const d = new Date(date * 1000);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[mk]) byMonth[mk] = { month: mk, orders: 0, revenue: 0, cogs: 0, shipping: 0, grossProfit: 0 };
    byMonth[mk].orders++; byMonth[mk].revenue += revenue; byMonth[mk].cogs += cogs; byMonth[mk].shipping += sellerShip; byMonth[mk].grossProfit += gp;
    orders.push({ id: so.id, soNumber: so.so_number, date, customer: so.customer_name || '-', type: so.fulfillment_type, revenue, cogs, shipping: sellerShip, grossProfit: gp, margin: revenue ? round2(gp / revenue * 100) : 0 });
    tRev += revenue; tCogs += cogs; tShip += sellerShip; cnt++;
  }
  const fin = (o) => { o.revenue = round2(o.revenue); o.cogs = round2(o.cogs); o.shipping = round2(o.shipping || 0); o.grossProfit = round2(o.grossProfit); o.margin = o.revenue ? round2(o.grossProfit / o.revenue * 100) : 0; return o; };
  const customers = Object.values(byCustomer).map(fin).sort((a, b) => b.grossProfit - a.grossProfit);
  const months = Object.values(byMonth).map(fin).sort((a, b) => a.month.localeCompare(b.month));
  orders.sort((a, b) => b.date - a.date);
  const tGp = round2(tRev - tCogs - tShip);
  return { byCustomer: customers, byMonth: months, orders, totals: { orders: cnt, revenue: round2(tRev), cogs: round2(tCogs), shipping: round2(tShip), grossProfit: tGp, margin: tRev ? round2(tGp / tRev * 100) : 0 } };
}

// ---------------------------------------------------------------------
// PERIOD CLOSING (Tutup Buku) — move period P&L to Retained Earnings
// ---------------------------------------------------------------------
export function listClosings(sqlite) {
  return sqlite.prepare(`SELECT * FROM period_closings ORDER BY period DESC`).all();
}

export function createClosing(sqlite, { period, createdBy = null }) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) return { error: 'Format periode harus YYYY-MM' };
  if (sqlite.prepare('SELECT 1 FROM period_closings WHERE period=?').get(period)) return { error: `Periode ${period} sudah ditutup.` };
  const [y, m] = period.split('-').map(Number);
  const from = Math.floor(new Date(y, m - 1, 1).getTime() / 1000);
  const to = Math.floor(new Date(y, m, 0, 23, 59, 59).getTime() / 1000);
  const { byCode } = loadAccounts(sqlite);
  const map = getMapping(sqlite);
  const ldCode = map['laba_ditahan'];
  if (!byCode[ldCode]) return { error: 'Akun Laba Ditahan belum dipetakan.' };
  const agg = aggregate(sqlite, { from, to, excludeSources: ['CLOSING'] });
  const accs = accountsSorted(sqlite).filter((a) => ['revenue', 'cogs', 'expense', 'other_income', 'other_expense'].includes(a.type) && a.is_postable);
  const lines = [];
  let totDr = 0, totCr = 0;
  for (const a of accs) {
    const b = agg[a.id]; if (!b) continue;
    const net = round2(b.debit - b.credit);
    if (net === 0) continue;
    if (net > 0) { lines.push({ code: a.code, debit: 0, credit: net, description: `Tutup ${a.name}` }); totCr += net; }
    else { lines.push({ code: a.code, debit: -net, credit: 0, description: `Tutup ${a.name}` }); totDr += -net; }
  }
  if (lines.length === 0) return { error: `Tidak ada saldo laba/rugi pada periode ${period}.` };
  const netIncomeVal = round2(totDr - totCr); // profit if > 0
  if (netIncomeVal > 0) lines.push({ code: ldCode, debit: 0, credit: netIncomeVal, description: 'Laba periode ke Laba Ditahan' });
  else if (netIncomeVal < 0) lines.push({ code: ldCode, debit: -netIncomeVal, credit: 0, description: 'Rugi periode ke Laba Ditahan' });
  const closingDate = to;
  const jid = insertJournalByCode(sqlite, byCode, {
    date: closingDate, description: `Tutup Buku ${period}`, sourceType: 'CLOSING',
    sourceNumber: period, sourceKey: `CLOSING:${period}`, journalNumber: `TB-${period}`, isAuto: 0, createdBy, lines,
  });
  const id = uuidv4();
  sqlite.prepare(`INSERT INTO period_closings (id, period, closing_date, journal_id, net_income, status, created_by, created_at)
    VALUES (?,?,?,?,?, 'closed', ?, unixepoch())`).run(id, period, closingDate, jid, netIncomeVal, createdBy);
  return { ok: true, id, period, netIncome: netIncomeVal, journalId: jid };
}

export function deleteClosing(sqlite, id) {
  const row = sqlite.prepare('SELECT * FROM period_closings WHERE id=?').get(id);
  if (!row) return { error: 'Data tutup buku tidak ditemukan' };
  if (row.journal_id) sqlite.prepare('DELETE FROM journal_entries WHERE id=?').run(row.journal_id);
  sqlite.prepare('DELETE FROM period_closings WHERE id=?').run(id);
  return { ok: true };
}

// ---------------------------------------------------------------------
// FIXED ASSET status (accumulated depreciation & book value from journals)
// ---------------------------------------------------------------------
export function fixedAssetStatus(sqlite, asset) {
  const r = sqlite.prepare(`SELECT COALESCE(SUM(jl.credit),0) accum, COUNT(DISTINCT je.id) months
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id
    WHERE je.source_type='DEPR' AND je.source_id=? AND je.status='posted'`).get(asset.id);
  const accum = round2(r?.accum || 0);
  const cost = round2(asset.acquisition_cost);
  const monthly = asset.useful_life_months ? round2((cost - round2(asset.salvage_value)) / asset.useful_life_months) : 0;
  return { accumulated: accum, bookValue: round2(cost - accum), monthsPosted: r?.months || 0, monthlyDepreciation: monthly };
}

// ---------------------------------------------------------------------
// PENCATATAN CEPAT (Quick Entry) — simple cash/bank transactions that
// auto-build the correct double-entry journal (no debit/credit UI needed).
// ---------------------------------------------------------------------
export const CASH_SOURCES = ['EXPENSE', 'INCOME', 'CAPITAL', 'DRAWING', 'TRANSFER'];

function nextManualNumber(sqlite, entryDate) {
  const d = new Date(entryDate * 1000);
  const ym = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `JU-${ym}-`;
  const last = sqlite.prepare(`SELECT journal_number FROM journal_entries WHERE journal_number LIKE ? ORDER BY journal_number DESC LIMIT 1`).get(prefix + '%');
  let seq = 1;
  if (last) { const m = /-(\d+)$/.exec(last.journal_number); if (m) seq = parseInt(m[1], 10) + 1; }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

export function createQuickEntry(sqlite, { type, date, amount, categoryCode, cashCode, cashCode2, note, attachment = null, createdBy = null }) {
  const amt = round2(amount);
  if (!CASH_SOURCES.includes(type)) return { error: 'Jenis transaksi tidak dikenal.' };
  if (!(amt > 0)) return { error: 'Nominal harus lebih dari 0.' };
  const { byCode } = loadAccounts(sqlite);
  const map = getMapping(sqlite);
  const need = (code, label) => { if (!code || !byCode[code]) throw new Error(`Akun ${label} belum ada/dipetakan (${code || '-'}).`); return code; };
  let lines;
  try {
    if (type === 'EXPENSE') {
      lines = [{ code: need(categoryCode, 'beban'), debit: amt, credit: 0 }, { code: need(cashCode, 'kas/bank'), debit: 0, credit: amt }];
    } else if (type === 'INCOME') {
      lines = [{ code: need(cashCode, 'kas/bank'), debit: amt, credit: 0 }, { code: need(categoryCode, 'pendapatan'), debit: 0, credit: amt }];
    } else if (type === 'CAPITAL') {
      lines = [{ code: need(cashCode, 'kas/bank'), debit: amt, credit: 0 }, { code: need(map.modal, 'modal'), debit: 0, credit: amt }];
    } else if (type === 'DRAWING') {
      const prive = byCode['3-1300'] ? '3-1300' : map.modal;
      lines = [{ code: need(prive, 'prive'), debit: amt, credit: 0 }, { code: need(cashCode, 'kas/bank'), debit: 0, credit: amt }];
    } else if (type === 'TRANSFER') {
      if (cashCode === cashCode2) return { error: 'Akun asal dan tujuan tidak boleh sama.' };
      lines = [{ code: need(cashCode2, 'tujuan'), debit: amt, credit: 0 }, { code: need(cashCode, 'asal'), debit: 0, credit: amt }];
    }
  } catch (e) { return { error: e.message }; }

  const entryDate = toSec(date) || nowSec();
  const num = nextManualNumber(sqlite, entryDate);
  const jid = uuidv4();
  const norm = lines.map((l) => ({ acc: byCode[l.code], debit: round2(l.debit), credit: round2(l.credit) }));
  const td = round2(norm.reduce((s, l) => s + l.debit, 0));
  const tc = round2(norm.reduce((s, l) => s + l.credit, 0));
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO journal_entries (id, journal_number, entry_date, description, source_type, is_auto, status, total_debit, total_credit, attachment, created_by, created_at)
      VALUES (?,?,?,?,?,0,'posted',?,?,?,?,unixepoch())`).run(jid, num, entryDate, note || null, type, td, tc, attachment || null, createdBy);
    const insL = sqlite.prepare(`INSERT INTO journal_lines (id, journal_id, account_id, account_code, description, debit, credit, sort_order) VALUES (?,?,?,?,?,?,?,?)`);
    norm.forEach((l, i) => insL.run(uuidv4(), jid, l.acc.id, l.acc.code, note || null, l.debit, l.credit, i));
  });
  tx();
  return { ok: true, id: jid, journalNumber: num };
}

export function updateQuickEntry(sqlite, id, payload) {
  const cur = sqlite.prepare('SELECT * FROM journal_entries WHERE id=?').get(id);
  if (!cur) return { error: 'Transaksi tidak ditemukan' };
  if (cur.is_auto) return { error: 'Transaksi otomatis tidak dapat diedit di sini' };
  // recreate: delete old then create new (keeps logic in one place)
  const keepAttachment = payload.attachment === undefined ? cur.attachment : payload.attachment;
  sqlite.prepare('DELETE FROM journal_entries WHERE id=?').run(id);
  return createQuickEntry(sqlite, { ...payload, attachment: keepAttachment });
}

export function getAttachment(sqlite, id) {
  const r = sqlite.prepare('SELECT attachment FROM journal_entries WHERE id=?').get(id);
  return r?.attachment || null;
}

export function listCashbook(sqlite, { from = null, to = null, type = null, limit = 300 } = {}) {
  const args = [];
  let where = `je.is_auto=0 AND je.source_type IN (${CASH_SOURCES.map(() => '?').join(',')})`;
  args.push(...CASH_SOURCES);
  if (type && CASH_SOURCES.includes(type)) { where += ` AND je.source_type=?`; args.push(type); }
  if (from != null) { where += ` AND je.entry_date >= ?`; args.push(from); }
  if (to != null) { where += ` AND je.entry_date <= ?`; args.push(to); }
  const entries = sqlite.prepare(`SELECT * FROM journal_entries je WHERE ${where} ORDER BY je.entry_date DESC, je.created_at DESC LIMIT ?`).all(...args, limit);
  const lineStmt = sqlite.prepare(`SELECT jl.*, ga.name account_name, ga.type account_type FROM journal_lines jl LEFT JOIN gl_accounts ga ON ga.id=jl.account_id WHERE jl.journal_id=? ORDER BY jl.sort_order`);
  return entries.map((e) => {
    const lines = lineStmt.all(e.id);
    const dr = lines.find((l) => l.debit > 0) || {};
    const cr = lines.find((l) => l.credit > 0) || {};
    let category = '', categoryCode = '', cash = '', cashCode = '', cashCode2 = '', direction = '';
    if (e.source_type === 'EXPENSE') { category = dr.account_name; categoryCode = dr.account_code; cash = cr.account_name; cashCode = cr.account_code; direction = 'out'; }
    else if (e.source_type === 'INCOME') { category = cr.account_name; categoryCode = cr.account_code; cash = dr.account_name; cashCode = dr.account_code; direction = 'in'; }
    else if (e.source_type === 'CAPITAL') { category = cr.account_name; categoryCode = cr.account_code; cash = dr.account_name; cashCode = dr.account_code; direction = 'in'; }
    else if (e.source_type === 'DRAWING') { category = dr.account_name; categoryCode = dr.account_code; cash = cr.account_name; cashCode = cr.account_code; direction = 'out'; }
    else if (e.source_type === 'TRANSFER') { category = `${cr.account_name} → ${dr.account_name}`; cash = ''; cashCode = cr.account_code; cashCode2 = dr.account_code; direction = 'move'; }
    return {
      id: e.id, journalNumber: e.journal_number, date: e.entry_date, type: e.source_type,
      amount: round2(e.total_debit), category, categoryCode, cash, cashCode, cashCode2, direction,
      note: e.description, hasAttachment: !!e.attachment,
      fromName: cr.account_name, toName: dr.account_name,
    };
  });
}
