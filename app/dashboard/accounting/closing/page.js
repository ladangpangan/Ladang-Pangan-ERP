'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Lock, Loader2, Undo2, BookLock, AlertTriangle } from 'lucide-react';
import { fmtRp, fmtDate, acctFetcher } from '@/lib/accounting/ui';

const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default function ClosingPage() {
  const { data, mutate, isLoading } = useSWR('/api/accounting/closings', acctFetcher);
  const rows = data?.data || [];
  const [period, setPeriod] = useState(curMonth());
  const [closing, setClosing] = useState(false);

  const doClose = async () => {
    setClosing(true);
    try {
      const res = await fetch('/api/accounting/closings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ period }) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Periode ${period} ditutup. Laba/Rugi ${fmtRp(j.netIncome)} dipindahkan ke Laba Ditahan.`);
      mutate();
    } catch (e) { toast.error(e.message); } finally { setClosing(false); }
  };

  const reopen = async (c) => {
    try {
      const res = await fetch(`/api/accounting/closings/${c.id}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Periode ${c.period} dibuka kembali.`); mutate();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><BookLock className="w-6 h-6 text-emerald-600" />Tutup Buku Bulanan</h1>
        <p className="text-muted-foreground text-sm">Memindahkan laba/rugi periode ke Laba Ditahan dan mengunci saldo laba rugi periode tersebut.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Tutup Periode</CardTitle><CardDescription>Pastikan seluruh transaksi periode ini sudah lengkap sebelum ditutup.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label className="text-xs">Periode (Bulan)</Label><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-48" /></div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={closing}>{closing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}Tutup Buku {period}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" />Tutup Buku {period}?</AlertDialogTitle>
                <AlertDialogDescription>Sistem akan membuat jurnal penutup yang memindahkan seluruh saldo Pendapatan & Beban periode {period} ke akun Laba Ditahan. Anda tetap bisa membuka kembali periode ini bila diperlukan.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction onClick={doClose}>Ya, Tutup Buku</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Riwayat Tutup Buku</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Periode</TableHead><TableHead>Tanggal Tutup</TableHead><TableHead className="text-right">Laba (Rugi) Bersih</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
                {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Belum ada periode yang ditutup.</TableCell></TableRow>}
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-sm">{c.period}</TableCell>
                    <TableCell className="text-xs">{fmtDate(c.closing_date)}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${c.net_income >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtRp(c.net_income)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] bg-slate-100"><Lock className="w-3 h-3 mr-1" />Ditutup</Badge></TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="text-amber-600"><Undo2 className="w-3.5 h-3.5 mr-1" />Buka</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Buka kembali periode {c.period}?</AlertDialogTitle><AlertDialogDescription>Jurnal penutup periode ini akan dihapus sehingga saldo laba rugi kembali terbuka.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={() => reopen(c)}>Ya, Buka</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
