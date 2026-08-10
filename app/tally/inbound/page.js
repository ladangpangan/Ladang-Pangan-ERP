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
  ArrowLeft, ArrowRight, PackagePlus, Wifi, WifiOff, LogOut, X, Save, Loader2, Warehouse, CheckCircle2,
  ListChecks, ClipboardCheck, Package, FileText, Tag, Download, FileSpreadsheet
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
  const [step, setStep] = useState(1); // 1 = Lokasi & Referensi, 2 = Input Item

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
  const [refId, setRefId] = useState('');
  const [notes, setNotes] = useState('');
  const [draft, setDraft] = useState(emptyDraft());

  // Staged items
  const [staged, setStaged] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);

  // Kode Simpan preview queue
  const [kodeQueue, setKodeQueue] = useState([]);
  const loadKodes = async (n = 200) => {
    try {
      const res = await fetch(`/api/inventory/next-kode-simpan?count=${n}`, { credentials: 'include' });
      const j = await res.json();
      if (res.ok) setKodeQueue(j.data?.codes || []);
    } catch {}
  };

  // Fetch zones for selected CS
  const { data: zoneData } = useSWR(coldStorageId ? `/api/cold-storages/${coldStorageId}` : null, fetcher);
  const zones = zoneData?.data?.zones || [];

  useEffect(() => { setRefId(''); }, [refType]);

  const availablePOs = useMemo(() => purchaseOrders, [purchaseOrders]);
  const availableWOs = useMemo(() => workOrders, [workOrders]);

  const { data: poDetail } = useSWR(refType === 'PO' && refId ? `/api/purchase-orders/${refId}` : null, fetcher);
  const { data: woDetail } = useSWR(refType === 'WO' && refId ? `/api/work-orders/${refId}` : null, fetcher);
  const refProductIds = useMemo(() => {
    if (refType === 'PO' && poDetail?.data?.items) return poDetail.data.items.map(it => it.productId);
    if (refType === 'WO' && woDetail?.data?.outputs) return woDetail.data.outputs.map(it => it.productId);
    return null;
  }, [refType, poDetail, woDetail]);
  const availableProducts = refProductIds ? products.filter(p => refProductIds.includes(p.id)) : products;

  // Berat Surat Jalan (dikirim) per produk
  const sjWeightByProduct = useMemo(() => {
    const m = {};
    if (refType === 'PO' && poDetail?.data?.items) {
      for (const it of poDetail.data.items) m[it.productId] = Number(it.receivedWeight || 0);
    }
    return m;
  }, [refType, poDetail]);

  // Berat yang sudah di-tally (staged) per produk
  const stagedWeightByProduct = useMemo(() => {
    const m = {};
    for (const it of staged) m[it.productId] = (m[it.productId] || 0) + Number(it.weight || 0);
    return m;
  }, [staged]);

  const currentSjWeight = draft.productId ? Number(sjWeightByProduct[draft.productId] || 0) : 0;
  const currentStagedWeight = draft.productId ? Number(stagedWeightByProduct[draft.productId] || 0) : 0;
  const sisaSj = Math.round((currentSjWeight - currentStagedWeight) * 100) / 100; // kekurangan yang belum ter-tally

  // Kode simpan yang akan dipakai untuk item berikutnya
  const currentKode = kodeQueue[staged.length] || null;

  const pakaiBeratSJ = () => {
    if (!currentSjWeight || currentSjWeight <= 0) return;
    const nilai = sisaSj > 0 ? sisaSj : currentSjWeight;
    setDraft(d => ({ ...d, weight: String(nilai) }));
    toast.success(`Sisa berat SJ ${nilai} kg diterapkan`);
  };

  const catat = () => {
    if (!coldStorageId) return toast.error('Pilih Cold Storage dulu');
    if (!draft.productId) return toast.error('Pilih Produk');
    if (!draft.weight || Number(draft.weight) <= 0) return toast.error('Berat harus > 0');
    const product = products.find(p => p.id === draft.productId);
    const assignedKode = kodeQueue[staged.length] || null;
    setStaged(prev => ([...prev, {
      ...draft,
      _id: Math.random().toString(36).slice(2),
      kodeSimpan: assignedKode,
      productName: product?.name,
      productSku: product?.sku,
      weight: Number(draft.weight),
      quantity: Number(draft.quantity || 1),
    }]));
    // 3.2: pertahankan Produk, Jenis Kemasan, Kadaluarsa (reset berat saja)
    setDraft(d => ({ ...d, weight: '' }));
    toast.success(`${assignedKode ? assignedKode + ' · ' : ''}${product?.name} ${draft.weight} kg dicatat`);
  };
  const removeStaged = (id) => setStaged(staged.filter(s => s._id !== id));

  const totalWeight = staged.reduce((a, b) => a + Number(b.weight || 0), 0);

  useEffect(() => { if (online) syncQueue(); }, [online]);
  useEffect(() => { loadKodes(); }, []);

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

  const buildReport = (items) => {
    const cs = coldStorages.find(c => c.id === coldStorageId);
    const zone = zones.find(z => z.id === zoneId);
    let refNumber = '-';
    if (refType === 'PO') refNumber = purchaseOrders.find(p => p.id === refId)?.poNumber || refId;
    else if (refType === 'WO') refNumber = workOrders.find(w => w.id === refId)?.woNumber || refId;
    return {
      time: new Date(),
      operator: session?.user?.name || session?.user?.email || 'Operator',
      csCode: cs?.code, csName: cs?.name,
      zoneCode: zone?.code || null,
      refType, refNumber: refType === 'MANUAL' ? null : refNumber,
      notes,
      items: items.map(it => ({ ...it })),
      totalWeight: items.reduce((a, b) => a + Number(b.weight || 0), 0),
    };
  };

  const simpanInbound = async () => {
    if (!coldStorageId) return toast.error('Pilih Cold Storage');
    if (staged.length === 0) return toast.error('Belum ada item tercatat. Klik "Catat" dulu.');
    if ((refType === 'PO' || refType === 'WO') && !refId) return toast.error('Pilih No. Referensi (dropdown)');

    setSaving(true);
    const snapshot = [...staged];
    const payload = {
      coldStorageId,
      zoneId: zoneId || undefined,
      referenceType: refType,
      referenceId: refId || undefined,
      notes,
      items: staged.map(it => ({
        productId: it.productId,
        weight: Number(it.weight),
        quantity: Number(it.quantity || 1),
        packagingType: it.packagingType,
        expiredDate: it.expiredDate || undefined,
        kodeSimpan: it.kodeSimpan || undefined,
      })),
    };

    if (!online) {
      try {
        const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
        q.push({ payload, savedAt: new Date().toISOString() });
        localStorage.setItem('tallyInboundQueue', JSON.stringify(q));
        toast.success('Tersimpan offline. Akan sync saat online.');
        setLastSaved(buildReport(snapshot));
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
        // gabungkan kode simpan hasil server (jika berbeda) ke snapshot berdasarkan urutan
        const merged = snapshot.map((it, i) => ({ ...it, kodeSimpan: created[i]?.kodeSimpan || it.kodeSimpan }));
        toast.success(`Inbound tersimpan (${snapshot.length} item, ${totalWeight.toFixed(1)} kg)`);
        setLastSaved(buildReport(merged));
        setReportOpen(true);
        resetAll();
        loadKodes();
      } else {
        toast.error(json.error || 'Gagal simpan');
      }
    } catch (e) {
      const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
      q.push({ payload, savedAt: new Date().toISOString() });
      localStorage.setItem('tallyInboundQueue', JSON.stringify(q));
      toast.warning('Gagal online. Tersimpan offline.');
      setLastSaved(buildReport(snapshot));
      resetAll();
    } finally { setSaving(false); }
  };

  const resetAll = () => {
    setStaged([]);
    setDraft(emptyDraft());
    setNotes('');
  };

  const logout = async () => { await authClient.signOut(); router.push('/login'); };

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

  const csObj = coldStorages.find(c => c.id === coldStorageId);
  const canGoStep2 = coldStorageId && !((refType === 'PO' || refType === 'WO') && !refId);

  const goStep2 = () => {
    if (!coldStorageId) return toast.error('Pilih Cold Storage dulu');
    if ((refType === 'PO' || refType === 'WO') && !refId) return toast.error('Pilih No. Referensi (dropdown)');
    if (refType === 'PO' && availableProducts.length > 0 && !draft.productId) {
      setDraft(d => ({ ...d, productId: availableProducts[0].id, packagingType: availableProducts[0].packagingType || d.packagingType }));
    }
    loadKodes();
    setStep(2);
  };

  // ===== CSV Report =====
  const downloadCSV = () => {
    if (!lastSaved) return;
    const head = ['No', 'Kode Simpan', 'SKU', 'Produk', 'Kemasan', 'Qty', 'Berat (kg)', 'Kadaluarsa'];
    const rows = [head];
    lastSaved.items.forEach((it, i) => rows.push([
      i + 1, it.kodeSimpan || '-', it.productSku || '-', it.productName || '-',
      pkgLabel(it.packagingType), it.quantity, Number(it.weight).toFixed(2),
      it.expiredDate ? format(new Date(it.expiredDate), 'dd-MM-yyyy') : '-',
    ]));
    rows.push(['', '', '', '', '', 'TOTAL', lastSaved.totalWeight.toFixed(2), '']);
    const meta = [
      ['Laporan Tally Inbound'],
      ['Tanggal', format(lastSaved.time, 'dd MMM yyyy HH:mm')],
      ['Operator', lastSaved.operator],
      ['Cold Storage', `${lastSaved.csCode || ''} ${lastSaved.csName || ''}`.trim()],
      ['Zona', lastSaved.zoneCode || '-'],
      ['Referensi', lastSaved.refType === 'MANUAL' ? 'Manual' : `${lastSaved.refType} · ${lastSaved.refNumber || '-'}`],
      [''],
    ];
    const all = [...meta, ...rows];
    const csv = all.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TallyInbound_${format(lastSaved.time, 'yyyyMMdd_HHmm')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success('Laporan CSV diunduh');
  };

  return (
    <div className="max-w-md mx-auto p-4 min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
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

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-3 text-xs">
        <div className={`flex-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${step === 1 ? 'bg-emerald-600 text-white' : 'bg-white text-muted-foreground border'}`}>
          <Warehouse className="w-3.5 h-3.5" /> 1. Lokasi & Referensi
        </div>
        <div className={`flex-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${step === 2 ? 'bg-emerald-600 text-white' : 'bg-white text-muted-foreground border'}`}>
          <Package className="w-3.5 h-3.5" /> 2. Input Item
        </div>
      </div>

      {!online && (
        <div className="mb-3 text-xs bg-red-100 text-red-700 p-2 rounded flex items-center gap-2">
          <WifiOff className="w-4 h-4" /> Offline — input tersimpan lokal, sync saat online
        </div>
      )}
      {queueCount > 0 && (
        <div className="mb-3 text-xs bg-amber-100 text-amber-800 p-2 rounded flex items-center justify-between">
          <span>{queueCount} inbound menunggu sync</span>
          {online && <Button size="sm" variant="outline" onClick={syncQueue} className="h-6 text-xs">Sync</Button>}
        </div>
      )}

      {/* Last saved banner (persist across steps) */}
      {lastSaved && (
        <Card className="mb-3 border-emerald-200 bg-emerald-50">
          <CardContent className="pt-3 pb-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="w-5 h-5" />
              <div className="flex-1">
                <div className="font-semibold">Tersimpan → siap dijual</div>
                <div className="text-xs">{lastSaved.items.length} item · {lastSaved.totalWeight.toFixed(1)} kg · {format(lastSaved.time, 'HH:mm')}</div>
              </div>
            </div>
            <div className="flex gap-2 pt-1 border-t border-emerald-200">
              <Button size="sm" variant="outline" onClick={() => setReportOpen(true)} className="h-8 flex-1 text-xs border-emerald-300">
                <FileText className="w-3.5 h-3.5 mr-1" /> Lihat Laporan
              </Button>
              <Button size="sm" variant="outline" onClick={downloadCSV} className="h-8 flex-1 text-xs border-emerald-300">
                <Download className="w-3.5 h-3.5 mr-1" /> Unduh (CSV)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============ SECTION 1 ============ */}
      {step === 1 && (
        <>
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
                {coldStorages.length === 0 && <div className="text-[11px] text-amber-600">Belum ada cold storage. Buat dulu di menu Cold Storage & Zones.</div>}
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

          <div className="sticky bottom-0 bg-white border-t -mx-4 px-4 py-3 mt-auto shadow-lg">
            <Button onClick={goStep2} disabled={!canGoStep2} className="w-full h-12 bg-emerald-600 hover:bg-emerald-700">
              Lanjut ke Input Item <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </>
      )}

      {/* ============ SECTION 2 ============ */}
      {step === 2 && (
        <>
          {/* Konteks lokasi ringkas */}
          <div className="mb-3 flex items-center justify-between text-xs bg-white border rounded-lg px-3 py-2">
            <div className="min-w-0">
              <span className="text-muted-foreground">Lokasi: </span>
              <b>{csObj?.code || '-'}</b>
              {zoneId && <span> · {zones.find(z => z.id === zoneId)?.code}</span>}
              <span className="text-muted-foreground"> · Ref: </span>
              <b>{refType === 'MANUAL' ? 'Manual' : `${refType} ${refType === 'PO' ? (purchaseOrders.find(p => p.id === refId)?.poNumber || '') : (workOrders.find(w => w.id === refId)?.woNumber || '')}`}</b>
            </div>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setStep(1)}>Ubah</Button>
          </div>

          {/* Kode Simpan tengah */}
          <Card className="mb-3 border-emerald-200">
            <CardContent className="py-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                <Tag className="w-3.5 h-3.5" /> Kode Simpan (tulis di karung)
              </div>
              <div className="mt-1 font-mono font-bold text-2xl text-emerald-700 tracking-wide">
                {currentKode || '—'}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Otomatis berganti setiap kali klik "Catat"</div>
            </CardContent>
          </Card>

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
                      type="button" size="sm" variant="outline" onClick={pakaiBeratSJ}
                      className="h-6 px-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50"
                    >
                      <FileText className="w-3 h-3 mr-1" /> Pakai sisa SJ ({sisaSj > 0 ? sisaSj : 0} kg)
                    </Button>
                  )}
                </div>
                <Input
                  type="number" inputMode="decimal" step="0.1"
                  value={draft.weight}
                  onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
                  className="text-xl font-bold h-12" placeholder="0.0"
                />
                {refType === 'PO' && draft.productId && (
                  <div className="text-[11px] rounded-md bg-slate-100 px-2 py-1.5 space-y-0.5">
                    {currentSjWeight > 0 ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Berat Dikirim (Surat Jalan)</span>
                          <span className="font-semibold text-slate-700">{currentSjWeight} kg</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Sudah di-tally</span>
                          <span className="font-semibold text-slate-700">{currentStagedWeight.toFixed(1)} kg</span>
                        </div>
                        <div className="flex items-center justify-between pt-0.5 border-t border-slate-200">
                          <span className="text-muted-foreground">Sisa belum di-tally</span>
                          <span className={`font-bold ${sisaSj > 0.001 ? 'text-amber-600' : sisaSj < -0.001 ? 'text-blue-600' : 'text-emerald-600'}`}>
                            {sisaSj} kg
                          </span>
                        </div>
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

          {/* Sticky footer */}
          <div className="sticky bottom-0 bg-white border-t -mx-4 px-4 py-3 mt-auto shadow-lg space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total tercatat:</span>
              <span><b>{staged.length}</b> item · <b>{totalWeight.toFixed(1)}</b> kg</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" onClick={catat} className="h-11 bg-blue-600 hover:bg-blue-700">
                <ClipboardCheck className="w-4 h-4 mr-1" /> Catat
              </Button>
              <Button size="sm" variant="outline" onClick={() => setListOpen(true)} disabled={staged.length === 0} className="h-11">
                <ListChecks className="w-4 h-4 mr-1" /> Daftar ({staged.length})
              </Button>
              <Button size="sm" onClick={simpanInbound} disabled={saving || staged.length === 0} className="h-11 bg-emerald-600 hover:bg-emerald-700">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Simpan
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Dialog: Daftar Catatan */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5" /> Daftar Catatan</DialogTitle>
            <DialogDescription>{staged.length} item · {totalWeight.toFixed(1)} kg · siap disimpan ke inventory</DialogDescription>
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
                      {it.kodeSimpan && <span className="font-mono text-emerald-700">{it.kodeSimpan}</span>}
                      {it.kodeSimpan && ' · '}
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

      {/* Dialog: Laporan Tally */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> Laporan Tally Inbound</DialogTitle>
            <DialogDescription>Ringkasan penyimpanan yang baru dibuat</DialogDescription>
          </DialogHeader>
          {lastSaved && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 rounded-lg p-3">
                <div><span className="text-muted-foreground">Tanggal</span><div className="font-medium">{format(lastSaved.time, 'dd MMM yyyy HH:mm')}</div></div>
                <div><span className="text-muted-foreground">Operator</span><div className="font-medium">{lastSaved.operator}</div></div>
                <div><span className="text-muted-foreground">Cold Storage</span><div className="font-medium">{lastSaved.csCode} {lastSaved.csName}</div></div>
                <div><span className="text-muted-foreground">Referensi</span><div className="font-medium">{lastSaved.refType === 'MANUAL' ? 'Manual' : `${lastSaved.refType} · ${lastSaved.refNumber || '-'}`}</div></div>
              </div>
              <div className="border rounded-lg divide-y">
                <div className="grid grid-cols-12 gap-1 px-2 py-1.5 text-[10px] font-semibold text-muted-foreground bg-muted/40">
                  <div className="col-span-1">#</div>
                  <div className="col-span-5">Kode / Produk</div>
                  <div className="col-span-3 text-right">Kemasan</div>
                  <div className="col-span-3 text-right">Berat</div>
                </div>
                {lastSaved.items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 px-2 py-1.5 text-xs items-center">
                    <div className="col-span-1">{i + 1}</div>
                    <div className="col-span-5 min-w-0">
                      <div className="font-mono text-emerald-700 text-[11px]">{it.kodeSimpan || '-'}</div>
                      <div className="truncate">{it.productName}</div>
                    </div>
                    <div className="col-span-3 text-right">{pkgLabel(it.packagingType)} ×{it.quantity}</div>
                    <div className="col-span-3 text-right font-semibold">{Number(it.weight).toFixed(1)} kg</div>
                  </div>
                ))}
                <div className="grid grid-cols-12 gap-1 px-2 py-2 text-sm font-bold bg-slate-50">
                  <div className="col-span-9">TOTAL ({lastSaved.items.length} item)</div>
                  <div className="col-span-3 text-right text-emerald-700">{lastSaved.totalWeight.toFixed(1)} kg</div>
                </div>
              </div>
              <Button onClick={downloadCSV} className="w-full bg-emerald-600 hover:bg-emerald-700">
                <Download className="w-4 h-4 mr-1" /> Unduh Laporan (CSV)
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
