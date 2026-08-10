'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scale, Printer } from 'lucide-react';
import { fmtRp, acctFetcher, defaultRange, todayStr, TYPE_LABEL } from '@/lib/accounting/ui';

const PrintBtn = () => (
  <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" />Cetak</Button>
);

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Scale className="w-6 h-6 text-emerald-600" />Laporan Keuangan</h1>
        <p className="text-muted-foreground text-sm">Sesuai SAK EP — Neraca Saldo, Laba Rugi, Laporan Posisi Keuangan (Neraca), dan Arus Kas.</p>
      </div>
      <Tabs defaultValue="tb">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="tb">Neraca Saldo</TabsTrigger>
          <TabsTrigger value="is">Laba Rugi</TabsTrigger>
          <TabsTrigger value="bs">Neraca</TabsTrigger>
          <TabsTrigger value="cf">Arus Kas</TabsTrigger>
        </TabsList>
        <TabsContent value="tb"><TrialBalance /></TabsContent>
        <TabsContent value="is"><IncomeStatement /></TabsContent>
        <TabsContent value="bs"><BalanceSheet /></TabsContent>
        <TabsContent value="cf"><CashFlow /></TabsContent>
      </Tabs>
    </div>
  );
}

/* --------- Neraca Saldo --------- */
function TrialBalance() {
  const [to, setTo] = useState(todayStr());
  const { data, isLoading } = useSWR(`/api/accounting/trial-balance?to=${to}`, acctFetcher);
  const d = data?.data;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Neraca Saldo</CardTitle>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Per Tanggal</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
          <PrintBtn />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead className="w-24">Kode</TableHead><TableHead>Nama Akun</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Kredit</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
              {d?.rows?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell className="text-right text-sm">{r.debit ? fmtRp(r.debit) : ''}</TableCell>
                  <TableCell className="text-right text-sm">{r.credit ? fmtRp(r.credit) : ''}</TableCell>
                </TableRow>
              ))}
              {d && (
                <TableRow className="bg-slate-50 font-semibold">
                  <TableCell colSpan={2}>TOTAL</TableCell>
                  <TableCell className="text-right">{fmtRp(d.totalDebit)}</TableCell>
                  <TableCell className="text-right">{fmtRp(d.totalCredit)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {d && <div className={`text-sm mt-2 ${Math.abs(d.totalDebit - d.totalCredit) < 1 ? 'text-emerald-600' : 'text-red-600'}`}>{Math.abs(d.totalDebit - d.totalCredit) < 1 ? 'Neraca saldo seimbang ✓' : 'Tidak seimbang!'}</div>}
      </CardContent>
    </Card>
  );
}

const CardDescription = ({ children }) => <p className="text-xs text-muted-foreground">{children}</p>;

/* --------- Laba Rugi --------- */
function Section({ title, data, sign }) {
  if (!data) return null;
  return (
    <>
      <TableRow className="bg-slate-50"><TableCell colSpan={2} className="font-semibold text-sm">{title}</TableCell></TableRow>
      {data.items.map((it) => (
        <TableRow key={it.code}><TableCell className="pl-6 text-sm"><span className="font-mono text-xs text-muted-foreground mr-2">{it.code}</span>{it.name}</TableCell><TableCell className="text-right text-sm">{fmtRp(it.amount)}</TableCell></TableRow>
      ))}
      {data.items.length === 0 && <TableRow><TableCell className="pl-6 text-sm text-muted-foreground" colSpan={2}>—</TableCell></TableRow>}
    </>
  );
}
function IncomeStatement() {
  const [range, setRange] = useState(defaultRange());
  const { data, isLoading } = useSWR(`/api/accounting/income-statement?from=${range.from}&to=${range.to}`, acctFetcher);
  const d = data?.data;
  const Row = ({ label, value, strong }) => (
    <TableRow className={strong ? 'bg-emerald-50 font-semibold' : 'font-medium'}><TableCell>{label}</TableCell><TableCell className="text-right">{fmtRp(value)}</TableCell></TableRow>
  );
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Laporan Laba Rugi</CardTitle>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Dari</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-36" /></div>
          <div><Label className="text-xs">Sampai</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-36" /></div>
          <PrintBtn />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</div>}
        {d && (
          <div className="rounded-md border overflow-x-auto max-w-2xl">
            <Table>
              <TableBody>
                <Section title="Pendapatan" data={d.revenue} />
                <Row label="Total Pendapatan" value={d.revenue.total} />
                <Section title="Beban Pokok Penjualan (HPP)" data={d.cogs} />
                <Row label="Total HPP" value={d.cogs.total} />
                <Row label="LABA KOTOR" value={d.grossProfit} strong />
                <Section title="Beban Operasional" data={d.expense} />
                <Row label="Total Beban Operasional" value={d.expense.total} />
                <Row label="LABA OPERASIONAL" value={d.operatingProfit} strong />
                <Section title="Pendapatan Lain" data={d.otherIncome} />
                <Section title="Beban Lain" data={d.otherExpense} />
                <Row label="LABA (RUGI) BERSIH" value={d.netIncome} strong />
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------- Neraca --------- */
function BsSide({ title, side }) {
  return (
    <div>
      <div className="font-semibold text-sm bg-slate-100 px-3 py-2 rounded-t-md border">{title}</div>
      <div className="border border-t-0 rounded-b-md divide-y">
        {side.groups.map((g, gi) => (
          <div key={gi} className="p-2">
            <div className="text-xs font-medium text-muted-foreground mb-1">{g.category}</div>
            {g.items.map((it) => (
              <div key={it.code} className="flex justify-between text-sm py-0.5"><span><span className="font-mono text-xs text-muted-foreground mr-2">{it.code}</span>{it.name}</span><span>{fmtRp(it.amount)}</span></div>
            ))}
            <div className="flex justify-between text-sm font-medium pt-1 border-t mt-1"><span>Subtotal {g.category}</span><span>{fmtRp(g.total)}</span></div>
          </div>
        ))}
        <div className="flex justify-between p-2 font-semibold bg-emerald-50"><span>TOTAL {title.toUpperCase()}</span><span>{fmtRp(side.total)}</span></div>
      </div>
    </div>
  );
}
function BalanceSheet() {
  const [asOf, setAsOf] = useState(todayStr());
  const { data, isLoading } = useSWR(`/api/accounting/balance-sheet?asOf=${asOf}`, acctFetcher);
  const d = data?.data;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Laporan Posisi Keuangan (Neraca)</CardTitle>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Per Tanggal</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" /></div>
          <PrintBtn />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</div>}
        {d && (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <BsSide title="Aset" side={d.assets} />
              <div className="space-y-4">
                <BsSide title="Liabilitas" side={d.liabilities} />
                <BsSide title="Ekuitas" side={d.equity} />
              </div>
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm font-semibold">
              <div className="flex justify-between bg-emerald-50 p-2 rounded-md border"><span>TOTAL ASET</span><span>{fmtRp(d.totalAssets)}</span></div>
              <div className="flex justify-between bg-emerald-50 p-2 rounded-md border"><span>TOTAL LIABILITAS & EKUITAS</span><span>{fmtRp(d.totalLiabilitiesEquity)}</span></div>
            </div>
            <div className={`text-sm mt-2 ${d.balanced ? 'text-emerald-600' : 'text-red-600'}`}>{d.balanced ? 'Neraca seimbang ✓' : 'Neraca tidak seimbang — periksa jurnal / saldo awal.'}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* --------- Arus Kas --------- */
function CashFlow() {
  const [range, setRange] = useState(defaultRange());
  const { data, isLoading } = useSWR(`/api/accounting/cash-flow?from=${range.from}&to=${range.to}`, acctFetcher);
  const d = data?.data;
  const Row = ({ label, value, strong }) => (
    <div className={`flex justify-between py-1.5 px-3 ${strong ? 'font-semibold bg-emerald-50' : ''}`}><span>{label}</span><span>{fmtRp(value)}</span></div>
  );
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Laporan Arus Kas</CardTitle>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Dari</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-36" /></div>
          <div><Label className="text-xs">Sampai</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-36" /></div>
          <PrintBtn />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</div>}
        {d && (
          <div className="rounded-md border divide-y max-w-xl">
            <Row label="Kas Awal Periode" value={d.beginningCash} />
            <Row label="Arus Kas dari Aktivitas Operasi" value={d.operating} />
            <Row label="Arus Kas dari Aktivitas Investasi" value={d.investing} />
            <Row label="Arus Kas dari Aktivitas Pendanaan" value={d.financing} />
            <Row label="Kenaikan (Penurunan) Kas Bersih" value={d.netChange} strong />
            <Row label="Kas Akhir Periode" value={d.endingCash} strong />
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">Metode langsung — dikelompokkan berdasar kategori arus kas tiap akun lawan.</p>
      </CardContent>
    </Card>
  );
}
