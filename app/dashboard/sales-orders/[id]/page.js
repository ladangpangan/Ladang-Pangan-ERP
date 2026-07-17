'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
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
import { ArrowLeft, Loader2, Receipt, Truck, CreditCard, RotateCcw, Package, CheckCircle2, XCircle, Bell, Printer, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { SO_STATUS_COLOR } from '../page';
import { generateInvoicePDF } from '@/lib/pdf/invoice';

const fetcher = (url) => fetch(url).then(r => r.json());
const SO_FLOW = {
  'Draft': ['Confirmed', 'Cancelled'],
  'Confirmed': ['Packed', 'Cancelled'],
  'Packed': ['Shipped', 'Cancelled'],
  'Shipped': ['Invoiced', 'Cancelled'],
  'Invoiced': [], 'Cancelled': [],
};
const STEPS = ['Draft', 'Confirmed', 'Packed', 'Shipped', 'Invoiced'];

export default function SODetailPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canEdit = ['admin', 'supervisor'].includes(role);
  const canOperate = ['admin', 'supervisor', 'operator'].includes(role);
  const { data, mutate, isLoading } = useSWR(`/api/sales-orders/${id}`, fetcher);
  const so = data?.data;

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!so) return <div className="text-center py-20 text-muted-foreground">SO tidak ditemukan</div>;

  const currentStepIdx = STEPS.indexOf(so.pipelineStatus);
  const allowedNext = SO_FLOW[so.pipelineStatus] || [];

  const transitionStatus = async (target) => {
    if (!confirm(`Ubah status ke "${target}"?${target === 'Confirmed' ? '\n\nStok akan otomatis dikurangi + prepaid balance (jika subscriber) akan dipotong.' : ''}`)) return;
    const res = await fetch(`/api/sales-orders/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: target }) });
    const j = await res.json();
    if (res.ok) { toast.success('Status: ' + target); mutate(); } else toast.error(j.error);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/sales-orders"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{so.soNumber}</h1>
            <Badge className={SO_STATUS_COLOR[so.pipelineStatus]}>{so.pipelineStatus}</Badge>
            {so.customer?.isSubscriber && <Badge variant="outline">Subscriber</Badge>}
            {so.invoiceNumber && <Badge variant="secondary" className="font-mono">{so.invoiceNumber}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm mt-1">{so.customer?.displayName} · {so.orderDate && format(new Date(so.orderDate), 'dd MMM yyyy')}</p>
        </div>
        {canEdit && allowedNext.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {allowedNext.map(a => (
              <Button key={a} size="sm" variant={a === 'Cancelled' ? 'destructive' : 'default'} onClick={() => transitionStatus(a)}>
                {a === 'Cancelled' ? <XCircle className="w-4 h-4 mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}{a}
              </Button>
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            try {
              const doc = generateInvoicePDF(so);
              const name = so.invoiceNumber || so.soNumber;
              doc.save(`Invoice-${name}.pdf`);
              toast.success('PDF berhasil diunduh');
            } catch (e) {
              toast.error('Gagal membuat PDF: ' + e.message);
            }
          }}
        >
          <FileDown className="w-4 h-4 mr-1" /> PDF Invoice
        </Button>
      </div>

      <Card><CardContent className="pt-6">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex-1 min-w-[80px]">
              <div className={`h-2 rounded-full ${idx <= currentStepIdx && so.pipelineStatus !== 'Cancelled' ? 'bg-emerald-500' : 'bg-slate-200'}`} />
              <div className={`text-xs mt-2 ${idx === currentStepIdx ? 'font-bold text-emerald-700' : 'text-muted-foreground'}`}>{step}</div>
            </div>
          ))}
        </div>
      </CardContent></Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SumCard label="Total SO" value={`Rp ${Number(so.totalAmount).toLocaleString('id-ID')}`} sub={`Diskon Rp ${Number(so.discountTotal || 0).toLocaleString('id-ID')}`} />
        <SumCard label="Sudah Dibayar" value={`Rp ${Number(so.paidAmount).toLocaleString('id-ID')}`} sub={`Status: ${so.paymentStatus}`} color="emerald" />
        <SumCard label="Total Retur" value={`Rp ${Number(so.totalReturns || 0).toLocaleString('id-ID')}`} sub={`${so.returns?.length || 0} retur`} color="amber" />
        <SumCard label="Outstanding" value={`Rp ${Number(so.outstanding || 0).toLocaleString('id-ID')}`} sub={so.paymentTerm || '-'} color={so.outstanding > 0 ? 'red' : 'slate'} />
      </div>

      <Tabs defaultValue="items">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5">
          <TabsTrigger value="info"><Receipt className="w-4 h-4 mr-1" />Info</TabsTrigger>
          <TabsTrigger value="items"><Package className="w-4 h-4 mr-1" />Items</TabsTrigger>
          <TabsTrigger value="sj"><Truck className="w-4 h-4 mr-1" />Surat Jalan</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-1" />Payment</TabsTrigger>
          <TabsTrigger value="returns"><RotateCcw className="w-4 h-4 mr-1" />Retur</TabsTrigger>
        </TabsList>
        <TabsContent value="info"><InfoTab so={so} /></TabsContent>
        <TabsContent value="items"><ItemsTab so={so} /></TabsContent>
        <TabsContent value="sj"><SjTab so={so} onSaved={mutate} canOperate={canOperate} /></TabsContent>
        <TabsContent value="payments"><PaymentsTab so={so} onSaved={mutate} canEdit={canEdit} /></TabsContent>
        <TabsContent value="returns"><ReturnsTab so={so} onSaved={mutate} canOperate={canOperate} /></TabsContent>
      </Tabs>
    </div>
  );
}

function SumCard({ label, value, sub, color = 'slate' }) {
  const c = { emerald: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', slate: 'text-slate-900' }[color] || '';
  return (
    <Card><CardContent className="pt-6">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${c}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </CardContent></Card>
  );
}

function InfoTab({ so }) {
  const rows = [
    ['Customer', so.customer?.displayName],
    ['Kode Customer', so.customer?.code],
    ['Subscriber', so.customer?.isSubscriber ? 'Ya' : 'Tidak'],
    ['Prepaid Balance', so.customer?.isSubscriber ? `Rp ${Number(so.customer?.prepaidBalance || 0).toLocaleString('id-ID')}` : '-'],
    ['Credit Limit', `Rp ${Number(so.customer?.creditLimit || 0).toLocaleString('id-ID')}`],
    ['Order Date', so.orderDate && format(new Date(so.orderDate), 'dd MMM yyyy')],
    ['Expected Date', so.expectedDate && format(new Date(so.expectedDate), 'dd MMM yyyy')],
    ['Payment Term', so.paymentTerm || '-'],
    ['DP', `Rp ${Number(so.dpAmount).toLocaleString('id-ID')}`],
    ['Invoice Number', so.invoiceNumber || '-'],
    ['Invoice Date', so.invoiceDate && format(new Date(so.invoiceDate), 'dd MMM yyyy')],
    ['Due Date', so.dueDate && format(new Date(so.dueDate), 'dd MMM yyyy')],
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
      {so.notes && <div className="pt-3 border-t"><div className="text-xs text-muted-foreground mb-1">Catatan</div><div className="text-sm whitespace-pre-wrap">{so.notes}</div></div>}
    </CardContent></Card>
  );
}

function ItemsTab({ so }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">Items SO</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Berat</TableHead><TableHead className="text-right">Harga</TableHead><TableHead className="text-right">Diskon</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow></TableHeader>
          <TableBody>
            {so.items?.map(it => (
              <TableRow key={it.id}>
                <TableCell><div className="font-medium">{it.product?.name}</div><div className="text-xs text-muted-foreground font-mono">{it.product?.sku}</div></TableCell>
                <TableCell className="text-right">{it.quantity} {it.product?.unit}</TableCell>
                <TableCell className="text-right">{it.weight} kg</TableCell>
                <TableCell className="text-right">Rp {Number(it.unitPrice).toLocaleString('id-ID')}</TableCell>
                <TableCell className="text-right text-red-600">-Rp {Number(it.discount || 0).toLocaleString('id-ID')}</TableCell>
                <TableCell className="text-right font-semibold">Rp {Number(it.subtotal).toLocaleString('id-ID')}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-slate-50">
              <TableCell colSpan={5} className="text-right font-semibold">Total</TableCell>
              <TableCell className="text-right font-bold text-emerald-700">Rp {Number(so.totalAmount).toLocaleString('id-ID')}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SjTab({ so, onSaved, canOperate }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ deliveryDate: new Date().toISOString().slice(0,10), driverName: '', vehicleNumber: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const create = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-orders/${so.id}/surat-jalan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Surat Jalan ' + j.data.sjNumber + ' dibuat');
      setOpen(false); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Surat Jalan (Delivery Order)</CardTitle><CardDescription>Dokumen pengiriman barang ke customer</CardDescription></div>
        {canOperate && ['Packed', 'Shipped', 'Invoiced'].includes(so.pipelineStatus) && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Truck className="w-4 h-4 mr-1" />Buat Surat Jalan</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Buat Surat Jalan</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <F label="Tanggal Kirim"><Input type="date" value={form.deliveryDate} onChange={e => setForm({ ...form, deliveryDate: e.target.value })} /></F>
                <F label="Nama Sopir"><Input value={form.driverName} onChange={e => setForm({ ...form, driverName: e.target.value })} /></F>
                <F label="No Kendaraan" className="col-span-2"><Input value={form.vehicleNumber} onChange={e => setForm({ ...form, vehicleNumber: e.target.value })} placeholder="B 1234 XYZ" /></F>
                <F label="Catatan" className="col-span-2"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></F>
              </div>
              <DialogFooter><Button onClick={create} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {(so.suratJalan || []).length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">Belum ada Surat Jalan</div> :
          <div className="border rounded-lg divide-y">
            {so.suratJalan.map(sj => (
              <div key={sj.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <div className="font-mono font-semibold">{sj.sjNumber}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(sj.deliveryDate), 'dd MMM yyyy')} · {sj.driverName || '-'} · {sj.vehicleNumber || '-'}</div>
                </div>
                <Badge>{sj.status}</Badge>
              </div>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}

function PaymentsTab({ so, onSaved, canEdit }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: 0, method: 'Transfer', reference: '', isDp: false, paymentDate: new Date().toISOString().slice(0,10), notes: '' });
  const [saving, setSaving] = useState(false);
  const create = async () => {
    if (!form.amount) return toast.error('Nominal wajib');
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-orders/${so.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
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
        <div><CardTitle className="text-base">Pembayaran Customer</CardTitle><CardDescription>Transfer / Tunai / QRIS</CardDescription></div>
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
                <F label="Referensi" className="col-span-2"><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></F>
                <F label="Adalah DP?">
                  <Select value={form.isDp ? 'yes' : 'no'} onValueChange={v => setForm({ ...form, isDp: v === 'yes' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="no">Bukan DP</SelectItem><SelectItem value="yes">Ya, DP</SelectItem></SelectContent>
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
        {(so.payments || []).length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">Belum ada pembayaran</div> :
          <Table>
            <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Metode</TableHead><TableHead>Referensi</TableHead><TableHead>Tipe</TableHead><TableHead className="text-right">Nominal</TableHead></TableRow></TableHeader>
            <TableBody>
              {so.payments.map(p => (
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

function ReturnsTab({ so, onSaved, canOperate }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ returnDate: new Date().toISOString().slice(0,10), reason: '', resolution: 'potong_invoice', totalAmount: 0, totalWeight: 0, notes: '' });
  const [saving, setSaving] = useState(false);
  const create = async () => {
    if (!form.reason) return toast.error('Alasan retur wajib');
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-orders/${so.id}/returns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Retur ${j.data.returnNumber} dibuat. Notif terkirim ke Supervisor & Direktur.`);
      setOpen(false); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Retur Penjualan</CardTitle><CardDescription><Bell className="w-3 h-3 inline" /> notif otomatis ke Supervisor + Direktur</CardDescription></div>
        {canOperate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline"><RotateCcw className="w-4 h-4 mr-1" />Buat Retur</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Buat Retur Penjualan</DialogTitle></DialogHeader>
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
        {(so.returns || []).length === 0 ? <div className="text-center py-8 text-muted-foreground text-sm">Belum ada retur</div> :
          <div className="border rounded-lg divide-y">
            {so.returns.map(r => (
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

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
