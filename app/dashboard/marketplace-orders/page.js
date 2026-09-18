'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Store, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then((r) => r.json());

export default function MarketplaceOrdersPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canProcess = ['admin', 'supervisor'].includes(role);

  const { data, mutate, isLoading } = useSWR('/api/marketplace-orders', fetcher, { refreshInterval: 30000 });
  const rows = data?.data || [];
  const [processingId, setProcessingId] = useState(null);

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  const processSO = async (r) => {
    setProcessingId(r.id);
    try {
      const res = await fetch(`/api/marketplace-orders/${r.id}/process`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memproses SO');
      toast.success(`SO dibuat: ${j.soNumber}`);
      mutate();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Store className="w-8 h-8 text-emerald-600" /> Market Place Order
          </h1>
          <p className="text-muted-foreground mt-1">
            Order masuk dari ladangpangan.id. Klik &quot;Proses SO&quot; untuk membuat Sales Order.
          </p>
        </div>
        <Button variant="outline" onClick={() => mutate()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{rows.length} order diterima</span>
            {pendingCount > 0 && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-700">{pendingCount} menunggu diproses</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Diterima</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Belum ada order dari landing page.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-slate-50">
                  <TableCell className="font-mono text-xs">{r.orderId}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.customerName}</div>
                    <div className="text-xs text-muted-foreground">{r.customerPhone}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.items.map((it, i) => (
                      <div key={i} className="whitespace-nowrap">{it.qty}x {it.name}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-right font-medium">Rp {Number(r.grossAmount).toLocaleString('id-ID')}</TableCell>
                  <TableCell className="text-sm">{r.receivedAt && format(new Date(r.receivedAt), 'dd MMM yyyy HH:mm')}</TableCell>
                  <TableCell>
                    {r.status === 'processed' ? (
                      <Badge className="bg-emerald-100 text-emerald-700">Diproses</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700">Menunggu</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {r.status === 'processed' ? (
                      <Link href={`/dashboard/sales-orders/${r.salesOrderId}`}>
                        <Button size="sm" variant="ghost"><ExternalLink className="w-4 h-4 mr-1" />Lihat SO</Button>
                      </Link>
                    ) : canProcess ? (
                      <Button size="sm" onClick={() => processSO(r)} disabled={processingId === r.id}>
                        {processingId === r.id && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        Proses SO
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
