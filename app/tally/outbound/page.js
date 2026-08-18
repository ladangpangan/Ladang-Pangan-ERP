'use client';

import React, { useState, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ChevronRight, ChevronLeft, Loader2, PackageMinus, Truck, CheckCircle2, Sparkles, Snowflake, Boxes, NotebookPen, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const fetcher = (url) => fetch(url).then(r => r.json());
const kg = (n) => `${Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })} kg`;

export default function TallyOutboundPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [selectedSo, setSelectedSo] = useState(null);

  return (
    <div className="max-w-md mx-auto p-4 min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {selectedSo ? (
          <Button variant="ghost" size="icon" onClick={() => setSelectedSo(null)}><ChevronLeft className="w-5 h-5" /></Button>
        ) : (
          <Link href="/tally"><Button variant="ghost" size="icon"><ChevronLeft className="w-5 h-5" /></Button></Link>
        )}
        <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-orange-700 rounded-lg flex items-center justify-center text-white shrink-0"><PackageMinus className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm leading-tight">Tally Outbound (SO)</div>
          <div className="text-xs text-muted-foreground truncate">{session?.user?.name || 'Operator'}</div>
        </div>
      </div>

      {selectedSo
        ? <OrderDetail soId={selectedSo} />
        : <OrderList onSelect={setSelectedSo} />}
    </div>
  );
}

function OrderList({ onSelect }) {
  const { data, isLoading, error } = useSWR('/api/tally-outbound/orders', fetcher, { refreshInterval: 15000 });
  const rows = data?.data || [];

  return (
    <div className="flex-1">
      <Card className="mb-4 border-orange-200 bg-gradient-to-br from-orange-50 to-white">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 mb-1"><Truck className="w-5 h-5 text-orange-600" /><span className="font-bold text-sm">Pilih SO untuk Outbound</span></div>
          <p className="text-xs text-muted-foreground">Pilih Sales Order, lalu tentukan <b>kode simpan</b> untuk tiap item. Gunakan <b>Catat</b> untuk menyimpan sementara (stok belum dikunci) & <b>Simpan</b> untuk finalisasi.</p>
        </CardContent>
      </Card>

      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">SO Draft belum lengkap ({rows.length})</div>
      {isLoading && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
      {!isLoading && rows.length === 0 && (
        <Card><CardContent className="pt-6 pb-6 text-center text-muted-foreground text-sm">
          Tidak ada SO yang perlu dipilih kode simpannya. SO baru (Draft, dari stok gudang) akan muncul di sini.
        </CardContent></Card>
      )}
      <div className="space-y-3">
        {rows.map(so => {
          const done = so.allocatedItemCount >= so.itemCount;
          return (
            <Card key={so.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => onSelect(so.id)}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="font-mono font-bold text-sm">{so.soNumber}</div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="text-sm font-semibold truncate">{so.customerName}</div>
                <div className="flex items-center gap-2 flex-wrap mt-2 text-xs">
                  <Badge variant="outline">{so.orderDate ? format(new Date(so.orderDate), 'dd MMM yyyy') : '-'}</Badge>
                  <Badge variant="secondary">{kg(so.totalWeight)}</Badge>
                  <Badge className={done ? 'bg-emerald-600' : 'bg-amber-500'}>{so.allocatedItemCount}/{so.itemCount} disimpan</Badge>
                  {so.draftItemCount > 0 && <Badge className="bg-sky-500">{so.draftItemCount} draft</Badge>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function OrderDetail({ soId }) {
  const { data, isLoading, mutate } = useSWR(`/api/tally-outbound/orders/${soId}`, fetcher, { refreshInterval: 0 });
  const so = data?.data;
  const [allocItem, setAllocItem] = useState(null);

  if (isLoading || !so) return <div className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  const items = so.items || [];
  const finalCount = items.filter(i => i.tallyStatus === 'final').length;
  const draftCount = items.filter(i => i.tallyStatus === 'draft').length;
  const total = items.length;

  return (
    <div className="flex-1">
      <Card className="mb-3">
        <CardContent className="pt-4 pb-4">
          <div className="font-mono font-bold text-sm">{so.soNumber}</div>
          <div className="text-sm font-semibold">{so.customerName}</div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <Badge className={finalCount >= total ? 'bg-emerald-600' : 'bg-amber-500'}>{finalCount}/{total} disimpan</Badge>
            {draftCount > 0 && <Badge className="bg-sky-500">{draftCount} draft</Badge>}
            <Badge variant="outline">{so.pipelineStatus}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {items.map(it => {
          const st = it.tallyStatus || 'none';
          return (
          <Card key={it.id} className={st === 'final' ? 'border-emerald-200' : st === 'draft' ? 'border-sky-200' : 'border-amber-200'}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{it.productName}</div>
                  <div className="text-[11px] text-muted-foreground">{it.sku}</div>
                </div>
                {st === 'final'
                  ? <Badge className="bg-emerald-600 shrink-0"><Lock className="w-3 h-3 mr-1" />Tersimpan</Badge>
                  : st === 'draft'
                  ? <Badge className="bg-sky-500 shrink-0"><NotebookPen className="w-3 h-3 mr-1" />Draft</Badge>
                  : <Badge className="bg-amber-500 shrink-0">Belum</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                <div><span className="text-muted-foreground">Berat pesanan:</span> <b>{kg(it.orderedWeight)}</b></div>
                <div><span className="text-muted-foreground">Terpilih:</span> <b>{kg(it.allocatedWeight)}</b></div>
              </div>
              {it.allocations?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {it.allocations.map(a => (
                    <Badge key={a.stockId} variant="outline" className="font-mono text-[10px]">{a.kodeSimpan} · {kg(a.weight)}</Badge>
                  ))}
                </div>
              )}
              <Button size="sm" variant={st === 'final' ? 'outline' : 'default'} className="mt-3 w-full h-9" onClick={() => setAllocItem(it)}>
                <Boxes className="w-4 h-4 mr-1.5" />{st === 'final' ? 'Ubah Kode Simpan' : st === 'draft' ? 'Lanjutkan / Simpan' : 'Pilih Kode Simpan'}
              </Button>
            </CardContent>
          </Card>
          );
        })}
      </div>

      {allocItem && (
        <AllocDialog soId={soId} item={allocItem} onClose={() => setAllocItem(null)} onSaved={() => { setAllocItem(null); mutate(); }} />
      )}
    </div>
  );
}

function AllocDialog({ soId, item, onClose, onSaved }) {
  const { data, isLoading } = useSWR(`/api/tally-outbound/orders/${soId}/items/${item.id}/stocks`, fetcher, { revalidateOnFocus: false });
  const stocks = data?.data?.stocks || [];
  const orderedWeight = data?.data?.orderedWeight ?? item.orderedWeight;
  const recommendedIds = data?.data?.recommendedIds || [];
  const recommendedTotal = data?.data?.recommendedTotal || 0;
  const [selected, setSelected] = useState(() => new Set((item.allocations || []).map(a => a.stockId)));
  const [saving, setSaving] = useState(null); // null | 'draft' | 'final'

  const pickRecommended = () => setSelected(new Set(recommendedIds));

  const toggle = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectedStocks = useMemo(() => stocks.filter(st => selected.has(st.id)), [selected, stocks]);
  const selectedWeight = useMemo(() => {
    let w = 0;
    for (const st of selectedStocks) w += Number(st.weight || 0);
    return Math.round(w * 100) / 100;
  }, [selectedStocks]);
  const remaining = Math.round((Number(orderedWeight || 0) - selectedWeight) * 100) / 100;

  const submit = async (mode) => {
    setSaving(mode);
    try {
      const res = await fetch(`/api/tally-outbound/orders/${soId}/items/${item.id}/allocate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockIds: Array.from(selected), mode }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      if (mode === 'draft') toast.success(`Dicatat sebagai draft (${kg(j.data?.allocatedWeight)}) · stok belum dikunci`);
      else toast.success(`Kode simpan disimpan & dikunci (${kg(j.data?.allocatedWeight)})`);
      onSaved();
    } catch (e) {
      toast.error(e.message);
    } finally { setSaving(null); }
  };

  const busy = saving !== null;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="p-4 pb-3 border-b">
          <DialogTitle className="text-base">{item.productName}</DialogTitle>
          <div className="text-xs text-muted-foreground">Berat pesanan: <b>{kg(orderedWeight)}</b> · Pilih kode simpan (utuh per-lot)</div>
        </DialogHeader>

        {/* Ringkasan sisa berat dinamis */}
        <div className="px-4 py-2.5 border-b bg-muted/40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Terpilih</span>
            <b className="text-sm">{kg(selectedWeight)}</b>
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            <span className="text-muted-foreground">{remaining >= 0 ? 'Sisa yang diminta' : 'Kelebihan'}</span>
            <b className={`text-sm ${remaining > 0 ? 'text-amber-600' : remaining < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {remaining === 0 ? 'Pas (0 kg)' : kg(Math.abs(remaining))}
            </b>
          </div>
          {selectedStocks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedStocks.map(st => (
                <Badge key={st.id} variant="secondary" className="font-mono text-[10px] gap-1">
                  {st.kodeSimpan} · {kg(st.weight)}
                  <button onClick={() => toggle(st.id)} className="ml-0.5 text-muted-foreground hover:text-foreground" aria-label="hapus">×</button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
          {!isLoading && stocks.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">Tidak ada kode simpan tersedia untuk produk ini di gudang.</div>
          )}
          {!isLoading && recommendedIds.length > 0 && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 flex items-center justify-between gap-2">
              <div className="text-xs min-w-0">
                <div className="font-semibold text-orange-700 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Rekomendasi kombinasi</div>
                <div className="text-muted-foreground">{recommendedIds.length} kode simpan · total <b>{kg(recommendedTotal)}</b> (selisih {kg(Math.abs(recommendedTotal - orderedWeight))})</div>
              </div>
              <Button size="sm" variant="outline" className="border-orange-400 text-orange-700 hover:bg-orange-100 h-8 shrink-0" onClick={pickRecommended}>Pilih</Button>
            </div>
          )}
          {stocks.map(st => {
            const active = selected.has(st.id);
            return (
              <button key={st.id} onClick={() => toggle(st.id)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${active ? 'border-emerald-500 bg-emerald-50' : 'border-border bg-card hover:bg-muted/40'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${active ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-muted-foreground/40'}`}>
                      {active && <CheckCircle2 className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-sm truncate">{st.kodeSimpan}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                        {st.csCode && <span className="inline-flex items-center gap-0.5"><Snowflake className="w-3 h-3" />{st.csCode}{st.zoneCode ? `/${st.zoneCode}` : ''}</span>}
                        {st.expiredDate && <span>ED {format(new Date(st.expiredDate), 'dd/MM/yy')}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-sm">{kg(st.weight)}</div>
                    {st.recommended && <Badge className="bg-orange-500 text-[9px] px-1.5 py-0 h-4 mt-0.5"><Sparkles className="w-2.5 h-2.5 mr-0.5" />Rekomendasi</Badge>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter className="p-3 border-t grid grid-cols-3 gap-2 sm:grid-cols-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy} className="w-full">Batal</Button>
          <Button variant="outline" size="sm" onClick={() => submit('draft')} disabled={busy} className="w-full border-sky-400 text-sky-700 hover:bg-sky-50">
            {saving === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><NotebookPen className="w-4 h-4 mr-1" />Catat</>}
          </Button>
          <Button size="sm" onClick={() => submit('final')} disabled={busy || selected.size === 0} className="w-full bg-emerald-600 hover:bg-emerald-700">
            {saving === 'final' ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Lock className="w-4 h-4 mr-1" />Simpan</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
