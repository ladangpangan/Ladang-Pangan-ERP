'use client';

import { useMemo, useState, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { FileText, ChevronRight, Loader2, History, Smartphone, MoreHorizontal, Plus, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { WeightInput } from '@/components/ui/weight-input';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { usePdfPreview } from '@/components/pdf-preview-dialog';
import { TALLY_TYPES, tallyType, kg, periodRange, fetchTallyDetail, openBeritaAcara } from '@/lib/tally/history';

const fetcher = (url) => fetch(url).then(r => r.json());
const PERIODS = [['today', 'Hari ini'], ['7', '7 hari terakhir'], ['30', '30 hari terakhir'], ['month', 'Bulan ini']];

export default function TallyHistoryPage() {
  const pdfPreview = usePdfPreview();
  const [type, setType] = useState('in');
  const [period, setPeriod] = useState('7');
  const [cs, setCs] = useState('all');
  const [op, setOp] = useState('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);       // baris yang dibuka di panel samping
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 350); return () => clearTimeout(t); }, [qInput]);

  const { from } = periodRange(period);
  const qs = new URLSearchParams({ type, from, ...(cs !== 'all' ? { cs } : {}), ...(q ? { q } : {}) });
  const { data, isLoading, mutate: mutateList } = useSWR(`/api/tally-history?${qs}`, fetcher);
  const { data: csData } = useSWR('/api/cold-storages', fetcher);
  const csList = csData?.data || [];
  const all = data?.data || [];
  const operators = useMemo(() => [...new Set(all.flatMap(r => String(r.operator || '').split(', ').filter(Boolean)))].sort(), [all]);
  const rows = op === 'all' ? all : all.filter(r => String(r.operator || '').split(', ').includes(op));
  const T = tallyType(type);
  const totalBags = rows.reduce((a, r) => a + Number(r.bags || 0), 0);
  const totalKg = rows.reduce((a, r) => a + Number(r.kg || 0), 0);

  useEffect(() => { setOp('all'); }, [type]);

  const showPdf = async (r) => {
    setBusy(r.id);
    try { await openBeritaAcara(pdfPreview, r.type, r.id, sel?.id === r.id ? detail : null); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const openDetail = async (r) => {
    setSel(r); setDetail(null);
    try { setDetail(await fetchTallyDetail(r.type, r.id)); } catch (e) { toast.error(e.message); setSel(null); }
  };
  const link = detail ? T.link(detail) : null;
  const reloadDetail = async () => {
    mutateList();
    if (sel) { try { setDetail(await fetchTallyDetail(sel.type, sel.id)); } catch (e) { toast.error(e.message); } }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><History className="w-6 h-6" /> Riwayat Tally</h1>
          <p className="text-sm text-muted-foreground">Hasil kerja petugas gudang dari HP. Cetak ulang berita acara kapan saja.</p>
        </div>
        <Link href="/tally"><Button variant="outline"><Smartphone className="w-4 h-4 mr-2" />Buka Tally App</Button></Link>
      </div>

      <div role="tablist" aria-label="Jenis tally" className="flex gap-1 border-b overflow-x-auto">
        {TALLY_TYPES.map(t => {
          const on = t.key === type;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setType(t.key)}
              className={`h-11 px-3.5 -mb-px flex items-center gap-2 text-sm whitespace-nowrap border-b-[3px] ${on ? 'font-bold text-foreground' : 'font-medium text-muted-foreground border-transparent'}`}
              style={on ? { borderColor: t.color } : undefined}>
              <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />{t.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[170px]" aria-label="Periode"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
        {type !== 'wo' && (
          <Select value={cs} onValueChange={setCs}>
            <SelectTrigger className="w-[180px]" aria-label="Gudang"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua gudang</SelectItem>
              {csList.map(c => <SelectItem key={c.id} value={c.id}>{c.code} {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={op} onValueChange={setOp}>
          <SelectTrigger className="w-[180px]" aria-label="Petugas"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua petugas</SelectItem>
            {operators.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Cari"
          placeholder={type === 'wo' ? 'Cari nomor WO' : 'Cari nomor PO / SO / opname / kode karung'} className="w-full sm:w-[320px]" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground font-medium">Jumlah tally</div><div className="text-xl sm:text-2xl font-bold tabular-nums">{rows.length}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground font-medium">{type === 'wo' ? 'Catatan' : 'Karung'}</div><div className="text-xl sm:text-2xl font-bold tabular-nums">{totalBags}</div></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><div className="text-xs text-muted-foreground font-medium">Total berat</div><div className="text-xl sm:text-2xl font-bold tabular-nums">{type === 'wo' ? '–' : `${kg(totalKg)} kg`}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Waktu</TableHead>
                <TableHead>{T.refHead}</TableHead>
                {type !== 'wo' && <TableHead className="w-[90px]">Gudang</TableHead>}
                <TableHead className="text-right w-[90px]">{type === 'wo' ? 'Catatan' : 'Karung'}</TableHead>
                {type !== 'wo' && <TableHead className="text-right w-[110px]">Total kg</TableHead>}
                <TableHead className="w-[140px]">Petugas</TableHead>
                <TableHead className="w-[170px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Belum ada {T.label.toLowerCase()} pada periode ini.</TableCell></TableRow>
              )}
              {rows.map(r => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r)}>
                  <TableCell className="text-slate-700">{format(new Date(r.at), 'dd MMM HH:mm')}</TableCell>
                  <TableCell className="min-w-0"><div className="font-mono font-bold">{r.ref}</div><div className="text-[13px] text-muted-foreground truncate max-w-[360px]">{r.sub}</div>{r.revisions > 0 && <span className="inline-block mt-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Revisi {r.revisions}</span>}</TableCell>
                  {type !== 'wo' && <TableCell>{r.cs || '-'}</TableCell>}
                  <TableCell className="text-right tabular-nums">{r.bags}</TableCell>
                  {type !== 'wo' && <TableCell className="text-right font-bold tabular-nums">{kg(r.kg)}</TableCell>}
                  <TableCell className={r.operator ? '' : 'text-muted-foreground'}>{r.operator || '–'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => showPdf(r)} disabled={busy === r.id}>
                        {busy === r.id ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1.5" />}Berita Acara
                      </Button>
                      <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Lihat detail" onClick={() => openDetail(r)}><ChevronRight className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {type === 'out' && <p className="text-xs text-muted-foreground">Petugas Barang Keluar mulai tercatat sejak fitur Riwayat Tally rilis; riwayat sebelumnya tampil &quot;–&quot;.</p>}

      <Sheet open={!!sel} onOpenChange={(o) => { if (!o) { setSel(null); setDetail(null); } }}>
        <SheetContent className={`w-full ${type === 'in' ? 'sm:max-w-[560px]' : 'sm:max-w-[460px]'} flex flex-col p-0 gap-0`}>
          {sel && (
            <>
              <SheetHeader className="p-5 border-b text-left">
                <SheetDescription>{T.label}</SheetDescription>
                <SheetTitle className="font-mono text-xl">{sel.ref}</SheetTitle>
                <div className="text-[13px] text-muted-foreground">{format(new Date(sel.at), 'dd MMM yyyy HH:mm')} · {sel.operator || '–'}</div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {!detail ? <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : type === 'in' ? (
                  <InboundPanel detail={detail} onChanged={reloadDetail} />
                ) : (
                  <>
                    <div className="grid grid-cols-[110px_1fr] gap-y-1 text-sm mb-3">
                      {detail.meta.map(([k, v]) => <div key={k} className="contents"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>)}
                    </div>
                    <div className="text-xs font-bold tracking-wider uppercase text-muted-foreground mb-1">{type === 'wo' ? 'Catatan' : 'Daftar karung'}</div>
                    {detail.rows.map((r, i) => (
                      <div key={i} className="flex gap-3 text-sm py-2 border-b last:border-b-0">
                        <span className="font-mono shrink-0 w-[108px] truncate">{r[0]}</span>
                        <span className="flex-1 min-w-0">{type === 'wo' ? <><b>{r[1]}</b> · {r[2]}</> : r[1]}</span>
                        {type !== 'wo' && <b className="shrink-0 tabular-nums">{type === 'op' ? r[5] : `${kg(r[3])} kg`}</b>}
                      </div>
                    ))}
                    <div className="text-sm font-bold mt-3">Total: {detail.total}</div>
                  </>
                )}
              </div>
              <div className="p-4 border-t flex gap-2">
                <Button className="flex-1" onClick={() => showPdf(sel)} disabled={!detail || busy === sel.id}><FileText className="w-4 h-4 mr-2" />Berita Acara (PDF)</Button>
                {link && <Link href={link}><Button variant="outline">{T.linkLabel(detail)}</Button></Link>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {pdfPreview.element}
    </div>
  );
}

// Barang Masuk per PO/kiriman: karung per produk + revisi supervisor (buka kembali, tambah, ubah berat, hapus).
function InboundPanel({ detail, onChanged }) {
  const [dlg, setDlg] = useState(null); // { kind: 'add' | 'weight' | 'delete', item? }
  const [form, setForm] = useState({ productId: '', kodeSimpan: '', weight: 0, reason: '' });
  const [saving, setSaving] = useState(false);
  const { data: poData } = useSWR(detail.refType === 'PO' && detail.refId ? `/api/purchase-orders/${detail.refId}` : null, fetcher);
  const productOptions = poData?.data?.items?.length
    ? poData.data.items.map(i => ({ id: i.productId, name: i.product?.name || i.productName || detail.products.find(p => p.productId === i.productId)?.name || 'Produk' }))
    : detail.products.map(p => ({ id: p.productId, name: p.name }));
  const gid = encodeURIComponent(detail.groupId);

  const call = async (url, body) => {
    setSaving(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body || {}) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      return j.data;
    } finally { setSaving(false); }
  };
  const afterRevision = (d, msg) => {
    toast.success(msg);
    if (d?.refund >= 1) toast.warning(`PO jadi lebih bayar Rp ${Math.round(d.refund).toLocaleString('id-ID')} — finance diberi tahu untuk minta refund supplier.`);
    setDlg(null); onChanged();
  };
  const reopen = async () => {
    if (!confirm('Buka kembali tally ini? Petugas akan melihatnya di "Belum selesai" di HP untuk scan karung yang tertinggal.')) return;
    try { const d = await call(`/api/tally-history/in/${gid}/reopen`); toast.success(d.already ? 'Tally ini sudah dibuka di HP petugas' : 'Tally dibuka kembali — muncul di HP petugas'); onChanged(); }
    catch (e) { toast.error(e.message); }
  };
  const openDlg = (kind, item) => {
    setForm({ productId: item?.productId || productOptions[0]?.id || '', kodeSimpan: '', weight: kind === 'weight' ? item.weight : 0, reason: '' });
    setDlg({ kind, item });
  };
  const submit = async () => {
    try {
      if (dlg.kind === 'add') afterRevision(await call(`/api/tally-history/in/${gid}/add`, form), 'Karung ditambahkan ke stok');
      else afterRevision(await call(`/api/tally-history/in/${gid}/items/${encodeURIComponent(dlg.item.kode)}`, { action: dlg.kind, weight: form.weight, reason: form.reason }),
        dlg.kind === 'delete' ? 'Karung dihapus dari tally & stok' : 'Berat diperbarui');
    } catch (e) { toast.error(e.message); }
  };
  const title = dlg?.kind === 'add' ? 'Tambah karung tertinggal' : dlg?.kind === 'weight' ? `Ubah berat ${dlg?.item?.kode}` : `Hapus karung ${dlg?.item?.kode}?`;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[110px_1fr] gap-y-1 text-sm">
        {detail.meta.map(([k, v]) => <div key={k} className="contents"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>)}
      </div>
      {detail.canRevise && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={reopen} disabled={saving || !!detail.openRevision}>
            <Smartphone className="w-4 h-4 mr-1.5" />{detail.openRevision ? 'Sedang dibuka di HP' : 'Buka kembali di HP'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDlg('add')} disabled={saving}><Plus className="w-4 h-4 mr-1.5" />Tambah karung</Button>
        </div>
      )}
      {detail.products.map((p, pi) => (
        <div key={p.productId} className="border rounded-lg overflow-hidden">
          <div className="flex justify-between gap-2 px-3 py-2 bg-slate-50 text-sm"><b>{pi + 1}. {p.name}</b><b className="shrink-0">{p.count} karung · {kg(p.kg)} kg</b></div>
          {p.items.map(it => (
            <div key={it.itemId} className="grid grid-cols-[112px_minmax(0,1fr)_76px_32px] gap-2 items-center px-3 py-1.5 border-t text-sm">
              <span className="font-mono truncate">{it.kode || '-'}</span>
              <span className="min-w-0">
                {it.added && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Tambahan revisi</span>}
                {!it.added && it.weightFrom != null && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">Berat diubah</span>}
              </span>
              <b className="text-right tabular-nums">{kg(it.weight)} kg</b>
              {detail.canRevise ? (it.editable ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="h-7 w-7" aria-label={`Ubah atau hapus ${it.kode}`}><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => openDlg('weight', it)}>Ubah berat</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openDlg('delete', it)} className="text-red-600 focus:text-red-700">Hapus karung…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : <span title={it.lockReason || ''} aria-label={it.lockReason || 'Terkunci'} className="flex justify-center text-muted-foreground"><Lock className="w-3.5 h-3.5" /></span>) : <span />}
            </div>
          ))}
        </div>
      ))}
      <div className="text-sm font-bold">Total: {detail.total}</div>
      {detail.revisionLines?.length > 0 && (
        <div className="border-t pt-2">
          <div className="text-xs font-bold tracking-wider uppercase text-muted-foreground mb-1">Catatan revisi</div>
          <ul className="text-[13px] text-slate-700 space-y-1">{detail.revisionLines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}

      <Dialog open={!!dlg} onOpenChange={(o) => { if (!o) setDlg(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{detail.ref}{detail.kirimanLabel ? ` · ${detail.kirimanLabel}` : ''}</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            {dlg?.kind === 'add' && (
              <>
                <div className="flex flex-col gap-1.5"><Label>Produk</Label>
                  <Select value={form.productId || undefined} onValueChange={v => setForm({ ...form, productId: v })}>
                    <SelectTrigger><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                    <SelectContent>{productOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5"><Label>Kode simpan <span className="text-muted-foreground font-normal">(kosongkan = kode otomatis)</span></Label>
                  <Input value={form.kodeSimpan} onChange={e => setForm({ ...form, kodeSimpan: e.target.value })} className="font-mono" /></div>
              </>
            )}
            {dlg?.kind === 'delete' && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                Karung <b>{dlg.item.kode} · {kg(dlg.item.weight)} kg</b> dikeluarkan dari stok dan dari tally. Kode bisa dipakai lagi.
              </div>
            )}
            {dlg?.kind !== 'delete' && (
              <div className="flex flex-col gap-1.5"><Label>Berat (kg)</Label><WeightInput value={form.weight} onChange={v => setForm({ ...form, weight: v })} className="text-lg font-bold" /></div>
            )}
            <div className="flex flex-col gap-1.5"><Label>Alasan</Label>
              <Input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Contoh: tertinggal di truk / salah ketik" /></div>
            <p className="text-xs text-muted-foreground">Stok, kartu stok, dan berat tally PO ikut diperbarui. Kalau PO sudah dibayar lebih dari tagihan baru, finance diminta menagih refund ke supplier.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>Batal</Button>
            <Button onClick={submit} disabled={saving || form.reason.trim().length < 3} className={dlg?.kind === 'delete' ? 'bg-red-600 hover:bg-red-700' : ''}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{dlg?.kind === 'add' ? 'Tambah ke stok' : dlg?.kind === 'delete' ? 'Hapus karung' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
