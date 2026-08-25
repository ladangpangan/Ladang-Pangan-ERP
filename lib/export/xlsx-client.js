'use client';
import * as XLSX from 'xlsx';

// Build an .xlsx workbook from [{ name, rows: [obj] }] and trigger a browser download.
export function downloadWorkbook(filename, sheets) {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  (sheets || []).forEach((sh, idx) => {
    const rows = (sh.rows && sh.rows.length) ? sh.rows : [{ Info: 'Tidak ada data' }];
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto column widths (basic)
    try {
      const keys = Object.keys(rows[0] || {});
      ws['!cols'] = keys.map(k => {
        let max = k.length;
        for (const r of rows) { const v = r[k]; const len = v == null ? 0 : String(v).length; if (len > max) max = len; }
        return { wch: Math.min(Math.max(max + 2, 8), 45) };
      });
    } catch (e) { /* ignore */ }
    let name = (sh.name || `Sheet${idx + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${idx + 1}`;
    while (used.has(name)) name = name.slice(0, 28) + '_' + idx;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename}_${date}.xlsx`);
}

// Parse an uploaded File (xlsx) -> { sheetName: [rowObjects] }
export async function parseWorkbookFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const out = {};
  wb.SheetNames.forEach(n => {
    out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
  });
  return out;
}
