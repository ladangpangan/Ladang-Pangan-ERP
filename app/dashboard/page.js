'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { TrendingUp, ShoppingCart, ClipboardList, Boxes, AlertTriangle, DollarSign, Package, Users, Loader2, ArrowRight, Wallet, Activity, Factory, TrendingDown, ChevronRight } from 'lucide-react';

const fetcher = (url) => fetch(url).then(r => r.json());

const pctColorClass = (pct) => pct === null || pct === undefined ? 'text-muted-foreground' : pct >= 5 ? 'text-red-600' : pct >= 2 ? 'text-amber-600' : 'text-emerald-600';

export default function DashboardHome() {
  const { data: sum } = useSWR('/api/dashboard/summary', fetcher, { refreshInterval: 30000 });
  const { data: shr } = useSWR('/api/dashboard/supplier-shrinkage', fetcher, { refreshInterval: 60000 });
  const s = sum?.data;
  const shrRows = shr?.data || [];
  const shrTotals = shr?.totals;
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const { data: shrDetail } = useSWR(selectedSupplier ? `/api/dashboard/supplier-shrinkage/${selectedSupplier.id}` : null, fetcher);
  const detail = shrDetail?.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Ringkasan operasional PT Ladang Pangan Indonesia — update otomatis 30 detik</p>
      </div>

      {!s ? <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div> : (
        <>
          {/* Top KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KPI icon={Factory} color="from-purple-500 to-purple-600" label="Produksi Hari Ini" value={`${s.todayProduction.count} WO`} sub={`${Number(s.todayProduction.rendemenWeight).toFixed(1)} kg · Efisiensi ${s.todayProduction.efficiency.toFixed(1)}%`} href="/dashboard/work-orders" />
            <KPI icon={Wallet} color="from-blue-500 to-blue-600" label="Piutang (AR)" value={`Rp ${Number(s.finance.totalAR).toLocaleString('id-ID')}`} sub={`Utang: Rp ${Number(s.finance.totalAP).toLocaleString('id-ID')}`} href="/dashboard/sales-reports" />
            <KPI icon={Package} color="from-cyan-500 to-cyan-600" label="Nilai Inventory" value={`Rp ${Number(s.inventoryValue).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`} sub={`Aktif dalam stok`} href="/dashboard/inventory" />
          </div>

          {/* Active WO + Alerts */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="w-4 h-4" />Work Order Aktif</CardTitle><CardDescription>Sedang dalam proses produksi</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {Object.keys(s.activeWo).length === 0 && <div className="text-sm text-muted-foreground text-center py-4">Tidak ada WO aktif</div>}
                {Object.entries(s.activeWo).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                    <Badge className={status === 'Dalam Proses' ? 'bg-amber-100 text-amber-700' : status === 'Disetujui' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100'}>{status}</Badge>
                    <span className="text-2xl font-bold">{count}</span>
                  </div>
                ))}
                <Link href="/dashboard/work-orders"><Button variant="outline" size="sm" className="w-full mt-2">Lihat semua WO <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-amber-600" />Alerts</CardTitle><CardDescription>Perlu perhatian segera</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                <AlertRow color="amber" label="Stok mendekati expired (≤7 hari)" value={s.alerts.nearExpired} href="/dashboard/inventory-reports" />
                <AlertRow color="red" label="Stok sudah expired" value={s.alerts.expired} href="/dashboard/inventory-reports" />
                <AlertRow color="slate" label="Rusak / Susut" value={`${s.alerts.damaged.count} rows · ${Number(s.alerts.damaged.weight).toFixed(2)} kg`} href="/dashboard/inventory-reports" />
              </CardContent>
            </Card>
          </div>

          {/* Rekap Susut per Supplier (Surat Jalan vs Tally) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="w-4 h-4 text-amber-600" />Rekap Susut per Supplier</CardTitle>
              <CardDescription>Selisih Berat Dikirim (Surat Jalan) vs Berat Diterima (Tally) — pantau kualitas kiriman supplier</CardDescription>
            </CardHeader>
            <CardContent>
              {shrRows.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">Belum ada data penerimaan (Surat Jalan) untuk dihitung.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="text-left font-medium py-2">Supplier</th>
                        <th className="text-right font-medium py-2">PO</th>
                        <th className="text-right font-medium py-2">Dikirim (ditally)</th>
                        <th className="text-right font-medium py-2">Diterima (Tally)</th>
                        <th className="text-right font-medium py-2">Susut</th>
                        <th className="text-right font-medium py-2">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shrRows.map(r => {
                        const pct = r.susutPct;
                        const pctColor = pctColorClass(pct);
                        return (
                          <tr key={r.supplierId} onClick={() => setSelectedSupplier({ id: r.supplierId, name: r.supplierName })} className="border-b last:border-0 hover:bg-emerald-50/60 cursor-pointer">
                            <td className="py-2">
                              <div className="font-medium flex items-center gap-1 text-emerald-700">{r.supplierName} <ChevronRight className="w-3.5 h-3.5 opacity-60" /></div>
                              <div className="text-xs text-muted-foreground font-mono">{r.supplierCode}</div>
                            </td>
                            <td className="text-right">{r.poCount}</td>
                            <td className="text-right">{r.tallyDone ? `${r.sjTallied.toLocaleString('id-ID')} kg` : <span className="text-xs text-muted-foreground">belum tally</span>}</td>
                            <td className="text-right">{r.tallyDone ? `${r.tallyWeight.toLocaleString('id-ID')} kg` : '-'}</td>
                            <td className="text-right font-semibold">{r.tallyDone ? `${r.susut.toLocaleString('id-ID')} kg` : '-'}</td>
                            <td className={`text-right font-bold ${pctColor}`}>{pct === null ? '-' : `${pct}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {shrTotals && (
                      <tfoot>
                        <tr className="border-t font-semibold bg-slate-50/60">
                          <td className="py-2">TOTAL</td>
                          <td></td>
                          <td className="text-right">{(shrTotals.sjTallied ?? 0).toLocaleString('id-ID')} kg</td>
                          <td className="text-right">{shrTotals.tallyWeight.toLocaleString('id-ID')} kg</td>
                          <td className="text-right">{shrTotals.susut.toLocaleString('id-ID')} kg</td>
                          <td className={`text-right ${shrTotals.susutPct >= 5 ? 'text-red-600' : shrTotals.susutPct >= 2 ? 'text-amber-600' : 'text-emerald-600'}`}>{shrTotals.susutPct}%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  <div className="text-[11px] text-muted-foreground mt-2">Kolom &quot;Dikirim (ditally)&quot; = berat SJ untuk item yang sudah ditally · Klik baris untuk rincian per PO &amp; produk · Warna %: <span className="text-emerald-600">hijau &lt;2%</span> · <span className="text-amber-600">kuning 2–5%</span> · <span className="text-red-600">merah ≥5%</span></div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick nav to reports */}
          <Card>
            <CardHeader><CardTitle className="text-base">Laporan per Modul</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Link href="/dashboard/sales-reports" className="p-4 border rounded-lg hover:bg-slate-50"><TrendingUp className="w-5 h-5 text-emerald-600 mb-2" /><div className="font-semibold">Penjualan</div><div className="text-xs text-muted-foreground">SO, per customer/produk, AR</div></Link>
              <Link href="/dashboard/purchase-reports" className="p-4 border rounded-lg hover:bg-slate-50"><ShoppingCart className="w-5 h-5 text-blue-600 mb-2" /><div className="font-semibold">Pembelian</div><div className="text-xs text-muted-foreground">PO, per supplier, AP, susut</div></Link>
              <Link href="/dashboard/production-reports" className="p-4 border rounded-lg hover:bg-slate-50"><ClipboardList className="w-5 h-5 text-purple-600 mb-2" /><div className="font-semibold">Produksi</div><div className="text-xs text-muted-foreground">Batch, rendemen, HPP, efisiensi</div></Link>
              <Link href="/dashboard/inventory-reports" className="p-4 border rounded-lg hover:bg-slate-50"><Boxes className="w-5 h-5 text-cyan-600 mb-2" /><div className="font-semibold">Inventory</div><div className="text-xs text-muted-foreground">Per CS/produk, expired, rusak</div></Link>
            </CardContent>
          </Card>
        </>
      )}

      {/* Dialog: Rincian Susut Supplier */}
      <Dialog open={!!selectedSupplier} onOpenChange={(o) => { if (!o) setSelectedSupplier(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><TrendingDown className="w-5 h-5 text-amber-600" /> Rincian Susut — {selectedSupplier?.name}</DialogTitle>
            <DialogDescription>Selisih Berat Dikirim (Surat Jalan) vs Diterima (Tally) per PO &amp; produk</DialogDescription>
          </DialogHeader>
          {!detail ? (
            <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Memuat…</div>
          ) : detail.pos.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">Belum ada data penerimaan.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2 text-center bg-slate-50 rounded-lg p-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Dikirim (SJ)</div><div className="font-bold">{detail.totals.sjWeight.toLocaleString('id-ID')} kg</div></div>
                <div><div className="text-xs text-muted-foreground">Diterima (Tally)</div><div className="font-bold">{detail.totals.tallyWeight.toLocaleString('id-ID')} kg</div></div>
                <div><div className="text-xs text-muted-foreground">Susut</div><div className="font-bold">{detail.totals.susut.toLocaleString('id-ID')} kg</div></div>
                <div><div className="text-xs text-muted-foreground">%</div><div className={`font-bold ${pctColorClass(detail.totals.susutPct)}`}>{detail.totals.susutPct}%</div></div>
              </div>
              {detail.pos.map(po => (
                <div key={po.poId} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/40 text-sm">
                    <div>
                      <span className="font-semibold">{po.poNumber}</span>
                      {po.orderDate && <span className="text-xs text-muted-foreground ml-2">{format(new Date(po.orderDate), 'dd MMM yyyy')}</span>}
                      <Badge variant="secondary" className="ml-2 text-[10px]">{po.status}</Badge>
                    </div>
                    <div className="text-xs">
                      Susut: <b className={pctColorClass(po.susutPct)}>{po.tallyDone ? `${po.susut.toLocaleString('id-ID')} kg (${po.susutPct}%)` : 'belum tally'}</b>
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b">
                        <th className="text-left font-medium px-3 py-1.5">Produk</th>
                        <th className="text-right font-medium px-2">Dikirim</th>
                        <th className="text-right font-medium px-2">Diterima</th>
                        <th className="text-right font-medium px-2">Susut</th>
                        <th className="text-right font-medium px-3">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map(it => (
                        <tr key={it.productId} className="border-b last:border-0">
                          <td className="px-3 py-1.5">
                            <div className="font-medium">{it.productName}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{it.sku}</div>
                          </td>
                          <td className="text-right px-2">{it.sjWeight.toLocaleString('id-ID')} kg</td>
                          <td className="text-right px-2">{it.tallyDone ? `${it.tallyWeight.toLocaleString('id-ID')} kg` : '—'}</td>
                          <td className="text-right px-2 font-semibold">{it.tallyDone ? `${it.susut.toLocaleString('id-ID')} kg` : '-'}</td>
                          <td className={`text-right px-3 font-bold ${pctColorClass(it.susutPct)}`}>{it.susutPct === null ? '-' : `${it.susutPct}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

function KPI({ icon: Icon, color, label, value, sub, href }) {
  return (
    <Link href={href || '#'}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer overflow-hidden">
        <CardContent className="p-5">
          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white mb-3`}><Icon className="w-5 h-5" /></div>
          <div className="text-xl font-bold">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </CardContent>
      </Card>
    </Link>
  );
}

function AlertRow({ color, label, value, href }) {
  const cls = { amber: 'bg-amber-50 text-amber-700 border-amber-200', red: 'bg-red-50 text-red-700 border-red-200', slate: 'bg-slate-50 text-slate-700 border-slate-200' }[color];
  return (
    <Link href={href || '#'}>
      <div className={`p-3 rounded-lg border flex items-center justify-between ${cls} hover:brightness-95 cursor-pointer`}>
        <span className="text-sm">{label}</span>
        <span className="font-bold">{value}</span>
      </div>
    </Link>
  );
}
