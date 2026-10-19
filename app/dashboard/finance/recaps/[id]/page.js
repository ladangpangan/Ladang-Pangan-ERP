'use client';

// Rekap Tagihan tersimpan — dibuka dari dropdown "Rekap Tersimpan" di Keuangan → Invoice PO.
// Alur: Draft → Ajukan ke Finance (admin) → Bayar per supplier (akuntan/direktur) → Dibayar (otomatis).
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, FileSpreadsheet, Loader2, Printer, Trash2, AlertTriangle, Send, Undo2, HandCoins, Landmark, Paperclip, CheckCircle2 } from 'lucide-react';
import BillRecapView from '@/components/bill-recap-view';
import { usePdfPreview } from '@/components/pdf-preview-dialog';
import { recapExcel, recapPdf } from '@/lib/finance/recap-export';
import { RECAP_STATUS_LABEL, fmtDate, fmtRp } from '@/lib/finance/recap-fields';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const STATUS_COLOR = { draft: 'bg-slate-100 text-slate-700', diajukan: 'bg-blue-100 text-blue-700', dibayar: 'bg-emerald-100 text-emerald-700' };

// ---- Dialog: Bayar Rekap untuk satu supplier ----
function RecapPayDialog({ recapId, supplier, accounts, open, onOpenChange, onDone }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [file, setFile] = useState(null);
  useEffect(() => {
    if (open) { setForm({ accountCode: '', method: 'Transfer', paymentDate: new Date().toISOString().slice(0, 10), reference: '', notes: '' }); setFile(null); }
  }, [open]);
  if (!supplier) return null;
  const submit = async () => {
    if (!form.accountCode) return toast.error('Pilih rekening Kas/Bank sumber pembayaran');
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('supplierId', supplier.supplierId);
      for (const [k, v] of Object.entries(form)) if (v) fd.append(k, v);
      if (file) fd.append('file', file);
      const res = await fetch(`/api/finance/recaps/${recapId}/pay`, { method: 'POST', credentials: 'include', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan pembayaran');
      toast.success(`Pembayaran ${supplier.name} ${fmtRp(j.data.amount)} tercatat (${j.data.poCount} PO)${j.data.status === 'dibayar' ? ' — rekap LUNAS' : ''}`);
      onOpenChange(false); onDone();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bayar Tagihan — {supplier.name}</DialogTitle>
          <DialogDescription>Semua PO supplier ini di rekap akan tercatat lunas. Jurnal Kas/Bank dibuat otomatis.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border bg-slate-50 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium"><Landmark className="w-4 h-4 text-muted-foreground" />Rekening tujuan</div>
            {supplier.bankAccount
              ? <div>{supplier.bankName || '-'} · <span className="font-mono">{supplier.bankAccount}</span> · a/n {supplier.bankHolder || supplier.name}</div>
              : <div className="text-amber-700">Rekening supplier belum diisi di data Kontak.</div>}
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex justify-between font-semibold"><span>Jumlah dibayar</span><span>{fmtRp(supplier.outstanding)}</span></div>
            <div className="mt-1 text-xs text-muted-foreground">{supplier.pos.filter(p => p.outstanding > 0).map(p => `${p.invoiceNumber || p.poNumber} ${fmtRp(p.outstanding)}`).join(' · ')}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tanggal</Label>
              <Input type="date" value={form.paymentDate || ''} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Metode</Label>
              <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Transfer">Transfer</SelectItem><SelectItem value="Tunai">Tunai</SelectItem><SelectItem value="QRIS">QRIS</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Dibayar dari Rekening</Label>
              <Select value={form.accountCode || undefined} onValueChange={v => setForm({ ...form, accountCode: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih Kas/Bank sumber dana" /></SelectTrigger>
                <SelectContent>{accounts.map(a => <SelectItem key={a.code} value={a.code}>{a.code} · {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2">
              <Label>No. Referensi (opsional)</Label>
              <Input value={form.reference || ''} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="No. transfer" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Bukti Transfer (opsional — PDF/JPG/PNG)</Label>
              <Input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Catatan (opsional)</Label>
              <Input value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan Pembayaran</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RecapDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  // Sama dengan requireRole() di server: akuntan setara admin.
  const isAdmin = ['admin', 'akuntan'].includes(role);
  const canPay = ['akuntan', 'direktur'].includes(role);
  const { data, isLoading, mutate } = useSWR(`/api/finance/recaps/${id}`, fetcher, { revalidateOnFocus: true });
  const pdfPreview = usePdfPreview();
  const [busy, setBusy] = useState('');
  const [payFor, setPayFor] = useState(null);
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    if (!canPay) return;
    fetch('/api/cash-bank-accounts', { credentials: 'include' }).then(r => r.json()).then(j => setAccounts(j.data || [])).catch(() => {});
  }, [canPay]);

  if (isLoading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mr-2" />Memuat rekap...</div>;
  if (!data?.data) return (
    <div className="py-24 text-center space-y-3">
      <div className="text-muted-foreground">{data?.error || 'Rekap tidak ditemukan'}</div>
      <Link href="/dashboard/finance"><Button variant="outline">Kembali ke Keuangan</Button></Link>
    </div>
  );
  const { recap, view, suppliers = [], payments = [] } = data.data;
  const corrected = view.totals.hasCorrection || view.sections.some(s => s.rows.some(r => r.notes?.some(n => n.tone === 'warn')));
  const supplierName = (sid) => suppliers.find(x => x.supplierId === sid)?.name || '-';

  const print = () => { const { doc, filename } = recapPdf(recap, view); pdfPreview.show(doc, filename, `${recap.recapNumber} — ${recap.title}`); };
  const excel = () => recapExcel(recap, view);
  const call = async (key, url, opts, okMsg, after) => {
    setBusy(key);
    try {
      const res = await fetch(url, { credentials: 'include', ...opts });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(okMsg);
      after ? after() : mutate();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };
  const submit = () => call('submit', `/api/finance/recaps/${id}/submit`, { method: 'POST' }, 'Rekap diajukan ke finance — akuntan & direktur mendapat notifikasi');
  const unsubmit = () => call('unsubmit', `/api/finance/recaps/${id}/unsubmit`, { method: 'POST' }, 'Pengajuan dibatalkan, rekap kembali ke Draft');
  const remove = () => {
    if (!confirm(`Hapus rekap ${recap.recapNumber}? Invoice di dalamnya bisa direkap ulang. Nomor rekap ini tidak akan dipakai lagi.`)) return;
    call('delete', `/api/finance/recaps/${id}`, { method: 'DELETE' }, 'Rekap dihapus', () => router.push('/dashboard/finance?tab=invoicePO'));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/dashboard/finance?tab=invoicePO"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{recap.title}</h1>
            <Badge className={STATUS_COLOR[recap.status] || ''}>{RECAP_STATUS_LABEL[recap.status] || recap.status}</Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            <span className="font-mono">{recap.recapNumber}</span> · {view.docCount} invoice · dibuat {fmtDate(recap.createdAt)}{recap.createdBy ? ` oleh ${recap.createdBy}` : ''}{recap.templateName ? ` · template "${recap.templateName}"` : ''}
            {recap.submittedAt && <> · diajukan {fmtDate(recap.submittedAt)}{recap.submittedBy ? ` oleh ${recap.submittedBy}` : ''}</>}
            {recap.paidAt && <> · lunas {fmtDate(recap.paidAt)}</>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && recap.status === 'draft' && (
            <Button onClick={submit} disabled={!!busy}>{busy === 'submit' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Ajukan ke Finance</Button>
          )}
          {isAdmin && recap.status === 'diajukan' && payments.length === 0 && (
            <Button variant="outline" onClick={unsubmit} disabled={!!busy}>{busy === 'unsubmit' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Undo2 className="w-4 h-4 mr-2" />}Batalkan Pengajuan</Button>
          )}
          <Button variant="outline" onClick={print}><Printer className="w-4 h-4 mr-2" />Cetak / PDF</Button>
          <Button variant="outline" onClick={excel}><FileSpreadsheet className="w-4 h-4 mr-2" />Unduh Excel</Button>
          {isAdmin && recap.status !== 'dibayar' && payments.length === 0 && (
            <Button variant="outline" className="text-red-600" onClick={remove} disabled={!!busy}>
              {busy === 'delete' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}Hapus
            </Button>
          )}
        </div>
      </div>

      {corrected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Ada data yang berubah sejak rekap ini dibuat. Angka di tabel tetap seperti saat rekap dibuat; rincian perubahannya ada di kolom <b>Keterangan</b>.</span>
        </div>
      )}

      {recap.status !== 'draft' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><HandCoins className="w-5 h-5 text-emerald-600" />Pembayaran per Supplier</CardTitle>
            <CardDescription>
              {recap.status === 'dibayar' ? 'Semua tagihan di rekap ini sudah lunas.'
                : canPay ? 'Klik Bayar per supplier setelah transfer dilakukan. Sisa dihitung dari data PO terkini.'
                  : 'Menunggu pembayaran oleh finance (akuntan/direktur).'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y border-t">
              {suppliers.map(sup => (
                <div key={sup.supplierId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium">{sup.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {sup.bankAccount ? <>{sup.bankName || '-'} · <span className="font-mono">{sup.bankAccount}</span> · a/n {sup.bankHolder || sup.name}</> : 'Rekening belum diisi di data Kontak'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Sisa tagihan</div>
                    <div className={`font-semibold tabular-nums ${sup.outstanding > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtRp(sup.outstanding)}</div>
                  </div>
                  {sup.outstanding <= 0
                    ? <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Lunas</Badge>
                    : (canPay && recap.status === 'diajukan') && <Button size="sm" onClick={() => setPayFor(sup)}><HandCoins className="w-4 h-4 mr-1" />Bayar</Button>}
                </div>
              ))}
            </div>
            {payments.length > 0 && (
              <div className="border-t px-4 py-3 space-y-2">
                <div className="text-sm font-medium">Riwayat pembayaran</div>
                {payments.map(p => (
                  <div key={p.id} className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="tabular-nums">{fmtDate(p.paymentDate)}</span>
                    <span className="font-medium">{supplierName(p.supplierId)}</span>
                    <span className="tabular-nums font-semibold">{fmtRp(p.amount)}</span>
                    <span className="text-muted-foreground">{p.method}{p.accountCode ? ` · ${p.accountCode}` : ''}{p.reference ? ` · ${p.reference}` : ''} · {p.poPaymentIds.length} PO · oleh {p.createdBy}</span>
                    {p.proofUrl && <a href={p.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Paperclip className="w-3.5 h-3.5" />Bukti</a>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 sm:p-6">
          <BillRecapView recap={recap} view={view} />
          {recap.notes && <p className="mt-4 text-sm text-muted-foreground italic">Catatan: {recap.notes}</p>}
        </CardContent>
      </Card>
      <RecapPayDialog recapId={id} supplier={payFor} accounts={accounts} open={!!payFor} onOpenChange={(v) => { if (!v) setPayFor(null); }} onDone={() => mutate()} />
      {pdfPreview.element}
    </div>
  );
}
