'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { WeightInput } from '@/components/ui/weight-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ArrowLeft, Loader2, Save, Truck, Receipt, CreditCard, RotateCcw, Calculator, Scale, ShoppingCart, CheckCircle2, XCircle, Bell, FileDown, Upload, FileText, Paperclip, Trash2, TrendingDown } from 'lucide-react';
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
          {po.isDropship && po.linkedSalesOrder && (
            <Link href={`/dashboard/sales-orders/${po.linkedSalesOrder.id}`} className="inline-flex items-center gap-1.5 mt-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition">
              <ShoppingCart className="w-3.5 h-3.5" /> SO terkait: {po.linkedSalesOrder.soNumber}
              <Badge variant="outline" className="ml-1 text-[10px] border-indigo-300">{po.linkedSalesOrder.pipelineStatus}</Badge>
              <ArrowLeft className="w-3 h-3 rotate-180" />
            </Link>
          )}
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
          <FileDown className="w-4 h-4 mr-1" /> {po.isDropship ? 'PDF Invoice' : 'PDF PO'}
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
        <SummaryCard label="Total PO" value={`Rp ${Number(po.totalAmount).toLocaleString('id-ID')}`} sub={(po.additionalCostBearer !== 'supplier' && (po.additionalCostPayMethod || 'utang') === 'utang' && Number(po.additionalCost) > 0) ? 'Termasuk ongkir (utang)' : 'Barang saja'} />
        <SummaryCard label="Sudah Dibayar" value={`Rp ${Number(po.paidAmount).toLocaleString('id-ID')}`} sub={`Status: ${po.paymentStatus}`} color="emerald" />
        <SummaryCard label="Total Retur" value={`Rp ${Number(po.totalReturns || 0).toLocaleString('id-ID')}`} sub={`${po.returns?.length || 0} retur`} color="amber" />
        <SummaryCard label="Outstanding" value={`Rp ${Number(po.outstanding || 0).toLocaleString('id-ID')}`} sub={po.paymentTerm || '-'} color={po.outstanding > 0 ? 'red' : 'slate'} />
      </div>

      {po.isDropship && po.dropshipShipVsRecv && (
        <Card className="border-purple-200 bg-purple-50/40">
          <CardContent className="py-3">
            <div className="flex items-center flex-wrap gap-x-6 gap-y-1.5 text-sm">
              <div className="flex items-center gap-2 font-semibold text-purple-800"><TrendingDown className="w-4 h-4" />Susut Dropship (Kirim → Terima)</div>
              <div><span className="text-muted-foreground">Berat Kirim (GRN/SJ): </span><b>{Number(po.dropshipShipVsRecv.shipped).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg</b></div>
              <div><span className="text-muted-foreground">Berat Diterima Customer: </span><b>{Number(po.dropshipShipVsRecv.received).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg</b>{!po.dropshipShipVsRecv.hasReceipt && <span className="text-[11px] text-muted-foreground"> (belum ada penerimaan)</span>}</div>
              <div><span className="text-muted-foreground">Susut: </span><b className={po.dropshipShipVsRecv.susut > 0.0001 ? 'text-red-600' : 'text-emerald-700'}>{Number(po.dropshipShipVsRecv.susut).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg</b></div>
            </div>
          </CardContent>
        </Card>
      )}

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
          <AdditionalCostCard po={po} onSaved={mutate} canEdit={canEdit} />
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
    ['Biaya Tambahan / Ongkir', `Rp ${Number(po.additionalCost).toLocaleString('id-ID')} · ${po.additionalCostBearer === 'supplier' ? 'ditanggung pemasok' : 'ditanggung kita'}`],
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

function AdditionalCostCard({ po, onSaved, canEdit }) {
  const [cost, setCost] = useState(String(po.additionalCost || 0));
  const [bearer, setBearer] = useState(po.additionalCostBearer || 'company');
  const [payMethod, setPayMethod] = useState(po.additionalCostPayMethod || 'utang');
  const [saving, setSaving] = useState(false);
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const locked = po.pipelineStatus === 'Selesai';
  const editable = canEdit && !locked;
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalCost: Number(cost || 0), additionalCostBearer: bearer, additionalCostPayMethod: payMethod }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Biaya tambahan disimpan');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4" />Biaya Tambahan / Ongkir Pembelian</CardTitle>
        <CardDescription>
          <b>Ditanggung Pemasok</b> → tidak memengaruhi biaya/laba kita (netral). <b>Ditanggung Kita</b> → dicatat sebagai
          <b> Beban Angkut Pembelian</b> (mengurangi laba), <b>tidak</b> masuk ke HPP barang.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Biaya Tambahan (Rp)</Label>
            <CurrencyInput value={cost} onChange={v => setCost(v)} disabled={!editable} className="mt-1" placeholder="0" />
          </div>
          <div>
            <Label className="text-xs">Ditanggung</Label>
            <Select value={bearer} onValueChange={setBearer} disabled={!editable}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Kita (perusahaan) — kurangi laba</SelectItem>
                <SelectItem value="supplier">Pemasok — netral</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Dibayar via</Label>
            <Select value={payMethod} onValueChange={setPayMethod} disabled={!editable || bearer === 'supplier'}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="utang">Utang ke Pemasok (masuk tagihan PO)</SelectItem>
                <SelectItem value="transfer">Bank / Transfer (kurir/pihak ketiga)</SelectItem>
                <SelectItem value="tunai">Kas Tunai (kurir/pihak ketiga)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-muted-foreground">
            {bearer === 'supplier'
              ? <>Efek ke laba: <b className="text-emerald-700">Rp 0 (netral)</b></>
              : <>Efek ke laba: <b className="text-red-600">-{rp(cost)}</b> (Beban Angkut){payMethod === 'utang' ? ' · menambah total/utang PO' : payMethod === 'tunai' ? ' · kas keluar tunai' : ' · transfer bank'}</>}
          </span>
          {editable && <Button size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Simpan Biaya Tambahan</Button>}
        </div>
      </CardContent>
    </Card>
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
                  {isLB && <TableCell className="text-right"><WeightInput disabled={!canEdit} className="h-8 text-right w-24 ml-auto" value={it.weightSupplier || 0} onChange={v => upd(i, 'weightSupplier', v)} /></TableCell>}
                  {isLB && <TableCell className="text-right"><CurrencyInput disabled={!canEdit} className="h-8 text-right w-20 ml-auto" value={it.headRph || 0} onChange={v => upd(i, 'headRph', v)} /></TableCell>}
                  {isLB && <TableCell className="text-right"><CurrencyInput disabled={!canEdit} className="h-8 text-right w-24 ml-auto" value={it.weightRph || 0} onChange={v => upd(i, 'weightRph', v)} /></TableCell>}
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
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [sjNumber, setSjNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);
  const fmt = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const kg = (n) => Number(n || 0).toLocaleString('id-ID') + ' kg';

  const openDialog = () => {
    setRows((po.items || []).map(it => ({
      productId: it.productId, name: it.product?.name || it.productId,
      planWeight: Number(it.weight || 0), unitPrice: Number(it.unitPrice || 0),
      receivedWeight: String(it.receivedWeight > 0 ? it.receivedWeight : (it.weight || 0)),
      receivedQuantity: String(it.quantity || 0),
    })));
    setOpen(true);
  };
  const updRow = (pid, field, val) => setRows(prev => prev.map(r => r.productId === pid ? { ...r, [field]: val } : r));
  const addInTotal = (po.additionalCostBearer !== 'supplier' && (po.additionalCostPayMethod || 'utang') === 'utang');
  const previewTotal = rows.reduce((a, r) => a + Number(r.unitPrice || 0) * Number(r.receivedWeight || 0), 0) + (addInTotal ? Number(po.additionalCost || 0) : 0);

  const create = async () => {
    setSaving(true);
    try {
      const items = rows.map(r => ({ productId: r.productId, receivedWeight: Number(r.receivedWeight || 0), receivedQuantity: Number(r.receivedQuantity || 0) }));
      const res = await fetch(`/api/purchase-orders/${po.id}/grn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivedDate, sjNumber, driverName, vehicleNumber, notes, items }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('GRN ' + j.data.grnNumber + ' dibuat · Total PO direvisi ke ' + fmt(j.data.totalAmount));
      setOpen(false); setNotes(''); setSjNumber(''); setDriverName(''); setVehicleNumber(''); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const uploadDoc = async (grnId, file) => {
    if (!file) return;
    setUploadingId(grnId);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/grns/${grnId}/documents`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal upload');
      toast.success('Surat Jalan diunggah');
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setUploadingId(null); }
  };
  const deleteDoc = async (docId) => {
    if (!confirm('Hapus dokumen ini?')) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Gagal'); }
      toast.success('Dokumen dihapus'); onSaved();
    } catch (e) { toast.error(e.message); }
  };

  const variance = Number(po.weightVariance || 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Goods Received Notes (Tanda Terima)</CardTitle><CardDescription>Konfirmasi berat & Surat Jalan supplier</CardDescription></div>
        {canOperate && ['Dikirim', 'Tanda Terima'].includes(po.pipelineStatus) && (
          <Dialog open={open} onOpenChange={(v) => v ? openDialog() : setOpen(false)}>
            <DialogTrigger asChild><Button size="sm" onClick={openDialog}><Truck className="w-4 h-4 mr-1" />Terima Barang / GRN</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Terima Barang — Konfirmasi Berat & Surat Jalan</DialogTitle></DialogHeader>
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3">
                  <F label="No. Surat Jalan (Supplier)"><Input value={sjNumber} onChange={e => setSjNumber(e.target.value)} placeholder="mis. SJ/2026/001" /></F>
                  <F label="Tanggal Terima"><Input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} /></F>
                  <F label="Nama Supir"><Input value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="opsional" /></F>
                  <F label="No. Kendaraan"><Input value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} placeholder="opsional" /></F>
                </div>
                <div>
                  <div className="text-xs font-medium mb-1">Berat Dikirim per Item (dari Surat Jalan)</div>
                  <div className="border rounded-lg divide-y">
                    <div className="grid grid-cols-12 gap-2 px-2 py-1.5 text-[11px] font-medium text-muted-foreground bg-muted/40">
                      <div className="col-span-5">Produk</div><div className="col-span-2 text-right">Rencana</div>
                      <div className="col-span-3 text-right">Berat Dikirim (kg)</div><div className="col-span-2 text-right">Qty</div>
                    </div>
                    {rows.map(r => (
                      <div key={r.productId} className="grid grid-cols-12 gap-2 px-2 py-1.5 items-center text-sm">
                        <div className="col-span-5 truncate">{r.name}</div>
                        <div className="col-span-2 text-right text-muted-foreground">{kg(r.planWeight)}</div>
                        <div className="col-span-3"><WeightInput className="h-8 text-right" value={r.receivedWeight} onChange={v => updRow(r.productId, 'receivedWeight', v)} /></div>
                        <div className="col-span-2"><Input type="number" className="h-8 text-right" value={r.receivedQuantity} onChange={e => updRow(r.productId, 'receivedQuantity', e.target.value)} /></div>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5">Total PO akan direvisi ke: <b className="text-foreground">{fmt(previewTotal)}</b> (harga × berat dikirim{addInTotal ? ' + biaya tambahan (utang)' : ''})</div>
                </div>
                <F label="Catatan"><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></F>
              </div>
              <DialogFooter><Button onClick={create} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan & Revisi PO</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {po.weightConfirmed && (
          <div className={`rounded-lg border p-3 text-sm ${variance === 0 ? 'bg-muted/40' : variance < 0 ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className="flex items-center gap-2 font-medium"><Scale className="w-4 h-4" />Keterangan Berat</div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
              <div>Berat Rencana:<div className="font-semibold text-sm">{kg(po.totalPlanWeight)}</div></div>
              <div>Berat Dikirim (SJ):<div className="font-semibold text-sm">{kg(po.totalReceivedWeight)}</div></div>
              <div>Selisih:<div className={`font-semibold text-sm ${variance < 0 ? 'text-amber-700' : variance > 0 ? 'text-blue-700' : ''}`}>{variance > 0 ? '+' : ''}{kg(variance)}</div></div>
            </div>
          </div>
        )}
        {po.tallyDone && (
          <div className={`rounded-lg border p-3 text-sm ${Math.abs(po.tallyVariance) < 0.01 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center gap-2 font-medium"><Scale className="w-4 h-4" />Rekonsiliasi Tally (Timbang Ulang Inventory)</div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
              <div>Surat Jalan:<div className="font-semibold text-sm">{kg(po.totalReceivedWeight)}</div></div>
              <div>Hasil Tally:<div className="font-semibold text-sm">{kg(po.tallyWeight)}</div></div>
              <div>Selisih (Susut):<div className={`font-semibold text-sm ${Math.abs(po.tallyVariance) < 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>{po.tallyVariance > 0 ? '+' : ''}{kg(po.tallyVariance)}</div></div>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">{Math.abs(po.tallyVariance) < 0.01 ? 'Hasil timbang ulang sesuai dengan Surat Jalan.' : (po.tallyVariance < 0 ? 'Terjadi penyusutan dibanding Surat Jalan.' : 'Hasil tally lebih besar dari Surat Jalan — mohon dicek.')}</div>
          </div>
        )}
        {(po.grn || []).length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">Belum ada GRN</div> :
          <div className="space-y-2">
            {po.grn.map(g => (
              <div key={g.id} className="border rounded-lg p-3 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono font-semibold">{g.grnNumber}{g.sjNumber ? <span className="ml-2 text-xs text-muted-foreground">SJ: {g.sjNumber}</span> : null}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(g.receivedDate), 'dd MMM yyyy')} · {g.receivedBy} · Diterima {kg(g.totalReceivedWeight)}{g.driverName ? ` · ${g.driverName}` : ''}{g.vehicleNumber ? ` (${g.vehicleNumber})` : ''}</div>
                  </div>
                  <Badge>{g.status}</Badge>
                </div>
                {(g.items || []).length > 0 && (
                  <div className="text-xs text-muted-foreground">{g.items.map(i => `${i.product?.name || ''}: ${kg(i.receivedWeight)}`).join(' · ')}</div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {(g.documents || []).map(d => (
                    <span key={d.id} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-2 py-1">
                      <FileText className="w-3.5 h-3.5" />
                      <a href={d.viewUrl} target="_blank" rel="noopener noreferrer" className="underline max-w-[160px] truncate">{d.originalName}</a>
                      {canOperate && <button onClick={() => deleteDoc(d.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3" /></button>}
                    </span>
                  ))}
                  {canOperate && (
                    <label className="inline-flex items-center gap-1 text-xs cursor-pointer text-indigo-600 hover:text-indigo-800">
                      {uploadingId === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>Upload Surat Jalan</span>
                      <input type="file" className="hidden" accept="application/pdf,image/*" onChange={e => { uploadDoc(g.id, e.target.files?.[0]); e.target.value = ''; }} disabled={uploadingId === g.id} />
                    </label>
                  )}
                </div>
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
    <div className="space-y-3">
      {canEdit && <InvoiceBasisCard po={po} onSaved={onSaved} />}
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
                <F label="Nominal (Rp)" className="col-span-2"><CurrencyInput value={form.amount} onChange={v => setForm({ ...form, amount: v })} placeholder="0" /></F>
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
    </div>
  );
}

function InvoiceBasisCard({ po, onSaved }) {
  const isDrop = !!po.isDropship;
  const [basis, setBasis] = useState(po.invoiceWeightBasis || (isDrop ? 'grn' : 'shipped'));
  const [invoiceNumber, setInvoiceNumber] = useState(po.invoiceNumber || '');
  const [invoiceDate, setInvoiceDate] = useState(po.invoiceDate ? new Date(po.invoiceDate).toISOString().slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const fmt = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const kg = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' kg';
  const tallyAvailable = Number(po.totalTallyWeight || 0) > 0;
  const shippedTotal = Number(po.invoiceShippedTotal ?? po.totalAmount ?? 0);
  const tallyTotal = Number(po.invoiceTallyTotal ?? po.totalAmount ?? 0);
  const grnTotal = Number(po.invoiceGrnTotal ?? po.totalAmount ?? 0);
  const soReceiptTotal = Number(po.invoiceSoReceiptTotal ?? po.totalAmount ?? 0);
  const basisLabel = (b) => ({ grn: 'GRN PO / Surat Jalan SO', so_receipt: 'Penerimaan Customer (SO)', tally: 'Rekonsiliasi Tally', shipped: 'Surat Jalan' }[b] || b);
  const selectedTotal = isDrop ? (basis === 'so_receipt' ? soReceiptTotal : grnTotal) : (basis === 'tally' ? tallyTotal : shippedTotal);
  const apply = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}/invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basis, invoiceNumber: invoiceNumber || undefined, invoiceDate: invoiceDate || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Total tagihan diterapkan: ${fmt(j.data.totalAmount)} (basis: ${basisLabel(j.data.invoiceWeightBasis || basis)})`);
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const Option = ({ value, title, desc, total, disabled }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setBasis(value)}
      className={`flex-1 text-left rounded-lg border p-3 transition ${basis === value ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/60' : 'border-border hover:bg-slate-50'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {basis === value && <Badge className="bg-emerald-600 text-white text-[10px]">Dipilih</Badge>}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
      <div className="text-lg font-bold mt-1">{fmt(total)}</div>
    </button>
  );
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Receipt className="w-4 h-4" />Basis Invoice PO {isDrop && <Badge variant="outline" className="border-indigo-300 text-indigo-700 text-[10px]">Dropship</Badge>}</CardTitle>
        <CardDescription>
          {isDrop
            ? <>Dropship: pilih dasar tagihan supplier — berat <b>GRN PO / Surat Jalan SO</b> (dikirim) atau <b>Penerimaan Customer (SO)</b>. Barang tidak masuk gudang, jadi <b>tanpa Rekonsiliasi Tally</b>.</>
            : <>Pilih dasar perhitungan total tagihan ke supplier: berat <b>Surat Jalan (dikirim)</b> atau hasil <b>Rekonsiliasi Tally (diterima)</b>.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {isDrop ? (
            <>
              <Option value="grn" title="GRN PO / Surat Jalan SO" desc={`Berat kirim SJ = GRN: ${kg(po.totalReceivedWeight)}`} total={grnTotal} />
              <Option value="so_receipt" title="Penerimaan Customer (SO)" desc="Berat riil diterima customer (setelah susut kirim)" total={soReceiptTotal} />
            </>
          ) : (
            <>
              <Option value="shipped" title="Surat Jalan (Dikirim)" desc={`Berat SJ: ${kg(po.totalReceivedWeight)}`} total={shippedTotal} />
              <Option value="tally" title="Rekonsiliasi Tally (Diterima)" desc={tallyAvailable ? `Berat Tally: ${kg(po.totalTallyWeight)}` : 'Belum ada data tally'} total={tallyTotal} disabled={!tallyAvailable} />
            </>
          )}
        </div>
        {!isDrop && !tallyAvailable && <div className="text-[11px] text-amber-600">Basis Tally aktif setelah barang ditimbang ulang lewat Tally Inbound.</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <F label="No. Invoice Supplier (opsional)"><Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="mis. INV/2026/001" /></F>
          <F label="Tanggal Invoice (opsional)"><Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></F>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t">
          <div className="text-sm">Total tagihan terpilih: <b className="text-emerald-700">{fmt(selectedTotal)}</b></div>
          <Button size="sm" onClick={apply} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Terapkan sebagai Total Tagihan</Button>
        </div>
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
                <F label="Nominal (Rp)"><CurrencyInput value={form.totalAmount} onChange={v => setForm({ ...form, totalAmount: v })} placeholder="0" /></F>
                <F label="Berat (kg)"><WeightInput value={form.totalWeight} onChange={v => setForm({ ...form, totalWeight: v })} placeholder="0" /></F>
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
          <CardDescription>HPP/kg dihitung dari <b>Rekonsiliasi Tally (berat diterima riil)</b>, <b>tanpa</b> biaya tambahan/ongkir. Basis invoice terpilih: <b>{totals.invoiceWeightBasis === 'tally' ? 'Rekonsiliasi Tally' : 'Surat Jalan'}</b>. Ongkir yang ditanggung kita dicatat sebagai <b>Beban Angkut Pembelian</b> (di luar HPP). Susut = Berat Dikirim (SJ) − Berat Diterima (Tally).</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <Stat label="Subtotal Items" value={`Rp ${Number(totals.subtotal).toLocaleString('id-ID')}`} />
          <Stat label={`Biaya Tambahan (${totals.additionalCostBearer === 'supplier' ? 'pemasok' : 'kita·beban'})`} value={`Rp ${Number(totals.additionalCost).toLocaleString('id-ID')}`} />
          <Stat label="Total HPP" value={`Rp ${Number(totals.totalHpp).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`} highlight />
          <Stat label="Rata-rata HPP/kg" value={`Rp ${Number(totals.avgHppPerKg).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`} highlight />
          <Stat label="Berat Ditagih (Invoice)" value={`${totals.totalWeightBilled} kg`} />
          <Stat label="Berat Diterima (Tally)" value={`${totals.totalWeightActual} kg`} />
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
