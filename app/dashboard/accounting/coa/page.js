'use client';

import React, { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, Save, Loader2, Lock, BookOpen } from 'lucide-react';
import { fmtRp, acctFetcher, TYPE_LABEL, TYPE_COLOR } from '@/lib/accounting/ui';

const TYPES = [
  { v: 'asset', l: 'Aset' }, { v: 'liability', l: 'Liabilitas' }, { v: 'equity', l: 'Ekuitas' },
  { v: 'revenue', l: 'Pendapatan' }, { v: 'cogs', l: 'Beban Pokok Penjualan (HPP)' },
  { v: 'expense', l: 'Beban Operasional' }, { v: 'other_income', l: 'Pendapatan Lain' }, { v: 'other_expense', l: 'Beban Lain' },
];
const CF = [
  { v: 'operating', l: 'Operasi' }, { v: 'investing', l: 'Investasi' }, { v: 'financing', l: 'Pendanaan' }, { v: 'none', l: '—' },
];

export default function CoaPage() {
  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><BookOpen className="w-6 h-6 text-emerald-600" />Chart of Account</h1>
        <p className="text-muted-foreground text-sm">Daftar akun (SAK EP), saldo awal, pemetaan akun otomatis, dan pengaturan pajak.</p>
      </div>
      <Tabs defaultValue="accounts">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="accounts">Daftar Akun</TabsTrigger>
          <TabsTrigger value="opening">Saldo Awal</TabsTrigger>
          <TabsTrigger value="mapping">Pemetaan Akun</TabsTrigger>
          <TabsTrigger value="settings">Pengaturan</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts"><AccountsTab /></TabsContent>
        <TabsContent value="opening"><OpeningTab /></TabsContent>
        <TabsContent value="mapping"><MappingTab /></TabsContent>
        <TabsContent value="settings"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------- Daftar Akun ------------------- */
function AccountsTab() {
  const [archived, setArchived] = useState(false);
  const key = `/api/accounting/accounts?archived=${archived ? '1' : '0'}`;
  const { data, mutate, isLoading } = useSWR(key, acctFetcher);
  const rows = data?.data || [];
  const [dlg, setDlg] = useState(null); // account being edited, or {} for new
  const [saving, setSaving] = useState(false);

  const emptyForm = { code: '', name: '', type: 'asset', normalBalance: 'debit', category: '', cashFlowCategory: 'operating', isPostable: true, openingBalance: 0, description: '' };
  const [f, setF] = useState(emptyForm);

  const openNew = () => { setF(emptyForm); setDlg({ new: true }); };
  const openEdit = (a) => {
    setF({ code: a.code, name: a.name, type: a.type, normalBalance: a.normal_balance, category: a.category || '', cashFlowCategory: a.cash_flow_category || 'operating', isPostable: !!a.is_postable, openingBalance: a.opening_balance || 0, description: a.description || '' });
    setDlg(a);
  };

  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) return toast.error('Kode & nama wajib diisi');
    setSaving(true);
    try {
      const isNew = dlg?.new;
      const url = isNew ? '/api/accounting/accounts' : `/api/accounting/accounts/${dlg.id}`;
      const res = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(f) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(isNew ? 'Akun ditambahkan' : 'Akun diperbarui');
      setDlg(null); mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const doArchive = async (a, restore) => {
    try {
      const res = await fetch(`/api/accounting/accounts/${a.id}/${restore ? 'restore' : 'archive'}`, { method: 'POST', credentials: 'include' });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(restore ? 'Akun dipulihkan' : 'Akun diarsipkan'); mutate();
    } catch (e) { toast.error(e.message); }
  };
  const doDelete = async (a) => {
    if (!confirm(`Hapus akun ${a.code} - ${a.name}?`)) return;
    try {
      const res = await fetch(`/api/accounting/accounts/${a.id}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Akun dihapus'); mutate();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Daftar Akun</CardTitle>
          <CardDescription>{rows.length} akun {archived ? 'terarsip' : 'aktif'}.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border p-0.5 text-xs">
            <button onClick={() => setArchived(false)} className={`px-3 py-1.5 rounded-md ${!archived ? 'bg-emerald-600 text-white' : 'text-muted-foreground'}`}>Aktif</button>
            <button onClick={() => setArchived(true)} className={`px-3 py-1.5 rounded-md ${archived ? 'bg-emerald-600 text-white' : 'text-muted-foreground'}`}>Arsip</button>
          </div>
          <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" />Tambah Akun</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Kode</TableHead>
                <TableHead>Nama Akun</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Saldo Normal</TableHead>
                <TableHead className="text-right">Saldo Awal</TableHead>
                <TableHead className="text-right w-32">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Tidak ada akun.</TableCell></TableRow>}
              {rows.map((a) => (
                <TableRow key={a.id} className={a.is_postable ? '' : 'bg-slate-50/60'}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>
                    <span className={a.is_postable ? '' : 'font-semibold'}>{a.name}</span>
                    {a.is_system ? <Lock className="w-3 h-3 inline ml-1.5 text-muted-foreground" /> : null}
                    {!a.is_postable && <Badge variant="outline" className="ml-2 text-[10px]">Header</Badge>}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={`text-[10px] ${TYPE_COLOR[a.type] || ''}`}>{TYPE_LABEL[a.type] || a.type}</Badge></TableCell>
                  <TableCell className="text-xs capitalize">{a.normal_balance === 'credit' ? 'Kredit' : 'Debit'}</TableCell>
                  <TableCell className="text-right text-xs">{a.opening_balance ? fmtRp(a.opening_balance) : '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}><Pencil className="w-3.5 h-3.5" /></Button>
                      {!archived && !a.is_system && <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-600" onClick={() => doArchive(a, false)}><Archive className="w-3.5 h-3.5" /></Button>}
                      {archived && <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={() => doArchive(a, true)}><ArchiveRestore className="w-3.5 h-3.5" /></Button>}
                      {!a.is_system && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => doDelete(a)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dlg?.new ? 'Tambah Akun' : 'Edit Akun'}</DialogTitle>
            {dlg?.is_system && <DialogDescription className="text-amber-600">Akun sistem — kode & tipe terkunci.</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Kode</Label><Input value={f.code} disabled={dlg?.is_system} onChange={(e) => setF({ ...f, code: e.target.value })} className="font-mono" /></div>
              <div className="col-span-2"><Label className="text-xs">Nama Akun</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tipe</Label>
                <Select value={f.type} disabled={dlg?.is_system} onValueChange={(v) => setF({ ...f, type: v, normalBalance: ['liability', 'equity', 'revenue', 'other_income'].includes(v) ? 'credit' : 'debit' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Saldo Normal</Label>
                <Select value={f.normalBalance} disabled={dlg?.is_system} onValueChange={(v) => setF({ ...f, normalBalance: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="debit">Debit</SelectItem><SelectItem value="credit">Kredit</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Kategori (untuk laporan)</Label><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="mis. Aset Lancar" /></div>
              <div>
                <Label className="text-xs">Kategori Arus Kas</Label>
                <Select value={f.cashFlowCategory} onValueChange={(v) => setF({ ...f, cashFlowCategory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CF.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div><Label className="text-xs">Saldo Awal (Rp)</Label><CurrencyInput value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} disabled={!f.isPostable} /></div>
              <label className="flex items-center gap-2 border rounded-md p-2 h-10 cursor-pointer">
                <Switch checked={f.isPostable} onCheckedChange={(v) => setF({ ...f, isPostable: v })} disabled={dlg?.is_system} />
                <span className="text-xs">Akun dapat dijurnal (detail)</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Batal</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ------------------- Saldo Awal ------------------- */
function OpeningTab() {
  const { data, mutate, isLoading } = useSWR('/api/accounting/accounts?archived=0', acctFetcher);
  const accounts = (data?.data || []).filter((a) => a.is_postable);
  const [vals, setVals] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m = {}; accounts.forEach((a) => { m[a.id] = a.opening_balance || 0; });
    setVals(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const total = useMemo(() => {
    let d = 0, c = 0;
    accounts.forEach((a) => { const v = Number(vals[a.id] || 0); if (a.normal_balance === 'credit') c += v; else d += v; });
    return { d, c, diff: d - c };
  }, [vals, accounts]);

  const saveAll = async () => {
    setSaving(true);
    try {
      const changed = accounts.filter((a) => Number(a.opening_balance || 0) !== Number(vals[a.id] || 0));
      for (const a of changed) {
        const res = await fetch(`/api/accounting/accounts/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ openingBalance: Number(vals[a.id] || 0) }) });
        if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Gagal'); }
      }
      toast.success(`Saldo awal disimpan (${changed.length} akun diperbarui).`);
      mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saldo Awal (Neraca Pembukaan)</CardTitle>
        <CardDescription>Isi saldo awal tiap akun pada tanggal pembukaan. Selisih otomatis dibebankan ke Laba Ditahan.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border overflow-x-auto max-h-[520px]">
          <Table>
            <TableHeader className="sticky top-0 bg-white">
              <TableRow><TableHead className="w-24">Kode</TableHead><TableHead>Nama</TableHead><TableHead>Normal</TableHead><TableHead className="text-right w-56">Saldo Awal (Rp)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell className="text-sm">{a.name}</TableCell>
                  <TableCell className="text-xs capitalize">{a.normal_balance === 'credit' ? 'Kredit' : 'Debit'}</TableCell>
                  <TableCell className="text-right"><CurrencyInput className="h-8 text-right" value={vals[a.id] || 0} onChange={(v) => setVals((s) => ({ ...s, [a.id]: v }))} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex gap-4">
            <span>Total Debit: <b>{fmtRp(total.d)}</b></span>
            <span>Total Kredit: <b>{fmtRp(total.c)}</b></span>
            <span className={Math.abs(total.diff) < 1 ? 'text-emerald-600' : 'text-amber-600'}>Selisih: <b>{fmtRp(total.diff)}</b>{Math.abs(total.diff) >= 1 && ' → ke Laba Ditahan'}</span>
          </div>
          <Button onClick={saveAll} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan Saldo Awal</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------- Pemetaan Akun ------------------- */
function MappingTab() {
  const { data, mutate } = useSWR('/api/accounting/mapping', acctFetcher);
  const { data: accData } = useSWR('/api/accounting/accounts?archived=0', acctFetcher);
  const accounts = (accData?.data || []).filter((a) => a.is_postable);
  const labels = data?.labels || {};
  const [map, setMap] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data?.data) setMap(data.data); }, [data]);

  const codeById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.code])), [accounts]);
  const idByCode = useMemo(() => Object.fromEntries(accounts.map((a) => [a.code, a.id])), [accounts]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/accounting/mapping', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ mapping: map }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Gagal');
      toast.success('Pemetaan akun disimpan'); mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Pemetaan Akun</CardTitle><CardDescription>Tentukan akun default yang dipakai posting otomatis tiap jenis transaksi.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {Object.keys(labels).map((k) => (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{labels[k]}</Label>
              <Select value={idByCode[map[k]] || ''} onValueChange={(v) => setMap((m) => ({ ...m, [k]: codeById[v] }))}>
                <SelectTrigger><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <div className="flex justify-end"><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan Pemetaan</Button></div>
      </CardContent>
    </Card>
  );
}

/* ------------------- Pengaturan ------------------- */
function SettingsTab() {
  const { data, mutate } = useSWR('/api/accounting/settings', acctFetcher);
  const [f, setF] = useState({ ppnEnabled: false, ppnRate: 11, openingDate: '', autoPost: true });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data?.data) setF((v) => ({ ...v, ...data.data })); }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/accounting/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ settings: f }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Gagal');
      toast.success('Pengaturan akuntansi disimpan'); mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Pengaturan Akuntansi</CardTitle><CardDescription>Basis akrual & persediaan perpetual. Sesuaikan pajak dan tanggal pembukaan.</CardDescription></CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div><div className="font-medium text-sm">Aktifkan PPN (PKP)</div><div className="text-[11px] text-muted-foreground">Jika aktif, nilai transaksi dipisah DPP & PPN Masukan/Keluaran.</div></div>
          <Switch checked={!!f.ppnEnabled} onCheckedChange={(v) => setF({ ...f, ppnEnabled: v })} />
        </div>
        <div className={f.ppnEnabled ? '' : 'opacity-50 pointer-events-none'}>
          <Label className="text-xs">Tarif PPN (%)</Label>
          <Input type="number" value={f.ppnRate} onChange={(e) => setF({ ...f, ppnRate: Number(e.target.value) })} className="w-32" />
        </div>
        <Separator />
        <div>
          <Label className="text-xs">Tanggal Pembukaan (Saldo Awal)</Label>
          <Input type="date" value={f.openingDate || ''} onChange={(e) => setF({ ...f, openingDate: e.target.value })} className="w-52" />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div><div className="font-medium text-sm">Posting Otomatis</div><div className="text-[11px] text-muted-foreground">Sinkronkan jurnal otomatis setiap membuka laporan.</div></div>
          <Switch checked={!!f.autoPost} onCheckedChange={(v) => setF({ ...f, autoPost: v })} />
        </div>
        <div className="flex justify-end"><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan</Button></div>
      </CardContent>
    </Card>
  );
}
