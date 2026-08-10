'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  RefreshCw, Landmark, BookOpen, Calculator, Wallet, Scale,
  Banknote, ArrowDownCircle, ArrowUpCircle, Boxes, TrendingUp, Receipt, Loader2,
} from 'lucide-react';
import { fmtRp, acctFetcher } from '@/lib/accounting/ui';

const KPI = ({ icon: Icon, label, value, sub, color }) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold mt-1">{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}><Icon className="w-5 h-5" /></div>
      </div>
    </CardContent>
  </Card>
);

const LINKS = [
  { href: '/dashboard/accounting/coa', label: 'Chart of Account', desc: 'Kelola akun & pemetaan', icon: BookOpen, color: 'text-emerald-600' },
  { href: '/dashboard/accounting/journals', label: 'Jurnal Umum', desc: 'Jurnal otomatis & manual', icon: Calculator, color: 'text-blue-600' },
  { href: '/dashboard/accounting/ledger', label: 'Buku Besar', desc: 'Mutasi per akun', icon: Wallet, color: 'text-purple-600' },
  { href: '/dashboard/accounting/reports', label: 'Laporan Keuangan', desc: 'Neraca, Laba Rugi, Arus Kas', icon: Scale, color: 'text-amber-600' },
];

export default function AccountingOverviewPage() {
  const { data, mutate, isLoading } = useSWR('/api/accounting/overview', acctFetcher);
  const [syncing, setSyncing] = useState(false);
  const ov = data?.data || {};

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/accounting/sync', { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Posting otomatis selesai — ${j.count} jurnal terbentuk.`);
      mutate();
    } catch (e) { toast.error(e.message); } finally { setSyncing(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Landmark className="w-6 h-6 text-emerald-600" />Ringkasan Akuntansi</h1>
          <p className="text-muted-foreground text-sm">Pembukuan berpasangan (SAK EP) — otomatis dari seluruh transaksi ERP.</p>
        </div>
        <Button onClick={sync} disabled={syncing} variant="outline">
          {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Posting Otomatis
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={Banknote} label="Kas & Bank" value={fmtRp(ov.cash)} sub={`Kas ${fmtRp(ov.kas)} · Bank ${fmtRp(ov.bank)}`} color="bg-emerald-100 text-emerald-700" />
        <KPI icon={ArrowDownCircle} label="Piutang Usaha" value={fmtRp(ov.piutang)} sub="Tagihan pelanggan" color="bg-blue-100 text-blue-700" />
        <KPI icon={ArrowUpCircle} label="Utang Usaha" value={fmtRp(ov.utang)} sub="Utang ke supplier" color="bg-amber-100 text-amber-700" />
        <KPI icon={Boxes} label="Persediaan" value={fmtRp(ov.persediaan)} sub="Nilai stok" color="bg-purple-100 text-purple-700" />
        <KPI icon={Receipt} label="Pendapatan (Thn Berjalan)" value={fmtRp(ov.revenueYtd)} color="bg-sky-100 text-sky-700" />
        <KPI icon={TrendingUp} label="Laba Bersih (Thn Berjalan)" value={fmtRp(ov.netIncomeYtd)} color="bg-emerald-100 text-emerald-700" />
        <KPI icon={TrendingUp} label="Laba Bersih (Bulan Ini)" value={fmtRp(ov.netIncomeMonth)} color="bg-teal-100 text-teal-700" />
        <KPI icon={Calculator} label="Jumlah Jurnal" value={(ov.journalCount || 0).toLocaleString('id-ID')} sub="Entri terbukukan" color="bg-slate-100 text-slate-700" />
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">Modul Akuntansi</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4 flex items-start gap-3">
                  <l.icon className={`w-6 h-6 ${l.color}`} />
                  <div>
                    <div className="font-semibold text-sm">{l.label}</div>
                    <div className="text-[11px] text-muted-foreground">{l.desc}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Cara kerja</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• Setiap faktur penjualan, pembelian, pembayaran, retur, opname, dan produksi otomatis membentuk jurnal berpasangan.</p>
          <p>• Jurnal otomatis selalu disinkronkan ulang dari dokumen sumber — aman & bebas duplikat. Jurnal manual (penyesuaian) tetap dipertahankan.</p>
          <p>• Atur akun default di <Link href="/dashboard/accounting/coa" className="text-emerald-600 underline">Chart of Account → Pemetaan Akun</Link>.</p>
          {isLoading && <p className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Memuat data…</p>}
        </CardContent>
      </Card>
    </div>
  );
}
