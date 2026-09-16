'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const SO_FIELD_LABELS = [
  ['items', 'Item'], ['stocks', 'Alokasi Stok'], ['payments', 'Pembayaran'], ['sjs', 'Surat Jalan'],
  ['receipts', 'Penerimaan'], ['returns', 'Retur'], ['commissionRecords', 'Komisi'],
  ['approvals', 'Approval'], ['notifications', 'Notifikasi'],
];
const PO_FIELD_LABELS = [
  ['items', 'Item'], ['grns', 'GRN'], ['payments', 'Pembayaran'], ['returns', 'Retur'],
  ['inboundStocks', 'Stok Hasil Inbound'], ['approvals', 'Approval'], ['notifications', 'Notifikasi'],
];

function CountGrid({ children, fieldLabels }) {
  if (!children) return null;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
      {fieldLabels.map(([key, label]) => (
        <div key={key} className="flex justify-between border-b border-dashed py-0.5">
          <span className="text-muted-foreground">{label}</span>
          <b>{Array.isArray(children[key]) ? children[key].length : 0}</b>
        </div>
      ))}
    </div>
  );
}

function PreviewSummary({ preview }) {
  return (
    <div className="space-y-3">
      {preview.so && (
        <div className="p-2.5 rounded-lg border bg-white">
          <div className="font-semibold text-xs mb-1.5">Sales Order {preview.so.soNumber} <span className="text-muted-foreground font-normal">({preview.so.pipelineStatus})</span></div>
          <CountGrid children={preview.soChildren} fieldLabels={SO_FIELD_LABELS} />
        </div>
      )}
      {preview.po && (
        <div className="p-2.5 rounded-lg border bg-white">
          <div className="font-semibold text-xs mb-1.5">
            {preview.so ? 'Ikut diproses — ' : ''}Purchase Order {preview.po.poNumber} <span className="text-muted-foreground font-normal">({preview.po.pipelineStatus})</span>
          </div>
          <CountGrid children={preview.poChildren} fieldLabels={PO_FIELD_LABELS} />
        </div>
      )}
      {(preview.soChildren?.commissionRecords?.some((c) => c.status === 'paid')) && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          Ada komisi yang sudah <b>dibayar</b> — record-nya TIDAK dihapus (uangnya sudah keluar), hanya dilepas tautannya dari SO ini.
        </div>
      )}
    </div>
  );
}

// kind: 'so' | 'po'. number = so/po number for the confirm-by-typing gate. listPath = where to
// navigate after a full delete (the record no longer exists to stay on). onRolledBack = called
// after a successful Draft rollback (record still exists) so the caller can refetch (mutate).
export default function DangerZoneRollback({ kind, id, number, router, listPath, onRolledBack }) {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // 'rollback' | 'full'
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [applying, setApplying] = useState(false);

  if (role !== 'admin') return null;

  const apiBase = kind === 'so' ? `/api/sales-orders/${id}/rollback` : `/api/purchase-orders/${id}/rollback`;
  const label = kind === 'so' ? 'Sales Order' : 'Purchase Order';

  const openDialog = async (m) => {
    setMode(m); setOpen(true); setPreview(null); setPreviewError(null); setConfirmText(''); setLoading(true);
    try {
      const res = await fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: false, full: m === 'full' }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memuat preview');
      setPreview(j.data);
    } catch (e) { setPreviewError(e.message); } finally { setLoading(false); }
  };

  const apply = async () => {
    if (confirmText.trim() !== number) { toast.error(`Ketik ${number} persis untuk konfirmasi`); return; }
    setApplying(true);
    try {
      const res = await fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: true, full: mode === 'full' }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memproses');
      toast.success(`${mode === 'full' ? 'Hapus total' : 'Rollback ke Draft'} berhasil. Backup: ${j.data.backupFile}`);
      setOpen(false);
      if (mode === 'full') router.push(listPath);
      else onRolledBack?.();
    } catch (e) { toast.error(e.message); } finally { setApplying(false); }
  };

  return (
    <Card className="border-red-300 bg-red-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-red-800"><AlertTriangle className="w-4 h-4" />Zona Berbahaya</CardTitle>
        <CardDescription className="text-xs">Khusus admin. Selalu ada pratinjau + backup JSON otomatis sebelum eksekusi.</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-50" onClick={() => openDialog('rollback')}>
          <RotateCcw className="w-4 h-4 mr-1" />Rollback ke Draft
        </Button>
        <Button size="sm" variant="destructive" onClick={() => openDialog('full')}>
          <Trash2 className="w-4 h-4 mr-1" />Hapus Total
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { if (!applying) setOpen(o); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === 'full' ? 'Hapus Total' : 'Rollback ke Draft'} — {label} {number}</DialogTitle>
            <DialogDescription>
              {mode === 'full'
                ? 'Menghapus SEMUA data transaksi terkait secara PERMANEN (header, item, pembayaran, dokumen, komisi, dst). Kalau ada PO dropship terkait, PO-nya ikut terhapus.'
                : 'Mengembalikan ke status Draft: item dipertahankan, tapi pembayaran/pengiriman/komisi/stok terkait direset. Kalau ada PO dropship terkait, PO-nya ikut di-rollback.'}
            </DialogDescription>
          </DialogHeader>

          {loading && <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}

          {previewError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <b>Tidak bisa dilanjutkan:</b> {previewError}
            </div>
          )}

          {preview && !previewError && (
            <div className="space-y-3 text-sm">
              <PreviewSummary preview={preview} />
              <div>
                <Label className="text-xs">Ketik <b className="font-mono">{number}</b> untuk konfirmasi</Label>
                <Input className="mt-1" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={number} />
              </div>
            </div>
          )}

          <DialogFooter>
            {preview && !previewError && (
              <Button variant={mode === 'full' ? 'destructive' : 'default'} onClick={apply} disabled={applying || confirmText.trim() !== number}>
                {applying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {mode === 'full' ? 'Hapus Total Sekarang' : 'Rollback Sekarang'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
