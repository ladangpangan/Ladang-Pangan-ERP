'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, GripVertical, X, Save, Layers, ArrowUp, ArrowDown, ListChecks, Circle } from 'lucide-react';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());

const FIELD_TYPES = [
  { value: 'number', label: 'Angka (Number)' },
  { value: 'text', label: 'Teks Pendek' },
  { value: 'textarea', label: 'Teks Panjang' },
  { value: 'select', label: 'Dropdown Pilihan' },
  { value: 'boolean', label: 'Ya / Tidak' },
  { value: 'date', label: 'Tanggal' },
  { value: 'datetime', label: 'Tanggal + Jam' },
];

const emptyField = () => ({ key: '', label: '', type: 'number', required: false, unit: '', options: '', default: '' });

const emptyStage = () => ({ code: '', name: '', description: '', sequenceOrder: 0, color: '#3b82f6', isActive: true, fieldsSchema: [] });

const slugKey = (str = '') => str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export default function WoStagesMasterPage() {
  const { data, mutate, isLoading } = useSWR('/api/wo-stages', fetcher);
  const stages = data?.data || [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // {id?, code, name, ...}
  const [saving, setSaving] = useState(false);

  const openCreate = () => { setEditing(emptyStage()); setOpen(true); };
  const openEdit = (st) => {
    const fs = (() => { try { return JSON.parse(st.fieldsSchema || '[]'); } catch (e) { return []; } })();
    setEditing({ ...st, fieldsSchema: fs.map(f => ({ ...f, options: Array.isArray(f.options) ? f.options.join(', ') : (f.options || '') })) });
    setOpen(true);
  };

  const addField = () => setEditing(e => ({ ...e, fieldsSchema: [...e.fieldsSchema, emptyField()] }));
  const removeField = (i) => setEditing(e => ({ ...e, fieldsSchema: e.fieldsSchema.filter((_, idx) => idx !== i) }));
  const moveField = (i, dir) => {
    setEditing(e => {
      const arr = [...e.fieldsSchema];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return e;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...e, fieldsSchema: arr };
    });
  };
  const updateField = (i, patch) => {
    setEditing(e => ({
      ...e,
      fieldsSchema: e.fieldsSchema.map((f, idx) => idx === i ? { ...f, ...patch } : f),
    }));
  };

  const save = async () => {
    if (!editing.code?.trim() || !editing.name?.trim()) {
      toast.error('Kode & Nama wajib diisi');
      return;
    }
    // Validate fields
    for (const [i, f] of editing.fieldsSchema.entries()) {
      if (!f.label?.trim()) { toast.error(`Field ke-${i + 1}: label wajib`); return; }
      if (!f.key?.trim()) { toast.error(`Field ke-${i + 1}: key wajib`); return; }
      if (f.type === 'select' && !f.options?.trim()) { toast.error(`Field '${f.label}': opsi wajib (comma-separated)`); return; }
    }
    setSaving(true);
    try {
      const payload = {
        code: editing.code.trim().toUpperCase().replace(/\s+/g, '_'),
        name: editing.name.trim(),
        description: editing.description || '',
        sequenceOrder: Number(editing.sequenceOrder || 0),
        color: editing.color || null,
        isActive: !!editing.isActive,
        fieldsSchema: editing.fieldsSchema.map((f, i) => ({
          key: f.key.trim(),
          label: f.label.trim(),
          type: f.type,
          required: !!f.required,
          unit: f.unit || '',
          options: f.type === 'select' ? f.options.split(',').map(o => o.trim()).filter(Boolean) : undefined,
          default: f.default !== '' ? f.default : undefined,
          order: i + 1,
        })),
      };
      const url = editing.id ? `/api/wo-stages/${editing.id}` : '/api/wo-stages';
      const method = editing.id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      toast.success(editing.id ? 'Stage diupdate' : 'Stage dibuat');
      setOpen(false);
      mutate();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (st) => {
    if (!confirm(`Hapus stage "${st.name}"?`)) return;
    try {
      const res = await fetch(`/api/wo-stages/${st.id}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menghapus');
      toast.success('Stage dihapus');
      mutate();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="w-6 h-6" /> Master Data · WO Stages</h1>
          <p className="text-sm text-muted-foreground mt-1">Definisikan tahapan produksi RPA dan field-field custom yang bisa dicatat operator via Tally Produksi.</p>
        </div>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Tambah Stage</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">#</TableHead>
                <TableHead>Kode</TableHead>
                <TableHead>Nama Stage</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-center">Field</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Memuat...</TableCell></TableRow>}
              {!isLoading && stages.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada stage. Klik "Tambah Stage" untuk memulai.</TableCell></TableRow>
              )}
              {stages.map((st, i) => {
                let fieldCount = 0;
                try { fieldCount = (JSON.parse(st.fieldsSchema || '[]')).length; } catch (e) {}
                return (
                  <TableRow key={st.id}>
                    <TableCell className="font-medium">{st.sequenceOrder || i + 1}</TableCell>
                    <TableCell><Badge variant="outline" className="font-mono">{st.code}</Badge></TableCell>
                    <TableCell className="font-medium flex items-center gap-2">
                      <Circle className="w-3 h-3" style={{ color: st.color || '#3b82f6', fill: st.color || '#3b82f6' }} />
                      {st.name}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md truncate">{st.description || '—'}</TableCell>
                    <TableCell className="text-center"><Badge variant="secondary">{fieldCount} field</Badge></TableCell>
                    <TableCell className="text-center">
                      {st.isActive
                        ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Aktif</Badge>
                        : <Badge variant="secondary">Nonaktif</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(st)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(st)}><Trash2 className="w-3.5 h-3.5 text-red-600" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Editor Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit Stage' : 'Tambah Stage'}</DialogTitle>
            <DialogDescription>Atur nama, urutan, dan field-field dinamis yang akan diisi operator di Tally Produksi.</DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kode *</Label>
                  <Input
                    value={editing.code}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                    placeholder="mis. CHILLING"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label>Nama Stage *</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="mis. Chilling"
                  />
                </div>
                <div>
                  <Label>Urutan (order)</Label>
                  <Input type="number" value={editing.sequenceOrder} onChange={(e) => setEditing({ ...editing, sequenceOrder: e.target.value })} />
                </div>
                <div>
                  <Label>Warna Badge</Label>
                  <div className="flex gap-2 items-center">
                    <Input type="color" value={editing.color || '#3b82f6'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="w-16 h-9 p-1" />
                    <Input value={editing.color || ''} onChange={(e) => setEditing({ ...editing, color: e.target.value })} placeholder="#3b82f6" />
                  </div>
                </div>
                <div className="col-span-2">
                  <Label>Deskripsi</Label>
                  <Textarea rows={2} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <Switch checked={!!editing.isActive} onCheckedChange={(v) => setEditing({ ...editing, isActive: v })} />
                  <Label className="cursor-pointer">Aktif — tampil di Tally Produksi</Label>
                </div>
              </div>

              {/* Fields Builder */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <Label className="text-base font-semibold">Field / Data yang dicatat</Label>
                    <p className="text-xs text-muted-foreground">Tambahkan field custom apa saja yang operator perlu isi di stage ini.</p>
                  </div>
                  <Button size="sm" onClick={addField}><Plus className="w-3.5 h-3.5 mr-1" /> Tambah Field</Button>
                </div>

                <div className="space-y-2">
                  {editing.fieldsSchema.length === 0 && (
                    <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-md">
                      Belum ada field. Klik "Tambah Field" untuk mendefinisikan apa saja yang bisa dicatat.
                    </div>
                  )}
                  {editing.fieldsSchema.map((f, i) => (
                    <Card key={i} className="border-slate-200">
                      <CardContent className="p-3 grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-1 flex flex-col gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveField(i, -1)} disabled={i === 0}><ArrowUp className="w-3 h-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveField(i, 1)} disabled={i === editing.fieldsSchema.length - 1}><ArrowDown className="w-3 h-3" /></Button>
                        </div>
                        <div className="col-span-3">
                          <Label className="text-xs">Label *</Label>
                          <Input
                            value={f.label}
                            onChange={(e) => {
                              const label = e.target.value;
                              updateField(i, { label, key: f.key || slugKey(label) });
                            }}
                            placeholder="Berat Karkas"
                            className="h-8"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">Key *</Label>
                          <Input value={f.key} onChange={(e) => updateField(i, { key: slugKey(e.target.value) })} placeholder="berat_karkas" className="h-8 font-mono text-xs" />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">Tipe</Label>
                          <Select value={f.type} onValueChange={(v) => updateField(i, { type: v })}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        {f.type === 'number' ? (
                          <div className="col-span-1">
                            <Label className="text-xs">Unit</Label>
                            <Input value={f.unit || ''} onChange={(e) => updateField(i, { unit: e.target.value })} placeholder="kg" className="h-8" />
                          </div>
                        ) : (
                          <div className="col-span-1"></div>
                        )}
                        <div className="col-span-2 flex items-center gap-2 pb-1">
                          <Switch checked={!!f.required} onCheckedChange={(v) => updateField(i, { required: v })} />
                          <span className="text-xs">Wajib</span>
                        </div>
                        <div className="col-span-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeField(i)}><Trash2 className="w-3.5 h-3.5 text-red-600" /></Button>
                        </div>
                        {f.type === 'select' && (
                          <div className="col-span-12">
                            <Label className="text-xs">Opsi (pisahkan dengan koma)</Label>
                            <Input value={f.options} onChange={(e) => updateField(i, { options: e.target.value })} placeholder="A, B, C" className="h-8" />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Batal</Button>
            <Button onClick={save} disabled={saving}>
              <Save className="w-4 h-4 mr-2" /> {saving ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
