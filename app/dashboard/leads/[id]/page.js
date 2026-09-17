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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Loader2, Plus, Pencil, Trash2, CheckCircle2, XCircle, Building2, Phone, Mail, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then((r) => r.json());
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const SOURCE_LABEL = { referral: 'Referral', cold_call: 'Cold Call', pameran: 'Pameran', website: 'Website', media_sosial: 'Media Sosial', lainnya: 'Lainnya' };
const NEXT_STAGE = { 'Kontak Awal': 'Penawaran', 'Penawaran': 'Negosiasi' };
const STAGE_COLOR = {
  'Kontak Awal': 'bg-slate-100 text-slate-700', 'Penawaran': 'bg-blue-100 text-blue-700',
  'Negosiasi': 'bg-amber-100 text-amber-700', 'Deal': 'bg-emerald-100 text-emerald-700', 'Gagal': 'bg-red-100 text-red-700',
};

export default function LeadDetailPage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const fullAccess = ['admin', 'supervisor', 'direktur'].includes(role);
  const { data, mutate, isLoading, error } = useSWR(`/api/leads/${id}`, fetcher);
  const lead = data?.data;
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (error || !lead) return <div className="text-center py-20 text-muted-foreground">{error?.error === 'Forbidden' ? 'Anda tidak punya akses ke lead ini.' : 'Lead tidak ditemukan'}</div>;

  const terminal = lead.stage === 'Deal' || lead.stage === 'Gagal';
  const nextStage = NEXT_STAGE[lead.stage];

  const advance = async () => {
    const res = await fetch(`/api/leads/${id}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: nextStage }) });
    if (res.ok) { toast.success(`Lanjut ke ${nextStage}`); mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };

  const completeTask = async (t, status) => {
    const res = await fetch(`/api/leads/${id}/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (res.ok) { mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };
  const deleteTask = async (t) => {
    if (!confirm('Hapus tugas ini?')) return;
    const res = await fetch(`/api/leads/${id}/tasks/${t.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/leads"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{lead.contactName}</h1>
            <Badge className={STAGE_COLOR[lead.stage]}>{lead.stage}</Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1 font-mono">{lead.leadNumber} · PIC: {lead.picEmail}</p>
        </div>
        {!terminal && (
          <div className="flex gap-2 flex-wrap">
            {nextStage && <Button size="sm" onClick={advance}>Lanjut ke {nextStage}</Button>}
            {lead.stage === 'Negosiasi' && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setConvertOpen(true)}>Tandai Deal</Button>}
            <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setLostOpen(true)}>Tandai Gagal</Button>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Informasi Lead</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 mr-1" />Edit</Button>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
            {lead.companyName && <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-muted-foreground" />{lead.companyName}</div>}
            {lead.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" />{lead.phone}</div>}
            {lead.email && <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-muted-foreground" />{lead.email}</div>}
            {(lead.address || lead.city) && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" />{[lead.address, lead.city].filter(Boolean).join(', ')}</div>}
            <div><span className="text-muted-foreground">Sumber: </span><b>{SOURCE_LABEL[lead.source] || lead.source}</b></div>
            {lead.estimatedValue > 0 && <div><span className="text-muted-foreground">Estimasi Nilai: </span><b className="text-emerald-700">{rp(lead.estimatedValue)}</b></div>}
            {lead.lostReason && <div className="sm:col-span-2 text-red-700"><span className="text-muted-foreground">Alasan Gagal: </span>{lead.lostReason}</div>}
            {lead.notes && <div className="sm:col-span-2 whitespace-pre-wrap"><span className="text-muted-foreground">Catatan: </span>{lead.notes}</div>}
            {lead.convertedContact && (
              <div className="sm:col-span-2">
                <Link href={`/dashboard/contacts?id=${lead.convertedContact.id}`} className="text-emerald-700 hover:underline font-medium">
                  → Sudah jadi Customer: {lead.convertedContact.code} · {lead.convertedContact.displayName}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Ringkasan</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Dibuat</span><span>{format(new Date(lead.createdAt), 'dd MMM yyyy')}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Diperbarui</span><span>{format(new Date(lead.updatedAt), 'dd MMM yyyy')}</span></div>
            {lead.convertedAt && <div className="flex justify-between"><span className="text-muted-foreground">Deal pada</span><span>{format(new Date(lead.convertedAt), 'dd MMM yyyy')}</span></div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Follow-up & Reminder</CardTitle>
            <CardDescription className="text-xs">Tugas terkait lead ini</CardDescription>
          </div>
          <Button size="sm" onClick={() => setTaskOpen(true)}><Plus className="w-4 h-4 mr-1" />Tambah Tugas</Button>
        </CardHeader>
        <CardContent>
          {(!lead.tasks || lead.tasks.length === 0) ? (
            <div className="text-sm text-muted-foreground p-6 rounded-lg bg-slate-50 border border-dashed text-center">Belum ada tugas follow-up</div>
          ) : (
            <div className="border rounded-lg divide-y">
              {lead.tasks.map((t) => {
                const overdue = t.status === 'pending' && new Date(t.dueDate).getTime() < Date.now();
                return (
                  <div key={t.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {t.status === 'pending' ? (
                        <button onClick={() => completeTask(t, 'done')} title="Tandai selesai"><CheckCircle2 className="w-4 h-4 text-muted-foreground hover:text-emerald-600" /></button>
                      ) : t.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-slate-400" />}
                      <div className="min-w-0">
                        <div className={`font-medium text-sm truncate ${t.status !== 'pending' ? 'line-through text-muted-foreground' : ''}`}>{t.title}</div>
                        <div className={`text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                          Jatuh tempo {format(new Date(t.dueDate), 'dd MMM yyyy')} · {t.assignedTo}
                        </div>
                        {t.notes && <div className="text-xs text-muted-foreground mt-0.5">{t.notes}</div>}
                      </div>
                    </div>
                    {t.status === 'pending' && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Batalkan" onClick={() => completeTask(t, 'cancelled')}><XCircle className="w-3.5 h-3.5 text-slate-500" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Hapus" onClick={() => deleteTask(t)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <EditLeadDialog open={editOpen} lead={lead} fullAccess={fullAccess} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); mutate(); }} />
      <AddTaskDialog open={taskOpen} leadId={id} defaultAssignee={lead.picEmail} fullAccess={fullAccess} onClose={() => setTaskOpen(false)} onSaved={() => { setTaskOpen(false); mutate(); }} />
      <ConvertDialog open={convertOpen} leadId={id} onClose={() => setConvertOpen(false)} onSaved={() => { setConvertOpen(false); mutate(); }} />
      <LostReasonDialog open={lostOpen} leadId={id} onClose={() => setLostOpen(false)} onSaved={() => { setLostOpen(false); mutate(); }} />
    </div>
  );
}

function EditLeadDialog({ open, lead, fullAccess, onClose, onSaved }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  if (open && !form) setForm({ companyName: lead.companyName || '', contactName: lead.contactName || '', phone: lead.phone || '', email: lead.email || '', address: lead.address || '', city: lead.city || '', source: lead.source, estimatedValue: lead.estimatedValue || 0, picEmail: lead.picEmail, notes: lead.notes || '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Tersimpan'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setForm(null); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
        {form && (
          <div className="space-y-3">
            <div><Label className="text-xs">Nama Kontak</Label><Input className="mt-1" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Perusahaan</Label><Input className="mt-1" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} /></div>
              <div><Label className="text-xs">Telepon</Label><Input className="mt-1" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Email</Label><Input className="mt-1" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
              <div><Label className="text-xs">Kota</Label><Input className="mt-1" value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
            </div>
            <div><Label className="text-xs">Alamat</Label><Input className="mt-1" value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Sumber</Label>
                <Select value={form.source} onValueChange={(v) => set('source', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SOURCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Estimasi Nilai (Rp)</Label><Input type="number" className="mt-1" value={form.estimatedValue} onChange={(e) => set('estimatedValue', e.target.value)} /></div>
            </div>
            {fullAccess && <div><Label className="text-xs">PIC (email)</Label><Input className="mt-1" value={form.picEmail} onChange={(e) => set('picEmail', e.target.value)} /></div>}
            <div><Label className="text-xs">Catatan</Label><Textarea className="mt-1" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
          </div>
        )}
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog({ open, leadId, defaultAssignee, fullAccess, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim()) return toast.error('Judul tugas wajib diisi');
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, dueDate, notes }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Tugas ditambahkan'); setTitle(''); setNotes(''); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Tambah Follow-up</DialogTitle><DialogDescription>Pengingat untuk lead ini{fullAccess ? '' : ` (assignee: ${defaultAssignee})`}.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Judul *</Label><Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Telepon lagi, Kirim penawaran, Kunjungan" /></div>
          <div><Label className="text-xs">Jatuh Tempo *</Label><Input type="date" className="mt-1" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div><Label className="text-xs">Catatan</Label><Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LostReasonDialog({ open, leadId, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!reason.trim()) return toast.error('Alasan wajib diisi');
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'Gagal', lostReason: reason }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Lead ditandai Gagal'); setReason(''); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Tandai Lead Gagal</DialogTitle><DialogDescription>Tahap ini final — lead tidak bisa diubah lagi setelahnya.</DialogDescription></DialogHeader>
        <div><Label className="text-xs">Alasan *</Label><Textarea className="mt-1" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. Harga tidak cocok, sudah pakai supplier lain, dst." /></div>
        <DialogFooter><Button variant="destructive" onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Tandai Gagal</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ open, leadId, onClose, onSaved }) {
  const [q, setQ] = useState('');
  const { data } = useSWR(open ? `/api/contacts?type=Customer&q=${encodeURIComponent(q)}` : null, fetcher);
  const contacts = data?.data || [];
  const [contactId, setContactId] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!contactId) return toast.error('Pilih Contact dulu');
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Lead ditandai Deal'); setContactId(''); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tandai Deal</DialogTitle>
          <DialogDescription>
            Pilih Contact Customer yang sudah dibuat untuk ditautkan. Kalau belum ada,{' '}
            <Link href="/dashboard/contacts" className="text-emerald-700 hover:underline" target="_blank">buat Contact-nya dulu</Link>, lalu kembali ke sini.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Cari nama customer..." value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={contactId} onValueChange={setContactId}>
            <SelectTrigger><SelectValue placeholder="Pilih Contact" /></SelectTrigger>
            <SelectContent>
              {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={save} disabled={saving || !contactId}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Tandai Deal</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
