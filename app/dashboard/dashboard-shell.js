'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard, Users, Package, Warehouse, ShoppingCart, ClipboardList,
  Boxes, TrendingUp, LogOut, Menu, X, Wheat, ChevronRight, Settings,
  FileBarChart, Smartphone, UserCog
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin','supervisor','direktur','operator'] },
  {
    section: 'Master Data',
    items: [
      { href: '/dashboard/contacts', label: 'Contacts', icon: Users, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/products', label: 'Products', icon: Package, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/cold-storage', label: 'Cold Storage & Zones', icon: Warehouse, roles: ['admin','supervisor','direktur'] },
    ],
  },
  {
    section: 'Operasional',
    items: [
      { href: '/dashboard/purchase-orders', label: 'Purchase Order', icon: ShoppingCart, roles: ['admin','supervisor','direktur','operator'] },
      { href: '/dashboard/work-orders', label: 'Work Order', icon: ClipboardList, roles: ['admin','supervisor','direktur','operator'] },
      { href: '/dashboard/inventory', label: 'Inventory', icon: Boxes, roles: ['admin','supervisor','direktur','operator'] },
      { href: '/dashboard/sales-orders', label: 'Sales Order', icon: TrendingUp, roles: ['admin','supervisor','direktur','operator'] },
    ],
  },
  {
    section: 'Laporan',
    items: [
      { href: '/dashboard/sales-reports', label: 'Laporan Penjualan', icon: FileBarChart, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/purchase-reports', label: 'Laporan Pembelian', icon: FileBarChart, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/production-reports', label: 'Laporan Produksi', icon: FileBarChart, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/inventory-reports', label: 'Laporan Inventory', icon: FileBarChart, roles: ['admin','supervisor','direktur'] },
    ],
  },
  {
    section: 'Tally App (Mobile)',
    items: [
      { href: '/tally', label: 'Produksi', icon: Smartphone, roles: ['admin','supervisor','operator'] },
      { href: '/tally/inbound', label: 'Inbound Gudang', icon: Smartphone, roles: ['admin','supervisor','operator'] },
    ],
  },
  {
    section: 'Sistem',
    items: [
      { href: '/dashboard/users', label: 'User Management', icon: UserCog, roles: ['admin','direktur'] },
    ],
  },
];

const ROLE_COLOR = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  supervisor: 'bg-blue-100 text-blue-700 border-blue-200',
  direktur: 'bg-purple-100 text-purple-700 border-purple-200',
  operator: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export default function DashboardShell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const role = user?.role || 'operator';

  const handleLogout = async () => {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  };

  const initials = (user?.name || user?.email || '?').split(/\s+/).map(s => s[0]).slice(0,2).join('').toUpperCase();

  const renderNav = () => (
    <nav className="space-y-6">
      {NAV.map((item, i) => {
        if (item.section) {
          const visible = item.items.filter(it => it.roles.includes(role));
          if (visible.length === 0) return null;
          return (
            <div key={i}>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-3 mb-2">{item.section}</div>
              <div className="space-y-1">
                {visible.map(it => (
                  <NavLink key={it.href + it.label} item={it} active={pathname === it.href} />
                ))}
              </div>
            </div>
          );
        }
        if (!item.roles?.includes(role)) return null;
        return <NavLink key={item.href} item={item} active={pathname === item.href} />;
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 w-72 bg-white border-r flex flex-col transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-lg flex items-center justify-center text-white">
              <Wheat className="w-6 h-6" />
            </div>
            <div>
              <div className="font-bold text-sm leading-tight">Ladang Pangan</div>
              <div className="text-xs text-muted-foreground">ERP System</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(false)}><X className="w-5 h-5" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{renderNav()}</div>
        <div className="border-t p-3 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <Avatar className="w-9 h-9"><AvatarFallback className="bg-emerald-100 text-emerald-700 text-sm">{initials}</AvatarFallback></Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">{user?.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
            </div>
          </div>
          <div className="px-2">
            <Badge variant="outline" className={cn('text-[10px] uppercase', ROLE_COLOR[role])}>{role}</Badge>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}><LogOut className="w-4 h-4 mr-2" />Keluar</Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 bg-white border-b h-14 flex items-center px-4 gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}><Menu className="w-5 h-5" /></Button>
          <div className="flex-1">
            <div className="text-sm text-muted-foreground">PT Ladang Pangan Indonesia</div>
          </div>
          <Badge variant="secondary" className="hidden sm:inline-flex">Beta v0.1</Badge>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ item, active }) {
  const Icon = item.icon;
  if (item.disabled) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground cursor-not-allowed opacity-60">
        <Icon className="w-4 h-4" /><span>{item.label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide bg-slate-100 px-1.5 py-0.5 rounded">soon</span>
      </div>
    );
  }
  return (
    <Link href={item.href} className={cn(
      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
      active ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
    )}>
      <Icon className="w-4 h-4" /><span>{item.label}</span>
      {active && <ChevronRight className="w-4 h-4 ml-auto" />}
    </Link>
  );
}
