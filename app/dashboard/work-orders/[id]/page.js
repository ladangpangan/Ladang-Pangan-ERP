'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, Truck, Layers, Calculator, DollarSign, BarChart3, Plus, Trash2, PackageCheck, AlertTriangle, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { WO_COLOR } from '../page';

const fetcher = (url) => fetch(url).then(r => r.json());
const WO_FLOW = { 'Draft': ['Disetujui', 'Dibatalkan'], 'Disetujui': ['Dalam Proses', 'Dibatalkan'], 'Dalam Proses': ['Selesai', 'Dibatalkan'], 'Selesai': [], 'Dibatalkan': [] };
const STEPS = ['Draft', 'Disetujui', 'Dalam Proses', 'Selesai'];

export default function WODetailPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canEdit = ['admin', 'supervisor'].includes(role);
  const canOperate = ['admin', 'supervisor', 'operator'].includes(role);
  const { data, mutate, isLoading } = useSWR(`/api/work-orders/${id}`, fetcher);
  const wo = data?.data;

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!wo) return <div className="text-center py-20 text-muted-foreground">WO tidak ditemukan</div>;
  const currentIdx = STEPS.indexOf(wo.pipelineStatus);
  const allowedNext = WO_FLOW[wo.pipelineStatus] || [];

  const transition = async (target) => {
    if (!confirm(`Ubah status ke "${target}"?`)) return;
    const res = await fetch(`/api/work-orders/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: target }) });
    const j = await res.json();
    if (res.ok) { toast.success('Status: ' + target); mutate(); } else toast.error(j.error);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard/work-orders"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{wo.woNumber}</h1>
            <Badge className={WO_COLOR[wo.pipelineStatus]}>{wo.pipelineStatus}</Badge>
            <Badge variant="outline">{wo.mode}</Badge>
            {wo.maklon && <Badge variant="secondary">{wo.maklon.displayName}</Badge>}
            {wo.po && <Badge variant="secondary">{wo.po.poNumber} - {wo.po.method}</Badge>}
          </div>
          <p className="text-muted-foreground text-sm mt-1">Start: {wo.startDate && format(new Date(wo.startDate), 'dd MMM yyyy')}{wo.arrivalRecordedAt && <span> · Arrival: {format(new Date(wo.arrivalRecordedAt), 'dd MMM yyyy HH:mm')}</span>}</p>
        </div>
        {canEdit && allowedNext.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {allowedNext.map(a => (
              <Button key={a} size="sm" variant={a === 'Dibatalkan' ? 'destructive' : 'default'} onClick={() => transition(a)}>
                {a === 'Dibatalkan' ? <XCircle className="w-4 h-4 mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}{a}
              </Button>
            ))}
          </div>
        )}
      </div>

      <Card><CardContent className="pt-6">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex-1 min-w-[80px]">
              <div className={`h-2 rounded-full ${idx <= currentIdx && wo.pipelineStatus !== 'Dibatalkan' ? 'bg-emerald-500' : 'bg-slate-200'}`} />
              <div className={`text-xs mt-2 ${idx === currentIdx ? 'font-bold text-emerald-700' : 'text-muted-foreground'}`}>{step}</div>
            </div>
          ))}
        </div>
      </CardContent></Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Berat Live Bird" value={`${Number(wo.totalLiveBirdWeight).toLocaleString('id-ID')} kg`} sub={`${wo.totalLiveBirdHeadCount} ekor · BW ${Number(wo.bwAvg).toFixed(2)}kg`} />
        <Stat label="Total Cost" value={`Rp ${Number(wo.totalCost).toLocaleString('id-ID')}`} sub={`Base + Maklon + Custom`} />
        <Stat label="Total Rendemen" value={`${Number(wo.totalRendemenWeight).toLocaleString('id-ID')} kg`} sub={wo.totalLiveBirdWeight > 0 ? `${((wo.totalRendemenWeight / wo.totalLiveBirdWeight) * 100).toFixed(1)}% dari LB` : '-'} color="emerald" />
        <Stat label="Ekor Mati" value={`${wo.ekorMati || 0} ekor`} sub={wo.po?.method || '-'} color={wo.ekorMati > 0 ? 'red' : 'slate'} />
      </div>

      <Tabs defaultValue="arrival">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-6">
          <TabsTrigger value="arrival"><Truck className="w-4 h-4 mr-1" />Kedatangan</TabsTrigger>
          <TabsTrigger value="stages"><Layers className="w-4 h-4 mr-1" />Stages</TabsTrigger>
          <TabsTrigger value="outputs"><PackageCheck className="w-4 h-4 mr-1" />Outputs</TabsTrigger>
          <TabsTrigger value="hpp"><Calculator className="w-4 h-4 mr-1" />HPP</TabsTrigger>
          <TabsTrigger value="costs"><DollarSign className="w-4 h-4 mr-1" />Costs</TabsTrigger>
          <TabsTrigger value="report"><BarChart3 className="w-4 h-4 mr-1" />Rendemen</TabsTrigger>
        </TabsList>

        <TabsContent value="arrival"><ArrivalTab wo={wo} onSaved={mutate} canOperate={canOperate} /></TabsContent>
        <TabsContent value="stages"><StagesTab wo={wo} onSaved={mutate} canOperate={canOperate} /></TabsContent>
        <TabsContent value="outputs"><OutputsTab wo={wo} onSaved={mutate} canOperate={canOperate} canEdit={canEdit} /></TabsContent>
        <TabsContent value="hpp"><HppTab woId={wo.id} /></TabsContent>
        <TabsContent value="costs"><CostsTab wo={wo} onSaved={mutate} canEdit={canEdit} /></TabsContent>
        <TabsContent value="report"><ReportTab woId={wo.id} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, sub, color = 'slate' }) {
  const c = { emerald: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', slate: 'text-slate-900' }[color] || '';
  return <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground uppercase">{label}</div><div className={`text-2xl font-bold mt-1 ${c}`}>{value}</div><div className="text-xs text-muted-foreground mt-1">{sub}</div></CardContent></Card>;
}
function F({ label, children, className = '' }) { return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>; }

function ArrivalTab({ wo, onSaved, canOperate }) {
  const [form, setForm] = useState({ totalWeight: wo.totalLiveBirdWeight || 0, totalHeadCount: wo.totalLiveBirdHeadCount || 0, ekorMati: wo.ekorMati || 0, notes: '' });
  const [saving, setSaving] = useState(false);
  const bwAvg = form.totalHeadCount > 0 ? (form.totalWeight / form.totalHeadCount).toFixed(3) : '0';
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/work-orders/${wo.id}/arrival`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Kedatangan tercatat');
      if (j.data?.ekorMatiImpact) toast.info(j.data.ekorMatiImpact.note, { duration: 6000 });
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Kedatangan Live Bird</CardTitle><CardDescription>Catat total berat, total ekor, dan ekor mati. BW rata-rata dihitung otomatis.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-4">
          <F label="Total Berat (kg) *"><Input type="number" value={form.totalWeight} onChange={e => setForm({ ...form, totalWeight: Number(e.target.value) })} disabled={!canOperate} /></F>
          <F label="Total Ekor *"><Input type="number" value={form.totalHeadCount} onChange={e => setForm({ ...form, totalHeadCount: Number(e.target.value) })} disabled={!canOperate} /></F>
          <F label="Ekor Mati"><Input type="number" value={form.ekorMati} onChange={e => setForm({ ...form, ekorMati: Number(e.target.value) })} disabled={!canOperate} /></F>
          <F label="BW Rata-rata (kg/ekor)"><Input value={bwAvg} disabled /></F>
          <F label="Ekor Hidup Diterima"><Input value={(Number(form.totalHeadCount) - Number(form.ekorMati))} disabled /></F>
          <F label="Notes"><Textarea rows={1} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} disabled={!canOperate} /></F>
        </div>
        {form.ekorMati > 0 && wo.po?.method && (
          <div className={`p-3 rounded-lg text-sm ${wo.po.method === 'Timbang Ulang' ? 'bg-blue-50 border border-blue-200' : 'bg-amber-50 border border-amber-200'}`}>
            <AlertTriangle className="w-4 h-4 inline mr-1" /> Metode PO <b>{wo.po.method}</b>: {wo.po.method === 'Timbang Ulang' ? 'Ekor mati akan memotong invoice supplier' : 'Ekor mati akan menaikkan HPP per kg'}
          </div>
        )}
        {canOperate && <div className="flex justify-end"><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan Kedatangan</Button></div>}
      </CardContent>
    </Card>
  );
}

const STAGE_DEFS_LEGACY_REMOVED = true; // Stages now driven by master data (wo_stages) via StagesTab

function StagesTab({ wo, onSaved, canOperate }) {
  const { data: stagesData } = useSWR('/api/wo-stages?active=1', fetcher);
  const stages = stagesData?.data || [];
  const { data: recordsData, mutate: refetchRecords } = useSWR(`/api/work-orders/${wo.id}/stage-records`, fetcher);
  const records = recordsData?.data || [];

  const [open, setOpen] = useState(false);
  const [stageId, setStageId] = useState('');
  const [values, setValues] = useState({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const { data: sessionData } = useSession();
  const canDelete = ['admin', 'supervisor'].includes(sessionData?.user?.role);

  const selectedStage = stages.find(s => s.id === stageId);
  const fieldsSchema = (() => {
    if (!selectedStage) return [];
    try {
      const arr = JSON.parse(selectedStage.fieldsSchema || '[]');
      return Array.isArray(arr) ? arr.sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
    } catch (e) { return []; }
  })();

  const resetForm = () => {
    const obj = {};
    fieldsSchema.forEach(f => { obj[f.key] = f.default !== undefined ? String(f.default) : ''; });
    setValues(obj);
    setNotes('');
  };

  const openDialog = () => {
    setStageId('');
    setValues({});
    setNotes('');
    setOpen(true);
  };

  const onStageChange = (v) => {
    setStageId(v);
    // Reset values based on new stage schema
    const st = stages.find(x => x.id === v);
    let schema = [];
    try { schema = JSON.parse(st?.fieldsSchema || '[]'); } catch (e) {}
    const obj = {};
    schema.forEach(f => { obj[f.key] = f.default !== undefined ? String(f.default) : ''; });
    setValues(obj);
  };

  const save = async () => {
    if (!stageId) { toast.error('Pilih stage dulu'); return; }
    // Validate required
    for (const f of fieldsSchema) {
      if (f.required && (values[f.key] === undefined || values[f.key] === '' || values[f.key] === null)) {
        toast.error(`Field wajib: ${f.label}`); return;
      }
    }
    setSaving(true);
    try {
      const payload = { records: [{ stageId, fieldValues: values, notes, recordedAt: new Date().toISOString() }] };
      const res = await fetch(`/api/work-orders/${wo.id}/stage-records`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`${selectedStage.name} tercatat`);
      setOpen(false);
      refetchRecords();
      if (onSaved) onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const removeRecord = async (recId) => {
    if (!confirm('Hapus record ini?')) return;
    try {
      const res = await fetch(`/api/work-orders/${wo.id}/stage-records/${recId}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Record dihapus');
      refetchRecords();
    } catch (e) { toast.error(e.message); }
  };

  const renderFieldInput = (f) => {
    const v = values[f.key] ?? '';
    const set = (val) => setValues(prev => ({ ...prev, [f.key]: val }));
    if (f.type === 'textarea') return <Textarea value={v} onChange={(e) => set(e.target.value)} rows={2} />;
    if (f.type === 'select') {
      const opts = Array.isArray(f.options) ? f.options : (typeof f.options === 'string' ? f.options.split(',').map(s => s.trim()).filter(Boolean) : []);
      return (
        <Select value={v} onValueChange={set}>
          <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
          <SelectContent>{opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (f.type === 'boolean') return (
      <div className="flex items-center gap-2 pt-2">
        <Switch checked={v === true || v === 'true'} onCheckedChange={(b) => set(b)} />
        <span className="text-sm text-muted-foreground">{(v === true || v === 'true') ? 'Ya' : 'Tidak'}</span>
      </div>
    );
    if (f.type === 'date') return <Input type="date" value={v} onChange={(e) => set(e.target.value)} />;
    if (f.type === 'datetime') return <Input type="datetime-local" value={v} onChange={(e) => set(e.target.value)} />;
    if (f.type === 'number') return (
      <div className="relative">
        <Input type="number" step="any" value={v} onChange={(e) => set(e.target.value)} />
        {f.unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{f.unit}</span>}
      </div>
    );
    return <Input value={v} onChange={(e) => set(e.target.value)} />;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Log Stage Produksi</CardTitle>
          <CardDescription>
            Field dinamis mengikuti master WO Stages · <Link href="/dashboard/masters/wo-stages" className="text-emerald-700 hover:underline">Kelola master</Link>
          </CardDescription>
        </div>
        {canOperate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" onClick={openDialog}><Plus className="w-4 h-4 mr-1" />Catat Stage</Button></DialogTrigger>
            <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Catat Stage Produksi</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Stage *</Label>
                  <Select value={stageId} onValueChange={onStageChange}>
                    <SelectTrigger><SelectValue placeholder="Pilih stage..." /></SelectTrigger>
                    <SelectContent>
                      {stages.length === 0 && <div className="p-3 text-xs text-muted-foreground">Belum ada stage aktif. Buat di master.</div>}
                      {stages.map(st => (
                        <SelectItem key={st.id} value={st.id}>
                          <span className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: st.color || '#3b82f6' }}></span>
                            <span className="font-medium">{st.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">· {st.code}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedStage?.description && <p className="text-xs text-muted-foreground mt-1">{selectedStage.description}</p>}
                </div>
                {selectedStage && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {fieldsSchema.length === 0 && (
                        <div className="col-span-2 text-xs text-muted-foreground text-center py-2 border border-dashed rounded">Stage ini belum punya field. Tambahkan via master.</div>
                      )}
                      {fieldsSchema.map(f => (
                        <div key={f.key} className={f.type === 'textarea' ? 'col-span-2' : ''}>
                          <Label className="text-xs">
                            {f.label}
                            {f.required && <span className="text-red-500 ml-1">*</span>}
                            {f.unit ? <span className="text-muted-foreground ml-1">({f.unit})</span> : null}
                          </Label>
                          {renderFieldInput(f)}
                        </div>
                      ))}
                    </div>
                    <div>
                      <Label className="text-xs">Catatan</Label>
                      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Batal</Button>
                <Button onClick={save} disabled={saving || !stageId}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Belum ada stage tercatat</div>
        ) : (
          <div className="space-y-2">
            {records.map(r => {
              const fv = r.fieldValues || {};
              let ts = '';
              try {
                const t = r.recordedAt;
                const d = typeof t === 'string' ? new Date(t) : new Date(Number(t) * 1000);
                if (!isNaN(d.getTime())) ts = format(d, 'dd MMM yyyy HH:mm');
              } catch (e) {}
              return (
                <div key={r.id} className="p-3 border rounded-lg bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ background: r.stage?.color || '#3b82f6' }}></span>
                      <div className="font-semibold text-sm">{r.stage?.name || 'Stage'}</div>
                      <Badge variant="outline" className="text-[10px] font-mono">{r.stage?.code}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-muted-foreground">{ts} · {r.recordedBy}</div>
                      {canDelete && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeRecord(r.id)}>
                          <Trash2 className="w-3.5 h-3.5 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {Object.keys(fv).length > 0 && (
                    <div className="mt-2 pt-2 border-t grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-1 text-xs">
                      {Object.entries(fv).map(([k, v]) => (
                        <div key={k} className="truncate">
                          <span className="text-muted-foreground">{k}:</span> <b>{String(v ?? '')}</b>
                        </div>
                      ))}
                    </div>
                  )}
                  {r.notes && <div className="mt-1 text-xs italic text-muted-foreground">"{r.notes}"</div>}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutputsTab({ wo, onSaved, canOperate, canEdit }) {
  const { data: prods } = useSWR('/api/products', fetcher);
  const { data: cs } = useSWR('/api/cold-storages', fetcher);
  const [rows, setRows] = useState(wo.outputs?.length ? wo.outputs.map(o => ({ ...o })) : [{ productId: '', stage: 'karkas', weight: 0, headCount: 0, coefficient: 1, isPremium: false, sizeGradingCode: '' }]);
  const [saving, setSaving] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeForm, setFinalizeForm] = useState({ coldStorageId: '', zoneId: '' });

  const upd = (i, k, v) => { const arr = [...rows]; arr[i] = { ...arr[i], [k]: v }; setRows(arr); };
  const add = () => setRows([...rows, { productId: '', stage: 'karkas', weight: 0, headCount: 0, coefficient: 1, isPremium: false, sizeGradingCode: '' }]);
  const remove = (i) => setRows(rows.filter((_, idx) => idx !== i));

  const totalWeight = rows.reduce((a, b) => a + Number(b.weight || 0), 0);
  const weightedCoef = totalWeight > 0 ? rows.reduce((a, b) => a + Number(b.weight || 0) * Number(b.coefficient || 1), 0) / totalWeight : 0;
  const coefValid = Math.abs(weightedCoef - 1) < 0.01;

  const save = async () => {
    setSaving(true);
    try {
      const outputs = rows.filter(r => r.productId).map(r => ({ productId: r.productId, stage: r.stage, weight: Number(r.weight), headCount: Number(r.headCount), coefficient: Number(r.coefficient), isPremium: !!r.isPremium, sizeGradingCode: r.sizeGradingCode || null }));
      const res = await fetch(`/api/work-orders/${wo.id}/outputs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outputs }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Outputs tersimpan. Delta HPP: Rp ${Number(j.data.validation?.delta || 0).toLocaleString('id-ID')}`);
      onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const finalize = async () => {
    if (!finalizeForm.coldStorageId) return toast.error('Pilih cold storage');
    setSaving(true);
    try {
      const res = await fetch(`/api/work-orders/${wo.id}/finalize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalizeForm) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`WO Selesai. ${j.data.outputCount} output masuk inventory.`);
      setFinalizeOpen(false); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const productsForOutput = (prods?.data || []).filter(p => ['Karkas', 'Boneless', 'Parting', 'Retail', 'Others'].includes(p.category));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="text-base">Outputs Final</CardTitle><CardDescription>Set produk output, berat, dan koefisien. Total weighted coefficient harus = 1 untuk alokasi cost 100%.</CardDescription></div>
        {canEdit && wo.pipelineStatus !== 'Selesai' && (
          <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
            <DialogTrigger asChild><Button size="sm" variant="default"><PackageCheck className="w-4 h-4 mr-1" />Kirim ke Inventory</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Finalize & Kirim ke Inventory</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <F label="Cold Storage *">
                  <Select value={finalizeForm.coldStorageId} onValueChange={v => setFinalizeForm({ ...finalizeForm, coldStorageId: v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
                    <SelectContent>{(cs?.data || []).map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </F>
                <div className="text-sm text-muted-foreground">Status WO akan berubah ke <b>Selesai</b>, dan setiap output akan mendapatkan Kode Simpan otomatis.</div>
              </div>
              <DialogFooter><Button onClick={finalize} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Finalize</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Produk</TableHead><TableHead>Stage</TableHead>
            <TableHead className="text-right">Berat (kg)</TableHead><TableHead className="text-right">Ekor</TableHead>
            <TableHead className="text-right">Koef</TableHead>
            <TableHead>Premium</TableHead><TableHead>Grade</TableHead>
            <TableHead className="text-right">HPP/kg</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Select value={r.productId} onValueChange={v => {
                    const p = productsForOutput.find(x => x.id === v);
                    upd(i, 'productId', v);
                    if (p?.rendemenCoefficient) upd(i, 'coefficient', Number(p.rendemenCoefficient));
                  }} disabled={!canOperate}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                    <SelectContent>{productsForOutput.map(p => <SelectItem key={p.id} value={p.id}>{p.sku} - {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Select value={r.stage} onValueChange={v => upd(i, 'stage', v)} disabled={!canOperate}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="karkas">Karkas</SelectItem><SelectItem value="boneless">Boneless</SelectItem><SelectItem value="parting">Parting</SelectItem><SelectItem value="by-product">By-Product</SelectItem></SelectContent></Select></TableCell>
                <TableCell><Input type="number" className="h-9 text-right w-20 ml-auto" value={r.weight} onChange={e => upd(i, 'weight', Number(e.target.value))} disabled={!canOperate} /></TableCell>
                <TableCell><Input type="number" className="h-9 text-right w-16 ml-auto" value={r.headCount} onChange={e => upd(i, 'headCount', Number(e.target.value))} disabled={!canOperate} /></TableCell>
                <TableCell><Input type="number" step="0.01" className="h-9 text-right w-16 ml-auto" value={r.coefficient} onChange={e => upd(i, 'coefficient', Number(e.target.value))} disabled={!canOperate} /></TableCell>
                <TableCell><Switch checked={!!r.isPremium} onCheckedChange={v => upd(i, 'isPremium', v)} disabled={!canOperate} /></TableCell>
                <TableCell><Input className="h-9 w-16" placeholder="S/M/L" value={r.sizeGradingCode || ''} onChange={e => upd(i, 'sizeGradingCode', e.target.value)} disabled={!canOperate} /></TableCell>
                <TableCell className="text-right text-emerald-700 font-semibold">Rp {Number(r.hppPerKg || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                <TableCell>{canOperate && <Button size="icon" variant="ghost" onClick={() => remove(i)}><Trash2 className="w-4 h-4 text-red-500" /></Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className={`p-3 rounded-lg text-sm ${coefValid ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
          <b>Weighted Coefficient:</b> {weightedCoef.toFixed(4)} {coefValid ? '✓ (100% cost allocated)' : `⚠️ harus mendekati 1.000 agar total HPP = total cost`}
        </div>
        {canOperate && <div className="flex justify-between"><Button variant="outline" size="sm" onClick={add}><Plus className="w-4 h-4 mr-1" />Tambah Output</Button><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan Outputs</Button></div>}
      </CardContent>
    </Card>
  );
}

function HppTab({ woId }) {
  const { data, isLoading } = useSWR(`/api/work-orders/${woId}/hpp`, fetcher);
  if (isLoading || !data?.data) return <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  const { wo, outputs, validation } = data.data;
  const validPct = validation.totalCost > 0 ? (validation.allocated / validation.totalCost) * 100 : 0;
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="text-base">Ringkasan HPP</CardTitle><CardDescription>Rumus: HPP = (Total Cost / Total Rendemen Weight) × Koefisien per Output</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <Stat label="Total Cost" value={`Rp ${Number(validation.totalCost).toLocaleString('id-ID')}`} />
          <Stat label="Total Rendemen Weight" value={`${Number(validation.totalWeight).toFixed(2)} kg`} />
          <Stat label="Base HPP/kg" value={`Rp ${Number(validation.baseHpp).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`} color="emerald" />
          <Stat label="Alokasi" value={`${validPct.toFixed(1)}%`} sub={`Delta: Rp ${Math.abs(validation.delta).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`} color={Math.abs(validation.delta) < 1 ? 'emerald' : 'amber'} />
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-base">Detail HPP per Output</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>Stage</TableHead><TableHead className="text-right">Berat</TableHead><TableHead className="text-right">Koef</TableHead><TableHead className="text-right">HPP/kg</TableHead><TableHead className="text-right">HPP Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {outputs.map(o => (
                <TableRow key={o.id}>
                  <TableCell><div className="font-medium">{o.product?.name}</div><div className="text-xs text-muted-foreground font-mono">{o.product?.sku}</div></TableCell>
                  <TableCell><Badge variant="outline">{o.stage}</Badge></TableCell>
                  <TableCell className="text-right">{o.weight} kg</TableCell>
                  <TableCell className="text-right">{o.coefficient}</TableCell>
                  <TableCell className="text-right font-bold text-emerald-700">Rp {Number(o.hppPerKg).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                  <TableCell className="text-right font-semibold">Rp {Number(o.hppTotal).toLocaleString('id-ID', { maximumFractionDigits: 0 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
    </div>
  );
}

function CostsTab({ wo, onSaved, canEdit }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', amount: 0, category: 'operasional', notes: '' });
  const [saving, setSaving] = useState(false);
  const add = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/work-orders/${wo.id}/costs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Cost ditambahkan');
      setOpen(false); setForm({ name: '', amount: 0, category: 'operasional', notes: '' }); onSaved();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  const remove = async (costId) => {
    if (!confirm('Hapus cost?')) return;
    const res = await fetch(`/api/work-orders/${wo.id}/costs/${costId}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); onSaved(); }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Base Cost (dari PO)" value={`Rp ${Number(wo.baseCost || 0).toLocaleString('id-ID')}`} />
        <Stat label="Maklon Cost" value={`Rp ${Number(wo.maklonCost || 0).toLocaleString('id-ID')}`} sub={wo.mode === 'Maklon' ? `${wo.maklonRatePerKg}/kg × ${wo.totalLiveBirdWeight}kg` : 'Internal - N/A'} />
        <Stat label="Custom Costs" value={`Rp ${Number(wo.customCostTotal || 0).toLocaleString('id-ID')}`} sub={`${wo.customCosts?.length || 0} entries`} />
        <Stat label="TOTAL COST" value={`Rp ${Number(wo.totalCost).toLocaleString('id-ID')}`} color="emerald" />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-base">Custom Costs</CardTitle><CardDescription>Biaya tambahan bebas (listrik, transport, tenaga kerja, dsb.)</CardDescription></div>
          {canEdit && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />Tambah Cost</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Tambah Custom Cost</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Nama *" className="col-span-2"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Listrik, Transport, dll" /></F>
                  <F label="Nominal (Rp) *"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} /></F>
                  <F label="Kategori"><Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="maklon">Maklon</SelectItem><SelectItem value="operasional">Operasional</SelectItem><SelectItem value="lain-lain">Lain-lain</SelectItem></SelectContent></Select></F>
                  <F label="Notes" className="col-span-2"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></F>
                </div>
                <DialogFooter><Button onClick={add} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {(wo.customCosts || []).length === 0 ? <div className="text-center py-6 text-muted-foreground text-sm">Belum ada custom cost</div> :
            <Table><TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Kategori</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Nominal</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {wo.customCosts.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><Badge variant="outline">{c.category}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.notes}</TableCell>
                    <TableCell className="text-right font-semibold">Rp {Number(c.amount).toLocaleString('id-ID')}</TableCell>
                    <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
          }
        </CardContent>
      </Card>
    </div>
  );
}

function ReportTab({ woId }) {
  const { data, isLoading } = useSWR(`/api/work-orders/${woId}/rendemen-report`, fetcher);
  if (isLoading || !data?.data) return <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  const { stages, outputs, summary } = data.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Base Weight (LB)" value={`${Number(summary.baseWeight).toLocaleString('id-ID')} kg`} sub={`${summary.totalHeads} ekor · BW ${Number(summary.bwAvg).toFixed(2)}`} />
        <Stat label="Total Rendemen" value={`${Number(summary.totalOutputWeight).toLocaleString('id-ID')} kg`} />
        <Stat label="Rendemen %" value={`${summary.overallRendemenPct.toFixed(2)}%`} color={summary.overallRendemenPct >= 70 ? 'emerald' : summary.overallRendemenPct >= 60 ? 'amber' : 'red'} sub="Actual (belum ada standard master)" />
        <Stat label="Susut" value={`${(summary.baseWeight - summary.totalOutputWeight).toFixed(2)} kg`} color="red" sub={`${(((summary.baseWeight - summary.totalOutputWeight) / summary.baseWeight) * 100).toFixed(2)}%`} />
      </div>
      <Card><CardHeader><CardTitle className="text-base">Yield per Stage</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead className="text-right">Input (kg)</TableHead><TableHead className="text-right">Output (kg)</TableHead><TableHead className="text-right">Ekor</TableHead><TableHead className="text-right">Yield %</TableHead></TableRow></TableHeader>
            <TableBody>
              {stages.map((st, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{st.stageName}</TableCell>
                  <TableCell className="text-right">{Number(st.inputWeight).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{Number(st.outputWeight).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{st.headCount}</TableCell>
                  <TableCell className="text-right"><Badge className={st.yieldPct >= 90 ? 'bg-emerald-100 text-emerald-700' : st.yieldPct >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>{st.yieldPct.toFixed(1)}%</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-base">Rendemen per Output Product</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table><TableHeader><TableRow><TableHead>Produk</TableHead><TableHead className="text-right">Berat</TableHead><TableHead className="text-right">Ekor</TableHead><TableHead className="text-right">% dari LB</TableHead></TableRow></TableHeader>
            <TableBody>
              {outputs.map(o => (
                <TableRow key={o.id}>
                  <TableCell><div className="font-medium">{o.product?.name}</div><div className="text-xs text-muted-foreground font-mono">{o.product?.sku}</div></TableCell>
                  <TableCell className="text-right">{Number(o.weight).toFixed(2)} kg</TableCell>
                  <TableCell className="text-right">{o.headCount}</TableCell>
                  <TableCell className="text-right font-semibold">{o.rendemenPct.toFixed(2)}%</TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
        </CardContent>
      </Card>
    </div>
  );
}
