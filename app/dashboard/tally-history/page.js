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
import { FileText, ChevronRight, Loader2, History, Smartphone } from 'lucide-react';
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

  const { from, to } = periodRange(period);
  const qs = new URLSearchParams({ type, from, to, ...(cs !== 'all' ? { cs } : {}), ...(q ? { q } : {}) });
  const { data, isLoading } = useSWR(`/api/tally-history?${qs}`, fetcher);
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
                  <TableCell className="min-w-0"><div className="font-mono font-bold">{r.ref}</div><div className="text-[13px] text-muted-foreground truncate max-w-[360px]">{r.sub}</div></TableCell>
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
        <SheetContent className="w-full sm:max-w-[460px] flex flex-col p-0 gap-0">
          {sel && (
            <>
              <SheetHeader className="p-5 border-b text-left">
                <SheetDescription>{T.label}</SheetDescription>
                <SheetTitle className="font-mono text-xl">{sel.ref}</SheetTitle>
                <div className="text-[13px] text-muted-foreground">{format(new Date(sel.at), 'dd MMM yyyy HH:mm')} · {sel.operator || '–'}</div>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {!detail ? <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : (
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
