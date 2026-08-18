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
import { ChevronRight, ChevronLeft, Loader2, PackageMinus, Truck, CheckCircle2, Sparkles, Snowflake, Boxes } from 'lucide-react';
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
          <p className="text-xs text-muted-foreground">Pilih Sales Order, lalu tentukan <b>kode simpan</b> untuk tiap item. Sistem memberi rekomendasi kode simpan yang beratnya paling mendekati pesanan.</p>
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
                  <Badge className={done ? 'bg-emerald-600' : 'bg-amber-500'}>{so.allocatedItemCount}/{so.itemCount} item</Badge>
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

  const allocatedCount = (so.items || []).filter(i => i.allocated).length;
  const total = (so.items || []).length;

  return (
    <div className="flex-1">
      <Card className="mb-3">
        <CardContent className="pt-4 pb-4">
          <div className="font-mono font-bold text-sm">{so.soNumber}</div>
          <div className="text-sm font-semibold">{so.customerName}</div>
          <div className="mt-2 flex items-center gap-2">
            <Badge className={allocatedCount >= total ? 'bg-emerald-600' : 'bg-amber-500'}>{allocatedCount}/{total} item teralokasi</Badge>
            <Badge variant="outline">{so.pipelineStatus}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {(so.items || []).map(it => (
          <Card key={it.id} className={it.allocated ? 'border-emerald-200' : 'border-amber-200'}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{it.productName}</div>
                  <div className="text-[11px] text-muted-foreground">{it.sku}</div>
                </div>
                {it.allocated
                  ? <Badge className="bg-emerald-600 shrink-0"><CheckCircle2 className="w-3 h-3 mr-1" />Terpilih</Badge>
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
              <Button size="sm" variant={it.allocated ? 'outline' : 'default'} className="mt-3 w-full h-9" onClick={() => setAllocItem(it)}>
                <Boxes className="w-4 h-4 mr-1.5" />{it.allocated ? 'Ubah Kode Simpan' : 'Pilih Kode Simpan'}
              </Button>
            </CardContent>
          </Card>
        ))}
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
  const [selected, setSelected] = useState(() => new Set((item.allocations || []).map(a => a.stockId)));
  const [saving, setSaving] = useState(false);

  const toggle = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectedWeight = useMemo(() => {
    let w = 0;
    for (const st of stocks) if (selected.has(st.id)) w += Number(st.weight || 0);
    return Math.round(w * 100) / 100;
  }, [selected, stocks]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tally-outbound/orders/${soId}/items/${item.id}/allocate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockIds: Array.from(selected) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      toast.success(`Kode simpan tersimpan (${kg(j.data?.allocatedWeight)})`);
      onSaved();
    } catch (e) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="p-4 pb-3 border-b">
          <DialogTitle className="text-base">{item.productName}</DialogTitle>
          <div className="text-xs text-muted-foreground">Berat pesanan: <b>{kg(orderedWeight)}</b> · Pilih kode simpan (utuh per-lot)</div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
          {!isLoading && stocks.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">Tidak ada kode simpan tersedia untuk produk ini di gudang.</div>
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

        <DialogFooter className="p-3 border-t flex-row items-center justify-between gap-2 sm:justify-between">
          <div className="text-xs">
            <span className="text-muted-foreground">Terpilih:</span> <b>{kg(selectedWeight)}</b>
            <span className="text-muted-foreground"> / {kg(orderedWeight)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Batal</Button>
            <Button size="sm" onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
