'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Download, Loader2, FileSpreadsheet, ShoppingCart, Truck, Boxes, Calculator, Database, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { downloadWorkbook } from '@/lib/export/xlsx-client';
import ImportPanel from './import-panel';

const MODULES = [
  { key: 'sales-orders', title: 'Sales Order', icon: ShoppingCart, color: 'text-emerald-600', desc: 'Header SO + item (harga, berat, diskon, ongkir, faktur).', sheets: ['Sales Order', 'Item SO'] },
  { key: 'purchase-orders', title: 'Purchase Order', icon: Truck, color: 'text-orange-600', desc: 'Header PO + item (harga, berat, HPP, biaya tambahan).', sheets: ['Purchase Order', 'Item PO'] },
  { key: 'inventory', title: 'Inventory / Stok', icon: Boxes, color: 'text-blue-600', desc: 'Stok per kode simpan + Kartu Stok (mutasi).', sheets: ['Stok', 'Kartu Stok'] },
  { key: 'accounting', title: 'Akuntansi / Keuangan', icon: Calculator, color: 'text-purple-600', desc: 'Bagan Akun, Jurnal (Buku Besar), Neraca Saldo.', sheets: ['Bagan Akun', 'Jurnal', 'Neraca Saldo'] },
];

export default function ImportExportPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="w-6 h-6" />Impor & Ekspor Data</h1>
        <p className="text-muted-foreground text-sm mt-1">Ekspor data ke Excel (.xlsx) untuk backup/analisis, atau impor master data untuk migrasi dari sistem lama (mis. Odoo).</p>
      </div>

      <Tabs defaultValue="export">
        <TabsList>
          <TabsTrigger value="export"><Download className="w-4 h-4 mr-1.5" />Ekspor</TabsTrigger>
          <TabsTrigger value="import"><Upload className="w-4 h-4 mr-1.5" />Impor Master Data</TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="mt-4">
          <ExportTab />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <ImportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExportTab() {
  const [loading, setLoading] = useState(null); // module key or 'all'

  const fetchModule = async (key) => {
    const res = await fetch(`/api/export/${key}`, { credentials: 'include' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Gagal mengambil data');
    return j.data; // { filename, sheets }
  };

  const exportOne = async (key) => {
    setLoading(key);
    try {
      const data = await fetchModule(key);
      const totalRows = (data.sheets || []).reduce((a, sh) => a + (sh.rows?.length || 0), 0);
      if (totalRows === 0) { toast.info('Belum ada data pada modul ini — file kosong tetap diunduh sebagai template.'); }
      downloadWorkbook(data.filename, data.sheets);
      toast.success('Berhasil mengunduh Excel');
    } catch (e) { toast.error(e.message); } finally { setLoading(null); }
  };

  const exportAll = async () => {
    setLoading('all');
    try {
      for (const m of MODULES) {
        const data = await fetchModule(m.key);
        downloadWorkbook(data.filename, data.sheets);
        await new Promise(r => setTimeout(r, 400)); // jeda agar browser tidak memblok multi-download
      }
      toast.success('Semua modul berhasil diunduh');
    } catch (e) { toast.error(e.message); } finally { setLoading(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Setiap file berisi beberapa sheet sesuai modul.</p>
        <Button onClick={exportAll} disabled={loading !== null} variant="outline">
          {loading === 'all' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}Unduh Semua
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODULES.map(m => {
          const Icon = m.icon;
          return (
            <Card key={m.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Icon className={`w-5 h-5 ${m.color}`} />{m.title}</CardTitle>
                <CardDescription>{m.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1 mb-3">
                  {m.sheets.map(s => <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>)}
                </div>
                <Button size="sm" className="w-full" onClick={() => exportOne(m.key)} disabled={loading !== null}>
                  {loading === m.key ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}Unduh Excel
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
