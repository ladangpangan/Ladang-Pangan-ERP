'use client';

import * as XLSX from 'xlsx';

// sheets: [{ name, headers?:[{key,label}], rows?:[{...}], aoa?:[[...]] }]
export function exportToExcel(filename, sheets) {
  const wb = XLSX.utils.book_new();
  const list = Array.isArray(sheets) ? sheets : [sheets];
  list.forEach((sh, idx) => {
    let ws;
    if (sh.aoa) {
      ws = XLSX.utils.aoa_to_sheet(sh.aoa);
    } else if (sh.headers) {
      const header = sh.headers.map((h) => h.label);
      const data = (sh.rows || []).map((r) => sh.headers.map((h) => {
        const v = r[h.key];
        return v == null ? '' : v;
      }));
      ws = XLSX.utils.aoa_to_sheet([header, ...data]);
      // auto column widths
      ws['!cols'] = sh.headers.map((h) => ({ wch: Math.max(String(h.label).length + 2, 12) }));
    } else {
      ws = XLSX.utils.json_to_sheet(sh.rows || []);
    }
    XLSX.utils.book_append_sheet(wb, ws, (sh.name || `Sheet${idx + 1}`).slice(0, 31));
  });
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, name);
}
