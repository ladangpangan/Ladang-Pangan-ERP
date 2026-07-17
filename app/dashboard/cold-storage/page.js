'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Warehouse, MapPin, Loader2, Snowflake } from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url) => fetch(url).then(r => r.json());

const emptyCS = { code: '', name: '', location: '', temperatureRange: '', capacityKg: 0, status: 'active', notes: '' };
const emptyZone = { code: '', name: '', description: '', status: 'active' };

export default function ColdStoragePage() {
  const { data, mutate, isLoading } = useSWR('/api/cold-storages', fetcher);
  const rows = data?.data || [];
  const [csOpen, setCsOpen] = useState(false);
  const [csEditing, setCsEditing] = useState(null);
  const [csForm, setCsForm] = useState(emptyCS);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);

  const openCreateCs = () => { setCsEditing(null); setCsForm(emptyCS); setCsOpen(true); };
  const openEditCs = (r) => { setCsEditing(r); setCsForm({ ...emptyCS, ...r }); setCsOpen(true); };

  const saveCs = async () => {
    setSaving(true);
    try {
      const method = csEditing ? 'PATCH' : 'POST';
      const url = csEditing ? `/api/cold-storages/${csEditing.id}` : '/api/cold-storages';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(csForm) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Tersimpan'); setCsOpen(false); mutate();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const removeCs = async (id) => {
    if (!confirm('Hapus cold storage ini beserta seluruh zone-nya?')) return;
    const res = await fetch(`/api/cold-storages/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); if (selected?.id === id) setSelected(null); }
    else { const j = await res.json(); toast.error(j.error); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2"><Warehouse className="w-8 h-8 text-emerald-600" /> Cold Storage & Zones</h1>
          <p className="text-muted-foreground mt-1">Kelola gudang beku dan zona penyimpanan untuk stok</p>
        </div>
        <Dialog open={csOpen} onOpenChange={setCsOpen}>
          <DialogTrigger asChild><Button onClick={openCreateCs}><Plus className="w-4 h-4 mr-2" />Tambah Cold Storage</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{csEditing ? 'Edit Cold Storage' : 'Tambah Cold Storage'}</DialogTitle>
              <DialogDescription>Unit gudang beku (multi cold storage).</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <F label="Kode *"><Input value={csForm.code} onChange={e => setCsForm({ ...csForm, code: e.target.value })} placeholder="CS-01" /></F>
              <F label="Nama *"><Input value={csForm.name} onChange={e => setCsForm({ ...csForm, name: e.target.value })} /></F>
              <F label="Lokasi" className="col-span-2"><Input value={csForm.location || ''} onChange={e => setCsForm({ ...csForm, location: e.target.value })} /></F>
              <F label="Rentang Suhu"><Input value={csForm.temperatureRange || ''} onChange={e => setCsForm({ ...csForm, temperatureRange: e.target.value })} placeholder="-18 to -22 C" /></F>
              <F label="Kapasitas (kg)"><Input type="number" value={csForm.capacityKg} onChange={e => setCsForm({ ...csForm, capacityKg: Number(e.target.value) })} /></F>
              <F label="Status">
                <Select value={csForm.status} onValueChange={v => setCsForm({ ...csForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </F>
              <F label="Catatan" className="col-span-2"><Textarea value={csForm.notes || ''} onChange={e => setCsForm({ ...csForm, notes: e.target.value })} rows={2} /></F>
            </div>
            <DialogFooter><Button onClick={saveCs} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {isLoading && <div className="col-span-3 text-center py-12"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
        {!isLoading && rows.length === 0 && <div className="col-span-3 text-center py-12 text-muted-foreground">Belum ada cold storage</div>}
        {rows.map(cs => (
          <Card key={cs.id} className={`cursor-pointer transition-all ${selected?.id === cs.id ? 'ring-2 ring-emerald-500' : 'hover:shadow-md'}`} onClick={() => setSelected(cs)}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center text-white">
                    <Snowflake className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{cs.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{cs.code}</CardDescription>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openEditCs(cs); }}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); removeCs(cs.id); }}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {cs.location && <div className="text-muted-foreground">📍 {cs.location}</div>}
              {cs.temperatureRange && <div className="text-muted-foreground">🌡️ {cs.temperatureRange}</div>}
              <div className="flex items-center justify-between pt-2">
                <span className="text-muted-foreground">Kapasitas</span>
                <span className="font-semibold">{Number(cs.capacityKg).toLocaleString('id-ID')} kg</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Zona</span>
                <Badge variant="secondary">{cs.zoneCount} zone</Badge>
              </div>
              <Badge variant={cs.status === 'active' ? 'default' : 'secondary'} className="mt-2">{cs.status}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {selected && <ZonesSection coldStorage={selected} onRefresh={mutate} />}
    </div>
  );
}

function ZonesSection({ coldStorage, onRefresh }) {
  const { data, mutate, isLoading } = useSWR(`/api/zones?cold_storage_id=${coldStorage.id}`, fetcher);
  const zones = data?.data || [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyZone);
  const [saving, setSaving] = useState(false);

  const openCreate = () => { setEditing(null); setForm(emptyZone); setOpen(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...emptyZone, ...r }); setOpen(true); };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, coldStorageId: coldStorage.id };
      const method = editing ? 'PATCH' : 'POST';
      const url = editing ? `/api/zones/${editing.id}` : '/api/zones';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Tersimpan'); setOpen(false); mutate(); onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Hapus zone ini?')) return;
    const res = await fetch(`/api/zones/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); onRefresh(); }
    else { const j = await res.json(); toast.error(j.error); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><MapPin className="w-5 h-5" /> Zones - {coldStorage.name}</CardTitle>
            <CardDescription>Kelola zona penyimpanan dalam {coldStorage.code}</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Tambah Zone</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? 'Edit Zone' : 'Tambah Zone'}</DialogTitle>
                <DialogDescription>Zona penyimpanan di {coldStorage.name}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <F label="Kode *"><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="Z-A1" /></F>
                <F label="Nama *"><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></F>
                <F label="Deskripsi" className="col-span-2"><Textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></F>
                <F label="Status">
                  <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                  </Select>
                </F>
              </div>
              <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
         : zones.length === 0 ? <div className="text-center py-6 text-muted-foreground">Belum ada zone</div>
         : <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {zones.map(z => (
              <div key={z.id} className="p-4 border rounded-lg hover:shadow-sm transition-shadow bg-slate-50">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold">{z.name}</div>
                    <div className="text-xs font-mono text-muted-foreground">{z.code}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(z)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(z.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button>
                  </div>
                </div>
                {z.description && <div className="text-xs text-muted-foreground mt-2">{z.description}</div>}
                <Badge variant={z.status === 'active' ? 'default' : 'secondary'} className="mt-2 text-[10px]">{z.status}</Badge>
              </div>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}

function F({ label, children, className = '' }) {
  return <div className={`space-y-1.5 ${className}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
