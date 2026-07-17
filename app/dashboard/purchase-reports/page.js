'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, BarChart3, Loader2, ShoppingCart, Users, DollarSign, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function PurchaseReports() {
  const bySup = useSWR('/api/purchase-reports/by-supplier', fetcher);
  const aging = useSWR('/api/purchase-reports/ap-aging', fetcher);
  const susut = useSWR('/api/purchase-reports/susut-recap', fetcher);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingCart className="w-7 h-7 text-blue-600" />Laporan Pembelian</h1><p className="text-muted-foreground text-sm mt-1">Per supplier, AP aging, rekap susut Live Bird</p></div>
      </div>
      <Tabs defaultValue="sup">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="sup"><Users className="w-4 h-4 mr-1" />By Supplier</TabsTrigger>
          <TabsTrigger value="ap"><DollarSign className="w-4 h-4 mr-1" />AP Aging</TabsTrigger>
          <TabsTrigger value="susut"><AlertTriangle className="w-4 h-4 mr-1" />Susut Recap</TabsTrigger>
        </TabsList>

        <TabsContent value="sup">
          <Card><CardHeader><CardTitle className="text-base">Pembelian per Supplier</CardTitle></CardHeader>
            <CardContent className="p-0">
              {bySup.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> :
                <Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Tipe</TableHead><TableHead className="text-right">PO Count</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Terbayar</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(bySup.data?.data || []).length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Belum ada data</TableCell></TableRow>}
                    {(bySup.data?.data || []).map(r => (
                      <TableRow key={r.supplierId}>
                        <TableCell><div className="font-medium">{r.supplier?.name}</div><div className="text-xs font-mono text-muted-foreground">{r.supplier?.code}</div></TableCell>
                        <TableCell><Badge variant="outline">{r.supplier?.contactType}</Badge></TableCell>
                        <TableCell className="text-right">{r.count}</TableCell>
                        <TableCell className="text-right font-semibold">Rp {Number(r.total).toLocaleString('id-ID')}</TableCell>
                        <TableCell className="text-right text-emerald-700">Rp {Number(r.paid).toLocaleString('id-ID')}</TableCell>
                        <TableCell className="text-right text-red-600">Rp {Number(r.outstanding).toLocaleString('id-ID')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>}
            </CardContent></Card>
        </TabsContent>

        <TabsContent value="ap">
          <Card><CardHeader><CardTitle className="text-base">Account Payable (Utang) Aging</CardTitle><CardDescription>Berdasarkan invoice date atau order date</CardDescription></CardHeader>
            <CardContent>
              {aging.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : aging.data?.data && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    {Object.entries(aging.data.data.buckets).map(([b, v]) => (
                      <div key={b} className={`p-3 rounded-lg border ${b === '90+' ? 'bg-red-50 border-red-200' : b === '61-90' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50'}`}>
                        <div className="text-xs uppercase text-muted-foreground">{b} hari</div>
                        <div className="font-bold">Rp {Number(v).toLocaleString('id-ID')}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-sm mb-3">Total Outstanding: <b>Rp {Number(aging.data.data.totalOutstanding).toLocaleString('id-ID')}</b></div>
                  <Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Order Date</TableHead><TableHead>Umur</TableHead><TableHead>Bucket</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {aging.data.data.details.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Tidak ada utang aktif</TableCell></TableRow>}
                      {aging.data.data.details.map(d => (
                        <TableRow key={d.poId}>
                          <TableCell className="font-mono text-xs">{d.poNumber}<div className="text-muted-foreground">{d.invoiceNumber}</div></TableCell>
                          <TableCell>{d.supplier?.name}</TableCell>
                          <TableCell className="text-sm">{d.orderDate && format(new Date(d.orderDate), 'dd MMM yyyy')}</TableCell>
                          <TableCell>{d.daysOld}d</TableCell>
                          <TableCell><Badge className={d.bucket === '90+' ? 'bg-red-100 text-red-700' : d.bucket === '61-90' ? 'bg-amber-100 text-amber-700' : ''}>{d.bucket}</Badge></TableCell>
                          <TableCell className="text-right font-semibold">Rp {Number(d.outstanding).toLocaleString('id-ID')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody></Table>
                </>
              )}
            </CardContent></Card>
        </TabsContent>

        <TabsContent value="susut">
          <Card><CardHeader><CardTitle className="text-base">Rekap Susut Live Bird</CardTitle><CardDescription>Selisih berat kandang vs RPH per item PO</CardDescription></CardHeader>
            <CardContent>
              {susut.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : susut.data?.data && (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="p-3 rounded-lg border bg-slate-50"><div className="text-xs text-muted-foreground uppercase">Total Susut</div><div className="text-2xl font-bold text-red-600">{Number(susut.data.data.summary.totalSusut).toFixed(2)} kg</div></div>
                    <div className="p-3 rounded-lg border bg-slate-50"><div className="text-xs text-muted-foreground uppercase">Nilai Susut</div><div className="text-2xl font-bold text-red-600">Rp {Number(susut.data.data.summary.totalValue).toLocaleString('id-ID')}</div></div>
                    <div className="p-3 rounded-lg border bg-slate-50"><div className="text-xs text-muted-foreground uppercase">Kejadian</div><div className="text-2xl font-bold">{susut.data.data.summary.count}</div></div>
                  </div>
                  <Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Metode</TableHead><TableHead>Supplier</TableHead><TableHead>Produk</TableHead><TableHead className="text-right">Kandang</TableHead><TableHead className="text-right">RPH</TableHead><TableHead className="text-right">Susut</TableHead><TableHead className="text-right">Nilai</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {susut.data.data.details.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Belum ada susut tercatat</TableCell></TableRow>}
                      {susut.data.data.details.map((d, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{d.poNumber}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{d.method}</Badge></TableCell>
                          <TableCell className="text-sm">{d.supplier?.name}</TableCell>
                          <TableCell className="text-sm">{d.product?.name}</TableCell>
                          <TableCell className="text-right">{d.weightSupplier} kg</TableCell>
                          <TableCell className="text-right">{d.weightRph} kg</TableCell>
                          <TableCell className="text-right font-bold text-red-600">{Number(d.susut).toFixed(2)} kg</TableCell>
                          <TableCell className="text-right">Rp {Number(d.value).toLocaleString('id-ID')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody></Table>
                </>
              )}
            </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
