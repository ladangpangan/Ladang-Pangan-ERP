'use client';

import React, { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, Save, Loader2, RefreshCw, Building, FileSpreadsheet, PackageX } from 'lucide-react';
import { fmtRp, fmtDate, acctFetcher, todayStr } from '@/lib/accounting/ui';
import { exportToExcel } from '@/lib/xlsx-export';

export default function FixedAssetsPage() {
  const [archived, setArchived] = useState(false);
  const key = `/api/accounting/fixed-assets?archived=${archived ? '1' : '0'}`;
  const { data, mutate, isLoading } = useSWR(key, acctFetcher);
  const rows = data?.data || [];
  const { data: accData } = useSWR('/api/accounting/accounts?archived=0', acctFetcher);
  const accounts = (accData?.data || []).filter((a) => a.is_postable);

  const [dlg, setDlg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const empty = { code: '', name: '', category: '', acquisitionDate: todayStr(), acquisitionCost: 0, salvageValue: 0, usefulLifeMonths: 60, expenseAccountCode: '', accumAccountCode: '', assetAccountCode: '', postDepreciation: true, notes: '' };
  const [f, setF] = useState(empty);

  const openNew = () => { setF(empty); setDlg({ new: true }); };
  const openEdit = (a) => {
    setF({ code: a.code || '', name: a.name, category: a.category || '', acquisitionDate: new Date(a.acquisition_date * 1000).toISOString().slice(0, 10), acquisitionCost: a.acquisition_cost, salvageValue: a.salvage_value, usefulLifeMonths: a.useful_life_months, expenseAccountCode: a.expense_account_code || '', accumAccountCode: a.accum_account_code || '', assetAccountCode: a.asset_account_code || '', postDepreciation: !!a.post_depreciation, notes: a.notes || '' });
    setDlg(a);
  };

  const save = async () => {
    if (!f.name.trim()) return toast.error('Nama aset wajib diisi');
    setSaving(true);
    try {
      const isNew = dlg?.new;
      const url = isNew ? '/api/accounting/fixed-assets' : `/api/accounting/fixed-assets/${dlg.id}`;
      const body = { ...f, expenseAccountCode: f.expenseAccountCode || null, accumAccountCode: f.accumAccountCode || null, assetAccountCode: f.assetAccountCode || null };
      const res = await fetch(url, { method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(isNew ? 'Aset ditambahkan' : 'Aset diperbarui'); setDlg(null); mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const act = async (a, action, payload) => {
    try {
      const res = await fetch(`/api/accounting/fixed-assets/${a.id}${action ? '/' + action : ''}`, { method: action ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: payload ? JSON.stringify(payload) : undefined });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Berhasil'); mutate();
    } catch (e) { toast.error(e.message); }
  };
  const del = async (a) => { if (!confirm(`Hapus aset ${a.name}? Jurnal penyusutannya juga dihapus.`)) return; act(a, null); };

  const sync = async () => {
    setSyncing(true);
    try { const r = await fetch('/api/accounting/sync', { method: 'POST', credentials: 'include' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); toast.success(`Penyusutan diposting (${j.count} jurnal).`); mutate(); }
    catch (e) { toast.error(e.message); } finally { setSyncing(false); }
  };

  const doExport = () => {
    exportToExcel('aset-tetap', [{ name: 'Aset Tetap', headers: [
      { key: 'code', label: 'Kode' }, { key: 'name', label: 'Nama' }, { key: 'category', label: 'Kategori' },
      { key: 'acq', label: 'Tgl Perolehan' }, { key: 'cost', label: 'Harga Perolehan' }, { key: 'life', label: 'Umur (bln)' },
      { key: 'monthly', label: 'Penyusutan/bln' }, { key: 'accum', label: 'Akumulasi' }, { key: 'book', label: 'Nilai Buku' }, { key: 'status', label: 'Status' },
    ], rows: rows.map((a) => ({ code: a.code, name: a.name, category: a.category, acq: fmtDate(a.acquisition_date), cost: a.acquisition_cost, life: a.useful_life_months, monthly: a._status?.monthlyDepreciation, accum: a._status?.accumulated, book: a._status?.bookValue, status: a.status })) }]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Building className="w-6 h-6 text-emerald-600" />Aset Tetap & Penyusutan</h1>
          <p className="text-muted-foreground text-sm">Kelola aset tetap; penyusutan garis lurus diposting otomatis tiap bulan ke jurnal.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={sync} disabled={syncing}>{syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Posting Penyusutan</Button>
          <Button variant="outline" onClick={doExport} disabled={!rows.length}><FileSpreadsheet className="w-4 h-4 mr-2" />Excel</Button>
          <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Tambah Aset</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{rows.length} aset {archived ? 'terarsip' : 'aktif'}</CardTitle>
          <div className="inline-flex rounded-lg border p-0.5 text-xs">
            <button onClick={() => setArchived(false)} className={`px-3 py-1.5 rounded-md ${!archived ? 'bg-emerald-600 text-white' : 'text-muted-foreground'}`}>Aktif</button>
            <button onClick={() => setArchived(true)} className={`px-3 py-1.5 rounded-md ${archived ? 'bg-emerald-600 text-white' : 'text-muted-foreground'}`}>Arsip</button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Kode</TableHead><TableHead>Nama</TableHead><TableHead>Tgl Perolehan</TableHead>
                <TableHead className="text-right">Harga Perolehan</TableHead><TableHead className="text-right">Umur</TableHead>
                <TableHead className="text-right">Penyusutan/bln</TableHead><TableHead className="text-right">Akumulasi</TableHead>
                <TableHead className="text-right">Nilai Buku</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
                {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Belum ada aset tetap.</TableCell></TableRow>}
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.code || '-'}</TableCell>
                    <TableCell className="text-sm">{a.name}{a.category ? <div className="text-[11px] text-muted-foreground">{a.category}</div> : null}</TableCell>
                    <TableCell className="text-xs">{fmtDate(a.acquisition_date)}</TableCell>
                    <TableCell className="text-right text-sm">{fmtRp(a.acquisition_cost)}</TableCell>
                    <TableCell className="text-right text-xs">{a.useful_life_months} bln</TableCell>
                    <TableCell className="text-right text-xs">{fmtRp(a._status?.monthlyDepreciation)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtRp(a._status?.accumulated)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{fmtRp(a._status?.bookValue)}</TableCell>
                    <TableCell>{a.status === 'disposed' ? <Badge variant="outline" className="text-[10px] bg-rose-100 text-rose-700">Dilepas</Badge> : <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-700">Aktif</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {a.status !== 'disposed' ? <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500" title="Lepas/Dispose" onClick={() => act(a, 'dispose', {})}><PackageX className="w-3.5 h-3.5" /></Button> : <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" title="Aktifkan kembali" onClick={() => act(a, 'dispose', { restore: true })}><ArchiveRestore className="w-3.5 h-3.5" /></Button>}
                        {!archived ? <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-600" onClick={() => act(a, 'archive')}><Archive className="w-3.5 h-3.5" /></Button> : <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={() => act(a, 'restore')}><ArchiveRestore className="w-3.5 h-3.5" /></Button>}
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => del(a)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{dlg?.new ? 'Tambah Aset Tetap' : 'Edit Aset Tetap'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Kode</Label><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="FA-001" /></div>
              <div className="col-span-2"><Label className="text-xs">Nama Aset</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Kategori</Label><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Kendaraan / Mesin" /></div>
              <div><Label className="text-xs">Tanggal Perolehan</Label><Input type="date" value={f.acquisitionDate} onChange={(e) => setF({ ...f, acquisitionDate: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Harga Perolehan</Label><CurrencyInput value={f.acquisitionCost} onChange={(v) => setF({ ...f, acquisitionCost: v })} /></div>
              <div><Label className="text-xs">Nilai Residu</Label><CurrencyInput value={f.salvageValue} onChange={(v) => setF({ ...f, salvageValue: v })} /></div>
              <div><Label className="text-xs">Umur (bulan)</Label><Input type="number" value={f.usefulLifeMonths} onChange={(e) => setF({ ...f, usefulLifeMonths: e.target.value })} /></div>
            </div>
            <div className="text-[11px] text-muted-foreground">Penyusutan/bln ≈ {fmtRp((Number(f.acquisitionCost) - Number(f.salvageValue)) / Math.max(1, Number(f.usefulLifeMonths)))} (garis lurus)</div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Akun Beban Penyusutan</Label>
                <Select value={f.expenseAccountCode} onValueChange={(v) => setF({ ...f, expenseAccountCode: v === '_def' ? '' : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Default (pemetaan)" /></SelectTrigger>
                  <SelectContent><SelectItem value="_def">Default (pemetaan)</SelectItem>{accounts.filter((a) => a.type === 'expense').map((a) => <SelectItem key={a.id} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Akun Akumulasi</Label>
                <Select value={f.accumAccountCode} onValueChange={(v) => setF({ ...f, accumAccountCode: v === '_def' ? '' : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Default (pemetaan)" /></SelectTrigger>
                  <SelectContent><SelectItem value="_def">Default (pemetaan)</SelectItem>{accounts.filter((a) => a.type === 'asset').map((a) => <SelectItem key={a.id} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Akun Aset</Label>
                <Select value={f.assetAccountCode} onValueChange={(v) => setF({ ...f, assetAccountCode: v === '_def' ? '' : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Default (pemetaan)" /></SelectTrigger>
                  <SelectContent><SelectItem value="_def">Default (pemetaan)</SelectItem>{accounts.filter((a) => a.type === 'asset').map((a) => <SelectItem key={a.id} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 border rounded-md p-2"><Switch checked={f.postDepreciation} onCheckedChange={(v) => setF({ ...f, postDepreciation: v })} /><span className="text-xs">Posting penyusutan otomatis</span></div>
            <div><Label className="text-xs">Catatan</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDlg(null)}>Batal</Button><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
