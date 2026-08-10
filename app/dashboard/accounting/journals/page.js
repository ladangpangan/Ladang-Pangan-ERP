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
import { Plus, RefreshCw, Loader2, Calculator, Eye, Trash2, Search, X } from 'lucide-react';
import { fmtRp, fmtDate, acctFetcher, SOURCE_LABEL, SOURCE_COLOR, defaultRange, todayStr } from '@/lib/accounting/ui';

export default function JournalsPage() {
  const [range, setRange] = useState(defaultRange());
  const [source, setSource] = useState('all');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const key = `/api/accounting/journals?from=${range.from}&to=${range.to}${source !== 'all' ? `&source=${source}` : ''}${qDebounced ? `&q=${encodeURIComponent(qDebounced)}` : ''}`;
  const { data, mutate, isLoading } = useSWR(key, acctFetcher);
  const rows = data?.data || [];

  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useState(null); // journal id to view
  const [manual, setManual] = useState(false);

  const applySearch = () => setQDebounced(q.trim());

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/accounting/sync', { method: 'POST', credentials: 'include' });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Posting otomatis selesai — ${j.count} jurnal.`); mutate();
    } catch (e) { toast.error(e.message); } finally { setSyncing(false); }
  };

  const delJournal = async (id) => {
    if (!confirm('Hapus jurnal manual ini?')) return;
    try {
      const r = await fetch(`/api/accounting/journals/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Gagal');
      toast.success('Jurnal dihapus'); mutate();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Calculator className="w-6 h-6 text-emerald-600" />Jurnal Umum</h1>
          <p className="text-muted-foreground text-sm">Seluruh jurnal otomatis dari transaksi ERP + jurnal manual (penyesuaian).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={sync} disabled={syncing}>{syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Posting Otomatis</Button>
          <Button onClick={() => setManual(true)}><Plus className="w-4 h-4 mr-1" />Jurnal Manual</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div><Label className="text-xs">Dari</Label><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-40" /></div>
          <div><Label className="text-xs">Sampai</Label><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-40" /></div>
          <div><Label className="text-xs">Sumber</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Sumber</SelectItem>
                {Object.keys(SOURCE_LABEL).map((k) => <SelectItem key={k} value={k}>{SOURCE_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-1">
            <div><Label className="text-xs">Cari</Label><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applySearch()} placeholder="No / deskripsi" className="w-48" /></div>
            <Button size="icon" variant="outline" onClick={applySearch}><Search className="w-4 h-4" /></Button>
            {qDebounced && <Button size="icon" variant="ghost" onClick={() => { setQ(''); setQDebounced(''); }}><X className="w-4 h-4" /></Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{rows.length} jurnal</CardTitle></CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Tanggal</TableHead>
                  <TableHead>No. Jurnal</TableHead>
                  <TableHead>Sumber</TableHead>
                  <TableHead>Deskripsi</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                  <TableHead className="text-right w-24">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</TableCell></TableRow>}
                {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Belum ada jurnal pada rentang ini.</TableCell></TableRow>}
                {rows.map((j) => (
                  <TableRow key={j.id} className="cursor-pointer" onClick={() => setView(j.id)}>
                    <TableCell className="text-xs">{fmtDate(j.entry_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{j.source_type === 'MANUAL' ? j.journal_number : (j.source_number || j.journal_number)}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] ${SOURCE_COLOR[j.source_type] || ''}`}>{SOURCE_LABEL[j.source_type] || j.source_type}</Badge></TableCell>
                    <TableCell className="text-xs max-w-[280px] truncate">{j.description}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{fmtRp(j.total_debit)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setView(j.id)}><Eye className="w-3.5 h-3.5" /></Button>
                        {j.source_type === 'MANUAL' && <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => delJournal(j.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {view && <JournalDetail id={view} onClose={() => setView(null)} />}
      {manual && <ManualJournalDialog onClose={() => setManual(false)} onSaved={() => { setManual(false); mutate(); }} />}
    </div>
  );
}

function JournalDetail({ id, onClose }) {
  const { data } = useSWR(`/api/accounting/journals/${id}`, acctFetcher);
  const j = data?.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Detail Jurnal {j?.journal_number || ''}</DialogTitle></DialogHeader>
        {!j ? <div className="py-6 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Memuat…</div> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Tanggal:</span> {fmtDate(j.entry_date)}</div>
              <div><span className="text-muted-foreground">Sumber:</span> <Badge variant="outline" className={`text-[10px] ${SOURCE_COLOR[j.source_type] || ''}`}>{SOURCE_LABEL[j.source_type] || j.source_type}</Badge> {j.source_number || ''}</div>
              <div className="col-span-2"><span className="text-muted-foreground">Deskripsi:</span> {j.description}</div>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Akun</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Kredit</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(j.lines || []).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm"><span className="font-mono text-xs text-muted-foreground mr-2">{l.account_code}</span>{l.account_name}{l.description ? <div className="text-[11px] text-muted-foreground">{l.description}</div> : null}</TableCell>
                      <TableCell className="text-right text-sm">{l.debit ? fmtRp(l.debit) : ''}</TableCell>
                      <TableCell className="text-right text-sm">{l.credit ? fmtRp(l.credit) : ''}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-slate-50">
                    <TableCell className="text-right">Total</TableCell>
                    <TableCell className="text-right">{fmtRp(j.total_debit)}</TableCell>
                    <TableCell className="text-right">{fmtRp(j.total_credit)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManualJournalDialog({ onClose, onSaved }) {
  const { data: accData } = useSWR('/api/accounting/accounts?archived=0', acctFetcher);
  const accounts = (accData?.data || []).filter((a) => a.is_postable);
  const [date, setDate] = useState(todayStr());
  const [desc, setDesc] = useState('');
  const [lines, setLines] = useState([{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const c = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    return { d, c, balanced: Math.abs(d - c) < 1 && d > 0 };
  }, [lines]);

  const upd = (i, k, v) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addRow = () => setLines((ls) => [...ls, { accountId: '', debit: 0, credit: 0 }]);
  const delRow = (i) => setLines((ls) => ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls);

  const save = async () => {
    if (!totals.balanced) return toast.error('Jurnal belum seimbang (Debit = Kredit).');
    const valid = lines.filter((l) => l.accountId && (Number(l.debit) || Number(l.credit)));
    if (valid.length < 2) return toast.error('Minimal 2 baris akun berisi.');
    setSaving(true);
    try {
      const res = await fetch('/api/accounting/journals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ date, description: desc, lines: valid }) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Jurnal manual ${j.journalNumber} tersimpan.`); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Jurnal Manual / Penyesuaian</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <div><Label className="text-xs">Tanggal</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label className="text-xs">Deskripsi</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="mis. Penyesuaian penyusutan" /></div>
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Akun</TableHead><TableHead className="text-right w-40">Debit</TableHead><TableHead className="text-right w-40">Kredit</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Select value={l.accountId} onValueChange={(v) => upd(i, 'accountId', v)}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                        <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><CurrencyInput className="h-8 text-right" value={l.debit} onChange={(v) => upd(i, 'debit', v ? (upd(i, 'credit', 0), v) : v)} /></TableCell>
                    <TableCell><CurrencyInput className="h-8 text-right" value={l.credit} onChange={(v) => upd(i, 'credit', v ? (upd(i, 'debit', 0), v) : v)} /></TableCell>
                    <TableCell><Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => delRow(i)}><Trash2 className="w-3.5 h-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-slate-50 font-semibold">
                  <TableCell><Button size="sm" variant="outline" onClick={addRow}><Plus className="w-3.5 h-3.5 mr-1" />Baris</Button></TableCell>
                  <TableCell className="text-right">{fmtRp(totals.d)}</TableCell>
                  <TableCell className="text-right">{fmtRp(totals.c)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className={`text-sm text-right ${totals.balanced ? 'text-emerald-600' : 'text-amber-600'}`}>{totals.balanced ? 'Seimbang ✓' : `Selisih ${fmtRp(totals.d - totals.c)}`}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={save} disabled={saving || !totals.balanced}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Simpan Jurnal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
