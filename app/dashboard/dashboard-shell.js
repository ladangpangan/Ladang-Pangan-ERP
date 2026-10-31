'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  Landmark, BookOpen, Calculator, Wallet, Scale, Building, Lock, TrendingDown, Receipt, ScrollText, Database, HandCoins, History
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import FloatingAIAssistant from '@/components/floating-ai-assistant';
import { setPdfCompany, setPdfSettings } from '@/lib/pdf/invoice';
import { applyAccent } from '@/lib/themes';

// Menu disusun per alur kerja LPI (jual · beli · gudang · produksi · keuangan). `hideFor` merapikan menu
// untuk peran yang tidak memakainya (hak akses tetap diatur oleh `roles` dan server).
const ALL = ['admin', 'supervisor', 'direktur', 'akuntan', 'operator'];
const MGMT = ['admin', 'supervisor', 'direktur', 'akuntan'];
const NAV = [
  { href: '/dashboard', label: 'Beranda', icon: LayoutDashboard, roles: ALL },
  { href: '/dashboard/approvals', label: 'Persetujuan', icon: ClipboardCheck, roles: ['supervisor', 'direktur', 'akuntan'] },
  {
    section: 'Penjualan',
    items: [
      { href: '/dashboard/sales-orders', label: 'Sales Order', icon: TrendingUp, roles: ['admin', 'supervisor', 'direktur', 'operator'] },
      { href: '/dashboard/contacts?type=Customer', label: 'Pelanggan', icon: Users, roles: MGMT },
    ],
  },
  {
    section: 'Pembelian',
    items: [
      { href: '/dashboard/purchase-orders', label: 'Purchase Order', icon: ShoppingCart, roles: ['admin', 'supervisor', 'direktur', 'operator'] },
      { href: '/dashboard/contacts?type=Supplier', label: 'Supplier', icon: Users, roles: MGMT },
    ],
  },
  {
    section: 'Gudang',
    items: [
      { href: '/dashboard/inventory', label: 'Stok', icon: Boxes, roles: ['admin', 'supervisor', 'direktur', 'operator'] },
      { href: '/dashboard/inventory/opnames', label: 'Stock Opname', icon: ClipboardList, roles: ['admin', 'supervisor', 'direktur', 'operator'] },
      { href: '/dashboard/tally-history', label: 'Riwayat Tally', icon: History, roles: MGMT },
      { href: '/tally', label: 'Tally App', icon: Smartphone, roles: ['admin', 'supervisor', 'operator'], hideFor: ['akuntan'] },
    ],
  },
  {
    section: 'Produksi',
    items: [
      { href: '/dashboard/work-orders', label: 'Work Order', icon: ClipboardList, roles: ['admin', 'supervisor', 'direktur', 'operator'] },
      { href: '/dashboard/masters/wo-stages', label: 'Tahap Produksi', icon: Layers, roles: ['admin', 'supervisor', 'direktur'], hideFor: ['akuntan'] },
    ],
  },
  {
    section: 'Keuangan',
    items: [
      { href: '/dashboard/finance', label: 'Tagihan & Komisi', icon: HandCoins, roles: MGMT },
      { href: '/dashboard/accounting/cashbook', label: 'Pencatatan Kas', icon: Receipt, roles: ['admin', 'supervisor', 'akuntan', 'direktur'] },
      {
        label: 'Akuntansi', icon: Landmark, roles: ['akuntan', 'direktur'], base: '/dashboard/accounting',
        children: [
          { href: '/dashboard/accounting', label: 'Ringkasan' },
          { href: '/dashboard/accounting/journals', label: 'Jurnal Umum' },
          { href: '/dashboard/accounting/ledger', label: 'Buku Besar' },
          { href: '/dashboard/accounting/reports', label: 'Laporan Keuangan' },
          { href: '/dashboard/accounting/coa', label: 'Daftar Akun' },
          { href: '/dashboard/accounting/fixed-assets', label: 'Aset Tetap' },
          { href: '/dashboard/accounting/closing', label: 'Tutup Buku' },
        ],
      },
    ],
  },
  {
    section: 'Laporan',
    items: [
      { href: '/dashboard/sales-reports', label: 'Penjualan', icon: FileBarChart, roles: MGMT },
      { href: '/dashboard/purchase-reports', label: 'Pembelian', icon: FileBarChart, roles: MGMT },
      { href: '/dashboard/production-reports', label: 'Produksi', icon: FileBarChart, roles: ['admin', 'supervisor', 'direktur'] },
      { href: '/dashboard/inventory-reports', label: 'Stok', icon: FileBarChart, roles: MGMT },
    ],
  },
  {
    section: 'Pengaturan',
    items: [
      { href: '/dashboard/products', label: 'Produk', icon: Package, roles: MGMT },
      { href: '/dashboard/cold-storage', label: 'Gudang & Zona', icon: Warehouse, roles: ['admin', 'supervisor', 'direktur'] },
      { href: '/dashboard/users', label: 'Pengguna', icon: UserCog, roles: ['supervisor', 'direktur'] },
      { href: '/dashboard/import-export', label: 'Impor & Ekspor', icon: Database, roles: MGMT },
      { href: '/dashboard/notifications', label: 'Notifikasi', icon: Bell, roles: MGMT },
      { href: '/dashboard/settings', label: 'Pengaturan', icon: Settings, roles: ALL },
    ],
  },
];

// Judul di header = nama menu halaman yang sedang dibuka.
const NAV_TITLES = NAV.flatMap(n => n.items ? n.items.flatMap(i => i.children ? i.children.map(c => [c.href, c.label === 'Ringkasan' ? 'Akuntansi' : c.label]) : [[i.href.split('?')[0], n.section === 'Laporan' ? `Laporan ${i.label}` : i.label]]) : [[n.href, n.label]])
  .sort((a, b) => b[0].length - a[0].length);
function pageTitle(pathname) {
  const hit = NAV_TITLES.find(([h]) => pathname === h || (h !== '/dashboard' && pathname.startsWith(h + '/')));
  return hit ? hit[1] : 'PT Ladang Pangan Indonesia';
}
const NAV_PATHS = NAV.flatMap(n => n.items ? n.items.flatMap(i => i.children ? i.children.map(c => c.href) : [i.href.split('?')[0]]) : [n.href]);

const ROLE_COLOR = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  supervisor: 'bg-blue-100 text-blue-700 border-blue-200',
  direktur: 'bg-purple-100 text-purple-700 border-purple-200',
  operator: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  akuntan: 'bg-amber-100 text-amber-700 border-amber-200',
};

export default function DashboardShell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const role = user?.role || 'operator';

  // Muat profil perusahaan + pengaturan PDF untuk header/komponen semua dokumen
  useEffect(() => {
    fetch('/api/settings/company', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.data?.value) setPdfCompany(j.data.value); })
      .catch(() => {});
    fetch('/api/settings/pdf', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.data?.value) setPdfSettings(j.data.value); })
      .catch(() => {});
    // Terapkan tema warna (brand) yang tersimpan di server bila ada
    fetch('/api/settings/appearance', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { const k = j?.data?.value?.accent; if (k) { try { localStorage.setItem('erp-accent', k); } catch (e) {} applyAccent(k); } })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  };

  const initials = (user?.name || user?.email || '?').split(/\s+/).map(s => s[0]).slice(0,2).join('').toUpperCase();

  // Menu aktif: halaman itu sendiri atau halaman di bawahnya (detail). Tautan ber-query (Pelanggan/Supplier)
  // aktif bila filternya cocok.
  const searchParams = useSearchParams();
  const isActive = (href) => {
    const [path, query] = href.split('?');
    if (query) { const [k, v] = query.split('='); return pathname === path && searchParams.get(k) === v; }
    if (path === '/dashboard' || path === '/dashboard/accounting') return pathname === path;
    return pathname === path || (pathname.startsWith(path + '/') && !NAV_PATHS.some(p => p !== path && p.startsWith(path + '/') && pathname.startsWith(p)));
  };
  // Akuntan memiliki akses setara Admin: cocokkan item yang mengizinkan 'admin'.
  const roleCan = (it) => !(it.hideFor || []).includes(role) && ((it.roles || []).includes(role) || (role === 'akuntan' && (it.roles || []).includes('admin')));
  const renderNav = () => (
    <nav className="space-y-5">
      {NAV.map((item, i) => {
        if (item.section) {
          const visible = item.items.filter(roleCan);
          if (visible.length === 0) return null;
          return (
            <div key={i}>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-3 mb-1.5">{item.section}</div>
              <div className="space-y-0.5">
                {visible.map(it => it.children
                  ? <NavGroup key={it.label} item={it} pathname={pathname} isActive={isActive} />
                  : <NavLink key={it.href + it.label} item={it} active={isActive(it.href)} />)}
              </div>
            </div>
          );
        }
        if (!roleCan(item)) return null;
        return <NavLink key={item.href} item={item} active={isActive(item.href)} />;
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50/70">
      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r flex flex-col transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-primary-foreground shadow-sm">
              <Wheat className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm leading-tight">Ladang Pangan</div>
              <div className="text-xs text-muted-foreground">PT Ladang Pangan Indonesia</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(false)}><X className="w-5 h-5" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 thin-scrollbar">{renderNav()}</div>
        <div className="border-t p-3 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <Avatar className="w-9 h-9"><AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">{initials}</AvatarFallback></Avatar>
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
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b h-16 flex items-center px-4 md:px-8 gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}><Menu className="w-5 h-5" /></Button>
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">{pageTitle(pathname)}</div>
          </div>
          {['admin', 'supervisor', 'direktur', 'akuntan'].includes(role) && pathname !== '/dashboard/ai-assistant' && <FloatingAIAssistant />}
          <NotificationBell />
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>

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
                  {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
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
        <div className="p-2 border-t bg-muted/40">
          <Link href="/dashboard/notifications" onClick={() => setOpenMenu(false)}>
            <Button variant="ghost" className="w-full h-8 text-xs">Lihat semua notifikasi</Button>
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavGroup({ item, pathname, isActive }) {
  const inside = pathname.startsWith(item.base);
  const [open, setOpen] = useState(inside);
  useEffect(() => { if (inside) setOpen(true); }, [inside]);
  const Icon = item.icon;
  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors', inside ? 'text-primary font-semibold' : 'text-foreground/70 hover:bg-muted')}>
        <Icon className="w-4 h-4" /><span>{item.label}</span>
        <ChevronRight className={cn('w-4 h-4 ml-auto transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-5 pl-2 border-l space-y-0.5 mt-0.5">
          {item.children.map(c => (
            <Link key={c.href} href={c.href} className={cn('block px-3 py-1.5 rounded-md text-sm transition-colors', isActive(c.href) ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground/70 hover:bg-muted')}>{c.label}</Link>
          ))}
        </div>
      )}
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
      active ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground/70 hover:bg-muted'
    )}>
      <Icon className="w-4 h-4" /><span>{item.label}</span>
      {active && <ChevronRight className="w-4 h-4 ml-auto" />}
    </Link>
  );
}
