'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Loader2, Wallet } from 'lucide-react';
import { fmtRp, fmtDate, acctFetcher, SOURCE_LABEL, SOURCE_COLOR, defaultRange } from '@/lib/accounting/ui';

export default function LedgerPage() {
  const { data: accData } = useSWR('/api/accounting/accounts?archived=0', acctFetcher);
  const accounts = (accData?.data || []).filter((a) => a.is_postable);
  const [accountId, setAccountId] = useState('');
  const [range, setRange] = useState(defaultRange());

  const key = accountId ? `/api/accounting/ledger?accountId=${accountId}&from=${range.from}&to=${range.to}` : null;
  const { data, isLoading } = useSWR(key, acctFetcher);
  const led = data?.data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Wallet className="w-6 h-6 text-emerald-600" />Buku Besar</h1>
        <p className="text-muted-foreground text-sm">Mutasi & saldo berjalan tiap akun.</p>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[260px]">
            <Label className="text-xs">Akun</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Pilih akun" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Dari</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-40" /></div>
          <div><Label className="text-xs">Sampai</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-40" /></div>
        </CardContent>
      </Card>

      {!accountId && <div className="text-center text-muted-foreground text-sm py-10">Pilih akun untuk melihat buku besar.</div>}

      {accountId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {led?.account ? <><span className="font-mono text-sm text-muted-foreground">{led.account.code}</span>{led.account.name}</> : 'Buku Besar'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Tanggal</TableHead>
                    <TableHead>No. / Sumber</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Kredit</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
                  {led && (
                    <TableRow className="bg-slate-50">
                      <TableCell colSpan={5} className="text-xs font-medium">Saldo Awal Periode</TableCell>
                      <TableCell className="text-right text-sm font-semibold">{fmtRp(led.opening)}</TableCell>
                    </TableRow>
                  )}
                  {led?.rows?.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{fmtDate(r.date)}</TableCell>
                      <TableCell className="text-xs"><Badge variant="outline" className={`text-[10px] mr-1 ${SOURCE_COLOR[r.sourceType] || ''}`}>{SOURCE_LABEL[r.sourceType] || r.sourceType}</Badge>{r.sourceNumber || r.journalNumber}</TableCell>
                      <TableCell className="text-xs max-w-[280px] truncate">{r.description}</TableCell>
                      <TableCell className="text-right text-xs">{r.debit ? fmtRp(r.debit) : ''}</TableCell>
                      <TableCell className="text-right text-xs">{r.credit ? fmtRp(r.credit) : ''}</TableCell>
                      <TableCell className="text-right text-xs font-medium">{fmtRp(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  {led && led.rows?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground text-sm">Tidak ada mutasi pada periode ini.</TableCell></TableRow>}
                  {led && (
                    <TableRow className="bg-emerald-50 font-semibold">
                      <TableCell colSpan={5} className="text-sm">Saldo Akhir</TableCell>
                      <TableCell className="text-right text-sm">{fmtRp(led.closing)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
