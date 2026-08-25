'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Boxes, Loader2, Warehouse, Package, Clock, AlertTriangle, ScrollText } from 'lucide-react';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const MOVE = {
  IN: { label: 'Masuk', cls: 'bg-emerald-100 text-emerald-700' },
  OUT: { label: 'Keluar', cls: 'bg-red-100 text-red-700' },
  RETURN_IN: { label: 'Retur Masuk', cls: 'bg-emerald-100 text-emerald-700' },
  TRANSFER_IN: { label: 'Transfer Masuk', cls: 'bg-blue-100 text-blue-700' },
  TRANSFER_OUT: { label: 'Transfer Keluar', cls: 'bg-amber-100 text-amber-700' },
  ADJ: { label: 'Penyesuaian', cls: 'bg-purple-100 text-purple-700' },
  DAMAGE: { label: 'Rusak/Susut', cls: 'bg-rose-100 text-rose-700' },
};

const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function StockCardTab() {
  const now = new Date();
  const [productId, setProductId] = useState('all');
  const [csId, setCsId] = useState('all');
  const [mType, setMType] = useState('all');
  const [from, setFrom] = useState(fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(fmtDate(now));

  const products = useSWR('/api/products', fetcher);
  const css = useSWR('/api/cold-storages', fetcher);

  const isCard = productId && productId !== 'all';

  // Mode Kartu Stok (1 produk) — dengan saldo berjalan
  const qs = new URLSearchParams();
  if (isCard) { qs.set('productId', productId); if (csId !== 'all') qs.set('coldStorageId', csId); if (from) qs.set('from', from); if (to) qs.set('to', to); }
  const card = useSWR(isCard ? `/api/inventory-reports/stock-card?${qs.toString()}` : null, fetcher);
  const d = card.data?.data;

  // Mode Logbook (semua produk) — lalu lintas stok tanpa saldo berjalan
  const logQs = new URLSearchParams();
  if (!isCard) { if (csId !== 'all') logQs.set('coldStorageId', csId); if (mType !== 'all') logQs.set('movementType', mType); if (from) logQs.set('from', from); if (to) logQs.set('to', to); logQs.set('limit', '500'); }
  const log = useSWR(!isCard ? `/api/stock-ledger?${logQs.toString()}` : null, fetcher, { keepPreviousData: true });
  const ld = log.data?.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><ScrollText className="w-4 h-4 text-indigo-600" />Kartu Stok</CardTitle>
        <CardDescription>Pilih <b>Semua Produk</b> untuk melihat logbook lalu lintas stok semua produk; pilih <b>1 produk</b> untuk kartu stok lengkap dengan saldo awal, saldo berjalan &amp; saldo akhir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Produk</label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Produk (Logbook)</SelectItem>
                {(products.data?.data || []).map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Cold Storage</label>
            <Select value={csId} onValueChange={setCsId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua CS</SelectItem>
                {(css.data?.data || []).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Jenis</label>
            <Select value={mType} onValueChange={setMType} disabled={isCard}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua jenis</SelectItem>
                {Object.keys(MOVE).map(k => <SelectItem key={k} value={k}>{MOVE[k].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Dari</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Sampai</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>

        {/* MODE LOGBOOK — semua produk (tanpa saldo berjalan) */}
        {!isCard && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border bg-emerald-50"><div className="text-xs uppercase text-emerald-700">Total Masuk</div><div className="text-xl font-bold text-emerald-700">{kg(ld?.summary?.totalInWeight)} kg</div></div>
              <div className="p-3 rounded-lg border bg-red-50"><div className="text-xs uppercase text-red-700">Total Keluar</div><div className="text-xl font-bold text-red-700">{kg(ld?.summary?.totalOutWeight)} kg</div></div>
              <div className="p-3 rounded-lg border bg-slate-50"><div className="text-xs uppercase text-muted-foreground">Selisih (Net)</div><div className="text-xl font-bold">{kg((ld?.summary?.totalInWeight || 0) - (ld?.summary?.totalOutWeight || 0))} kg</div></div>
              <div className="p-3 rounded-lg border bg-indigo-50"><div className="text-xs uppercase text-indigo-700">Jumlah Pergerakan</div><div className="text-xl font-bold text-indigo-700">{ld?.total || 0}</div></div>
            </div>
            {log.isLoading ? (
              <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
            ) : (ld?.movements || []).length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">Belum ada pergerakan stok untuk filter ini.</div>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Jenis</TableHead>
                      <TableHead>Produk</TableHead>
                      <TableHead>Kode Simpan</TableHead>
                      <TableHead>Referensi</TableHead>
                      <TableHead>CS</TableHead>
                      <TableHead className="text-right">Masuk</TableHead>
                      <TableHead className="text-right">Keluar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(ld?.movements || []).map(m => {
                      const mv = MOVE[m.movementType] || { label: m.movementType, cls: 'bg-slate-100 text-slate-700' };
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs whitespace-nowrap">{m.ledgerDate ? format(new Date(m.ledgerDate), 'dd MMM yyyy') : '-'}</TableCell>
                          <TableCell><Badge className={mv.cls}>{mv.label}</Badge></TableCell>
                          <TableCell className="min-w-[140px]"><div className="text-sm font-medium leading-tight">{m.productName}</div><div className="text-[10px] text-muted-foreground">{m.sku}</div></TableCell>
                          <TableCell className="font-mono text-xs">{m.kodeSimpan || '-'}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{m.referenceType ? `${m.referenceType}${m.referenceNumber ? ' · ' + m.referenceNumber : ''}` : '-'}</TableCell>
                          <TableCell className="text-xs">{m.csCode || '-'}</TableCell>
                          <TableCell className="text-right text-emerald-700 text-sm">{m.weightIn > 0 ? kg(m.weightIn) : ''}</TableCell>
                          <TableCell className="text-right text-red-600 text-sm">{m.weightOut > 0 ? kg(m.weightOut) : ''}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {ld && ld.returned < ld.total && <div className="text-center text-xs text-muted-foreground mt-3">Menampilkan {ld.returned} dari {ld.total} pergerakan.</div>}
              </div>
            )}
          </>
        )}

        {/* MODE KARTU STOK — 1 produk (dengan saldo berjalan) */}
        {isCard && card.isLoading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}

        {isCard && d && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border bg-slate-50"><div className="text-xs uppercase text-muted-foreground">Saldo Awal</div><div className="text-xl font-bold">{kg(d.opening?.weight)} kg</div></div>
              <div className="p-3 rounded-lg border bg-emerald-50"><div className="text-xs uppercase text-emerald-700">Total Masuk</div><div className="text-xl font-bold text-emerald-700">{kg(d.summary?.totalInWeight)} kg</div></div>
              <div className="p-3 rounded-lg border bg-red-50"><div className="text-xs uppercase text-red-700">Total Keluar</div><div className="text-xl font-bold text-red-700">{kg(d.summary?.totalOutWeight)} kg</div></div>
              <div className="p-3 rounded-lg border bg-indigo-50"><div className="text-xs uppercase text-indigo-700">Saldo Akhir</div><div className="text-xl font-bold text-indigo-700">{kg(d.summary?.closingWeight)} kg</div></div>
            </div>

            {/* Ledger table */}
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead>CS</TableHead>
                    <TableHead className="text-right">Masuk</TableHead>
                    <TableHead className="text-right">Keluar</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/40">
                    <TableCell colSpan={5} className="text-sm font-medium text-muted-foreground">Saldo Awal per {from ? format(new Date(from), 'dd MMM yyyy') : '-'}</TableCell>
                    <TableCell className="text-right font-semibold">{kg(d.opening?.weight)} kg</TableCell>
                  </TableRow>
                  {(d.movements || []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Tidak ada pergerakan pada periode ini</TableCell></TableRow>
                  )}
                  {(d.movements || []).map(m => {
                    const mv = MOVE[m.movementType] || { label: m.movementType, cls: 'bg-slate-100 text-slate-700' };
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm whitespace-nowrap">{format(new Date(m.ledgerDate), 'dd MMM yyyy')}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={mv.cls}>{mv.label}</Badge>
                            {m.referenceNumber && <span className="text-xs font-mono text-muted-foreground">{m.referenceNumber}</span>}
                          </div>
                          {(m.kodeSimpan || m.notes) && <div className="text-xs text-muted-foreground mt-0.5">{m.kodeSimpan ? `Kode: ${m.kodeSimpan}` : ''}{m.kodeSimpan && m.notes ? ' · ' : ''}{m.notes || ''}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{m.coldStorage?.name || '-'}</TableCell>
                        <TableCell className="text-right text-emerald-700 font-medium">{Number(m.weightIn || 0) > 0 ? `${kg(m.weightIn)}` : '-'}</TableCell>
                        <TableCell className="text-right text-red-600 font-medium">{Number(m.weightOut || 0) > 0 ? `${kg(m.weightOut)}` : '-'}</TableCell>
                        <TableCell className="text-right font-semibold">{kg(m.balanceWeight)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {(d.movements || []).length > 0 && (
                    <TableRow className="bg-indigo-50 font-semibold">
                      <TableCell colSpan={3} className="text-sm">Saldo Akhir</TableCell>
                      <TableCell className="text-right text-emerald-700">{kg(d.summary?.totalInWeight)}</TableCell>
                      <TableCell className="text-right text-red-600">{kg(d.summary?.totalOutWeight)}</TableCell>
                      <TableCell className="text-right text-indigo-700">{kg(d.summary?.closingWeight)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function InventoryReports() {
  const byCs = useSWR('/api/inventory-reports/by-cs', fetcher);
  const byProd = useSWR('/api/inventory-reports/by-product', fetcher);
  const near = useSWR('/api/inventory-reports/near-expired?days=14', fetcher);
  const dmg = useSWR('/api/inventory-reports/damage-recap', fetcher);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Boxes className="w-7 h-7 text-cyan-600" />Laporan Inventory</h1><p className="text-muted-foreground text-sm mt-1">Per CS/produk, kartu stok, mendekati expired, rekap rusak/susut</p></div>
      </div>
      <Tabs defaultValue="cs">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="cs"><Warehouse className="w-4 h-4 mr-1" />Per CS</TabsTrigger>
          <TabsTrigger value="prod"><Package className="w-4 h-4 mr-1" />Per Produk</TabsTrigger>
          <TabsTrigger value="card"><ScrollText className="w-4 h-4 mr-1" />Kartu Stok</TabsTrigger>
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

        <TabsContent value="card">
          <StockCardTab />
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
