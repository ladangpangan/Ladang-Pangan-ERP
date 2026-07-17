'use client';

import { useState, useEffect } from 'react';
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
import {
  Wheat, ArrowLeft, PackagePlus, Wifi, WifiOff, LogOut, Plus, X, Save, Loader2, Warehouse, CheckCircle2
} from 'lucide-react';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());

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

  const { data: productData } = useSWR('/api/products', fetcher);
  const { data: csData } = useSWR('/api/cold-storages', fetcher);
  const products = productData?.data || [];
  const coldStorages = csData?.data || [];

  const [coldStorageId, setColdStorageId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [refType, setRefType] = useState('MANUAL');
  const [refId, setRefId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([
    { productId: '', quantity: 1, weight: 0, packagingType: 'karung', expiredDate: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // fetch zones for selected CS
  const { data: zoneData } = useSWR(coldStorageId ? `/api/cold-storages/${coldStorageId}` : null, fetcher);
  const zones = zoneData?.data?.zones || [];

  const addItem = () => setItems([...items, { productId: '', quantity: 1, weight: 0, packagingType: 'karung', expiredDate: '' }]);
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx, patch) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));

  const totalWeight = items.reduce((a, b) => a + Number(b.weight || 0), 0);
  const totalQty = items.reduce((a, b) => a + Number(b.quantity || 0), 0);

  const submit = async () => {
    if (!coldStorageId) return toast.error('Pilih Cold Storage');
    const validItems = items.filter(it => it.productId && Number(it.weight) > 0);
    if (validItems.length === 0) return toast.error('Minimal 1 item dengan produk & berat');

    setSaving(true);
    const payload = {
      coldStorageId,
      zoneId: zoneId || undefined,
      referenceType: refType,
      referenceId: refId || undefined,
      notes,
      items: validItems.map(it => ({
        productId: it.productId,
        quantity: Number(it.quantity || 0),
        weight: Number(it.weight || 0),
        packagingType: it.packagingType,
        expiredDate: it.expiredDate || undefined,
      })),
    };

    // Offline queue: cache when offline
    if (!online) {
      try {
        const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
        q.push({ payload, savedAt: new Date().toISOString() });
        localStorage.setItem('tallyInboundQueue', JSON.stringify(q));
        toast.success('Tersimpan offline. Akan sync saat online.');
        resetForm();
      } catch (e) {
        toast.error('Gagal simpan offline');
      }
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/inventory/inbound', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(`Inbound tersimpan (${validItems.length} item, ${totalWeight} kg)`);
        setLastSaved({ time: new Date(), items: validItems.length, weight: totalWeight });
        resetForm();
      } else {
        toast.error(json.error || 'Gagal simpan');
      }
    } catch (e) {
      // Fall back to offline queue if fetch fails
      const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
      q.push({ payload, savedAt: new Date().toISOString() });
      localStorage.setItem('tallyInboundQueue', JSON.stringify(q));
      toast.warning('Gagal online. Tersimpan offline.');
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setItems([{ productId: '', quantity: 1, weight: 0, packagingType: 'karung', expiredDate: '' }]);
    setNotes('');
    setRefId('');
  };

  // Auto-sync queued when back online
  useEffect(() => {
    if (online) syncQueue();
  }, [online]);

  const syncQueue = async () => {
    try {
      const q = JSON.parse(localStorage.getItem('tallyInboundQueue') || '[]');
      if (q.length === 0) return;
      const remaining = [];
      for (const item of q) {
        try {
          const res = await fetch('/api/inventory/inbound', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
          if (!res.ok) remaining.push(item);
        } catch {
          remaining.push(item);
        }
      }
      localStorage.setItem('tallyInboundQueue', JSON.stringify(remaining));
      const synced = q.length - remaining.length;
      if (synced > 0) toast.success(`Sinkronisasi ${synced} inbound offline berhasil`);
    } catch {}
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

  return (
    <div className="max-w-md mx-auto p-4 min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/tally">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
        </Link>
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

      {/* Offline Info */}
      {!online && (
        <div className="mb-3 text-xs bg-red-100 text-red-700 p-2 rounded flex items-center gap-2">
          <WifiOff className="w-4 h-4" /> Offline — input akan disimpan lokal & sync saat online
        </div>
      )}
      {queueCount > 0 && (
        <div className="mb-3 text-xs bg-amber-100 text-amber-800 p-2 rounded flex items-center justify-between">
          <span>📦 {queueCount} inbound menunggu sync</span>
          {online && <Button size="sm" variant="outline" onClick={syncQueue} className="h-6 text-xs">Sync Sekarang</Button>}
        </div>
      )}

      {/* Last saved */}
      {lastSaved && (
        <Card className="mb-3 border-emerald-200 bg-emerald-50">
          <CardContent className="pt-3 pb-3 flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="w-5 h-5" />
            <div>
              <div className="font-semibold">Sukses tersimpan</div>
              <div className="text-xs">{lastSaved.items} item · {lastSaved.weight} kg · {format(lastSaved.time, 'HH:mm')}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Location */}
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
          {coldStorageId && zones.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Zona (opsional)</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger><SelectValue placeholder="Pilih zona" /></SelectTrigger>
                <SelectContent>
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.code} - {z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipe Referensi</Label>
              <Select value={refType} onValueChange={setRefType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Manual</SelectItem>
                  <SelectItem value="PO">Purchase Order</SelectItem>
                  <SelectItem value="WO">Work Order</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">No. Referensi</Label>
              <Input value={refId} onChange={(e) => setRefId(e.target.value)} placeholder="opsional" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center justify-between">
        <span>Item ({items.length})</span>
        <Button size="sm" variant="outline" onClick={addItem} className="h-7 text-xs">
          <Plus className="w-3 h-3 mr-1" /> Tambah
        </Button>
      </div>

      <div className="space-y-3 mb-3">
        {items.map((it, idx) => (
          <Card key={idx}>
            <CardContent className="pt-3 pb-3 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-xs">Item #{idx + 1}</Badge>
                {items.length > 1 && (
                  <Button size="icon" variant="ghost" onClick={() => removeItem(idx)} className="h-6 w-6 text-red-500">
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Produk</Label>
                <Select value={it.productId} onValueChange={(v) => updateItem(idx, { productId: v })}>
                  <SelectTrigger><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Berat (kg)</Label>
                  <Input type="number" inputMode="decimal" step="0.1" value={it.weight} onChange={(e) => updateItem(idx, { weight: e.target.value })} className="text-lg font-bold" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Qty (pack/box)</Label>
                  <Input type="number" inputMode="numeric" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Packaging</Label>
                  <Select value={it.packagingType} onValueChange={(v) => updateItem(idx, { packagingType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="karung">Karung</SelectItem>
                      <SelectItem value="box">Box</SelectItem>
                      <SelectItem value="pack">Pack</SelectItem>
                      <SelectItem value="drum">Drum</SelectItem>
                      <SelectItem value="lain">Lainnya</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Kadaluarsa</Label>
                  <Input type="date" value={it.expiredDate} onChange={(e) => updateItem(idx, { expiredDate: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-1.5 mb-3">
        <Label className="text-xs">Catatan</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opsional" rows={2} />
      </div>

      {/* Totals sticky */}
      <div className="sticky bottom-0 bg-white border-t -mx-4 px-4 py-3 mt-auto shadow-lg">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">Total:</span>
          <span><b>{items.length}</b> item · <b>{totalWeight.toFixed(1)}</b> kg · <b>{totalQty}</b> qty</span>
        </div>
        <Button
          size="lg"
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-base h-12"
          onClick={submit}
          disabled={saving}
        >
          {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
          {saving ? 'Menyimpan...' : (online ? 'Simpan Inbound' : 'Simpan Offline')}
        </Button>
      </div>
    </div>
  );
}
