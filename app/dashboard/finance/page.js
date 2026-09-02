'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Wallet, Loader2, Search, ReceiptText, FileText, HandCoins, Gift,
  TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

function StatusBadge({ status }) {
  const paid = status === 'Lunas' || status === 'Dikembalikan';
  return (
    <Badge variant="outline" className={paid
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : 'bg-amber-100 text-amber-700 border-amber-200'}>
      {status}
    </Badge>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, tone = 'default' }) {
  const toneMap = {
    default: 'text-slate-600 bg-slate-100',
    green: 'text-emerald-600 bg-emerald-100',
    red: 'text-red-600 bg-red-100',
    amber: 'text-amber-600 bg-amber-100',
    blue: 'text-blue-600 bg-blue-100',
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${toneMap[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-bold truncate">{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function useFilter(rows, keys) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(term)));
  }, [rows, q, keys]);
  return { q, setQ, filtered };
}

function SearchBar({ q, setQ, placeholder }) {
  return (
    <div className="relative max-w-sm">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

export default function FinancePage() {
  const { data, isLoading } = useSWR('/api/finance/overview', fetcher, { revalidateOnFocus: false });
  const d = data?.data || {};
  const invoiceSO = d.invoiceSO || [];
  const invoicePO = d.invoicePO || [];
  const komisi = d.komisi || [];
  const cashback = d.cashback || [];

  const soF = useFilter(invoiceSO, ['number', 'soNumber', 'party', 'status']);
  const poF = useFilter(invoicePO, ['number', 'poNumber', 'party', 'status']);
  const komF = useFilter(komisi, ['soNumber', 'party', 'status']);
  const cbF = useFilter(cashback, ['soNumber', 'party', 'status']);

  const sum = (arr, key) => arr.reduce((a, b) => a + Number(b[key] || 0), 0);
  const piutangSO = sum(invoiceSO.filter(r => r.status !== 'Lunas'), 'outstanding');
  const utangPO = sum(invoicePO.filter(r => r.status !== 'Lunas'), 'outstanding');
  const komisiBelum = sum(komisi.filter(r => r.status !== 'Lunas'), 'amount');
  const cashbackBelum = sum(cashback.filter(r => r.status !== 'Dikembalikan'), 'amount');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Memuat data keuangan...
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        Anda tidak memiliki akses ke halaman ini.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Wallet className="w-8 h-8 text-emerald-600" /> Keuangan — Komisi & Cashback
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Ringkasan tagihan customer (piutang SO), tagihan supplier (utang PO), komisi dropshipper, dan cashback.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard icon={ArrowDownCircle} tone="blue" label="Piutang SO (Belum Lunas)" value={rp(piutangSO)} sub={`${invoiceSO.filter(r => r.status !== 'Lunas').length} invoice belum lunas`} />
        <SummaryCard icon={ArrowUpCircle} tone="red" label="Utang PO (Belum Lunas)" value={rp(utangPO)} sub={`${invoicePO.filter(r => r.status !== 'Lunas').length} invoice belum lunas`} />
        <SummaryCard icon={HandCoins} tone="amber" label="Komisi Belum Dibayar" value={rp(komisiBelum)} sub={`${komisi.filter(r => r.status !== 'Lunas').length} dari ${komisi.length} komisi`} />
        <SummaryCard icon={Gift} tone="green" label="Cashback Belum Dikembalikan" value={rp(cashbackBelum)} sub={`${cashback.filter(r => r.status !== 'Dikembalikan').length} dari ${cashback.length} cashback`} />
      </div>

      <Tabs defaultValue="invoiceSO">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="invoiceSO"><ReceiptText className="w-4 h-4 mr-1" />Invoice SO</TabsTrigger>
          <TabsTrigger value="invoicePO"><FileText className="w-4 h-4 mr-1" />Invoice PO</TabsTrigger>
          <TabsTrigger value="komisi"><HandCoins className="w-4 h-4 mr-1" />Komisi</TabsTrigger>
          <TabsTrigger value="cashback"><Gift className="w-4 h-4 mr-1" />Cashback</TabsTrigger>
        </TabsList>

        {/* Invoice SO (piutang) */}
        <TabsContent value="invoiceSO">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ReceiptText className="w-5 h-5 text-blue-600" /> Tagihan ke Customer (Piutang SO)</CardTitle>
              <CardDescription>Daftar invoice Sales Order beserta status pembayaran.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchBar q={soF.q} setQ={soF.setQ} placeholder="Cari no. invoice / SO / customer..." />
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Invoice</TableHead>
                      <TableHead>No. SO</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Dibayar</TableHead>
                      <TableHead className="text-right">Sisa</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {soF.filtered.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>
                    )}
                    {soF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.number}</TableCell>
                        <TableCell>{r.soNumber}</TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right">{rp(r.total)}</TableCell>
                        <TableCell className="text-right text-emerald-700">{rp(r.paid)}</TableCell>
                        <TableCell className="text-right text-red-600 font-semibold">{rp(r.outstanding)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Invoice PO (utang) */}
        <TabsContent value="invoicePO">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-red-600" /> Tagihan dari Supplier (Utang PO)</CardTitle>
              <CardDescription>Daftar invoice Purchase Order beserta status pembayaran.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchBar q={poF.q} setQ={poF.setQ} placeholder="Cari no. invoice / PO / supplier..." />
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Invoice</TableHead>
                      <TableHead>No. PO</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Dibayar</TableHead>
                      <TableHead className="text-right">Sisa</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poF.filtered.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>
                    )}
                    {poF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.number}</TableCell>
                        <TableCell>{r.poNumber}</TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right">{rp(r.total)}</TableCell>
                        <TableCell className="text-right text-emerald-700">{rp(r.paid)}</TableCell>
                        <TableCell className="text-right text-red-600 font-semibold">{rp(r.outstanding)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Komisi */}
        <TabsContent value="komisi">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><HandCoins className="w-5 h-5 text-amber-600" /> Komisi Dropshipper</CardTitle>
              <CardDescription>Daftar komisi yang timbul dari Sales Order (dropship).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchBar q={komF.q} setQ={komF.setQ} placeholder="Cari no. SO / penerima..." />
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. SO</TableHead>
                      <TableHead>Penerima (Dropshipper)</TableHead>
                      <TableHead className="text-right">Nilai Komisi</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {komF.filtered.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>
                    )}
                    {komF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.soNumber}</TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right font-semibold">{rp(r.amount)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cashback */}
        <TabsContent value="cashback">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5 text-emerald-600" /> Cashback (Faktur di-Up)</CardTitle>
              <CardDescription>Daftar cashback dari Sales Order yang mengaktifkan markup faktur.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchBar q={cbF.q} setQ={cbF.setQ} placeholder="Cari no. SO / penerima..." />
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. SO</TableHead>
                      <TableHead>Penerima</TableHead>
                      <TableHead className="text-right">Nilai Cashback</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cbF.filtered.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>
                    )}
                    {cbF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.soNumber}</TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right font-semibold">{rp(r.amount)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
