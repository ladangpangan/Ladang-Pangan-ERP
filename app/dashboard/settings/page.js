'use client';

import React, { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { setPdfCompany } from '@/lib/pdf/invoice';
import { toast } from 'sonner';
import { User, Building2, ShieldCheck, Bell, Loader2, Save, Upload, Trash2, Plus, KeyRound } from 'lucide-react';

const fetcher = (u) => fetch(u, { credentials: 'include' }).then(r => r.json());
const F = ({ label, children, hint }) => (
  <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>
);

// Jenis notifikasi yang bisa di on/off-kan
const NOTIF_TYPES = [
  { key: 'low_stock', label: 'Stok Menipis', desc: 'Peringatan ketika stok produk di bawah minimum' },
  { key: 'po_due', label: 'PO Jatuh Tempo', desc: 'Pengingat pembayaran PO yang jatuh tempo' },
  { key: 'so_due', label: 'Piutang SO Jatuh Tempo', desc: 'Pengingat tagihan pelanggan jatuh tempo' },
  { key: 'approval_pending', label: 'Approval Menunggu', desc: 'Notifikasi saat ada dokumen menunggu persetujuan' },
  { key: 'expiry', label: 'Produk Mendekati Kadaluarsa', desc: 'Peringatan stok mendekati tanggal kadaluarsa' },
  { key: 'tally_done', label: 'Tally Selesai', desc: 'Notifikasi ketika tally inbound difinalkan' },
];

const APPROVAL_MODULES = [
  { key: 'po', label: 'Purchase Order (PO)', desc: 'Wajib disetujui sebelum PO diproses' },
  { key: 'so', label: 'Sales Order (SO)', desc: 'Wajib disetujui sebelum SO dikonfirmasi' },
  { key: 'wo', label: 'Work Order (WO)', desc: 'Wajib disetujui sebelum produksi berjalan' },
  { key: 'payment', label: 'Pembayaran', desc: 'Wajib disetujui sebelum pembayaran dicatat' },
];

export default function SettingsPage() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Setting</h1>
        <p className="text-muted-foreground text-sm">Kelola akun, profil perusahaan, approval, dan notifikasi.</p>
      </div>
      <Tabs defaultValue="account">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="account"><User className="w-4 h-4 mr-1" />Profil Akun</TabsTrigger>
          <TabsTrigger value="company"><Building2 className="w-4 h-4 mr-1" />Profil Perusahaan</TabsTrigger>
          <TabsTrigger value="approval"><ShieldCheck className="w-4 h-4 mr-1" />Approval</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="w-4 h-4 mr-1" />Notifikasi</TabsTrigger>
        </TabsList>
        <TabsContent value="account"><AccountTab user={user} /></TabsContent>
        <TabsContent value="company"><CompanyTab /></TabsContent>
        <TabsContent value="approval"><ApprovalTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Profil Akun ---------------- */
function AccountTab({ user }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  useEffect(() => { setName(user?.name || ''); }, [user?.name]);

  const saveName = async () => {
    if (!name.trim()) return toast.error('Nama wajib diisi');
    setSaving(true);
    try {
      const res = await fetch('/api/account/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Profil akun diperbarui');
      router.refresh();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const changePw = async () => {
    if (!pw.current || !pw.next) return toast.error('Isi password lama & baru');
    if (pw.next.length < 6) return toast.error('Password baru minimal 6 karakter');
    if (pw.next !== pw.confirm) return toast.error('Konfirmasi password tidak cocok');
    setPwSaving(true);
    try {
      const { error } = await authClient.changePassword({ currentPassword: pw.current, newPassword: pw.next, revokeOtherSessions: false });
      if (error) throw new Error(error.message || 'Gagal ganti password');
      toast.success('Password berhasil diganti');
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) { toast.error(e.message || 'Gagal ganti password (cek password lama)'); } finally { setPwSaving(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Profil Akun</CardTitle><CardDescription>Informasi akun Anda.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <F label="Nama"><Input value={name} onChange={e => setName(e.target.value)} /></F>
            <F label="Email"><Input value={user?.email || ''} disabled /></F>
          </div>
          <F label="Role"><Input value={user?.role || '-'} disabled /></F>
          <div className="flex justify-end"><Button size="sm" onClick={saveName} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan Profil</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="w-4 h-4" />Ganti Password</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <F label="Password Lama"><Input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></F>
            <F label="Password Baru"><Input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></F>
            <F label="Konfirmasi Baru"><Input type="password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} /></F>
          </div>
          <div className="flex justify-end"><Button size="sm" variant="outline" onClick={changePw} disabled={pwSaving}>{pwSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}Ganti Password</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- Profil Perusahaan ---------------- */
function CompanyTab() {
  const { data, mutate } = useSWR('/api/settings/company', fetcher);
  const [f, setF] = useState({ name: '', address: '', contact: '', bank: '', logo: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data?.data?.value) setF(v => ({ ...v, ...data.data.value })); }, [data]);

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 800 * 1024) return toast.error('Ukuran logo maks 800KB');
    const reader = new FileReader();
    reader.onload = () => setF(v => ({ ...v, logo: reader.result }));
    reader.readAsDataURL(file);
  };
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/company', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ value: f }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      setPdfCompany(f); // langsung terpakai di PDF berikutnya
      toast.success('Profil perusahaan disimpan (dipakai di header PDF)');
      mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Profil Perusahaan</CardTitle><CardDescription>Dipakai sebagai kop/header pada semua PDF (PO, Invoice, Surat Jalan, Tally).</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-lg border bg-muted/40 flex items-center justify-center overflow-hidden">
            {f.logo ? <img src={f.logo} alt="logo" className="object-contain w-full h-full" /> : <Building2 className="w-8 h-8 text-muted-foreground" />}
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Logo Perusahaan (untuk PDF)</Label>
            <div className="flex gap-2">
              <label className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 py-1.5 cursor-pointer hover:bg-slate-50">
                <Upload className="w-4 h-4" /> Unggah Logo
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={onLogo} />
              </label>
              {f.logo && <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setF(v => ({ ...v, logo: '' }))}><Trash2 className="w-4 h-4 mr-1" />Hapus</Button>}
            </div>
            <p className="text-[11px] text-muted-foreground">PNG/JPG, maks 800KB. Tampil di pojok kiri-atas dokumen.</p>
          </div>
        </div>
        <Separator />
        <F label="Nama Perusahaan"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="PT Ladang Pangan Indonesia" /></F>
        <F label="Alamat"><Textarea value={f.address} onChange={e => setF({ ...f, address: e.target.value })} placeholder="Jl. ..., Kota, Provinsi, Kode Pos" rows={2} /></F>
        <F label="Kontak (Telp / Email / NPWP)"><Input value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} placeholder="Telp: ...  ·  Email: ...  ·  NPWP: ..." /></F>
        <F label="Info Bank (opsional)" hint="Muncul di area pembayaran invoice bila tersedia."><Input value={f.bank} onChange={e => setF({ ...f, bank: e.target.value })} placeholder="BCA 1234567890 a.n. ..." /></F>
        <div className="flex justify-end"><Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan</Button></div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Approval ---------------- */
function ApprovalTab() {
  const { data, mutate } = useSWR('/api/settings/approval', fetcher);
  const [f, setF] = useState({ enabled: false, modules: { po: false, so: false, wo: false, payment: false }, approverRole: 'supervisor', threshold: 0 });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data?.data?.value) setF(v => ({ ...v, ...data.data.value, modules: { ...v.modules, ...(data.data.value.modules || {}) } })); }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/approval', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ value: f }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Gagal');
      toast.success('Pengaturan approval disimpan');
      mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Pengaturan Approval</CardTitle><CardDescription>Aktifkan alur persetujuan dan tentukan modul mana yang wajib disetujui.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div><div className="font-medium text-sm">Aktifkan Alur Approval</div><div className="text-[11px] text-muted-foreground">Master switch untuk seluruh persetujuan.</div></div>
          <Switch checked={!!f.enabled} onCheckedChange={v => setF({ ...f, enabled: v })} />
        </div>
        <div className={f.enabled ? '' : 'opacity-50 pointer-events-none'}>
          <Label className="text-xs">Wajib Approval untuk Modul</Label>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            {APPROVAL_MODULES.map(m => (
              <label key={m.key} className="flex items-start gap-3 border rounded-lg p-3 cursor-pointer hover:bg-slate-50">
                <Switch checked={!!f.modules?.[m.key]} onCheckedChange={v => setF(s => ({ ...s, modules: { ...s.modules, [m.key]: v } }))} />
                <div><div className="text-sm font-medium">{m.label}</div><div className="text-[11px] text-muted-foreground">{m.desc}</div></div>
              </label>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <F label="Disetujui oleh (role)">
              <Select value={f.approverRole} onValueChange={v => setF({ ...f, approverRole: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="direktur">Direktur</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Ambang Nominal (Rp) — 0 = semua wajib" hint="Approval hanya dibutuhkan bila nilai dokumen ≥ ambang ini.">
              <Input type="number" value={f.threshold} onChange={e => setF({ ...f, threshold: Number(e.target.value) })} />
            </F>
          </div>
        </div>
        <div className="flex justify-end"><Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan</Button></div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Notifikasi ---------------- */
function NotificationsTab() {
  const { data, mutate } = useSWR('/api/settings/notifications', fetcher);
  const [f, setF] = useState(() => Object.fromEntries(NOTIF_TYPES.map(n => [n.key, true])));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data?.data?.value && Object.keys(data.data.value).length) setF(v => ({ ...v, ...data.data.value })); }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ value: f }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Gagal');
      toast.success('Pengaturan notifikasi disimpan');
      mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Notifikasi</CardTitle><CardDescription>Aktif/nonaktifkan jenis notifikasi yang ingin Anda terima.</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        {NOTIF_TYPES.map(n => (
          <div key={n.key} className="flex items-center justify-between rounded-lg border p-3">
            <div><div className="text-sm font-medium">{n.label}</div><div className="text-[11px] text-muted-foreground">{n.desc}</div></div>
            <Switch checked={f[n.key] !== false} onCheckedChange={v => setF(s => ({ ...s, [n.key]: v }))} />
          </div>
        ))}
        <div className="flex justify-end pt-1"><Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan</Button></div>
      </CardContent>
    </Card>
  );
}
