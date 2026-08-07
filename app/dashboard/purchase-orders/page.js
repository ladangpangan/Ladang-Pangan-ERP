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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Eye, ShoppingCart, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

const PO_STATUSES = ['Draft', 'Menunggu Konfirmasi', 'Diproses', 'Dikirim', 'Tanda Terima', 'Selesai', 'Dibatalkan'];
const PO_TYPES = ['Live Bird', 'Packaging', 'Bahan Baku', 'Produk Jadi', 'Operasional'];
export const STATUS_COLOR = {
  'Draft': 'bg-slate-100 text-slate-700',
  'Menunggu Konfirmasi': 'bg-yellow-100 text-yellow-700',
  'Diproses': 'bg-blue-100 text-blue-700',
  'Dikirim': 'bg-indigo-100 text-indigo-700',
  'Tanda Terima': 'bg-amber-100 text-amber-700',
  'Selesai': 'bg-emerald-100 text-emerald-700',
  'Dibatalkan': 'bg-red-100 text-red-700',
};
const PAY_COLOR = {
  unpaid: 'bg-slate-100 text-slate-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
};

const PAYMENT_TERMS = ['Cash', 'TOP 7', 'TOP 14', 'TOP 30', 'TOP 45', 'TOP 60'];

const emptyItem = () => ({ productId: '', quantity: 0, weight: 0, unitPrice: 0 });
const emptyForm = {
  supplierId: '', poType: 'Live Bird', method: 'Timbang Ulang',
  isDropship: false, dropshipCustomerId: '',
  orderDate: new Date().toISOString().slice(0,10),
  expectedDate: '',
  additionalCost: 0, dpAmount: 0, paymentTerm: 'TOP 14',
  items: [emptyItem()],
  notes: '',
};

export default function POListPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canCreate = ['admin', 'supervisor'].includes(role);

  const [statusTab, setStatusTab] = useState('all');
  const [poType, setPoType] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const params = new URLSearchParams();
  if (statusTab !== 'all') params.set('status', statusTab);
  if (poType !== 'all') params.set('type', poType);
  if (q) params.set('q', q);
  const { data, mutate, isLoading } = useSWR(`/api/purchase-orders?${params}`, fetcher);
  const rows = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="w-8 h-8 text-blue-600" /> Purchase Orders
          </h1>
          <p className="text-muted-foreground mt-1">Pembelian: Live Bird, Packaging, Bahan Baku, Produk Jadi, Operasional</p>
        </div>
        {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />PO Baru</Button></DialogTrigger>
            <CreatePODialog onSaved={() => { setOpen(false); mutate(); }} />
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <Tabs value={statusTab} onValueChange={setStatusTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="all">Semua</TabsTrigger>
              {PO_STATUSES.map(st => <TabsTrigger key={st} value={st}>{st}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Cari nomor PO..." value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
            </div>
            <Select value={poType} onValueChange={setPoType}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tipe PO</SelectItem>
                {PO_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>No PO</TableHead><TableHead>Tipe</TableHead><TableHead>Supplier</TableHead>
              <TableHead>Tgl Order</TableHead><TableHead>Metode</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Bayar</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Belum ada PO</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50">
                  <TableCell className="font-mono font-semibold text-xs">{r.poNumber}</TableCell>
                  <TableCell><Badge variant="outline">{r.poType}</Badge></TableCell>
                  <TableCell>
                    <div className="font-medium">{r.supplier?.name || '-'}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.supplier?.code || ''}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.orderDate ? format(new Date(r.orderDate), 'dd MMM yyyy') : '-'}</TableCell>
                  <TableCell className="text-xs">{r.method || '-'}{r.isDropship && <Badge variant="secondary" className="ml-1 text-[10px]">Dropship</Badge>}</TableCell>
                  <TableCell className="text-right font-medium">Rp {Number(r.totalAmount).toLocaleString('id-ID')}</TableCell>
                  <TableCell><Badge variant="secondary" className={PAY_COLOR[r.paymentStatus]}>{r.paymentStatus}</Badge></TableCell>
                  <TableCell><Badge className={STATUS_COLOR[r.pipelineStatus]}>{r.pipelineStatus}</Badge></TableCell>
                  <TableCell><Link href={`/dashboard/purchase-orders/${r.id}`}><Button size="icon" variant="ghost"><Eye className="w-4 h-4" /></Button></Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreatePODialog({ onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { data: sup } = useSWR('/api/contacts?type=Supplier', fetcher);
  const { data: rph } = useSWR('/api/contacts?type=RPH', fetcher);
  const { data: cust } = useSWR('/api/contacts?type=Customer', fetcher);
  const { data: prods } = useSWR('/api/products', fetcher);
  const supplierOptions = Object.values(
    [...(sup?.data || []), ...(rph?.data || [])].reduce((acc, c) => { acc[c.id] = c; return acc; }, {})
  );

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updItem = (i, k, v) => setForm(f => { const items = [...f.items]; items[i] = { ...items[i], [k]: v }; return { ...f, items }; });
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const save = async () => {
    if (!form.supplierId) return toast.error('Pilih supplier');
    if (form.items.length === 0 || form.items.some(it => !it.productId)) return toast.error('Isi minimal 1 item dengan produk');
    setSaving(true);
    try {
      const res = await fetch('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('PO dibuat: ' + j.data.poNumber);
      onSaved();
      router.push(`/dashboard/purchase-orders/${j.data.id}`);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Buat Purchase Order</DialogTitle>
        <DialogDescription>PO baru akan dibuat dengan status <b>Draft</b>. Metode timbang akan terkunci setelah disimpan.</DialogDescription>
      </DialogHeader>
      <div className="grid sm:grid-cols-2 gap-4">
        <F label="Tipe PO *">
          <Select value={form.poType} onValueChange={v => update('poType', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PO_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Supplier *">
          <Select value={form.supplierId} onValueChange={v => update('supplierId', v)}>
            <SelectTrigger><SelectValue placeholder="Pilih supplier" /></SelectTrigger>
            <SelectContent>{supplierOptions.map(c => <SelectItem key={c.id} value={c.id}>[{c.contactType}] {c.code} - {c.displayName}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        {form.poType === 'Live Bird' && (
          <>
            <F label="Metode Timbang * (locked setelah simpan)">
              <Select value={form.method} onValueChange={v => update('method', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Timbang Ulang">Timbang Ulang (potong invoice)</SelectItem>
                  <SelectItem value="Timbang Kandang">Timbang Kandang (susut ke HPP)</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Drop Shipment (supplier → customer)">
              <div className="flex items-center gap-2 h-10">
                <Switch checked={form.isDropship} onCheckedChange={v => update('isDropship', v)} />
                <span className="text-sm text-muted-foreground">{form.isDropship ? 'Ya' : 'Tidak'}</span>
              </div>
            </F>
            {form.isDropship && (
              <F label="Customer Tujuan" className="sm:col-span-2">
                <Select value={form.dropshipCustomerId} onValueChange={v => update('dropshipCustomerId', v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih customer" /></SelectTrigger>
                  <SelectContent>{(cust?.data || []).map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.displayName}</SelectItem>)}</SelectContent>
                </Select>
              </F>
            )}
          </>
        )}
        <F label="Tanggal Order *"><Input type="date" value={form.orderDate} onChange={e => update('orderDate', e.target.value)} /></F>
        <F label="Perkiraan Datang"><Input type="date" value={form.expectedDate} onChange={e => update('expectedDate', e.target.value)} /></F>
        <F label="Term Pembayaran (TOP)">
          <Select value={form.paymentTerm} onValueChange={v => update('paymentTerm', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </F>
        <F label="Down Payment (Rp)"><Input type="number" value={form.dpAmount} onChange={e => update('dpAmount', Number(e.target.value))} /></F>
        <F label="Biaya Tambahan / Ongkir (Rp)" className="sm:col-span-2"><Input type="number" value={form.additionalCost} onChange={e => update('additionalCost', Number(e.target.value))} /></F>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Items *</Label>
          <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-4 h-4 mr-1" />Tambah Item</Button>
        </div>
        <div className="border rounded-lg divide-y">
          {form.items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 p-3 items-center">
              <div className="col-span-4">
                <Select value={it.productId} onValueChange={v => updItem(i, 'productId', v)}>
                  <SelectTrigger><SelectValue placeholder="Produk" /></SelectTrigger>
                  <SelectContent>{(prods?.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Input className="col-span-2" type="number" placeholder="Qty" value={it.quantity} onChange={e => updItem(i, 'quantity', Number(e.target.value))} />
              <Input className="col-span-2" type="number" placeholder="Berat (kg)" value={it.weight} onChange={e => updItem(i, 'weight', Number(e.target.value))} />
              <Input className="col-span-3" type="number" placeholder="Harga/kg" value={it.unitPrice} onChange={e => updItem(i, 'unitPrice', Number(e.target.value))} />
              <Button size="icon" variant="ghost" className="col-span-1" onClick={() => removeItem(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
            </div>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">Estimasi subtotal: <b>Rp {form.items.reduce((a, it) => a + (Number(it.unitPrice) * Number(it.weight)), 0).toLocaleString('id-ID')}</b> + Ongkir Rp {Number(form.additionalCost).toLocaleString('id-ID')}</div>
      </div>

      <F label="Catatan"><Textarea rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} /></F>

      <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan PO</Button></DialogFooter>
    </DialogContent>
  );
}

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
