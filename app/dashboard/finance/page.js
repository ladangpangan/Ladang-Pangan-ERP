'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import {
  Wallet, Loader2, Search, ReceiptText, FileText, HandCoins, Gift,
  ArrowDownCircle, ArrowUpCircle, CalendarRange, X,
} from 'lucide-react';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

// Nomor dokumen yang bisa diklik menuju halaman detail (SO/PO).
function DocLink({ href, children }) {
  if (!href) return <span>{children}</span>;
  return (
    <Link href={href} className="text-emerald-700 hover:text-emerald-900 hover:underline font-medium">
      {children}
    </Link>
  );
}

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

// ---- Dialog: Bayar Komisi ----
function PayCommissionDialog({ rec, accounts, onDone }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ accountCode: '', method: 'Transfer', paymentDate: new Date().toISOString().slice(0, 10), reference: '', notes: '' });
  const submit = async () => {
    if (!form.accountCode) return toast.error('Pilih rekening Kas/Bank sumber pembayaran');
    setSaving(true);
    try {
      const res = await fetch('/api/finance/commissions/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ commissionRecordId: rec.id, ...form }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      toast.success('Pembayaran komisi tercatat & jurnal dibuat otomatis');
      setOpen(false); onDone();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><HandCoins className="w-4 h-4 mr-1" />Bayar</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bayar Komisi — {rec.soNumber}</DialogTitle>
          <DialogDescription>Nilai komisi {rp(rec.amount)} untuk {rec.party}. Jurnal Dr Beban Komisi / Cr Kas-Bank dibuat otomatis.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Tanggal</Label>
            <Input type="date" value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Metode</Label>
            <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="Transfer">Transfer</SelectItem><SelectItem value="Tunai">Tunai</SelectItem><SelectItem value="QRIS">QRIS</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Dibayar dari Rekening</Label>
            <Select value={form.accountCode || undefined} onValueChange={v => setForm({ ...form, accountCode: v })}>
              <SelectTrigger><SelectValue placeholder="Pilih Kas/Bank sumber dana" /></SelectTrigger>
              <SelectContent>{accounts.map(a => <SelectItem key={a.code} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Referensi (opsional)</Label>
            <Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="No. transfer / bukti" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Catatan (opsional)</Label>
            <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan Pembayaran</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Dialog: Kembalikan Cashback ----
function RefundCashbackDialog({ row, accounts, onDone }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountCode, setAccountCode] = useState('');
  const [refundedAt, setRefundedAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const submit = async () => {
    if (!accountCode) return toast.error('Pilih rekening Kas/Bank sumber pengembalian');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('accountCode', accountCode);
      fd.append('refundedAt', refundedAt);
      if (note) fd.append('note', note);
      if (file) fd.append('file', file);
      const res = await fetch(`/api/sales-orders/${row.id}/cashback-refund`, { method: 'POST', credentials: 'include', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      toast.success('Cashback ditandai dikembalikan & jurnal dibuat otomatis');
      setOpen(false); onDone();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Gift className="w-4 h-4 mr-1" />Kembalikan</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kembalikan Cashback — {row.soNumber}</DialogTitle>
          <DialogDescription>Nilai cashback {rp(row.amount)} untuk {row.party}. Jurnal Dr Beban Komisi / Cr Kas-Bank dibuat otomatis saat disimpan.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Tanggal Pengembalian</Label>
            <Input type="date" value={refundedAt} onChange={e => setRefundedAt(e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Dikembalikan dari Rekening</Label>
            <Select value={accountCode || undefined} onValueChange={setAccountCode}>
              <SelectTrigger><SelectValue placeholder="Pilih Kas/Bank sumber dana" /></SelectTrigger>
              <SelectContent>{accounts.map(a => <SelectItem key={a.code} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Catatan (opsional)</Label>
            <Input value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Bukti Transfer (opsional — PDF/JPG/PNG)</Label>
            <Input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan Pengembalian</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FinancePage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const key = `/api/finance/overview${qs.toString() ? '?' + qs.toString() : ''}`;
  const { data, isLoading, mutate } = useSWR(key, fetcher, { revalidateOnFocus: false });
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    fetch('/api/cash-bank-accounts', { credentials: 'include' }).then(r => r.json()).then(j => setAccounts(j.data || [])).catch(() => {});
  }, []);

  const d = data?.data || {};
  const invoiceSO = d.invoiceSO || [];
  const invoicePO = d.invoicePO || [];
  const komisi = d.komisi || [];
  const cashback = d.cashback || [];

  const soF = useFilter(invoiceSO, ['number', 'soNumber', 'party', 'status']);
  const poF = useFilter(invoicePO, ['number', 'poNumber', 'party', 'status']);
  const komF = useFilter(komisi, ['soNumber', 'party', 'status']);
  const cbF = useFilter(cashback, ['soNumber', 'party', 'status']);

  const sum = (arr, k) => arr.reduce((a, b) => a + Number(b[k] || 0), 0);
  const piutangSO = sum(invoiceSO.filter(r => r.status !== 'Lunas'), 'outstanding');
  const utangPO = sum(invoicePO.filter(r => r.status !== 'Lunas'), 'outstanding');
  const komisiBelum = sum(komisi.filter(r => r.status !== 'Lunas'), 'amount');
  const cashbackBelum = sum(cashback.filter(r => r.status !== 'Dikembalikan'), 'amount');

  const setThisMonth = () => {
    const now = new Date();
    const y = now.getFullYear(); const m = now.getMonth();
    const p = (n) => String(n).padStart(2, '0');
    const first = `${y}-${p(m + 1)}-01`;
    const last = new Date(y, m + 1, 0);
    setFrom(first);
    setTo(`${last.getFullYear()}-${p(last.getMonth() + 1)}-${p(last.getDate())}`);
  };
  const clearPeriod = () => { setFrom(''); setTo(''); };

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

      {/* Period filter */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarRange className="w-4 h-4" /> Filter Periode
            <span className="text-[11px] font-normal">(berdasarkan tanggal order)</span>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dari</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sampai</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
          </div>
          <Button variant="outline" size="sm" onClick={setThisMonth}>Bulan Ini</Button>
          {(from || to) && <Button variant="ghost" size="sm" onClick={clearPeriod}><X className="w-4 h-4 mr-1" />Reset</Button>}
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard icon={ArrowDownCircle} tone="blue" label="Piutang SO (Belum Lunas)" value={rp(piutangSO)} sub={`${invoiceSO.filter(r => r.status !== 'Lunas').length} invoice belum lunas`} />
        <SummaryCard icon={ArrowUpCircle} tone="red" label="Utang PO (Belum Lunas)" value={rp(utangPO)} sub={`${invoicePO.filter(r => r.status !== 'Lunas').length} invoice belum lunas`} />
        <SummaryCard icon={HandCoins} tone="amber" label="Komisi Belum Dibayar" value={rp(komisiBelum)} sub={`${komisi.filter(r => r.status !== 'Lunas').length} dari ${komisi.length} komisi`} />
        <SummaryCard icon={Gift} tone="green" label="Cashback Belum Dikembalikan" value={rp(cashbackBelum)} sub={`${cashback.filter(r => r.status !== 'Dikembalikan').length} dari ${cashback.length} cashback`} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Memuat data keuangan...
        </div>
      ) : data?.error ? (
        <div className="py-24 text-center text-muted-foreground">Anda tidak memiliki akses ke halaman ini.</div>
      ) : (
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
                      <TableHead>No. Invoice</TableHead><TableHead>No. SO</TableHead><TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Dibayar</TableHead>
                      <TableHead className="text-right">Sisa</TableHead><TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {soF.filtered.length === 0 && (<TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {soF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium"><DocLink href={`/dashboard/sales-orders/${r.id}`}>{r.number}</DocLink></TableCell>
                        <TableCell><DocLink href={`/dashboard/sales-orders/${r.id}`}>{r.soNumber}</DocLink></TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right">{rp(r.total)}</TableCell>
                        <TableCell className="text-right text-emerald-700">{rp(r.paid)}</TableCell>
                        <TableCell className="text-right">
                          {r.outstanding < 0 ? (
                            <span className="text-amber-600 font-semibold">{rp(Math.abs(r.outstanding))}<span className="block text-[10px] font-normal text-muted-foreground">cashback blm dikembalikan</span></span>
                          ) : r.outstanding > 0 ? (
                            <span className="text-red-600 font-semibold">{rp(r.outstanding)}</span>
                          ) : (
                            <span className="text-muted-foreground">Rp 0</span>
                          )}
                        </TableCell>
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
                      <TableHead>No. Invoice</TableHead><TableHead>No. PO</TableHead><TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Dibayar</TableHead>
                      <TableHead className="text-right">Sisa</TableHead><TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poF.filtered.length === 0 && (<TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {poF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium"><DocLink href={`/dashboard/purchase-orders/${r.id}`}>{r.number}</DocLink></TableCell>
                        <TableCell><DocLink href={`/dashboard/purchase-orders/${r.id}`}>{r.poNumber}</DocLink></TableCell>
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
              <CardDescription>Catat pembayaran komisi — jurnal Dr Beban Komisi / Cr Kas-Bank dibuat otomatis.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchBar q={komF.q} setQ={komF.setQ} placeholder="Cari no. SO / penerima..." />
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. SO</TableHead><TableHead>Penerima (Dropshipper)</TableHead>
                      <TableHead className="text-right">Nilai Komisi</TableHead><TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {komF.filtered.length === 0 && (<TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {komF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium"><DocLink href={r.salesOrderId ? `/dashboard/sales-orders/${r.salesOrderId}` : null}>{r.soNumber}</DocLink></TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right font-semibold">{rp(r.amount)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-right">
                          {r.status !== 'Lunas' ? <PayCommissionDialog rec={r} accounts={accounts} onDone={mutate} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
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
              <CardDescription>Catat pengembalian cashback — jurnal Dr Beban Komisi / Cr Kas-Bank dibuat otomatis.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchBar q={cbF.q} setQ={cbF.setQ} placeholder="Cari no. SO / penerima..." />
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. SO</TableHead><TableHead>Penerima</TableHead>
                      <TableHead className="text-right">Nilai Cashback</TableHead><TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cbF.filtered.length === 0 && (<TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {cbF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium"><DocLink href={`/dashboard/sales-orders/${r.id}`}>{r.soNumber}</DocLink></TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right font-semibold">{rp(r.amount)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-right">
                          {r.status !== 'Dikembalikan' ? <RefundCashbackDialog row={r} accounts={accounts} onDone={mutate} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}
