'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { ArrowLeft, Factory, ChevronRight, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

// Tally Produksi: daftar WO "Dalam Proses" → buka WO → pilih tahap → catat data.
const fetcher = (url) => fetch(url).then(r => r.json());
const PURPLE = '#7C3AED';

export default function TallyProduksiPage() {
  const { data, isLoading } = useSWR('/api/work-orders?status=Dalam Proses', fetcher, { refreshInterval: 10000 });
  const rows = data?.data || [];

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-[#F1F5F9] text-[#0F1729]" style={{ fontFamily: 'Roboto, system-ui, sans-serif' }}>
      <div className="bg-white border-b border-[#DFE5EC] px-4 py-3 flex items-center gap-3">
        <Link href="/tally" aria-label="Kembali ke beranda" className="w-10 h-10 flex items-center justify-center rounded-[10px]"><ArrowLeft className="w-[22px] h-[22px]" /></Link>
        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #A78BFA, #6D28D9)' }}><Factory className="w-[22px] h-[22px]" /></div>
        <div className="flex-1">
          <div className="text-[17px] font-bold">Produksi</div>
          <div className="text-[13px] text-[#5A687C]">Pilih WO, pilih tahap, catat data</div>
        </div>
      </div>

      <div className="flex-1 p-4 flex flex-col gap-3">
        <div className="text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C]">WO dalam proses ({rows.length})</div>
        {isLoading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
        {!isLoading && rows.length === 0 && (
          <div className="bg-white border border-[#DFE5EC] rounded-[14px] p-5 text-center text-[15px] text-[#5A687C]">
            Tidak ada WO yang sedang diproses. Hubungi supervisor untuk menyetujui WO baru.
          </div>
        )}
        {rows.map(wo => (
          <Link key={wo.id} href={`/tally/${wo.id}`} className="bg-white border border-[#DFE5EC] rounded-[14px] px-4 py-3.5 flex items-center gap-3 shadow-sm">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold font-mono">{wo.woNumber}</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#F5F3FF', color: '#5B21B6' }}>{wo.mode}</span>
                {wo.po?.method && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#334155]">{wo.po.method}</span>}
              </div>
              <div className="text-sm text-[#5A687C] mt-1">
                LB {Number(wo.totalLiveBirdWeight || 0).toLocaleString('id-ID')} kg · {wo.totalLiveBirdHeadCount || 0} ekor
                {wo.startDate ? ` · mulai ${format(new Date(wo.startDate), 'dd MMM')}` : ''}
              </div>
            </div>
            <ChevronRight className="w-[22px] h-[22px] shrink-0" style={{ color: PURPLE }} />
          </Link>
        ))}
        <div className="text-[13px] text-[#5A687C] text-center mt-1">Data tersimpan saat online. Kalau sinyal putus, catatan disimpan dulu di HP.</div>
      </div>
    </div>
  );
}
