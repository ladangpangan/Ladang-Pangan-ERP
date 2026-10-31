'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { format } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Loader2, CheckCircle2, ArrowRight } from 'lucide-react';
import { useSession } from '@/lib/auth/auth-client';
import { fmtNum, fmtRp } from '@/lib/format';

// Beranda per peran (gaya Opsi A): "Perlu tindakan" di atas, lalu angka yang relevan untuk peran itu.
const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null));
const SUSUT_LIMIT = 5; // % — susut supplier di atas ini masuk "Perlu tindakan"

const LEVEL = {
  high: { bg: 'bg-red-50', cta: 'text-red-700' },
  medium: { bg: 'bg-amber-50', cta: 'text-amber-800' },
  info: { bg: 'bg-muted/70', cta: 'text-foreground' },
};

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}

export default function DashboardHome() {
  const { data: session } = useSession();
  const { data: res, isLoading } = useSWR('/api/dashboard/home', fetcher, { refreshInterval: 60000 });
  const d = res?.data;
  const role = d?.role || session?.user?.role;
  const isFin = role === 'direktur' || role === 'akuntan';
  const { data: ovRes } = useSWR(isFin ? '/api/accounting/overview' : null, fetcher);
  const { data: shrRes } = useSWR(role === 'direktur' || role === 'supervisor' ? '/api/dashboard/supplier-shrinkage' : null, fetcher);
  const ov = ovRes?.data;

  const actions = [...(d?.actions || [])];
  for (const r of (shrRes?.data || []).filter(x => x.susutPct != null && x.susutPct >= SUSUT_LIMIT)) {
    actions.push({ key: `susut-${r.supplierId}`, level: 'info', title: `Susut supplier ${fmtNum(r.susutPct, 1)}%`,
      detail: `${r.supplierName} · di atas batas ${SUSUT_LIMIT}%`, href: '/dashboard/purchase-reports', cta: 'Rincian' });
  }

  const name = (session?.user?.name || '').split(' ')[0];
  return (
    <div className="max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{greeting()}{name ? `, ${name}` : ''}</h1>
          <p className="text-sm text-muted-foreground mt-1">{format(new Date(), 'EEEE, d MMMM yyyy')}{role === 'akuntan' ? '' : ' · ringkasan bulan ini'}</p>
        </div>
        <span className="text-[13px] font-semibold text-primary bg-primary/10 rounded-[10px] px-3 py-1.5">{format(new Date(), 'MMMM yyyy')}</span>
      </header>

      {isLoading || !d ? <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-muted-foreground" /></div> : (
        <>
          <KpiRow d={d} ov={ov} role={role} />
          <Actions actions={actions} />

          <div className="grid gap-4 lg:grid-cols-2">
            {isFin && <MoneyCard d={d} ov={ov} />}
            <StockCard stock={d.stock} />
            {!isFin && <TodayCard today={d.today} />}
          </div>

          {role === 'akuntan' && d.aging && <AgingCard aging={d.aging} />}

          {d.woMonth > 0 && (
            <Card className="p-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-bold">Produksi bulan ini</div>
                <div className="text-sm text-muted-foreground mt-0.5">{d.woMonth} Work Order tercatat</div>
              </div>
              <Link href="/dashboard/work-orders" className="text-sm font-semibold text-primary">Buka Work Order</Link>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone, chip }) {
  return (
    <Card className="p-4 sm:p-[18px] min-w-0">
      <div className="text-xs sm:text-[13px] text-muted-foreground">{label}</div>
      <div className={`text-base sm:text-[22px] font-bold mt-1 sm:mt-1.5 truncate ${tone || ''}`}>{value}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 sm:mt-2 min-h-[20px]">
        {chip}
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </Card>
  );
}

function KpiRow({ d, ov, role }) {
  const m = d.month;
  const change = m.revenuePrev > 0 ? Math.round((m.revenue - m.revenuePrev) / m.revenuePrev * 100) : null;
  const chip = change == null ? null : (
    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${change >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{change >= 0 ? '+' : '−'}{Math.abs(change)}%</span>
  );
  const cash = ov ? Number(ov.cash || 0) : null;
  let cards;
  if (role === 'akuntan') {
    cards = [
      <Kpi key="c" label="Kas & bank" value={cash == null ? '–' : fmtRp(cash)} tone={cash < 0 ? 'text-red-600' : ''} sub={cash < 0 ? 'saldo awal belum diisi?' : ov ? `Kas ${fmtRp(ov.kas)} · Bank ${fmtRp(ov.bank)}` : ''} />,
      <Kpi key="ar" label="Piutang sudah ditagih" value={fmtRp(d.money.arTotal)} sub={d.money.arOverdue > 0 ? `${fmtRp(d.money.arOverdue)} lewat jatuh tempo` : 'tidak ada yang lewat'} />,
      <Kpi key="ap" label="Utang sudah ditagih" value={fmtRp(d.money.apBilled)} sub={d.money.apPending > 0 ? `+ akan ditagih ${fmtRp(d.money.apPending)}` : ''} />,
      <Kpi key="gp" label="Laba kotor bulan ini" value={fmtRp(m.grossProfit)} tone="text-primary" sub={`Margin ${fmtNum(m.margin, 1)}%`} />,
    ];
  } else if (role === 'direktur') {
    cards = [
      <Kpi key="s" label="Penjualan" value={fmtRp(m.revenue)} chip={chip} sub={change == null ? `${m.orders} SO` : 'dari bulan lalu'} />,
      <Kpi key="w" label="Terjual" value={`${fmtNum(m.weight, 1)} kg`} sub={`${m.orders} SO${m.weight > 0 ? ` · rata-rata ${fmtRp(m.revenue / m.weight)}/kg` : ''}`} />,
      <Kpi key="g" label="Laba kotor" value={fmtRp(m.grossProfit)} tone="text-primary" sub={`Margin ${fmtNum(m.margin, 1)}%`} />,
      <Kpi key="p" label="Pembelian" value={fmtRp(m.purchase)} sub={`${m.purchaseCount} PO${m.susutPct != null ? ` · susut ${fmtNum(m.susutPct, 1)}%` : ''}`} />,
    ];
  } else {
    cards = [
      <Kpi key="in" label="Masuk hari ini" value={`${fmtNum(d.today.inKg, 1)} kg`} sub={`${fmtNum(d.today.inBags, 0)} karung`} />,
      <Kpi key="out" label="Keluar hari ini" value={`${fmtNum(d.today.outKg, 1)} kg`} sub={`${fmtNum(d.today.outBags, 0)} karung`} />,
      <Kpi key="st" label="Stok tersedia" value={`${fmtNum(d.stock.weight, 1)} kg`} sub={`${d.stock.bags} karung`} />,
      <Kpi key="s" label="Penjualan bulan ini" value={fmtRp(m.revenue)} chip={chip} sub={`${m.orders} SO · ${fmtNum(m.weight, 1)} kg`} />,
    ];
  }
  return <div className="grid gap-3 sm:gap-4 grid-cols-2 xl:grid-cols-4">{cards}</div>;
}

function Actions({ actions }) {
  return (
    <Card className="p-5 space-y-3.5">
      <h2 className="font-bold flex items-center gap-2">
        Perlu tindakan
        {actions.length > 0 && <span className="text-xs font-semibold bg-red-50 text-red-700 rounded-full px-2 py-0.5">{actions.length}</span>}
      </h2>
      {actions.length === 0 ? (
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground rounded-xl bg-emerald-50/70 px-4 py-3.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />Tidak ada yang perlu ditindaklanjuti. Semua beres.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {actions.map(a => {
            const L = LEVEL[a.level] || LEVEL.info;
            return (
              <div key={a.key} className={`${L.bg} rounded-xl px-4 py-3.5 flex flex-col gap-2`}>
                <div className="text-sm font-semibold">{a.title}{a.amount ? ` · ${fmtRp(a.amount)}` : ''}</div>
                {a.detail && <div className="text-[13px] text-muted-foreground">{a.detail}</div>}
                <Link href={a.href} className={`self-start text-[13px] font-semibold bg-card rounded-[9px] px-3 py-1.5 ${L.cta} hover:shadow-sm`}>{a.cta}</Link>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Row({ label, value, tone }) {
  return <div className="flex justify-between gap-3 text-sm py-2"><span className="text-foreground/75">{label}</span><span className={`font-semibold ${tone || ''}`}>{value}</span></div>;
}

function MoneyCard({ d, ov }) {
  const cash = ov ? Number(ov.cash || 0) : null;
  return (
    <Card className="p-5">
      <div className="flex justify-between items-baseline mb-1.5">
        <h2 className="font-bold">Uang</h2>
        <Link href="/dashboard/finance" className="text-[13px] font-semibold text-primary">Penagihan</Link>
      </div>
      <Row label="Piutang sudah ditagih" value={fmtRp(d.money.arTotal)} />
      {d.money.arOverdue > 0 && <Row label="— lewat jatuh tempo" value={fmtRp(d.money.arOverdue)} tone="text-red-600" />}
      <Row label="Utang sudah ditagih" value={fmtRp(d.money.apBilled)} />
      <Row label="Utang akan ditagih (barang sudah diterima)" value={fmtRp(d.money.apPending)} />
      {cash != null && <Row label="Kas & bank" value={fmtRp(cash)} tone={cash < 0 ? 'text-red-600' : ''} />}
      {cash != null && cash < 0 && (
        <div className="text-xs text-muted-foreground mt-1">Kas minus karena saldo awal belum diisi. <Link href="/dashboard/accounting/coa" className="text-primary font-semibold">Isi saldo awal</Link></div>
      )}
    </Card>
  );
}

function StockCard({ stock }) {
  const top = stock.byProduct.slice(0, 5);
  const max = Math.max(1, ...top.map(p => p.weight));
  return (
    <Card className="p-5 space-y-3">
      <div className="flex justify-between items-baseline">
        <h2 className="font-bold">Stok di gudang</h2>
        <Link href="/dashboard/inventory" className="text-[13px] font-semibold text-primary">Buka stok</Link>
      </div>
      {top.length === 0 ? <div className="text-sm text-muted-foreground py-2">Belum ada stok tersedia.</div> : top.map((p, i) => (
        <div key={p.name}>
          <div className="flex justify-between gap-3 text-sm"><span className="truncate">{p.name}</span><span className="font-semibold shrink-0">{fmtNum(p.weight, 1)} kg <span className="text-muted-foreground font-normal">· {p.bags} karung</span></span></div>
          <div className="h-2 bg-muted rounded-full mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${i === 0 ? 'bg-emerald-500' : 'bg-emerald-400/80'}`} style={{ width: `${Math.max(3, p.weight / max * 100)}%` }} /></div>
        </div>
      ))}
      <div className="text-[13px] text-muted-foreground">
        Total {fmtNum(stock.weight, 1)} kg · {stock.bags} karung · nilai {fmtRp(stock.value)}
        {stock.nearExpiryBags > 0 && <span className="text-amber-700"> · {fmtNum(stock.nearExpiryKg, 1)} kg hampir kadaluarsa</span>}
      </div>
    </Card>
  );
}

function TodayCard({ today }) {
  return (
    <Card className="p-5">
      <div className="flex justify-between items-baseline mb-1.5">
        <h2 className="font-bold">Gudang hari ini</h2>
        <Link href="/dashboard/tally-history" className="text-[13px] font-semibold text-primary">Riwayat Tally</Link>
      </div>
      <Row label="Barang masuk" value={`${fmtNum(today.inKg, 1)} kg · ${fmtNum(today.inBags, 0)} karung`} />
      <Row label="Barang keluar" value={`${fmtNum(today.outKg, 1)} kg · ${fmtNum(today.outBags, 0)} karung`} />
      <div className="flex flex-wrap gap-2 pt-3">
        <Link href="/dashboard/sales-orders" className="text-[13px] font-semibold text-primary bg-primary/10 rounded-[9px] px-3 py-1.5 inline-flex items-center gap-1">Sales Order <ArrowRight className="w-3.5 h-3.5" /></Link>
        <Link href="/dashboard/purchase-orders" className="text-[13px] font-semibold text-primary bg-primary/10 rounded-[9px] px-3 py-1.5 inline-flex items-center gap-1">Purchase Order <ArrowRight className="w-3.5 h-3.5" /></Link>
      </div>
    </Card>
  );
}

function AgingCard({ aging }) {
  const cols = [['notDue', 'Belum jatuh tempo'], ['d1_7', 'Lewat 1–7 hari'], ['d8_30', 'Lewat 8–30 hari'], ['d30p', 'Lewat >30 hari']];
  const cell = (v, k) => <td key={k} className={`py-2.5 text-right ${v > 0 && k !== 'notDue' ? (k === 'd1_7' ? 'text-amber-700' : 'text-red-600') : v > 0 ? '' : 'text-muted-foreground'}`}>{v > 0 ? fmtRp(v) : '–'}</td>;
  return (
    <Card className="p-5 space-y-3">
      <div className="flex justify-between items-baseline">
        <h2 className="font-bold">Umur piutang & utang</h2>
        <Link href="/dashboard/finance" className="text-[13px] font-semibold text-primary">Penagihan</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-xs text-muted-foreground"><th className="text-left font-medium pb-2"></th>{cols.map(([k, l]) => <th key={k} className="text-right font-medium pb-2">{l}</th>)}</tr></thead>
          <tbody>
            <tr className="border-t"><td className="py-2.5 font-semibold">Piutang</td>{cols.map(([k]) => cell(aging.ar[k], k))}</tr>
            <tr className="border-t"><td className="py-2.5 font-semibold">Utang</td>{cols.map(([k]) => cell(aging.ap[k], k))}</tr>
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted-foreground">Jatuh tempo = tanggal faktur + termin (CBD/COD dihitung hari itu juga).</div>
    </Card>
  );
}
