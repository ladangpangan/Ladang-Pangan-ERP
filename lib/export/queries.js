// Export queries: build spreadsheet-ready sheets (arrays of plain objects) from the raw SQLite handle.
// Used by GET /api/export/:module. Client converts these to an .xlsx workbook via SheetJS.

const d = (t) => {
  if (t == null || t === '' || Number(t) === 0) return '';
  const ms = Number(t) * 1000;
  const dt = new Date(ms);
  if (isNaN(dt.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
const num = (n) => Math.round(Number(n || 0) * 100) / 100;
const safeAll = (raw, sql) => { try { return raw.prepare(sql).all(); } catch (e) { return []; } };

function salesOrders(raw) {
  const sos = safeAll(raw, `SELECT so.*, c.display_name AS customer_name, c.code AS customer_code
    FROM sales_order so LEFT JOIN contacts c ON c.id = so.customer_id
    WHERE so.archived_at IS NULL ORDER BY so.order_date DESC, so.so_number DESC`);
  const soRows = sos.map(o => ({
    'No SO': o.so_number,
    'Tanggal': d(o.order_date),
    'Pelanggan': o.customer_name || '',
    'Kode Pelanggan': o.customer_code || '',
    'Status': o.pipeline_status,
    'Tipe': o.fulfillment_type,
    'Total (Rp)': num(o.total_amount),
    'Dibayar (Rp)': num(o.paid_amount),
    'Status Bayar': o.payment_status,
    'Termin': o.payment_term || '',
    'No Faktur': o.invoice_number || '',
    'Tgl Faktur': d(o.invoice_date),
    'Jatuh Tempo': d(o.due_date),
    'Diskon (Rp)': num(o.discount_total),
    'Biaya Kirim (Rp)': num(o.shipping_cost),
    'Ongkir Ditanggung': o.shipping_bearer === 'buyer' ? 'Pembeli' : 'Penjual',
    'Faktur Di-up': o.markup_enabled ? 'Ya' : 'Tidak',
    'Cashback (Rp)': num(o.cashback_amount),
    'Catatan': o.notes || '',
  }));
  const items = safeAll(raw, `SELECT i.*, so.so_number, p.sku, p.name AS product_name
    FROM sales_order_items i
    LEFT JOIN sales_order so ON so.id = i.sales_order_id
    LEFT JOIN products p ON p.id = i.product_id
    ORDER BY so.so_number`);
  const itemRows = items.map(i => ({
    'No SO': i.so_number || '',
    'SKU': i.sku || '',
    'Produk': i.product_name || '',
    'Qty': num(i.quantity),
    'Berat (kg)': num(i.weight),
    'Harga/kg (Rp)': num(i.unit_price),
    'Harga Di-up/kg (Rp)': num(i.markup_unit_price),
    'Diskon (Rp)': num(i.discount),
    'Subtotal (Rp)': num(i.subtotal),
  }));
  return { filename: 'Ekspor_Sales_Order', sheets: [{ name: 'Sales Order', rows: soRows }, { name: 'Item SO', rows: itemRows }] };
}

function purchaseOrders(raw) {
  const pos = safeAll(raw, `SELECT po.*, c.display_name AS supplier_name, c.code AS supplier_code
    FROM purchase_order po LEFT JOIN contacts c ON c.id = po.supplier_id
    WHERE po.archived_at IS NULL ORDER BY po.order_date DESC, po.po_number DESC`);
  const poRows = pos.map(o => ({
    'No PO': o.po_number,
    'Tanggal': d(o.order_date),
    'Pemasok': o.supplier_name || '',
    'Kode Pemasok': o.supplier_code || '',
    'Tipe PO': o.po_type,
    'Metode': o.method || '',
    'Status': o.pipeline_status,
    'Dropship': o.is_dropship ? 'Ya' : 'Tidak',
    'Total (Rp)': num(o.total_amount),
    'Dibayar (Rp)': num(o.paid_amount),
    'Status Bayar': o.payment_status,
    'Termin': o.payment_term || '',
    'Biaya Tambahan (Rp)': num(o.additional_cost),
    'Ongkir Ditanggung': o.additional_cost_bearer === 'supplier' ? 'Pemasok' : 'Kita',
    'Ongkir Dibayar via': o.additional_cost_pay_method || '',
    'No Faktur': o.invoice_number || '',
    'Tgl Faktur': d(o.invoice_date),
    'Jatuh Tempo': d(o.due_date),
    'Catatan': o.notes || '',
  }));
  const items = safeAll(raw, `SELECT i.*, po.po_number, p.sku, p.name AS product_name
    FROM purchase_order_items i
    LEFT JOIN purchase_order po ON po.id = i.purchase_order_id
    LEFT JOIN products p ON p.id = i.product_id
    ORDER BY po.po_number`);
  const itemRows = items.map(i => ({
    'No PO': i.po_number || '',
    'SKU': i.sku || '',
    'Produk': i.product_name || '',
    'Qty': num(i.quantity),
    'Berat Rencana (kg)': num(i.weight),
    'Berat Diterima (kg)': num(i.received_weight),
    'Berat Tally (kg)': num(i.tally_weight),
    'Harga/kg (Rp)': num(i.unit_price),
    'HPP/kg (Rp)': num(i.hpp_per_kg),
  }));
  return { filename: 'Ekspor_Purchase_Order', sheets: [{ name: 'Purchase Order', rows: poRows }, { name: 'Item PO', rows: itemRows }] };
}

function inventory(raw) {
  const stocks = safeAll(raw, `SELECT st.*, p.sku, p.name AS product_name, cs.code AS cs_code, cs.name AS cs_name, z.code AS zone_code
    FROM inventory_stock st
    LEFT JOIN products p ON p.id = st.product_id
    LEFT JOIN cold_storages cs ON cs.id = st.cold_storage_id
    LEFT JOIN zones z ON z.id = st.zone_id
    WHERE st.archived_at IS NULL ORDER BY st.created_at DESC`);
  const stockRows = stocks.map(o => ({
    'Kode Simpan': o.kode_simpan,
    'SKU': o.sku || '',
    'Produk': o.product_name || '',
    'Cold Storage': o.cs_code ? `${o.cs_code} - ${o.cs_name || ''}` : '',
    'Zona': o.zone_code || '',
    'Kemasan': o.packaging_type,
    'Qty': num(o.quantity),
    'Berat (kg)': num(o.weight),
    'HPP/kg (Rp)': num(o.hpp_per_kg),
    'Nilai Persediaan (Rp)': num(Number(o.weight || 0) * Number(o.hpp_per_kg || 0)),
    'Kadaluarsa': d(o.expired_date),
    'Status': o.status,
    'Sumber': o.source_type || '',
  }));
  const ledger = safeAll(raw, `SELECT l.*, p.sku, p.name AS product_name, cs.code AS cs_code
    FROM stock_ledger l
    LEFT JOIN products p ON p.id = l.product_id
    LEFT JOIN cold_storages cs ON cs.id = l.cold_storage_id
    ORDER BY l.ledger_date DESC, l.created_at DESC`);
  const ledgerRows = ledger.map(o => ({
    'Tanggal': d(o.ledger_date),
    'SKU': o.sku || '',
    'Produk': o.product_name || '',
    'Cold Storage': o.cs_code || '',
    'Jenis': o.movement_type,
    'Referensi': o.reference_number || '',
    'Kode Simpan': o.kode_simpan || '',
    'Masuk Qty': num(o.qty_in),
    'Masuk (kg)': num(o.weight_in),
    'Keluar Qty': num(o.qty_out),
    'Keluar (kg)': num(o.weight_out),
    'HPP/kg (Rp)': num(o.hpp_per_kg),
    'Catatan': o.notes || '',
  }));
  return { filename: 'Ekspor_Inventory', sheets: [{ name: 'Stok', rows: stockRows }, { name: 'Kartu Stok', rows: ledgerRows }] };
}

function accounting(raw) {
  const accts = safeAll(raw, `SELECT * FROM gl_accounts WHERE archived_at IS NULL ORDER BY code`);
  const coaRows = accts.map(a => ({
    'Kode Akun': a.code,
    'Nama Akun': a.name,
    'Tipe': a.type,
    'Saldo Normal': a.normal_balance,
    'Kategori': a.category || '',
    'Akun Induk': a.parent_code || '',
    'Bisa Diposting': a.is_postable ? 'Ya' : 'Tidak',
    'Saldo Awal (Rp)': num(a.opening_balance),
  }));
  const lines = safeAll(raw, `SELECT jl.*, j.journal_number, j.entry_date, j.description AS journal_desc, j.source_type, j.source_number, j.status
    FROM journal_lines jl
    LEFT JOIN journal_entries j ON j.id = jl.journal_id
    ORDER BY j.entry_date DESC, j.journal_number, jl.sort_order`);
  const journalRows = lines.map(l => ({
    'No Jurnal': l.journal_number || '',
    'Tanggal': d(l.entry_date),
    'Keterangan': l.journal_desc || '',
    'Sumber': l.source_type || '',
    'No Sumber': l.source_number || '',
    'Kode Akun': l.account_code || '',
    'Uraian Baris': l.description || '',
    'Debit (Rp)': num(l.debit),
    'Kredit (Rp)': num(l.credit),
    'Status': l.status || '',
  }));
  // Neraca Saldo (trial balance): opening balance + sum(debit-credit) per posted account
  const tb = safeAll(raw, `SELECT a.code, a.name, a.type, a.normal_balance, a.opening_balance,
      COALESCE(SUM(jl.debit),0) AS td, COALESCE(SUM(jl.credit),0) AS tc
    FROM gl_accounts a
    LEFT JOIN journal_lines jl ON jl.account_code = a.code
    LEFT JOIN journal_entries j ON j.id = jl.journal_id AND j.status = 'posted'
    WHERE a.archived_at IS NULL AND a.is_postable = 1
    GROUP BY a.code, a.name, a.type, a.normal_balance, a.opening_balance
    ORDER BY a.code`);
  const tbRows = tb.map(a => {
    const net = Number(a.opening_balance || 0) + (Number(a.td || 0) - Number(a.tc || 0));
    const isDebit = a.normal_balance === 'debit';
    const bal = isDebit ? net : -net; // saldo pada sisi normal akun
    return {
      'Kode Akun': a.code,
      'Nama Akun': a.name,
      'Tipe': a.type,
      'Total Debit (Rp)': num(a.td),
      'Total Kredit (Rp)': num(a.tc),
      'Saldo (Rp)': num(bal),
      'Sisi': isDebit ? 'Debit' : 'Kredit',
    };
  }).filter(r => r['Total Debit (Rp)'] !== 0 || r['Total Kredit (Rp)'] !== 0 || r['Saldo (Rp)'] !== 0);
  return { filename: 'Ekspor_Akuntansi', sheets: [
    { name: 'Bagan Akun', rows: coaRows },
    { name: 'Jurnal (Buku Besar)', rows: journalRows },
    { name: 'Neraca Saldo', rows: tbRows },
  ] };
}

const BUILDERS = {
  'sales-orders': salesOrders,
  'purchase-orders': purchaseOrders,
  'inventory': inventory,
  'accounting': accounting,
};

export function buildExportSheets(raw, module) {
  const fn = BUILDERS[module];
  if (!fn) return null;
  return fn(raw);
}

export const EXPORT_MODULES = Object.keys(BUILDERS);
