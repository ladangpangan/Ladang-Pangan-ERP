'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/auth-client';
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
import { Checkbox } from '@/components/ui/checkbox';
import { GenerateRecapDialog, RecapTemplateDialog } from '@/components/bill-recap-dialogs';
import { RECAP_STATUS_LABEL } from '@/lib/finance/recap-fields';
import {
  Wallet, Loader2, Search, ReceiptText, FileText, HandCoins, Gift,
  ArrowDownCircle, ArrowUpCircle, CalendarRange, X, FileStack, Settings2, FolderOpen,
  ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const tgl = (d) => { if (!d) return '-'; const t = new Date(d); return isNaN(t.getTime()) ? '-' : t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); };

// Nomor dokumen yang bisa diklik menuju halaman detail (SO/PO).
function DocLink({ href, children }) {
  if (!href) return <span>{children}</span>;
  return (
    <Link href={href} className="text-emerald-700 hover:text-emerald-900 hover:underline font-medium">
      {children}
    </Link>
  );
}

function StatusBadge({ status, note }) {
  const paid = status === 'Lunas' || status === 'Dikembalikan';
  const cancelled = status === 'Dibatalkan';
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <Badge variant="outline" className={cancelled
        ? 'bg-red-100 text-red-700 border-red-200'
        : paid
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
          : 'bg-amber-100 text-amber-700 border-amber-200'}>
        {status}
      </Badge>
      {note && <span className="text-[10px] leading-tight text-red-600 max-w-[140px]">{note}</span>}
    </span>
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

// Pencarian + urutan per kolom. Default: tanggal order terbaru di atas.
const SORT_DATE_KEYS = ['orderDate'];
function useFilter(rows, keys, defaultSort = { key: 'orderDate', dir: 'desc' }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(defaultSort);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term ? rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(term))) : rows;
    const { key, dir } = sort;
    const val = (r) => {
      const v = r[key];
      if (SORT_DATE_KEYS.includes(key)) { const t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? null : t; }
      return v;
    };
    const sorted = [...base].sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // kosong selalu di bawah
      if (vb == null) return -1;
      const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'id', { numeric: true, sensitivity: 'base' });
      return dir === 'asc' ? c : -c;
    });
    return sorted;
  }, [rows, q, keys, sort]);
  const toggleSort = (key) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: SORT_DATE_KEYS.includes(key) ? 'desc' : 'asc' }));
  return { q, setQ, filtered, sort, toggleSort };
}

// Judul kolom yang bisa diklik untuk mengurutkan (klik lagi = balik arah).
function SortHead({ f, k, children, className = '' }) {
  const active = f.sort.key === k;
  const Icon = !active ? ArrowUpDown : f.sort.dir === 'asc' ? ArrowUp : ArrowDown;
  const right = className.includes('text-right');
  const center = className.includes('text-center');
  return (
    <TableHead className={className} aria-sort={active ? (f.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => f.toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground font-semibold' : ''} ${right ? 'flex-row-reverse' : ''} ${center ? 'justify-center w-full' : ''}`}>
        {children}<Icon className={`w-3.5 h-3.5 shrink-0 ${active ? '' : 'opacity-40'}`} />
      </button>
    </TableHead>
  );
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
  const router = useRouter();
  const { data: session } = useSession();
  // Sama dengan requireRole() di server: akuntan setara admin (generate rekap & atur template).
  const isRecapAdmin = ['admin', 'akuntan'].includes(session?.user?.role);
  const [tab, setTab] = useState('invoiceSO');
  useEffect(() => {
    try { const t = new URLSearchParams(window.location.search).get('tab'); if (t) setTab(t); } catch { /* ignore */ }
  }, []);
  const [selectedPO, setSelectedPO] = useState([]);
  const [genOpen, setGenOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const { data: recapList, mutate: mutateRecaps } = useSWR('/api/finance/recaps?docType=PO', fetcher, { revalidateOnFocus: false });
  const recaps = recapList?.data || [];
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const key = `/api/finance/overview${qs.toString() ? '?' + qs.toString() : ''}`;
  const { data, isLoading, mutate } = useSWR(key, fetcher, { revalidateOnFocus: false });
  // Ganti periode -> kosongkan pilihan agar invoice yang tidak lagi tampil tidak ikut terekap.
  useEffect(() => { setSelectedPO([]); }, [key]);
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
  const canRecapPO = (r) => !r.recap && !['Draft', 'Dibatalkan'].includes(r.pipelineStatus);
  const selectablePO = poF.filtered.filter(canRecapPO);
  const selectedPORows = invoicePO.filter(r => selectedPO.includes(r.id));
  const komF = useFilter(komisi, ['soNumber', 'party', 'status']);
  const cbF = useFilter(cashback, ['soNumber', 'party', 'status']);

  const sum = (arr, k) => arr.reduce((a, b) => a + Number(b[k] || 0), 0);
  // Dokumen dibatalkan (cancelled) tetap tampil bila sudah ada uang bergerak, tapi TIDAK dihitung di ringkasan.
  const openRows = (arr, done) => arr.filter(r => !r.cancelled && r.status !== done);
  const piutangSO = sum(openRows(invoiceSO, 'Lunas'), 'outstanding');
  const utangPO = sum(openRows(invoicePO, 'Lunas'), 'outstanding');
  const komisiBelum = sum(openRows(komisi, 'Lunas'), 'amount');
  const cashbackBelum = sum(openRows(cashback, 'Dikembalikan'), 'amount');

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
        <SummaryCard icon={ArrowDownCircle} tone="blue" label="Piutang SO (Belum Lunas)" value={rp(piutangSO)} sub={`${openRows(invoiceSO, 'Lunas').length} invoice belum lunas`} />
        <SummaryCard icon={ArrowUpCircle} tone="red" label="Utang PO (Belum Lunas)" value={rp(utangPO)} sub={`${openRows(invoicePO, 'Lunas').length} invoice belum lunas`} />
        <SummaryCard icon={HandCoins} tone="amber" label="Komisi Belum Dibayar" value={rp(komisiBelum)} sub={`${openRows(komisi, 'Lunas').length} dari ${komisi.filter(r => !r.cancelled).length} komisi`} />
        <SummaryCard icon={Gift} tone="green" label="Cashback Belum Dikembalikan" value={rp(cashbackBelum)} sub={`${openRows(cashback, 'Dikembalikan').length} dari ${cashback.filter(r => !r.cancelled).length} cashback`} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Memuat data keuangan...
        </div>
      ) : data?.error ? (
        <div className="py-24 text-center text-muted-foreground">Anda tidak memiliki akses ke halaman ini.</div>
      ) : (
      <Tabs value={tab} onValueChange={setTab}>
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
                      <SortHead f={soF} k="orderDate">Tgl Order</SortHead><SortHead f={soF} k="number">No. Invoice</SortHead><SortHead f={soF} k="soNumber">No. SO</SortHead><SortHead f={soF} k="party">Customer</SortHead>
                      <SortHead f={soF} k="total" className="text-right">Total</SortHead><SortHead f={soF} k="paid" className="text-right">Dibayar</SortHead>
                      <SortHead f={soF} k="outstanding" className="text-right">Sisa</SortHead><SortHead f={soF} k="status" className="text-center">Status</SortHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {soF.filtered.length === 0 && (<TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {soF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">{tgl(r.orderDate)}</TableCell>
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
                        <TableCell className="text-center"><StatusBadge status={r.status} note={r.cancelled ? `SO batal — sudah dibayar ${rp(r.paid)}, perlu refund/klarifikasi` : null} /></TableCell>
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
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <SearchBar q={poF.q} setQ={poF.setQ} placeholder="Cari no. invoice / PO / supplier..." />
                <div className="flex flex-wrap items-center gap-2">
                  <Select value="" onValueChange={(v) => router.push(`/dashboard/finance/recaps/${v}`)}>
                    <SelectTrigger className="w-[260px]"><FolderOpen className="w-4 h-4 mr-1 text-muted-foreground" /><SelectValue placeholder={`Rekap Tersimpan (${recaps.length})`} /></SelectTrigger>
                    <SelectContent>
                      {recaps.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">Belum ada rekap</div>}
                      {recaps.map(r => (
                        <SelectItem key={r.id} value={r.id}>
                          <span className="font-mono text-xs mr-1">{r.recapNumber}</span> {r.title}{r.subtitle ? ` · ${r.subtitle}` : ''} — {rp(r.totalAmount)} ({RECAP_STATUS_LABEL[r.status] || r.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isRecapAdmin && <Button variant="outline" onClick={() => setTplOpen(true)}><Settings2 className="w-4 h-4 mr-1" />Template Rekap</Button>}
                  {isRecapAdmin && <Button onClick={() => setGenOpen(true)} disabled={!selectedPO.length}><FileStack className="w-4 h-4 mr-1" />Generate Rekap{selectedPO.length ? ` (${selectedPO.length})` : ''}</Button>}
                </div>
              </div>
              {isRecapAdmin && <p className="text-[11px] text-muted-foreground">Centang invoice yang akan dijadikan satu rekap. Invoice yang sudah masuk rekap tidak bisa dipilih lagi.</p>}
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {isRecapAdmin && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={selectablePO.length > 0 && selectablePO.every(r => selectedPO.includes(r.id))}
                            onCheckedChange={(v) => setSelectedPO(v ? [...new Set([...selectedPO, ...selectablePO.map(r => r.id)])] : selectedPO.filter(id => !selectablePO.some(r => r.id === id)))}
                            aria-label="Pilih semua"
                          />
                        </TableHead>
                      )}
                      <SortHead f={poF} k="orderDate">Tgl Order</SortHead><SortHead f={poF} k="number">No. Invoice</SortHead><SortHead f={poF} k="poNumber">No. PO</SortHead><SortHead f={poF} k="party">Supplier</SortHead>
                      <SortHead f={poF} k="total" className="text-right">Total</SortHead><SortHead f={poF} k="paid" className="text-right">Dibayar</SortHead>
                      <SortHead f={poF} k="outstanding" className="text-right">Sisa</SortHead><SortHead f={poF} k="status" className="text-center">Status</SortHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poF.filtered.length === 0 && (<TableRow><TableCell colSpan={isRecapAdmin ? 9 : 8} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {poF.filtered.map(r => (
                      <TableRow key={r.id} className={selectedPO.includes(r.id) ? 'bg-emerald-50/60' : ''}>
                        {isRecapAdmin && (
                          <TableCell>
                            <Checkbox
                              checked={selectedPO.includes(r.id)}
                              disabled={!canRecapPO(r)}
                              title={r.recap ? `Sudah masuk rekap ${r.recap.recapNumber}` : !canRecapPO(r) ? `PO ${r.pipelineStatus}` : ''}
                              onCheckedChange={(v) => setSelectedPO(v ? [...selectedPO, r.id] : selectedPO.filter(id => id !== r.id))}
                              aria-label={`Pilih ${r.number}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap text-sm">{tgl(r.orderDate)}</TableCell>
                        <TableCell className="font-medium">
                          <DocLink href={`/dashboard/purchase-orders/${r.id}`}>{r.number}</DocLink>
                          {r.recap && (
                            <Link href={`/dashboard/finance/recaps/${r.recap.recapId}`} className="ml-2">
                              <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100">{r.recap.recapNumber}</Badge>
                            </Link>
                          )}
                        </TableCell>
                        <TableCell><DocLink href={`/dashboard/purchase-orders/${r.id}`}>{r.poNumber}</DocLink></TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right">{rp(r.total)}</TableCell>
                        <TableCell className="text-right text-emerald-700">{rp(r.paid)}</TableCell>
                        <TableCell className="text-right text-red-600 font-semibold">{rp(r.outstanding)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} note={r.cancelled ? `PO batal — sudah dibayar ${rp(r.paid)}, perlu klarifikasi ke supplier` : null} /></TableCell>
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
                      <SortHead f={komF} k="orderDate">Tgl Order</SortHead><SortHead f={komF} k="soNumber">No. SO</SortHead><SortHead f={komF} k="party">Penerima (Dropshipper)</SortHead>
                      <SortHead f={komF} k="amount" className="text-right">Nilai Komisi</SortHead><SortHead f={komF} k="status" className="text-center">Status</SortHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {komF.filtered.length === 0 && (<TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {komF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">{tgl(r.orderDate)}</TableCell>
                        <TableCell className="font-medium"><DocLink href={r.salesOrderId ? `/dashboard/sales-orders/${r.salesOrderId}` : null}>{r.soNumber}</DocLink></TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right font-semibold">{rp(r.amount)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} note={r.cancelled ? 'SO batal — komisi sudah terlanjur dibayar' : null} /></TableCell>
                        <TableCell className="text-right">
                          {r.status !== 'Lunas' && !r.cancelled ? <PayCommissionDialog rec={r} accounts={accounts} onDone={mutate} /> : <span className="text-xs text-muted-foreground">—</span>}
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
                      <SortHead f={cbF} k="orderDate">Tgl Order</SortHead><SortHead f={cbF} k="soNumber">No. SO</SortHead><SortHead f={cbF} k="party">Penerima</SortHead>
                      <SortHead f={cbF} k="amount" className="text-right">Nilai Cashback</SortHead><SortHead f={cbF} k="status" className="text-center">Status</SortHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cbF.filtered.length === 0 && (<TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Tidak ada data</TableCell></TableRow>)}
                    {cbF.filtered.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">{tgl(r.orderDate)}</TableCell>
                        <TableCell className="font-medium"><DocLink href={`/dashboard/sales-orders/${r.id}`}>{r.soNumber}</DocLink></TableCell>
                        <TableCell>{r.party}</TableCell>
                        <TableCell className="text-right font-semibold">{rp(r.amount)}</TableCell>
                        <TableCell className="text-center"><StatusBadge status={r.status} note={r.cancelled ? 'SO batal — cashback sudah terlanjur dikembalikan' : null} /></TableCell>
                        <TableCell className="text-right">
                          {r.status !== 'Dikembalikan' && !r.cancelled ? <RefundCashbackDialog row={r} accounts={accounts} onDone={mutate} /> : <span className="text-xs text-muted-foreground">—</span>}
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
      {isRecapAdmin && (
        <>
          <GenerateRecapDialog
            open={genOpen}
            onOpenChange={setGenOpen}
            docIds={selectedPO}
            selectedRows={selectedPORows}
            onCreated={(r) => { setGenOpen(false); setSelectedPO([]); mutate(); mutateRecaps(); router.push(`/dashboard/finance/recaps/${r.id}`); }}
          />
          <RecapTemplateDialog open={tplOpen} onOpenChange={setTplOpen} />
        </>
      )}
    </div>
  );
}
