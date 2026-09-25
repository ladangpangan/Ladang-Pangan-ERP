'use client';

// Rekap Tagihan tersimpan — dibuka dari dropdown "Rekap Tersimpan" di Keuangan → Invoice PO.
import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileSpreadsheet, Loader2, Printer, Trash2, AlertTriangle } from 'lucide-react';
import BillRecapView from '@/components/bill-recap-view';
import { usePdfPreview } from '@/components/pdf-preview-dialog';
import { recapExcel, recapPdf } from '@/lib/finance/recap-export';
import { RECAP_STATUS_LABEL, fmtDate } from '@/lib/finance/recap-fields';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const STATUS_COLOR = { draft: 'bg-slate-100 text-slate-700', diajukan: 'bg-blue-100 text-blue-700', dibayar: 'bg-emerald-100 text-emerald-700' };

export default function RecapDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  // Sama dengan requireRole() di server: akuntan setara admin.
  const isAdmin = ['admin', 'akuntan'].includes(role);
  const { data, isLoading } = useSWR(`/api/finance/recaps/${id}`, fetcher, { revalidateOnFocus: true });
  const pdfPreview = usePdfPreview();
  const [deleting, setDeleting] = useState(false);

  if (isLoading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mr-2" />Memuat rekap...</div>;
  if (!data?.data) return (
    <div className="py-24 text-center space-y-3">
      <div className="text-muted-foreground">{data?.error || 'Rekap tidak ditemukan'}</div>
      <Link href="/dashboard/finance"><Button variant="outline">Kembali ke Keuangan</Button></Link>
    </div>
  );
  const { recap, view } = data.data;
  const corrected = view.totals.hasCorrection || view.sections.some(s => s.rows.some(r => r.notes?.some(n => n.tone === 'warn')));

  const print = () => { const { doc, filename } = recapPdf(recap, view); pdfPreview.show(doc, filename, `${recap.recapNumber} — ${recap.title}`); };
  const excel = () => recapExcel(recap, view);
  const remove = async () => {
    if (!confirm(`Hapus rekap ${recap.recapNumber}? Invoice di dalamnya bisa direkap ulang. Nomor rekap ini tidak akan dipakai lagi.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/finance/recaps/${id}`, { method: 'DELETE', credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Gagal menghapus');
      toast.success('Rekap dihapus');
      router.push('/dashboard/finance?tab=invoicePO');
    } catch (e) { toast.error(e.message); setDeleting(false); }
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
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={print}><Printer className="w-4 h-4 mr-2" />Cetak / PDF</Button>
          <Button variant="outline" onClick={excel}><FileSpreadsheet className="w-4 h-4 mr-2" />Unduh Excel</Button>
          {isAdmin && recap.status !== 'dibayar' && (
            <Button variant="outline" className="text-red-600" onClick={remove} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}Hapus
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

      <Card>
        <CardContent className="p-4 sm:p-6">
          <BillRecapView recap={recap} view={view} />
          {recap.notes && <p className="mt-4 text-sm text-muted-foreground italic">Catatan: {recap.notes}</p>}
        </CardContent>
      </Card>
      {pdfPreview.element}
    </div>
  );
}
