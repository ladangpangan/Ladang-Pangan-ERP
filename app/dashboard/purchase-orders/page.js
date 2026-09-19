'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { WeightInput } from '@/components/ui/weight-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Eye, ShoppingCart, Loader2, Trash2, Archive, ArchiveRestore, FileSpreadsheet, Printer } from 'lucide-react';
import { useSort, SortHead, ArchiveTabs, toggleArchive } from '@/lib/table-tools';
import { MonthYearFilter, useMonthFilter } from '@/components/month-year-filter';
import { exportToExcel } from '@/lib/xlsx-export';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { pkgLabel, pkgShort } from '@/lib/constants';
import { generatePOPDF } from '@/lib/pdf/invoice';

const fetcher = (url) => fetch(url).then(r => r.json());

// Ambil detail lengkap (item + produk) lalu cetak PDF PO — dipakai dari daftar PO maupun
// langsung setelah PO baru dibuat, supaya bisa cepat dikirim ke vendor sebagai instruksi pembelian.
async function printPO(id, poNumber) {
  try {
    const res = await fetch(`/api/purchase-orders/${id}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Gagal memuat data PO');
    const doc = generatePOPDF(j.data);
    doc.save(`PO-${j.data.poNumber || poNumber}.pdf`);
    toast.success('PDF PO siap dikirim ke vendor');
  } catch (e) { toast.error('Gagal mencetak PO: ' + e.message); }
}

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
  isDropship: false, dropshipCustomerId: '', shippingAddress: '',
  orderDate: new Date().toISOString().slice(0,10),
  expectedDate: '',
  additionalCost: 0, additionalCostBearer: 'company', additionalCostPayMethod: 'utang',
  dpAmount: 0, paymentTerm: 'TOP 14',
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
  const [view, setView] = useState('active');
  const sort = useSort();

  const params = new URLSearchParams();
  if (statusTab !== 'all') params.set('status', statusTab);
  if (poType !== 'all') params.set('type', poType);
  if (q) params.set('q', q);
  if (view === 'archived') params.set('archived', '1');
  const { data, mutate, isLoading } = useSWR(`/api/purchase-orders?${params}`, fetcher);
  const mf = useMonthFilter(data?.data || [], 'orderDate');
  const rows = sort.sortRows(mf.filtered, {
    poNumber: r => r.poNumber, poType: r => r.poType, supplier: r => r.supplier?.name,
    orderDate: r => r.orderDate, totalAmount: r => r.totalAmount,
    paymentStatus: r => r.paymentStatus, pipelineStatus: r => r.pipelineStatus,
  });
  const monthTotal = mf.filtered.reduce((s, r) => s + Number(r.totalAmount || 0), 0);

  const doArchive = async (r) => {
    if (!confirm(view === 'archived' ? 'Pulihkan PO ini dari arsip?' : 'Arsipkan PO ini? Data akan disembunyikan dari daftar aktif.')) return;
    const ok = await toggleArchive('purchase-orders', r.id, view === 'archived');
    if (ok) mutate();
  };

  const exportPO = () => exportToExcel('purchase-order', [{ name: 'Purchase Order', headers: [
    { key: 'poNumber', label: 'No PO' }, { key: 'poType', label: 'Tipe' }, { key: 'supplier', label: 'Supplier' },
    { key: 'orderDate', label: 'Tgl Order' }, { key: 'method', label: 'Metode' }, { key: 'totalAmount', label: 'Total' },
    { key: 'paymentStatus', label: 'Bayar' }, { key: 'pipelineStatus', label: 'Status' },
  ], rows: rows.map((r) => ({ poNumber: r.poNumber, poType: r.poType, supplier: r.supplier?.name || '', orderDate: r.orderDate ? format(new Date(r.orderDate), 'dd/MM/yyyy') : '', method: r.method, totalAmount: r.totalAmount, paymentStatus: r.paymentStatus, pipelineStatus: r.pipelineStatus })) }]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingCart className="w-8 h-8 text-blue-600" /> Purchase Orders
          </h1>
          <p className="text-muted-foreground mt-1">Pembelian: Live Bird, Packaging, Bahan Baku, Produk Jadi, Operasional</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportPO} disabled={!rows.length}><FileSpreadsheet className="w-4 h-4 mr-2" />Excel</Button>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />PO Baru</Button></DialogTrigger>
              <CreatePODialog onSaved={() => { setOpen(false); mutate(); }} />
            </Dialog>
          )}
        </div>
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
            <MonthYearFilter month={mf.month} setMonth={mf.setMonth} year={mf.year} setYear={mf.setYear} years={mf.years} />
            <ArchiveTabs value={view} onChange={setView} className="sm:ml-auto" />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Periode <span className="font-medium text-foreground">{mf.label}</span></span>
            <span><span className="font-semibold">{mf.filtered.length}</span> PO • Total <span className="font-semibold">Rp {monthTotal.toLocaleString('id-ID')}</span></span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <SortHead field="poNumber" sort={sort}>No PO</SortHead>
              <SortHead field="poType" sort={sort}>Tipe</SortHead>
              <SortHead field="supplier" sort={sort}>Supplier</SortHead>
              <SortHead field="orderDate" sort={sort}>Tgl Order</SortHead>
              <TableHead>Metode</TableHead>
              <SortHead field="totalAmount" sort={sort} className="text-right">Total</SortHead>
              <SortHead field="paymentStatus" sort={sort}>Bayar</SortHead>
              <SortHead field="pipelineStatus" sort={sort}>Status</SortHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Tidak ada PO pada periode {mf.label}</TableCell></TableRow>}
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
                  <TableCell className="text-right whitespace-nowrap">
                    <Link href={`/dashboard/purchase-orders/${r.id}`}><Button size="icon" variant="ghost"><Eye className="w-4 h-4" /></Button></Link>
                    <Button size="icon" variant="ghost" title="Cetak PO (untuk vendor)" onClick={() => printPO(r.id, r.poNumber)}><Printer className="w-4 h-4 text-blue-600" /></Button>
                    {canCreate && (view === 'archived'
                      ? <Button size="icon" variant="ghost" title="Pulihkan" onClick={() => doArchive(r)}><ArchiveRestore className="w-4 h-4 text-emerald-600" /></Button>
                      : <Button size="icon" variant="ghost" title="Arsipkan" onClick={() => doArchive(r)}><Archive className="w-4 h-4 text-amber-600" /></Button>)}
                  </TableCell>
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

  const save = async (thenPrint = false) => {
    if (!form.supplierId) return toast.error('Pilih supplier');
    if (form.items.length === 0 || form.items.some(it => !it.productId)) return toast.error('Isi minimal 1 item dengan produk');
    setSaving(true);
    try {
      const res = await fetch('/api/purchase-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('PO dibuat: ' + j.data.poNumber);
      onSaved();
      if (thenPrint) await printPO(j.data.id, j.data.poNumber);
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
              <>
                <F label="Customer Tujuan" className="sm:col-span-2">
                  <Select value={form.dropshipCustomerId} onValueChange={v => {
                    update('dropshipCustomerId', v);
                    const c = (cust?.data || []).find(x => x.id === v);
                    if (c?.address && !form.shippingAddress) update('shippingAddress', c.address);
                  }}>
                    <SelectTrigger><SelectValue placeholder="Pilih customer" /></SelectTrigger>
                    <SelectContent>{(cust?.data || []).map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.displayName}</SelectItem>)}</SelectContent>
                  </Select>
                </F>
                <F label="Alamat Pengiriman (tujuan dropship)" className="sm:col-span-2">
                  <Textarea rows={2} value={form.shippingAddress} onChange={e => update('shippingAddress', e.target.value)} placeholder="Alamat customer tujuan pengiriman supplier" />
                </F>
              </>
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
        <F label="Down Payment (Rp)"><CurrencyInput value={form.dpAmount} onChange={v => update('dpAmount', v)} placeholder="0" /></F>
        <F label="Biaya Tambahan / Ongkir (Rp)"><CurrencyInput value={form.additionalCost} onChange={v => update('additionalCost', v)} placeholder="0" /></F>
        <F label="Ongkir Ditanggung">
          <Select value={form.additionalCostBearer} onValueChange={v => update('additionalCostBearer', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="company">Kita — kurangi laba (Beban Angkut)</SelectItem>
              <SelectItem value="supplier">Pemasok — netral</SelectItem>
            </SelectContent>
          </Select>
        </F>
        <F label="Ongkir Dibayar via" className="sm:col-span-2">
          <Select value={form.additionalCostPayMethod} onValueChange={v => update('additionalCostPayMethod', v)} disabled={form.additionalCostBearer === 'supplier'}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="utang">Utang ke Pemasok (masuk tagihan PO)</SelectItem>
              <SelectItem value="transfer">Bank / Transfer (kurir/pihak ketiga)</SelectItem>
              <SelectItem value="tunai">Kas Tunai (kurir/pihak ketiga)</SelectItem>
            </SelectContent>
          </Select>
        </F>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Items *</Label>
          <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-4 h-4 mr-1" />Tambah Item</Button>
        </div>
        <div className="border rounded-lg divide-y">
          {form.items.map((it, i) => {
            const prod = (prods?.data || []).find(p => p.id === it.productId);
            return (
            <div key={i} className="p-3 space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Produk</Label>
                  <Select value={it.productId} onValueChange={v => updItem(i, 'productId', v)}>
                    <SelectTrigger><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                    <SelectContent>{(prods?.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeItem(i)} title="Hapus item"><Trash2 className="w-4 h-4 text-red-500" /></Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Jenis Kemasan</Label>
                  <Input readOnly value={prod?.packagingType ? pkgLabel(prod.packagingType) : '-'} className="bg-muted/50 cursor-default" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Qty ({pkgShort(prod?.packagingType) || 'unit'})</Label>
                  <Input type="number" placeholder="0" value={it.quantity} onChange={e => updItem(i, 'quantity', Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Berat (kg)</Label>
                  <WeightInput placeholder="0" value={it.weight} onChange={v => updItem(i, 'weight', v)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Harga/kg (Rp)</Label>
                  <CurrencyInput placeholder="0" value={it.unitPrice} onChange={v => updItem(i, 'unitPrice', v)} />
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground pl-0.5">
                Jenis kemasan mengikuti master produk · Qty = jumlah hitungan kemasan · Subtotal baris: <b>Rp {(Number(it.unitPrice) * Number(it.weight)).toLocaleString('id-ID')}</b>
              </div>
            </div>
            );
          })}
        </div>
        <div className="text-sm text-muted-foreground">Estimasi subtotal: <b>Rp {form.items.reduce((a, it) => a + (Number(it.unitPrice) * Number(it.weight)), 0).toLocaleString('id-ID')}</b>{(form.additionalCostBearer !== 'supplier' && form.additionalCostPayMethod === 'utang' && Number(form.additionalCost) > 0) ? <> + Ongkir (utang) Rp {Number(form.additionalCost).toLocaleString('id-ID')}</> : (Number(form.additionalCost) > 0 && form.additionalCostBearer !== 'supplier') ? <> · Ongkir Rp {Number(form.additionalCost).toLocaleString('id-ID')} dibayar terpisah (Beban Angkut)</> : null}</div>
      </div>

      <F label="Catatan"><Textarea rows={2} value={form.notes} onChange={e => update('notes', e.target.value)} /></F>

      <DialogFooter>
        <Button variant="outline" onClick={() => save(false)} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan PO</Button>
        <Button onClick={() => save(true)} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}Simpan & Cetak PO</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
