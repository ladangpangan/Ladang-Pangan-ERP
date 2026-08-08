'use client';

import { useState } from 'react';
import useSWR from 'swr';
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
import { Plus, Search, Pencil, Trash2, Package, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url) => fetch(url).then(r => r.json());

const CATEGORIES = ['Live Bird', 'Karkas', 'Boneless', 'Parting', 'Retail', 'Others'];
const UNITS = ['kg', 'ekor', 'pack', 'pcs', 'box'];
const WEIGHT_UNITS = [
  { value: 'kg', label: 'Kg (Kilogram)' },
  { value: 'gram', label: 'Gram' },
  { value: 'ton', label: 'Tonase (Ton)' },
];
const PACKAGING_TYPES = [
  { value: 'colly', label: 'Colly (Karung)' },
  { value: 'pack', label: 'Pack' },
  { value: 'keranjang', label: 'Keranjang' },
  { value: 'kardus', label: 'Kardus' },
];
const WEIGHT_UNIT_LABEL = { kg: 'Kg', gram: 'Gram', ton: 'Ton' };
const PACKAGING_LABEL = { colly: 'Colly (Karung)', pack: 'Pack', keranjang: 'Keranjang', kardus: 'Kardus' };
const CAT_COLOR = {
  'Live Bird': 'bg-amber-100 text-amber-700',
  'Karkas': 'bg-red-100 text-red-700',
  'Boneless': 'bg-purple-100 text-purple-700',
  'Parting': 'bg-blue-100 text-blue-700',
  'Retail': 'bg-emerald-100 text-emerald-700',
  'Others': 'bg-slate-100 text-slate-700',
};

const emptyForm = { sku: '', name: '', category: 'Karkas', unit: 'kg', weightUnit: 'kg', packagingType: 'colly', basePrice: 0, minStock: 0, shelfLifeDays: 0, description: '', status: 'active' };

export default function ProductsPage() {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const params = new URLSearchParams();
  if (cat !== 'all') params.set('category', cat);
  if (q) params.set('q', q);
  const { data, mutate, isLoading } = useSWR(`/api/products?${params}`, fetcher);
  const rows = data?.data || [];

  const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...emptyForm, ...row }); setOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      const method = editing ? 'PATCH' : 'POST';
      const url = editing ? `/api/products/${editing.id}` : '/api/products';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(editing ? 'Produk diperbarui' : 'Produk dibuat');
      setOpen(false); mutate();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Hapus produk ini?')) return;
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Package className="w-8 h-8 text-amber-600" /> Products</h1>
          <p className="text-muted-foreground mt-1">Master produk: Live Bird, Karkas, Boneless, Parting, Retail</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Tambah Produk</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Produk' : 'Tambah Produk'}</DialogTitle>
              <DialogDescription>Data master produk untuk transaksi PO, WO, SO, dan inventory.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <F label="SKU *"><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="KRK-001" /></F>
              <F label="Nama *"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></F>
              <F label="Kategori">
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Satuan Berat">
                <Select value={form.weightUnit || 'kg'} onValueChange={v => setForm({ ...form, weightUnit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{WEIGHT_UNITS.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Jenis Kemasan">
                <Select value={form.packagingType || 'colly'} onValueChange={v => setForm({ ...form, packagingType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PACKAGING_TYPES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Harga Dasar (Rp)"><Input type="number" value={form.basePrice} onChange={e => setForm({ ...form, basePrice: Number(e.target.value) })} /></F>
              <F label="Min Stock"><Input type="number" value={form.minStock} onChange={e => setForm({ ...form, minStock: Number(e.target.value) })} /></F>
              <F label="Shelf Life (hari)"><Input type="number" value={form.shelfLifeDays} onChange={e => setForm({ ...form, shelfLifeDays: Number(e.target.value) })} /></F>
              <F label="Status">
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </F>
              <F label="Deskripsi" className="sm:col-span-2"><Textarea rows={2} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></F>
              <div className="sm:col-span-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
                <span className="font-medium text-foreground">Catatan:</span> <span className="font-medium">Satuan Berat</span> dipakai untuk timbangan (default Kg). <span className="font-medium">Jenis Kemasan</span> adalah wadah produk (Colly/Karung, Pack, Keranjang, Kardus). Pada transaksi, <span className="font-medium">Qty</span> = jumlah hitungan kemasan (mis. 10 Colly).
              </div>
            </div>
            <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Tabs value={cat} onValueChange={setCat}>
              <TabsList>
                <TabsTrigger value="all">Semua</TabsTrigger>
                {CATEGORIES.map(c => <TabsTrigger key={c} value={c}>{c}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Cari SKU / nama..." value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>SKU</TableHead><TableHead>Nama</TableHead><TableHead>Kategori</TableHead>
              <TableHead>Satuan Berat</TableHead><TableHead>Kemasan</TableHead><TableHead className="text-right">Harga</TableHead>
              <TableHead className="text-right">Min Stock</TableHead><TableHead>Shelf Life</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={10} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Belum ada produk</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="secondary" className={CAT_COLOR[r.category] || ''}>{r.category}</Badge></TableCell>
                  <TableCell>{WEIGHT_UNIT_LABEL[r.weightUnit] || r.weightUnit || r.unit || 'Kg'}</TableCell>
                  <TableCell>{r.packagingType ? <Badge variant="outline">{PACKAGING_LABEL[r.packagingType] || r.packagingType}</Badge> : <span className="text-muted-foreground">-</span>}</TableCell>
                  <TableCell className="text-right">Rp {Number(r.basePrice).toLocaleString('id-ID')}</TableCell>
                  <TableCell className="text-right">{r.minStock} {WEIGHT_UNIT_LABEL[r.weightUnit] || r.unit}</TableCell>
                  <TableCell>{r.shelfLifeDays ? `${r.shelfLifeDays} hari` : '-'}</TableCell>
                  <TableCell><Badge variant={r.status === 'active' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
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

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
