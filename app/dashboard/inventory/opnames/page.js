'use client';

import { useState } from 'react';
import useSWR from 'swr';
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeft, ClipboardCheck, Loader2, Plus, CheckCircle2, XCircle, Send, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function OpnameListPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canCreate = ['admin', 'supervisor', 'operator'].includes(role);
  const canApprove = ['admin', 'supervisor'].includes(role);

  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const { data, mutate, isLoading } = useSWR('/api/opnames', fetcher);
  const { data: cs } = useSWR('/api/cold-storages', fetcher);
  const rows = data?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/inventory"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ClipboardCheck className="w-7 h-7 text-blue-600" />Stock Opname</h1>
          <p className="text-muted-foreground text-sm mt-1">System vs fisik. Adjustment butuh approval supervisor/admin.</p>
        </div>
        {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />Opname Baru</Button></DialogTrigger>
            <CreateOpnameDialog cs={cs?.data || []} onDone={() => { setOpen(false); mutate(); }} />
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>No Opname</TableHead><TableHead>Tanggal</TableHead><TableHead>CS</TableHead>
              <TableHead className="text-right">Δ Berat</TableHead><TableHead className="text-right">Δ Qty</TableHead>
              <TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada opname</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(r.id)}>
                  <TableCell className="font-mono font-semibold text-xs">{r.opnameNumber}</TableCell>
                  <TableCell className="text-sm">{format(new Date(r.opnameDate), 'dd MMM yyyy')}</TableCell>
                  <TableCell className="text-sm">{r.coldStorage?.name}</TableCell>
                  <TableCell className={`text-right font-medium ${r.totalDeltaWeight < 0 ? 'text-red-600' : r.totalDeltaWeight > 0 ? 'text-emerald-600' : ''}`}>{Number(r.totalDeltaWeight).toFixed(2)} kg</TableCell>
                  <TableCell className={`text-right font-medium ${r.totalDeltaQty < 0 ? 'text-red-600' : r.totalDeltaQty > 0 ? 'text-emerald-600' : ''}`}>{r.totalDeltaQty}</TableCell>
                  <TableCell><Badge className={r.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : r.status === 'submitted' ? 'bg-amber-100 text-amber-700' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.itemCount} items</TableCell>
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

function CreateOpnameDialog({ cs, onDone }) {
  const [form, setForm] = useState({ coldStorageId: '', opnameDate: new Date().toISOString().slice(0,10), notes: '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.coldStorageId) return toast.error('Pilih CS');
    setSaving(true);
    try {
      const res = await fetch('/api/opnames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Opname dibuat, items terisi dari system'); onDone();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Buat Stock Opname</DialogTitle><DialogDescription>Item otomatis diisi dari stock aktif di CS yang dipilih.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div><Label className="text-xs">Cold Storage *</Label><Select value={form.coldStorageId} onValueChange={v => setForm({ ...form, coldStorageId: v })}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{cs.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Tanggal</Label><Input type="date" value={form.opnameDate} onChange={e => setForm({ ...form, opnameDate: e.target.value })} /></div>
        <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
      <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Buat Opname</Button></DialogFooter>
    </DialogContent>
  );
}

function OpnameDetailDialog({ id, onClose, onRefresh, canApprove, canCreate }) {
  const { data, mutate } = useSWR(`/api/opnames/${id}`, fetcher);
  const [saving, setSaving] = useState(false);
  const [localItems, setLocalItems] = useState({});
  const op = data?.data;
  if (!op) return null;
  const items = op.items.map(it => ({ ...it, ...(localItems[it.id] || {}) }));
  const upd = (itId, k, v) => setLocalItems(l => ({ ...l, [itId]: { ...l[itId], [k]: v } }));

  const saveItems = async () => {
    setSaving(true);
    try {
      const payload = { items: items.map(it => ({ id: it.id, physicalQty: Number(it.physicalQty || 0), physicalWeight: Number(it.physicalWeight || 0), notes: it.notes })) };
      const res = await fetch(`/api/opnames/${id}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Tersimpan. Δ total: ${j.data.totalDeltaWeight.toFixed(2)}kg`);
      setLocalItems({}); mutate(); onRefresh();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const submit = async () => {
    await saveItems();
    const res = await fetch(`/api/opnames/${id}/submit`, { method: 'POST' });
    const j = await res.json();
    if (res.ok) { toast.success('Submitted, menunggu approval'); mutate(); onRefresh(); }
    else toast.error(j.error);
  };
  const approve = async () => {
    if (!confirm('Approve opname ini? Adjustment akan diterapkan ke stok.')) return;
    const res = await fetch(`/api/opnames/${id}/approve`, { method: 'POST' });
    const j = await res.json();
    if (res.ok) { toast.success('Approved. Stock adjusted + notif ke Direktur.'); mutate(); onRefresh(); }
    else toast.error(j.error);
  };
  const reject = async () => {
    const res = await fetch(`/api/opnames/${id}/reject`, { method: 'POST' });
    const j = await res.json();
    if (res.ok) { toast.success('Rejected'); mutate(); onRefresh(); }
  };
  const editable = op.status === 'draft' && canCreate;

  return (
    <Dialog open={!!id} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="font-mono">{op.opnameNumber}</DialogTitle>
            <Badge className={op.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : op.status === 'submitted' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100'}>{op.status}</Badge>
          </div>
          <DialogDescription>{op.coldStorage?.name} · {format(new Date(op.opnameDate), 'dd MMM yyyy')} · by {op.createdBy}</DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader><TableRow><TableHead>Kode</TableHead><TableHead>Produk</TableHead><TableHead className="text-right">Sys Qty</TableHead><TableHead className="text-right">Fisik Qty</TableHead><TableHead className="text-right">Sys Berat</TableHead><TableHead className="text-right">Fisik Berat</TableHead><TableHead className="text-right">Δ Qty</TableHead><TableHead className="text-right">Δ Berat</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(it => {
              const dq = Number(it.physicalQty || 0) - Number(it.systemQty);
              const dw = Number(it.physicalWeight || 0) - Number(it.systemWeight);
              return (
                <TableRow key={it.id}>
                  <TableCell className="font-mono text-xs">{it.stock?.kodeSimpan}</TableCell>
                  <TableCell className="text-sm">{it.product?.name}</TableCell>
                  <TableCell className="text-right">{it.systemQty}</TableCell>
                  <TableCell><Input type="number" className="h-8 text-right w-20 ml-auto" value={it.physicalQty} onChange={e => upd(it.id, 'physicalQty', e.target.value)} disabled={!editable} /></TableCell>
                  <TableCell className="text-right">{Number(it.systemWeight).toFixed(2)}</TableCell>
                  <TableCell><Input type="number" step="0.01" className="h-8 text-right w-24 ml-auto" value={it.physicalWeight} onChange={e => upd(it.id, 'physicalWeight', e.target.value)} disabled={!editable} /></TableCell>
                  <TableCell className={`text-right ${dq < 0 ? 'text-red-600' : dq > 0 ? 'text-emerald-600' : ''}`}>{dq}</TableCell>
                  <TableCell className={`text-right ${dw < 0 ? 'text-red-600' : dw > 0 ? 'text-emerald-600' : ''}`}>{dw.toFixed(2)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <DialogFooter className="flex-wrap gap-2">
          {editable && <Button variant="outline" onClick={saveItems} disabled={saving}><Save className="w-4 h-4 mr-1" />Simpan Fisik</Button>}
          {editable && <Button onClick={submit} disabled={saving}><Send className="w-4 h-4 mr-1" />Submit for Approval</Button>}
          {op.status === 'submitted' && canApprove && (
            <>
              <Button variant="destructive" onClick={reject}><XCircle className="w-4 h-4 mr-1" />Reject</Button>
              <Button onClick={approve}><CheckCircle2 className="w-4 h-4 mr-1" />Approve & Adjust</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
