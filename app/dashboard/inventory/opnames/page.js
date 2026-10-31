'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WeightInput } from '@/components/ui/weight-input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeft, ClipboardCheck, Loader2, CheckCircle2, XCircle, Send, Save, Trash2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const STATUS = {
  draft: ['Draf', 'bg-slate-100 text-slate-700'],
  submitted: ['Menunggu persetujuan', 'bg-amber-100 text-amber-800'],
  approved: ['Disetujui', 'bg-emerald-100 text-emerald-700'],
  rejected: ['Ditolak', 'bg-red-100 text-red-700'],
};
const SOURCE = { tally: 'Opname Tally', reweigh: 'Timbang ulang', manual: 'Manual (lama)' };
const sourceOf = (op) => SOURCE[op.source] ? op.source : (String(op.notes || '').startsWith('Timbang ulang') ? 'reweigh' : 'manual');

function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, 'bg-slate-100 text-slate-700'];
  return <Badge className={cls}>{label}</Badge>;
}

export default function OpnameListPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canCreate = ['admin', 'supervisor', 'operator'].includes(role);
  const canApprove = ['admin', 'supervisor'].includes(role);
  const [detailId, setDetailId] = useState(null);
  const { data, mutate, isLoading } = useSWR('/api/opnames', fetcher);
  // Menunggu persetujuan selalu di atas
  const rows = useMemo(() => [...(data?.data || [])].sort((a, b) => (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1)), [data]);
  const waiting = rows.filter(r => r.status === 'submitted').length;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/dashboard/inventory"><Button variant="ghost" size="icon" aria-label="Kembali ke Stok"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ClipboardCheck className="w-7 h-7 text-blue-600" />Stock Opname</h1>
          <p className="text-muted-foreground text-sm mt-1">Cocokkan stok sistem dengan fisik. Perubahan berlaku setelah disetujui admin/supervisor.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Opname dilakukan petugas gudang lewat <b>Tally App → Stock Opname</b> (scan karung).</span>
        </div>
      </div>

      {waiting > 0 && <div className="text-sm"><b>{waiting}</b> opname menunggu persetujuan.</div>}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>No. opname</TableHead><TableHead>Jenis</TableHead><TableHead>Tanggal</TableHead><TableHead>Lokasi</TableHead>
              <TableHead className="text-right">Selisih berat</TableHead><TableHead className="text-right">Karung</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada opname</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id} className={`cursor-pointer hover:bg-slate-50 ${r.status === 'submitted' ? 'bg-amber-50/40' : ''}`} onClick={() => setDetailId(r.id)}>
                  <TableCell className="font-mono font-semibold text-xs">{r.opnameNumber}</TableCell>
                  <TableCell className="text-sm">{SOURCE[sourceOf(r)]}<div className="text-[11px] text-muted-foreground truncate max-w-[260px]">{r.notes}</div></TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{format(new Date(r.opnameDate), 'dd MMM yyyy')}</TableCell>
                  <TableCell className="text-sm">{r.coldStorage?.name}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${r.totalDeltaWeight < 0 ? 'text-red-600' : r.totalDeltaWeight > 0 ? 'text-emerald-600' : ''}`}>{r.totalDeltaWeight > 0 ? '+' : ''}{kg(r.totalDeltaWeight)} kg</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{r.itemCount}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {detailId && <OpnameDetailDialog id={detailId} onClose={() => setDetailId(null)} onRefresh={mutate} canApprove={canApprove} canCreate={canCreate} />}
    </div>
  );
}

function OpnameDetailDialog({ id, onClose, onRefresh, canApprove, canCreate }) {
  const { data, mutate } = useSWR(`/api/opnames/${id}`, fetcher);
  const [saving, setSaving] = useState(false);
  const [localItems, setLocalItems] = useState({});
  const [lost, setLost] = useState({}); // itemId -> true (anggap hilang)
  const [showAll, setShowAll] = useState(false);
  const op = data?.data;
  if (!op) return null;
  const isTally = op.source === 'tally';
  const items = op.items.map(it => ({ ...it, ...(localItems[it.id] || {}) }));
  const upd = (itId, k, v) => setLocalItems(l => ({ ...l, [itId]: { ...l[itId], [k]: v } }));
  const editable = op.status === 'draft' && canCreate && !isTally;
  const changed = items.filter(it => Math.abs(Number(it.physicalWeight || 0) - Number(it.systemWeight)) >= 0.005 || Number(it.physicalQty || 0) !== Number(it.systemQty));
  const missing = isTally ? items.filter(it => it.missing) : [];
  const moved = isTally ? items.filter(it => it.moved) : [];
  const shown = showAll || editable ? items : items.filter(it => changed.includes(it) || it.missing || it.moved);

  const saveItems = async () => {
    setSaving(true);
    try {
      const payload = { items: items.map(it => ({ id: it.id, physicalQty: Number(it.physicalQty || 0), physicalWeight: Number(it.physicalWeight || 0), notes: it.notes })) };
      const res = await fetch(`/api/opnames/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Tersimpan. Selisih total: ${kg(j.data.totalDeltaWeight)} kg`);
      setLocalItems({}); mutate(); onRefresh();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const submit = async () => {
    if (!isTally) await saveItems();
    const res = await fetch(`/api/opnames/${id}/submit`, { method: 'POST' });
    const j = await res.json();
    if (res.ok) { toast.success('Diajukan, menunggu persetujuan'); mutate(); onRefresh(); } else toast.error(j.error);
  };
  const lostIds = Object.keys(lost).filter(k => lost[k]);
  const approve = async () => {
    const msg = `Setujui ${op.opnameNumber}?\n\nBerat ${changed.length - lostIds.length} karung disesuaikan` + (lostIds.length ? `, ${lostIds.length} karung dianggap hilang` : '') + (moved.length ? `, ${moved.length} karung pindah zona` : '') + '.';
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/opnames/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lostItemIds: lostIds }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Disetujui. Stok sudah disesuaikan.'); mutate(); onRefresh();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const reject = async () => {
    if (!confirm(`Tolak ${op.opnameNumber}? Stok tidak berubah.`)) return;
    const res = await fetch(`/api/opnames/${id}/reject`, { method: 'POST' });
    if (res.ok) { toast.success('Ditolak'); mutate(); onRefresh(); }
  };
  const remove = async () => {
    if (!confirm(`Hapus draf ${op.opnameNumber}? Stok tidak berubah.`)) return;
    const res = await fetch(`/api/opnames/${id}`, { method: 'DELETE' });
    const j = await res.json();
    if (res.ok) { toast.success('Draf opname dihapus'); onRefresh(); onClose(); } else toast.error(j.error || 'Gagal menghapus');
  };

  return (
    <Dialog open={!!id} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-5 pb-3 border-b">
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="font-mono">{op.opnameNumber}</DialogTitle>
            <StatusBadge status={op.status} />
            <Badge variant="outline">{SOURCE[sourceOf(op)]}</Badge>
          </div>
          <DialogDescription>
            {op.coldStorage?.name}{isTally ? ` · ${op.zoneCode ? `Zona ${op.zoneCode}` : 'semua zona'}` : ''} · {format(new Date(op.opnameDate), 'dd MMM yyyy')} · dibuat {op.createdBy}
            {op.approvedBy && <> · {op.status === 'rejected' ? 'ditolak' : 'disetujui'} {op.approvedBy}{op.approvedAt ? ` (${format(new Date(op.approvedAt), 'dd MMM HH:mm')})` : ''}</>}
          </DialogDescription>
          {op.notes && <div className="text-sm text-muted-foreground mt-1">Catatan: {op.notes}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-sm">
            <div className="rounded-lg border px-3 py-2"><div className="text-xs text-muted-foreground">Karung</div><b>{items.length}{isTally ? ` · ${items.length - missing.length} di-scan` : ''}</b></div>
            <div className="rounded-lg border px-3 py-2"><div className="text-xs text-muted-foreground">Berat beda</div><b>{changed.filter(i => !i.missing).length} karung · {Number(op.totalDeltaWeight) > 0 ? '+' : ''}{kg(op.totalDeltaWeight)} kg</b></div>
            {isTally && <div className="rounded-lg border px-3 py-2"><div className="text-xs text-muted-foreground">Pindah zona</div><b>{moved.length}</b></div>}
            {isTally && <div className={`rounded-lg border px-3 py-2 ${missing.length ? 'border-red-200 bg-red-50' : ''}`}><div className="text-xs text-muted-foreground">Tidak ditemukan</div><b>{missing.length}</b></div>}
          </div>
        </DialogHeader>

        <div className="overflow-auto flex-1 px-2">
          {isTally && missing.length > 0 && op.status === 'submitted' && canApprove && (
            <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              Centang karung <b>tidak ditemukan</b> yang dianggap <b>hilang</b> (beratnya jadi 0 dan keluar dari stok). Yang tidak dicentang dibiarkan seperti sekarang.
            </div>
          )}
          <Table>
            <TableHeader><TableRow>
              {isTally && op.status === 'submitted' && canApprove && <TableHead className="w-10">Hilang</TableHead>}
              <TableHead>Kode</TableHead><TableHead>Produk</TableHead>{isTally && <TableHead>Asal</TableHead>}
              <TableHead className="text-right">Berat sistem</TableHead><TableHead className="text-right">Berat fisik</TableHead><TableHead className="text-right">Selisih</TableHead>{isTally && <TableHead>Keterangan</TableHead>}
              {!isTally && <><TableHead className="text-right">Qty sistem</TableHead><TableHead className="text-right">Qty fisik</TableHead></>}
            </TableRow></TableHeader>
            <TableBody>
              {shown.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Semua karung cocok dengan sistem.</TableCell></TableRow>}
              {shown.map(it => {
                const dw = Number(it.physicalWeight || 0) - Number(it.systemWeight);
                return (
                  <TableRow key={it.id} className={it.missing ? 'bg-red-50/50' : it.moved ? 'bg-amber-50/50' : undefined}>
                    {isTally && op.status === 'submitted' && canApprove && (
                      <TableCell>{it.missing && <Checkbox checked={!!lost[it.id]} onCheckedChange={(v) => setLost(l => ({ ...l, [it.id]: !!v }))} aria-label={`Anggap ${it.stock?.kodeSimpan} hilang`} disabled={it.stock?.status !== 'active'} />}</TableCell>
                    )}
                    <TableCell className="font-mono text-xs">{it.stock?.kodeSimpan}</TableCell>
                    <TableCell className="text-sm">{it.product?.name}</TableCell>
                    {isTally && <TableCell className="text-xs text-muted-foreground">{it.origin?.sourceNumber || '-'}{it.origin?.partyLabel === 'Supplier' && it.origin?.party ? <div>{it.origin.party}</div> : null}</TableCell>}
                    <TableCell className="text-right tabular-nums">{kg(it.systemWeight)}</TableCell>
                    <TableCell className="text-right">
                      {editable
                        ? <WeightInput className="h-8 text-right w-24 ml-auto" value={it.physicalWeight} onChange={v => upd(it.id, 'physicalWeight', v)} />
                        : <span className="tabular-nums">{it.missing ? '–' : kg(it.physicalWeight)}</span>}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${dw < 0 ? 'text-red-600' : dw > 0 ? 'text-emerald-600' : ''}`}>{it.missing ? '–' : `${dw > 0 ? '+' : ''}${kg(dw)}`}</TableCell>
                    {isTally && <TableCell className="text-xs">
                      {it.missing && <span className="text-red-700 font-medium">Tidak ditemukan{it.stock?.status === 'allocated' ? ' · dipesan SO' : ''}</span>}
                      {it.moved && <span className="text-amber-800 font-medium">Pindah zona {it.zoneCode || '-'} → {it.foundZoneCode || '-'}</span>}
                      {it.notes === 'Dianggap hilang saat persetujuan' && <span className="text-red-700">Dianggap hilang</span>}
                    </TableCell>}
                    {!isTally && <>
                      <TableCell className="text-right">{it.systemQty}</TableCell>
                      <TableCell className="text-right">{editable ? <Input type="number" className="h-8 text-right w-20 ml-auto" value={it.physicalQty} onChange={e => upd(it.id, 'physicalQty', e.target.value)} /> : it.physicalQty}</TableCell>
                    </>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!editable && shown.length < items.length && (
            <button type="button" onClick={() => setShowAll(true)} className="m-3 text-sm text-emerald-700 underline">Tampilkan semua {items.length} karung</button>
          )}
        </div>

        <DialogFooter className="p-4 border-t flex-wrap gap-2 sm:justify-between">
          <div>{op.status === 'draft' && canCreate && <Button variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={remove} disabled={saving}><Trash2 className="w-4 h-4 mr-1" />Hapus draf</Button>}</div>
          <div className="flex gap-2 flex-wrap">
            {editable && <Button variant="outline" onClick={saveItems} disabled={saving}><Save className="w-4 h-4 mr-1" />Simpan berat fisik</Button>}
            {op.status === 'draft' && canCreate && <Button onClick={submit} disabled={saving}><Send className="w-4 h-4 mr-1" />Ajukan</Button>}
            {op.status === 'submitted' && canApprove && (
              <>
                <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={reject} disabled={saving}><XCircle className="w-4 h-4 mr-1" />Tolak</Button>
                <Button onClick={approve} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}Setujui &amp; Sesuaikan Stok</Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
