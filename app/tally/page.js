'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { useSession, authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Smartphone, ChevronRight, LogOut, Wheat, ClipboardList, Loader2, Wifi, WifiOff, History, Play, PackagePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function TallyHomePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const { data, isLoading } = useSWR('/api/work-orders?status=Dalam Proses', fetcher, { refreshInterval: 10000 });
  const rows = data?.data || [];
  const { data: draftData } = useSWR('/api/tally-sessions?status=draft', fetcher, { refreshInterval: 15000 });
  const drafts = draftData?.data || [];

  const logout = async () => { await authClient.signOut(); router.push('/login'); };

  return (
    <div className="max-w-md mx-auto p-4 min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center text-white"><Wheat className="w-6 h-6" /></div>
        <div className="flex-1">
          <div className="font-bold text-sm leading-tight">Tally App</div>
          <div className="text-xs text-muted-foreground">{session?.user?.name || 'Operator'}</div>
        </div>
        {online ? <Wifi className="w-5 h-5 text-emerald-600" /> : <WifiOff className="w-5 h-5 text-red-500" />}
        <Button variant="ghost" size="icon" onClick={logout}><LogOut className="w-5 h-5" /></Button>
      </div>

      {/* Info Card */}
      <Card className="mb-4 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-2"><Smartphone className="w-5 h-5 text-emerald-600" /><span className="font-bold">Mode Produksi</span></div>
          <p className="text-sm text-muted-foreground">Pilih Work Order aktif → pilih Stage → catat data via <b>Catat / Daftar / Simpan</b>. Data akan disimpan saat online.</p>
          {!online && <div className="mt-2 text-xs bg-red-100 text-red-700 p-2 rounded">Offline: input akan dicache dan disync saat kembali online</div>}
        </CardContent>
      </Card>

      {/* Tally Inbound draft yang bisa dilanjutkan */}
      {drafts.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/40">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2 text-amber-800"><History className="w-5 h-5" /><span className="font-bold text-sm">Lanjutkan Tally Inbound ({drafts.length})</span></div>
            <div className="space-y-1.5">
              {drafts.map(d => (
                <div key={d.id} className="flex items-center gap-2 bg-white border rounded-lg px-2.5 py-2">
                  <PackagePlus className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{d.csCode || 'CS?'}{d.refNumber ? ` · ${d.referenceType} ${d.refNumber}` : ' · Manual'}</div>
                    <div className="text-[11px] text-muted-foreground">{d.itemCount} item · {Number(d.totalWeight || 0).toFixed(1)} kg{d.updatedAt && ` · ${format(new Date(d.updatedAt), 'dd MMM HH:mm')}`}</div>
                  </div>
                  <Link href={`/tally/inbound?session=${d.id}`}>
                    <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700 text-xs"><Play className="w-3.5 h-3.5 mr-1" /> Lanjutkan</Button>
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* WO List */}
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">WO Aktif ({rows.length})</div>
      <div className="space-y-3 flex-1">
        {isLoading && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
        {!isLoading && rows.length === 0 && (
          <Card><CardContent className="pt-6 text-center text-muted-foreground text-sm">
            Tidak ada WO yang &quot;Dalam Proses&quot;. Hubungi supervisor untuk approve WO baru.
          </CardContent></Card>
        )}
        {rows.map(wo => (
          <Link key={wo.id} href={`/tally/${wo.id}`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono font-bold text-sm">{wo.woNumber}</div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <Badge variant="outline">{wo.mode}</Badge>
                  {wo.po && <Badge variant="secondary" className="text-xs">{wo.po.method}</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Berat LB:</span> <b>{Number(wo.totalLiveBirdWeight).toLocaleString('id-ID')} kg</b></div>
                  <div><span className="text-muted-foreground">Ekor:</span> <b>{wo.totalLiveBirdHeadCount}</b></div>
                  <div className="col-span-2 text-muted-foreground">Start: {wo.startDate && format(new Date(wo.startDate), 'dd MMM yyyy')}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 text-center">
        {session?.user?.role !== 'operator' && (
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">← Kembali ke Dashboard</Link>
        )}
      </div>
    </div>
  );
}
