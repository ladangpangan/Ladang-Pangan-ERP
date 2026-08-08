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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Boxes, Search, Loader2, ArrowRightLeft, PackageMinus, Scissors, ClipboardCheck, AlertTriangle, Trash2, Plus, Eye, LayoutList, LayoutGrid, ChevronDown, ChevronRight, ShoppingCart, ClipboardList, Package } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { pkgLabel } from '@/lib/constants';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function InventoryPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canOperate = ['admin', 'supervisor', 'operator'].includes(role);
  const canManage = ['admin', 'supervisor'].includes(role);

  const [filter, setFilter] = useState({ cs: 'all', product: 'all', status: 'active', sort: 'FEFO', q: '' });
  const [selected, setSelected] = useState([]);
  const [viewMode, setViewMode] = useState('flat'); // 'flat' or 'grouped'
  const [expandedGroups, setExpandedGroups] = useState({}); // { key: bool }

  const { data: cs } = useSWR('/api/cold-storages', fetcher);
  const { data: prods } = useSWR('/api/products', fetcher);

  const params = new URLSearchParams();
  if (filter.cs !== 'all') params.set('cold_storage_id', filter.cs);
  if (filter.product !== 'all') params.set('product_id', filter.product);
  params.set('status', filter.status);
  params.set('sort', filter.sort);
  if (filter.q) params.set('q', filter.q);
  const { data, mutate, isLoading } = useSWR(`/api/inventory/stocks?${params}`, fetcher);
  const rows = data?.data || [];
  const summary = data?.summary || {};

  const toggleAll = () => setSelected(selected.length === rows.length ? [] : rows.map(r => r.id));
  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Boxes className="w-8 h-8 text-cyan-600" /> Inventory</h1>
          <p className="text-muted-foreground mt-1">Stok cold storage dengan FIFO/FEFO, kode simpan tracking, traceability ke PO/WO</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/inventory/opnames"><Button variant="outline"><ClipboardCheck className="w-4 h-4 mr-2" />Stock Opname</Button></Link>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total Rows" value={summary.totalRows || 0} />
        <Stat label="Total Berat" value={`${Number(summary.totalWeight || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })} kg`} color="emerald" />
        <Stat label="Near Expiry (≤7d)" value={summary.nearExpiry || 0} color={summary.nearExpiry > 0 ? 'amber' : 'slate'} />
        <Stat label="Expired" value={summary.expired || 0} color={summary.expired > 0 ? 'red' : 'slate'} />
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Cari Kode Simpan..." value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} className="pl-9" />
            </div>
            <Select value={filter.cs} onValueChange={v => setFilter({ ...filter, cs: v })}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Cold Storage" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua CS</SelectItem>{(cs?.data || []).map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filter.product} onValueChange={v => setFilter({ ...filter, product: v })}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Produk" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Semua Produk</SelectItem>{(prods?.data || []).map(p => <SelectItem key={p.id} value={p.id}>{p.sku}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filter.sort} onValueChange={v => setFilter({ ...filter, sort: v })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="FEFO">FEFO</SelectItem><SelectItem value="FIFO">FIFO</SelectItem></SelectContent>
            </Select>
            <Select value={filter.status} onValueChange={v => setFilter({ ...filter, status: v })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="opened">Opened</SelectItem><SelectItem value="used">Used</SelectItem><SelectItem value="damaged">Damaged</SelectItem><SelectItem value="all">Semua</SelectItem></SelectContent>
            </Select>
            <div className="flex gap-1 border rounded-md p-1">
              <Button
                size="sm"
                variant={viewMode === 'flat' ? 'default' : 'ghost'}
                onClick={() => setViewMode('flat')}
                className="h-7 px-2"
                title="Tampilan tabel"
              >
                <LayoutList className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'grouped' ? 'default' : 'ghost'}
                onClick={() => setViewMode('grouped')}
                className="h-7 px-2"
                title="Group by PO/WO"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {selected.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-slate-100">
              <span className="text-sm font-semibold">{selected.length} dipilih</span>
              {canManage && <TransferCsDialog stockIds={selected} onDone={() => { setSelected([]); mutate(); }} cs={cs?.data || []} />}
              {canOperate && <TransferZoneDialog stockIds={selected} onDone={() => { setSelected([]); mutate(); }} rows={rows} cs={cs?.data || []} />}
              {canManage && <OutboundDialog stockIds={selected} onDone={() => { setSelected([]); mutate(); }} />}
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}><Trash2 className="w-4 h-4 mr-1" />Clear</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <div className="p-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
          {!isLoading && rows.length === 0 && <div className="p-8 text-center text-muted-foreground">Belum ada stock</div>}
          {!isLoading && rows.length > 0 && viewMode === 'grouped' && (
            <GroupedView rows={rows} selected={selected} toggle={toggle} canOperate={canOperate} mutate={mutate} expandedGroups={expandedGroups} setExpandedGroups={setExpandedGroups} />
          )}
          {!isLoading && rows.length > 0 && viewMode === 'flat' && (
          <Table>
            <TableHeader><TableRow>
              {canOperate && <TableHead className="w-10"><Checkbox checked={selected.length === rows.length && rows.length > 0} onCheckedChange={toggleAll} /></TableHead>}
              <TableHead>Kode Simpan</TableHead><TableHead>Produk</TableHead>
              <TableHead>CS / Zone</TableHead><TableHead>Pkg</TableHead>
              <TableHead className="text-right">Berat</TableHead><TableHead className="text-right">Qty</TableHead>
              <TableHead>Expired</TableHead><TableHead>Source</TableHead>
              <TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className={selected.includes(r.id) ? 'bg-emerald-50' : 'hover:bg-slate-50'}>
                  {canOperate && <TableCell><Checkbox checked={selected.includes(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>}
                  <TableCell className="font-mono font-bold text-xs">{r.kodeSimpan}</TableCell>
                  <TableCell><div className="font-medium">{r.product?.name}</div><div className="text-xs text-muted-foreground font-mono">{r.product?.sku}</div></TableCell>
                  <TableCell className="text-xs">{r.coldStorage?.code}{r.zone && <div>{r.zone.code}</div>}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{pkgLabel(r.packagingType)}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{Number(r.weight).toFixed(2)} kg</TableCell>
                  <TableCell className="text-right">{r.quantity}</TableCell>
                  <TableCell className="text-sm">{r.expiredDate ? <><div>{format(new Date(r.expiredDate), 'dd MMM yyyy')}</div>{r.daysToExpire !== null && <div className={`text-xs ${r.daysToExpire < 0 ? 'text-red-600 font-bold' : r.daysToExpire <= 7 ? 'text-amber-600' : 'text-muted-foreground'}`}>{r.daysToExpire < 0 ? `Expired ${-r.daysToExpire}d` : `${r.daysToExpire}d`}</div>}</> : '-'}</TableCell>
                  <TableCell className="text-xs">{r.source?.number ? <Badge variant="secondary" className="font-mono">{r.sourceType} · {r.source.number}</Badge> : (r.sourceType ? <Badge variant="secondary">{r.sourceType}</Badge> : '-')}</TableCell>
                  <TableCell><Badge className={r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : r.status === 'damaged' ? 'bg-red-100 text-red-700' : r.status === 'opened' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}>{r.status}</Badge></TableCell>
                  <TableCell className="space-x-1">
                    <Link href={`/dashboard/inventory/${r.id}`}><Button size="icon" variant="ghost"><Eye className="w-4 h-4" /></Button></Link>
                    {canOperate && (r.packagingType === 'karung' || r.packagingType === 'colly') && r.status === 'active' && <SplitKarungButton stock={r} onDone={mutate} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, color = 'slate' }) {
  const c = { emerald: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600', slate: 'text-slate-900' }[color];
  return <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase">{label}</div><div className={`text-2xl font-bold mt-1 ${c}`}>{value}</div></CardContent></Card>;
}

function GroupedView({ rows, selected, toggle, canOperate, mutate, expandedGroups, setExpandedGroups }) {
  // Group by sourceType + sourceBatch (or 'manual' if empty)
  const groups = {};
  for (const r of rows) {
    const key = r.sourceType && r.sourceBatch ? `${r.sourceType}::${r.sourceBatch}` : 'MANUAL';
    if (!groups[key]) {
      groups[key] = {
        key,
        sourceType: r.sourceType || 'MANUAL',
        sourceNumber: r.source?.number || null,
        sourceOrderDate: r.source?.orderDate || r.source?.startDate || null,
        items: [],
        totalWeight: 0,
        productSet: new Set(),
      };
    }
    groups[key].items.push(r);
    groups[key].totalWeight += Number(r.weight || 0);
    if (r.product?.name) groups[key].productSet.add(r.product.name);
  }
  const groupsList = Object.values(groups).sort((a, b) => {
    // MANUAL last, else newest source first
    if (a.sourceType === 'MANUAL') return 1;
    if (b.sourceType === 'MANUAL') return -1;
    return (b.sourceOrderDate || 0) - (a.sourceOrderDate || 0);
  });

  const toggleGroup = (key) => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="divide-y">
      {groupsList.map(g => {
        const isExpanded = expandedGroups[g.key] !== false; // default expanded
        const Icon = g.sourceType === 'PO' ? ShoppingCart : g.sourceType === 'WO' ? ClipboardList : Package;
        const badgeColor = g.sourceType === 'PO' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                           g.sourceType === 'WO' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                           'bg-slate-100 text-slate-700 border-slate-200';
        return (
          <div key={g.key}>
            <button
              type="button"
              onClick={() => toggleGroup(g.key)}
              className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 text-left"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              <Icon className="w-5 h-5 text-slate-600" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={`font-mono text-xs ${badgeColor}`}>
                    {g.sourceType}{g.sourceNumber ? ` · ${g.sourceNumber}` : ''}
                  </Badge>
                  <span className="text-sm font-semibold">{g.items.length} kode simpan</span>
                  <span className="text-xs text-muted-foreground">
                    · {Array.from(g.productSet).slice(0, 2).join(', ')}
                    {g.productSet.size > 2 && ` +${g.productSet.size - 2} lain`}
                  </span>
                </div>
                {g.sourceOrderDate && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(g.sourceOrderDate), 'dd MMM yyyy')}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-emerald-700">{g.totalWeight.toFixed(1)} kg</div>
                <div className="text-[10px] text-muted-foreground uppercase">total</div>
              </div>
            </button>
            {isExpanded && (
              <div className="bg-slate-50/50 px-4 pb-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canOperate && <TableHead className="w-10"></TableHead>}
                      <TableHead>Kode Simpan</TableHead>
                      <TableHead>Produk</TableHead>
                      <TableHead>CS / Zone</TableHead>
                      <TableHead>Pkg</TableHead>
                      <TableHead className="text-right">Berat</TableHead>
                      <TableHead>Expired</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map(r => (
                      <TableRow key={r.id} className={selected.includes(r.id) ? 'bg-emerald-50' : 'hover:bg-white'}>
                        {canOperate && <TableCell><Checkbox checked={selected.includes(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>}
                        <TableCell className="font-mono font-bold text-xs">{r.kodeSimpan}</TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{r.product?.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">{r.product?.sku}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.coldStorage?.code}{r.zone && <div>{r.zone.code}</div>}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{pkgLabel(r.packagingType)}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{Number(r.weight).toFixed(2)} kg</TableCell>
                        <TableCell className="text-sm">
                          {r.expiredDate ? (
                            <>
                              <div>{format(new Date(r.expiredDate), 'dd MMM yyyy')}</div>
                              {r.daysToExpire !== null && (
                                <div className={`text-xs ${r.daysToExpire < 0 ? 'text-red-600 font-bold' : r.daysToExpire <= 7 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                  {r.daysToExpire < 0 ? `Expired ${-r.daysToExpire}d` : `${r.daysToExpire}d`}
                                </div>
                              )}
                            </>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className={r.status === 'active' ? 'bg-emerald-100 text-emerald-700' : r.status === 'damaged' ? 'bg-red-100 text-red-700' : r.status === 'opened' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="space-x-1">
                          <Link href={`/dashboard/inventory/${r.id}`}><Button size="icon" variant="ghost"><Eye className="w-4 h-4" /></Button></Link>
                          {canOperate && (r.packagingType === 'karung' || r.packagingType === 'colly') && r.status === 'active' && <SplitKarungButton stock={r} onDone={mutate} />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TransferCsDialog({ stockIds, onDone, cs }) {
  const [open, setOpen] = useState(false);
  const [toCs, setToCs] = useState(''); const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!toCs) return toast.error('Pilih CS tujuan');
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/transfer-cs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stockIds, toColdStorageId: toCs, notes }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Transfer ${j.data.moved} stock ke CS baru + BA dibuat`); setOpen(false); onDone();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><ArrowRightLeft className="w-4 h-4 mr-1" />Transfer CS</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Transfer antar Cold Storage</DialogTitle><DialogDescription>Berita Acara otomatis dibuat.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Cold Storage Tujuan *</Label><Select value={toCs} onValueChange={setToCs}><SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger><SelectContent>{cs.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Transfer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferZoneDialog({ stockIds, onDone, rows, cs }) {
  const [open, setOpen] = useState(false);
  const [toZone, setToZone] = useState(''); const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const first = rows.find(r => stockIds.includes(r.id));
  const { data: zones } = useSWR(first?.coldStorageId ? `/api/zones?cold_storage_id=${first.coldStorageId}` : null, fetcher);
  const save = async () => {
    if (!toZone) return toast.error('Pilih zone tujuan');
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/transfer-zone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stockIds, toZoneId: toZone, notes }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Transfer zone: ${j.data.moved} stock`); setOpen(false); onDone();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><ArrowRightLeft className="w-4 h-4 mr-1" />Transfer Zone</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Transfer antar Zone (dalam CS yang sama)</DialogTitle><DialogDescription>Mutasi saja, tanpa BA.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Zone Tujuan *</Label><Select value={toZone} onValueChange={setToZone}><SelectTrigger><SelectValue placeholder="Pilih zone" /></SelectTrigger><SelectContent>{(zones?.data || []).map(z => <SelectItem key={z.id} value={z.id}>{z.code} - {z.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Transfer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutboundDialog({ stockIds, onDone }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subtype: 'non_sales', reason: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form.reason) return toast.error('Alasan wajib');
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/outbound', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stockIds, ...form }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      const msg = j.data.status === 'pending' ? 'Pending approval admin' : 'Outbound tercatat + BA';
      toast.success(msg); setOpen(false); onDone();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><PackageMinus className="w-4 h-4 mr-1" />Outbound (Sample/Rusak)</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Outbound Non-Sales / Kerusakan</DialogTitle><DialogDescription>Berita Acara otomatis dibuat. Kerusakan butuh approval admin.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Jenis</Label><Select value={form.subtype} onValueChange={v => setForm({ ...form, subtype: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="non_sales">Non-Sales (Sample, dll)</SelectItem><SelectItem value="damage">Rusak / Susut</SelectItem></SelectContent></Select></div>
          <div><Label className="text-xs">Alasan *</Label><Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Sample untuk QC, Rusak transport, dll" /></div>
          <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          {form.subtype === 'damage' && <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm"><AlertTriangle className="w-4 h-4 inline mr-1" />Kerusakan: butuh approval admin, notif ke Supervisor + Direktur. Bukan bagian dari HPP.</div>}
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitKarungButton({ stock, onDone }) {
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState([{ weight: 0, quantity: 1 }]);
  const [saving, setSaving] = useState(false);
  const upd = (i, k, v) => { const arr = [...packs]; arr[i] = { ...arr[i], [k]: v }; setPacks(arr); };
  const add = () => setPacks([...packs, { weight: 0, quantity: 1 }]);
  const remove = (i) => setPacks(packs.filter((_, idx) => idx !== i));
  const totalW = packs.reduce((a, b) => a + Number(b.weight || 0), 0);
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/inventory/split-karung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stockId: stock.id, packs }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Karung dibuka → ${j.data.childStockIds.length} pack baru dengan kode simpan masing-masing`);
      setOpen(false); onDone();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon" variant="ghost" title="Buka Karung"><Scissors className="w-4 h-4" /></Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Buka Karung {stock.kodeSimpan}</DialogTitle><DialogDescription>Karung akan disegel (opened), setiap pack mendapatkan kode simpan baru.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm p-3 bg-slate-50 rounded">Berat karung: <b>{stock.weight} kg</b> · Total pack: <b>{totalW.toFixed(2)} kg</b>{Math.abs(totalW - stock.weight) > 0.01 && <span className="text-amber-600 ml-2">⚠️ delta {(stock.weight - totalW).toFixed(2)} kg</span>}</div>
          {packs.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-2 text-sm font-semibold">Pack {i + 1}</div>
              <div className="col-span-4"><Label className="text-xs">Berat (kg)</Label><Input type="number" step="0.01" value={p.weight} onChange={e => upd(i, 'weight', Number(e.target.value))} /></div>
              <div className="col-span-4"><Label className="text-xs">Qty</Label><Input type="number" value={p.quantity} onChange={e => upd(i, 'quantity', Number(e.target.value))} /></div>
              <div className="col-span-2"><Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button></div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={add}><Plus className="w-4 h-4 mr-1" />Tambah Pack</Button>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Buka Karung</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
