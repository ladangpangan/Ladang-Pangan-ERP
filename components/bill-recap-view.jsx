'use client';

// Tampilan Rekap Tagihan di layar — bentuknya meniru rekap Excel tim (header kuning, kolom JUMLAH
// per tanggal, baris "TAGIHAN YANG BELUM DIBAYAR"). Data tata letak dari lib/finance/recap-layout.js
// (sama persis dengan yang dipakai PDF & Excel).
import Link from 'next/link';
import { recapLayout } from '@/lib/finance/recap-layout';
import { formatCell, fmtRp } from '@/lib/finance/recap-fields';

const NOTE_TONE = {
  warn: 'text-amber-700',
  ok: 'text-emerald-700',
  info: 'text-sky-700',
};
const NUMERIC = ['money', 'weight', 'number'];
const WRAP = ['customer', 'shipAddress']; // kolom teks panjang boleh turun baris

export default function BillRecapView({ recap, view }) {
  const L = recapLayout(recap, view);
  const nCols = L.columns.length + (L.subtotalByDate ? 1 : 0) + (L.showNotes ? 1 : 0);
  const labelSpan = Math.max(1, L.columns.length - 1);
  const cell = 'border border-slate-400 px-2 py-1';

  return (
    <div className="space-y-5">
      <div>
        <div className="text-lg font-bold tracking-wide">{L.title}</div>
        {L.subtitle && <div className="text-center font-bold">{L.subtitle}</div>}
      </div>
      {L.sections.map((sec) => (
        <div key={sec.supplierId} className="space-y-2">
          {sec.heading && <div className="font-bold">{sec.heading}</div>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-yellow-300 text-slate-900">
                  {L.columns.map((c) => <th key={c.key} className={`${cell} text-center font-bold`}>{c.label}</th>)}
                  {L.subtotalByDate && <th className={`${cell} text-center font-bold`}>Jumlah</th>}
                  {L.showNotes && <th className={`${cell} text-center font-bold min-w-[160px]`}>Keterangan</th>}
                </tr>
              </thead>
              <tbody>
                {sec.body.map((b) => (
                  <tr key={b.key}>
                    {b.values.map((v, i) => {
                      const f = L.columns[i];
                      const text = f.key === 'total' ? fmtRp(v) : formatCell(f, v);
                      const isDocLink = f.key === 'poNumber' || f.key === 'invoiceNumber';
                      return (
                        <td key={f.key} className={`${cell} ${NUMERIC.includes(f.type) ? 'text-right tabular-nums whitespace-nowrap' : WRAP.includes(f.key) ? '' : 'whitespace-nowrap'}`}>
                          {isDocLink && v ? <Link href={`/dashboard/purchase-orders/${b.docId}`} className="hover:underline print:no-underline">{text}</Link> : text}
                        </td>
                      );
                    })}
                    {L.subtotalByDate && b.groupSpan > 0 && (
                      <td rowSpan={b.groupSpan} className={`${cell} text-center font-bold whitespace-nowrap tabular-nums`}>{fmtRp(b.groupTotal)}</td>
                    )}
                    {L.showNotes && (
                      <td className={`${cell} text-xs`}>
                        {b.notes.map((n, i) => <div key={i} className={NOTE_TONE[n.tone] || ''}>{n.tone === 'warn' ? '⚠️ ' : n.tone === 'ok' ? '✅ ' : ''}{n.text}</div>)}
                      </td>
                    )}
                  </tr>
                ))}
                {sec.footer.map((line) => (
                  <tr key={line.label} className="bg-orange-100">
                    <td colSpan={labelSpan} className={`${cell} text-right ${line.strong ? 'font-bold' : ''} ${NOTE_TONE[line.tone] || ''}`}>{line.label}</td>
                    <td className={`${cell} text-right whitespace-nowrap tabular-nums ${line.strong ? 'font-bold' : ''} ${NOTE_TONE[line.tone] || ''}`}>{fmtRp(line.value)}</td>
                    {nCols - labelSpan - 1 > 0 && <td colSpan={nCols - labelSpan - 1} className={cell} />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {L.grand && (
        <div className="flex justify-end">
          <table className="border-collapse text-sm min-w-[360px]">
            <tbody>
              {L.grand.map((line) => (
                <tr key={line.label} className="bg-orange-100">
                  <td className={`${cell} text-right ${line.strong ? 'font-bold' : ''} ${NOTE_TONE[line.tone] || ''}`}>{line.label}</td>
                  <td className={`${cell} text-right whitespace-nowrap tabular-nums ${line.strong ? 'font-bold' : ''} ${NOTE_TONE[line.tone] || ''}`}>{fmtRp(line.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
