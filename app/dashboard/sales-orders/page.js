'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Eye, Loader2, Trash2, TrendingUp, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

const SO_STATUSES = ['Draft', 'Confirmed', 'Packed', 'Shipped', 'Invoiced', 'Cancelled'];
export const SO_STATUS_COLOR = {
  'Draft': 'bg-slate-100 text-slate-700',
  'Confirmed': 'bg-blue-100 text-blue-700',
  'Packed': 'bg-indigo-100 text-indigo-700',
  'Shipped': 'bg-amber-100 text-amber-700',
  'Invoiced': 'bg-emerald-100 text-emerald-700',
  'Cancelled': 'bg-red-100 text-red-700',
};
const PAY_COLOR = { unpaid: 'bg-slate-100 text-slate-700', partial: 'bg-amber-100 text-amber-700', paid: 'bg-emerald-100 text-emerald-700' };
const PAYMENT_TERMS = ['Cash', 'TOP 7', 'TOP 14', 'TOP 30', 'TOP 45', 'TOP 60'];

const emptyItem = () => ({ productId: '', quantity: 0, weight: 0, unitPrice: 0, discount: 0 });
const emptyForm = {
  customerId: '',
  orderDate: new Date().toISOString().slice(0,10),
  expectedDate: '',
  dpAmount: 0, paymentTerm: 'TOP 14',
  items: [emptyItem()],
  notes: '',
};

export default function SOListPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canCreate = ['admin', 'supervisor'].includes(role);

  const [statusTab, setStatusTab] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const params = new URLSearchParams();
  if (statusTab !== 'all') params.set('status', statusTab);
  if (q) params.set('q', q);
  const { data, mutate, isLoading } = useSWR(`/api/sales-orders?${params}`, fetcher);
  const rows = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-8 h-8 text-emerald-600" /> Sales Orders
          </h1>
          <p className="text-muted-foreground mt-1">Penjualan B2B: regular customer & subscriber (prepaid)</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/sales-reports"><Button variant="outline"><BarChart3 className="w-4 h-4 mr-2" />Laporan</Button></Link>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />SO Baru</Button></DialogTrigger>
              <CreateSODialog onSaved={() => { setOpen(false); mutate(); }} />
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <Tabs value={statusTab} onValueChange={setStatusTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="all">Semua</TabsTrigger>
              {SO_STATUSES.map(st => <TabsTrigger key={st} value={st}>{st}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Cari SO / Invoice number..." value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>No SO</TableHead><TableHead>Customer</TableHead>
              <TableHead>Tgl Order</TableHead><TableHead>Invoice</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Bayar</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Belum ada SO</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50">
                  <TableCell className="font-mono font-semibold text-xs">{r.soNumber}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.customer?.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.customer?.code} {r.customer?.isSubscriber && <Badge variant="outline" className="ml-1 text-[10px]">Subscriber</Badge>}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.orderDate && format(new Date(r.orderDate), 'dd MMM yyyy')}</TableCell>
                  <TableCell className="text-xs font-mono">{r.invoiceNumber || '-'}</TableCell>
                  <TableCell className="text-right font-medium">Rp {Number(r.totalAmount).toLocaleString('id-ID')}</TableCell>
                  <TableCell><Badge variant="secondary" className={PAY_COLOR[r.paymentStatus]}>{r.paymentStatus}</Badge></TableCell>
                  <TableCell><Badge className={SO_STATUS_COLOR[r.pipelineStatus]}>{r.pipelineStatus}</Badge></TableCell>
                  <TableCell><Link href={`/dashboard/sales-orders/${r.id}`}><Button size="icon" variant="ghost"><Eye className="w-4 h-4" /></Button></Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateSODialog({ onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { data: custData } = useSWR('/api/contacts?type=Customer', fetcher);
  const { data: prods } = useSWR('/api/products', fetcher);
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updItem = (i, k, v) => setForm(f => { const items = [...f.items]; items[i] = { ...items[i], [k]: v }; return { ...f, items }; });
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const selectedCust = (custData?.data || []).find(c => c.id === form.customerId);
  const subtotal = form.items.reduce((a, it) => a + (Number(it.unitPrice) * Number(it.weight || it.quantity)), 0);
  const discountTotal = form.items.reduce((a, it) => a + Number(it.discount || 0), 0);
  const total = subtotal - discountTotal;

  const save = async () => {
    if (!form.customerId) return toast.error('Pilih customer');
    if (form.items.length === 0 || form.items.some(it => !it.productId)) return toast.error('Isi minimal 1 item dengan produk');
    setSaving(true);
    try {
      const res = await fetch('/api/sales-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('SO dibuat: ' + j.data.soNumber);
      onSaved();
      router.push(`/dashboard/sales-orders/${j.data.id}`);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Buat Sales Order</DialogTitle>
        <DialogDescription>Status awal <b>Draft</b>. Auto-deduction stok akan berjalan saat status → Confirmed.</DialogDescription>
      </DialogHeader>
      <div className="grid sm:grid-cols-2 gap-4">
        <F label="Customer *" className="sm:col-span-2">
          <Select value={form.customerId} onValueChange={v => upd('customerId', v)}>
            <SelectTrigger><SelectValue placeholder="Pilih customer" /></SelectTrigger>
            <SelectContent>{(custData?.data || []).map(c => (
              <SelectItem key={c.id} value={c.id}>
                {c.code} - {c.displayName} {c.isSubscriber ? '(Subscriber)' : ''}
              </SelectItem>
            ))}</SelectContent>
          </Select>
          {selectedCust?.isSubscriber && (
            <div className="text-xs mt-1 text-emerald-700">
              Prepaid balance: Rp {Number(selectedCust.prepaidBalance || 0).toLocaleString('id-ID')}
            </div>
          )}
        </F>
        <F label="Tanggal Order *"><Input type="date" value={form.orderDate} onChange={e => upd('orderDate', e.target.value)} /></F>
        <F label="Perkiraan Kirim"><Input type="date" value={form.expectedDate} onChange={e => upd('expectedDate', e.target.value)} /></F>
        <F label="Term Pembayaran (TOP)">
          <Select value={form.paymentTerm} onValueChange={v => upd('paymentTerm', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Down Payment (Rp)"><Input type="number" value={form.dpAmount} onChange={e => upd('dpAmount', Number(e.target.value))} /></F>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Items *</Label>
          <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-4 h-4 mr-1" />Tambah Item</Button>
        </div>
        <div className="border rounded-lg divide-y">
          {form.items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 p-3 items-center">
              <div className="col-span-3">
                <Select value={it.productId} onValueChange={v => {
                  const p = (prods?.data || []).find(x => x.id === v);
                  updItem(i, 'productId', v);
                  if (p && !it.unitPrice) updItem(i, 'unitPrice', Number(p.basePrice || 0));
                }}>
                  <SelectTrigger><SelectValue placeholder="Produk" /></SelectTrigger>
                  <SelectContent>{(prods?.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Input className="col-span-2" type="number" placeholder="Qty" value={it.quantity} onChange={e => updItem(i, 'quantity', Number(e.target.value))} />
              <Input className="col-span-2" type="number" placeholder="Berat (kg)" value={it.weight} onChange={e => updItem(i, 'weight', Number(e.target.value))} />
              <Input className="col-span-2" type="number" placeholder="Harga/unit" value={it.unitPrice} onChange={e => updItem(i, 'unitPrice', Number(e.target.value))} />
              <Input className="col-span-2" type="number" placeholder="Diskon" value={it.discount} onChange={e => updItem(i, 'discount', Number(e.target.value))} />
              <Button size="icon" variant="ghost" className="col-span-1" onClick={() => removeItem(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-6 text-sm p-2 bg-slate-50 rounded-lg">
          <div>Subtotal: <b>Rp {subtotal.toLocaleString('id-ID')}</b></div>
          <div>Diskon: <b className="text-red-600">-Rp {discountTotal.toLocaleString('id-ID')}</b></div>
          <div>Total: <b className="text-emerald-700 text-lg">Rp {total.toLocaleString('id-ID')}</b></div>
        </div>
      </div>

      <F label="Catatan"><Textarea rows={2} value={form.notes} onChange={e => upd('notes', e.target.value)} /></F>
      <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan SO</Button></DialogFooter>
    </DialogContent>
  );
}

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
