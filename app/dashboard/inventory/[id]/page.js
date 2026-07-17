'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, Package, Warehouse, MapPin, Calendar, Link as LinkIcon, GitBranch } from 'lucide-react';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function InventoryDetailPage() {
  const { id } = useParams();
  const { data, isLoading } = useSWR(`/api/inventory/stocks/${id}`, fetcher);
  const stk = data?.data;
  if (isLoading) return <div className="py-20 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>;
  if (!stk) return <div className="py-20 text-center text-muted-foreground">Stock tidak ditemukan</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/inventory"><Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight font-mono">{stk.kodeSimpan}</h1>
          <p className="text-muted-foreground text-sm mt-1">{stk.product?.name} · {Number(stk.weight).toFixed(2)} kg · {stk.quantity} {stk.product?.unit}</p>
        </div>
        <Badge className={stk.status === 'active' ? 'bg-emerald-100 text-emerald-700' : stk.status === 'damaged' ? 'bg-red-100 text-red-700' : stk.status === 'opened' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}>{stk.status}</Badge>
        <Badge variant="outline">{stk.packagingType}</Badge>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" />Info Produk</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Produk" value={<><b>{stk.product?.name}</b><div className="text-xs text-muted-foreground font-mono">{stk.product?.sku}</div></>} />
            <Row label="Kategori" value={stk.product?.category} />
            <Row label="Berat" value={`${Number(stk.weight).toFixed(2)} kg`} />
            <Row label="Quantity" value={`${stk.quantity} ${stk.product?.unit}`} />
            <Row label="Expired Date" value={stk.expiredDate ? format(new Date(stk.expiredDate), 'dd MMM yyyy') : '-'} />
            <Row label="Kode Simpan" value={<span className="font-mono font-bold text-emerald-700">{stk.kodeSimpan}</span>} />
            <Row label="Created" value={format(new Date(stk.createdAt), 'dd MMM yyyy HH:mm')} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Warehouse className="w-4 h-4" />Lokasi</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Cold Storage" value={<><b>{stk.coldStorage?.name}</b><div className="text-xs font-mono text-muted-foreground">{stk.coldStorage?.code}</div></>} />
            <Row label="Zone" value={stk.zone ? <><b>{stk.zone.name}</b><div className="text-xs font-mono text-muted-foreground">{stk.zone.code}</div></> : '-'} />
            <Row label="Address" value={stk.coldStorage?.address || stk.coldStorage?.location || '-'} />
            <Row label="Temperature" value={stk.coldStorage?.temperatureRange || '-'} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><GitBranch className="w-4 h-4" />Traceability</CardTitle><CardDescription>Sumber dan riwayat perpindahan</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {stk.source && (
            <div className="p-3 rounded-lg border bg-slate-50">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Sumber Batch ({stk.sourceType})</div>
              <div className="font-mono font-bold">{stk.source.number}</div>
              <div className="text-xs text-muted-foreground">{stk.sourceType === 'WO' ? `Mode: ${stk.source.mode}` : `Type: ${stk.source.poType}`} · {format(new Date(stk.source.startDate || stk.source.orderDate), 'dd MMM yyyy')}</div>
              <Link href={stk.sourceType === 'WO' ? `/dashboard/work-orders/${stk.source.id}` : `/dashboard/purchase-orders/${stk.source.id}`}><Button size="sm" variant="outline" className="mt-2"><LinkIcon className="w-3 h-3 mr-1" />Buka Detail</Button></Link>
            </div>
          )}
          {stk.inboundTransaction && (
            <div className="p-3 rounded-lg border">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Inbound Transaction</div>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <Badge>{stk.inboundTransaction.transactionType}</Badge>
                <span>{format(new Date(stk.inboundTransaction.transactionDate), 'dd MMM yyyy HH:mm')}</span>
                <span className="text-muted-foreground">{stk.inboundTransaction.createdBy}</span>
              </div>
            </div>
          )}
          {stk.parent && (
            <div className="p-3 rounded-lg border bg-amber-50">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Karung Induk (parent)</div>
              <Link href={`/dashboard/inventory/${stk.parent.id}`} className="font-mono font-bold text-emerald-700 hover:underline">{stk.parent.kodeSimpan}</Link>
            </div>
          )}
          {stk.children?.length > 0 && (
            <div className="p-3 rounded-lg border">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Child Packs ({stk.children.length})</div>
              <div className="grid grid-cols-2 gap-2">
                {stk.children.map(c => (
                  <Link key={c.id} href={`/dashboard/inventory/${c.id}`} className="p-2 border rounded hover:bg-slate-50 text-sm">
                    <div className="font-mono font-bold">{c.kodeSimpan}</div>
                    <div className="text-xs text-muted-foreground">{Number(c.weight).toFixed(2)} kg · {c.status}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }) {
  return <div className="flex justify-between items-start gap-3"><span className="text-muted-foreground text-xs uppercase">{label}</span><span className="text-right">{value || <span className="text-muted-foreground">-</span>}</span></div>;
}
