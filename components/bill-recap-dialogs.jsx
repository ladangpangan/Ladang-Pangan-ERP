'use client';

// Dialog "Generate Rekap" (dari invoice terpilih) dan "Template Rekap" (atur kolom, disimpan &
// dipakai bersama) untuk modul Keuangan → Invoice PO.
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Save, Star, Trash2 } from 'lucide-react';
import BillRecapView from '@/components/bill-recap-view';
import { RECAP_FIELDS } from '@/lib/finance/recap-fields';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());

async function api(url, method, body) {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Gagal');
  return j;
}

export function useRecapTemplates(docType = 'PO') {
  return useSWR(`/api/finance/recap-templates?docType=${docType}`, fetcher, { revalidateOnFocus: false });
}

// ---------------------------------------------------------------------------
// Generate Rekap
// ---------------------------------------------------------------------------
export function GenerateRecapDialog({ open, onOpenChange, docIds, selectedRows, onCreated, docType = 'PO' }) {
  const { data: tplData } = useRecapTemplates(docType);
  const templates = tplData?.data || [];
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [notes, setNotes] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(''); setSubtitle(''); setNotes(''); setPreview(null);
  }, [open]);
  useEffect(() => {
    if (open && !templateId && templates.length) setTemplateId((templates.find(t => t.isDefault) || templates[0]).id);
  }, [open, templates, templateId]);

  const suppliers = useMemo(() => [...new Set((selectedRows || []).map(r => r.party))], [selectedRows]);
  const autoTitle = suppliers.length === 1 ? `TAGIHAN ${String(suppliers[0]).toUpperCase()}` : 'REKAP TAGIHAN SUPPLIER';
  const payload = { docType, docIds, title, subtitle, notes, templateId };

  const doPreview = async () => {
    setBusy('preview');
    try { const j = await api('/api/finance/recaps', 'POST', { ...payload, preview: true }); setPreview(j.data); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };
  const doSave = async () => {
    setBusy('save');
    try {
      const j = await api('/api/finance/recaps', 'POST', payload);
      toast.success(`Rekap ${j.data.recapNumber} berhasil dibuat`);
      onCreated?.(j.data);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Rekap Tagihan</DialogTitle>
          <DialogDescription>
            {docIds.length} invoice dipilih{suppliers.length ? ` · ${suppliers.join(', ')}` : ''}. Angka di rekap dikunci saat disimpan; koreksi sesudahnya muncul di kolom Keterangan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Judul</Label>
            <Input value={title} onChange={e => { setTitle(e.target.value); setPreview(null); }} placeholder={autoTitle} />
            <p className="text-[11px] text-muted-foreground">Kosongkan untuk memakai &quot;{autoTitle}&quot;. Tiap supplier tetap diberi judul sendiri.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Subjudul (opsional)</Label>
            <Input value={subtitle} onChange={e => { setSubtitle(e.target.value); setPreview(null); }} placeholder="mis. DAPUR KEDIRI" />
          </div>
          <div className="space-y-1.5">
            <Label>Template kolom</Label>
            <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setPreview(null); }}>
              <SelectTrigger><SelectValue placeholder="Pilih template" /></SelectTrigger>
              <SelectContent>
                {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Catatan (opsional)</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Catatan untuk finance" />
          </div>
        </div>
        {preview && (
          <div className="rounded-lg border p-4 bg-white">
            <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2"><Eye className="w-3.5 h-3.5" />Pratinjau — belum disimpan</div>
            <BillRecapView recap={{ ...preview.recap, docType }} view={preview.view} />
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={doPreview} disabled={!!busy || !docIds.length}>
            {busy === 'preview' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}Pratinjau
          </Button>
          <Button onClick={doSave} disabled={!!busy || !docIds.length}>
            {busy === 'save' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan Rekap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Template Rekap (admin)
// ---------------------------------------------------------------------------
const emptyDraft = (base) => ({ id: null, name: '', columns: [...(base?.columns || ['no', 'date', 'invoiceNumber', 'item', 'total'])], subtotalByDate: base?.options?.subtotalByDate ?? true, isDefault: false });

export function RecapTemplateDialog({ open, onOpenChange, docType = 'PO' }) {
  const { data, mutate } = useRecapTemplates(docType);
  const templates = data?.data || [];
  const fields = RECAP_FIELDS[docType] || [];
  const fmap = Object.fromEntries(fields.map(f => [f.key, f]));
  const groups = [...new Set(fields.map(f => f.group))];
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = (t) => setDraft(t.builtin
    ? { ...emptyDraft(t), name: t.name, isDefault: true }
    : { id: t.id, name: t.name, columns: [...t.columns], subtotalByDate: !!t.options?.subtotalByDate, isDefault: !!t.isDefault });
  useEffect(() => { if (open && !draft && templates.length) load(templates.find(t => t.isDefault) || templates[0]); }, [open, templates]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) setDraft(null); }, [open]);

  const toggle = (key) => setDraft(d => {
    if (key === 'total') return d; // Total Tagihan selalu ada
    const has = d.columns.includes(key);
    if (has) return { ...d, columns: d.columns.filter(k => k !== key) };
    // sisipkan mengikuti urutan bawaan field
    const order = fields.map(f => f.key);
    const next = [...d.columns, key].sort((a, b) => {
      const ia = d.columns.indexOf(a); const ib = d.columns.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      return order.indexOf(a) - order.indexOf(b);
    });
    return { ...d, columns: next };
  });
  const move = (i, dir) => setDraft(d => {
    const cols = [...d.columns]; const j = i + dir;
    if (j < 0 || j >= cols.length) return d;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    return { ...d, columns: cols };
  });

  const save = async () => {
    setBusy(true);
    try {
      const body = { docType, name: draft.name, columns: draft.columns, options: { subtotalByDate: draft.subtotalByDate }, isDefault: draft.isDefault };
      const j = draft.id ? await api(`/api/finance/recap-templates/${draft.id}`, 'PUT', body) : await api('/api/finance/recap-templates', 'POST', body);
      toast.success('Template tersimpan');
      await mutate();
      load(j.data);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!draft?.id || !confirm(`Hapus template "${draft.name}"? Rekap yang sudah dibuat tidak terpengaruh.`)) return;
    setBusy(true);
    try { await api(`/api/finance/recap-templates/${draft.id}`, 'DELETE'); toast.success('Template dihapus'); setDraft(null); await mutate(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Template Rekap</DialogTitle>
          <DialogDescription>Atur kolom yang muncul di rekap. Template disimpan dan dipakai bersama seluruh tim.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
          <div className="space-y-2">
            {templates.map(t => (
              <button key={t.id} type="button" onClick={() => load(t)}
                className={`w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-slate-50 ${draft && (draft.id === t.id || (t.builtin && !draft.id && draft.name === t.name)) ? 'border-emerald-500 bg-emerald-50' : ''}`}>
                <div className="font-medium flex items-center gap-1">{t.isDefault && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />}{t.name}</div>
                <div className="text-[11px] text-muted-foreground">{t.columns.length} kolom{t.builtin ? ' · bawaan' : ''}</div>
              </button>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setDraft(emptyDraft(templates.find(t => t.isDefault)))}><Plus className="w-4 h-4 mr-1" />Template Baru</Button>
          </div>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nama template</Label>
                <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="mis. Dropship Dapur" />
                {!draft.id && templates.some(t => t.builtin) && <p className="text-[11px] text-muted-foreground">Template bawaan belum tersimpan — klik Simpan untuk menyimpannya sebagai template tim.</p>}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label>Pilih kolom</Label>
                  {groups.map(g => (
                    <div key={g}>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{g}</div>
                      <div className="space-y-1">
                        {fields.filter(f => f.group === g).map(f => (
                          <label key={f.key} className="flex items-start gap-2 text-sm cursor-pointer">
                            <Checkbox checked={draft.columns.includes(f.key)} disabled={f.key === 'total'} onCheckedChange={() => toggle(f.key)} className="mt-0.5" />
                            <span>{f.label}{f.hint && <span className="block text-[11px] text-muted-foreground">{f.hint}</span>}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <Label>Urutan kolom</Label>
                  <div className="rounded-md border divide-y">
                    {draft.columns.map((k, i) => (
                      <div key={k} className="flex items-center justify-between px-2 py-1 text-sm">
                        <span><span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>{fmap[k]?.label || k}</span>
                        <span className="flex gap-1">
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === draft.columns.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                    <span>Kolom <b>Jumlah</b> (subtotal per tanggal)</span>
                    <Switch checked={draft.subtotalByDate} onCheckedChange={v => setDraft(d => ({ ...d, subtotalByDate: v }))} />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                    <span>Jadikan template <b>default</b></span>
                    <Switch checked={draft.isDefault} onCheckedChange={v => setDraft(d => ({ ...d, isDefault: v }))} />
                  </label>
                  <p className="text-[11px] text-muted-foreground">Kolom <Badge variant="outline" className="text-[10px] px-1 py-0">Keterangan</Badge> otomatis muncul bila ada koreksi atau pembayaran setelah rekap dibuat.</p>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {draft?.id && <Button variant="outline" className="text-red-600" onClick={remove} disabled={busy}><Trash2 className="w-4 h-4 mr-2" />Hapus</Button>}
          <Button onClick={save} disabled={busy || !draft}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan Template</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
