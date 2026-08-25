'use client';

import { useState, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import { Bell, AlertTriangle, Info, CheckCheck, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { toast } from 'sonner';

const fetcher = (url) => fetch(url).then(r => r.json());

const CATEGORY_LABEL = {
  so_new: 'SO Baru',
  po_new: 'PO Baru',
  wo_new: 'WO Baru',
  sales_return: 'Retur Penjualan',
  purchase_return: 'Retur Pembelian',
  high_shrinkage: 'Susut Tinggi',
  so_cancel: 'Batal SO',
  po_cancel: 'Batal PO',
  opname_variance: 'Variansi Opname',
  so_large_discount: 'Diskon Besar',
  so_price_below_hpp: 'Harga < HPP',
  so_shipping: 'Pengiriman SO',
};

const TYPE_STYLES = {
  info: { icon: Info, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200' },
  approval: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
  concern: { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
};

export default function NotificationsPage() {
  const [tab, setTab] = useState('all');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { data, mutate, isLoading } = useSWR('/api/notifications?limit=200', fetcher, { refreshInterval: 15000 });
  const items = data?.data || [];

  const filtered = items.filter(n => {
    if (tab === 'all') return true;
    if (tab === 'unread') return !n.isRead;
    return n.type === tab;
  });

  const markAllRead = async () => {
    setBusy(true);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      toast.success('Semua notifikasi ditandai sudah dibaca');
      mutate();
    } catch (e) { toast.error('Gagal: ' + e.message); }
    finally { setBusy(false); }
  };

  const markOne = async (id) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    mutate();
  };

  const deleteOne = async (id) => {
    if (!confirm('Hapus notifikasi ini?')) return;
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
    mutate();
  };

  const openItem = async (n) => {
    if (!n.isRead) await markOne(n.id);
    if (n.linkPath) router.push(n.linkPath);
  };

  const unreadCount = items.filter(n => !n.isRead).length;
  const approvalCount = items.filter(n => n.type === 'approval').length;
  const infoCount = items.filter(n => n.type === 'info').length;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="w-6 h-6" /> Notifikasi</h1>
          <p className="text-sm text-muted-foreground mt-1">Semua notifikasi in-app: event bisnis, approval &amp; concern.</p>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={markAllRead} disabled={busy}>
            <CheckCheck className="w-4 h-4 mr-2" /> Tandai semua sudah dibaca
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">Semua <Badge variant="secondary" className="ml-2">{items.length}</Badge></TabsTrigger>
          <TabsTrigger value="unread">Belum Dibaca {unreadCount > 0 && <Badge className="ml-2 bg-red-500 text-white">{unreadCount}</Badge>}</TabsTrigger>
          <TabsTrigger value="approval">Approval/Concern <Badge variant="secondary" className="ml-2">{approvalCount}</Badge></TabsTrigger>
          <TabsTrigger value="info">Info <Badge variant="secondary" className="ml-2">{infoCount}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-2">
          {isLoading && <div className="text-center py-12"><Loader2 className="w-6 h-6 animate-spin inline text-muted-foreground" /></div>}
          {!isLoading && filtered.length === 0 && (
            <Card><CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">Tidak ada notifikasi</CardContent></Card>
          )}
          {filtered.map(n => {
            const style = TYPE_STYLES[n.type] || TYPE_STYLES.info;
            const Icon = style.icon;
            return (
              <Card
                key={n.id}
                className={cn('cursor-pointer transition hover:shadow-sm', !n.isRead && 'border-l-4', !n.isRead && (n.type === 'approval' ? 'border-l-amber-500' : n.type === 'concern' ? 'border-l-red-500' : 'border-l-emerald-500'))}
                onClick={() => openItem(n)}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className={cn('p-2 rounded-md', style.bg)}>
                      <Icon className={cn('w-5 h-5', style.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className={cn('font-medium truncate', !n.isRead && 'font-bold')}>{n.title}</div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[n.category] || n.category}</Badge>
                          {!n.isRead && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
                        </div>
                      </div>
                      {n.message && <div className="text-sm text-muted-foreground line-clamp-2">{n.message}</div>}
                      <div className="flex items-center justify-between mt-2">
                        <div className="text-xs text-muted-foreground">
                          {(() => {
                            try {
                              const d = new Date(Number(n.createdAt) * 1000);
                              if (!isNaN(d.getTime())) return formatDistanceToNow(d, { addSuffix: true, locale: idLocale });
                            } catch (e) {}
                            return '';
                          })()}
                          {n.entityNumber && <span className="ml-2 font-mono">· {n.entityNumber}</span>}
                        </div>
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={(e) => { e.stopPropagation(); deleteOne(n.id); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
