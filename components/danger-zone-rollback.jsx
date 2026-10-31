'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
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

// Tindakan lanjutan khusus direktur (Kembalikan ke Draft / Hapus permanen), dibuka dari menu ⋯
// halaman detail lewat <RollbackMenuItems>. Dialog ini dikendalikan prop `mode` ('rollback' | 'full' | null).
// kind: 'so' | 'po'. number = no. SO/PO yang harus diketik untuk konfirmasi. listPath = tujuan setelah
// hapus permanen. onRolledBack = dipanggil setelah kembali ke Draft agar halaman memuat ulang (mutate).
export function RollbackMenuItems({ onPick }) {
  const { data: session } = useSession();
  if (session?.user?.role !== 'direktur') return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Tindakan lanjutan (direktur)</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => onPick('rollback')} className="text-amber-700 focus:text-amber-800"><RotateCcw className="w-4 h-4 mr-2" />Kembalikan ke Draft…</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onPick('full')} className="text-red-600 focus:text-red-700"><Trash2 className="w-4 h-4 mr-2" />Hapus permanen…</DropdownMenuItem>
    </>
  );
}

export default function DangerZoneRollback({ kind, id, number, router, listPath, onRolledBack, mode, onClose }) {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';

  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [applying, setApplying] = useState(false);

  const apiBase = kind === 'so' ? `/api/sales-orders/${id}/rollback` : `/api/purchase-orders/${id}/rollback`;
  const label = kind === 'so' ? 'Sales Order' : 'Purchase Order';
  const open = !!mode && role === 'direktur';

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPreview(null); setPreviewError(null); setConfirmText(''); setLoading(true);
    fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: false, full: mode === 'full' }) })
      .then(async (res) => { const j = await res.json(); if (!res.ok) throw new Error(j.error || 'Gagal memuat pratinjau'); if (alive) setPreview(j.data); })
      .catch((e) => { if (alive) setPreviewError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, mode, apiBase]);

  if (role !== 'direktur') return null;

  const apply = async () => {
    if (confirmText.trim() !== number) { toast.error(`Ketik ${number} persis untuk konfirmasi`); return; }
    setApplying(true);
    try {
      const res = await fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: true, full: mode === 'full' }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memproses');
      toast.success(`${mode === 'full' ? 'Hapus permanen' : 'Kembali ke Draft'} berhasil. Backup: ${j.data.backupFile}`);
      onClose?.();
      if (mode === 'full') router.push(listPath);
      else onRolledBack?.();
    } catch (e) { toast.error(e.message); } finally { setApplying(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o && !applying) onClose?.(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === 'full' ? 'Hapus permanen' : 'Kembalikan ke Draft'} — {label} {number}</DialogTitle>
            <DialogDescription>
              {mode === 'full'
                ? 'Menghapus SEMUA data transaksi terkait secara PERMANEN (otomatis dibuat backup) (header, item, pembayaran, dokumen, komisi, dst). Kalau ada PO dropship terkait, PO-nya ikut terhapus.'
                : 'Mengembalikan ke status Draft (otomatis dibuat backup): item dipertahankan, tapi pembayaran/pengiriman/komisi/stok terkait direset. Kalau ada PO dropship terkait, PO-nya ikut dikembalikan ke Draft.'}
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
                {mode === 'full' ? 'Hapus permanen sekarang' : 'Kembalikan ke Draft sekarang'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
