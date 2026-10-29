'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { fmtRp, fmtDate, acctFetcher, defaultRange } from '@/lib/accounting/ui';
import { exportToExcel } from '@/lib/xlsx-export';

const KPI = ({ label, value, sub }) => (
  <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-bold mt-1">{value}</div>{sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}</CardContent></Card>
);

export default function SalesProfitPanel() {
  const [range, setRange] = useState(defaultRange());
  const { data, isLoading } = useSWR(`/api/accounting/sales-profit?from=${range.from}&to=${range.to}`, acctFetcher);
  const d = data?.data;
  const t = d?.totals || {};

  const doExport = () => {
    if (!d) return;
    exportToExcel(`laba-penjualan-${range.from}_sd_${range.to}`, [
      { name: 'Per Pelanggan', headers: [
        { key: 'customer', label: 'Pelanggan' }, { key: 'orders', label: 'Jml Order' },
        { key: 'revenue', label: 'Pendapatan' }, { key: 'cogs', label: 'HPP' }, { key: 'shipping', label: 'Ongkir' },
        { key: 'grossProfit', label: 'Laba Kotor' }, { key: 'margin', label: 'Margin %' },
      ], rows: d.byCustomer },
      { name: 'Per Periode', headers: [
        { key: 'month', label: 'Periode' }, { key: 'orders', label: 'Jml Order' },
        { key: 'revenue', label: 'Pendapatan' }, { key: 'cogs', label: 'HPP' }, { key: 'shipping', label: 'Ongkir' }, { key: 'grossProfit', label: 'Laba Kotor' },
      ], rows: d.byMonth },
      { name: 'Rincian Order', headers: [
        { key: 'soNumber', label: 'No. SO' }, { key: 'customer', label: 'Pelanggan' }, { key: 'type', label: 'Tipe' },
        { key: 'revenue', label: 'Pendapatan' }, { key: 'returns', label: 'Retur' }, { key: 'cogs', label: 'HPP' }, { key: 'shipping', label: 'Ongkir' }, { key: 'grossProfit', label: 'Laba Kotor' }, { key: 'margin', label: 'Margin %' },
        { key: 'hppNote', label: 'Catatan' },
      ], rows: d.orders.map(o => ({ ...o, hppNote: o.hppMissing ? 'HPP belum ada' : '' })) },
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-muted-foreground text-sm">Laba kotor = Pendapatan (bersih retur) − HPP − Ongkir ditanggung penjual. Dihitung dari SO yang sudah dikirim/difaktur (tidak termasuk yang dibatalkan), berdasarkan tanggal faktur.</p>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Dari</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-36" /></div>
          <div><Label className="text-xs">Sampai</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-36" /></div>
          <Button variant="outline" onClick={doExport} disabled={!d}><FileSpreadsheet className="w-4 h-4 mr-2" />Export Excel</Button>
        </div>
      </div>

      {isLoading && <div className="text-center py-8 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat...</div>}

      {d && (
        <>
          {t.hppMissing > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><b>{t.hppMissing} order belum punya HPP lengkap</b> (ditandai "HPP belum ada" di Rincian Order). Laba order tersebut terlihat lebih besar dari sebenarnya. Lengkapi HPP kode simpan / PO-nya.</span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KPI label="Jumlah Order" value={(t.orders || 0).toLocaleString('id-ID')} />
            <KPI label="Pendapatan" value={fmtRp(t.revenue)} sub={t.returns > 0 ? `sudah dikurangi retur ${fmtRp(t.returns)}` : 'bersih retur'} />
            <KPI label="HPP" value={fmtRp(t.cogs)} />
            <KPI label="Laba Kotor" value={fmtRp(t.grossProfit)} sub={t.shipping > 0 ? `setelah ongkir ditanggung penjual ${fmtRp(t.shipping)}` : undefined} />
            <KPI label="Margin" value={`${(t.margin || 0).toFixed(2)}%`} />
          </div>

          <Tabs defaultValue="cust">
            <TabsList><TabsTrigger value="cust">Per Pelanggan</TabsTrigger><TabsTrigger value="month">Per Periode</TabsTrigger><TabsTrigger value="orders">Rincian Order</TabsTrigger></TabsList>

            <TabsContent value="cust">
              <Card><CardContent className="pt-4">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Pelanggan</TableHead><TableHead className="text-right">Order</TableHead><TableHead className="text-right">Pendapatan</TableHead><TableHead className="text-right">HPP</TableHead><TableHead className="text-right">Ongkir</TableHead><TableHead className="text-right">Laba Kotor</TableHead><TableHead className="text-right">Margin</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {d.byCustomer.map((c) => (
                        <TableRow key={c.customerId}><TableCell className="text-sm">{c.customer}</TableCell><TableCell className="text-right text-sm">{c.orders}</TableCell><TableCell className="text-right text-sm">{fmtRp(c.revenue)}</TableCell><TableCell className="text-right text-sm">{fmtRp(c.cogs)}</TableCell><TableCell className="text-right text-sm">{fmtRp(c.shipping)}</TableCell><TableCell className="text-right text-sm font-medium text-emerald-700">{fmtRp(c.grossProfit)}</TableCell><TableCell className="text-right text-sm">{c.margin.toFixed(1)}%</TableCell></TableRow>
                      ))}
                      {d.byCustomer.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">Tidak ada data.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="month">
              <Card><CardContent className="pt-4">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Periode</TableHead><TableHead className="text-right">Order</TableHead><TableHead className="text-right">Pendapatan</TableHead><TableHead className="text-right">HPP</TableHead><TableHead className="text-right">Ongkir</TableHead><TableHead className="text-right">Laba Kotor</TableHead><TableHead className="text-right">Margin</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {d.byMonth.map((m) => (
                        <TableRow key={m.month}><TableCell className="text-sm font-mono">{m.month}</TableCell><TableCell className="text-right text-sm">{m.orders}</TableCell><TableCell className="text-right text-sm">{fmtRp(m.revenue)}</TableCell><TableCell className="text-right text-sm">{fmtRp(m.cogs)}</TableCell><TableCell className="text-right text-sm">{fmtRp(m.shipping)}</TableCell><TableCell className="text-right text-sm font-medium text-emerald-700">{fmtRp(m.grossProfit)}</TableCell><TableCell className="text-right text-sm">{m.margin.toFixed(1)}%</TableCell></TableRow>
                      ))}
                      {d.byMonth.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-4 text-muted-foreground">Tidak ada data.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="orders">
              <Card><CardContent className="pt-4">
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>No. SO</TableHead><TableHead>Pelanggan</TableHead><TableHead>Tipe</TableHead><TableHead className="text-right">Pendapatan</TableHead><TableHead className="text-right">HPP</TableHead><TableHead className="text-right">Ongkir</TableHead><TableHead className="text-right">Laba Kotor</TableHead><TableHead className="text-right">Margin</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {d.orders.map((o) => (
                        <TableRow key={o.id} className={o.hppMissing ? 'bg-amber-50/60' : undefined}><TableCell className="text-xs">{fmtDate(o.date)}</TableCell><TableCell className="font-mono text-xs">{o.soNumber}</TableCell><TableCell className="text-sm">{o.customer}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{o.type}</Badge></TableCell><TableCell className="text-right text-sm">{fmtRp(o.revenue)}{o.returns > 0 && <div className="text-[10px] text-muted-foreground">retur −{fmtRp(o.returns)}</div>}</TableCell><TableCell className="text-right text-sm">{fmtRp(o.cogs)}{o.hppMissing && <div><Badge className="bg-amber-100 text-amber-800 text-[10px] mt-0.5">HPP belum ada</Badge></div>}</TableCell><TableCell className="text-right text-sm">{fmtRp(o.shipping)}</TableCell><TableCell className="text-right text-sm font-medium text-emerald-700">{fmtRp(o.grossProfit)}</TableCell><TableCell className="text-right text-sm">{o.margin.toFixed(1)}%</TableCell></TableRow>
                      ))}
                      {d.orders.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-4 text-muted-foreground">Tidak ada data.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
