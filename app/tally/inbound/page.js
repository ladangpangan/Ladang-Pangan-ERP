'use client';

import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useSession, authClient } from '@/lib/auth/auth-client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  ArrowLeft, PackagePlus, Wifi, WifiOff, LogOut, Plus, X, Save, Loader2, Warehouse, CheckCircle2,
  ListChecks, ClipboardCheck, Package, FileText
} from 'lucide-react';
import { PACKAGING_TYPES, pkgLabel, pkgShort } from '@/lib/constants';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());

const emptyDraft = () => ({
  productId: '',
  weight: '',
  packagingType: 'colly',
  quantity: 1,
  expiredDate: '',
});

export default function TallyInboundPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  // Master data
  const { data: productData } = useSWR('/api/products', fetcher);
  const { data: csData } = useSWR('/api/cold-storages', fetcher);
  const { data: poData } = useSWR('/api/purchase-orders', fetcher);
  const { data: woData } = useSWR('/api/work-orders', fetcher);
  const products = productData?.data || [];
  const coldStorages = csData?.data || [];
  const purchaseOrders = poData?.data || [];
  const workOrders = woData?.data || [];

  // Header form
  const [coldStorageId, setColdStorageId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [refType, setRefType] = useState('MANUAL');
  const [refId, setRefId] = useState(''); // actual PO/WO id (or empty for MANUAL)
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState(emptyDraft());

  // Staged items (staging list, before Simpan Inbound)
  const [staged, setStaged] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Fetch zones for selected CS
  const { data: zoneData } = useSWR(coldStorageId ? `/api/cold-storages/${coldStorageId}` : null, fetcher);
  const zones = zoneData?.data?.zones || [];

  // When refType changes, reset refId
  useEffect(() => { setRefId(''); }, [refType]);

  // Available PO/WO for dropdown
  // PO: filter status yang bisa inbound (Approved/Received/etc). For simplicity, show all.
  const availablePOs = useMemo(() => purchaseOrders.filter(po => ['Approved', 'Diterima Sebagian', 'Diterima Lengkap', 'Disetujui'].includes(po.status) || true), [purchaseOrders]);
  const availableWOs = useMemo(() => workOrders.filter(wo => wo.pipelineStatus === 'Selesai' || wo.pipelineStatus === 'Berjalan' || true), [workOrders]);

  // When PO/WO selected, get items to filter product picker
  const { data: poDetail } = useSWR(refType === 'PO' && refId ? `/api/purchase-orders/${refId}` : null, fetcher);
  const { data: woDetail } = useSWR(refType === 'WO' && refId ? `/api/work-orders/${refId}` : null, fetcher);
  const refProductIds = useMemo(() => {
    if (refType === 'PO' && poDetail?.data?.items) return poDetail.data.items.map(it => it.productId);
    if (refType === 'WO' && woDetail?.data?.outputs) return woDetail.data.outputs.map(it => it.productId);
    return null;
  }, [refType, poDetail, woDetail]);
  const availableProducts = refProductIds ? products.filter(p => refProductIds.includes(p.id)) : products;

  // Map produk -> berat Surat Jalan (receivedWeight dari GRN) untuk referensi tally
  const sjWeightByProduct = useMemo(() => {
    const m = {};
    if (refType === 'PO' && poDetail?.data?.items) {
      for (const it of poDetail.data.items) {
        m[it.productId] = Number(it.receivedWeight || 0);
      }
    }
    return m;
  }, [refType, poDetail]);

  // Sudah berapa berat yang di-tally (staged) untuk produk terpilih
  const stagedWeightByProduct = useMemo(() => {
    const m = {};
    for (const it of staged) m[it.productId] = (m[it.productId] || 0) + Number(it.weight || 0);
    return m;
  }, [staged]);

  const currentSjWeight = draft.productId ? Number(sjWeightByProduct[draft.productId] || 0) : 0;
  const currentStagedWeight = draft.productId ? Number(stagedWeightByProduct[draft.productId] || 0) : 0;
  const currentVariance = (currentSjWeight > 0 && draft.weight !== '' && Number(draft.weight) > 0)
    ? Math.round((Number(draft.weight) - currentSjWeight) * 100) / 100
    : null;

  const pakaiBeratSJ = () => {
    if (!currentSjWeight || currentSjWeight <= 0) return;
    // Sisa berat SJ yang belum di-tally (jika ada input sebelumnya untuk produk yang sama)
    const sisa = Math.round((currentSjWeight - currentStagedWeight) * 100) / 100;
    const nilai = sisa > 0 ? sisa : currentSjWeight;
    setDraft({ ...draft, weight: String(nilai) });
    toast.success(`Berat SJ ${nilai} kg diterapkan`);
  };

  // Actions
  const catat = () => {
    if (!coldStorageId) return toast.error('Pilih Cold Storage dulu');
    if (!draft.productId) return toast.error('Pilih Produk');
    if (!draft.weight || Number(draft.weight) <= 0) return toast.error('Berat harus > 0');
    const product = products.find(p => p.id === draft.productId);
    setStaged([...staged, {
      ...draft,
      _id: Math.random().toString(36).slice(2),
      productName: product?.name,
      productSku: product?.sku,
      weight: Number(draft.weight),
      quantity: Number(draft.quantity || 1),
    }]);
    setDraft(emptyDraft());
    toast.success(`+ ${product?.name} ${draft.weight} kg dicatat`);
  };
  const removeStaged = (id) => setStaged(staged.filter(s => s._id !== id));

  const totalWeight = staged.reduce((a, b) => a + Number(b.weight || 0), 0);

  // Auto-sync offline queue
  useEffect(() => { if (online) syncQueue(); }, [online]);
  const syncQueue = async () => {
    try {
      const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
      if (q.length === 0) return;
      const remaining = [];
      for (const item of q) {
        try {
          const res = await fetch('/api/inventory/inbound', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
          if (!res.ok) remaining.push(item);
        } catch { remaining.push(item); }
      }
      localStorage.setItem('tallyInboundQueue', JSON.stringify(remaining));
      const synced = q.length - remaining.length;
      if (synced > 0) toast.success(`Sinkronisasi ${synced} inbound offline berhasil`);
    } catch {}
  };

  const simpanInbound = async () => {
    if (!coldStorageId) return toast.error('Pilih Cold Storage');
    if (staged.length === 0) return toast.error('Belum ada item tercatat. Klik "Catat" dulu.');
    if ((refType === 'PO' || refType === 'WO') && !refId) return toast.error('Pilih No. Referensi (dropdown)');

    setSaving(true);
    const payload = {
      coldStorageId,
      zoneId: zoneId || undefined,
      referenceType: refType,
      referenceId: refId || undefined,
      notes,
      items: staged.map(it => ({
        productId: it.productId,
        weight: Number(it.weight),
        quantity: Number(it.quantity || 1), // jumlah hitungan kemasan
        packagingType: it.packagingType,
        expiredDate: it.expiredDate || undefined,
      })),
    };

    // Offline: store to queue
    if (!online) {
      try {
        const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
        q.push({ payload, savedAt: new Date().toISOString() });
        localStorage.setItem('tallyInboundQueue', JSON.stringify(q));
        toast.success('Tersimpan offline. Akan sync saat online.');
        resetAll();
      } catch { toast.error('Gagal simpan offline'); }
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/inventory/inbound', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        const created = json.data?.stocks || [];
        toast.success(`Inbound tersimpan (${staged.length} item, ${totalWeight.toFixed(1)} kg)`);
        setLastSaved({
          time: new Date(),
          items: staged.length,
          weight: totalWeight,
          stocks: created,
        });
        resetAll();
      } else {
        toast.error(json.error || 'Gagal simpan');
      }
    } catch (e) {
      // Fallback to offline queue
      const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
      q.push({ payload, savedAt: new Date().toISOString() });
      localStorage.setItem('tallyInboundQueue', JSON.stringify(q));
      toast.warning('Gagal online. Tersimpan offline.');
      resetAll();
    } finally { setSaving(false); }
  };

  const resetAll = () => {
    setStaged([]);
    setDraft(emptyDraft());
    setNotes('');
    setRefId('');
  };

  const logout = async () => { await authClient.signOut(); router.push('/login'); };

  // Queue count
  const [queueCount, setQueueCount] = useState(0);
  useEffect(() => {
    const check = () => {
      try {
        const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
        setQueueCount(q.length);
      } catch {}
    };
    check();
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="max-w-md mx-auto p-4 min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/tally"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center text-white">
          <PackagePlus className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <div className="font-bold text-sm leading-tight">Tally Inbound</div>
          <div className="text-xs text-muted-foreground">{session?.user?.name || 'Operator'}</div>
        </div>
        {online ? <Wifi className="w-5 h-5 text-emerald-600" /> : <WifiOff className="w-5 h-5 text-red-500" />}
        <Button variant="ghost" size="icon" onClick={logout}><LogOut className="w-5 h-5" /></Button>
      </div>

      {!online && (
        <div className="mb-3 text-xs bg-red-100 text-red-700 p-2 rounded flex items-center gap-2">
          <WifiOff className="w-4 h-4" /> Offline — input tersimpan lokal, sync saat online
        </div>
      )}
      {queueCount > 0 && (
        <div className="mb-3 text-xs bg-amber-100 text-amber-800 p-2 rounded flex items-center justify-between">
          <span>📦 {queueCount} inbound menunggu sync</span>
          {online && <Button size="sm" variant="outline" onClick={syncQueue} className="h-6 text-xs">Sync</Button>}
        </div>
      )}

      {/* Last saved */}
      {lastSaved && (
        <Card className="mb-3 border-emerald-200 bg-emerald-50">
          <CardContent className="pt-3 pb-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="w-5 h-5" />
              <div className="flex-1">
                <div className="font-semibold">Sukses tersimpan → siap dijual</div>
                <div className="text-xs">{lastSaved.items} item · {lastSaved.weight.toFixed(1)} kg · {format(lastSaved.time, 'HH:mm')}</div>
              </div>
            </div>
            {lastSaved.stocks?.length > 0 && (
              <div className="pt-2 border-t border-emerald-200 space-y-1">
                <div className="text-[10px] uppercase text-emerald-700 font-semibold tracking-wider">Kode Simpan Terbentuk:</div>
                {lastSaved.stocks.map((st) => (
                  <div key={st.id} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1">
                    <Badge variant="outline" className="font-mono text-[10px] bg-emerald-100 border-emerald-300">{st.kodeSimpan}</Badge>
                    <span className="font-semibold text-emerald-700">{Number(st.weight).toFixed(1)} kg</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 1: Lokasi */}
      <Card className="mb-3">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Warehouse className="w-4 h-4" /> Lokasi Penyimpanan
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cold Storage *</Label>
            <Select value={coldStorageId} onValueChange={(v) => { setColdStorageId(v); setZoneId(''); }}>
              <SelectTrigger><SelectValue placeholder="Pilih cold storage" /></SelectTrigger>
              <SelectContent>
                {coldStorages.map(cs => (
                  <SelectItem key={cs.id} value={cs.id}>{cs.code} - {cs.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Zona {zones.length > 0 ? '(opsional)' : ''}</Label>
            <Select value={zoneId} onValueChange={setZoneId} disabled={!coldStorageId}>
              <SelectTrigger><SelectValue placeholder={coldStorageId ? 'Pilih zona' : 'Pilih CS dulu'} /></SelectTrigger>
              <SelectContent>
                {zones.map(z => (
                  <SelectItem key={z.id} value={z.id}>{z.code} - {z.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Reference */}
      <Card className="mb-3">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="w-4 h-4" /> Referensi Sumber
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tipe Referensi</Label>
            <Select value={refType} onValueChange={setRefType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Manual (tanpa referensi)</SelectItem>
                <SelectItem value="PO">Purchase Order</SelectItem>
                <SelectItem value="WO">Work Order</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {refType === 'PO' && (
            <div className="space-y-1.5">
              <Label className="text-xs">No. Purchase Order *</Label>
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger><SelectValue placeholder="Pilih PO" /></SelectTrigger>
                <SelectContent>
                  {availablePOs.map(po => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.poNumber} · {po.supplier?.name || po.supplier?.code || '-'} · {po.pipelineStatus || po.status || '-'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {refId && poDetail?.data && (
                <div className="text-[11px] text-muted-foreground">
                  Supplier: {poDetail.data.supplier?.displayName || poDetail.data.supplier?.name || '-'} · {(poDetail.data.items || []).length} item
                </div>
              )}
            </div>
          )}
          {refType === 'WO' && (
            <div className="space-y-1.5">
              <Label className="text-xs">No. Work Order *</Label>
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger><SelectValue placeholder="Pilih WO" /></SelectTrigger>
                <SelectContent>
                  {availableWOs.map(wo => (
                    <SelectItem key={wo.id} value={wo.id}>
                      {wo.woNumber} · {wo.mode || wo.productionType || '-'} · {wo.pipelineStatus || '-'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {refId && woDetail?.data && (
                <div className="text-[11px] text-muted-foreground">
                  Mode: {woDetail.data.mode || woDetail.data.productionType || '-'} · {(woDetail.data.outputs || []).length} output
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Input Item */}
      <Card className="mb-3">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Package className="w-4 h-4" /> Input Item
            </div>
            {staged.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setListOpen(true)} className="h-7 text-xs">
                <ListChecks className="w-3 h-3 mr-1" /> Daftar ({staged.length})
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Produk</Label>
            <Select value={draft.productId} onValueChange={(v) => { const p = products.find(x => x.id === v); setDraft({ ...draft, productId: v, packagingType: p?.packagingType || draft.packagingType }); }}>
              <SelectTrigger>
                <SelectValue placeholder={refProductIds ? `Pilih dari ${refType} (${availableProducts.length} produk)` : 'Pilih produk'} />
              </SelectTrigger>
              <SelectContent>
                {availableProducts.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Berat (kg) *</Label>
              {refType === 'PO' && draft.productId && currentSjWeight > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={pakaiBeratSJ}
                  className="h-6 px-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50"
                >
                  <FileText className="w-3 h-3 mr-1" /> Pakai berat SJ ({currentSjWeight} kg)
                </Button>
              )}
            </div>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={draft.weight}
              onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
              className="text-xl font-bold h-12"
              placeholder="0.0"
            />
            {refType === 'PO' && draft.productId && (
              <div className="text-[11px] rounded-md bg-slate-100 px-2 py-1.5 space-y-0.5">
                {currentSjWeight > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Berat Surat Jalan (referensi)</span>
                      <span className="font-semibold text-slate-700">{currentSjWeight} kg</span>
                    </div>
                    {currentStagedWeight > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Sudah di-tally (produk ini)</span>
                        <span className="font-semibold text-slate-700">{currentStagedWeight.toFixed(1)} kg</span>
                      </div>
                    )}
                    {currentVariance !== null && (
                      <div className="flex items-center justify-between pt-0.5 border-t border-slate-200">
                        <span className="text-muted-foreground">Selisih (Tally − SJ)</span>
                        <span className={`font-bold ${currentVariance < 0 ? 'text-amber-600' : currentVariance > 0 ? 'text-blue-600' : 'text-emerald-600'}`}>
                          {currentVariance > 0 ? '+' : ''}{currentVariance} kg
                          {currentSjWeight > 0 && ` (${currentVariance > 0 ? '+' : ''}${Math.round((currentVariance / currentSjWeight) * 1000) / 10}%)`}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-muted-foreground">Belum ada berat Surat Jalan untuk produk ini (konfirmasi GRN di PO dulu).</div>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Jenis Kemasan</Label>
              <Select value={draft.packagingType} onValueChange={(v) => setDraft({ ...draft, packagingType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PACKAGING_TYPES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qty ({pkgShort(draft.packagingType)})</Label>
              <Input type="number" inputMode="numeric" min="1" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} placeholder="Jumlah kemasan" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Kadaluarsa</Label>
            <Input type="date" value={draft.expiredDate} onChange={(e) => setDraft({ ...draft, expiredDate: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1.5 mb-3">
        <Label className="text-xs">Catatan Umum</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opsional" rows={2} />
      </div>

      {/* Sticky footer: 3 action buttons */}
      <div className="sticky bottom-0 bg-white border-t -mx-4 px-4 py-3 mt-auto shadow-lg space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total tercatat:</span>
          <span><b>{staged.length}</b> item · <b>{totalWeight.toFixed(1)}</b> kg</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button
            size="sm"
            onClick={catat}
            className="h-11 bg-blue-600 hover:bg-blue-700"
          >
            <ClipboardCheck className="w-4 h-4 mr-1" />
            Catat
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setListOpen(true)}
            disabled={staged.length === 0}
            className="h-11"
          >
            <ListChecks className="w-4 h-4 mr-1" />
            Daftar ({staged.length})
          </Button>
          <Button
            size="sm"
            onClick={simpanInbound}
            disabled={saving || staged.length === 0}
            className="h-11 bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Simpan
          </Button>
        </div>
      </div>

      {/* Dialog: Daftar Catatan */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="w-5 h-5" /> Daftar Catatan
            </DialogTitle>
            <DialogDescription>
              {staged.length} item · {totalWeight.toFixed(1)} kg · siap disimpan ke inventory
            </DialogDescription>
          </DialogHeader>
          {staged.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Belum ada item tercatat</div>
          ) : (
            <div className="space-y-2">
              {staged.map((it, idx) => (
                <div key={it._id} className="border rounded-lg p-3 flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs shrink-0">#{idx + 1}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{it.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{it.productSku}</span> · {pkgLabel(it.packagingType)} × {Number(it.quantity || 1)}
                      {it.expiredDate && ` · Exp ${format(new Date(it.expiredDate), 'dd MMM yy')}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-emerald-700">{Number(it.weight).toFixed(1)} kg</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => removeStaged(it._id)} className="h-7 w-7 text-red-500 shrink-0">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <div className="p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                <span className="font-semibold text-sm">TOTAL</span>
                <span className="font-bold text-emerald-700">{totalWeight.toFixed(1)} kg</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
