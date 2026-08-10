'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Eye, ClipboardList, Loader2, Smartphone, Archive, ArchiveRestore } from 'lucide-react';
import { useSort, SortHead, ArchiveTabs, toggleArchive } from '@/lib/table-tools';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());
const WO_STATUSES = ['Draft', 'Disetujui', 'Dalam Proses', 'Selesai', 'Dibatalkan'];
export const WO_COLOR = {
  'Draft': 'bg-slate-100 text-slate-700',
  'Disetujui': 'bg-blue-100 text-blue-700',
  'Dalam Proses': 'bg-amber-100 text-amber-700',
  'Selesai': 'bg-emerald-100 text-emerald-700',
  'Dibatalkan': 'bg-red-100 text-red-700',
};

export default function WOListPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canCreate = ['admin', 'supervisor'].includes(role);
  const [statusTab, setStatusTab] = useState('all');
  const [mode, setMode] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('active');
  const sort = useSort();

  const params = new URLSearchParams();
  if (statusTab !== 'all') params.set('status', statusTab);
  if (mode !== 'all') params.set('mode', mode);
  if (q) params.set('q', q);
  if (view === 'archived') params.set('archived', '1');
  const { data, mutate, isLoading } = useSWR(`/api/work-orders?${params}`, fetcher);
  const rows = sort.sortRows(data?.data || [], {
    woNumber: r => r.woNumber, mode: r => r.mode, startDate: r => r.startDate,
    totalLiveBirdWeight: r => r.totalLiveBirdWeight, totalLiveBirdHeadCount: r => r.totalLiveBirdHeadCount,
    totalCost: r => r.totalCost, pipelineStatus: r => r.pipelineStatus,
  });

  const doArchive = async (r) => {
    if (!confirm(view === 'archived' ? 'Pulihkan WO ini dari arsip?' : 'Arsipkan WO ini? Data akan disembunyikan dari daftar aktif.')) return;
    const ok = await toggleArchive('work-orders', r.id, view === 'archived');
    if (ok) mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><ClipboardList className="w-8 h-8 text-purple-600" /> Work Orders</h1>
          <p className="text-muted-foreground mt-1">Produksi Internal / Maklon dengan tracking rendemen per stage</p>
        </div>
        <div className="flex gap-2">
          <Link href="/tally"><Button variant="outline"><Smartphone className="w-4 h-4 mr-2" />Tally App</Button></Link>
          {canCreate && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" />WO Baru</Button></DialogTrigger>
              <CreateWODialog onSaved={() => { setOpen(false); mutate(); }} />
            </Dialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <Tabs value={statusTab} onValueChange={setStatusTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="all">Semua</TabsTrigger>
              {WO_STATUSES.map(st => <TabsTrigger key={st} value={st}>{st}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Cari nomor WO..." value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
            </div>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua Mode</SelectItem><SelectItem value="Internal">Internal</SelectItem><SelectItem value="Maklon">Maklon</SelectItem></SelectContent>
            </Select>
            <ArchiveTabs value={view} onChange={setView} className="sm:ml-auto" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <SortHead field="woNumber" sort={sort}>No WO</SortHead>
              <SortHead field="mode" sort={sort}>Mode</SortHead>
              <TableHead>PO Ref</TableHead>
              <SortHead field="startDate" sort={sort}>Tgl Mulai</SortHead>
              <SortHead field="totalLiveBirdWeight" sort={sort} className="text-right">Berat LB</SortHead>
              <SortHead field="totalLiveBirdHeadCount" sort={sort} className="text-right">Ekor</SortHead>
              <SortHead field="totalCost" sort={sort} className="text-right">Total Cost</SortHead>
              <SortHead field="pipelineStatus" sort={sort}>Status</SortHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Belum ada WO</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50">
                  <TableCell className="font-mono font-semibold text-xs">{r.woNumber}</TableCell>
                  <TableCell><Badge variant="outline">{r.mode}</Badge>{r.maklon && <div className="text-xs text-muted-foreground mt-1">{r.maklon.name}</div>}</TableCell>
                  <TableCell className="text-xs font-mono">{r.po?.poNumber || '-'}<div className="text-muted-foreground">{r.po?.method}</div></TableCell>
                  <TableCell className="text-sm">{r.startDate && format(new Date(r.startDate), 'dd MMM yyyy')}</TableCell>
                  <TableCell className="text-right">{Number(r.totalLiveBirdWeight || 0).toLocaleString('id-ID')} kg</TableCell>
                  <TableCell className="text-right">{r.totalLiveBirdHeadCount || 0}{r.ekorMati > 0 && <div className="text-xs text-red-600">-{r.ekorMati} mati</div>}</TableCell>
                  <TableCell className="text-right font-medium">Rp {Number(r.totalCost || 0).toLocaleString('id-ID')}</TableCell>
                  <TableCell><Badge className={WO_COLOR[r.pipelineStatus]}>{r.pipelineStatus}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Link href={`/dashboard/work-orders/${r.id}`}><Button size="icon" variant="ghost"><Eye className="w-4 h-4" /></Button></Link>
                    {canCreate && (view === 'archived'
                      ? <Button size="icon" variant="ghost" title="Pulihkan" onClick={() => doArchive(r)}><ArchiveRestore className="w-4 h-4 text-emerald-600" /></Button>
                      : <Button size="icon" variant="ghost" title="Arsipkan" onClick={() => doArchive(r)}><Archive className="w-4 h-4 text-amber-600" /></Button>)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateWODialog({ onSaved }) {
  const [form, setForm] = useState({ mode: 'Internal', purchaseOrderId: '', maklonSupplierId: '', maklonRatePerKg: 0, startDate: new Date().toISOString().slice(0,10), baseCost: 0, notes: '' });
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const { data: pos } = useSWR('/api/purchase-orders?type=Live Bird', fetcher);
  const { data: rphs } = useSWR('/api/contacts?type=RPH', fetcher);

  const selectedPo = (pos?.data || []).find(p => p.id === form.purchaseOrderId);
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      // If PO selected and baseCost is 0, use PO total_amount as base
      if (selectedPo && !form.baseCost) payload.baseCost = Number(selectedPo.totalAmount || 0);
      const res = await fetch('/api/work-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('WO dibuat: ' + j.data.woNumber);
      onSaved();
      router.push(`/dashboard/work-orders/${j.data.id}`);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Buat Work Order</DialogTitle>
        <DialogDescription>WO dibuat SEBELUM live bird datang. Data timbang dicatat setelah kedatangan.</DialogDescription>
      </DialogHeader>
      <div className="grid sm:grid-cols-2 gap-4">
        <F label="Mode Produksi *">
          <Select value={form.mode} onValueChange={v => upd('mode', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Internal">Internal</SelectItem><SelectItem value="Maklon">Maklon (RPH Pihak Ketiga)</SelectItem></SelectContent>
          </Select>
        </F>
        <F label="Tanggal Mulai *"><Input type="date" value={form.startDate} onChange={e => upd('startDate', e.target.value)} /></F>
        {form.mode === 'Maklon' && (
          <>
            <F label="RPH Maklon *">
              <Select value={form.maklonSupplierId} onValueChange={v => upd('maklonSupplierId', v)}>
                <SelectTrigger><SelectValue placeholder="Pilih RPH" /></SelectTrigger>
                <SelectContent>{(rphs?.data || []).map(r => <SelectItem key={r.id} value={r.id}>{r.code} - {r.displayName}</SelectItem>)}</SelectContent>
              </Select>
            </F>
            <F label="Tarif Maklon per kg (Live Bird)"><Input type="number" value={form.maklonRatePerKg} onChange={e => upd('maklonRatePerKg', Number(e.target.value))} /></F>
          </>
        )}
        <F label="PO Live Bird (Ref)" className="sm:col-span-2">
          <Select value={form.purchaseOrderId} onValueChange={v => upd('purchaseOrderId', v)}>
            <SelectTrigger><SelectValue placeholder="Opsional: link ke PO" /></SelectTrigger>
            <SelectContent>{(pos?.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.poNumber} - {p.supplier?.name} ({p.method})</SelectItem>)}</SelectContent>
          </Select>
          {selectedPo && <div className="text-xs text-muted-foreground mt-1">Total PO: Rp {Number(selectedPo.totalAmount).toLocaleString('id-ID')} · Method: {selectedPo.method}</div>}
        </F>
        <F label="Base Cost (Rp) - default dari PO" className="sm:col-span-2">
          <CurrencyInput value={form.baseCost} onChange={v => upd('baseCost', v)} placeholder={selectedPo ? String(selectedPo.totalAmount) : '0'} />
        </F>
        <F label="Catatan" className="sm:col-span-2"><Textarea rows={2} value={form.notes} onChange={e => upd('notes', e.target.value)} /></F>
      </div>
      <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan WO</Button></DialogFooter>
    </DialogContent>
  );
}

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
