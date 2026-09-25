// Tata letak Rekap Tagihan (tanpa React) — dipakai bersama oleh tampilan layar, PDF, dan Excel supaya
// ketiganya identik: kolom sesuai template, kolom JUMLAH (subtotal per tanggal, rowSpan), kolom
// Keterangan (hanya bila ada koreksi/status bayar), dan baris penutup per supplier + grand total.
import { fieldMap, fmtDate } from '@/lib/finance/recap-fields';

function footerLines(sum, closingLabel) {
  const lines = [];
  if (sum.hasCorrection || sum.paidTotal > 0) {
    lines.push({ label: 'Total tagihan (saat rekap dibuat)', value: sum.snapshotTotal });
    if (sum.hasCorrection) lines.push({ label: 'Total setelah koreksi', value: sum.correctedTotal, tone: 'warn' });
    if (sum.paidTotal > 0) lines.push({ label: 'Sudah dibayar', value: sum.paidTotal, tone: 'ok' });
  }
  lines.push({ label: closingLabel, value: sum.outstanding, strong: true });
  return lines;
}

export function recapLayout(recap, view) {
  const fm = fieldMap(recap.docType || 'PO');
  const columns = (recap.columns || []).map((k) => fm[k]).filter(Boolean);
  const subtotalByDate = !!recap.options?.subtotalByDate;
  const showNotes = view.sections.some((sec) => sec.rows.some((r) => r.notes?.length));
  const titleLc = String(recap.title || '').toLowerCase();
  const multi = view.sections.length > 1;
  const sections = view.sections.map((sec) => {
    const groups = [];
    for (const r of sec.rows) {
      const key = fmtDate(r.date);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) { g = { key, rows: [], total: 0 }; groups.push(g); }
      g.rows.push(r);
      g.total += Number(r.amount || 0);
    }
    const body = [];
    let no = 0;
    for (const g of groups) {
      g.rows.forEach((r, i) => {
        no += 1;
        body.push({
          key: r.lineKey,
          docId: r.docId,
          values: columns.map((f) => (f.key === 'no' ? no : f.key === 'total' ? r.amount : r[f.key])),
          groupTotal: i === 0 ? g.total : null,
          groupSpan: i === 0 ? g.rows.length : 0,
          notes: r.notes || [],
          notesText: (r.notes || []).map((n) => n.text).join('; '),
        });
      });
    }
    return {
      supplierId: sec.supplierId,
      heading: (multi || !titleLc.includes(String(sec.supplierName || '').toLowerCase())) ? `TAGIHAN ${String(sec.supplierName || '').toUpperCase()}` : null,
      body,
      footer: footerLines(sec, 'TAGIHAN YANG BELUM DIBAYAR'),
    };
  });
  return {
    title: recap.title || 'REKAP TAGIHAN',
    subtitle: recap.subtitle || '',
    columns,
    subtotalByDate,
    showNotes,
    sections,
    grand: multi ? footerLines(view.totals, 'GRAND TOTAL BELUM DIBAYAR') : null,
  };
}
