'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, ClipboardList, Loader2, Factory, Zap } from 'lucide-react';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function ProductionReports() {
  const batches = useSWR('/api/production-reports/batches', fetcher);
  const eff = useSWR('/api/production-reports/efficiency', fetcher);
  const b = batches.data?.data;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="w-7 h-7 text-purple-600" />Laporan Produksi</h1><p className="text-muted-foreground text-sm mt-1">Per batch (WO), rendemen, HPP, efisiensi per produk</p></div>
      </div>
      <Tabs defaultValue="batches">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="batches"><Factory className="w-4 h-4 mr-1" />Per Batch</TabsTrigger>
          <TabsTrigger value="eff"><Zap className="w-4 h-4 mr-1" />Efisiensi per Produk</TabsTrigger>
        </TabsList>

        <TabsContent value="batches">
          <Card><CardHeader><CardTitle className="text-base">Rekap per Batch (Work Order)</CardTitle><CardDescription>Total cost, rendemen aktual, HPP/kg</CardDescription></CardHeader>
            <CardContent>
              {batches.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : b && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    <Stat label="Total Batches" value={b.summary.totalBatches} />
                    <Stat label="Total Live Bird" value={`${Number(b.summary.totalBaseWeight).toLocaleString('id-ID')} kg`} />
                    <Stat label="Total Rendemen" value={`${Number(b.summary.totalOutputWeight).toLocaleString('id-ID')} kg`} color="emerald" />
                    <Stat label="Avg Rendemen %" value={`${b.summary.avgRendemenPct.toFixed(2)}%`} color={b.summary.avgRendemenPct >= 70 ? 'emerald' : 'amber'} />
                  </div>
                  <Table><TableHeader><TableRow><TableHead>WO</TableHead><TableHead>Mode</TableHead><TableHead>Start</TableHead><TableHead>Status</TableHead><TableHead className="text-right">LB (kg)</TableHead><TableHead className="text-right">Rendemen</TableHead><TableHead className="text-right">% Yield</TableHead><TableHead className="text-right">Total Cost</TableHead><TableHead className="text-right">HPP/kg</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {b.batches.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Belum ada batch</TableCell></TableRow>}
                      {b.batches.map(w => (
                        <TableRow key={w.id}>
                          <TableCell><Link href={`/dashboard/work-orders/${w.id}`} className="font-mono text-xs font-semibold hover:underline">{w.woNumber}</Link></TableCell>
                          <TableCell><Badge variant="outline">{w.mode}</Badge>{w.maklon && <div className="text-xs text-muted-foreground">{w.maklon.name}</div>}</TableCell>
                          <TableCell className="text-sm">{format(new Date(w.startDate), 'dd MMM yyyy')}</TableCell>
                          <TableCell><Badge className={w.pipelineStatus === 'Selesai' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100'}>{w.pipelineStatus}</Badge></TableCell>
                          <TableCell className="text-right">{Number(w.totalLiveBirdWeight).toFixed(0)}</TableCell>
                          <TableCell className="text-right">{Number(w.totalRendemenWeight).toFixed(1)}</TableCell>
                          <TableCell className="text-right"><Badge className={w.rendemenPct >= 70 ? 'bg-emerald-100 text-emerald-700' : w.rendemenPct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>{w.rendemenPct.toFixed(1)}%</Badge></TableCell>
                          <TableCell className="text-right font-medium">Rp {Number(w.totalCost).toLocaleString('id-ID')}</TableCell>
                          <TableCell className="text-right font-bold text-emerald-700">Rp {Number(w.avgHppPerKg).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody></Table>
                </>
              )}
            </CardContent></Card>
        </TabsContent>

        <TabsContent value="eff">
          <Card><CardHeader><CardTitle className="text-base">Efisiensi Produksi per Produk Output</CardTitle><CardDescription>Total weight, avg HPP, avg coefficient</CardDescription></CardHeader>
            <CardContent className="p-0">
              {eff.isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> :
                <Table><TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>Stage</TableHead><TableHead className="text-right">Batch</TableHead><TableHead className="text-right">Total Weight</TableHead><TableHead className="text-right">Avg Coef</TableHead><TableHead className="text-right">Std Coef</TableHead><TableHead className="text-right">Avg HPP/kg</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(eff.data?.data || []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Belum ada data</TableCell></TableRow>}
                    {(eff.data?.data || []).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell><div className="font-medium">{r.product?.name}</div><div className="text-xs font-mono text-muted-foreground">{r.product?.sku}</div></TableCell>
                        <TableCell><Badge variant="outline">{r.stage}</Badge></TableCell>
                        <TableCell className="text-right">{r.count}</TableCell>
                        <TableCell className="text-right">{Number(r.totalWeight).toFixed(2)} kg</TableCell>
                        <TableCell className="text-right">{Number(r.avgCoef).toFixed(3)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{Number(r.product?.rendemenCoefficient || 1).toFixed(3)}</TableCell>
                        <TableCell className="text-right font-bold text-emerald-700">Rp {Number(r.avgHpp).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody></Table>}
            </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, color = 'slate' }) {
  const c = { emerald: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', slate: 'text-slate-900' }[color];
  return <div className="p-3 rounded-lg border bg-slate-50"><div className="text-xs text-muted-foreground uppercase">{label}</div><div className={`text-lg font-bold ${c}`}>{value}</div></div>;
}
