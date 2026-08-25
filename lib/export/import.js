// Master Data import (Phase 2): Products, Contacts, Chart of Accounts (gl_accounts).
// Called by POST /api/import/:module with { rows: [ {header: value} ] } parsed from an .xlsx by the client.
// Products & Contacts dual-write to MongoDB (authoritative) + SQLite mirror (via passed deps).
// Chart of Accounts writes to SQLite gl_accounts (raw) — backed up to Mongo via GridFS persistence.

// --- helpers ---
const norm = (k) => String(k == null ? '' : k).trim().toLowerCase().replace(/\s+/g, ' ');
const pick = (row, aliases) => {
  const map = {};
  for (const k of Object.keys(row)) map[norm(k)] = row[k];
  for (const a of aliases) { const v = map[norm(a)]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; }
  return undefined;
};
const toNum = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};
const str = (v) => (v === undefined || v === null) ? '' : String(v).trim();
const isEmptyRow = (row) => Object.values(row).every(v => v === undefined || v === null || String(v).trim() === '');

// Map free-text contact type -> canonical category
const CAT_MAP = {
  'customer': 'Customer', 'pelanggan': 'Customer', 'cust': 'Customer',
  'supplier': 'Supplier', 'pemasok': 'Supplier', 'vendor': 'Supplier',
  'rph': 'RPH', 'karyawan': 'Karyawan', 'employee': 'Karyawan',
  'mitra': 'Mitra', 'partner': 'Mitra', 'agen': 'Agen', 'agent': 'Agen',
  'dropshipper': 'Dropshipper', 'dropship': 'Dropshipper',
};
const parseCategories = (v) => {
  const raw = str(v);
  if (!raw) return ['Customer'];
  const parts = raw.split(/[,;/|]/).map(p => norm(p)).filter(Boolean);
  const cats = [];
  for (const p of parts) { const c = CAT_MAP[p]; if (c && !cats.includes(c)) cats.push(c); }
  return cats.length ? cats : ['Customer'];
};

const VALID_ACCT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'];
const normType = (v) => {
  const t = norm(v);
  const m = { aset: 'asset', aktiva: 'asset', kewajiban: 'liability', 'liabilitas': 'liability', hutang: 'liability', utang: 'liability', modal: 'equity', ekuitas: 'equity', pendapatan: 'revenue', penjualan: 'revenue', hpp: 'cogs', 'beban pokok': 'cogs', beban: 'expense', biaya: 'expense' };
  if (VALID_ACCT_TYPES.includes(t)) return t;
  return m[t] || '';
};
const normNB = (v, type) => {
  const t = norm(v);
  if (t === 'debit' || t === 'debet' || t === 'd') return 'debit';
  if (t === 'credit' || t === 'kredit' || t === 'k' || t === 'c') return 'credit';
  // default per account type
  return (type === 'asset' || type === 'cogs' || type === 'expense') ? 'debit' : 'credit';
};

// --- module importers ---
async function importProducts(deps, rows) {
  const { db, s, md, uuidv4 } = deps;
  const rep = { module: 'products', created: 0, updated: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; const rn = i + 2; // +2: header row + 1-based
    if (isEmptyRow(row)) { rep.skipped++; continue; }
    try {
      const sku = str(pick(row, ['SKU', 'Kode', 'Kode Produk', 'Default Code', 'Internal Reference']));
      const name = str(pick(row, ['Nama', 'Nama Produk', 'Name', 'Product Name']));
      if (!sku) { rep.errors.push({ row: rn, message: 'SKU wajib diisi' }); continue; }
      if (!name) { rep.errors.push({ row: rn, message: 'Nama wajib diisi' }); continue; }
      const patch = {
        sku, name,
        category: str(pick(row, ['Kategori', 'Category'])) || null,
        subCategory: str(pick(row, ['Sub Kategori', 'Subkategori', 'Sub Category'])) || null,
        unit: str(pick(row, ['Satuan', 'Unit', 'UoM'])) || 'kg',
        weightUnit: str(pick(row, ['Satuan Berat', 'Weight Unit'])) || 'kg',
        packagingType: str(pick(row, ['Jenis Kemasan', 'Kemasan', 'Packaging'])) || null,
        basePrice: toNum(pick(row, ['Harga Jual', 'Harga', 'Base Price', 'Sales Price', 'Price'])),
        minStock: toNum(pick(row, ['Stok Minimum', 'Min Stock', 'Minimum Stock'])),
        shelfLifeDays: Math.round(toNum(pick(row, ['Masa Simpan (hari)', 'Masa Simpan', 'Shelf Life']))),
        description: str(pick(row, ['Keterangan', 'Deskripsi', 'Description'])) || null,
        updatedAt: new Date(),
      };
      const existing = await md.mdFindOne(md.MD.products, { sku });
      if (existing) {
        await md.mdUpdate(md.MD.products, existing.id, patch);
        try { deps.updateSqlite('products', existing.id, patch); } catch (e) {}
        rep.updated++;
      } else {
        const now = new Date();
        const doc = { id: uuidv4(), status: 'active', rendemenCoefficient: 1, archivedAt: null, createdAt: now, ...patch };
        await md.mdInsert(md.MD.products, doc);
        try { deps.insertSqlite('products', doc); } catch (e) { rep.errors.push({ row: rn, message: 'Mirror SQLite gagal: ' + e.message }); }
        rep.created++;
      }
    } catch (e) { rep.errors.push({ row: rn, message: e.message }); }
  }
  return rep;
}

async function importContacts(deps, rows) {
  const { md, uuidv4 } = deps;
  const rep = { module: 'contacts', created: 0, updated: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; const rn = i + 2;
    if (isEmptyRow(row)) { rep.skipped++; continue; }
    try {
      const displayName = str(pick(row, ['Nama', 'Nama Kontak', 'Name', 'Display Name']));
      if (!displayName) { rep.errors.push({ row: rn, message: 'Nama wajib diisi' }); continue; }
      const cats = parseCategories(pick(row, ['Tipe', 'Kategori', 'Type', 'Tipe Kontak']));
      let code = str(pick(row, ['Kode', 'Code', 'Reference']));
      const base = {
        displayName,
        companyName: str(pick(row, ['Nama Perusahaan', 'Company', 'Company Name'])) || null,
        phone: str(pick(row, ['Telepon', 'Telp', 'Phone', 'HP', 'No HP'])) || null,
        email: str(pick(row, ['Email', 'E-mail'])) || null,
        address: str(pick(row, ['Alamat', 'Address'])) || null,
        city: str(pick(row, ['Kota', 'City'])) || null,
        province: str(pick(row, ['Provinsi', 'Province'])) || null,
        npwp: str(pick(row, ['NPWP'])) || null,
        taxStatus: str(pick(row, ['Status Pajak', 'Tax Status'])) || null,
        bankName: str(pick(row, ['Bank', 'Nama Bank', 'Bank Name'])) || null,
        bankAccount: str(pick(row, ['No Rekening', 'Rekening', 'Bank Account'])) || null,
        notes: str(pick(row, ['Keterangan', 'Catatan', 'Notes'])) || null,
        contactType: cats[0],
        categories: JSON.stringify(cats),
        isAgent: cats.includes('Agen'),
        isDropshipper: cats.includes('Dropshipper'),
        updatedAt: new Date(),
      };
      // Find existing by code (if given) else by displayName + primary category
      let existing = null;
      if (code) existing = await md.mdFindOne(md.MD.contacts, { code });
      if (!existing && !code) existing = await md.mdFindOne(md.MD.contacts, { displayName, contactType: cats[0] });
      if (existing) {
        await md.mdUpdate(md.MD.contacts, existing.id, base);
        try { deps.updateSqlite('contacts', existing.id, base); } catch (e) {}
        rep.updated++;
      } else {
        if (!code) code = await deps.genContactCode(cats[0]);
        else { const dup = await md.mdFindOne(md.MD.contacts, { code }); if (dup) { rep.errors.push({ row: rn, message: `Kode "${code}" sudah dipakai kontak lain` }); continue; } }
        const now = new Date();
        const doc = { id: uuidv4(), code, isSubscriber: false, creditLimit: 0, prepaidBalance: 0, agentDiscountPct: 0, commissionValue: 0, status: 'active', archivedAt: null, createdAt: now, ...base };
        await md.mdInsert(md.MD.contacts, doc);
        try { deps.insertSqlite('contacts', doc); } catch (e) { rep.errors.push({ row: rn, message: 'Mirror SQLite gagal: ' + e.message }); }
        rep.created++;
      }
    } catch (e) { rep.errors.push({ row: rn, message: e.message }); }
  }
  return rep;
}

async function importChartOfAccounts(deps, rows) {
  const { raw } = deps;
  const coaMongo = await import('@/lib/accounting/coa-mongo');
  const rep = { module: 'chart-of-accounts', created: 0, updated: 0, skipped: 0, errors: [] };
  await coaMongo.coaEnsureSeeded(raw); // pastikan Mongo COA terisi sebelum upsert
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; const rn = i + 2;
    if (isEmptyRow(row)) { rep.skipped++; continue; }
    try {
      const code = str(pick(row, ['Kode Akun', 'Kode', 'Code', 'Account Code']));
      const name = str(pick(row, ['Nama Akun', 'Nama', 'Name', 'Account Name']));
      if (!code) { rep.errors.push({ row: rn, message: 'Kode Akun wajib diisi' }); continue; }
      if (!name) { rep.errors.push({ row: rn, message: 'Nama Akun wajib diisi' }); continue; }
      const type = normType(pick(row, ['Tipe', 'Type', 'Jenis']));
      if (!type) { rep.errors.push({ row: rn, message: 'Tipe akun tidak valid (asset/liability/equity/revenue/cogs/expense)' }); continue; }
      const nb = normNB(pick(row, ['Saldo Normal', 'Normal Balance', 'Sisi']), type);
      const category = str(pick(row, ['Kategori', 'Category'])) || null;
      const parent = str(pick(row, ['Akun Induk', 'Parent', 'Parent Code'])) || null;
      const opening = toNum(pick(row, ['Saldo Awal', 'Opening Balance', 'Saldo Awal (Rp)']));
      const r = await coaMongo.coaUpsertByCode({
        code, name, type, normal_balance: nb, category, parent_code: parent,
        cash_flow_category: 'operating', is_postable: 1, is_system: 0, opening_balance: opening,
      });
      if (r.created) rep.created++; else rep.updated++;
    } catch (e) { rep.errors.push({ row: rn, message: e.message }); }
  }
  // refresh per-pod SQLite mirror so the accounting engine sees the imported COA
  try { await coaMongo.hydrateCoaToSqlite(raw); } catch (e) { /* ignore */ }
  return rep;
}

export async function importMasterData(deps, module, rows) {
  if (!Array.isArray(rows)) return { error: 'rows harus berupa array' };
  if (module === 'products') return importProducts(deps, rows);
  if (module === 'contacts') return importContacts(deps, rows);
  if (module === 'chart-of-accounts') return importChartOfAccounts(deps, rows);
  return null;
}

// Template column headers (for downloadable blank templates) + contoh baris
export const IMPORT_TEMPLATES = {
  products: {
    filename: 'Template_Produk',
    sheet: 'Produk',
    columns: ['SKU', 'Nama', 'Kategori', 'Sub Kategori', 'Satuan', 'Satuan Berat', 'Jenis Kemasan', 'Harga Jual', 'Stok Minimum', 'Masa Simpan (hari)', 'Keterangan'],
    examples: [
      { 'SKU': 'AYM-KARKAS', 'Nama': 'Ayam Karkas Utuh', 'Kategori': 'Karkas', 'Sub Kategori': 'Broiler', 'Satuan': 'kg', 'Satuan Berat': 'kg', 'Jenis Kemasan': 'karung', 'Harga Jual': 35000, 'Stok Minimum': 200, 'Masa Simpan (hari)': 365, 'Keterangan': 'Frozen' },
      { 'SKU': 'AYM-FILLET', 'Nama': 'Fillet Dada Ayam', 'Kategori': 'Boneless', 'Sub Kategori': 'Dada', 'Satuan': 'kg', 'Satuan Berat': 'kg', 'Jenis Kemasan': 'inner pack', 'Harga Jual': 52000, 'Stok Minimum': 100, 'Masa Simpan (hari)': 365, 'Keterangan': '' },
      { 'SKU': 'AYM-SAYAP', 'Nama': 'Sayap Ayam', 'Kategori': 'Parting', 'Sub Kategori': 'Sayap', 'Satuan': 'kg', 'Satuan Berat': 'kg', 'Jenis Kemasan': 'inner pack', 'Harga Jual': 38000, 'Stok Minimum': 80, 'Masa Simpan (hari)': 365, 'Keterangan': '' },
      { 'SKU': 'AYM-CEKER', 'Nama': 'Ceker Ayam', 'Kategori': 'Parting', 'Sub Kategori': 'Ceker', 'Satuan': 'kg', 'Satuan Berat': 'kg', 'Jenis Kemasan': 'inner pack', 'Harga Jual': 28000, 'Stok Minimum': 50, 'Masa Simpan (hari)': 365, 'Keterangan': '' },
    ],
  },
  contacts: {
    filename: 'Template_Kontak',
    sheet: 'Kontak',
    columns: ['Kode', 'Nama', 'Nama Perusahaan', 'Tipe', 'Telepon', 'Email', 'Alamat', 'Kota', 'Provinsi', 'NPWP', 'Status Pajak', 'Bank', 'No Rekening', 'Keterangan'],
    examples: [
      { 'Kode': '', 'Nama': 'Pasar Segar Jaya', 'Nama Perusahaan': 'UD Pasar Segar Jaya', 'Tipe': 'Customer', 'Telepon': '081234567890', 'Email': 'order@segarjaya.co.id', 'Alamat': 'Jl. Pasar No.10', 'Kota': 'Bandung', 'Provinsi': 'Jawa Barat', 'NPWP': '', 'Status Pajak': 'NonPKP', 'Bank': 'BCA', 'No Rekening': '1234567890', 'Keterangan': 'Pelanggan grosir' },
      { 'Kode': '', 'Nama': 'PT Unggas Makmur', 'Nama Perusahaan': 'PT Unggas Makmur', 'Tipe': 'Supplier', 'Telepon': '0217654321', 'Email': 'sales@unggasmakmur.co.id', 'Alamat': 'Kawasan Industri Blok C', 'Kota': 'Tangerang', 'Provinsi': 'Banten', 'NPWP': '01.234.567.8-901.000', 'Status Pajak': 'PKP', 'Bank': 'Mandiri', 'No Rekening': '9876543210', 'Keterangan': 'Pemasok ayam hidup' },
      { 'Kode': '', 'Nama': 'RPH Berkah', 'Nama Perusahaan': 'RPH Berkah', 'Tipe': 'RPH', 'Telepon': '0223344556', 'Email': '', 'Alamat': 'Jl. Potong No.5', 'Kota': 'Bogor', 'Provinsi': 'Jawa Barat', 'NPWP': '', 'Status Pajak': 'NonPKP', 'Bank': '', 'No Rekening': '', 'Keterangan': 'Rumah potong rekanan' },
      { 'Kode': '', 'Nama': 'Budi Dropship', 'Nama Perusahaan': '', 'Tipe': 'Dropshipper', 'Telepon': '085611112222', 'Email': 'budi@gmail.com', 'Alamat': 'Perum Melati B2', 'Kota': 'Depok', 'Provinsi': 'Jawa Barat', 'NPWP': '', 'Status Pajak': 'NonPKP', 'Bank': 'BRI', 'No Rekening': '5566778899', 'Keterangan': '' },
    ],
  },
  'chart-of-accounts': {
    filename: 'Template_Bagan_Akun',
    sheet: 'Bagan Akun',
    columns: ['Kode Akun', 'Nama Akun', 'Tipe', 'Saldo Normal', 'Kategori', 'Akun Induk', 'Saldo Awal'],
    examples: [
      { 'Kode Akun': '1-1110', 'Nama Akun': 'Kas', 'Tipe': 'asset', 'Saldo Normal': 'debit', 'Kategori': 'Aset Lancar', 'Akun Induk': '1-1000', 'Saldo Awal': 5000000 },
      { 'Kode Akun': '1-1120', 'Nama Akun': 'Bank BCA', 'Tipe': 'asset', 'Saldo Normal': 'debit', 'Kategori': 'Aset Lancar', 'Akun Induk': '1-1000', 'Saldo Awal': 25000000 },
      { 'Kode Akun': '2-1100', 'Nama Akun': 'Utang Usaha', 'Tipe': 'liability', 'Saldo Normal': 'kredit', 'Kategori': 'Kewajiban Lancar', 'Akun Induk': '2-1000', 'Saldo Awal': 0 },
      { 'Kode Akun': '4-1000', 'Nama Akun': 'Penjualan', 'Tipe': 'revenue', 'Saldo Normal': 'kredit', 'Kategori': 'Pendapatan', 'Akun Induk': '', 'Saldo Awal': 0 },
    ],
  },
};
