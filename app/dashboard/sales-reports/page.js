'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, BarChart3, Loader2, TrendingUp, Users, Package, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import SalesProfitPanel from './sales-profit-panel';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function SalesReportsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const daily = useSWR(`/api/sales-reports/daily?${new URLSearchParams({ from, to })}`, fetcher);
  const aging = useSWR('/api/sales-reports/ar-aging', fetcher);
  const byCust = useSWR('/api/sales-reports/by-customer', fetcher);
  const byProd = useSWR('/api/sales-reports/by-product', fetcher);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/sales-orders"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><BarChart3 className="w-8 h-8 text-emerald-600" /> Laporan Penjualan</h1>
          <p className="text-muted-foreground text-sm mt-1">Insight penjualan, AR aging, top customer & top produk</p>
        </div>
      </div>

      <Tabs defaultValue="daily">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="daily"><TrendingUp className="w-4 h-4 mr-1" />Daily Sales</TabsTrigger>
          <TabsTrigger value="aging"><DollarSign className="w-4 h-4 mr-1" />AR Aging</TabsTrigger>
          <TabsTrigger value="cust"><Users className="w-4 h-4 mr-1" />By Customer</TabsTrigger>
          <TabsTrigger value="prod"><Package className="w-4 h-4 mr-1" />By Product</TabsTrigger>
          <TabsTrigger value="profit"><TrendingUp className="w-4 h-4 mr-1" />Laba</TabsTrigger>
        </TabsList>

        <TabsContent value="daily">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div><CardTitle>Penjualan Harian</CardTitle><CardDescription>Aggregasi per hari (kecuali Cancelled)</CardDescription></div>
                <div className="flex items-end gap-2">
                  <div><Label className="text-xs">Dari</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" /></div>
                  <div><Label className="text-xs">Sampai</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" /></div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {daily.isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}
              {daily.data?.data && (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                      <div className="text-xs text-emerald-700 uppercase">Total Revenue</div>
                      <div className="text-2xl font-bold">Rp {Number(daily.data.data.totalRevenue).toLocaleString('id-ID')}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                      <div className="text-xs text-blue-700 uppercase">Total Orders</div>
                      <div className="text-2xl font-bold">{daily.data.data.totalOrders}</div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead className="text-right">Jumlah Order</TableHead><TableHead className="text-right">Total (Rp)</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(daily.data.data.rows || []).length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>}
                      {(daily.data.data.rows || []).map(r => (
                        <TableRow key={r.date}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell className="text-right">{r.count}</TableCell>
                          <TableCell className="text-right font-semibold">Rp {Number(r.total).toLocaleString('id-ID')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging">
          <Card>
            <CardHeader><CardTitle>AR Aging (Piutang)</CardTitle><CardDescription>Umur piutang berdasarkan tanggal invoice</CardDescription></CardHeader>
            <CardContent>
              {aging.isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto" />}
              {aging.data?.data && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    {Object.entries(aging.data.data.buckets).map(([bucket, amount]) => (
                      <div key={bucket} className={`p-3 rounded-lg border ${bucket === '90+' ? 'bg-red-50 border-red-200' : bucket === '61-90' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50'}`}>
                        <div className="text-xs text-muted-foreground uppercase">{bucket} hari</div>
                        <div className="text-lg font-bold">Rp {Number(amount).toLocaleString('id-ID')}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-sm mb-3">Total Outstanding: <b>Rp {Number(aging.data.data.totalOutstanding).toLocaleString('id-ID')}</b></div>
                  <Table>
                    <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Tanggal Invoice</TableHead><TableHead>Umur</TableHead><TableHead>Bucket</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(aging.data.data.details || []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Tidak ada piutang aktif</TableCell></TableRow>}
                      {(aging.data.data.details || []).map(d => (
                        <TableRow key={d.soId}>
                          <TableCell className="font-mono text-xs">{d.invoiceNumber}<div className="text-muted-foreground">{d.soNumber}</div></TableCell>
                          <TableCell>{d.customer?.name}</TableCell>
                          <TableCell className="text-sm">{d.invoiceDate && format(new Date(d.invoiceDate), 'dd MMM yyyy')}</TableCell>
                          <TableCell>{d.daysOld} hari</TableCell>
                          <TableCell><Badge className={d.bucket === '90+' ? 'bg-red-100 text-red-700' : d.bucket === '61-90' ? 'bg-amber-100 text-amber-700' : ''}>{d.bucket}</Badge></TableCell>
                          <TableCell className="text-right font-semibold">Rp {Number(d.outstanding).toLocaleString('id-ID')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cust">
          <Card>
            <CardHeader><CardTitle>Sales per Customer</CardTitle><CardDescription>Diurutkan berdasarkan total nilai penjualan</CardDescription></CardHeader>
            <CardContent className="p-0">
              {byCust.isLoading && <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
              {byCust.data?.data && (
                <Table>
                  <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Order</TableHead><TableHead className="text-right">Total Sales</TableHead><TableHead className="text-right">Terbayar</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {byCust.data.data.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Belum ada data</TableCell></TableRow>}
                    {byCust.data.data.map((r) => (
                      <TableRow key={r.customerId}>
                        <TableCell><div className="font-medium">{r.customer?.name}</div><div className="text-xs text-muted-foreground font-mono">{r.customer?.code}{r.customer?.isSubscriber && <Badge variant="outline" className="ml-1 text-[10px]">Sub</Badge>}</div></TableCell>
                        <TableCell className="text-right">{r.count}</TableCell>
                        <TableCell className="text-right font-semibold">Rp {Number(r.total).toLocaleString('id-ID')}</TableCell>
                        <TableCell className="text-right text-emerald-700">Rp {Number(r.paid).toLocaleString('id-ID')}</TableCell>
                        <TableCell className="text-right text-red-600">Rp {Number(r.outstanding).toLocaleString('id-ID')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prod">
          <Card>
            <CardHeader><CardTitle>Sales per Product</CardTitle><CardDescription>Diurutkan berdasarkan total revenue</CardDescription></CardHeader>
            <CardContent className="p-0">
              {byProd.isLoading && <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
              {byProd.data?.data && (
                <Table>
                  <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>Kategori</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Berat</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {byProd.data.data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Belum ada data</TableCell></TableRow>}
                    {byProd.data.data.map((r) => (
                      <TableRow key={r.productId}>
                        <TableCell><div className="font-medium">{r.product?.name}</div><div className="text-xs text-muted-foreground font-mono">{r.product?.sku}</div></TableCell>
                        <TableCell><Badge variant="outline">{r.product?.category || '-'}</Badge></TableCell>
                        <TableCell className="text-right">{Number(r.totalQty).toLocaleString('id-ID')} {r.product?.unit}</TableCell>
                        <TableCell className="text-right">{Number(r.totalWeight).toLocaleString('id-ID')} kg</TableCell>
                        <TableCell className="text-right">{r.orderCount}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700">Rp {Number(r.totalRevenue).toLocaleString('id-ID')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profit">
          <SalesProfitPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
