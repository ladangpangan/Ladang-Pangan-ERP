'use client';

import React, { useState, useRef } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Download, Upload, Loader2, Package, Users, BookOpen, CheckCircle2, AlertTriangle, FileWarning } from 'lucide-react';
import { toast } from 'sonner';
import { downloadWorkbook, parseWorkbookFile } from '@/lib/export/xlsx-client';

const fetcher = (url) => fetch(url).then(r => r.json());

const MODULES = [
  { key: 'products', title: 'Produk', icon: Package, color: 'text-emerald-600', desc: 'Impor produk (upsert berdasarkan SKU).' },
  { key: 'contacts', title: 'Kontak', icon: Users, color: 'text-blue-600', desc: 'Impor pelanggan & pemasok (upsert berdasarkan Kode/Nama).' },
  { key: 'chart-of-accounts', title: 'Bagan Akun', icon: BookOpen, color: 'text-purple-600', desc: 'Impor daftar akun (upsert berdasarkan Kode Akun).' },
];

export default function ImportPanel() {
  const { data } = useSWR('/api/import/templates', fetcher);
  const templates = data?.data || {};

  return (
    <div className="space-y-4">
      <Alert>
        <FileWarning className="w-4 h-4" />
        <AlertDescription className="text-xs">
          <b>Langkah:</b> 1) Unduh template · 2) Isi data dari sistem lama (Odoo) sesuai kolom · 3) Upload file .xlsx.
          Data akan di-<b>upsert</b> (baris yang cocok diperbarui, yang baru dibuat). Untuk migrasi bersih, impor
          <b> Bagan Akun</b>, <b>Produk</b>, & <b>Kontak</b> dulu, lalu Saldo Awal.
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {MODULES.map(m => <ImportCard key={m.key} mod={m} tpl={templates[m.key]} />)}
      </div>
    </div>
  );
}

function ImportCard({ mod, tpl }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const inputRef = useRef(null);
  const Icon = mod.icon;

  const downloadTemplate = () => {
    if (!tpl) { toast.error('Template belum siap'); return; }
    const example = {};
    (tpl.columns || []).forEach(c => { example[c] = tpl.example?.[c] ?? ''; });
    downloadWorkbook(tpl.filename || `Template_${mod.key}`, [{ name: tpl.sheet || 'Data', rows: [example] }]);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setReport(null);
    try {
      const parsed = await parseWorkbookFile(file);
      const sheetNames = Object.keys(parsed);
      let rows = null;
      if (tpl?.sheet && parsed[tpl.sheet]) rows = parsed[tpl.sheet];
      if (!rows) { const first = sheetNames.find(n => (parsed[n] || []).length > 0); rows = first ? parsed[first] : []; }
      if (!rows || rows.length === 0) { toast.error('File tidak berisi data'); setBusy(false); return; }
      const res = await fetch(`/api/import/${mod.key}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal impor');
      setReport(j.data);
      const { created = 0, updated = 0, errors = [] } = j.data;
      if (errors.length === 0) toast.success(`Impor selesai: ${created} baru, ${updated} diperbarui`);
      else toast.warning(`Impor selesai dengan ${errors.length} error (${created} baru, ${updated} diperbarui)`);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Icon className={`w-5 h-5 ${mod.color}`} />{mod.title}</CardTitle>
        <CardDescription>{mod.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button size="sm" variant="outline" className="w-full" onClick={downloadTemplate} disabled={!tpl}>
          <Download className="w-4 h-4 mr-1.5" />Unduh Template
        </Button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
        <Button size="sm" className="w-full" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}Upload & Impor
        </Button>
        {report && (
          <div className="mt-2 rounded-md border p-2 text-xs space-y-1 bg-muted/30">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" />{report.created} baru</Badge>
              <Badge className="bg-blue-600">{report.updated} diperbarui</Badge>
              {report.skipped > 0 && <Badge variant="secondary">{report.skipped} dilewati</Badge>}
              {report.errors?.length > 0 && <Badge className="bg-red-600"><AlertTriangle className="w-3 h-3 mr-1" />{report.errors.length} error</Badge>}
            </div>
            {report.errors?.length > 0 && (
              <div className="max-h-32 overflow-y-auto mt-1 space-y-0.5">
                {report.errors.slice(0, 20).map((er, i) => (
                  <div key={i} className="text-red-600">Baris {er.row}: {er.message}</div>
                ))}
                {report.errors.length > 20 && <div className="text-muted-foreground">…dan {report.errors.length - 20} error lainnya</div>}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
