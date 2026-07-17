'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Boxes, Loader2, Warehouse, Package, Clock, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function InventoryReports() {
  const byCs = useSWR('/api/inventory-reports/by-cs', fetcher);
  const byProd = useSWR('/api/inventory-reports/by-product', fetcher);
  const near = useSWR('/api/inventory-reports/near-expired?days=14', fetcher);
  const dmg = useSWR('/api/inventory-reports/damage-recap', fetcher);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="w-7 h-7 text-cyan-600" />Laporan Inventory</h1><p className="text-muted-foreground text-sm mt-1">Per CS/produk, mendekati expired, rekap rusak/susut</p></div>
      </div>
      <Tabs defaultValue="cs">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cs"><Warehouse className="w-4 h-4 mr-1" />Per CS</TabsTrigger>
          <TabsTrigger value="prod"><Package className="w-4 h-4 mr-1" />Per Produk</TabsTrigger>
          <TabsTrigger value="exp"><Clock className="w-4 h-4 mr-1" />Near Expired</TabsTrigger>
          <TabsTrigger value="dmg"><AlertTriangle className="w-4 h-4 mr-1" />Rusak/Susut</TabsTrigger>
        </TabsList>

        <TabsContent value="cs">
          <Card><CardHeader><CardTitle className="text-base">Stok per Cold Storage</CardTitle></CardHeader>
            <CardContent className="p-0">
              {byCs.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> :
                <Table><TableHeader><TableRow><TableHead>Cold Storage</TableHead><TableHead>Lokasi</TableHead><TableHead className="text-right">Rows</TableHead><TableHead className="text-right">Total Berat</TableHead><TableHead className="text-right">Kapasitas</TableHead><TableHead className="text-right">Utilization</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(byCs.data?.data || []).map(r => (
                      <TableRow key={r.coldStorageId}>
                        <TableCell><div className="font-medium">{r.coldStorage?.name}</div><div className="text-xs font-mono text-muted-foreground">{r.coldStorage?.code}</div></TableCell>
                        <TableCell className="text-sm">{r.coldStorage?.location || '-'}</TableCell>
                        <TableCell className="text-right">{r.rowCount}</TableCell>
                        <TableCell className="text-right font-semibold">{Number(r.totalWeight).toFixed(1)} kg</TableCell>
                        <TableCell className="text-right text-muted-foreground">{Number(r.coldStorage?.capacityKg || 0).toLocaleString('id-ID')} kg</TableCell>
                        <TableCell className="text-right"><Badge className={r.utilization >= 90 ? 'bg-red-100 text-red-700' : r.utilization >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>{r.utilization.toFixed(1)}%</Badge></TableCell>
                      </TableRow>
                    ))}
                    {(byCs.data?.data || []).length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Belum ada stok</TableCell></TableRow>}
                  </TableBody></Table>}
            </CardContent></Card>
        </TabsContent>

        <TabsContent value="prod">
          <Card><CardHeader><CardTitle className="text-base">Stok per Produk</CardTitle><CardDescription>Low stock indicator berdasarkan min_stock produk</CardDescription></CardHeader>
            <CardContent className="p-0">
              {byProd.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> :
                <Table><TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>Kategori</TableHead><TableHead className="text-right">Rows</TableHead><TableHead className="text-right">Total Weight</TableHead><TableHead className="text-right">Min Stock</TableHead><TableHead className="text-right">Est. Value</TableHead><TableHead>Alert</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(byProd.data?.data || []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada stok</TableCell></TableRow>}
                    {(byProd.data?.data || []).map(r => (
                      <TableRow key={r.productId}>
                        <TableCell><div className="font-medium">{r.product?.name}</div><div className="text-xs font-mono text-muted-foreground">{r.product?.sku}</div></TableCell>
                        <TableCell><Badge variant="outline">{r.product?.category || '-'}</Badge></TableCell>
                        <TableCell className="text-right">{r.rowCount}</TableCell>
                        <TableCell className="text-right font-semibold">{Number(r.totalWeight).toFixed(2)} kg</TableCell>
                        <TableCell className="text-right text-muted-foreground">{Number(r.minStock).toFixed(1)} kg</TableCell>
                        <TableCell className="text-right">Rp {Number(r.estimatedValue).toLocaleString('id-ID')}</TableCell>
                        <TableCell>{r.lowStock && <Badge className="bg-red-100 text-red-700">Low Stock</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>}
            </CardContent></Card>
        </TabsContent>

        <TabsContent value="exp">
          <Card><CardHeader><CardTitle className="text-base">Stok Mendekati Expired (≤14 hari)</CardTitle></CardHeader>
            <CardContent className="p-0">
              {near.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> :
                <Table><TableHeader><TableRow><TableHead>Kode Simpan</TableHead><TableHead>Produk</TableHead><TableHead>CS</TableHead><TableHead className="text-right">Berat</TableHead><TableHead>Expired</TableHead><TableHead>Sisa Hari</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(near.data?.data || []).length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Tidak ada stok mendekati expired</TableCell></TableRow>}
                    {(near.data?.data || []).map(r => (
                      <TableRow key={r.id}>
                        <TableCell><Link href={`/dashboard/inventory/${r.id}`} className="font-mono text-xs font-semibold hover:underline">{r.kodeSimpan}</Link></TableCell>
                        <TableCell><div className="font-medium">{r.product?.name}</div><div className="text-xs font-mono text-muted-foreground">{r.product?.sku}</div></TableCell>
                        <TableCell className="text-sm">{r.coldStorage?.name}</TableCell>
                        <TableCell className="text-right">{Number(r.weight).toFixed(2)} kg</TableCell>
                        <TableCell className="text-sm">{r.expiredDate && format(new Date(r.expiredDate), 'dd MMM yyyy')}</TableCell>
                        <TableCell><Badge className={r.daysToExpire < 0 ? 'bg-red-100 text-red-700' : r.daysToExpire <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100'}>{r.daysToExpire < 0 ? `Expired ${-r.daysToExpire}d` : `${r.daysToExpire}d`}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>}
            </CardContent></Card>
        </TabsContent>

        <TabsContent value="dmg">
          <Card><CardHeader><CardTitle className="text-base">Rekap Rusak / Susut</CardTitle><CardDescription>Loss tercatat terpisah (bukan HPP)</CardDescription></CardHeader>
            <CardContent>
              {dmg.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : dmg.data?.data && (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="p-3 rounded-lg border bg-red-50"><div className="text-xs uppercase text-red-700">Total Kehilangan</div><div className="text-2xl font-bold text-red-700">{Number(dmg.data.data.summary.totalWeight).toFixed(2)} kg</div></div>
                    <div className="p-3 rounded-lg border bg-slate-50"><div className="text-xs uppercase text-muted-foreground">Kejadian</div><div className="text-2xl font-bold">{dmg.data.data.summary.totalRows}</div></div>
                  </div>
                  <Table><TableHeader><TableRow><TableHead>BA Number</TableHead><TableHead>Tanggal</TableHead><TableHead>CS</TableHead><TableHead>Alasan</TableHead><TableHead className="text-right">Berat</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {dmg.data.data.items.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Tidak ada kerusakan</TableCell></TableRow>}
                      {dmg.data.data.items.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.baNumber}</TableCell>
                          <TableCell className="text-sm">{format(new Date(r.transactionDate), 'dd MMM yyyy')}</TableCell>
                          <TableCell className="text-sm">{r.coldStorage?.name || '-'}</TableCell>
                          <TableCell className="text-sm">{r.reason}</TableCell>
                          <TableCell className="text-right font-semibold text-red-600">{Number(r.totalWeight).toFixed(2)} kg</TableCell>
                          <TableCell><Badge className={r.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : r.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100'}>{r.status}</Badge></TableCell>
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
