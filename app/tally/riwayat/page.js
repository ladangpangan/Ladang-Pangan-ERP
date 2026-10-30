'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { ArrowLeft, History, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { usePdfPreview } from '@/components/pdf-preview-dialog';
import { tallyType, kg, periodRange, openBeritaAcara } from '@/lib/tally/history';

// Riwayat Tally untuk petugas di HP: Masuk, Keluar, Opname (+ Produksi di "Semua"), semua petugas di gudang.
const fetcher = (url) => fetch(url).then(r => r.json());
const TABS = [['all', 'Semua'], ['in', 'Masuk'], ['out', 'Keluar'], ['op', 'Opname']];

function useHistory(type, from, enabled) {
  const { data, isLoading } = useSWR(enabled ? `/api/tally-history?${new URLSearchParams({ type, from })}` : null, fetcher);
  return { rows: data?.data || [], isLoading: enabled && isLoading };
}

export default function TallyRiwayatPage() {
  const pdfPreview = usePdfPreview();
  const [tab, setTab] = useState('all');
  const [period, setPeriod] = useState('today');
  const [busy, setBusy] = useState(null);
  const { from } = periodRange(period === 'today' ? 'today' : '7');
  const want = (k) => tab === 'all' || tab === k;
  const hin = useHistory('in', from, want('in'));
  const hout = useHistory('out', from, want('out'));
  const hop = useHistory('op', from, want('op'));
  const hwo = useHistory('wo', from, tab === 'all');
  const loading = hin.isLoading || hout.isLoading || hop.isLoading || hwo.isLoading;

  const groups = useMemo(() => {
    const rows = [...hin.rows, ...hout.rows, ...hop.rows, ...hwo.rows].sort((a, b) => new Date(b.at) - new Date(a.at));
    const today = format(new Date(), 'yyyy-MM-dd');
    const yest = format(new Date(Date.now() - 86400e3), 'yyyy-MM-dd');
    const out = [];
    for (const r of rows) {
      const d = format(new Date(r.at), 'yyyy-MM-dd');
      const day = d === today ? 'Hari ini' : d === yest ? 'Kemarin' : format(new Date(r.at), 'EEEE, dd MMM', { locale: idLocale });
      let g = out.find(x => x.day === day);
      if (!g) { g = { day, items: [] }; out.push(g); }
      g.items.push(r);
    }
    return out;
  }, [hin.rows, hout.rows, hop.rows, hwo.rows]);

  const showPdf = async (r) => {
    setBusy(`${r.type}:${r.id}`);
    try { await openBeritaAcara(pdfPreview, r.type, r.id); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-[#F1F5F9] text-[#0F1729]" style={{ fontFamily: 'Roboto, system-ui, sans-serif' }}>
      <div className="bg-white border-b border-[#DFE5EC] px-4 py-3 flex items-center gap-3">
        <Link href="/tally" aria-label="Kembali ke beranda" className="w-10 h-10 flex items-center justify-center rounded-[10px]"><ArrowLeft className="w-[22px] h-[22px]" /></Link>
        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #64748B, #334155)' }}><History className="w-[22px] h-[22px]" /></div>
        <div className="flex-1">
          <div className="text-[17px] font-bold">Riwayat Tally</div>
          <div className="text-[13px] text-[#5A687C]">Semua petugas · cetak ulang berita acara</div>
        </div>
      </div>

      <div className="px-4 pt-3 flex flex-col gap-2.5">
        <div role="tablist" aria-label="Jenis tally" className="grid grid-cols-4 gap-1 bg-[#E2E8F0] rounded-[10px] p-1">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`min-h-[40px] rounded-lg text-sm font-medium ${tab === k ? 'bg-white text-[#0F1729] shadow-sm' : 'text-[#5A687C]'}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {[['today', 'Hari ini'], ['week', '7 hari']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)} aria-pressed={period === k}
              className={`min-h-[36px] px-3.5 rounded-full text-sm font-medium border ${period === k ? 'bg-[#0F1729] border-[#0F1729] text-white' : 'bg-white border-[#CBD5E1] text-[#334155]'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pt-3 pb-4 flex flex-col gap-2.5">
        {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
        {!loading && groups.length === 0 && (
          <div className="bg-white border border-[#DFE5EC] rounded-[14px] p-5 text-center text-[15px] text-[#5A687C]">
            Belum ada tally {period === 'today' ? 'hari ini' : 'dalam 7 hari terakhir'}.
          </div>
        )}
        {groups.map(g => (
          <div key={g.day} className="flex flex-col gap-2.5">
            <div className="text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C] mt-1">{g.day}</div>
            {g.items.map(r => {
              const T = tallyType(r.type);
              const key = `${r.type}:${r.id}`;
              return (
                <div key={key} className="bg-white border border-[#DFE5EC] rounded-[14px] px-3.5 py-3 flex flex-col gap-2.5 shadow-sm">
                  <div className="flex justify-between gap-2.5 items-start">
                    <div className="min-w-0">
                      <div className="text-base font-bold font-mono truncate">{r.ref}</div>
                      <div className="text-sm text-[#5A687C] truncate">{r.sub}</div>
                    </div>
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0" style={{ background: T.bg, color: T.fg }}>{T.short}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-sm text-[#334155]">
                    <span className="truncate">{format(new Date(r.at), 'HH:mm')} · {r.operator || '–'}</span>
                    <b className="shrink-0">{r.type === 'wo' ? `${r.bags} catatan` : `${r.bags} karung · ${kg(r.kg)} kg`}</b>
                  </div>
                  <button type="button" onClick={() => showPdf(r)} disabled={busy === key}
                    className="min-h-[48px] rounded-[10px] border border-[#CBD5E1] bg-white text-base font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                    {busy === key ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <FileText className="w-[18px] h-[18px]" />} Berita Acara (PDF)
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {pdfPreview.element}
    </div>
  );
}
