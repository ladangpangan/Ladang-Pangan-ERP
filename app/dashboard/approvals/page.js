'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  ClipboardCheck, CheckCircle2, XCircle, AlertTriangle, Eye, Flag, MessageSquareWarning,
  RotateCcw, ShoppingCart, TrendingDown, Ban, Package, Loader2, Clock, Award
} from 'lucide-react';
import { cn } from '@/lib/utils';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());

const CONCERN_META = {
  sales_return: { icon: RotateCcw, label: 'Retur Penjualan', color: 'text-red-600 bg-red-50 border-red-200' },
  purchase_return: { icon: RotateCcw, label: 'Retur Pembelian', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  high_shrinkage: { icon: TrendingDown, label: 'Penyusutan Tinggi', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  so_cancel: { icon: Ban, label: 'Pembatalan SO', color: 'text-slate-700 bg-slate-100 border-slate-200' },
  po_cancel: { icon: Ban, label: 'Pembatalan PO', color: 'text-slate-700 bg-slate-100 border-slate-200' },
  opname_variance: { icon: Package, label: 'Variance Opname', color: 'text-purple-600 bg-purple-50 border-purple-200' },
};

const PRIORITY_STYLE = {
  low: 'bg-slate-100 text-slate-600',
  normal: 'bg-blue-50 text-blue-700 border-blue-200',
  high: 'bg-amber-100 text-amber-700 border-amber-300',
  urgent: 'bg-red-100 text-red-700 border-red-300 animate-pulse',
};

const ENTITY_LINK = {
  SO: (id) => `/dashboard/sales-orders/${id}`,
  PO: (id) => `/dashboard/purchase-orders/${id}`,
  WO: (id) => `/dashboard/work-orders/${id}`,
  SR: (id, meta) => meta?.soId ? `/dashboard/sales-orders/${meta.soId}` : null,
  PR: (id, meta) => meta?.poId ? `/dashboard/purchase-orders/${meta.poId}` : null,
  RCP: (id, meta) => meta?.soId ? `/dashboard/sales-orders/${meta.soId}` : null,
};

export default function ApprovalsPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState('pending');
  const { data, isLoading, mutate } = useSWR(`/api/approvals?status=${tab}`, fetcher);
  const [selected, setSelected] = useState(null); // concern to act on
  const [action, setAction] = useState(''); // approved/rejected/acknowledged/flagged
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const rows = data?.data || [];
  const summary = data?.summary || { pending: 0, approved: 0, rejected: 0, total: 0 };
  const userRole = session?.user?.role;
  const isApprover = ['supervisor', 'admin'].includes(userRole);
  const isDirektur = userRole === 'direktur';

  const openAction = (concern, initialAction) => {
    setSelected(concern);
    setAction(initialAction);
    setNote('');
  };

  const submitAction = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/approvals/${selected.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, note: note || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(`Concern ${action}`);
      mutate();
      setSelected(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-emerald-600" /> Approval & Concern
          </h1>
          <p className="text-sm text-muted-foreground">
            {isApprover && 'Sebagai Supervisor, Anda dapat approve atau reject setiap concern. '}
            {isDirektur && 'Sebagai Direktur, Anda dapat melihat & memberikan catatan (concern) — tidak menentukan status.'}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Menunggu" value={summary.pending} icon={Clock} color="amber" />
        <SumCard label="Approved" value={summary.approved} icon={CheckCircle2} color="emerald" />
        <SumCard label="Rejected" value={summary.rejected} icon={XCircle} color="red" />
        <SumCard label="Total" value={summary.total} icon={Award} color="slate" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 max-w-lg">
          <TabsTrigger value="pending">
            Menunggu {summary.pending > 0 && <Badge variant="destructive" className="ml-2 text-[10px]">{summary.pending}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">Semua</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-3">
          {isLoading && <div className="text-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Memuat...</div>}
          {!isLoading && rows.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                <ClipboardCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
                Tidak ada concern di tab ini
              </CardContent>
            </Card>
          )}
          {rows.map(concern => {
            const meta = CONCERN_META[concern.concernType] || { icon: AlertTriangle, label: concern.concernType, color: 'text-slate-600 bg-slate-50 border-slate-200' };
            const Icon = meta.icon;
            const link = ENTITY_LINK[concern.entityType]?.(concern.entityId, concern.metadata);
            return (
              <Card key={concern.id} className={cn('overflow-hidden', concern.priority === 'urgent' && concern.status === 'pending' && 'border-red-300 shadow-md')}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', meta.color.split(' ').filter(c => c.startsWith('bg-') || c.startsWith('text-')).join(' '))}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-[10px]', meta.color)}>{meta.label}</Badge>
                        <Badge variant="outline" className={cn('text-[10px] uppercase', PRIORITY_STYLE[concern.priority])}>{concern.priority}</Badge>
                        {concern.status !== 'pending' && (
                          <Badge variant="outline" className={cn(
                            'text-[10px]',
                            concern.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            'bg-red-50 text-red-700 border-red-200'
                          )}>
                            {concern.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
                          </Badge>
                        )}
                      </div>
                      <div className="font-semibold text-sm mt-1">{concern.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{concern.description}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <span>{format(new Date(concern.createdAt), 'dd MMM yyyy HH:mm')}</span>
                        <span>·</span>
                        <span>oleh {concern.createdBy}</span>
                        {concern.amount > 0 && <><span>·</span><span className="font-semibold">Rp {Number(concern.amount).toLocaleString('id-ID')}</span></>}
                      </div>

                      {/* Supervisor action detail */}
                      {concern.supervisorAction && (
                        <div className="mt-3 p-2 rounded bg-slate-50 text-xs border">
                          <div className="flex items-center gap-2">
                            {concern.supervisorAction === 'approved' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-red-600" />}
                            <span className="font-semibold text-[11px] uppercase text-slate-700">
                              Supervisor: {concern.supervisorAction}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              · {concern.supervisorActedBy} · {concern.supervisorActedAt && format(new Date(concern.supervisorActedAt), 'dd MMM HH:mm')}
                            </span>
                          </div>
                          {concern.supervisorNote && <div className="mt-1 text-muted-foreground italic">"{concern.supervisorNote}"</div>}
                        </div>
                      )}

                      {/* Direktur note */}
                      {concern.direkturAction && (
                        <div className="mt-2 p-2 rounded bg-purple-50 text-xs border border-purple-100">
                          <div className="flex items-center gap-2">
                            {concern.direkturAction === 'acknowledged' ? <MessageSquareWarning className="w-3.5 h-3.5 text-purple-600" /> : <Flag className="w-3.5 h-3.5 text-purple-600" />}
                            <span className="font-semibold text-[11px] uppercase text-purple-700">
                              Concern Direktur: {concern.direkturAction}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              · {concern.direkturActedBy} · {concern.direkturActedAt && format(new Date(concern.direkturActedAt), 'dd MMM HH:mm')}
                            </span>
                          </div>
                          {concern.direkturNote && <div className="mt-1 text-muted-foreground italic">"{concern.direkturNote}"</div>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {link && (
                        <Link href={link}>
                          <Button size="sm" variant="outline" className="w-full">
                            <Eye className="w-3.5 h-3.5 mr-1" /> Detail
                          </Button>
                        </Link>
                      )}
                      {/* Supervisor / Admin actions */}
                      {isApprover && concern.status === 'pending' && (
                        <>
                          <Button size="sm" onClick={() => openAction(concern, 'approved')} className="bg-emerald-600 hover:bg-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => openAction(concern, 'rejected')}>
                            <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {/* Direktur actions */}
                      {isDirektur && !concern.direkturAction && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openAction(concern, 'acknowledged')}>
                            <MessageSquareWarning className="w-3.5 h-3.5 mr-1" /> Acknowledge
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openAction(concern, 'flagged')} className="text-red-600 hover:bg-red-50">
                            <Flag className="w-3.5 h-3.5 mr-1" /> Flag Concern
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* Action Dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'approved' && '✓ Approve Concern'}
              {action === 'rejected' && '✗ Reject Concern'}
              {action === 'acknowledged' && '📌 Acknowledge sebagai Direktur'}
              {action === 'flagged' && '🚩 Flag Concern sebagai Direktur'}
            </DialogTitle>
            <DialogDescription>
              {selected?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Catatan (opsional)</Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                action === 'rejected' ? 'Alasan reject (rekomendasi)' :
                action === 'flagged' ? 'Alasan concern' :
                'Catatan / komentar'
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Batal</Button>
            <Button
              onClick={submitAction}
              disabled={saving}
              className={cn(
                action === 'approved' && 'bg-emerald-600 hover:bg-emerald-700',
                action === 'rejected' && 'bg-red-600 hover:bg-red-700',
                (action === 'acknowledged' || action === 'flagged') && 'bg-purple-600 hover:bg-purple-700',
              )}
            >
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Konfirmasi {action === 'approved' ? 'Approve' : action === 'rejected' ? 'Reject' : action === 'acknowledged' ? 'Acknowledge' : 'Flag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SumCard({ label, value, icon: Icon, color = 'slate' }) {
  const colorMap = {
    emerald: 'text-emerald-600 bg-emerald-50',
    red: 'text-red-600 bg-red-50',
    amber: 'text-amber-600 bg-amber-50',
    slate: 'text-slate-600 bg-slate-50',
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', colorMap[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
