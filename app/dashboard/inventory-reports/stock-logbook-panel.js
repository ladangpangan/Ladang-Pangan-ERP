'use client';

import React, { useState, useMemo } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ArrowDownToLine, ArrowUpFromLine, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const MOVE = {
  IN: { label: 'Masuk', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  OUT: { label: 'Keluar', cls: 'bg-red-100 text-red-700 border-red-200' },
  RETURN_IN: { label: 'Retur Masuk', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  TRANSFER_IN: { label: 'Transfer Masuk', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  TRANSFER_OUT: { label: 'Transfer Keluar', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  ADJ: { label: 'Penyesuaian', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  DAMAGE: { label: 'Rusak/Susut', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  OPENING: { label: 'Saldo Awal', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
};

export default function StockLogbookPanel() {
  const [productId, setProductId] = useState('all');
  const [csId, setCsId] = useState('all');
  const [mType, setMType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: prodData } = useSWR('/api/products', fetcher);
  const { data: csData } = useSWR('/api/cold-storages', fetcher);
  const products = prodData?.data || [];
  const coldStorages = csData?.data || [];

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (productId && productId !== 'all') p.set('productId', productId);
    if (csId && csId !== 'all') p.set('coldStorageId', csId);
    if (mType && mType !== 'all') p.set('movementType', mType);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('limit', '500');
    return p.toString();
  }, [productId, csId, mType, from, to]);

  const { data, isLoading } = useSWR(`/api/stock-ledger?${qs}`, fetcher, { keepPreviousData: true });
  const rows = data?.data?.movements || [];
  const summary = data?.data?.summary || {};
  const total = data?.data?.total || 0;
  const returned = data?.data?.returned || 0;

  const resetFilters = () => { setProductId('all'); setCsId('all'); setMType('all'); setFrom(''); setTo(''); };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDownToLine className="w-3.5 h-3.5 text-emerald-600" /> Total Masuk</div>
          <div className="text-lg font-bold text-emerald-700">{kg(summary.totalInWeight)} kg</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpFromLine className="w-3.5 h-3.5 text-red-600" /> Total Keluar</div>
          <div className="text-lg font-bold text-red-700">{kg(summary.totalOutWeight)} kg</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground">Selisih (Net)</div>
          <div className="text-lg font-bold">{kg((summary.totalInWeight || 0) - (summary.totalOutWeight || 0))} kg</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="text-xs text-muted-foreground">Jumlah Pergerakan</div>
          <div className="text-lg font-bold">{total}</div>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filter Logbook</CardTitle>
          <CardDescription>Saring berdasarkan produk, cold storage, jenis pergerakan, dan tanggal.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Produk</label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Semua produk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua produk</SelectItem>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Cold Storage</label>
              <Select value={csId} onValueChange={setCsId}>
                <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  {coldStorages.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Jenis</label>
              <Select value={mType} onValueChange={setMType}>
                <SelectTrigger><SelectValue placeholder="Semua" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua jenis</SelectItem>
                  {Object.keys(MOVE).map(k => <SelectItem key={k} value={k}>{MOVE[k].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Dari tanggal</label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Sampai tanggal</label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="outline" size="sm" onClick={resetFilters}><RotateCcw className="w-4 h-4 mr-1.5" /> Reset Filter</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin inline text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Belum ada pergerakan stok untuk filter ini.</div>
          ) : (
            <div className="overflow-x-auto">
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
                  {rows.map(r => {
                    const m = MOVE[r.movementType] || { label: r.movementType, cls: 'bg-muted text-foreground' };
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs">{r.ledgerDate ? format(new Date(r.ledgerDate), 'dd MMM yyyy') : '-'}</TableCell>
                        <TableCell><Badge variant="outline" className={`text-[10px] ${m.cls}`}>{m.label}</Badge></TableCell>
                        <TableCell className="min-w-[140px]">
                          <div className="text-sm font-medium leading-tight">{r.productName}</div>
                          <div className="text-[10px] text-muted-foreground">{r.sku}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.kodeSimpan || '-'}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.referenceType ? `${r.referenceType}${r.referenceNumber ? ' \u00b7 ' + r.referenceNumber : ''}` : '-'}</TableCell>
                        <TableCell className="text-xs">{r.csCode || '-'}</TableCell>
                        <TableCell className="text-right text-emerald-700 text-sm">{r.weightIn > 0 ? kg(r.weightIn) : ''}</TableCell>
                        <TableCell className="text-right text-red-700 text-sm">{r.weightOut > 0 ? kg(r.weightOut) : ''}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {returned < total && (
                <div className="text-center text-xs text-muted-foreground mt-3">Menampilkan {returned} dari {total} pergerakan (persempit filter untuk melihat lebih spesifik).</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
