'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useSession } from '@/lib/auth/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Search, Pencil, Trash2, Users, Loader2, Eye, ShoppingCart, ClipboardList, TrendingUp, Info, Lock, Contact2, Wallet, Percent, CheckCircle2, MapPin, ChevronsUpDown, FileText, Upload, Download, Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useSort, SortHead, ArchiveTabs, toggleArchive } from '@/lib/table-tools';

const fetcher = (url) => fetch(url).then(r => r.json());

const TYPES = ['Supplier', 'Customer', 'Agen', 'Dropshipper', 'RPH', 'Karyawan', 'Mitra'];
const TYPE_COLOR = {
  Supplier: 'bg-blue-100 text-blue-700',
  Customer: 'bg-emerald-100 text-emerald-700',
  Agen: 'bg-teal-100 text-teal-700',
  Dropshipper: 'bg-pink-100 text-pink-700',
  RPH: 'bg-amber-100 text-amber-700',
  Karyawan: 'bg-slate-100 text-slate-700',
  Mitra: 'bg-purple-100 text-purple-700',
};

const COMMISSION_TYPE_LABEL = {
  per_kg: 'Per Kg',
  fixed: 'Nominal Tetap',
  percent_profit: '% Profit Bersih',
};

// Kategori efektif kontak (array). Backward-compatible dgn contactType lama.
const getCats = (c) => {
  if (Array.isArray(c?.categories) && c.categories.length) return c.categories;
  if (typeof c?.categories === 'string' && c.categories) {
    try { const p = JSON.parse(c.categories); if (Array.isArray(p) && p.length) return p; } catch { /* ignore */ }
  }
  return c?.contactType ? [c.contactType] : [];
};
const hasCat = (c, cat) => getCats(c).includes(cat);

// Peran efektif (kategori ATAU flag lama)
const isAgentRole = (c) => !!(c?.isAgent || hasCat(c, 'Agen'));
const isDsRole = (c) => !!(c?.isDropshipper || hasCat(c, 'Dropshipper'));
const roleLabel = (c) => {
  const cats = getCats(c);
  return cats.length ? cats.join(' + ') : (c?.contactType || '-');
};

const STATUS_COLOR = {
  Draft: 'bg-slate-100 text-slate-700',
  Diproses: 'bg-blue-100 text-blue-700',
  Dikirim: 'bg-amber-100 text-amber-700',
  Selesai: 'bg-emerald-100 text-emerald-700',
  Dibatalkan: 'bg-red-100 text-red-700',
};

const emptyForm = {
  contactType: 'Customer', categories: ['Customer'], code: '', displayName: '', companyName: '',
  isSubscriber: false, creditLimit: 0, prepaidBalance: 0, taxStatus: '',
  isAgent: false, isDropshipper: false,
  agentDiscountPct: 0, commissionType: 'per_kg', commissionValue: 0,
  npwp: '', address: '', city: '', province: '', postalCode: '', mapsUrl: '',
  phone: '', email: '', picName: '', picPhone: '',
  bankName: '', bankAccount: '', bankHolder: '', notes: '', status: 'active'
};

export default function ContactsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canCreate = ['admin', 'supervisor'].includes(role);
  const canEdit = ['admin', 'supervisor'].includes(role);
  const canDelete = role === 'admin';
  const canView = ['admin', 'supervisor', 'direktur'].includes(role);

  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [view, setView] = useState('active');
  const sort = useSort();

  const params = new URLSearchParams();
  if (type !== 'all') params.set('type', type);
  if (q) params.set('q', q);
  if (view === 'archived') params.set('archived', '1');
  const { data, mutate, isLoading, error } = useSWR(canView ? `/api/contacts?${params}` : null, fetcher);
  const rows = sort.sortRows(data?.data || [], {
    code: r => r.code, displayName: r => r.displayName, city: r => r.city, status: r => r.status,
  });

  const doArchive = async (r) => {
    if (!confirm(view === 'archived' ? 'Pulihkan kontak ini dari arsip?' : 'Arsipkan kontak ini? Data akan disembunyikan dari daftar aktif.')) return;
    const ok = await toggleArchive('contacts', r.id, view === 'archived');
    if (ok) mutate();
  };

  if (!canView) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-xl font-bold">Akses Ditolak</h2>
        <p className="text-muted-foreground mt-2">Role Anda ({role}) tidak memiliki akses ke modul Contacts.</p>
      </div>
    );
  }

  const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (row) => { setEditing(row); setForm({ ...emptyForm, ...row, categories: getCats(row) }); setOpen(true); };

  const save = async () => {
    if (!Array.isArray(form.categories) || form.categories.length === 0) { toast.error('Pilih minimal 1 kategori kontak'); return; }
    if (!form.displayName) { toast.error('Nama Tampilan wajib diisi'); return; }
    setSaving(true);
    try {
      const method = editing ? 'PATCH' : 'POST';
      const url = editing ? `/api/contacts/${editing.id}` : '/api/contacts';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(editing ? 'Contact diperbarui' : 'Contact dibuat');
      setOpen(false); mutate();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!confirm('Hapus contact ini?')) return;
    const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-8 h-8 text-emerald-600" /> Contacts
          </h1>
          <p className="text-muted-foreground mt-1">
            Kelola Supplier, Customer, Agen, Dropshipper, RPH, Karyawan, dan Mitra
            <span className="ml-2 text-xs">
              · Role Anda: <Badge variant="outline" className="ml-1">{role}</Badge>
              {role === 'direktur' && <span className="ml-2 text-amber-600">(view only)</span>}
            </span>
          </p>
        </div>
        {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Tambah Contact</Button></DialogTrigger>
            <ContactDialog form={form} setForm={setForm} onSave={save} saving={saving} editing={editing} />
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Tabs value={type} onValueChange={setType}>
              <TabsList>
                <TabsTrigger value="all">Semua</TabsTrigger>
                {TYPES.map(t => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Cari nama / kode / phone..." value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
            </div>
            <ArchiveTabs value={view} onChange={setView} className="sm:ml-auto" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Tipe</TableHead>
              <SortHead field="code" sort={sort}>Kode</SortHead>
              <SortHead field="displayName" sort={sort}>Nama</SortHead>
              <SortHead field="city" sort={sort}>Kota</SortHead>
              <TableHead>Kontak</TableHead>
              <TableHead className="text-right">Credit / Prepaid</TableHead>
              <SortHead field="status" sort={sort}>Status</SortHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {error && <TableRow><TableCell colSpan={8} className="text-center py-8 text-red-500">Gagal memuat data</TableCell></TableRow>}
              {!isLoading && !error && rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Belum ada data</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50">
                  <TableCell><div className="flex flex-wrap gap-1">{getCats(r).map(cat => <Badge key={cat} variant="secondary" className={TYPE_COLOR[cat] || 'bg-slate-100 text-slate-700'}>{cat}</Badge>)}</div></TableCell>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.displayName}</div>
                    {r.companyName && r.companyName !== r.displayName && <div className="text-xs text-muted-foreground">{r.companyName}</div>}
                  </TableCell>
                  <TableCell>{r.city || '-'}</TableCell>
                  <TableCell className="text-sm">
                    {r.phone || '-'}
                    {r.email && <><br /><span className="text-xs text-muted-foreground">{r.email}</span></>}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {hasCat(r, 'Customer') && r.isSubscriber ? <span className="text-emerald-600 font-medium">Prepaid: Rp {Number(r.prepaidBalance).toLocaleString('id-ID')}</span> :
                      r.creditLimit > 0 ? <span>Limit: Rp {Number(r.creditLimit).toLocaleString('id-ID')}</span> : '-'}
                  </TableCell>
                  <TableCell><Badge variant={r.status === 'active' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    <Button size="icon" variant="ghost" title="Detail & History" onClick={() => setDetailId(r.id)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    {canEdit && <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>}
                    {canEdit && (view === 'archived'
                      ? <Button size="icon" variant="ghost" title="Pulihkan" onClick={() => doArchive(r)}><ArchiveRestore className="w-4 h-4 text-emerald-600" /></Button>
                      : <Button size="icon" variant="ghost" title="Arsipkan" onClick={() => doArchive(r)}><Archive className="w-4 h-4 text-amber-600" /></Button>)}
                    {canDelete && <Button size="icon" variant="ghost" title="Hapus" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ContactDetailSheet id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function ContactDetailSheet({ id, onClose }) {
  const { data: session } = useSession();
  const role = session?.user?.role || 'operator';
  const canManage = ['admin', 'supervisor'].includes(role);
  const { data, isLoading } = useSWR(id ? `/api/contacts/${id}/history` : null, fetcher);
  const d = data?.data;
  const ct = d?.contact?.contactType;
  const isAgentOrDs = d ? (isAgentRole(d.contact) || isDsRole(d.contact)) : false;
  const isDropshipper = d ? isDsRole(d.contact) : false;
  const isAgent = d ? isAgentRole(d.contact) : false;
  const tabCount = 3 + (isAgentOrDs ? 1 : 0) + (isDropshipper ? 1 : 0);

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {isLoading || !d ? (
          <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <div className="flex flex-wrap gap-1">{getCats(d.contact).map(cat => <Badge key={cat} variant="secondary" className={TYPE_COLOR[cat] || 'bg-slate-100 text-slate-700'}>{cat}</Badge>)}</div>
                <SheetTitle className="text-2xl">{d.contact.displayName}</SheetTitle>
              </div>
              <SheetDescription className="font-mono text-xs">{d.contact.code}</SheetDescription>
            </SheetHeader>

            <div className="mt-6">
              <Tabs defaultValue="info">
                <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabCount}, minmax(0, 1fr))` }}>
                  <TabsTrigger value="info"><Info className="w-4 h-4 mr-1" /> Info</TabsTrigger>
                  <TabsTrigger value="history"><ClipboardList className="w-4 h-4 mr-1" /> Riwayat</TabsTrigger>
                  <TabsTrigger value="documents"><FileText className="w-4 h-4 mr-1" /> Dokumen</TabsTrigger>
                  {isAgentOrDs && <TabsTrigger value="customers"><Contact2 className="w-4 h-4 mr-1" /> Pelanggan</TabsTrigger>}
                  {isDropshipper && <TabsTrigger value="commission"><Wallet className="w-4 h-4 mr-1" /> Komisi</TabsTrigger>}
                </TabsList>

                <TabsContent value="info" className="mt-4 space-y-4">
                  {isAgent && (
                    <InfoGroup title="Keagenan">
                      <InfoRow label="Diskon Khusus" value={<span className="text-teal-600 font-semibold">{Number(d.contact.agentDiscountPct || 0)}%</span>} />
                    </InfoGroup>
                  )}
                  {isDropshipper && (
                    <InfoGroup title="Skema Komisi">
                      <InfoRow label="Tipe Komisi" value={COMMISSION_TYPE_LABEL[d.contact.commissionType] || d.contact.commissionType || '-'} />
                      <InfoRow label="Nilai Default" value={d.contact.commissionType === 'percent_profit' ? `${Number(d.contact.commissionValue || 0)}%` : `Rp ${Number(d.contact.commissionValue || 0).toLocaleString('id-ID')}`} />
                    </InfoGroup>
                  )}
                  <InfoGroup title="Data Perusahaan">
                    <InfoRow label="Nama Perusahaan" value={d.contact.companyName} />
                    <InfoRow label="Status Pajak" value={d.contact.taxStatus} />
                    <InfoRow label="NPWP" value={d.contact.npwp} />
                    <InfoRow label="Status" value={<Badge variant={d.contact.status === 'active' ? 'default' : 'secondary'}>{d.contact.status}</Badge>} />
                  </InfoGroup>
                  <InfoGroup title="Alamat & Kontak">
                    <InfoRow label="Alamat" value={d.contact.address} />
                    <InfoRow label="Kota" value={d.contact.city} />
                    <InfoRow label="Provinsi" value={d.contact.province} />
                    <InfoRow label="Kode Pos" value={d.contact.postalCode} />
                    {d.contact.mapsUrl && (
                      <InfoRow label="Lokasi" value={
                        <a href={d.contact.mapsUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-600 hover:underline text-sm font-medium">
                          <MapPin className="w-3.5 h-3.5" /> Buka Maps
                        </a>
                      } />
                    )}
                    <InfoRow label="Telepon" value={d.contact.phone} />
                    <InfoRow label="Email" value={d.contact.email} />
                    <InfoRow label="PIC" value={d.contact.picName} />
                    <InfoRow label="PIC Phone" value={d.contact.picPhone} />
                  </InfoGroup>
                  {hasCat(d.contact, 'Customer') && (
                    <InfoGroup title="Kredit & Prepaid">
                      <InfoRow label="Subscriber" value={d.contact.isSubscriber ? 'Ya' : 'Tidak'} />
                      <InfoRow label="Credit Limit" value={`Rp ${Number(d.contact.creditLimit || 0).toLocaleString('id-ID')}`} />
                      <InfoRow label="Prepaid Balance" value={<span className="text-emerald-600 font-semibold">Rp {Number(d.contact.prepaidBalance || 0).toLocaleString('id-ID')}</span>} />
                    </InfoGroup>
                  )}
                  <InfoGroup title="Bank">
                    <InfoRow label="Bank" value={d.contact.bankName} />
                    <InfoRow label="No. Rekening" value={d.contact.bankAccount} />
                    <InfoRow label="Nama Pemilik" value={d.contact.bankHolder} />
                  </InfoGroup>
                  {d.contact.notes && (
                    <InfoGroup title="Catatan">
                      <p className="text-sm whitespace-pre-wrap">{d.contact.notes}</p>
                    </InfoGroup>
                  )}
                </TabsContent>

                <TabsContent value="history" className="mt-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard label="Sales Order" value={d.summary.salesCount} icon={TrendingUp} color="from-emerald-500 to-emerald-600" />
                    <StatCard label="Purchase Order" value={d.summary.purchaseCount} icon={ShoppingCart} color="from-blue-500 to-blue-600" />
                    <StatCard label="Work Order" value={d.summary.workOrderCount} icon={ClipboardList} color="from-purple-500 to-purple-600" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                      <div className="text-emerald-700 text-xs font-semibold uppercase tracking-wide">Total Penjualan</div>
                      <div className="text-lg font-bold mt-1">Rp {Number(d.summary.totalSalesAmount).toLocaleString('id-ID')}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                      <div className="text-blue-700 text-xs font-semibold uppercase tracking-wide">Total Pembelian</div>
                      <div className="text-lg font-bold mt-1">Rp {Number(d.summary.totalPurchaseAmount).toLocaleString('id-ID')}</div>
                    </div>
                  </div>
                  {(hasCat(d.contact, 'Customer') || isAgent) && (
                    <TransactionList title="Sales Orders" items={d.salesOrders} emptyMsg="Belum ada Sales Order" numberKey="soNumber" dateKey="orderDate" />
                  )}
                  {(hasCat(d.contact, 'Supplier') || hasCat(d.contact, 'RPH')) && (
                    <TransactionList title="Purchase Orders" items={d.purchaseOrders} emptyMsg="Belum ada Purchase Order" numberKey="poNumber" dateKey="orderDate" />
                  )}
                  {d.workOrders.length > 0 && (
                    <TransactionList title="Work Orders (dari PO)" items={d.workOrders} emptyMsg="" numberKey="woNumber" dateKey="startDate" />
                  )}
                </TabsContent>

                <TabsContent value="documents" className="mt-4">
                  <DocumentsTab contactId={id} canManage={canManage} />
                </TabsContent>

                {isAgentOrDs && (
                  <TabsContent value="customers" className="mt-4">
                    <EndCustomersTab contactId={id} canManage={canManage} />
                  </TabsContent>
                )}
                {isDropshipper && (
                  <TabsContent value="commission" className="mt-4">
                    <CommissionTab contactId={id} contact={d.contact} canManage={canManage} />
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const DOC_TYPES = ['NPWP', 'Akta Perusahaan', 'SK Perusahaan', 'KTP', 'Lainnya'];
const DOC_TYPE_COLOR = {
  'NPWP': 'bg-blue-100 text-blue-700',
  'Akta Perusahaan': 'bg-purple-100 text-purple-700',
  'SK Perusahaan': 'bg-amber-100 text-amber-700',
  'KTP': 'bg-emerald-100 text-emerald-700',
  'Lainnya': 'bg-slate-100 text-slate-700',
};
const formatBytes = (b) => {
  if (!b) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(i ? 1 : 0)} ${sizes[i]}`;
};

function DocumentsTab({ contactId, canManage }) {
  const { data, mutate, isLoading } = useSWR(contactId ? `/api/contacts/${contactId}/documents` : null, fetcher);
  const rows = data?.data || [];
  const [docType, setDocType] = useState('NPWP');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const upload = async () => {
    if (!file) { toast.error('Pilih file terlebih dahulu'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Ukuran file maksimal 10MB'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('docType', docType);
      const res = await fetch(`/api/contacts/${contactId}/documents`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal mengunggah');
      toast.success('Dokumen diunggah');
      setFile(null);
      // reset the native input
      const el = document.getElementById('doc-file-input'); if (el) el.value = '';
      mutate();
    } catch (e) { toast.error(e.message); } finally { setUploading(false); }
  };
  const remove = async (docId) => {
    if (!confirm('Hapus dokumen ini?')) return;
    const res = await fetch(`/api/contacts/${contactId}/documents/${docId}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); } else { toast.error('Gagal menghapus'); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Dokumen legal kontak (opsional): NPWP, Akta, SK Perusahaan, atau KTP. Maks 10MB per file.</p>

      {canManage && (
        <div className="p-3 rounded-lg border bg-slate-50 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Unggah Dokumen</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <Label className="text-xs">Jenis Dokumen</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">File</Label>
              <Input id="doc-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          <Button size="sm" onClick={upload} disabled={uploading || !file}>
            {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />} Unggah
          </Button>
        </div>
      )}

      {isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> :
        rows.length === 0 ? <div className="text-sm text-muted-foreground p-6 rounded-lg bg-slate-50 border border-dashed text-center">Belum ada dokumen</div> :
          <div className="border rounded-lg divide-y">
            {rows.map(r => (
              <div key={r.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded bg-slate-100 flex items-center justify-center shrink-0"><FileText className="w-4 h-4 text-slate-500" /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className={DOC_TYPE_COLOR[r.docType] || 'bg-slate-100 text-slate-700'}>{r.docType}</Badge>
                      <span className="text-sm font-medium truncate max-w-[220px]" title={r.fileName}>{r.fileName}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{formatBytes(r.size)}{r.uploadedBy ? ` · ${r.uploadedBy}` : ''}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <a href={`/api/contacts/${contactId}/documents/${r.id}/file`} target="_blank" rel="noopener noreferrer">
                    <Button size="icon" variant="ghost" title="Lihat / Unduh"><Download className="w-4 h-4" /></Button>
                  </a>
                  {canManage && <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>}
                </div>
              </div>
            ))}
          </div>}
    </div>
  );
}


const emptyCust = { name: '', phone: '', address: '', city: '', picName: '', notes: '', mapsUrl: '' };
function EndCustomersTab({ contactId, canManage }) {
  const { data, mutate, isLoading } = useSWR(contactId ? `/api/contacts/${contactId}/customers` : null, fetcher);
  const rows = data?.data || [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyCust);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // "Pilih dari Kontak" picker state
  const [pickOpen, setPickOpen] = useState(false);
  const [pickSearch, setPickSearch] = useState('');
  const [linking, setLinking] = useState(false);
  const { data: custData, isLoading: custLoading } = useSWR(
    pickOpen ? `/api/contacts?type=Customer${pickSearch ? `&q=${encodeURIComponent(pickSearch)}` : ''}` : null,
    fetcher
  );
  const linkedIds = new Set(rows.filter(r => r.linkedContactId).map(r => r.linkedContactId));
  const custOptions = (custData?.data || []).filter(c => c.id !== contactId);

  const openCreate = () => { setEditing(null); setForm(emptyCust); setOpen(true); };
  const openEdit = (r) => { setEditing(r); setForm({ ...emptyCust, ...r }); setOpen(true); };
  const save = async () => {
    if (!form.name) { toast.error('Nama wajib diisi'); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/contacts/${contactId}/customers/${editing.id}` : `/api/contacts/${contactId}/customers`;
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success(editing ? 'Pelanggan diperbarui' : 'Pelanggan ditambahkan');
      setOpen(false); mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const linkContact = async (c) => {
    setLinking(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/customers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkedContactId: c.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menautkan');
      toast.success(`Ditautkan ke ${c.displayName}`);
      mutate();
    } catch (e) { toast.error(e.message); } finally { setLinking(false); }
  };
  const remove = async (cid) => {
    if (!confirm('Hapus pelanggan ini?')) return;
    const res = await fetch(`/api/contacts/${contactId}/customers/${cid}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); } else { toast.error('Gagal menghapus'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">Pelanggan akhir milik kontak ini — untuk komunikasi & tujuan pengiriman.</p>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { setPickSearch(''); setPickOpen(true); }}>
              <Contact2 className="w-4 h-4 mr-1" /> Pilih dari Kontak
            </Button>
            <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Tambah</Button>
          </div>
        )}
      </div>
      {isLoading ? <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> :
        rows.length === 0 ? <div className="text-sm text-muted-foreground p-6 rounded-lg bg-slate-50 border border-dashed text-center">Belum ada pelanggan</div> :
          <div className="border rounded-lg divide-y">
            {rows.map(r => (
              <div key={r.id} className="p-3 flex items-start justify-between gap-2 hover:bg-slate-50">
                <div className="text-sm">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {r.name}
                    {r.linkedContactId && !r.linkedMissing && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                        <Contact2 className="w-3 h-3 mr-0.5" /> Tertaut{r.linkedContact?.code ? ` · ${r.linkedContact.code}` : ''}
                      </Badge>
                    )}
                    {r.linkedMissing && (
                      <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200">Tautan hilang</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.phone || '-'} {r.picName ? `· PIC: ${r.picName}` : ''}</div>
                  {r.address && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{r.address}{r.city ? `, ${r.city}` : ''}</div>}
                  {r.mapsUrl && (
                    <a href={r.mapsUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline mt-0.5 font-medium">
                      <MapPin className="w-3 h-3" /> Buka Maps
                    </a>
                  )}
                </div>
                {canManage && (
                  <div className="whitespace-nowrap">
                    {!r.linkedContactId && <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>}
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>}

      {/* Manual create/edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Edit Pelanggan' : 'Tambah Pelanggan'}</DialogTitle>
            <DialogDescription>Data pelanggan akhir untuk komunikasi & pengiriman.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nama *" className="col-span-2"><Input value={form.name} onChange={e => set('name', e.target.value)} /></Field>
            <Field label="Telepon"><Input value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></Field>
            <Field label="PIC"><Input value={form.picName || ''} onChange={e => set('picName', e.target.value)} /></Field>
            <Field label="Alamat" className="col-span-2"><Textarea rows={2} value={form.address || ''} onChange={e => set('address', e.target.value)} /></Field>
            <Field label="Kota"><Input value={form.city || ''} onChange={e => set('city', e.target.value)} /></Field>
            <Field label="Catatan"><Input value={form.notes || ''} onChange={e => set('notes', e.target.value)} /></Field>
            <Field label="Link Google Maps" className="col-span-2">
              <div className="flex gap-2">
                <Input value={form.mapsUrl || ''} onChange={e => set('mapsUrl', e.target.value)} placeholder="https://maps.google.com/..." />
                <Button type="button" variant="outline" size="icon" disabled={!form.mapsUrl} title="Buka Maps"
                  onClick={() => window.open(form.mapsUrl, '_blank', 'noopener,noreferrer')}>
                  <MapPin className="w-4 h-4" />
                </Button>
              </div>
            </Field>
          </div>
          <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pilih dari Kontak (link, not copy) */}
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pilih dari Kontak</DialogTitle>
            <DialogDescription>Tautkan pelanggan akhir ke kontak <b>Customer</b> yang sudah ada. Data akan mengikuti kontak sumber (bukan salinan).</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Cari nama / kode / telepon..." value={pickSearch} onChange={e => setPickSearch(e.target.value)} />
          </div>
          <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
            {custLoading ? (
              <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
            ) : custOptions.length === 0 ? (
              <div className="text-sm text-muted-foreground p-6 text-center">Tidak ada kontak Customer{pickSearch ? ' yang cocok' : ''}.</div>
            ) : custOptions.map(c => {
              const already = linkedIds.has(c.id);
              return (
                <div key={c.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                  <div className="text-sm">
                    <div className="font-medium">{c.displayName} <span className="text-xs text-muted-foreground">· {c.code}</span></div>
                    <div className="text-xs text-muted-foreground">{c.phone || '-'}{c.city ? ` · ${c.city}` : ''}</div>
                  </div>
                  {already ? (
                    <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-500">Sudah tertaut</Badge>
                  ) : (
                    <Button size="sm" variant="outline" disabled={linking} onClick={() => linkContact(c)}>
                      {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-3 h-3 mr-1" />Tautkan</>}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPickOpen(false)}>Tutup</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CommissionTab({ contactId, contact, canManage }) {
  const { data, mutate, isLoading } = useSWR(contactId ? `/api/contacts/${contactId}/commissions` : null, fetcher);
  const { data: soData } = useSWR('/api/sales-orders', fetcher);
  const d = data?.data;
  const summary = d?.summary || { totalCommission: 0, totalPaid: 0, outstanding: 0, unpaidAmount: 0 };
  const records = d?.records || [];
  const payments = d?.payments || [];
  const sos = soData?.data || [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ salesOrderId: '', commissionType: contact?.commissionType || 'per_kg', commissionValue: contact?.commissionValue || 0, costAmount: '' });
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const doPreview = async (f) => {
    if (!f.salesOrderId) { setPreview(null); return; }
    try {
      const res = await fetch('/api/commissions/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salesOrderId: f.salesOrderId, commissionType: f.commissionType, commissionValue: Number(f.commissionValue || 0), costAmount: f.costAmount === '' ? undefined : Number(f.costAmount) }) });
      const j = await res.json();
      if (res.ok) setPreview(j.data);
    } catch { /* ignore */ }
  };
  const openCreate = () => { const f = { salesOrderId: '', commissionType: contact?.commissionType || 'per_kg', commissionValue: contact?.commissionValue || 0, costAmount: '' }; setForm(f); setPreview(null); setOpen(true); };
  const updateForm = (k, v) => { const f = { ...form, [k]: v }; setForm(f); doPreview(f); };

  const save = async () => {
    if (!form.salesOrderId) { toast.error('Pilih Sales Order'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/commissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salesOrderId: form.salesOrderId, commissionType: form.commissionType, commissionValue: Number(form.commissionValue || 0), costAmount: form.costAmount === '' ? undefined : Number(form.costAmount) }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Komisi ditambahkan'); setOpen(false); mutate();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const payOne = async (rid) => {
    if (!confirm('Bayar (lunasi) komisi ini?')) return;
    const res = await fetch(`/api/contacts/${contactId}/commission-payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commissionRecordId: rid }) });
    if (res.ok) { toast.success('Komisi dibayar'); mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };
  const payAll = async () => {
    if (!confirm('Lunasi SEMUA komisi outstanding?')) return;
    const res = await fetch(`/api/contacts/${contactId}/commission-payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    if (res.ok) { const j = await res.json(); toast.success(`Dibayar Rp ${Number(j.data.amount).toLocaleString('id-ID')}`); mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };
  const removeRec = async (rid) => {
    if (!confirm('Hapus record komisi ini?')) return;
    const res = await fetch(`/api/contacts/${contactId}/commissions/${rid}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Terhapus'); mutate(); } else { const j = await res.json(); toast.error(j.error); }
  };

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-slate-50 border">
          <div className="text-xs text-muted-foreground">Total Komisi</div>
          <div className="text-lg font-bold">Rp {Number(summary.totalCommission).toLocaleString('id-ID')}</div>
        </div>
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
          <div className="text-xs text-emerald-700">Sudah Dibayar</div>
          <div className="text-lg font-bold text-emerald-700">Rp {Number(summary.totalPaid).toLocaleString('id-ID')}</div>
        </div>
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
          <div className="text-xs text-amber-700">Outstanding</div>
          <div className="text-lg font-bold text-amber-700">Rp {Number(summary.outstanding).toLocaleString('id-ID')}</div>
        </div>
      </div>

      {canManage && (
        <div className="flex gap-2">
          <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Tambah Komisi</Button>
          {summary.unpaidAmount > 0 && <Button size="sm" variant="outline" onClick={payAll}><CheckCircle2 className="w-4 h-4 mr-1" /> Lunasi Semua</Button>}
        </div>
      )}

      <div>
        <div className="text-sm font-semibold mb-2">Record Komisi ({records.length})</div>
        {records.length === 0 ? <div className="text-sm text-muted-foreground p-6 rounded-lg bg-slate-50 border border-dashed text-center">Belum ada komisi</div> :
          <div className="border rounded-lg divide-y">
            {records.map(r => (
              <div key={r.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                <div className="text-sm">
                  <div className="font-mono font-medium">{r.soNumber || '(SO dihapus)'}</div>
                  <div className="text-xs text-muted-foreground">
                    {COMMISSION_TYPE_LABEL[r.commissionType]} · {r.commissionType === 'percent_profit' ? `${r.commissionValue}% × profit` : r.commissionType === 'per_kg' ? `Rp ${Number(r.commissionValue).toLocaleString('id-ID')}/kg × ${r.basisAmount}kg` : 'nominal tetap'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="font-semibold">Rp {Number(r.commissionAmount).toLocaleString('id-ID')}</div>
                    <Badge variant="secondary" className={r.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{r.status === 'paid' ? 'Lunas' : 'Belum'}</Badge>
                  </div>
                  {canManage && r.status !== 'paid' && (
                    <div className="whitespace-nowrap">
                      <Button size="icon" variant="ghost" title="Bayar" onClick={() => payOne(r.id)}><Wallet className="w-4 h-4 text-emerald-600" /></Button>
                      <Button size="icon" variant="ghost" title="Hapus" onClick={() => removeRec(r.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>}
      </div>

      {payments.length > 0 && (
        <div>
          <div className="text-sm font-semibold mb-2">Riwayat Pembayaran ({payments.length})</div>
          <div className="border rounded-lg divide-y">
            {payments.map(p => (
              <div key={p.id} className="p-3 flex items-center justify-between text-sm hover:bg-slate-50">
                <div>
                  <div className="font-medium">Rp {Number(p.amount).toLocaleString('id-ID')}</div>
                  <div className="text-xs text-muted-foreground">{p.method} · {p.paymentDate ? format(new Date(p.paymentDate), 'dd MMM yyyy') : '-'}</div>
                </div>
                {p.reference && <div className="text-xs text-muted-foreground">{p.reference}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Tambah Komisi</DialogTitle><DialogDescription>Pilih Sales Order untuk menghitung komisi.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Field label="Sales Order *">
              <Select value={form.salesOrderId} onValueChange={v => updateForm('salesOrderId', v)}>
                <SelectTrigger><SelectValue placeholder="Pilih SO" /></SelectTrigger>
                <SelectContent>
                  {sos.map(so => <SelectItem key={so.id} value={so.id}>{so.soNumber} · {so.customer?.name || '-'} · Rp {Number(so.totalAmount || 0).toLocaleString('id-ID')}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipe Komisi">
                <Select value={form.commissionType} onValueChange={v => updateForm('commissionType', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_kg">Per Kg</SelectItem>
                    <SelectItem value="fixed">Nominal Tetap</SelectItem>
                    <SelectItem value="percent_profit">% Profit Bersih</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={form.commissionType === 'percent_profit' ? 'Nilai (%)' : 'Nilai (Rp)'}>
                <Input type="number" value={form.commissionValue} onChange={e => updateForm('commissionValue', e.target.value)} />
              </Field>
            </div>
            {form.commissionType === 'percent_profit' && (
              <Field label="Modal/HPP Manual (Rp) — kosongkan untuk auto dari stok">
                <Input type="number" value={form.costAmount} onChange={e => updateForm('costAmount', e.target.value)} placeholder="auto" />
              </Field>
            )}
            {preview && (
              <div className="p-3 rounded-lg bg-slate-50 border text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Omzet (SO)</span><span>Rp {Number(preview.revenue).toLocaleString('id-ID')}</span></div>
                {form.commissionType === 'percent_profit' && <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Modal (HPP)</span><span>Rp {Number(preview.cost).toLocaleString('id-ID')}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Profit Bersih</span><span>Rp {Number(preview.profit).toLocaleString('id-ID')}</span></div>
                </>}
                {form.commissionType === 'per_kg' && <div className="flex justify-between"><span className="text-muted-foreground">Total Berat</span><span>{Number(preview.totalWeight)} kg</span></div>}
                <div className="flex justify-between font-bold text-emerald-700 border-t pt-1"><span>Komisi</span><span>Rp {Number(preview.amount).toLocaleString('id-ID')}</span></div>
              </div>
            )}
          </div>
          <DialogFooter><Button onClick={save} disabled={saving || !form.salesOrderId}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoGroup({ title, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 rounded-lg bg-slate-50 border">{children}</div>
    </div>
  );
}
function InfoRow({ label, value }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || <span className="text-muted-foreground">-</span>}</div>
    </div>
  );
}
function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="p-3 rounded-lg border bg-white">
      <div className={`w-8 h-8 rounded-md bg-gradient-to-br ${color} flex items-center justify-center text-white mb-2`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
function TransactionList({ title, items, emptyMsg, numberKey, dateKey }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-2">{title} ({items.length})</div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground p-4 rounded-lg bg-slate-50 border border-dashed text-center">{emptyMsg}</div>
      ) : (
        <div className="border rounded-lg divide-y">
          {items.map(it => (
            <div key={it.id} className="p-3 flex items-center justify-between text-sm hover:bg-slate-50">
              <div>
                <div className="font-mono font-semibold">{it[numberKey]}</div>
                <div className="text-xs text-muted-foreground">
                  {it[dateKey] ? format(new Date(it[dateKey]), 'dd MMM yyyy') : '-'}
                </div>
              </div>
              <div className="text-right">
                <Badge variant="secondary" className={STATUS_COLOR[it.pipelineStatus] || ''}>{it.pipelineStatus}</Badge>
                {it.totalAmount > 0 && <div className="text-xs mt-1">Rp {Number(it.totalAmount).toLocaleString('id-ID')}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactDialog({ form, setForm, onSave, saving, editing }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cats = Array.isArray(form.categories) ? form.categories : [];
  const [codeAuto, setCodeAuto] = useState(!editing);
  const primary = cats[0];
  // Auto-generate code from primary category when creating (until user edits manually)
  useEffect(() => {
    if (editing || !codeAuto || !primary) return;
    let active = true;
    fetch(`/api/contacts/next-code?category=${encodeURIComponent(primary)}`)
      .then(r => r.json())
      .then(j => { if (active && j?.code) setForm(f => ({ ...f, code: j.code })); })
      .catch(() => {});
    return () => { active = false; };
  }, [primary, codeAuto, editing, setForm]);
  const toggleCat = (cat) => {
    setForm(f => {
      const cur = Array.isArray(f.categories) ? f.categories : [];
      const next = cur.includes(cat) ? cur.filter(c => c !== cat) : [...cur, cat];
      return { ...f, categories: next, contactType: next[0] || '', isAgent: next.includes('Agen'), isDropshipper: next.includes('Dropshipper') };
    });
  };
  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit Contact' : 'Tambah Contact'}</DialogTitle>
        <DialogDescription>Data master untuk relasi bisnis PT Ladang Pangan Indonesia.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Kategori Kontak *" className="sm:col-span-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-between font-normal h-auto min-h-10 py-2">
                <span className="flex flex-wrap gap-1 items-center">
                  {cats.length ? cats.map(c => <Badge key={c} variant="secondary" className={TYPE_COLOR[c] || 'bg-slate-100 text-slate-700'}>{c}</Badge>) : <span className="text-muted-foreground">Pilih kategori...</span>}
                </span>
                <ChevronsUpDown className="w-4 h-4 opacity-50 ml-2 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
              <div className="space-y-0.5">
                {TYPES.map(t => (
                  <label key={t} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-100 cursor-pointer text-sm">
                    <Checkbox checked={cats.includes(t)} onCheckedChange={() => toggleCat(t)} />
                    <span className="flex-1">{t}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground mt-1">Bisa pilih lebih dari satu. Fitur mengikuti setiap kategori yang dipilih.</p>
        </Field>
        <Field label="Kode *">
          <Input value={form.code} onChange={e => { set('code', e.target.value); setCodeAuto(false); }} placeholder="otomatis" />
          {!editing && codeAuto && <p className="text-xs text-muted-foreground mt-1">Terisi otomatis dari kategori. Bisa diedit.</p>}
        </Field>
        <Field label="Nama Tampilan *"><Input value={form.displayName} onChange={e => set('displayName', e.target.value)} /></Field>
        <Field label="Nama Perusahaan" className="sm:col-span-2"><Input value={form.companyName || ''} onChange={e => set('companyName', e.target.value)} /></Field>
        {cats.includes('Customer') && (
          <>
            <Field label="Subscriber (Prepaid)">
              <div className="flex items-center gap-2 h-10">
                <Switch checked={!!form.isSubscriber} onCheckedChange={v => set('isSubscriber', v)} />
                <span className="text-sm text-muted-foreground">{form.isSubscriber ? 'Ya' : 'Tidak'}</span>
              </div>
            </Field>
            {form.isSubscriber ? (
              <Field label="Prepaid Balance (Rp)"><Input type="number" value={form.prepaidBalance} onChange={e => set('prepaidBalance', Number(e.target.value))} /></Field>
            ) : (
              <Field label="Credit Limit (Rp)"><Input type="number" value={form.creditLimit} onChange={e => set('creditLimit', Number(e.target.value))} /></Field>
            )}
          </>
        )}
        {(cats.includes('Agen') || cats.includes('Dropshipper')) && (
          <div className="sm:col-span-2 p-3 rounded-lg border bg-slate-50 space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pengaturan Peran</div>
            {cats.includes('Agen') && (
              <div>
                <Label className="text-xs">Diskon Khusus Agen (%)</Label>
                <Input type="number" step="0.1" value={form.agentDiscountPct || 0} onChange={e => set('agentDiscountPct', Number(e.target.value))} placeholder="mis. 5" />
                <p className="text-xs text-muted-foreground">Diskon otomatis diterapkan saat kontak ini jadi pembeli di Sales Order.</p>
              </div>
            )}
            {cats.includes('Dropshipper') && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tipe Komisi</Label>
                  <Select value={form.commissionType || 'per_kg'} onValueChange={v => set('commissionType', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per_kg">Per Kg (Rp/kg)</SelectItem>
                      <SelectItem value="fixed">Nominal Tetap (Rp/transaksi)</SelectItem>
                      <SelectItem value="percent_profit">% Profit Bersih</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{form.commissionType === 'percent_profit' ? 'Nilai Komisi (%)' : 'Nilai Komisi (Rp)'}</Label>
                  <Input type="number" step="0.01" value={form.commissionValue || 0} onChange={e => set('commissionValue', Number(e.target.value))} placeholder={form.commissionType === 'per_kg' ? '150' : form.commissionType === 'percent_profit' ? '5' : '100000'} />
                </div>
              </div>
            )}
          </div>
        )}
        <Field label="Status Pajak">
          <Select value={form.taxStatus || 'none'} onValueChange={v => set('taxStatus', v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="Pilih" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">-</SelectItem>
              <SelectItem value="PKP">PKP</SelectItem>
              <SelectItem value="NonPKP">Non PKP</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="NPWP"><Input value={form.npwp || ''} onChange={e => set('npwp', e.target.value)} /></Field>
        <Field label="Alamat" className="sm:col-span-2"><Textarea value={form.address || ''} onChange={e => set('address', e.target.value)} rows={2} /></Field>
        <Field label="Kota"><Input value={form.city || ''} onChange={e => set('city', e.target.value)} /></Field>
        <Field label="Provinsi"><Input value={form.province || ''} onChange={e => set('province', e.target.value)} /></Field>
        <Field label="Link Google Maps" className="sm:col-span-2">
          <div className="flex gap-2">
            <Input value={form.mapsUrl || ''} onChange={e => set('mapsUrl', e.target.value)} placeholder="https://maps.google.com/..." />
            <Button type="button" variant="outline" size="icon" disabled={!form.mapsUrl} title="Buka Maps"
              onClick={() => window.open(form.mapsUrl, '_blank', 'noopener,noreferrer')}>
              <MapPin className="w-4 h-4" />
            </Button>
          </div>
        </Field>
        <Field label="Telepon"><Input value={form.phone || ''} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="PIC Name"><Input value={form.picName || ''} onChange={e => set('picName', e.target.value)} /></Field>
        <Field label="PIC Phone"><Input value={form.picPhone || ''} onChange={e => set('picPhone', e.target.value)} /></Field>
        <Field label="Bank"><Input value={form.bankName || ''} onChange={e => set('bankName', e.target.value)} /></Field>
        <Field label="No. Rekening"><Input value={form.bankAccount || ''} onChange={e => set('bankAccount', e.target.value)} /></Field>
        <Field label="Nama Pemilik Rekening" className="sm:col-span-2"><Input value={form.bankHolder || ''} onChange={e => set('bankHolder', e.target.value)} /></Field>
        <Field label="Status">
          <Select value={form.status} onValueChange={v => set('status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Catatan" className="sm:col-span-2"><Textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} /></Field>
      </div>
      <DialogFooter>
        <Button onClick={onSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Simpan</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
