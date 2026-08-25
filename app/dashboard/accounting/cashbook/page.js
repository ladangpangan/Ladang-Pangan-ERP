'use client';

import React, { useState, useMemo } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Plus, Trash2, Pencil, Loader2, Receipt, Camera, X, Wallet,
  ArrowUpRight, ArrowDownLeft, PiggyBank, HandCoins, ArrowLeftRight,
} from 'lucide-react';
import { fmtRp, fmtDate, acctFetcher, SOURCE_LABEL, SOURCE_COLOR, defaultRange, todayStr } from '@/lib/accounting/ui';

const ACTIONS = [
  { type: 'EXPENSE', label: 'Catat Pengeluaran', icon: ArrowUpRight, cls: 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100', desc: 'Bayar beban / biaya' },
  { type: 'INCOME', label: 'Catat Pemasukan', icon: ArrowDownLeft, cls: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100', desc: 'Pendapatan di luar penjualan' },
  { type: 'CAPITAL', label: 'Setor Modal', icon: PiggyBank, cls: 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100', desc: 'Tambah modal ke kas/bank' },
  { type: 'DRAWING', label: 'Ambil Pribadi', icon: HandCoins, cls: 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100', desc: 'Uang diambil pemilik (prive)' },
  { type: 'TRANSFER', label: 'Transfer Kas/Bank', icon: ArrowLeftRight, cls: 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100', desc: 'Pindah tunai ↔ rekening' },
];

async function compressImage(file, maxDim = 1200, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export default function CashbookPage() {
  const [range, setRange] = useState(defaultRange());
  const key = `/api/accounting/cashbook?from=${range.from}&to=${range.to}`;
  const { data, mutate, isLoading } = useSWR(key, acctFetcher);
  const rows = data?.data || [];
  const { data: accData } = useSWR('/api/accounting/accounts?archived=0', acctFetcher);
  const { data: mapData } = useSWR('/api/accounting/mapping', acctFetcher);
  const accounts = accData?.data || [];
  const mapping = mapData?.data || {};

  const [dlg, setDlg] = useState(null); // {type, edit?}
  const [viewImg, setViewImg] = useState(null);

  const totals = useMemo(() => {
    let masuk = 0, keluar = 0;
    rows.forEach((r) => { if (r.direction === 'in') masuk += r.amount; else if (r.direction === 'out') keluar += r.amount; });
    return { masuk, keluar, net: masuk - keluar };
  }, [rows]);

  const del = async (r) => {
    if (!confirm('Hapus transaksi ini?')) return;
    try {
      const res = await fetch(`/api/accounting/cashbook/${r.id}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Transaksi dihapus'); mutate();
    } catch (e) { toast.error(e.message); }
  };

  const openImg = async (r) => {
    try {
      const res = await fetch(`/api/accounting/cashbook/${r.id}/attachment`, { credentials: 'include' });
      const j = await res.json();
      setViewImg(j.attachment || null);
      if (!j.attachment) toast.info('Tidak ada foto nota.');
    } catch (e) { toast.error('Gagal memuat nota'); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Receipt className="w-6 h-6 text-emerald-600" />Pencatatan Cepat</h1>
          <p className="text-muted-foreground text-sm">Catat pengeluaran & pemasukan tanpa perlu paham debit/kredit — jurnal dibuat otomatis.</p>
        </div>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">Dari</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-36" /></div>
          <div><Label className="text-xs">Sampai</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-36" /></div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {ACTIONS.map((a) => (
          <button key={a.type} onClick={() => setDlg({ type: a.type })} className={`border rounded-xl p-4 text-left transition-colors ${a.cls}`}>
            <a.icon className="w-6 h-6 mb-2" />
            <div className="font-semibold text-sm leading-tight">{a.label}</div>
            <div className="text-[11px] opacity-80 mt-0.5">{a.desc}</div>
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Pemasukan</div><div className="text-xl font-bold text-emerald-600 mt-1">{fmtRp(totals.masuk)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Pengeluaran</div><div className="text-xl font-bold text-rose-600 mt-1">{fmtRp(totals.keluar)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Selisih (Net)</div><div className={`text-xl font-bold mt-1 ${totals.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtRp(totals.net)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{rows.length} transaksi</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-28">Tanggal</TableHead><TableHead>Jenis</TableHead><TableHead>Kategori</TableHead>
                <TableHead>Kas/Bank</TableHead><TableHead className="text-right">Nominal</TableHead><TableHead>Keterangan</TableHead>
                <TableHead className="text-center">Nota</TableHead><TableHead className="text-right w-24">Aksi</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
                {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Belum ada transaksi. Klik salah satu tombol di atas untuk mencatat.</TableCell></TableRow>}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{fmtDate(r.date)}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] ${SOURCE_COLOR[r.type] || ''}`}>{SOURCE_LABEL[r.type] || r.type}</Badge></TableCell>
                    <TableCell className="text-sm">{r.category}</TableCell>
                    <TableCell className="text-xs">{r.cash || '-'}</TableCell>
                    <TableCell className={`text-right text-sm font-medium ${r.direction === 'out' ? 'text-rose-600' : r.direction === 'in' ? 'text-emerald-600' : 'text-slate-600'}`}>{r.direction === 'out' ? '− ' : r.direction === 'in' ? '+ ' : ''}{fmtRp(r.amount)}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{r.note}</TableCell>
                    <TableCell className="text-center">{r.hasAttachment ? <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openImg(r)}><Receipt className="w-3.5 h-3.5 text-emerald-600" /></Button> : <span className="text-muted-foreground text-xs">-</span>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDlg({ type: r.type, edit: r })}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => del(r)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {dlg && <QuickDialog dlg={dlg} accounts={accounts} mapping={mapping} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); mutate(); }} />}

      <Dialog open={!!viewImg} onOpenChange={(o) => !o && setViewImg(null)}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Foto Nota</DialogTitle></DialogHeader>
          {viewImg ? <img src={viewImg} alt="Nota" className="w-full rounded-md border" /> : <p className="text-muted-foreground text-sm">Tidak ada foto.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuickDialog({ dlg, accounts, mapping, onClose, onSaved }) {
  const type = dlg.type;
  const edit = dlg.edit;
  const meta = ACTIONS.find((a) => a.type === type) || {};
  const postable = accounts.filter((a) => a.is_postable);
  const expenseCats = postable.filter((a) => ['expense', 'cogs', 'other_expense'].includes(a.type));
  const incomeCats = postable.filter((a) => ['other_income', 'revenue'].includes(a.type));
  let cashAccts = postable.filter((a) => a.type === 'asset' && /kas|bank/i.test(a.name));
  if (cashAccts.length === 0) cashAccts = postable.filter((a) => [mapping.kas, mapping.bank].includes(a.code));

  const [f, setF] = useState(() => ({
    date: edit ? new Date(edit.date * 1000).toISOString().slice(0, 10) : todayStr(),
    amount: edit ? edit.amount : 0,
    categoryCode: edit ? edit.categoryCode : (type === 'EXPENSE' ? (mapping.beban_operasional || expenseCats[0]?.code || '') : type === 'INCOME' ? (mapping.pendapatan_lain || incomeCats[0]?.code || '') : ''),
    cashCode: edit ? edit.cashCode : (mapping.kas || cashAccts[0]?.code || ''),
    cashCode2: edit ? edit.cashCode2 : (mapping.bank || cashAccts[1]?.code || cashAccts[0]?.code || ''),
    note: edit ? (edit.note || '') : '',
  }));
  const [attachment, setAttachment] = useState(undefined); // undefined = unchanged, null = removed, string = new
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('File harus berupa gambar');
    setUploading(true);
    try { const data = await compressImage(file); setAttachment(data); toast.success('Foto nota siap'); }
    catch { toast.error('Gagal memproses foto'); } finally { setUploading(false); }
  };

  const save = async () => {
    if (!(Number(f.amount) > 0)) return toast.error('Nominal harus lebih dari 0');
    setSaving(true);
    try {
      const payload = { type, date: f.date, amount: Number(f.amount), note: f.note };
      if (type === 'EXPENSE' || type === 'INCOME') payload.categoryCode = f.categoryCode;
      if (type !== 'TRANSFER') payload.cashCode = f.cashCode;
      if (type === 'TRANSFER') { payload.cashCode = f.cashCode; payload.cashCode2 = f.cashCode2; }
      if (attachment !== undefined) payload.attachment = attachment;
      const url = edit ? `/api/accounting/cashbook/${edit.id}` : '/api/accounting/cashbook';
      const res = await fetch(url, { method: edit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(edit ? 'Transaksi diperbarui' : 'Transaksi tercatat'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const showPhoto = type === 'EXPENSE' || type === 'INCOME';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{meta.icon && <meta.icon className="w-5 h-5" />}{edit ? 'Edit — ' : ''}{meta.label}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Tanggal</Label><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div><Label className="text-xs">Nominal (Rp)</Label><CurrencyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></div>
          </div>

          {type === 'EXPENSE' && (
            <div><Label className="text-xs">Kategori Pengeluaran</Label>
              <Select value={f.categoryCode} onValueChange={(v) => setF({ ...f, categoryCode: v })}><SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>{expenseCats.map((a) => <SelectItem key={a.id} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          {type === 'INCOME' && (
            <div><Label className="text-xs">Kategori Pemasukan</Label>
              <Select value={f.categoryCode} onValueChange={(v) => setF({ ...f, categoryCode: v })}><SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>{incomeCats.map((a) => <SelectItem key={a.id} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
            </div>
          )}

          {type !== 'TRANSFER' && (
            <div><Label className="text-xs">{type === 'EXPENSE' || type === 'DRAWING' ? 'Diambil dari' : 'Masuk ke'}</Label>
              <Select value={f.cashCode} onValueChange={(v) => setF({ ...f, cashCode: v })}><SelectTrigger><SelectValue placeholder="Kas / Bank" /></SelectTrigger>
                <SelectContent>{cashAccts.map((a) => <SelectItem key={a.id} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          {type === 'TRANSFER' && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Dari</Label>
                <Select value={f.cashCode} onValueChange={(v) => setF({ ...f, cashCode: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{cashAccts.map((a) => <SelectItem key={a.id} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
              </div>
              <div><Label className="text-xs">Ke</Label>
                <Select value={f.cashCode2} onValueChange={(v) => setF({ ...f, cashCode2: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{cashAccts.map((a) => <SelectItem key={a.id} value={a.code}>{a.name}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
          )}

          <div><Label className="text-xs">Keterangan</Label><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Catatan / rincian transaksi" /></div>

          {showPhoto && (
            <div>
              <Label className="text-xs">Foto Nota (opsional)</Label>
              <div className="flex items-center gap-2 mt-1">
                <label className="inline-flex items-center gap-2 border rounded-md px-3 h-9 text-sm cursor-pointer hover:bg-muted">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}Ambil / Pilih Foto
                  <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                </label>
                {(attachment || (edit?.hasAttachment && attachment === undefined)) && (
                  <span className="text-xs text-emerald-600 flex items-center gap-1">Nota terlampir
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => setAttachment(null)}><X className="w-3.5 h-3.5" /></Button>
                  </span>
                )}
              </div>
              {attachment && typeof attachment === 'string' && <img src={attachment} alt="preview" className="mt-2 h-24 rounded border object-cover" />}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving || uploading}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}{edit ? 'Simpan Perubahan' : 'Simpan'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
