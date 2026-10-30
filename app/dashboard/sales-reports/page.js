'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, BarChart3, Loader2, FileSpreadsheet, AlertTriangle, ArrowUpRight, Lock } from 'lucide-react';
import { exportToExcel } from '@/lib/xlsx-export';

const fetcher = (url) => fetch(url).then(r => r.json());
const rp = (n) => 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' kg';
const pct = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const ymd = (d) => format(d, 'yyyy-MM-dd');
const PAY = { unpaid: ['Belum bayar', 'bg-red-50 text-red-700'], partial: ['Sebagian', 'bg-amber-50 text-amber-700'], paid: ['Lunas', 'bg-emerald-50 text-emerald-700'] };

// Pilihan periode — berlaku untuk semua tab
const PRESETS = {
  thisMonth: { label: 'Bulan ini', range: () => { const n = new Date(); return { from: ymd(new Date(n.getFullYear(), n.getMonth(), 1)), to: ymd(n) }; } },
  lastMonth: { label: 'Bulan lalu', range: () => { const n = new Date(); return { from: ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: ymd(new Date(n.getFullYear(), n.getMonth(), 0)) }; } },
  thisYear: { label: 'Tahun ini', range: () => { const n = new Date(); return { from: ymd(new Date(n.getFullYear(), 0, 1)), to: ymd(n) }; } },
  custom: { label: 'Pilih tanggal…', range: null },
};

function Kpi({ label, value, sub, tone }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : '';
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </CardContent></Card>
  );
}

function SoLink({ id, no }) {
  return (
    <Link href={`/dashboard/sales-orders/${id}`} className="font-mono text-xs text-emerald-700 hover:underline inline-flex items-center gap-0.5">
      {no}<ArrowUpRight className="w-3 h-3" />
    </Link>
  );
}

export default function SalesReportsPage() {
  const [preset, setPreset] = useState('thisMonth');
  const [custom, setCustom] = useState(PRESETS.thisMonth.range());
  const range = preset === 'custom' ? custom : PRESETS[preset].range();
  const { data, isLoading } = useSWR(`/api/sales-reports/overview?${new URLSearchParams(range)}`, fetcher);
  const aging = useSWR('/api/sales-reports/ar-aging', fetcher);
  const d = data?.data;
  const t = d?.totals || {};
  const boss = !!d?.canSeeProfit;
  const periodLabel = useMemo(() => {
    try { return `${format(new Date(range.from), 'd MMM yyyy', { locale: localeId })} – ${format(new Date(range.to), 'd MMM yyyy', { locale: localeId })}`; } catch { return ''; }
  }, [range.from, range.to]);
  const maxDay = Math.max(1, ...((d?.daily || []).map(x => x.revenue)));

  const doExport = () => {
    if (!d) return;
    const P = boss ? [{ key: 'cogs', label: 'HPP' }, { key: 'grossProfit', label: 'Laba Kotor' }, { key: 'margin', label: 'Margin %' }] : [];
    exportToExcel(`laporan-penjualan-${range.from}_sd_${range.to}`, [
      { name: 'Per Produk', headers: [{ key: 'name', label: 'Produk' }, { key: 'weight', label: 'Berat (kg)' }, { key: 'revenue', label: 'Penjualan' }, ...P, ...(boss ? [{ key: 'profitPerKg', label: 'Laba/kg' }] : [{ key: 'avgPrice', label: 'Harga rata-rata/kg' }])], rows: d.byProduct },
      { name: 'Per Pelanggan', headers: [{ key: 'customer', label: 'Pelanggan' }, { key: 'orders', label: 'SO' }, { key: 'revenue', label: 'Penjualan' }, ...(boss ? [{ key: 'cogs', label: 'HPP' }, { key: 'shipping', label: 'Ongkir' }, { key: 'grossProfit', label: 'Laba Kotor' }, { key: 'commission', label: 'Komisi' }, { key: 'netProfit', label: 'Laba setelah komisi' }] : [{ key: 'avgPerOrder', label: 'Rata-rata/SO' }])], rows: d.byCustomer },
      { name: 'Rincian Order', headers: [{ key: 'soNumber', label: 'No. SO' }, { key: 'customer', label: 'Pelanggan' }, { key: 'revenue', label: 'Penjualan' }, { key: 'returns', label: 'Retur' }, ...(boss ? [{ key: 'cogs', label: 'HPP' }, { key: 'shipping', label: 'Ongkir' }, { key: 'commission', label: 'Komisi' }, { key: 'grossProfit', label: 'Laba Kotor' }, { key: 'margin', label: 'Margin %' }, { key: 'note', label: 'Catatan' }] : [])],
        rows: d.orders.map(o => ({ ...o, note: o.hppMissing ? 'HPP belum ada' : '' })) },
    ]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Link href="/dashboard/sales-orders"><Button variant="ghost" size="icon" aria-label="Kembali ke Sales Order"><ArrowLeft className="w-5 h-5" /></Button></Link>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2"><BarChart3 className="w-7 h-7 text-emerald-600" /> Laporan Penjualan</h1>
            <p className="text-muted-foreground text-sm mt-1">Penjualan = SO yang sudah dikirim atau difaktur, tanpa yang dibatalkan, bersih retur. Tanggal mengikuti tanggal faktur.</p>
          </div>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">Periode (semua tab)</Label>
            <Select value={preset} onValueChange={(v) => { setPreset(v); if (v === 'custom') setCustom(range); }}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PRESETS).map(([k, p]) => <SelectItem key={k} value={k}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {preset === 'custom' && (
            <>
              <div className="space-y-1"><Label className="text-xs" htmlFor="rep-from">Dari</Label><Input id="rep-from" type="date" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} className="w-40" /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor="rep-to">Sampai</Label><Input id="rep-to" type="date" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} className="w-40" /></div>
            </>
          )}
          <Button variant="outline" onClick={doExport} disabled={!d}><FileSpreadsheet className="w-4 h-4 mr-2" />Unduh Excel</Button>
        </div>
      </div>

      <Tabs defaultValue="summary">
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          <TabsTrigger value="summary">Ringkasan</TabsTrigger>
          <TabsTrigger value="product">Per Produk</TabsTrigger>
          <TabsTrigger value="customer">Per Pelanggan</TabsTrigger>
          <TabsTrigger value="orders">Rincian Order</TabsTrigger>
          <TabsTrigger value="aging">Umur Piutang</TabsTrigger>
        </TabsList>

        {isLoading && <div className="text-center py-10 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</div>}

        {d && (
          <div className="space-y-4 mt-4">
            <div className="text-xs text-muted-foreground">Periode: <b className="text-foreground">{periodLabel}</b></div>
            {boss && t.hppMissing > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span><b>{t.hppMissing} order belum punya HPP lengkap</b> (ditandai di Rincian Order). Labanya terlihat lebih besar dari sebenarnya. Lengkapi HPP kode simpan / PO-nya.</span>
              </div>
            )}
            <div className={`grid gap-3 grid-cols-2 ${boss ? 'lg:grid-cols-6' : 'lg:grid-cols-4'}`}>
              <Kpi label="Penjualan (bersih retur)" value={rp(t.revenue)} sub={`${t.orders} SO${t.returns > 0 ? ` · retur −${rp(t.returns)}` : ''}`} />
              <Kpi label="Berat terjual" value={kg(t.weight)} sub={`${t.products} produk`} />
              {boss ? (
                <>
                  <Kpi label="HPP" value={rp(t.cogs)} sub="dari kode simpan & PO" />
                  <Kpi label="Laba kotor" value={rp(t.grossProfit)} tone="good" sub={`${t.shipping > 0 ? `setelah ongkir −${rp(t.shipping)} · ` : ''}margin ${pct(t.margin)}`} />
                  <Kpi label="Komisi" value={t.commission > 0 ? '−' + rp(t.commission) : rp(0)} tone={t.commission > 0 ? 'bad' : undefined} sub="komisi dropshipper" />
                  <Kpi label="Laba setelah komisi" value={rp(t.netProfit)} tone="good" sub={`margin ${pct(t.netMargin)}`} />
                </>
              ) : (
                <>
                  <Kpi label="Rata-rata per SO" value={rp(t.avgPerOrder)} />
                  <Kpi label="Pelanggan" value={String(t.customers || 0)} />
                </>
              )}
            </div>
          </div>
        )}

        {d && (
          <>
            <TabsContent value="summary" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-3 min-w-0">
                <Card className="lg:col-span-2 min-w-0"><CardContent className="pt-5 space-y-3">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap"><h2 className="font-semibold">Penjualan per hari</h2><span className="text-xs text-muted-foreground">berdasarkan tanggal faktur</span></div>
                  {d.daily.length === 0 ? <div className="text-sm text-muted-foreground py-10 text-center">Belum ada penjualan di periode ini.</div> : (
                    <div className="overflow-x-auto">
                      <div className="flex items-end gap-1.5 h-44 border-b" style={{ minWidth: `${d.daily.length * 24}px` }}>
                        {d.daily.map(x => (
                          <div key={x.date} className="flex-1 flex flex-col items-center justify-end h-full gap-1 min-w-[18px]" title={`${x.date}: ${rp(x.revenue)} · ${x.orders} SO`}>
                            <div className="w-full max-w-[36px] rounded-t bg-emerald-600" style={{ height: `${Math.max(2, Math.round(x.revenue / maxDay * 150))}px` }} />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-1.5 mt-1" style={{ minWidth: `${d.daily.length * 24}px` }}>
                        {d.daily.map(x => <span key={x.date} className="flex-1 text-center text-[10px] text-muted-foreground min-w-[18px]">{x.date.slice(8)}</span>)}
                      </div>
                    </div>
                  )}
                </CardContent></Card>
                <Card><CardContent className="pt-5 space-y-2 text-sm">
                  <h2 className="font-semibold">Pesanan berjalan</h2>
                  <p className="text-xs text-muted-foreground">Belum dikirim, jadi belum dihitung sebagai penjualan. Berdasarkan tanggal order.</p>
                  <div className="flex justify-between border-t pt-2"><span>Draf</span><b>{d.pipeline.draft.count} SO · {rp(d.pipeline.draft.amount)}</b></div>
                  <div className="flex justify-between border-t pt-2"><span>Dikonfirmasi / Dikemas</span><b>{d.pipeline.inProgress.count} SO · {rp(d.pipeline.inProgress.amount)}</b></div>
                  <div className="flex justify-between border-t pt-2 text-muted-foreground"><span>Dibatalkan (tidak dihitung)</span><span>{d.pipeline.cancelled.count} SO · {rp(d.pipeline.cancelled.amount)}</span></div>
                </CardContent></Card>
              </div>
            </TabsContent>

            <TabsContent value="product" className="mt-4">
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Produk</TableHead><TableHead className="text-right">Berat terjual</TableHead><TableHead className="text-right">Penjualan</TableHead>
                    {boss ? <><TableHead className="text-right">HPP</TableHead><TableHead className="text-right">Laba kotor</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Laba / kg</TableHead></> : <TableHead className="text-right">Harga rata-rata / kg</TableHead>}
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.byProduct.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Tidak ada data.</TableCell></TableRow>}
                    {d.byProduct.map(p => (
                      <TableRow key={p.productId}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{kg(p.weight)}</TableCell>
                        <TableCell className="text-right tabular-nums">{rp(p.revenue)}</TableCell>
                        {boss ? <>
                          <TableCell className="text-right tabular-nums">{rp(p.cogs)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold text-emerald-700">{rp(p.grossProfit)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(p.margin)}</TableCell>
                          <TableCell className="text-right tabular-nums">{rp(p.profitPerKg)}</TableCell>
                        </> : <TableCell className="text-right tabular-nums">{rp(p.avgPrice)}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
              {boss && <p className="text-xs text-muted-foreground mt-2">Laba per produk dihitung sebelum ongkir dan komisi (keduanya dicatat per SO, bukan per produk). Retur dibagi ke produk menurut nilai baris.</p>}
            </TabsContent>

            <TabsContent value="customer" className="mt-4">
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Pelanggan</TableHead><TableHead className="text-right">SO</TableHead><TableHead className="text-right">Penjualan</TableHead>
                    {boss ? <><TableHead className="text-right">HPP</TableHead><TableHead className="text-right">Ongkir</TableHead><TableHead className="text-right">Laba kotor</TableHead><TableHead className="text-right">Komisi</TableHead><TableHead className="text-right">Laba setelah komisi</TableHead></> : <TableHead className="text-right">Rata-rata / SO</TableHead>}
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.byCustomer.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Tidak ada data.</TableCell></TableRow>}
                    {d.byCustomer.map(c => (
                      <TableRow key={c.customerId}>
                        <TableCell className="font-medium">{c.customer}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                        <TableCell className="text-right tabular-nums">{rp(c.revenue)}</TableCell>
                        {boss ? <>
                          <TableCell className="text-right tabular-nums">{rp(c.cogs)}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.shipping > 0 ? '−' + rp(c.shipping) : '–'}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold text-emerald-700">{rp(c.grossProfit)}<div className="text-[10px] font-normal text-muted-foreground">{pct(c.margin)}</div></TableCell>
                          <TableCell className="text-right tabular-nums">{c.commission > 0 ? '−' + rp(c.commission) : '–'}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{rp(c.netProfit)}</TableCell>
                        </> : <TableCell className="text-right tabular-nums">{rp(c.avgPerOrder)}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="orders" className="mt-4">
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Tanggal</TableHead><TableHead>No. SO</TableHead><TableHead>Pelanggan</TableHead><TableHead className="text-right">Penjualan</TableHead>
                    {boss ? <><TableHead className="text-right">HPP</TableHead><TableHead className="text-right">Ongkir</TableHead><TableHead className="text-right">Komisi</TableHead><TableHead className="text-right">Laba kotor</TableHead><TableHead className="text-right">Margin</TableHead></> : <TableHead>Status bayar</TableHead>}
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.orders.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Tidak ada data.</TableCell></TableRow>}
                    {d.orders.map(o => (
                      <TableRow key={o.id} className={boss && o.hppMissing ? 'bg-amber-50/60' : undefined}>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(o.date * 1000), 'd MMM', { locale: localeId })}</TableCell>
                        <TableCell><SoLink id={o.id} no={o.soNumber} /></TableCell>
                        <TableCell className="text-sm">{o.customer}</TableCell>
                        <TableCell className="text-right tabular-nums">{rp(o.revenue)}{o.returns > 0 && <div className="text-[10px] text-muted-foreground">retur −{rp(o.returns)}</div>}</TableCell>
                        {boss ? <>
                          <TableCell className="text-right tabular-nums">{rp(o.cogs)}{o.hppMissing && <div><Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] mt-0.5">HPP belum ada</Badge></div>}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.shipping > 0 ? '−' + rp(o.shipping) : '–'}</TableCell>
                          <TableCell className="text-right tabular-nums">{o.commission > 0 ? '−' + rp(o.commission) : '–'}</TableCell>
                          <TableCell className={`text-right tabular-nums font-semibold ${o.hppMissing ? 'text-amber-700' : 'text-emerald-700'}`}>{rp(o.grossProfit)}</TableCell>
                          <TableCell className="text-right tabular-nums">{pct(o.margin)}</TableCell>
                        </> : <TableCell><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${(PAY[o.paymentStatus] || PAY.unpaid)[1]}`}>{(PAY[o.paymentStatus] || PAY.unpaid)[0]}</span></TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>
          </>
        )}

        <TabsContent value="aging" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3">Posisi piutang hari ini (tidak mengikuti periode), dihitung dari tanggal faktur.</p>
          {aging.isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}
          {aging.data?.data && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[['0-30', '0 – 30 hari', 'bg-emerald-50 border-emerald-200'], ['31-60', '31 – 60 hari', 'bg-amber-50 border-amber-200'], ['61-90', '61 – 90 hari', 'bg-orange-50 border-orange-200'], ['90+', 'Lebih dari 90 hari', 'bg-red-50 border-red-200']].map(([k, label, cls]) => (
                  <div key={k} className={`p-3 rounded-lg border ${cls}`}>
                    <div className="text-xs font-medium text-muted-foreground">{label}</div>
                    <div className="text-lg font-bold tabular-nums">{rp(aging.data.data.buckets[k])}</div>
                  </div>
                ))}
              </div>
              <div className="text-sm">Total piutang: <b>{rp(aging.data.data.totalOutstanding)}</b></div>
              <Card><CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Faktur / SO</TableHead><TableHead>Pelanggan</TableHead><TableHead>Tanggal faktur</TableHead><TableHead>Umur</TableHead><TableHead className="text-right">Sisa tagihan</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(aging.data.data.details || []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Tidak ada piutang.</TableCell></TableRow>}
                    {(aging.data.data.details || []).map(x => (
                      <TableRow key={x.soId}>
                        <TableCell><div className="font-mono text-xs">{x.invoiceNumber}</div><SoLink id={x.soId} no={x.soNumber} /></TableCell>
                        <TableCell>{x.customer?.name}</TableCell>
                        <TableCell className="text-sm">{x.invoiceDate && format(new Date(x.invoiceDate), 'd MMM yyyy', { locale: localeId })}</TableCell>
                        <TableCell>{x.daysOld} hari</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{rp(x.outstanding)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {!boss && d && <p className="text-xs text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" />HPP dan laba hanya terlihat oleh Direktur &amp; Akuntan.</p>}
    </div>
  );
}
