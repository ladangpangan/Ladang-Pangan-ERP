'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard, Users, Package, Warehouse, ShoppingCart, ClipboardList,
  Boxes, TrendingUp, LogOut, Menu, X, Wheat, ChevronRight, Settings,
  FileBarChart, Smartphone, UserCog, ClipboardCheck, Bell, AlertTriangle, Info, CheckCheck, Layers,
  Landmark, BookOpen, Calculator, Wallet, Scale, Building, Lock, TrendingDown, Receipt
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import FloatingAIAssistant from '@/components/floating-ai-assistant';
import { setPdfCompany } from '@/lib/pdf/invoice';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin','supervisor','direktur','operator'] },
  {
    section: 'Master Data',
    items: [
      { href: '/dashboard/contacts', label: 'Contacts', icon: Users, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/products', label: 'Products', icon: Package, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/cold-storage', label: 'Cold Storage & Zones', icon: Warehouse, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/masters/wo-stages', label: 'WO Stages', icon: Layers, roles: ['admin','supervisor','direktur'] },
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
      { href: '/dashboard/sales-profit', label: 'Laba Penjualan', icon: TrendingUp, roles: ['admin','supervisor','direktur'] },
    ],
  },
  {
    section: 'Akuntansi',
    items: [
      { href: '/dashboard/accounting', label: 'Ringkasan Akuntansi', icon: Landmark, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/accounting/cashbook', label: 'Pencatatan Cepat', icon: Receipt, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/accounting/coa', label: 'Chart of Account', icon: BookOpen, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/accounting/journals', label: 'Jurnal Umum', icon: Calculator, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/accounting/ledger', label: 'Buku Besar', icon: Wallet, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/accounting/fixed-assets', label: 'Aset Tetap', icon: Building, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/accounting/closing', label: 'Tutup Buku', icon: Lock, roles: ['admin','supervisor','direktur'] },
      { href: '/dashboard/accounting/reports', label: 'Laporan Keuangan', icon: Scale, roles: ['admin','supervisor','direktur'] },
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
      { href: '/dashboard/notifications', label: 'Notifikasi', icon: Bell, roles: ['admin', 'supervisor', 'direktur'] },
      { href: '/dashboard/approvals', label: 'Approval & Concern', icon: ClipboardCheck, roles: ['supervisor', 'direktur'] },
      { href: '/dashboard/users', label: 'User Management', icon: UserCog, roles: ['supervisor', 'direktur'] },
      { href: '/dashboard/settings', label: 'Setting', icon: Settings, roles: ['admin', 'supervisor', 'direktur', 'operator'] },
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

  // Muat profil perusahaan untuk header PDF (nama, alamat, kontak, logo)
  useEffect(() => {
    fetch('/api/settings/company', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.data?.value) setPdfCompany(j.data.value); })
      .catch(() => {});
  }, []);

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
          <NotificationBell />
          <Badge variant="secondary" className="hidden sm:inline-flex">Beta v0.1</Badge>
        </header>
        <main className="p-6">{children}</main>
      </div>

      {/* Floating AI Assistant — for management roles, hidden on the full AI page */}
      {['admin', 'supervisor', 'direktur'].includes(role) && pathname !== '/dashboard/ai-assistant' && (
        <FloatingAIAssistant />
      )}
    </div>
  );
}

function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [openMenu, setOpenMenu] = useState(false);
  const router = useRouter();

  const fetchNotifs = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=15');
      const data = await res.json();
      setItems(Array.isArray(data.data) ? data.data : []);
      setUnread(Number(data.unreadCount || 0));
    } catch (e) {}
  }, []);

  useEffect(() => {
    fetchNotifs();
    const t = setInterval(fetchNotifs, 20000);
    return () => clearInterval(t);
  }, [fetchNotifs]);

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    fetchNotifs();
  };

  const openItem = async (n) => {
    if (!n.isRead) {
      try { await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' }); } catch (e) {}
    }
    setOpenMenu(false);
    fetchNotifs();
    if (n.linkPath) router.push(n.linkPath);
  };

  const iconFor = (n) => {
    if (n.type === 'approval') return <AlertTriangle className="w-4 h-4 text-amber-600" />;
    if (n.type === 'concern') return <AlertTriangle className="w-4 h-4 text-red-600" />;
    return <Info className="w-4 h-4 text-blue-600" />;
  };

  return (
    <DropdownMenu open={openMenu} onOpenChange={setOpenMenu}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <DropdownMenuLabel className="p-0">
            Notifikasi {unread > 0 && <span className="ml-1 text-xs text-red-600 font-normal">({unread} belum dibaca)</span>}
          </DropdownMenuLabel>
          {unread > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAllRead}>
              <CheckCheck className="w-3.5 h-3.5 mr-1" /> Tandai semua
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">Belum ada notifikasi</div>
          )}
          {items.map(n => (
            <button
              key={n.id}
              onClick={() => openItem(n)}
              className={cn(
                'w-full text-left p-3 border-b hover:bg-slate-50 flex gap-2',
                !n.isRead && 'bg-emerald-50/40'
              )}
            >
              <div className="mt-0.5">{iconFor(n)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className={cn('text-sm truncate', !n.isRead && 'font-semibold')}>{n.title}</div>
                  {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />}
                </div>
                {n.message && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</div>}
                <div className="text-[10px] text-muted-foreground mt-1">
                  {(() => {
                    try {
                      const d = new Date(Number(n.createdAt) * 1000);
                      if (!isNaN(d.getTime())) return formatDistanceToNow(d, { addSuffix: true, locale: idLocale });
                    } catch (e) {}
                    return '';
                  })()}
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="p-2 border-t bg-slate-50">
          <Link href="/dashboard/notifications" onClick={() => setOpenMenu(false)}>
            <Button variant="ghost" className="w-full h-8 text-xs">Lihat semua notifikasi</Button>
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
