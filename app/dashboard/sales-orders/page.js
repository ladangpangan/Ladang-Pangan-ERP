'use client';

import { useState, useMemo } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Search, Eye, Loader2, Trash2, TrendingUp, BarChart3, Package, AlertTriangle, Boxes } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

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

const emptyItem = () => ({ stockId: '', productId: '', productName: '', kodeSimpan: '', csLabel: '', availableWeight: 0, quantity: 0, weight: 0, unitPrice: 0, discount: 0, expiredDate: null });
const emptyForm = {
  customerId: '',
  fulfillmentType: 'stock', supplierId: '',
  dropshipperId: '', commissionType: '', commissionValue: 0,
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
  const [stockPickerFor, setStockPickerFor] = useState(null); // index of item currently picking
  const router = useRouter();
  const { data: custData } = useSWR('/api/contacts', fetcher);
  const allContacts = custData?.data || [];
  const isAgentRole = (c) => !!(c?.isAgent || c?.contactType === 'Agen');
  const isDsRole = (c) => !!(c?.isDropshipper || c?.contactType === 'Dropshipper');
  const buyers = allContacts.filter(c => c.contactType === 'Customer' || isAgentRole(c));
  const dropshippers = allContacts.filter(c => isDsRole(c) && c.id !== form.customerId);
  const { data: stockData, isLoading: stockLoading } = useSWR('/api/inventory/stocks?status=active&sort=FEFO', fetcher);
  const { data: prods } = useSWR('/api/products', fetcher);
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updItem = (i, patch) => setForm(f => { const items = [...f.items]; items[i] = { ...items[i], ...patch }; return { ...f, items }; });
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (i) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const stocks = stockData?.data || [];
  const products = prods?.data || [];
  // Filter out already-picked stocks
  const usedStockIds = new Set(form.items.map(it => it.stockId).filter(Boolean));

  const pickStock = (idx, stk) => {
    const product = products.find(p => p.id === stk.productId) || stk.product || {};
    const csZone = [stk.coldStorage?.code, stk.zone?.code].filter(Boolean).join(' / ');
    const avail = Number(stk.availableWeight !== undefined ? stk.availableWeight : stk.weight || 0);
    updItem(idx, {
      stockId: stk.id,
      productId: stk.productId,
      productName: product.name || '',
      kodeSimpan: stk.kodeSimpan,
      csLabel: csZone,
      availableWeight: avail,
      weight: avail, // default: sell all available (not reserved)
      quantity: Number(stk.availableQty !== undefined ? stk.availableQty : stk.quantity || 0),
      unitPrice: Number(product.basePrice || 0),
      expiredDate: stk.expiredDate,
    });
    setStockPickerFor(null);
  };

  const clearStock = (idx) => {
    updItem(idx, emptyItem());
  };

  const selectedCust = allContacts.find(c => c.id === form.customerId);
  const selectedDs = allContacts.find(c => c.id === form.dropshipperId);
  const agentPct = isAgentRole(selectedCust) ? Number(selectedCust.agentDiscountPct || 0) : 0;
  const itemDiscount = (it) => agentPct > 0
    ? Math.round(Number(it.unitPrice || 0) * Number(it.weight || 0) * agentPct / 100)
    : Number(it.discount || 0);
  const subtotal = form.items.reduce((a, it) => a + (Number(it.unitPrice) * Number(it.weight || it.quantity)), 0);
  const discountTotal = form.items.reduce((a, it) => a + itemDiscount(it), 0);
  const total = subtotal - discountTotal;
  const totalWeight = form.items.reduce((a, it) => a + Number(it.weight || 0), 0);
  // Preview komisi (per_kg & fixed dihitung di klien; percent_profit dihitung server saat simpan)
  const commissionPreview = (() => {
    if (!form.dropshipperId) return null;
    const type = form.commissionType || selectedDs?.commissionType || 'per_kg';
    const value = Number(form.commissionValue || selectedDs?.commissionValue || 0);
    if (type === 'per_kg') return { type, amount: Math.round(value * totalWeight) };
    if (type === 'fixed') return { type, amount: Math.round(value) };
    return { type, amount: null }; // percent_profit
  })();

  const isDropship = form.fulfillmentType === 'dropship';
  const suppliers = allContacts.filter(c => c.contactType === 'Supplier');
  const save = async () => {
    if (!form.customerId) return toast.error('Pilih customer');
    if (isDropship) {
      if (!form.supplierId) return toast.error('Pilih supplier asal (dropship)');
      if (form.items.length === 0 || form.items.some(it => !it.productId)) return toast.error('Isi minimal 1 item dengan produk');
      if (form.items.some(it => Number(it.weight) <= 0)) return toast.error('Berat harus > 0');
    } else {
      if (form.items.length === 0 || form.items.some(it => !it.stockId)) return toast.error('Isi minimal 1 item dengan kode simpan');
      for (const it of form.items) {
        if (Number(it.weight) > Number(it.availableWeight) + 0.0001) {
          return toast.error(`Berat ${it.weight} kg melebihi stok tersedia ${it.availableWeight} kg pada ${it.kodeSimpan}`);
        }
        if (Number(it.weight) <= 0) return toast.error(`Berat harus > 0 pada ${it.kodeSimpan}`);
      }
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        commissionValue: Number(form.commissionValue || 0),
        items: form.items.map(it => ({
          stockId: isDropship ? undefined : it.stockId,
          productId: it.productId,
          quantity: Number(it.quantity || 0),
          weight: Number(it.weight || 0),
          unitPrice: Number(it.unitPrice || 0),
          discount: itemDiscount(it),
        })),
      };
      const res = await fetch('/api/sales-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('SO dibuat: ' + j.data.soNumber);
      setForm(emptyForm);
      onSaved();
      router.push(`/dashboard/sales-orders/${j.data.id}`);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Buat Sales Order</DialogTitle>
        <DialogDescription>Pilih <b>Kode Simpan</b> dari inventory. Stok otomatis dipotong saat status → <b>Confirmed</b>.</DialogDescription>
      </DialogHeader>
      <div className="grid sm:grid-cols-2 gap-4">
        <F label="Pembeli (Customer / Agen) *" className="sm:col-span-2">
          <Select value={form.customerId} onValueChange={v => setForm(f => ({ ...f, customerId: v, dropshipperId: f.dropshipperId === v ? '' : f.dropshipperId }))}>
            <SelectTrigger><SelectValue placeholder="Pilih customer / agen" /></SelectTrigger>
            <SelectContent>{buyers.map(c => (
              <SelectItem key={c.id} value={c.id}>
                {c.code} - {c.displayName} {isAgentRole(c) ? '(Agen)' : c.isSubscriber ? '(Subscriber)' : ''}
              </SelectItem>
            ))}</SelectContent>
          </Select>
          {selectedCust?.isSubscriber && (
            <div className="text-xs mt-1 text-emerald-700">
              Prepaid balance: Rp {Number(selectedCust.prepaidBalance || 0).toLocaleString('id-ID')}
            </div>
          )}
          {agentPct > 0 && (
            <div className="text-xs mt-1 text-teal-700">
              Agen: diskon khusus {agentPct}% otomatis diterapkan pada setiap item.
            </div>
          )}
        </F>
        <F label="Dropshipper (opsional)" className="sm:col-span-2">
          <Select value={form.dropshipperId || 'none'} onValueChange={v => {
            if (v === 'none') { upd('dropshipperId', ''); return; }
            const ds = dropshippers.find(x => x.id === v);
            setForm(f => ({ ...f, dropshipperId: v, commissionType: ds?.commissionType || 'per_kg', commissionValue: ds?.commissionValue || 0 }));
          }}>
            <SelectTrigger><SelectValue placeholder="Tanpa dropshipper" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Tanpa Dropshipper —</SelectItem>
              {dropshippers.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
          {form.dropshipperId && (
            <div className="mt-2 grid grid-cols-2 gap-2 p-2 rounded-lg bg-pink-50 border border-pink-100">
              <div>
                <Label className="text-xs">Tipe Komisi</Label>
                <Select value={form.commissionType || 'per_kg'} onValueChange={v => upd('commissionType', v)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_kg">Per Kg</SelectItem>
                    <SelectItem value="fixed">Nominal Tetap</SelectItem>
                    <SelectItem value="percent_profit">% Profit Bersih</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{form.commissionType === 'percent_profit' ? 'Nilai (%)' : 'Nilai (Rp)'}</Label>
                <Input className="h-8" type="number" value={form.commissionValue} onChange={e => upd('commissionValue', Number(e.target.value))} />
              </div>
              <div className="col-span-2 text-xs text-pink-700">
                {commissionPreview?.amount !== null && commissionPreview?.amount !== undefined
                  ? <>Estimasi komisi: <b>Rp {Number(commissionPreview.amount).toLocaleString('id-ID')}</b></>
                  : 'Komisi % profit dihitung otomatis saat SO dibuat (berdasarkan HPP stok).'}
              </div>
            </div>
          )}
        </F>
        <F label="Mode Pemenuhan" className="sm:col-span-2">
          <Select value={form.fulfillmentType} onValueChange={v => upd('fulfillmentType', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="stock">Reguler (dari stok inventory)</SelectItem>
              <SelectItem value="dropship">Dropship (langsung dari supplier, tanpa stok)</SelectItem>
            </SelectContent>
          </Select>
          {isDropship && (
            <div className="mt-2">
              <Label className="text-xs">Supplier Asal *</Label>
              <Select value={form.supplierId} onValueChange={v => upd('supplierId', v)}>
                <SelectTrigger><SelectValue placeholder="Pilih supplier" /></SelectTrigger>
                <SelectContent>{suppliers.map(sp => <SelectItem key={sp.id} value={sp.id}>{sp.code} - {sp.displayName}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-blue-700 mt-1">PO Draft (Produk Jadi) otomatis dibuat ke supplier ini. Tidak memotong stok. Berat riil dicatat saat Surat Jalan.</p>
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
          <Label className="flex items-center gap-2">
            <Boxes className="w-4 h-4" /> Items (dari Inventory) *
          </Label>
          <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-4 h-4 mr-1" />Tambah Item</Button>
        </div>

        {!isDropship && stocks.length === 0 && !stockLoading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Belum ada stok aktif di inventory. Silakan input Inbound dari Tally / GRN Purchase Order terlebih dahulu.
          </div>
        )}

        <div className="border rounded-lg divide-y">
          {form.items.map((it, i) => {
            const overweight = Number(it.weight) > Number(it.availableWeight) + 0.0001;
            return (
              <div key={i} className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  {/* Stock Picker Button */}
                  <div className="flex-1 min-w-0">
                    <Label className="text-xs text-muted-foreground">Kode Simpan / Produk</Label>
                    {isDropship ? (
                      <Select value={it.productId || ''} onValueChange={v => { const p = products.find(x => x.id === v) || {}; updItem(i, { productId: v, productName: p.name || '', unitPrice: Number(p.basePrice || 0), availableWeight: 999999 }); }}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                        <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : it.stockId ? (
                      <div className="mt-1 border rounded-md p-2 bg-emerald-50 flex items-start gap-2">
                        <Package className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{it.productName}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="font-mono text-[10px]">{it.kodeSimpan}</Badge>
                            {it.csLabel && <span>{it.csLabel}</span>}
                            <span>Tersedia: <b className="text-emerald-700">{Number(it.availableWeight).toFixed(1)} kg</b></span>
                            {it.expiredDate && <span>Exp: {format(new Date(it.expiredDate), 'dd MMM yyyy')}</span>}
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => clearStock(i)} className="h-7 text-xs">Ganti</Button>
                      </div>
                    ) : (
                      <StockPicker
                        stocks={stocks.filter(st => !usedStockIds.has(st.id))}
                        products={products}
                        onPick={(stk) => pickStock(i, stk)}
                      />
                    )}
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeItem(i)} title="Hapus item">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>

                {(it.stockId || (isDropship && it.productId)) && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pl-6">
                    <div>
                      <Label className="text-xs">Berat Dijual (kg) *</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={it.weight}
                        max={isDropship ? undefined : it.availableWeight}
                        onChange={e => updItem(i, { weight: Number(e.target.value) })}
                        className={cn('font-semibold', overweight && 'border-red-500 text-red-600')}
                      />
                      {overweight && <p className="text-[10px] text-red-600 mt-0.5">Melebihi stok!</p>}
                    </div>
                    <div>
                      <Label className="text-xs">Qty (pack)</Label>
                      <Input type="number" value={it.quantity} onChange={e => updItem(i, { quantity: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-xs">Harga / kg</Label>
                      <Input type="number" value={it.unitPrice} onChange={e => updItem(i, { unitPrice: Number(e.target.value) })} />
                    </div>
                    <div>
                      <Label className="text-xs">Diskon (Rp)</Label>
                      <Input type="number" value={agentPct > 0 ? itemDiscount(it) : it.discount} readOnly={agentPct > 0} onChange={e => updItem(i, { discount: Number(e.target.value) })} className={cn(agentPct > 0 && 'bg-teal-50')} />
                      {agentPct > 0 && <p className="text-[10px] text-teal-600 mt-0.5">Diskon Agen {agentPct}%</p>}
                    </div>
                    <div className="col-span-2 md:col-span-4 text-right text-sm text-muted-foreground">
                      Subtotal: <b className="text-emerald-700">Rp {(Number(it.unitPrice) * Number(it.weight) - itemDiscount(it)).toLocaleString('id-ID')}</b>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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

function StockPicker({ stocks, products, onPick }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const productMap = useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.id] = p; });
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return stocks.filter(st => {
      if (!q) return true;
      const p = productMap[st.productId];
      return (
        st.kodeSimpan?.toLowerCase().includes(q) ||
        p?.name?.toLowerCase().includes(q) ||
        p?.sku?.toLowerCase().includes(q) ||
        st.coldStorageCode?.toLowerCase().includes(q)
      );
    }).slice(0, 100);
  }, [stocks, query, productMap]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start mt-1 h-10 font-normal text-muted-foreground">
          <Search className="w-4 h-4 mr-2" /> Pilih Kode Simpan dari Inventory...
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[600px] p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder="Cari kode simpan, produk, SKU, atau CS..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9"
            autoFocus
          />
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Tidak ada stok cocok.
            </div>
          )}
          {filtered.map(st => {
            const p = productMap[st.productId] || st.product || {};
            const expired = st.expiredDate && new Date(st.expiredDate) < new Date();
            const nearExp = st.expiredDate && (new Date(st.expiredDate) - new Date()) / (1000*60*60*24) < 7;
            const totalW = Number(st.weight || 0);
            const availW = Number(st.availableWeight !== undefined ? st.availableWeight : totalW);
            const reservedW = Number(st.reservedWeight || 0);
            const fullyReserved = availW <= 0.001;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => !fullyReserved && onPick(st)}
                disabled={fullyReserved}
                className={cn(
                  "w-full text-left p-3 border-b last:border-0 transition-colors",
                  fullyReserved ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'hover:bg-slate-50'
                )}
              >
                <div className="flex items-start gap-3">
                  <Package className={cn("w-5 h-5 mt-0.5 flex-shrink-0", fullyReserved ? 'text-slate-400' : 'text-emerald-600')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="font-mono text-[10px]">{st.kodeSimpan}</Badge>
                      <span className="font-medium text-sm">{p.name || 'Unknown'}</span>
                      {p.sku && <span className="text-[10px] text-muted-foreground font-mono">{p.sku}</span>}
                      {reservedW > 0 && (
                        <Badge variant="outline" className="text-[9px] bg-amber-50 border-amber-200 text-amber-700">
                          🔒 {reservedW.toFixed(1)} kg reserved
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                      <span>📍 {st.coldStorage?.code}{st.zone?.code ? ` / ${st.zone.code}` : ''}</span>
                      <span>📦 {st.packagingType || '-'} × {Number(st.quantity || 0)}</span>
                      {st.expiredDate && (
                        <span className={cn(expired ? 'text-red-600 font-semibold' : nearExp ? 'text-amber-600 font-semibold' : '')}>
                          🕒 Exp {format(new Date(st.expiredDate), 'dd MMM yyyy')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={cn("text-lg font-bold", fullyReserved ? 'text-slate-400' : 'text-emerald-700')}>
                      {availW.toFixed(1)} kg
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      dari {totalW.toFixed(1)} kg
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-2 border-t text-xs text-muted-foreground bg-slate-50">
          {filtered.length} dari {stocks.length} stok aktif · Diurut FEFO (paling cepat expired dulu)
        </div>
      </PopoverContent>
    </Popover>
  );
}

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
