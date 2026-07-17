'use client';

import { useState } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Search, Pencil, Trash2, Users, Loader2, Eye, ShoppingCart, ClipboardList, TrendingUp, Info, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

const fetcher = (url) => fetch(url).then(r => r.json());

const TYPES = ['Supplier', 'Customer', 'RPH', 'Karyawan', 'Mitra'];
const TYPE_COLOR = {
  Supplier: 'bg-blue-100 text-blue-700',
  Customer: 'bg-emerald-100 text-emerald-700',
  RPH: 'bg-amber-100 text-amber-700',
  Karyawan: 'bg-slate-100 text-slate-700',
  Mitra: 'bg-purple-100 text-purple-700',
};

const STATUS_COLOR = {
  Draft: 'bg-slate-100 text-slate-700',
  Diproses: 'bg-blue-100 text-blue-700',
  Dikirim: 'bg-amber-100 text-amber-700',
  Selesai: 'bg-emerald-100 text-emerald-700',
  Dibatalkan: 'bg-red-100 text-red-700',
};

const emptyForm = {
  contactType: 'Supplier', code: '', displayName: '', companyName: '',
  isSubscriber: false, creditLimit: 0, prepaidBalance: 0, taxStatus: '',
  npwp: '', address: '', city: '', province: '', postalCode: '',
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

  const params = new URLSearchParams();
  if (type !== 'all') params.set('type', type);
  if (q) params.set('q', q);
  const { data, mutate, isLoading, error } = useSWR(canView ? `/api/contacts?${params}` : null, fetcher);
  const rows = data?.data || [];

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
  const openEdit = (row) => { setEditing(row); setForm({ ...emptyForm, ...row }); setOpen(true); };

  const save = async () => {
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
            Kelola Supplier, Customer, RPH, Karyawan, dan Mitra
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Tipe</TableHead><TableHead>Kode</TableHead><TableHead>Nama</TableHead>
              <TableHead>Kota</TableHead><TableHead>Kontak</TableHead>
              <TableHead className="text-right">Credit / Prepaid</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></TableCell></TableRow>}
              {error && <TableRow><TableCell colSpan={8} className="text-center py-8 text-red-500">Gagal memuat data</TableCell></TableRow>}
              {!isLoading && !error && rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Belum ada data</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.id} className="hover:bg-slate-50">
                  <TableCell><Badge variant="secondary" className={TYPE_COLOR[r.contactType]}>{r.contactType}</Badge></TableCell>
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
                    {r.contactType === 'Customer' && r.isSubscriber ? <span className="text-emerald-600 font-medium">Prepaid: Rp {Number(r.prepaidBalance).toLocaleString('id-ID')}</span> :
                      r.creditLimit > 0 ? <span>Limit: Rp {Number(r.creditLimit).toLocaleString('id-ID')}</span> : '-'}
                  </TableCell>
                  <TableCell><Badge variant={r.status === 'active' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    <Button size="icon" variant="ghost" title="Detail & History" onClick={() => setDetailId(r.id)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    {canEdit && <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>}
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
  const { data, isLoading } = useSWR(id ? `/api/contacts/${id}/history` : null, fetcher);
  const d = data?.data;

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {isLoading || !d ? (
          <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className={TYPE_COLOR[d.contact.contactType]}>{d.contact.contactType}</Badge>
                <SheetTitle className="text-2xl">{d.contact.displayName}</SheetTitle>
              </div>
              <SheetDescription className="font-mono text-xs">{d.contact.code}</SheetDescription>
            </SheetHeader>

            <div className="mt-6">
              <Tabs defaultValue="info">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="info"><Info className="w-4 h-4 mr-1" /> Informasi</TabsTrigger>
                  <TabsTrigger value="history"><ClipboardList className="w-4 h-4 mr-1" /> Riwayat Transaksi</TabsTrigger>
                </TabsList>

                <TabsContent value="info" className="mt-4 space-y-4">
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
                    <InfoRow label="Telepon" value={d.contact.phone} />
                    <InfoRow label="Email" value={d.contact.email} />
                    <InfoRow label="PIC" value={d.contact.picName} />
                    <InfoRow label="PIC Phone" value={d.contact.picPhone} />
                  </InfoGroup>
                  {d.contact.contactType === 'Customer' && (
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
                  {/* Summary stats */}
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

                  {/* Sales Orders */}
                  {['Customer'].includes(d.contact.contactType) && (
                    <TransactionList title="Sales Orders" items={d.salesOrders} emptyMsg="Belum ada Sales Order" numberKey="soNumber" dateKey="orderDate" />
                  )}
                  {/* Purchase Orders */}
                  {['Supplier', 'RPH'].includes(d.contact.contactType) && (
                    <TransactionList title="Purchase Orders" items={d.purchaseOrders} emptyMsg="Belum ada Purchase Order" numberKey="poNumber" dateKey="orderDate" />
                  )}
                  {/* Work Orders (if any) */}
                  {d.workOrders.length > 0 && (
                    <TransactionList title="Work Orders (dari PO)" items={d.workOrders} emptyMsg="" numberKey="woNumber" dateKey="startDate" />
                  )}

                  <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                    <Info className="w-3 h-3 inline mr-1" />
                    Riwayat akan terisi otomatis saat modul PO / SO / WO dibangun.
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
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
  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit Contact' : 'Tambah Contact'}</DialogTitle>
        <DialogDescription>Data master untuk relasi bisnis PT Ladang Pangan Indonesia.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Tipe *">
          <Select value={form.contactType} onValueChange={v => set('contactType', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Kode *"><Input value={form.code} onChange={e => set('code', e.target.value)} placeholder="SUP-001" /></Field>
        <Field label="Nama Tampilan *" className="sm:col-span-2"><Input value={form.displayName} onChange={e => set('displayName', e.target.value)} /></Field>
        <Field label="Nama Perusahaan" className="sm:col-span-2"><Input value={form.companyName || ''} onChange={e => set('companyName', e.target.value)} /></Field>
        {form.contactType === 'Customer' && (
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
