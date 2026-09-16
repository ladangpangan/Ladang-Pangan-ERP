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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Loader2, Phone, Building2, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then((r) => r.json());

const STAGES = ['Kontak Awal', 'Penawaran', 'Negosiasi', 'Deal', 'Gagal'];
const STAGE_COLOR = {
  'Kontak Awal': 'bg-slate-100 text-slate-700',
  'Penawaran': 'bg-blue-100 text-blue-700',
  'Negosiasi': 'bg-amber-100 text-amber-700',
  'Deal': 'bg-emerald-100 text-emerald-700',
  'Gagal': 'bg-red-100 text-red-700',
};
const SOURCE_LABEL = { referral: 'Referral', cold_call: 'Cold Call', pameran: 'Pameran', website: 'Website', media_sosial: 'Media Sosial', lainnya: 'Lainnya' };
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

export default function LeadsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const fullAccess = ['admin', 'supervisor', 'direktur'].includes(role);
  const [mineOnly, setMineOnly] = useState(!fullAccess);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const qs = new URLSearchParams();
  if (mineOnly) qs.set('mine', '1');
  if (q) qs.set('q', q);
  const { data, mutate, isLoading } = useSWR(`/api/leads?${qs.toString()}`, fetcher);
  const leads = data?.data || [];
  const { data: tasksData, mutate: mutateTasks } = useSWR('/api/lead-tasks?mine=1&status=pending', fetcher);
  const myTasks = (tasksData?.data || []).slice().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const now = Date.now();
  const overdueTasks = myTasks.filter((t) => new Date(t.dueDate).getTime() < now);

  const byStage = STAGES.reduce((acc, st) => { acc[st] = leads.filter((l) => l.stage === st); return acc; }, {});

  const completeTask = async (t) => {
    const res = await fetch(`/api/leads/${t.leadId}/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
    if (res.ok) { toast.success('Tugas selesai'); mutateTasks(); } else { const j = await res.json(); toast.error(j.error); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline Prospek (CRM)</h1>
          <p className="text-muted-foreground text-sm mt-1">Lacak calon customer dari kontak awal sampai deal.</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 mr-1" />Tambah Lead</Button>
      </div>

      {(overdueTasks.length > 0 || myTasks.length > 0) && (
        <Card className={overdueTasks.length > 0 ? 'border-red-300 bg-red-50/40' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />Tugas Follow-up Saya
              {overdueTasks.length > 0 && <Badge variant="destructive">{overdueTasks.length} terlambat</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {myTasks.slice(0, 6).map((t) => {
              const overdue = new Date(t.dueDate).getTime() < now;
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 text-sm p-2 rounded-lg hover:bg-slate-50">
                  <div className="flex items-center gap-2 min-w-0">
                    <button onClick={() => completeTask(t)} title="Tandai selesai" className="shrink-0 text-muted-foreground hover:text-emerald-600"><CheckCircle2 className="w-4 h-4" /></button>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.title}</div>
                      <Link href={`/dashboard/leads/${t.leadId}`} className="text-xs text-muted-foreground hover:underline">
                        {t.lead?.leadNumber} — {t.lead?.contactName}
                      </Link>
                    </div>
                  </div>
                  <span className={`text-xs shrink-0 ${overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                    {overdue && <AlertCircle className="w-3.5 h-3.5 inline mr-1" />}
                    {format(new Date(t.dueDate), 'dd MMM yyyy')}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Input placeholder="Cari nama/perusahaan/telepon..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        {fullAccess && (
          <Button size="sm" variant={mineOnly ? 'default' : 'outline'} onClick={() => setMineOnly((v) => !v)}>
            {mineOnly ? 'Leads Saya' : 'Semua Leads'}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-20 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {STAGES.map((stage) => (
            <div key={stage} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STAGE_COLOR[stage]}`}>{stage}</span>
                <span className="text-xs text-muted-foreground">{byStage[stage].length}</span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {byStage[stage].map((l) => (
                  <Link key={l.id} href={`/dashboard/leads/${l.id}`}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="p-3 space-y-1">
                        <div className="font-medium text-sm truncate">{l.contactName}</div>
                        {l.companyName && <div className="text-xs text-muted-foreground flex items-center gap-1 truncate"><Building2 className="w-3 h-3 shrink-0" />{l.companyName}</div>}
                        {l.phone && <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{l.phone}</div>}
                        {l.estimatedValue > 0 && <div className="text-xs font-semibold text-emerald-700">{rp(l.estimatedValue)}</div>}
                        <div className="text-[10px] text-muted-foreground font-mono">{l.leadNumber}</div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
                {byStage[stage].length === 0 && <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">-</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddLeadDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); mutate(); }} />
    </div>
  );
}

function AddLeadDialog({ open, onClose, onSaved }) {
  const [form, setForm] = useState({ contactName: '', companyName: '', phone: '', email: '', address: '', city: '', source: 'lainnya', estimatedValue: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.contactName.trim()) return toast.error('Nama kontak wajib diisi');
    setSaving(true);
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, estimatedValue: Number(form.estimatedValue || 0) }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Lead ${j.data.leadNumber} dibuat`);
      setForm({ contactName: '', companyName: '', phone: '', email: '', address: '', city: '', source: 'lainnya', estimatedValue: '', notes: '' });
      onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah Lead Baru</DialogTitle>
          <DialogDescription>Prospek/calon customer — belum jadi transaksi resmi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nama Kontak *</Label>
            <Input className="mt-1" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="mis. Budi Santoso" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nama Perusahaan</Label>
              <Input className="mt-1" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">No. Telepon</Label>
              <Input className="mt-1" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Email</Label>
              <Input className="mt-1" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Kota</Label>
              <Input className="mt-1" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Alamat</Label>
            <Input className="mt-1" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Sumber</Label>
              <Select value={form.source} onValueChange={(v) => set('source', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Estimasi Nilai (Rp)</Label>
              <Input type="number" className="mt-1" value={form.estimatedValue} onChange={(e) => set('estimatedValue', e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Catatan</Label>
            <Textarea className="mt-1" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
