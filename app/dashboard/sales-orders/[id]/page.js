'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/auth/auth-client';
import { cn } from '@/lib/utils';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeft, Loader2, Receipt, Truck, CreditCard, RotateCcw, Package, PackageCheck, CheckCircle2, XCircle, Bell, Printer, FileDown, TrendingDown, Trash2, Calculator, Camera, Eye, Wallet, Upload, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { SO_STATUS_COLOR } from '../page';
import { generateInvoicePDF, generateSOPDF, generateSuratJalanPDF } from '@/lib/pdf/invoice';
import { pkgLabel, pkgShort } from '@/lib/constants';

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
  const [confirmTarget, setConfirmTarget] = useState(null); // status transition dialog target
  const [invoiceBasis, setInvoiceBasis] = useState('shipped'); // 'shipped' | 'received'
  const [transitioning, setTransitioning] = useState(false);

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!so) return <div className="text-center py-20 text-muted-foreground">SO tidak ditemukan</div>;

  const currentStepIdx = STEPS.indexOf(so.pipelineStatus);
  const allowedNext = SO_FLOW[so.pipelineStatus] || [];

  const openTransition = (target) => {
    if (target === 'Invoiced') setInvoiceBasis('shipped');
    setConfirmTarget(target);
  };

  const doTransition = async () => {
    const target = confirmTarget;
    const body = { status: target };
    if (target === 'Invoiced') body.invoiceWeightBasis = invoiceBasis;
    setTransitioning(true);
    try {
      const res = await fetch(`/api/sales-orders/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (res.ok) {
        toast.success('Status: ' + target + (target === 'Invoiced' ? ` (basis: ${body.invoiceWeightBasis === 'received' ? 'berat diterima' : 'berat kirim'})` : ''));
        setConfirmTarget(null);
        mutate();
      } else {
        toast.error(j.error || 'Gagal mengubah status');
      }
    } catch (e) {
      toast.error(e.message || 'Gagal mengubah status');
    } finally {
      setTransitioning(false);
    }
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
            {so.fulfillmentType === 'dropship' && <Badge variant="secondary" className="bg-purple-100 text-purple-700">Dropship</Badge>}
            {so.invoiceNumber && <Badge variant="secondary" className="font-mono">{so.invoiceNumber}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm mt-1">{so.customer?.displayName} · {so.orderDate && format(new Date(so.orderDate), 'dd MMM yyyy')}</p>
          {so.fulfillmentType === 'dropship' && so.linkedPurchaseOrder && (
            <Link href={`/dashboard/purchase-orders/${so.linkedPurchaseOrder.id}`} className="inline-flex items-center gap-1.5 mt-1.5 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 transition">
              <Truck className="w-3.5 h-3.5" /> PO Dropship: {so.linkedPurchaseOrder.poNumber}
              <Badge variant="outline" className="ml-1 text-[10px] border-purple-300">{so.linkedPurchaseOrder.pipelineStatus}</Badge>
              <ArrowLeft className="w-3 h-3 rotate-180" />
            </Link>
          )}
        </div>
        {canEdit && allowedNext.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {allowedNext.map(a => (
              <Button key={a} size="sm" variant={a === 'Cancelled' ? 'destructive' : 'default'} data-testid={`so-status-btn-${a}`} onClick={() => openTransition(a)}>
                {a === 'Cancelled' ? <XCircle className="w-4 h-4 mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}{a}
              </Button>
            ))}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                const doc = generateSOPDF(so);
                doc.save(`SO-${so.soNumber}.pdf`);
                toast.success('PDF SO berhasil diunduh');
              } catch (e) {
                console.error('PDF SO error:', e);
                toast.error('Gagal membuat PDF SO: ' + (e.message || 'unknown'));
              }
            }}
          >
            <FileDown className="w-4 h-4 mr-1" /> PDF SO
          </Button>
          {(so.invoiceNumber || ['Shipped', 'Invoiced'].includes(so.pipelineStatus)) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  const doc = generateInvoicePDF(so, so.markupEnabled && Number(so.cashbackAmount) > 0 ? { variant: 'diup' } : {});
                  doc.save(`Invoice-${so.invoiceNumber || so.soNumber}.pdf`);
                  toast.success('PDF Faktur (Customer) berhasil diunduh');
                } catch (e) {
                  console.error('PDF Invoice error:', e);
                  toast.error('Gagal membuat PDF Invoice: ' + (e.message || 'unknown'));
                }
              }}
            >
              <FileDown className="w-4 h-4 mr-1" /> PDF Faktur (Customer)
            </Button>
          )}
          {so.markupEnabled && Number(so.cashbackAmount) > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
              onClick={() => {
                try {
                  const doc = generateInvoicePDF(so, { variant: 'asli' });
                  doc.save(`Faktur-Asli-${so.invoiceNumber || so.soNumber}.pdf`);
                  toast.success('PDF Faktur Asli/Internal berhasil diunduh');
                } catch (e) {
                  console.error('PDF Asli error:', e);
                  toast.error('Gagal membuat PDF Faktur Asli: ' + (e.message || 'unknown'));
                }
              }}
            >
              <FileDown className="w-4 h-4 mr-1" /> PDF Faktur Asli
            </Button>
          )}
        </div>
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <SumCard label="Total SO" value={`Rp ${Number(so.totalAmount).toLocaleString('id-ID')}`} sub={`Diskon Rp ${Number(so.discountTotal || 0).toLocaleString('id-ID')}`} />
        <SumCard label="Sudah Dibayar" value={`Rp ${Number(so.paidAmount).toLocaleString('id-ID')}`} sub={`Status: ${so.paymentStatus}`} color="emerald" />
        <SumCard label="Total Retur" value={`Rp ${Number(so.totalReturns || 0).toLocaleString('id-ID')}`} sub={`${so.returns?.length || 0} retur`} color="amber" />
        <SumCard
          label={Number(so.totalShrinkageWeight || 0) < -0.001 ? 'Surplus (Kelebihan)' : 'Penyusutan'}
          value={`${Math.abs(Number(so.totalShrinkageWeight || 0)).toFixed(2)} kg`}
          sub={`Rp ${Math.abs(Number(so.totalShrinkageValue || 0)).toLocaleString('id-ID')} · ${so.receipts?.length || 0} penerimaan`}
          color={Number(so.totalShrinkageWeight || 0) < -0.001 ? 'emerald' : (Number(so.totalShrinkageWeight || 0) > 0.001 ? 'amber' : 'slate')}
        />
        <SumCard label="Outstanding" value={`Rp ${Number(so.outstanding || 0).toLocaleString('id-ID')}`} sub={so.paymentTerm || '-'} color={so.outstanding > 0 ? 'red' : 'slate'} />
      </div>

      {so.fulfillmentType === 'dropship' && so.dropshipShipVsRecv && (
        <Card className="border-purple-200 bg-purple-50/40">
          <CardContent className="py-3">
            <div className="flex items-center flex-wrap gap-x-6 gap-y-1.5 text-sm">
              <div className="flex items-center gap-2 font-semibold text-purple-800"><TrendingDown className="w-4 h-4" />Susut Dropship (Kirim → Terima)</div>
              <div><span className="text-muted-foreground">Berat Kirim (SJ): </span><b>{Number(so.dropshipShipVsRecv.shipped).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg</b></div>
              <div><span className="text-muted-foreground">Berat Diterima Customer: </span><b>{Number(so.dropshipShipVsRecv.received).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg</b>{!so.dropshipShipVsRecv.hasReceipt && <span className="text-[11px] text-muted-foreground"> (belum ada penerimaan)</span>}</div>
              <div><span className="text-muted-foreground">Susut: </span><b className={so.dropshipShipVsRecv.susut > 0.0001 ? 'text-red-600' : 'text-emerald-700'}>{Number(so.dropshipShipVsRecv.susut).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg</b></div>
            </div>
          </CardContent>
        </Card>
      )}

      {Array.isArray(so.commissions) && so.commissions.length > 0 && (
        <Card className="border-pink-200 bg-pink-50/40">
          <CardContent className="py-3">
            {so.commissions.map((cm) => {
              const typeLabel = cm.commissionType === 'per_kg' ? 'Per Kg'
                : cm.commissionType === 'fixed' ? 'Nominal Tetap'
                : cm.commissionType === 'percent_profit' ? '% Profit Bersih' : (cm.commissionType || '-');
              const valLabel = cm.commissionType === 'percent_profit'
                ? `${Number(cm.commissionValue || 0)}%`
                : `Rp ${Number(cm.commissionValue || 0).toLocaleString('id-ID')}`;
              return (
                <div key={cm.id} className="flex items-center flex-wrap gap-x-6 gap-y-1.5 text-sm">
                  <div className="flex items-center gap-2 font-semibold text-pink-800"><Wallet className="w-4 h-4" />Komisi Dropshipper</div>
                  <div><span className="text-muted-foreground">Dropshipper: </span><b>{cm.dropshipper ? `${cm.dropshipper.code} · ${cm.dropshipper.displayName}` : '-'}</b></div>
                  <div><span className="text-muted-foreground">Tipe: </span><b>{typeLabel}</b> <span className="text-muted-foreground">({valLabel})</span></div>
                  <div><span className="text-muted-foreground">Komisi: </span><b className="text-pink-700">Rp {Number(cm.commissionAmount || 0).toLocaleString('id-ID')}</b></div>
                  <div>
                    <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium',
                      cm.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                      {cm.status === 'paid' ? 'Sudah Dibayar' : 'Belum Dibayar'}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <MarkupCard so={so} canEdit={canEdit} onSaved={mutate} />

      {so.markupEnabled && Number(so.cashbackAmount) > 0 && (
        <CashbackRefundCard so={so} canRefund={['admin', 'supervisor', 'direktur', 'akuntan'].includes(role)} onSaved={mutate} />
      )}

      <Tabs defaultValue="items">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-6">
          <TabsTrigger value="info"><Receipt className="w-4 h-4 mr-1" />Info</TabsTrigger>
          <TabsTrigger value="items"><Package className="w-4 h-4 mr-1" />Items</TabsTrigger>
          <TabsTrigger value="sj"><Truck className="w-4 h-4 mr-1" />Surat Jalan</TabsTrigger>
          <TabsTrigger value="receipts"><PackageCheck className="w-4 h-4 mr-1" />Penerimaan</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-1" />Payment</TabsTrigger>
          <TabsTrigger value="returns"><RotateCcw className="w-4 h-4 mr-1" />Retur</TabsTrigger>
        </TabsList>
        <TabsContent value="info"><InfoTab so={so} /></TabsContent>
        <TabsContent value="items"><ItemsTab so={so} onSaved={mutate} canEdit={canEdit} /></TabsContent>
        <TabsContent value="sj"><SjTab so={so} onSaved={mutate} canOperate={canOperate} /></TabsContent>
        <TabsContent value="receipts"><ReceiptsTab so={so} onSaved={mutate} canOperate={canOperate} /></TabsContent>
        <TabsContent value="payments"><PaymentsTab so={so} onSaved={mutate} canEdit={canEdit} /></TabsContent>
        <TabsContent value="returns"><ReturnsTab so={so} onSaved={mutate} canOperate={canOperate} /></TabsContent>
      </Tabs>

      {/* Konfirmasi perubahan status (menggantikan native confirm) */}
      <Dialog open={!!confirmTarget} onOpenChange={(o) => { if (!o && !transitioning) setConfirmTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmTarget === 'Cancelled' ? 'Batalkan SO?' : confirmTarget === 'Invoiced' ? 'Terbitkan Invoice' : `Ubah status ke "${confirmTarget}"?`}
            </DialogTitle>
            <DialogDescription>
              {confirmTarget === 'Confirmed' && 'Stok yang dialokasikan akan dikonsumsi (dipakai) + prepaid balance (jika subscriber) akan dipotong.'}
              {confirmTarget === 'Cancelled' && 'Stok yang teralokasi akan dilepas kembali menjadi aktif. Tindakan ini tidak dapat dibatalkan.'}
              {confirmTarget === 'Invoiced' && 'Pilih basis berat yang dipakai untuk menghitung nilai invoice.'}
              {['Packed', 'Shipped'].includes(confirmTarget) && `SO akan berpindah ke tahap ${confirmTarget}.`}
            </DialogDescription>
          </DialogHeader>

          {confirmTarget === 'Invoiced' && (
            <div className="space-y-2 py-1">
              {[
                { v: 'shipped', title: 'Berat Kirim (Surat Jalan)', desc: 'Nilai invoice mengikuti berat riil yang dikirim.' },
                { v: 'received', title: 'Berat Diterima (Penerimaan)', desc: 'Nilai invoice mengikuti berat yang diterima customer (setelah susut).' },
              ].map(opt => (
                <label key={opt.v} data-testid={`invoice-basis-${opt.v}`} className={cn('flex items-start gap-3 border rounded-lg p-3 cursor-pointer', invoiceBasis === opt.v ? 'border-emerald-500 bg-emerald-50/60' : 'hover:bg-slate-50')}>
                  <input type="radio" name="invoiceBasis" className="mt-1 accent-emerald-600" checked={invoiceBasis === opt.v} onChange={() => setInvoiceBasis(opt.v)} />
                  <div>
                    <div className="font-medium text-sm">{opt.title}</div>
                    <div className="text-xs text-muted-foreground">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} disabled={transitioning}>Batal</Button>
            <Button
              data-testid="so-status-confirm"
              variant={confirmTarget === 'Cancelled' ? 'destructive' : 'default'}
              onClick={doTransition}
              disabled={transitioning}
              className={confirmTarget !== 'Cancelled' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              {transitioning && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {confirmTarget === 'Cancelled' ? 'Ya, Batalkan' : confirmTarget === 'Invoiced' ? 'Terbitkan Invoice' : 'Ya, Lanjutkan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const effW = (it) => (Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || it.quantity || 0));

function MarkupCard({ so, canEdit, onSaved }) {
  const items = so.items || [];
  const [enabled, setEnabled] = useState(!!so.markupEnabled);
  const [markup, setMarkup] = useState(() => {
    const m = {};
    for (const it of items) m[it.id] = Number(it.markupUnitPrice) > 0 ? Number(it.markupUnitPrice) : Number(it.unitPrice || 0);
    return m;
  });
  const [recipient, setRecipient] = useState(so.cashbackRecipient || '');
  const [cashAccount, setCashAccount] = useState(so.cashbackAccount || '');
  const [saving, setSaving] = useState(false);

  const { data: accData } = useSWR(canEdit ? '/api/cash-bank-accounts' : null, fetcher);
  const cashAccounts = accData?.data || [];

  // Non-editor: ringkas
  if (!canEdit) {
    if (!so.markupEnabled) return null;
    const diup = Number(so.totalAmount) + Number(so.cashbackAmount || 0);
    return (
      <Card className="border-rose-200 bg-rose-50/40">
        <CardContent className="py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="flex items-center gap-2 font-semibold text-rose-800"><Calculator className="w-4 h-4" />Faktur di-up (Cashback)</div>
          <div><span className="text-muted-foreground">Harga Jual Asli: </span><b>{rp(so.totalAmount)}</b></div>
          <div><span className="text-muted-foreground">Faktur di-up: </span><b>{rp(diup)}</b></div>
          <div><span className="text-muted-foreground">Cashback dikembalikan: </span><b className="text-rose-700">{rp(so.cashbackAmount)}</b></div>
          {so.cashbackRecipient && <div><span className="text-muted-foreground">PIC: </span><b>{so.cashbackRecipient}</b></div>}
        </CardContent>
      </Card>
    );
  }

  const totalReal = items.reduce((a, it) => a + Number(it.subtotal || 0), 0); // = so.totalAmount (harga asli)
  const totalCashback = Math.round(items.reduce((a, it) => {
    const real = Number(it.unitPrice || 0);
    const mk = Math.max(Number(markup[it.id] || 0), real);
    const ratio = real > 0 ? mk / real : 1;
    return a + Number(it.subtotal || 0) * (ratio - 1);
  }, 0));
  const totalDiup = totalReal + totalCashback;

  const save = async () => {
    if (enabled) {
      for (const it of items) {
        const mk = Number(markup[it.id] || 0);
        if (mk + 0.001 < Number(it.unitPrice || 0)) return toast.error(`Harga markup "${it.product?.name || 'item'}" lebih rendah dari harga jual asli`);
      }
      if (!(totalCashback > 0)) return toast.error('Belum ada markup — naikkan harga markup minimal pada satu item');
    }
    setSaving(true);
    try {
      const payload = {
        markupEnabled: enabled,
        items: items.map(it => ({ itemId: it.id, markupUnitPrice: Number(markup[it.id] || 0) })),
        cashbackRecipient: recipient,
        cashbackAccount: cashAccount || null,
      };
      const res = await fetch(`/api/sales-orders/${so.id}/markup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      toast.success(enabled ? 'Faktur di-up & cashback disimpan' : 'Faktur di-up dinonaktifkan');
      onSaved && onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card className="border-rose-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4 text-rose-600" />Faktur di-up &amp; Cashback <span className="text-xs font-normal text-muted-foreground">(opsional · per item)</span></CardTitle>
            <CardDescription className="text-xs">Harga di SO = harga jual asli. Isi harga markup (di-up) per item di sini. Customer transfer penuh nilai di-up, lalu selisih (cashback) dikembalikan dari kas/bank. Cashback/kg = harga markup − harga asli.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Aktifkan</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </CardHeader>
      {enabled && (
        <CardContent className="space-y-4">
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Berat (kg)</TableHead>
                <TableHead className="text-right">Harga Jual Asli/kg</TableHead>
                <TableHead className="text-right w-44">Harga Markup/kg</TableHead>
                <TableHead className="text-right">Cashback/kg</TableHead>
                <TableHead className="text-right">Cashback Baris</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {items.map(it => {
                  const w = effW(it);
                  const real = Number(it.unitPrice || 0);
                  const mk = Number(markup[it.id] || 0);
                  const cbKg = Math.max(0, Math.max(mk, real) - real);
                  const ratio = real > 0 ? Math.max(mk, real) / real : 1;
                  const cbLine = Math.max(0, Math.round(Number(it.subtotal || 0) * (ratio - 1)));
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="text-sm">{it.product?.name || '-'}<div className="text-[11px] text-muted-foreground">{it.product?.sku}</div></TableCell>
                      <TableCell className="text-right text-sm">{w.toLocaleString('id-ID')}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{rp(real)}</TableCell>
                      <TableCell className="text-right">
                        <CurrencyInput value={mk} onChange={(v) => setMarkup(prev => ({ ...prev, [it.id]: v }))} className="text-right" />
                      </TableCell>
                      <TableCell className="text-right text-sm text-rose-600">{rp(cbKg)}</TableCell>
                      <TableCell className="text-right text-sm font-medium text-rose-700">{rp(cbLine)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Dikembalikan dari (Kas/Bank)</Label>
              <Select value={cashAccount} onValueChange={setCashAccount}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Default: Bank" /></SelectTrigger>
                <SelectContent>{cashAccounts.map(a => <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Penerima Cashback / PIC (opsional)</Label>
              <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="mis. Bpk. Budi (Purchasing)" className="mt-1" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm bg-rose-50/60 border border-rose-100 rounded-md px-3 py-2">
            <div><span className="text-muted-foreground">Harga jual asli (bersih diterima): </span><b className="text-emerald-700">{rp(totalReal)}</b></div>
            <div><span className="text-muted-foreground">Faktur di-up (ditransfer customer): </span><b>{rp(totalDiup)}</b></div>
            <div><span className="text-muted-foreground">Cashback dikembalikan: </span><b className="text-rose-700">{rp(totalCashback)}</b></div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Receipt className="w-4 h-4 mr-1" />}Simpan</Button>
          </div>
        </CardContent>
      )}
      {!enabled && (so.markupEnabled) && (
        <CardContent className="pt-0"><div className="flex justify-end"><Button size="sm" variant="destructive" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Nonaktifkan &amp; Simpan</Button></div></CardContent>
      )}
    </Card>
  );
}

function CashbackRefundCard({ so, canRefund, onSaved }) {
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const [refundedAt, setRefundedAt] = useState(so.cashbackRefundedAt || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(so.cashbackRefundNote || '');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const refunded = !!so.cashbackRefunded;

  const submit = async () => {
    if (file && file.size > 10 * 1024 * 1024) return toast.error('Ukuran bukti maksimal 10MB');
    setSaving(true);
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      fd.append('refundedAt', refundedAt);
      fd.append('note', note || '');
      const res = await fetch(`/api/sales-orders/${so.id}/cashback-refund`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Pengembalian cashback dicatat');
      setFile(null);
      const el = document.getElementById('cb-proof-input'); if (el) el.value = '';
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const undo = async () => {
    if (!confirm('Batalkan tanda pengembalian cashback & hapus bukti?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-orders/${so.id}/cashback-refund`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Gagal'); }
      toast.success('Tanda pengembalian dibatalkan'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card className={refunded ? 'border-emerald-200' : 'border-amber-200'}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="w-4 h-4 text-rose-600" />Pengembalian Cashback
          {refunded
            ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Sudah dikembalikan</span>
            : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Belum dikembalikan</span>}
        </CardTitle>
        <CardDescription className="text-xs">
          Cashback <b>{rp(so.cashbackAmount)}</b>{so.cashbackRecipient ? ` untuk ${so.cashbackRecipient}` : ''}. Catat bukti transfer nyata ke PIC di sini (operasional — jurnal akuntansi cashback sudah otomatis saat faktur terbit).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {refunded && (
          <div className="text-sm bg-emerald-50/70 border border-emerald-100 rounded-md px-3 py-2 space-y-1">
            <div>Tanggal transfer: <b>{so.cashbackRefundedAt || '-'}</b></div>
            {so.cashbackRefundNote && <div>Catatan: <b>{so.cashbackRefundNote}</b></div>}
            {so.cashbackRefundedBy && <div className="text-xs text-muted-foreground">Ditandai oleh: {so.cashbackRefundedBy}</div>}
            {so.cashbackProofKey && (
              <a href={`/api/sales-orders/${so.id}/cashback-proof`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-medium mt-1">
                <Eye className="w-3.5 h-3.5" /> Lihat Bukti ({so.cashbackProofName || 'file'})
              </a>
            )}
          </div>
        )}
        {canRefund && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tanggal Transfer</Label>
                <Input type="date" value={refundedAt} onChange={e => setRefundedAt(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Bukti Transfer (PDF/JPG/PNG, maks 10MB)</Label>
                <Input id="cb-proof-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setFile(e.target.files?.[0] || null)} className="mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Catatan (opsional)</Label>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="mis. Transfer BCA a.n. Budi" className="mt-1" />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : (refunded ? <Upload className="w-4 h-4 mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />)}
                {refunded ? 'Perbarui Bukti' : 'Tandai Sudah Dikembalikan'}
              </Button>
              {refunded && <Button size="sm" variant="ghost" className="text-red-500" onClick={undo} disabled={saving}>Batalkan</Button>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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

function ItemsTab({ so, onSaved, canEdit }) {
  const canAllocate = canEdit && so.pipelineStatus === 'Draft' && so.fulfillmentType !== 'dropship';
  const canEditItems = canEdit && so.pipelineStatus === 'Draft';
  const [allocFor, setAllocFor] = useState(null); // item being allocated
  const [editOpen, setEditOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Items SO</CardTitle>
          {canAllocate && <CardDescription>Pilih kode simpan (bisa banyak) untuk tiap item. Berat &amp; subtotal otomatis mengikuti kode simpan terpilih.</CardDescription>}
        </div>
        <div className="flex items-center gap-2">
          {canEditItems && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="h-8">
              <Pencil className="w-3.5 h-3.5 mr-1" />Edit Item
            </Button>
          )}
          {so.pipelineStatus === 'Draft' && so.fulfillmentType !== 'dropship' && (
            <Badge variant={so.allAllocated ? 'default' : 'secondary'} className={so.allAllocated ? 'bg-emerald-600' : ''}>
              {so.allAllocated ? 'Semua teralokasi' : 'Perlu alokasi kode simpan'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Produk / Kode Simpan</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Berat</TableHead><TableHead className="text-right">Harga</TableHead><TableHead className="text-right">HPP/kg</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow></TableHeader>
          <TableBody>
            {so.items?.map(it => (
              <TableRow key={it.id}>
                <TableCell>
                  <div className="font-medium">{it.product?.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{it.product?.sku}</div>
                  {(it.allocations || []).length > 0 && (
                    <div className="text-xs mt-1 flex items-center gap-1.5 flex-wrap">
                      {it.allocations.map(al => (
                        <Badge key={al.id} variant="outline" className="font-mono text-[10px] bg-emerald-50 border-emerald-200 text-emerald-700">
                          {al.kodeSimpan} · {Number(al.weight).toFixed(1)}kg
                        </Badge>
                      ))}
                    </div>
                  )}
                  {canAllocate && (
                    <Button size="sm" variant="outline" onClick={() => setAllocFor(it)} className="h-7 mt-1.5 text-xs">
                      <Package className="w-3 h-3 mr-1" />{(it.allocations || []).length > 0 ? 'Ubah Kode Simpan' : 'Pilih Kode Simpan'}
                    </Button>
                  )}
                </TableCell>
                <TableCell className="text-right">{it.quantity} {pkgShort(it.product?.packagingType)}</TableCell>
                <TableCell className="text-right">{Number(it.weight).toFixed(1)} kg</TableCell>
                <TableCell className="text-right">Rp {Number(it.unitPrice).toLocaleString('id-ID')}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{it.hppAvgPerKg > 0 ? `Rp ${Number(it.hppAvgPerKg).toLocaleString('id-ID')}` : '-'}</TableCell>
                <TableCell className="text-right font-semibold">Rp {Number(it.subtotal).toLocaleString('id-ID')}</TableCell>
              </TableRow>
            ))}
            {(so.shippingBearer === 'buyer' && Number(so.shippingCost || 0) > 0) && (
              <>
                <TableRow>
                  <TableCell colSpan={5} className="text-right text-sm text-muted-foreground">Subtotal Barang</TableCell>
                  <TableCell className="text-right text-sm">Rp {Number(Number(so.totalAmount) - Number(so.shippingCost || 0)).toLocaleString('id-ID')}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} className="text-right text-sm text-muted-foreground">Biaya Kirim (ditagih ke pembeli)</TableCell>
                  <TableCell className="text-right text-sm">Rp {Number(so.shippingCost || 0).toLocaleString('id-ID')}</TableCell>
                </TableRow>
              </>
            )}
            <TableRow className="bg-slate-50">
              <TableCell colSpan={5} className="text-right font-semibold">Total</TableCell>
              <TableCell className="text-right font-bold text-emerald-700">Rp {Number(so.totalAmount).toLocaleString('id-ID')}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
      {allocFor && (
        <AllocateDialog so={so} item={allocFor} onClose={() => setAllocFor(null)} onSaved={() => { setAllocFor(null); onSaved(); }} />
      )}
      {editOpen && (
        <EditItemsDialog so={so} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); onSaved(); }} />
      )}
    </Card>
  );
}

function EditItemsDialog({ so, onClose, onSaved }) {
  const { data: prodData } = useSWR('/api/products', fetcher);
  const products = prodData?.data || [];
  const [rows, setRows] = useState(() => (so.items || []).map(it => ({
    productId: it.productId,
    quantity: Number(it.quantity || 0),
    weight: Number(it.weight || 0),
    unitPrice: Number(it.unitPrice || 0),
    discount: Number(it.discount || 0),
  })));
  const [saving, setSaving] = useState(false);
  const upd = (i, k, v) => { const arr = [...rows]; arr[i] = { ...arr[i], [k]: v }; setRows(arr); };
  const add = () => setRows([...rows, { productId: '', quantity: 1, weight: 0, unitPrice: 0, discount: 0 }]);
  const remove = (i) => setRows(rows.filter((_, idx) => idx !== i));
  const lineSubtotal = (r) => Number(r.unitPrice || 0) * Number(r.weight || r.quantity || 0) - Number(r.discount || 0);
  const total = rows.reduce((a, r) => a + lineSubtotal(r), 0);
  const hadAllocations = (so.items || []).some(it => (it.allocations || []).length > 0);
  const save = async () => {
    if (rows.length === 0) { toast.error('Minimal 1 item'); return; }
    for (const r of rows) { if (!r.productId) { toast.error('Setiap item wajib memiliki produk'); return; } }
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-orders/${so.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: rows.map(r => ({
          productId: r.productId,
          quantity: Number(r.quantity || 0),
          weight: Number(r.weight || 0),
          unitPrice: Number(r.unitPrice || 0),
          discount: Number(r.discount || 0),
        })) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      toast.success('Item SO diperbarui');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit Item SO — {so.soNumber}</DialogTitle>
          <DialogDescription>
            Ubah produk, qty, berat, harga, dan diskon selama status Draft.
            {hadAllocations && <span className="text-amber-600"> Perhatian: menyimpan akan menghapus alokasi kode simpan — alokasikan ulang setelah simpan.</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end border-b pb-2">
              <div className="col-span-4">
                <Label className="text-xs">Produk</Label>
                <Select value={r.productId} onValueChange={v => upd(i, 'productId', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1"><Label className="text-xs">Qty</Label><Input type="number" value={r.quantity} onChange={e => upd(i, 'quantity', Number(e.target.value))} className="h-9" /></div>
              <div className="col-span-2"><Label className="text-xs">Berat (kg)</Label><WeightInput value={r.weight} onChange={v => upd(i, 'weight', v)} placeholder="0" /></div>
              <div className="col-span-2"><Label className="text-xs">Harga/kg</Label><CurrencyInput value={r.unitPrice} onChange={v => upd(i, 'unitPrice', v)} placeholder="0" /></div>
              <div className="col-span-2"><Label className="text-xs">Diskon</Label><CurrencyInput value={r.discount} onChange={v => upd(i, 'discount', v)} placeholder="0" /></div>
              <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button></div>
              <div className="col-span-12 text-right text-xs text-muted-foreground">Subtotal: Rp {Number(lineSubtotal(r)).toLocaleString('id-ID')}</div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={add}><Plus className="w-4 h-4 mr-1" />Tambah Item</Button>
        </div>
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-sm text-muted-foreground">Total Barang</span>
          <span className="font-bold text-emerald-700">Rp {Number(total).toLocaleString('id-ID')}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan Item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllocateDialog({ so, item, onClose, onSaved }) {
  const [stocks, setStocks] = useState(null);
  const [selected, setSelected] = useState(() => new Set((item.allocations || []).map(a => a.stockId)));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sales-orders/${so.id}/available-stocks?productId=${item.productId}`, { credentials: 'include' });
        const j = await res.json();
        // gabung stok yang sudah teralokasi ke item ini (agar tetap tampil & tercentang)
        const avail = res.ok ? (j.data || []) : [];
        const allocated = (item.allocations || []).filter(a => !avail.find(s => s.id === a.stockId))
          .map(a => ({ id: a.stockId, kodeSimpan: a.kodeSimpan, weight: a.weight, quantity: a.quantity, hppPerKg: a.hppPerKg, stockValue: Math.round(a.hppPerKg * a.weight), csCode: null, _current: true }));
        setStocks([...allocated, ...avail]);
      } catch { setStocks([]); }
    })();
  }, [so.id, item.productId]);
  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const list = stocks || [];
  const chosen = list.filter(s => selected.has(s.id));
  const totalW = chosen.reduce((a, b) => a + Number(b.weight || 0), 0);
  const totalQ = chosen.reduce((a, b) => a + Number(b.quantity || 0), 0);
  const totalCogs = chosen.reduce((a, b) => a + Number(b.hppPerKg || 0) * Number(b.weight || 0), 0);
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/sales-orders/${so.id}/items/${item.id}/allocate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockIds: Array.from(selected) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Alokasi tersimpan: ${chosen.length} kode simpan · ${totalW.toFixed(1)} kg`);
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Package className="w-5 h-5" /> Pilih Kode Simpan — {item.product?.name}</DialogTitle>
          <DialogDescription>Centang kode simpan yang akan dikirim untuk item ini (bisa lebih dari satu). Berat &amp; subtotal SO otomatis direvisi.</DialogDescription>
        </DialogHeader>
        {stocks === null ? (
          <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Memuat stok…</div>
        ) : list.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">Tidak ada kode simpan aktif untuk produk ini.</div>
        ) : (
          <div className="space-y-2">
            {list.map(st => {
              const on = selected.has(st.id);
              return (
                <label key={st.id} className={`flex items-center gap-3 border rounded-lg p-2.5 cursor-pointer ${on ? 'border-emerald-500 bg-emerald-50/60' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(st.id)} className="w-4 h-4 accent-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-semibold text-sm">{st.kodeSimpan}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {Number(st.weight).toFixed(1)} kg · {pkgLabel(st.packagingType)} × {Number(st.quantity)}
                      {st.csCode && ` · ${st.csCode}`}
                      {st.expiredDate && ` · Exp ${format(new Date(st.expiredDate), 'dd MMM yy')}`}
                    </div>
                  </div>
                  <div className="text-right text-[11px]">
                    <div className="text-muted-foreground">HPP/kg</div>
                    <div className="font-semibold">Rp {Number(st.hppPerKg || 0).toLocaleString('id-ID')}</div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <div className="border-t pt-2 text-sm flex items-center justify-between">
          <span className="text-muted-foreground">Terpilih: <b>{chosen.length}</b> · <b>{totalW.toFixed(1)}</b> kg · HPP <b>Rp {Math.round(totalCogs).toLocaleString('id-ID')}</b></span>
          <Button size="sm" onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Simpan Alokasi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SjTab({ so, onSaved, canOperate }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ deliveryDate: new Date().toISOString().slice(0,10), driverName: '', vehicleNumber: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [shipMode, setShipMode] = useState('default');
  const [shipManual, setShipManual] = useState({ shipToName: '', shipToPhone: '', shipToAddress: '' });
  const [showReceived, setShowReceived] = useState(false);
  const [itemWeights, setItemWeights] = useState({}); // itemId -> berat kirim riil
  const { data: ccData } = useSWR(so.customerId ? `/api/contacts/${so.customerId}/customers` : null, fetcher);
  const endCustomers = ccData?.data || [];
  const openDialog = (o) => {
    if (o) {
      const init = {}; (so.items || []).forEach(it => { init[it.id] = it.shippedWeight || it.weight || 0; });
      setItemWeights(init);
    }
    setOpen(o);
  };
  const create = async () => {
    setSaving(true);
    try {
      let payload = { ...form, showReceivedColumn: showReceived, items: (so.items || []).map(it => ({ itemId: it.id, shippedWeight: Number(itemWeights[it.id] || 0) })) };
      if (shipMode === 'manual') payload = { ...payload, ...shipManual };
      else if (shipMode !== 'default') payload = { ...payload, shipToCustomerId: shipMode };
      const res = await fetch(`/api/sales-orders/${so.id}/surat-jalan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Surat Jalan ' + j.data.sjNumber + ' dibuat');
      setOpen(false); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      <ShippingCostCard so={so} onSaved={onSaved} canEdit={canOperate} />
      <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Surat Jalan (Delivery Order)</CardTitle><CardDescription>Dokumen pengiriman barang ke customer</CardDescription></div>
        {canOperate && ['Packed', 'Shipped', 'Invoiced'].includes(so.pipelineStatus) && (
          <Dialog open={open} onOpenChange={openDialog}>
            <DialogTrigger asChild><Button size="sm"><Truck className="w-4 h-4 mr-1" />Buat Surat Jalan</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Buat Surat Jalan</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <F label="Tanggal Kirim"><Input type="date" value={form.deliveryDate} onChange={e => setForm({ ...form, deliveryDate: e.target.value })} /></F>
                <F label="Nama Sopir"><Input value={form.driverName} onChange={e => setForm({ ...form, driverName: e.target.value })} /></F>
                <F label="No Kendaraan" className="col-span-2"><Input value={form.vehicleNumber} onChange={e => setForm({ ...form, vehicleNumber: e.target.value })} placeholder="B 1234 XYZ" /></F>
                <F label="Tujuan Pengiriman" className="col-span-2">
                  <Select value={shipMode} onValueChange={setShipMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Alamat {so.customer?.displayName || 'Pembeli'} (default)</SelectItem>
                      {endCustomers.map(cc => <SelectItem key={cc.id} value={cc.id}>{cc.name}{cc.city ? ` · ${cc.city}` : ''}</SelectItem>)}
                      <SelectItem value="manual">Alamat manual…</SelectItem>
                    </SelectContent>
                  </Select>
                </F>
                {shipMode === 'manual' && (
                  <>
                    <F label="Nama Penerima"><Input value={shipManual.shipToName} onChange={e => setShipManual({ ...shipManual, shipToName: e.target.value })} /></F>
                    <F label="Telepon"><Input value={shipManual.shipToPhone} onChange={e => setShipManual({ ...shipManual, shipToPhone: e.target.value })} /></F>
                    <F label="Alamat" className="col-span-2"><Textarea rows={2} value={shipManual.shipToAddress} onChange={e => setShipManual({ ...shipManual, shipToAddress: e.target.value })} /></F>
                  </>
                )}
                <div className="col-span-2 border rounded-lg p-2">
                  <div className="text-xs font-semibold mb-1">Berat Kirim RIIL per item (hari-H)</div>
                  <div className="space-y-1">
                    {(so.items || []).map(it => (
                      <div key={it.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">{it.product?.name || it.productId} <span className="text-xs text-muted-foreground">(SO: {it.weight}kg)</span></span>
                        <WeightInput className="h-8 w-28" value={itemWeights[it.id] ?? ''} onChange={v => setItemWeights(w => ({ ...w, [it.id]: v }))} placeholder="kg riil" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <Switch checked={showReceived} onCheckedChange={setShowReceived} />
                  <span className="text-sm">Tampilkan kolom "Berat Diterima" di Surat Jalan (kosong untuk ttd penerima)</span>
                </div>
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
              <div key={sj.id} className="p-3 flex items-center justify-between text-sm gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-semibold">{sj.sjNumber}</div>
                  <div className="text-xs text-muted-foreground">{format(new Date(sj.deliveryDate), 'dd MMM yyyy')} · {sj.driverName || '-'} · {sj.vehicleNumber || '-'}</div>
                  {sj.shipToName && <div className="text-xs text-teal-700 mt-0.5">Kirim ke: {sj.shipToName}{sj.shipToAddress ? ` · ${sj.shipToAddress}` : ''}</div>}
                </div>
                <Badge>{sj.status}</Badge>
                {(() => {
                  const mapsUrl = sj.shipToCustomerId
                    ? (endCustomers.find(c => c.id === sj.shipToCustomerId)?.mapsUrl || null)
                    : (so.customer?.mapsUrl || null);
                  const buildDoc = () => generateSuratJalanPDF({ ...sj, mapsUrl }, so);
                  return (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => {
                        try { const url = buildDoc().output('bloburl'); window.open(url, '_blank'); }
                        catch (e) { console.error('View SJ error:', e); toast.error('Gagal menampilkan SJ: ' + (e.message || 'unknown')); }
                      }}>
                        <Eye className="w-4 h-4 mr-1" /> Lihat
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        try { buildDoc().save(`SJ-${sj.sjNumber}.pdf`); toast.success('PDF Surat Jalan berhasil diunduh'); }
                        catch (e) { console.error('PDF SJ error:', e); toast.error('Gagal PDF SJ: ' + (e.message || 'unknown')); }
                      }}>
                        <FileDown className="w-4 h-4 mr-1" /> PDF
                      </Button>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>}
      </CardContent>
    </Card>
    </div>
  );
}

function ShippingCostCard({ so, onSaved, canEdit }) {
  const [cost, setCost] = useState(String(so.shippingCost || 0));
  const [bearer, setBearer] = useState(so.shippingBearer || 'seller');
  const [accountCode, setAccountCode] = useState(so.shippingAccountCode || '');
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  useEffect(() => {
    fetch('/api/cash-bank-accounts', { credentials: 'include' })
      .then(r => r.json())
      .then(j => setAccounts(j.data || []))
      .catch(() => {});
  }, []);
  const save = async () => {
    if (Number(cost || 0) > 0 && !accountCode) return toast.error('Pilih rekening Kas/Bank sumber pembayaran ongkir');
    setSaving(true);
    try {
      // Turunkan metode legacy (tunai/transfer) dari akun yang dipilih untuk fallback & tampilan.
      const selName = (accounts.find(a => a.code === accountCode)?.name || '').toLowerCase();
      const payMethod = (selName.startsWith('kas') || accountCode === '1-1110') ? 'tunai' : 'transfer';
      const res = await fetch(`/api/sales-orders/${so.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shippingCost: Number(cost || 0), shippingBearer: bearer, shippingPayMethod: payMethod, shippingAccountCode: accountCode || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Biaya kirim disimpan');
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4" />Biaya Pengiriman</CardTitle>
        <CardDescription>Biaya kirim yang perusahaan bayar ke kurir. <b>Pembeli</b> → ditambahkan ke total invoice (pelanggan membayar). <b>Penjual</b> → mengurangi laba (Beban Ongkir). Jurnal otomatis: Beban Pengiriman didebit, rekening yang dipilih dikredit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Biaya Kirim (Rp)</Label>
            <CurrencyInput value={cost} onChange={v => setCost(v)} disabled={!canEdit} className="mt-1" placeholder="0" />
          </div>
          <div>
            <Label className="text-xs">Ditanggung</Label>
            <Select value={bearer} onValueChange={setBearer} disabled={!canEdit}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="seller">Penjual (kita) — kurangi laba</SelectItem>
                <SelectItem value="buyer">Pembeli — ditagih di invoice</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Dibayar dari (Kas/Bank)</Label>
            <Select value={accountCode} onValueChange={setAccountCode} disabled={!canEdit}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih rekening" /></SelectTrigger>
              <SelectContent>
                {accounts.map(a => (
                  <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-muted-foreground">
            {bearer === 'seller'
              ? <>Efek ke laba: <b className="text-red-600">-{rp(cost)}</b></>
              : <>Ditambah ke invoice: <b className="text-emerald-700">+{rp(cost)}</b> (laba netral)</>}
          </span>
          {canEdit && <Button size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Simpan Biaya Kirim</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentsTab({ so, onSaved, canEdit }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: 0, method: 'Transfer', accountCode: '', reference: '', isDp: false, paymentDate: new Date().toISOString().slice(0,10), notes: '' });
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && accounts.length === 0) {
      fetch('/api/cash-bank-accounts', { credentials: 'include' }).then(r => r.json()).then(j => setAccounts(j.data || [])).catch(() => {});
    }
  }, [open]);
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
    <div className="space-y-3">
      <GrossProfitCard so={so} />
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
                <F label="Nominal (Rp)" className="col-span-2">
                  <div className="flex gap-2">
                    <CurrencyInput value={form.amount} onChange={v => setForm({ ...form, amount: v })} placeholder="0" />
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, amount: Number(so.outstanding || 0) })}>Lunas</Button>
                  </div>
                </F>
                <F label="Dibayar ke Rekening" className="col-span-2">
                  <Select value={form.accountCode || undefined} onValueChange={v => setForm({ ...form, accountCode: v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih Kas/Bank penerima" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map(a => <SelectItem key={a.code} value={a.code}>{a.code} · {a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </F>
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
    </div>
  );
}

function GrossProfitCard({ so }) {
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  const grossRev = Number(so.revenue ?? so.totalAmount ?? 0);
  const buyerShip = Number(so.buyerShipping || 0);
  const revenue = grossRev - buyerShip; // penjualan barang (ongkir pembeli bersifat pass-through/netral)
  const cashback = (so.markupEnabled && Number(so.cashbackAmount) > 0) ? Number(so.cashbackAmount) : 0;
  const cogs = Number(so.cogsTotal || 0);
  const shipping = Number(so.sellerShipping || 0);
  const gp = Number(so.grossProfit ?? (revenue - cashback - cogs - shipping));
  const netRev = revenue - cashback;
  const margin = Number(so.grossMarginPct ?? (netRev > 0 ? Math.round((gp / netRev) * 1000) / 10 : 0));
  const bearer = so.shippingBearer === 'buyer' ? 'Pembeli' : 'Penjual';
  const isDrop = so.fulfillmentType === 'dropship';
  return (
    <Card className="border-emerald-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4 text-emerald-600" />Gross Profit {so.invoiceNumber ? `· ${so.invoiceNumber}` : '(estimasi)'}</CardTitle>
        <CardDescription>Laba kotor = Penjualan{cashback > 0 ? ' − Cashback' : ''} − HPP ({isDrop ? 'HPP PO Dropship' : 'kode simpan terpilih'}) − Biaya kirim (bila ditanggung penjual)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`grid grid-cols-2 gap-3 text-sm ${cashback > 0 ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
          <div><div className="text-xs text-muted-foreground">Penjualan{cashback > 0 ? ' (di-up)' : ''}</div><div className="font-semibold">{rp(revenue)}</div></div>
          {cashback > 0 && <div><div className="text-xs text-muted-foreground">Cashback</div><div className="font-semibold text-red-600">-{rp(cashback)}</div></div>}
          <div><div className="text-xs text-muted-foreground">HPP (COGS){isDrop && so.linkedPurchaseOrder ? ` · ${so.linkedPurchaseOrder.poNumber}` : ''}</div><div className="font-semibold text-red-600">-{rp(cogs)}</div></div>
          <div><div className="text-xs text-muted-foreground">Biaya Kirim ({bearer})</div><div className={`font-semibold ${so.shippingBearer === 'buyer' ? 'text-emerald-700' : 'text-red-600'}`}>{so.shippingBearer === 'buyer' ? (buyerShip > 0 ? '+' + rp(buyerShip) + ' · netral' : rp(0)) : (shipping > 0 ? '-' + rp(shipping) : rp(0))}</div></div>
          <div><div className="text-xs text-muted-foreground">Gross Profit</div><div className={`font-bold ${gp >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{rp(gp)}</div></div>
          <div><div className="text-xs text-muted-foreground">Margin</div><div className={`font-bold ${gp >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{margin}%</div></div>
        </div>
        {cogs === 0 && <div className="text-[11px] text-amber-600 mt-2">{isDrop ? 'HPP belum tersedia — pastikan PO Dropship sudah punya berat GRN/Surat Jalan.' : 'HPP belum tersedia — pastikan kode simpan sudah dialokasikan pada tab Items.'}</div>}
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

function ReceiptsTab({ so, onSaved, canOperate }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyToInvoice, setApplyToInvoice] = useState(false);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]); // [{productId, productName, sku, unit, orderedWeight, avgUnitPrice, receivedWeight}]

  // On dialog open, aggregate SO items by product
  useEffect(() => {
    if (open) {
      const map = {};
      for (const it of (so.items || [])) {
        const pid = it.productId;
        if (!map[pid]) map[pid] = {
          productId: pid,
          productName: it.product?.name || 'Unknown',
          sku: it.product?.sku || '',
          unit: it.product?.unit || 'kg',
          orderedWeight: 0,
          totalValue: 0,
        };
        const effW = Number(it.shippedWeight || 0) > 0 ? Number(it.shippedWeight) : Number(it.weight || 0);
        map[pid].orderedWeight += effW;
        map[pid].totalValue += effW * Number(it.unitPrice || 0);
      }
      const arr = Object.values(map).map(m => ({
        ...m,
        avgUnitPrice: m.orderedWeight > 0 ? m.totalValue / m.orderedWeight : 0,
        receivedWeight: m.orderedWeight, // default: full received
      }));
      setItems(arr);
      setReceivedDate(new Date().toISOString().slice(0, 10));
      setReceivedBy('');
      setNotes('');
      setApplyToInvoice(false);
    }
  }, [open, so]);

  const updItem = (idx, patch) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const totals = items.reduce((acc, it) => {
    const diffW = it.orderedWeight - Number(it.receivedWeight || 0); // + = susut, - = kelebihan
    const diffV = diffW * it.avgUnitPrice;
    acc.ordered += it.orderedWeight;
    acc.received += Number(it.receivedWeight || 0);
    acc.shrinkageW += diffW;
    acc.shrinkageV += diffV;
    return acc;
  }, { ordered: 0, received: 0, shrinkageW: 0, shrinkageV: 0 });

  const totalShrinkagePct = totals.ordered > 0 ? (totals.shrinkageW / totals.ordered) * 100 : 0;
  const isNetSurplus = totals.shrinkageV < -0.001;

  const submit = async () => {
    if (items.length === 0) return toast.error('Tidak ada produk untuk diterima');
    for (const it of items) {
      if (it.orderedWeight > 0 && Number(it.receivedWeight || 0) > it.orderedWeight * 2 + 0.0001) {
        return toast.error(`Berat diterima tidak wajar (> 2x kirim) pada ${it.productName}. Periksa kembali.`);
      }
    }
    setSaving(true);
    try {
      const body = {
        receivedDate,
        receivedBy,
        notes,
        applyToInvoice,
        items: items.map(it => ({
          productId: it.productId,
          receivedWeight: Number(it.receivedWeight || 0),
          notes: it.notes || undefined,
        })),
      };
      const res = await fetch(`/api/sales-orders/${so.id}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      const sw = Number(j.data.totalShrinkageWeight || 0);
      const lbl = sw < -0.001 ? `kelebihan ${(-sw).toFixed(2)} kg` : `susut ${sw.toFixed(2)} kg`;
      toast.success(`Penerimaan tercatat: ${j.data.receiptNumber} (${lbl})`);
      setOpen(false);
      onSaved?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (receiptId) => {
    if (!confirm('Hapus penerimaan ini?')) return;
    try {
      const res = await fetch(`/api/sales-orders/${so.id}/receipts/${receiptId}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Penerimaan dihapus');
      onSaved?.();
    } catch (e) { toast.error(e.message); }
  };

  const shipped = ['Shipped', 'Invoiced'].includes(so.pipelineStatus);
  const receipts = so.receipts || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="w-4 h-4" /> Penerimaan Customer
          </CardTitle>
          <CardDescription>Catat berat diterima customer per <b>produk</b>. Sistem otomatis hitung selisih vs berat kirim — <b>susut</b> (kurang) atau <b>kelebihan</b> (lebih, mis. tambah berat saat pengiriman).</CardDescription>
        </div>
        {canOperate && shipped && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <PackageCheck className="w-4 h-4 mr-1" />Catat Penerimaan
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Catat Penerimaan Customer</DialogTitle>
                <DialogDescription>
                  Masukkan <b>berat aktual yang diterima</b> customer per produk. Selisih vs berat kirim otomatis dihitung: kurang = <b>susut</b>, lebih = <b>kelebihan</b> (boleh melebihi berat kirim).
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3">
                <F label="Tanggal Penerimaan">
                  <Input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
                </F>
                <F label="Diterima oleh (nama PIC customer)">
                  <Input value={receivedBy} onChange={e => setReceivedBy(e.target.value)} placeholder="Contoh: Pak Budi" />
                </F>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Calculator className="w-4 h-4" /> Rekap per Produk (dari SO)
                </Label>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produk</TableHead>
                        <TableHead className="text-right">Ordered (kg)</TableHead>
                        <TableHead className="text-right">Diterima (kg) *</TableHead>
                        <TableHead className="text-right">Selisih (kg)</TableHead>
                        <TableHead className="text-right">Selisih (%)</TableHead>
                        <TableHead className="text-right">Nilai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((it, i) => {
                        const diffW = it.orderedWeight - Number(it.receivedWeight || 0); // + susut, - kelebihan
                        const isSurplus = diffW < -0.0001;
                        const shrinkageW = diffW;
                        const shrinkageP = it.orderedWeight > 0 ? (diffW / it.orderedWeight) * 100 : 0;
                        const shrinkageV = diffW * it.avgUnitPrice;
                        const isBig = Math.abs(shrinkageP) > (isSurplus ? 10 : 2);
                        return (
                          <TableRow key={i}>
                            <TableCell>
                              <div className="font-medium text-sm">{it.productName}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{it.sku}</div>
                              <div className="text-[10px] text-muted-foreground">Avg Rp {Number(it.avgUnitPrice).toLocaleString('id-ID')}/kg</div>
                            </TableCell>
                            <TableCell className="text-right font-semibold">{it.orderedWeight.toFixed(2)}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                className="w-24 ml-auto text-right font-semibold"
                                value={it.receivedWeight}
                                onChange={e => updItem(i, { receivedWeight: Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={cn('font-semibold', isSurplus ? 'text-emerald-600' : isBig ? 'text-red-600' : 'text-amber-600')}>
                                {isSurplus ? `+${(-shrinkageW).toFixed(2)}` : shrinkageW.toFixed(2)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className={cn(isSurplus ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : shrinkageP > 5 ? 'bg-red-50 text-red-700 border-red-200' : shrinkageP > 2 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                                {shrinkageP >= 0 ? shrinkageP.toFixed(2) : `+${(-shrinkageP).toFixed(2)}`}%
                              </Badge>
                            </TableCell>
                            <TableCell className={cn('text-right font-semibold', isSurplus ? 'text-emerald-600' : 'text-red-600')}>
                              {isSurplus ? '+' : ''}Rp {Math.round(Math.abs(shrinkageV)).toLocaleString('id-ID')}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-slate-50 font-bold">
                        <TableCell>TOTAL</TableCell>
                        <TableCell className="text-right">{totals.ordered.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{totals.received.toFixed(2)}</TableCell>
                        <TableCell className={cn('text-right', isNetSurplus ? 'text-emerald-600' : 'text-red-600')}>{isNetSurplus ? `+${(-totals.shrinkageW).toFixed(2)}` : totals.shrinkageW.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={isNetSurplus ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}>
                            {totalShrinkagePct >= 0 ? totalShrinkagePct.toFixed(2) : `+${(-totalShrinkagePct).toFixed(2)}`}%
                          </Badge>
                        </TableCell>
                        <TableCell className={cn('text-right', isNetSurplus ? 'text-emerald-600' : 'text-red-600')}>{isNetSurplus ? '+' : ''}Rp {Math.round(Math.abs(totals.shrinkageV)).toLocaleString('id-ID')}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <F label="Catatan">
                <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opsional: kondisi barang, dsb" />
              </F>

              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <input
                  type="checkbox"
                  id="applyToInvoice"
                  checked={applyToInvoice}
                  onChange={(e) => setApplyToInvoice(e.target.checked)}
                  className="mt-1"
                />
                <label htmlFor="applyToInvoice" className="text-sm flex-1 cursor-pointer">
                  <div className="font-semibold">{isNetSurplus ? 'Tambah Invoice sesuai kelebihan berat?' : 'Potong Invoice sesuai penyusutan?'}</div>
                  <div className="text-xs text-muted-foreground">
                    {isNetSurplus
                      ? <>Jika dicentang, sistem otomatis <b>menambah tagihan</b> senilai Rp {Math.round(Math.abs(totals.shrinkageV)).toLocaleString('id-ID')} (kelebihan berat saat pengiriman). HPP/modal tetap pada berat kirim.</>
                      : <>Jika dicentang, sistem otomatis membuat catatan retur senilai Rp {Math.round(totals.shrinkageV).toLocaleString('id-ID')} untuk memotong outstanding customer. Cocok untuk kesepakatan potong berat susut.</>}
                  </div>
                </label>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
                <Button onClick={submit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Simpan Penerimaan
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {!shipped && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Penerimaan hanya bisa dicatat setelah SO status Shipped/Invoiced.
          </div>
        )}
        {shipped && receipts.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">Belum ada penerimaan tercatat</div>
        )}
        {receipts.length > 0 && (
          <div className="space-y-3">
            {receipts.map(r => (
              <div key={r.id} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-mono font-semibold">{r.receiptNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(r.receivedDate), 'dd MMM yyyy')}
                      {r.receivedBy && ` · Diterima oleh ${r.receivedBy}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={r.status === 'received' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : r.status === 'partial' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}>
                      {r.status}
                    </Badge>
                    {r.applyToInvoice && (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                        <TrendingDown className="w-3 h-3 mr-1" /> potong invoice
                      </Badge>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => del(r.id)} title="Hapus" className="h-6 w-6 text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 bg-slate-50 rounded">
                    <div className="text-muted-foreground">Ordered</div>
                    <div className="font-bold">{Number(r.totalOrderedWeight).toFixed(2)} kg</div>
                  </div>
                  <div className="p-2 bg-emerald-50 rounded">
                    <div className="text-muted-foreground">Diterima</div>
                    <div className="font-bold text-emerald-700">{Number(r.totalReceivedWeight).toFixed(2)} kg</div>
                  </div>
                  <div className="p-2 bg-amber-50 rounded">
                    <div className="text-muted-foreground">Susut</div>
                    <div className="font-bold text-amber-700">{Number(r.totalShrinkageWeight).toFixed(2)} kg ({Number(r.totalShrinkagePct).toFixed(2)}%)</div>
                  </div>
                  <div className="p-2 bg-red-50 rounded">
                    <div className="text-muted-foreground">Nilai Susut</div>
                    <div className="font-bold text-red-600">Rp {Number(r.totalShrinkageValue).toLocaleString('id-ID')}</div>
                  </div>
                </div>
                {r.items?.length > 0 && (
                  <div className="border rounded overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produk</TableHead>
                          <TableHead className="text-right">Ordered</TableHead>
                          <TableHead className="text-right">Diterima</TableHead>
                          <TableHead className="text-right">Susut kg</TableHead>
                          <TableHead className="text-right">Susut %</TableHead>
                          <TableHead className="text-right">Nilai</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.items.map((li) => (
                          <TableRow key={li.id}>
                            <TableCell className="text-xs">
                              <div className="font-medium">{li.product?.name}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{li.product?.sku}</div>
                            </TableCell>
                            <TableCell className="text-right text-xs">{Number(li.orderedWeight).toFixed(2)} kg</TableCell>
                            <TableCell className="text-right text-xs text-emerald-700">{Number(li.receivedWeight).toFixed(2)} kg</TableCell>
                            <TableCell className="text-right text-xs text-amber-700">{Number(li.shrinkageWeight).toFixed(2)}</TableCell>
                            <TableCell className="text-right text-xs">{Number(li.shrinkagePct).toFixed(2)}%</TableCell>
                            <TableCell className="text-right text-xs text-red-600">Rp {Number(li.shrinkageValue).toLocaleString('id-ID')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {r.notes && <div className="text-xs text-muted-foreground italic">Catatan: {r.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
