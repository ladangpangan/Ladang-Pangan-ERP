'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ArrowLeft, Loader2, Save, Truck, Receipt, CreditCard, RotateCcw, Calculator, Scale, ShoppingCart, CheckCircle2, XCircle, Bell, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { STATUS_COLOR } from '../page';
import { generatePOPDF } from '@/lib/pdf/invoice';
import { pkgLabel, pkgShort } from '@/lib/constants';

const fetcher = (url) => fetch(url).then(r => r.json());
const PO_FLOW = {
  'Draft': ['Menunggu Konfirmasi', 'Dibatalkan'],
  'Menunggu Konfirmasi': ['Diproses', 'Dibatalkan'],
  'Diproses': ['Dikirim', 'Dibatalkan'],
  'Dikirim': ['Tanda Terima', 'Dibatalkan'],
  'Tanda Terima': ['Selesai', 'Dibatalkan'],
  'Selesai': [], 'Dibatalkan': [],
};
const STEPS = ['Draft', 'Menunggu Konfirmasi', 'Diproses', 'Dikirim', 'Tanda Terima', 'Selesai'];

export default function PODetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canEdit = ['admin', 'supervisor'].includes(role);
  const canOperate = ['admin', 'supervisor', 'operator'].includes(role);
  const { data, mutate, isLoading } = useSWR(`/api/purchase-orders/${id}`, fetcher);
  const po = data?.data;

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!po) return <div className="text-center py-20 text-muted-foreground">PO tidak ditemukan</div>;

  const currentStepIdx = STEPS.indexOf(po.pipelineStatus);
  const allowedNext = PO_FLOW[po.pipelineStatus] || [];

  const transitionStatus = async (target) => {
    if (!confirm(`Ubah status ke "${target}"?`)) return;
    const res = await fetch(`/api/purchase-orders/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: target }) });
    const j = await res.json();
    if (res.ok) { toast.success('Status: ' + target); mutate(); } else toast.error(j.error);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/purchase-orders"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{po.poNumber}</h1>
            <Badge className={STATUS_COLOR[po.pipelineStatus]}>{po.pipelineStatus}</Badge>
            <Badge variant="outline">{po.poType}</Badge>
            {po.method && <Badge variant="outline">{po.method}</Badge>}
            {po.isDropship && <Badge variant="secondary" className="bg-purple-100 text-purple-700">Dropship</Badge>}
          </div>
          <p className="text-muted-foreground text-sm mt-1">{po.supplier?.displayName} · {po.orderDate && format(new Date(po.orderDate), 'dd MMM yyyy')}</p>
        </div>
        {canEdit && allowedNext.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {allowedNext.map(a => (
              <Button key={a} size="sm" variant={a === 'Dibatalkan' ? 'destructive' : 'default'} onClick={() => transitionStatus(a)}>
                {a === 'Dibatalkan' ? <XCircle className="w-4 h-4 mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}{a}
              </Button>
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              const doc = generatePOPDF(po);
              doc.save(`PO-${po.poNumber}.pdf`);
              toast.success('PDF berhasil diunduh');
            } catch (e) {
              toast.error('Gagal membuat PDF: ' + e.message);
            }
          }}
        >
          <FileDown className="w-4 h-4 mr-1" /> PDF PO
        </Button>
      </div>

      {/* Pipeline visualization */}
      <Card><CardContent className="pt-6">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex-1 min-w-[80px]">
              <div className={`h-2 rounded-full ${idx <= currentStepIdx && po.pipelineStatus !== 'Dibatalkan' ? 'bg-emerald-500' : 'bg-slate-200'}`} />
              <div className={`text-xs mt-2 ${idx === currentStepIdx ? 'font-bold text-emerald-700' : 'text-muted-foreground'}`}>{step}</div>
            </div>
          ))}
        </div>
      </CardContent></Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Total PO" value={`Rp ${Number(po.totalAmount).toLocaleString('id-ID')}`} sub="Termasuk ongkir" />
        <SummaryCard label="Sudah Dibayar" value={`Rp ${Number(po.paidAmount).toLocaleString('id-ID')}`} sub={`Status: ${po.paymentStatus}`} color="emerald" />
        <SummaryCard label="Total Retur" value={`Rp ${Number(po.totalReturns || 0).toLocaleString('id-ID')}`} sub={`${po.returns?.length || 0} retur`} color="amber" />
        <SummaryCard label="Outstanding" value={`Rp ${Number(po.outstanding || 0).toLocaleString('id-ID')}`} sub={po.paymentTerm || '-'} color={po.outstanding > 0 ? 'red' : 'slate'} />
      </div>

      <Tabs defaultValue="items">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-6">
          <TabsTrigger value="info"><Receipt className="w-4 h-4 mr-1" />Info</TabsTrigger>
          <TabsTrigger value="items"><Scale className="w-4 h-4 mr-1" />Items & Timbang</TabsTrigger>
          <TabsTrigger value="grn"><Truck className="w-4 h-4 mr-1" />GRN</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-1" />Payment</TabsTrigger>
          <TabsTrigger value="returns"><RotateCcw className="w-4 h-4 mr-1" />Retur</TabsTrigger>
          <TabsTrigger value="hpp"><Calculator className="w-4 h-4 mr-1" />HPP</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-3">
          <InfoTab po={po} onSaved={mutate} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="items"><ItemsTab po={po} onSaved={mutate} canEdit={canOperate} /></TabsContent>
        <TabsContent value="grn"><GrnTab po={po} onSaved={mutate} canOperate={canOperate} /></TabsContent>
        <TabsContent value="payments"><PaymentsTab po={po} onSaved={mutate} canEdit={canEdit} /></TabsContent>
        <TabsContent value="returns"><ReturnsTab po={po} onSaved={mutate} canOperate={canOperate} /></TabsContent>
        <TabsContent value="hpp"><HppTab po={po} /></TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ label, value, sub, color = 'slate' }) {
  const c = { emerald: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', slate: 'text-slate-900' }[color] || '';
  return (
    <Card><CardContent className="pt-6">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${c}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </CardContent></Card>
  );
}

function InfoTab({ po, onSaved, canEdit }) {
  const rows = [
    ['Tipe PO', po.poType], ['Metode Timbang', po.method || '-'],
    ['Supplier', po.supplier?.displayName], ['Kode Supplier', po.supplier?.code],
    ['Order Date', po.orderDate && format(new Date(po.orderDate), 'dd MMM yyyy')],
    ['Expected Date', po.expectedDate && format(new Date(po.expectedDate), 'dd MMM yyyy')],
    ['Payment Term', po.paymentTerm || '-'],
    ['DP', `Rp ${Number(po.dpAmount).toLocaleString('id-ID')}`],
    ['Additional Cost', `Rp ${Number(po.additionalCost).toLocaleString('id-ID')}`],
    ['Invoice Number', po.invoiceNumber || '-'],
    ['Invoice Date', po.invoiceDate && format(new Date(po.invoiceDate), 'dd MMM yyyy')],
    ['Due Date', po.dueDate && format(new Date(po.dueDate), 'dd MMM yyyy')],
    ['Dropship', po.isDropship ? `Ya → ${po.dropshipCustomer?.displayName || '-'}` : 'Tidak'],
  ];
  return (
    <Card><CardContent className="pt-6 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        {rows.map(([k, v]) => (
          <div key={k} className="text-sm">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="font-medium">{v || <span className="text-muted-foreground">-</span>}</div>
          </div>
        ))}
      </div>
      {po.notes && <div className="pt-3 border-t"><div className="text-xs text-muted-foreground mb-1">Catatan</div><div className="text-sm whitespace-pre-wrap">{po.notes}</div></div>}
    </CardContent></Card>
  );
}

function ItemsTab({ po, onSaved, canEdit }) {
  const [items, setItems] = useState(po.items || []);
  const [saving, setSaving] = useState(false);
  const isLB = po.poType === 'Live Bird';
  const upd = (i, k, v) => { const arr = [...items]; arr[i] = { ...arr[i], [k]: v }; setItems(arr); };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { items: items.map(it => ({ id: it.id, weightSupplier: Number(it.weightSupplier), weightRph: Number(it.weightRph), headSupplier: Number(it.headSupplier), headRph: Number(it.headRph) })) };
      const res = await fetch(`/api/purchase-orders/${po.id}/weighings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Data timbang tersimpan. HPP dihitung ulang.');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Items & Data Timbang</CardTitle>
        {isLB && <CardDescription>Metode <b>{po.method}</b>: {po.method === 'Timbang Ulang' ? 'susut memotong invoice supplier.' : 'susut menaikkan HPP per kg.'}</CardDescription>}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Produk</TableHead><TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Berat Plan (kg)</TableHead>
            <TableHead className="text-right">Harga/kg</TableHead>
            {isLB && <TableHead className="text-right">Ekor Kandang</TableHead>}
            {isLB && <TableHead className="text-right">Berat Kandang (kg)</TableHead>}
            {isLB && <TableHead className="text-right">Ekor RPH</TableHead>}
            {isLB && <TableHead className="text-right">Berat RPH (kg)</TableHead>}
            {isLB && <TableHead className="text-right">Susut (kg)</TableHead>}
            <TableHead className="text-right">HPP/kg</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.map((it, i) => {
              const susut = Math.max(0, Number(it.weightSupplier || 0) - Number(it.weightRph || 0));
              return (
                <TableRow key={it.id}>
                  <TableCell><div className="font-medium">{it.product?.name}</div><div className="text-xs text-muted-foreground font-mono">{it.product?.sku}{it.product?.packagingType ? ` · ${pkgLabel(it.product.packagingType)}` : ''}</div></TableCell>
                  <TableCell className="text-right">{it.quantity} {it.product?.packagingType ? pkgShort(it.product.packagingType) : ''}</TableCell>
                  <TableCell className="text-right">{it.weight}</TableCell>
                  <TableCell className="text-right">Rp {Number(it.unitPrice).toLocaleString('id-ID')}</TableCell>
                  {isLB && <TableCell className="text-right"><Input disabled={!canEdit} type="number" className="h-8 text-right w-20 ml-auto" value={it.headSupplier || 0} onChange={e => upd(i, 'headSupplier', Number(e.target.value))} /></TableCell>}
                  {isLB && <TableCell className="text-right"><Input disabled={!canEdit} type="number" className="h-8 text-right w-24 ml-auto" value={it.weightSupplier || 0} onChange={e => upd(i, 'weightSupplier', Number(e.target.value))} /></TableCell>}
                  {isLB && <TableCell className="text-right"><Input disabled={!canEdit} type="number" className="h-8 text-right w-20 ml-auto" value={it.headRph || 0} onChange={e => upd(i, 'headRph', Number(e.target.value))} /></TableCell>}
                  {isLB && <TableCell className="text-right"><Input disabled={!canEdit} type="number" className="h-8 text-right w-24 ml-auto" value={it.weightRph || 0} onChange={e => upd(i, 'weightRph', Number(e.target.value))} /></TableCell>}
                  {isLB && <TableCell className="text-right"><span className={susut > 0 ? 'text-red-600 font-semibold' : ''}>{susut.toFixed(2)}</span></TableCell>}
                  <TableCell className="text-right font-semibold">Rp {Number(it.hppPerKg || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {canEdit && isLB && (
          <div className="p-4 border-t flex justify-end">
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan Data Timbang</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GrnTab({ po, onSaved, canOperate }) {
  const [open, setOpen] = useState(false);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0,10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const create = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/grn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receivedDate, notes }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('GRN ' + j.data.grnNumber + ' dibuat');
      setOpen(false); setNotes(''); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Goods Received Notes (Tanda Terima)</CardTitle><CardDescription>Konfirmasi penerimaan barang dari supplier</CardDescription></div>
        {canOperate && ['Dikirim', 'Tanda Terima'].includes(po.pipelineStatus) && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Truck className="w-4 h-4 mr-1" />Buat GRN</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Buat Tanda Terima</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <F label="Tanggal Terima"><Input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} /></F>
                <F label="Catatan"><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></F>
              </div>
              <DialogFooter><Button onClick={create} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {(po.grn || []).length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">Belum ada GRN</div> :
          <div className="border rounded-lg divide-y">
            {po.grn.map(g => (
              <div key={g.id} className="p-3 flex items-center justify-between text-sm">
                <div><div className="font-mono font-semibold">{g.grnNumber}</div><div className="text-xs text-muted-foreground">{format(new Date(g.receivedDate), 'dd MMM yyyy')} · {g.receivedBy}</div></div>
                <Badge>{g.status}</Badge>
              </div>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}

function PaymentsTab({ po, onSaved, canEdit }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: 0, method: 'Transfer', reference: '', isDp: false, paymentDate: new Date().toISOString().slice(0,10), notes: '' });
  const [saving, setSaving] = useState(false);
  const create = async () => {
    if (!form.amount) return toast.error('Nominal wajib diisi');
    setSaving(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Pembayaran tercatat');
      setOpen(false); setForm({ ...form, amount: 0, reference: '', notes: '' }); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Pembayaran</CardTitle><CardDescription>Transfer / Tunai / QRIS · DP atau pelunasan</CardDescription></div>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><CreditCard className="w-4 h-4 mr-1" />Catat Pembayaran</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Catat Pembayaran</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <F label="Tanggal"><Input type="date" value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} /></F>
                <F label="Metode">
                  <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Transfer">Transfer</SelectItem><SelectItem value="Tunai">Tunai</SelectItem><SelectItem value="QRIS">QRIS</SelectItem></SelectContent>
                  </Select>
                </F>
                <F label="Nominal (Rp)" className="col-span-2"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} /></F>
                <F label="Referensi (no bukti)" className="col-span-2"><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></F>
                <F label="Adalah DP?">
                  <Select value={form.isDp ? 'yes' : 'no'} onValueChange={v => setForm({ ...form, isDp: v === 'yes' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="no">Bukan DP (pelunasan)</SelectItem><SelectItem value="yes">Ya, DP</SelectItem></SelectContent>
                  </Select>
                </F>
                <F label="Catatan"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></F>
              </div>
              <DialogFooter><Button onClick={create} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {(po.payments || []).length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">Belum ada pembayaran</div> :
          <Table>
            <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Metode</TableHead><TableHead>Referensi</TableHead><TableHead>Tipe</TableHead><TableHead className="text-right">Nominal</TableHead></TableRow></TableHeader>
            <TableBody>
              {po.payments.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{format(new Date(p.paymentDate), 'dd MMM yyyy')}</TableCell>
                  <TableCell>{p.method}</TableCell>
                  <TableCell className="font-mono text-xs">{p.reference || '-'}</TableCell>
                  <TableCell>{p.isDp ? <Badge variant="outline">DP</Badge> : <Badge variant="secondary">Pelunasan</Badge>}</TableCell>
                  <TableCell className="text-right font-semibold">Rp {Number(p.amount).toLocaleString('id-ID')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>}
      </CardContent>
    </Card>
  );
}

function ReturnsTab({ po, onSaved, canOperate }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ returnDate: new Date().toISOString().slice(0,10), reason: '', resolution: 'potong_invoice', totalAmount: 0, totalWeight: 0, notes: '' });
  const [saving, setSaving] = useState(false);
  const create = async () => {
    if (!form.reason) return toast.error('Alasan retur wajib diisi');
    setSaving(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/returns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Retur ${j.data.returnNumber} dibuat. Notifikasi terkirim ke Supervisor & Direktur.`);
      setOpen(false); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Retur Pembelian</CardTitle><CardDescription>Potong invoice atau kirim pengganti · <Bell className="w-3 h-3 inline" /> notif otomatis ke Supervisor + Direktur</CardDescription></div>
        {canOperate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><RotateCcw className="w-4 h-4 mr-1" />Buat Retur</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Buat Retur Pembelian</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <F label="Tanggal Retur"><Input type="date" value={form.returnDate} onChange={e => setForm({ ...form, returnDate: e.target.value })} /></F>
                <F label="Resolusi">
                  <Select value={form.resolution} onValueChange={v => setForm({ ...form, resolution: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="potong_invoice">Potong Invoice</SelectItem><SelectItem value="kirim_pengganti">Kirim Pengganti</SelectItem></SelectContent>
                  </Select>
                </F>
                <F label="Alasan *" className="col-span-2"><Textarea rows={2} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></F>
                <F label="Nominal (Rp)"><Input type="number" value={form.totalAmount} onChange={e => setForm({ ...form, totalAmount: Number(e.target.value) })} /></F>
                <F label="Berat (kg)"><Input type="number" value={form.totalWeight} onChange={e => setForm({ ...form, totalWeight: Number(e.target.value) })} /></F>
                <F label="Catatan" className="col-span-2"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></F>
              </div>
              <DialogFooter><Button onClick={create} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Buat Retur</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {(po.returns || []).length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">Belum ada retur</div> :
          <div className="border rounded-lg divide-y">
            {po.returns.map(r => (
              <div key={r.id} className="p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-mono font-semibold">{r.returnNumber}</div>
                  <div className="flex gap-2"><Badge variant="outline">{r.resolution === 'potong_invoice' ? 'Potong Invoice' : 'Kirim Pengganti'}</Badge><Badge>{r.status}</Badge></div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{format(new Date(r.returnDate), 'dd MMM yyyy')}</div>
                <div className="mt-2">{r.reason}</div>
                <div className="mt-1 text-sm font-semibold">Rp {Number(r.totalAmount).toLocaleString('id-ID')} · {r.totalWeight} kg</div>
              </div>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}

function HppTab({ po }) {
  const { data, isLoading } = useSWR(`/api/purchase-orders/${po.id}/hpp`, fetcher);
  if (isLoading || !data?.data) return <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  const { items, totals } = data.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Ringkasan HPP</CardTitle>
          <CardDescription>Rumus: HPP = (harga/kg × berat) + biaya tambahan per kg (proporsional per berat). {po.method === 'Timbang Kandang' ? 'Susut menaikkan HPP/kg efektif.' : 'Susut memotong invoice.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <Stat label="Subtotal Items" value={`Rp ${Number(totals.subtotal).toLocaleString('id-ID')}`} />
          <Stat label="Biaya Tambahan" value={`Rp ${Number(totals.additionalCost).toLocaleString('id-ID')}`} />
          <Stat label="Total HPP" value={`Rp ${Number(totals.totalHpp).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`} highlight />
          <Stat label="Rata-rata HPP/kg" value={`Rp ${Number(totals.avgHppPerKg).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`} highlight />
          <Stat label="Berat Dibayar" value={`${totals.totalWeightBilled} kg`} />
          <Stat label="Berat Aktual (RPH)" value={`${totals.totalWeightActual} kg`} />
          <Stat label="Total Susut" value={`${totals.totalSusut.toFixed(2)} kg`} />
          <Stat label="Grand Total (Invoice)" value={`Rp ${Number(totals.grandTotal).toLocaleString('id-ID')}`} highlight />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Detail HPP per Item</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Produk</TableHead><TableHead className="text-right">Harga/kg</TableHead>
              <TableHead className="text-right">Berat Bill</TableHead><TableHead className="text-right">Berat Aktual</TableHead>
              <TableHead className="text-right">Susut</TableHead>
              <TableHead className="text-right">Item Cost</TableHead>
              <TableHead className="text-right">Share Biaya</TableHead>
              <TableHead className="text-right">HPP Total</TableHead>
              <TableHead className="text-right">HPP/kg</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {items.map(it => (
                <TableRow key={it.id}>
                  <TableCell><div className="font-medium">{it.product?.name}</div><div className="text-xs text-muted-foreground font-mono">{it.product?.sku}</div></TableCell>
                  <TableCell className="text-right">Rp {Number(it.unitPrice).toLocaleString('id-ID')}</TableCell>
                  <TableCell className="text-right">{it.weightBilled}</TableCell>
                  <TableCell className="text-right">{it.weightActual}</TableCell>
                  <TableCell className="text-right text-red-600">{Number(it.susut).toFixed(2)}</TableCell>
                  <TableCell className="text-right">Rp {Number(it.itemCost).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                  <TableCell className="text-right">Rp {Number(it.additionalCostShare).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                  <TableCell className="text-right font-semibold">Rp {Number(it.hppTotal).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                  <TableCell className="text-right font-bold text-emerald-700">Rp {Number(it.hppPerKg).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`p-3 rounded-lg border ${highlight ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-bold ${highlight ? 'text-emerald-700 text-lg' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
