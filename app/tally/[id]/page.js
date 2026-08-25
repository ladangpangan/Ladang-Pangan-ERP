'use client';

import { useEffect, useState, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  ChevronLeft, Loader2, Layers, Save, Wifi, WifiOff, ClipboardList, Plus, X, ListChecks,
  CheckCircle2, ChevronRight, Trash2, PackageCheck, FileText, Circle
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function TallyProductionPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: woData, isLoading: woLoading } = useSWR(`/api/work-orders/${id}`, fetcher);
  const wo = woData?.data;

  const { data: stagesData, isLoading: stagesLoading } = useSWR('/api/wo-stages?active=1', fetcher);
  const stages = stagesData?.data || [];

  const { data: recordsData, mutate: refetchRecords } = useSWR(id ? `/api/work-orders/${id}/stage-records` : null, fetcher);
  const savedRecords = recordsData?.data || [];

  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  // ---- Header state ----
  const [selectedStageId, setSelectedStageId] = useState('');
  const selectedStage = useMemo(() => stages.find(s => s.id === selectedStageId), [stages, selectedStageId]);
  const fieldsSchema = useMemo(() => {
    if (!selectedStage) return [];
    try {
      const arr = JSON.parse(selectedStage.fieldsSchema || '[]');
      return Array.isArray(arr) ? arr.sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
    } catch (e) { return []; }
  }, [selectedStage]);

  // ---- Draft form (Input Item) ----
  const emptyValues = () => {
    const obj = {};
    fieldsSchema.forEach(f => { obj[f.key] = f.default !== undefined ? String(f.default) : ''; });
    return obj;
  };
  const [values, setValues] = useState({});
  const [notes, setNotes] = useState('');

  useEffect(() => { setValues(emptyValues()); setNotes(''); }, [selectedStageId, fieldsSchema.length]);

  // ---- Staging list (Daftar Catat) ----
  const [staged, setStaged] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const validate = () => {
    if (!selectedStageId) { toast.error('Pilih stage dulu'); return false; }
    for (const f of fieldsSchema) {
      if (f.required && (values[f.key] === undefined || values[f.key] === '' || values[f.key] === null)) {
        toast.error(`Field wajib: ${f.label}`);
        return false;
      }
    }
    return true;
  };

  const catat = () => {
    if (!validate()) return;
    const rec = {
      _localId: Date.now() + Math.random(),
      stageId: selectedStageId,
      stageName: selectedStage.name,
      stageColor: selectedStage.color,
      values: { ...values },
      notes,
      recordedAt: new Date().toISOString(),
    };
    setStaged(prev => [...prev, rec]);
    toast.success(`Dicatat: ${selectedStage.name}`);
    // Reset form values but keep stage selected
    setValues(emptyValues());
    setNotes('');
  };

  const removeStaged = (lid) => setStaged(prev => prev.filter(r => r._localId !== lid));

  const simpan = async () => {
    if (staged.length === 0) { toast.error('Belum ada item dicatat'); return; }
    setSaving(true);
    try {
      const payload = {
        records: staged.map(r => ({
          stageId: r.stageId,
          recordedAt: r.recordedAt,
          fieldValues: r.values,
          notes: r.notes || '',
        })),
      };
      const res = await fetch(`/api/work-orders/${id}/stage-records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      toast.success(`${j.inserted} record tersimpan`);
      setStaged([]);
      setListOpen(false);
      refetchRecords();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  if (woLoading || stagesLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!wo) return <div className="p-4 text-center text-muted-foreground">WO tidak ditemukan</div>;

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
    <div className="max-w-md mx-auto p-4 min-h-screen pb-32 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Button size="icon" variant="ghost" onClick={() => router.push('/tally')}><ChevronLeft className="w-5 h-5" /></Button>
        <div className="flex-1 min-w-0">
          <div className="font-mono font-bold text-sm truncate">{wo.woNumber}</div>
          <div className="text-xs text-muted-foreground truncate">{wo.mode} · {wo.pipelineStatus}</div>
        </div>
        {online ? <Wifi className="w-4 h-4 text-emerald-600" /> : <WifiOff className="w-4 h-4 text-red-500" />}
      </div>

      {/* WO Info Compact */}
      <Card className="mb-3 border-emerald-200 bg-emerald-50/40">
        <CardContent className="pt-3 pb-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Berat LB:</span> <b>{Number(wo.totalLiveBirdWeight || 0).toLocaleString('id-ID')} kg</b></div>
            <div><span className="text-muted-foreground">Ekor:</span> <b>{wo.totalLiveBirdHeadCount || 0}</b></div>
            <div><span className="text-muted-foreground">Start:</span> {wo.startDate && format(new Date(wo.startDate), 'dd MMM')}</div>
            <div><span className="text-muted-foreground">Record:</span> <b>{savedRecords.length}</b></div>
          </div>
        </CardContent>
      </Card>

      {/* Section 1: Pilih Stage */}
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
        <Layers className="w-3.5 h-3.5" /> 1. Pilih Stage Produksi
      </div>
      <Card className="mb-3">
        <CardContent className="pt-3 pb-3">
          <Select value={selectedStageId} onValueChange={setSelectedStageId}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih stage..." />
            </SelectTrigger>
            <SelectContent>
              {stages.length === 0 && <div className="p-3 text-xs text-muted-foreground">Belum ada stage aktif. Hubungi admin.</div>}
              {stages.map(st => (
                <SelectItem key={st.id} value={st.id}>
                  <div className="flex items-center gap-2">
                    <Circle className="w-3 h-3" style={{ color: st.color || '#3b82f6', fill: st.color || '#3b82f6' }} />
                    <span className="font-medium">{st.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">· {st.code}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedStage?.description && <p className="text-xs text-muted-foreground mt-2">{selectedStage.description}</p>}
        </CardContent>
      </Card>

      {/* Section 2: Input Item (dinamis) */}
      {selectedStage && (
        <>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
            <ClipboardList className="w-3.5 h-3.5" /> 2. Input Data
          </div>
          <Card className="mb-3">
            <CardContent className="pt-3 pb-3 space-y-3">
              {fieldsSchema.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-2">Stage ini tidak memiliki field. Tambahkan field via master data.</div>
              )}
              {fieldsSchema.map(f => (
                <div key={f.key}>
                  <Label className="text-xs">
                    {f.label}
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                    {f.unit ? <span className="text-muted-foreground ml-1">({f.unit})</span> : null}
                  </Label>
                  {renderFieldInput(f)}
                </div>
              ))}
              <div>
                <Label className="text-xs">Catatan (opsional)</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Section 3: Riwayat Tersimpan */}
      {savedRecords.length > 0 && (
        <>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
            <PackageCheck className="w-3.5 h-3.5" /> Riwayat ({savedRecords.length})
          </div>
          <div className="space-y-2 mb-3">
            {savedRecords.slice(0, 5).map(r => (
              <Card key={r.id} className="border-slate-200">
                <CardContent className="pt-2.5 pb-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Circle className="w-2.5 h-2.5" style={{ color: r.stage?.color || '#3b82f6', fill: r.stage?.color || '#3b82f6' }} />
                      <span className="text-sm font-semibold">{r.stage?.name || 'Stage'}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{(() => {
                      try {
                        const t = r.recordedAt;
                        const d = typeof t === 'string' ? new Date(t) : new Date(Number(t) * 1000);
                        if (isNaN(d.getTime())) return '';
                        return format(d, 'dd/MM HH:mm');
                      } catch (e) { return ''; }
                    })()}</span>
                  </div>
                  <div className="text-xs text-muted-foreground grid grid-cols-2 gap-x-2">
                    {Object.entries(r.fieldValues || {}).slice(0, 4).map(([k, v]) => (
                      <div key={k} className="truncate"><span className="text-slate-400">{k}:</span> <b>{String(v)}</b></div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            {savedRecords.length > 5 && <div className="text-xs text-center text-muted-foreground">... {savedRecords.length - 5} record lainnya</div>}
          </div>
        </>
      )}

      {/* Footer Sticky - Catat / Daftar / Simpan */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 shadow-lg">
        <div className="max-w-md mx-auto grid grid-cols-3 gap-2">
          <Button variant="outline" onClick={catat} disabled={!selectedStageId || saving}>
            <Plus className="w-4 h-4 mr-1" /> Catat
          </Button>
          <Button variant="outline" onClick={() => setListOpen(true)} disabled={staged.length === 0}>
            <ListChecks className="w-4 h-4 mr-1" /> Daftar ({staged.length})
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={simpan} disabled={staged.length === 0 || saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Simpan
          </Button>
        </div>
      </div>

      {/* Daftar Dialog */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Daftar Catat ({staged.length})</DialogTitle>
            <DialogDescription>Data yang akan disimpan ke WO {wo.woNumber}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {staged.map((r, i) => (
              <Card key={r._localId} className="border-slate-200">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Circle className="w-2.5 h-2.5" style={{ color: r.stageColor || '#3b82f6', fill: r.stageColor || '#3b82f6' }} />
                      <span className="text-sm font-semibold">{r.stageName}</span>
                    </div>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeStaged(r._localId)}>
                      <Trash2 className="w-3.5 h-3.5 text-red-600" />
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground grid grid-cols-2 gap-x-2">
                    {Object.entries(r.values || {}).map(([k, v]) => (
                      <div key={k} className="truncate"><span className="text-slate-400">{k}:</span> <b>{String(v)}</b></div>
                    ))}
                  </div>
                  {r.notes && <div className="text-xs mt-1 italic text-muted-foreground">"{r.notes}"</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
