'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useSession, authClient } from '@/lib/auth/auth-client';
import { ChevronRight, LogOut, Wheat, Wifi, WifiOff, History, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Factory } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { format, isToday } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const when = (d) => (d ? (isToday(new Date(d)) ? `hari ini ${format(new Date(d), 'HH.mm')}` : format(new Date(d), 'dd MMM HH.mm')) : '');
const ROLE_LABEL = { operator: 'Operator Gudang', admin: 'Admin', supervisor: 'Supervisor', direktur: 'Direktur', akuntan: 'Akuntan' };

// Pekerjaan di Tally: warna sama dengan layar masing-masing dan Riwayat Tally.
const JOBS = [
  { href: '/tally/inbound', title: 'Barang Masuk', desc: 'Scan karung, isi berat, masuk stok', icon: ArrowDownToLine, bg: '#EDF8F3', fg: '#117956' },
  { href: '/tally/outbound', title: 'Barang Keluar', desc: 'Pilih pesanan, scan karung yang dikirim', icon: ArrowUpFromLine, bg: '#FFF4EC', fg: '#C2410C' },
  { href: '/tally/opname', title: 'Stock Opname', desc: 'Hitung karung di gudang dengan scan', icon: ClipboardCheck, bg: '#EFF6FF', fg: '#1D4ED8' },
  { href: '/tally/produksi', title: 'Produksi', desc: 'Catat data tahap produksi per WO', icon: Factory, bg: '#F5F3FF', fg: '#7C3AED', countKey: 'wo' },
];

export default function TallyHomePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const { data: woData } = useSWR('/api/work-orders?status=Dalam Proses', fetcher, { refreshInterval: 30000 });
  const { data: inData } = useSWR('/api/tally-sessions?status=draft', fetcher, { refreshInterval: 15000 });
  const { data: outData } = useSWR('/api/tally-outbound/orders', fetcher, { refreshInterval: 15000 });
  const { data: opData } = useSWR('/api/opnames/tally/active', fetcher, { refreshInterval: 15000 });
  const woCount = (woData?.data || []).length;

  // Semua pekerjaan yang belum selesai, terbaru di atas.
  const pending = [
    ...(inData?.data || []).map(d => ({
      key: `in-${d.id}`, href: `/tally/inbound?session=${d.id}`, color: '#117956', at: d.updatedAt,
      title: `${d.parentSessionId ? 'Revisi' : 'Masuk'} · ${d.refNumber ? `${d.referenceType} ${d.refNumber}` : 'Lainnya'}`,
      sub: `${d.itemCount} karung · ${kg(d.totalWeight)} kg`,
    })),
    ...(outData?.data || []).filter(o => Number(o.draftItemCount || 0) > 0).map(o => ({
      key: `out-${o.id}`, href: `/tally/outbound?so=${o.id}`, color: '#C2410C', at: null,
      title: `Keluar · ${o.soNumber}`, sub: o.customerName || 'Pesanan',
    })),
    ...(opData?.data || []).map(o => ({
      key: `op-${o.id}`, href: `/tally/opname?resume=${o.id}`, color: '#1D4ED8', at: o.updatedAt,
      title: `Opname · ${o.csCode || ''}${o.zoneCode ? ` Zona ${o.zoneCode}` : ''}`.trim(),
      sub: `${o.counted}/${o.expected} karung dihitung`,
    })),
  ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  const logout = async () => { await authClient.signOut(); router.push('/login'); };
  const role = session?.user?.role;

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-[#F1F5F9] text-[#0F1729]" style={{ fontFamily: 'Roboto, system-ui, sans-serif' }}>
      <div className="bg-white border-b border-[#DFE5EC] px-4 py-3.5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg, #10B981, #047857)' }}><Wheat className="w-[22px] h-[22px]" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-bold">Tally App</div>
          <div className="text-[13px] text-[#5A687C] truncate">{session?.user?.name || 'Petugas'}{role ? ` · ${ROLE_LABEL[role] || role}` : ''}</div>
        </div>
        <div className={`flex items-center gap-1.5 text-[13px] font-medium ${online ? 'text-[#117956]' : 'text-[#DC2828]'}`}>
          {online ? <Wifi className="w-[18px] h-[18px]" /> : <WifiOff className="w-[18px] h-[18px]" />}{online ? 'Online' : 'Offline'}
        </div>
        <button type="button" onClick={logout} aria-label="Keluar akun" className="w-10 h-10 flex items-center justify-center rounded-[10px] text-[#5A687C]"><LogOut className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 px-4 py-5 flex flex-col gap-3">
        {!online && (
          <div role="alert" className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] rounded-xl px-3.5 py-3 text-[15px] font-medium">
            Tidak ada sinyal. Data disimpan dulu di HP dan dikirim saat online kembali.
          </div>
        )}

        <div className="text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C]">Pilih pekerjaan</div>
        {JOBS.map(j => (
          <Link key={j.href} href={j.href} className="flex items-center gap-3.5 bg-white border border-[#DFE5EC] rounded-[14px] px-4 py-4 shadow-sm">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: j.bg }}><j.icon className="w-7 h-7" style={{ color: j.fg }} /></div>
            <div className="flex-1 min-w-0">
              <div className="text-xl font-bold flex items-center gap-2">
                {j.title}
                {j.countKey === 'wo' && woCount > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: j.bg, color: j.fg }}>{woCount} WO</span>}
              </div>
              <div className="text-sm text-[#5A687C] mt-0.5">{j.desc}</div>
            </div>
            <ChevronRight className="w-[22px] h-[22px] shrink-0 text-[#5A687C]" />
          </Link>
        ))}

        {pending.length > 0 && (
          <>
            <div className="text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C] mt-2.5">Belum selesai ({pending.length})</div>
            {pending.map(p => (
              <Link key={p.key} href={p.href} className="flex items-center gap-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-[14px] px-4 py-3.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold truncate">{p.title}</div>
                  <div className="text-sm text-[#5A687C] truncate">{p.sub}{p.at ? ` · ${when(p.at)}` : ''}</div>
                </div>
                <span className="text-[15px] font-bold shrink-0" style={{ color: p.color }}>Lanjutkan</span>
              </Link>
            ))}
          </>
        )}

        <Link href="/tally/riwayat" className="flex items-center gap-3 bg-white border border-[#DFE5EC] rounded-[14px] px-4 py-3.5 mt-2.5">
          <div className="w-10 h-10 rounded-[10px] bg-[#F1F5F9] text-[#334155] flex items-center justify-center shrink-0"><History className="w-5 h-5" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold">Riwayat Tally</div>
            <div className="text-sm text-[#5A687C]">Tally yang sudah selesai & berita acara</div>
          </div>
          <ChevronRight className="w-5 h-5 shrink-0 text-[#5A687C]" />
        </Link>

        {role && role !== 'operator' && (
          <Link href="/dashboard" className="mt-auto pt-4 text-center text-sm text-[#5A687C] min-h-[44px] flex items-center justify-center">← Kembali ke Dashboard</Link>
        )}
      </div>
    </div>
  );
}
