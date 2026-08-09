'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { UserPlus, Pencil, KeyRound, Trash2, Users as UsersIcon, Search, Archive, ArchiveRestore } from 'lucide-react';
import { useSort, SortHead, ArchiveTabs, toggleArchive } from '@/lib/table-tools';
import { cn } from '@/lib/utils';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());

const ROLE_STYLES = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  supervisor: 'bg-blue-100 text-blue-700 border-blue-200',
  direktur: 'bg-purple-100 text-purple-700 border-purple-200',
  operator: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const ROLE_LABELS = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  direktur: 'Direktur',
  operator: 'Operator',
};

export default function UsersPage() {
  const [view, setView] = useState('active');
  const sort = useSort();
  const { data, error, isLoading, mutate } = useSWR(`/api/users${view === 'archived' ? '?archived=1' : ''}`, fetcher);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [resetUser, setResetUser] = useState(null);
  const [deleteUser, setDeleteUser] = useState(null);
  const [me, setMe] = useState(null);

  // fetch current session user id
  const { data: meData } = useSWR('/api/me', fetcher);
  const currentUserId = meData?.user?.id;
  const isAdmin = meData?.user?.role === 'admin';

  const filtered = (data?.data || []).filter(u => {
    if (!query) return true;
    const q = query.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q);
  });
  const users = sort.sortRows(filtered, {
    name: u => u.name, email: u => u.email, role: u => u.role, status: u => u.status, createdAt: u => u.createdAt,
  });

  const doArchive = async (u) => {
    if (u.id === currentUserId) { return; }
    if (!confirm(view === 'archived' ? 'Pulihkan user ini dari arsip?' : 'Arsipkan user ini? Akun akan disembunyikan dari daftar aktif.')) return;
    const ok = await toggleArchive('users', u.id, view === 'archived');
    if (ok) mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UsersIcon className="w-6 h-6 text-emerald-600" /> User Management
          </h1>
          <p className="text-sm text-muted-foreground">Kelola akun pengguna ERP dan role akses (admin, supervisor, direktur, operator).</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <UserPlus className="w-4 h-4 mr-2" /> Tambah User
          </Button>
        )}
      </div>

      {/* Role summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['admin', 'supervisor', 'direktur', 'operator'].map((r) => {
          const count = (data?.data || []).filter(u => u.role === r).length;
          return (
            <Card key={r}>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">{ROLE_LABELS[r]}</div>
                <div className="text-2xl font-bold mt-1">{count}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Cari nama, email, atau role..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="text-sm text-muted-foreground">Total: {users.length}</div>
            {isAdmin && <ArchiveTabs value={view} onChange={setView} className="ml-auto" />}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Memuat...</div>}
          {error && <div className="text-sm text-red-600 py-8 text-center">Gagal memuat data</div>}
          {!isLoading && users.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">Tidak ada user ditemukan</div>
          )}
          {users.length > 0 && (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead field="name" sort={sort}>Nama</SortHead>
                    <SortHead field="email" sort={sort}>Email</SortHead>
                    <SortHead field="role" sort={sort}>Role</SortHead>
                    <SortHead field="status" sort={sort}>Status</SortHead>
                    <SortHead field="createdAt" sort={sort}>Dibuat</SortHead>
                    {isAdmin && <TableHead className="text-right">Aksi</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.name}
                        {u.id === currentUserId && <Badge variant="outline" className="ml-2 text-[10px]">Anda</Badge>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('uppercase text-[10px]', ROLE_STYLES[u.role])}>{ROLE_LABELS[u.role] || u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={u.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500'}>
                          {u.status === 'active' ? 'Aktif' : 'Nonaktif'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.createdAt ? format(new Date(u.createdAt * 1000 || u.createdAt), 'dd MMM yyyy') : '-'}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditUser(u)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" title="Reset Password" onClick={() => setResetUser(u)}>
                              <KeyRound className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title={view === 'archived' ? 'Pulihkan' : 'Arsipkan'}
                              disabled={u.id === currentUserId}
                              onClick={() => doArchive(u)}
                            >
                              {view === 'archived'
                                ? <ArchiveRestore className="w-4 h-4 text-emerald-600" />
                                : <Archive className="w-4 h-4 text-amber-600" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Hapus"
                              disabled={u.id === currentUserId}
                              onClick={() => setDeleteUser(u)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => { mutate(); setCreateOpen(false); }} />

      {/* Edit Dialog */}
      <EditUserDialog user={editUser} onOpenChange={(v) => !v && setEditUser(null)} onSaved={() => { mutate(); setEditUser(null); }} isSelf={editUser?.id === currentUserId} />

      {/* Reset Password Dialog */}
      <ResetPasswordDialog user={resetUser} onOpenChange={(v) => !v && setResetUser(null)} onDone={() => setResetUser(null)} />

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteUser} onOpenChange={(v) => !v && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus user?</AlertDialogTitle>
            <AlertDialogDescription>
              User <b>{deleteUser?.name}</b> ({deleteUser?.email}) akan dihapus permanen. Aksi ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                const res = await fetch(`/api/users/${deleteUser.id}`, { method: 'DELETE', credentials: 'include' });
                const json = await res.json();
                if (res.ok) {
                  toast.success('User dihapus');
                  mutate();
                } else {
                  toast.error(json.error || 'Gagal menghapus');
                }
                setDeleteUser(null);
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'operator' });
  const [loading, setLoading] = useState(false);

  const reset = () => setForm({ name: '', email: '', password: '', role: 'operator' });

  const submit = async () => {
    if (!form.name || !form.email || !form.password) return toast.error('Nama, email, password wajib diisi');
    if (form.password.length < 6) return toast.error('Password minimal 6 karakter');
    setLoading(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success('User berhasil dibuat');
        reset();
        onCreated();
      } else {
        toast.error(json.error || 'Gagal membuat user');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah User Baru</DialogTitle>
          <DialogDescription>Buat akun ERP baru dan tentukan role akses.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nama Lengkap</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Contoh: Budi Santoso" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@lpi.co.id" />
          </div>
          <div className="space-y-1.5">
            <Label>Password Awal</Label>
            <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Minimal 6 karakter" />
            <p className="text-[11px] text-muted-foreground">User dapat mengubah password ini nanti.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin - akses penuh</SelectItem>
                <SelectItem value="supervisor">Supervisor - kelola operasional</SelectItem>
                <SelectItem value="direktur">Direktur - view only</SelectItem>
                <SelectItem value="operator">Operator - input lapangan</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
            {loading ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onOpenChange, onSaved, isSelf }) {
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) setForm({ name: user.name, role: user.role, status: user.status });
    else setForm({});
  }, [user]);

  const submit = async () => {
    setLoading(true);
    try {
      const payload = { name: form.name, role: form.role, status: form.status };
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success('User diperbarui');
        setForm({});
        onSaved();
      } else {
        toast.error(json.error || 'Gagal memperbarui');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) setForm({}); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nama Lengkap</Label>
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })} disabled={isSelf}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="supervisor">Supervisor</SelectItem>
                <SelectItem value="direktur">Direktur</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
              </SelectContent>
            </Select>
            {isSelf && <p className="text-[11px] text-amber-600">Tidak bisa mengubah role akun sendiri</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })} disabled={isSelf}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
            {loading ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onOpenChange, onDone }) {
  const [pwd, setPwd] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (pwd.length < 6) return toast.error('Password minimal 6 karakter');
    setLoading(true);
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: pwd }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success('Password direset');
        setPwd('');
        onDone();
      } else {
        toast.error(json.error || 'Gagal reset password');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) setPwd(''); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>Reset password untuk <b>{user?.name}</b> ({user?.email})</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Password Baru</Label>
          <Input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Minimal 6 karakter" />
          <p className="text-[11px] text-muted-foreground">Sampaikan password baru ini ke user secara aman.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
            {loading ? 'Reset...' : 'Reset Password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
