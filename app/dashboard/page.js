'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Package, Warehouse, MapPin, ShoppingCart, ClipboardList, Boxes, TrendingUp } from 'lucide-react';

const fetcher = (url) => fetch(url).then(r => r.json());

export default function DashboardHome() {
  const { data } = useSWR('/api/stats', fetcher);
  const stats = data || {};

  const cards = [
    { label: 'Contacts', value: stats.contacts ?? '-', icon: Users, href: '/dashboard/contacts', color: 'from-blue-500 to-blue-600' },
    { label: 'Products', value: stats.products ?? '-', icon: Package, href: '/dashboard/products', color: 'from-amber-500 to-amber-600' },
    { label: 'Cold Storages', value: stats.coldStorages ?? '-', icon: Warehouse, href: '/dashboard/cold-storage', color: 'from-emerald-500 to-emerald-600' },
    { label: 'Zones', value: stats.zones ?? '-', icon: MapPin, href: '/dashboard/cold-storage', color: 'from-purple-500 to-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Ringkasan sistem ERP PT Ladang Pangan Indonesia</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <Link key={c.label} href={c.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer overflow-hidden">
              <CardContent className="p-5">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${c.color} flex items-center justify-center text-white mb-3`}>
                  <c.icon className="w-5 h-5" />
                </div>
                <div className="text-3xl font-bold">{c.value}</div>
                <div className="text-sm text-muted-foreground">{c.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Modul yang Aktif</CardTitle>
            <CardDescription>Master Data telah tersedia. Modul lainnya menyusul.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Contacts (Supplier/Customer/RPH/Karyawan/Mitra)', status: 'active' },
              { label: 'Products', status: 'active' },
              { label: 'Cold Storage & Zones', status: 'active' },
              { label: 'Authentication & Role-Based Access', status: 'active' },
            ].map(m => (
              <div key={m.label} className="flex items-center justify-between p-2 rounded-lg bg-emerald-50">
                <span className="text-sm">{m.label}</span>
                <span className="text-xs font-semibold text-emerald-700 uppercase">{m.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Modul Berikutnya</CardTitle>
            <CardDescription>Menunggu instruksi Anda untuk dibangun.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Purchase Order (Live Bird & Non-LB)', icon: ShoppingCart },
              { label: 'Work Order & Production Yield', icon: ClipboardList },
              { label: 'Inventory & FIFO/FEFO', icon: Boxes },
              { label: 'Sales Order & Surat Jalan', icon: TrendingUp },
            ].map(m => (
              <div key={m.label} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50">
                <m.icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm flex-1">{m.label}</span>
                <span className="text-xs text-muted-foreground uppercase">upcoming</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
