'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useSession } from '@/lib/auth/auth-client';
import { WeightInput } from '@/components/ui/weight-input';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { KodeConfirm } from '@/components/kode-confirm';
import {
  ArrowLeft, ArrowDownToLine, ChevronDown, ScanLine, Check, AlertCircle, Loader2, Trash2, Download, FileText, Keyboard, Tag, Wifi, WifiOff,
} from 'lucide-react';
import { PACKAGING_TYPES, pkgLabel } from '@/lib/constants';
import { generateTallyInboundPDF } from '@/lib/pdf/invoice';
import { usePdfPreview } from '@/components/pdf-preview-dialog';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dmy = (d) => (d && !isNaN(d.getTime())) ? format(d, 'dd/MM/yy') : '-';
const parseYmd = (v) => {
  const p = String(v || '').slice(0, 10).split('-');
  if (p.length !== 3) return null;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return isNaN(d.getTime()) ? null : d;
};
// Tambah bulan; tanggal dipotong ke akhir bulan bila perlu (31 Agu + 6 bln = 28/29 Feb)
const addMonths = (d, m) => {
  const r = new Date(d.getFullYear(), d.getMonth() + m, 1);
  r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
};
// Aturan kadaluarsa: 6 bulan sejak masuk gudang, tapi maksimal 10 bulan sejak produksi (pakai yang paling cepat)
const EXP_MONTHS_FROM_INBOUND = 6;
const EXP_MONTHS_FROM_PRODUCTION = 10;

const STEP_NAMES = ['Sumber', 'Detail', 'Scan'];
const card = 'bg-white border border-[#DFE5EC] rounded-[14px] shadow-[0_1px_2px_rgba(15,23,41,0.06)]';
const selectCls = 'h-[52px] w-full border border-[#CBD5E1] rounded-[10px] text-[17px] font-medium px-3 bg-white text-[#0F1729] focus:outline-2 focus:outline-[#117956]';
const sectionLabel = 'text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C]';
const primaryBtn = 'min-h-[56px] w-full rounded-xl bg-[#117956] text-white text-lg font-bold disabled:opacity-50 flex items-center justify-center gap-2';
const outlineBtn = 'min-h-[52px] w-full rounded-xl border border-[#CBD5E1] bg-white text-[#0F1729] text-base font-medium flex items-center justify-center gap-2';
const smallBtn = 'min-h-[36px] px-3 rounded-lg border border-[#CBD5E1] bg-white text-[#0F1729] text-sm font-medium shrink-0';

export default function TallyInboundPage() {
  const { data: session } = useSession();
  const pdfPreview = usePdfPreview();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  // Master data
  const { data: productData } = useSWR('/api/products', fetcher);
  const { data: csData } = useSWR('/api/cold-storages', fetcher);
  const { data: poData } = useSWR('/api/purchase-orders', fetcher);
  const { data: woData } = useSWR('/api/work-orders', fetcher);
  const { data: draftData, mutate: mutateDrafts } = useSWR('/api/tally-sessions?status=draft', fetcher);
  const products = productData?.data || [];
  const coldStorages = csData?.data || [];
  const purchaseOrders = poData?.data || [];
  const workOrders = woData?.data || [];
  const drafts = draftData?.data || [];

  const [screen, setScreen] = useState('source'); // source | setup | scan | confirm | done
  // Langkah 1: sumber
  const [refType, setRefType] = useState('PO');
  const [refId, setRefId] = useState('');
  const [openRef, setOpenRef] = useState(null);
  // Langkah 2: detail
  const [productId, setProductId] = useState('');
  const [packagingType, setPackagingType] = useState('colly');
  const [prodDate, setProdDate] = useState('');
  const [expManual, setExpManual] = useState(null); // null = otomatis
  const [coldStorageId, setColdStorageId] = useState('');
  const [zoneId, setZoneId] = useState('');
  // Langkah 3: scan
  const [staged, setStaged] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [textRead, setTextRead] = useState(null); // hasil baca tulisan spidol, menunggu konfirmasi
  const [checking, setChecking] = useState(false);
  const [scanned, setScanned] = useState(null); // { code, auto }
  const [weight, setWeight] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);
  const [flash, setFlash] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  // Simpan
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(null);
  const saveChain = useRef(Promise.resolve());
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [markTallyDone, setMarkTallyDone] = useState(false);
  const [notes, setNotes] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const weightRef = useRef(null);

  const { data: zoneData } = useSWR(coldStorageId ? `/api/cold-storages/${coldStorageId}` : null, fetcher);
  const zones = zoneData?.data?.zones || [];

  // Pilih gudang pertama otomatis bila hanya ada satu
  useEffect(() => {
    if (!coldStorageId && coldStorages.length === 1) setColdStorageId(coldStorages[0].id);
  }, [coldStorages, coldStorageId]);

  const availablePOs = useMemo(() => purchaseOrders.filter(po => !po.tallyCompletedAt && po.pipelineStatus !== 'Cancelled' && !po.archivedAt), [purchaseOrders]);
  const availableWOs = useMemo(() => workOrders.filter(wo => wo.pipelineStatus !== 'Cancelled' && !wo.archivedAt), [workOrders]);
  const refList = refType === 'PO' ? availablePOs : refType === 'WO' ? availableWOs : [];

  const { data: poDetail } = useSWR(refType === 'PO' && refId ? `/api/purchase-orders/${refId}` : null, fetcher);
  const { data: woDetail } = useSWR(refType === 'WO' && refId ? `/api/work-orders/${refId}` : null, fetcher);
  const refProductIds = useMemo(() => {
    if (refType === 'PO' && poDetail?.data?.items) return poDetail.data.items.map(it => it.productId);
    if (refType === 'WO' && woDetail?.data?.outputs) return woDetail.data.outputs.map(it => it.productId);
    return null;
  }, [refType, poDetail, woDetail]);
  const availableProducts = refProductIds ? products.filter(p => refProductIds.includes(p.id)) : products;
  const product = products.find(p => p.id === productId);
  const refNumber = refType === 'PO' ? (purchaseOrders.find(p => p.id === refId)?.poNumber || '')
    : refType === 'WO' ? (workOrders.find(w => w.id === refId)?.woNumber || '') : '';
  const csObj = coldStorages.find(c => c.id === coldStorageId);
  const zoneObj = zones.find(z => z.id === zoneId);

  // Kadaluarsa otomatis
  const today = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }, []);
  const prodD = parseYmd(prodDate);
  const expIn = addMonths(today, EXP_MONTHS_FROM_INBOUND);
  const expProd = prodD ? addMonths(prodD, EXP_MONTHS_FROM_PRODUCTION) : null;
  const useProdRule = !!(expProd && expProd < expIn);
  const expAuto = useProdRule ? expProd : expIn;
  const expFinal = expManual ? parseYmd(expManual) : expAuto;

  // Berat Surat Jalan per produk (PO)
  const sjWeight = useMemo(() => {
    const m = {};
    if (refType === 'PO' && poDetail?.data?.items) for (const it of poDetail.data.items) m[it.productId] = Number(it.receivedWeight || 0);
    return m;
  }, [refType, poDetail]);
  const productStaged = staged.filter(it => it.productId === productId);
  const productStagedKg = productStaged.reduce((a, b) => a + Number(b.weight || 0), 0);
  const sjTotal = Number(sjWeight[productId] || 0);
  const sjLeft = Math.round((sjTotal - productStagedKg) * 100) / 100;
  const totalKg = staged.reduce((a, b) => a + Number(b.weight || 0), 0);

  // ===== Simpan draft otomatis (berantai agar tidak tabrakan) =====
  const buildPayload = (items) => ({
    coldStorageId,
    zoneId: zoneId || undefined,
    referenceType: refType,
    referenceId: refId || undefined,
    notes,
    kodeBase: null,
    kodeBaseAt: 0,
    markTallyComplete: refType === 'PO' && !!markTallyDone,
    items: items.map(it => ({
      productId: it.productId, weight: Number(it.weight), quantity: Number(it.quantity || 1),
      packagingType: it.packagingType, expiredDate: it.expiredDate || undefined,
      kodeSimpan: it.kodeSimpan || undefined, zoneId: it.zoneId || undefined,
    })),
  });
  const persist = (items) => {
    const payload = buildPayload(items);
    const run = async () => {
      setSaveState('saving');
      const id = sessionIdRef.current;
      const res = await fetch(id ? `/api/tally-sessions/${id}` : '/api/tally-sessions', {
        method: id ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      if (!id && j.data?.id) { sessionIdRef.current = j.data.id; setSessionId(j.data.id); }
      setSaveState('saved');
      return sessionIdRef.current;
    };
    const p = saveChain.current.then(run, run);
    saveChain.current = p.catch(() => { setSaveState('error'); });
    return p;
  };

  // ===== Scan =====
  const handleCode = async (raw, { auto = false } = {}) => {
    const code = String(raw || '').trim();
    if (!code) return;
    setScanning(false);
    setErrorMsg(null); setFlash(null);
    if (staged.some(it => it.kodeSimpan === code)) {
      setErrorMsg(`${code} sudah di-scan di tally ini. Ambil karung berikutnya.`);
      return;
    }
    setChecking(true);
    try {
      const qs = new URLSearchParams({ code, ...(sessionIdRef.current ? { session: sessionIdRef.current } : {}) });
      const res = await fetch(`/api/tally-sessions/check-kode?${qs}`, { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal cek kode');
      if (!j.data?.available) { setErrorMsg(j.data?.message || `${code} sudah dipakai.`); return; }
      setScanned({ code, auto });
      setWeight(0);
      setTimeout(() => weightRef.current?.focus(), 50);
    } catch (e) {
      setErrorMsg(online ? e.message : 'Tidak ada sinyal. Coba lagi saat online.');
    } finally { setChecking(false); }
  };

  const useAutoCode = async () => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/inventory/next-kode-simpan?count=200', { credentials: 'include' });
      const j = await res.json();
      const used = new Set(staged.map(it => it.kodeSimpan));
      const code = (j.data?.codes || []).find(c => !used.has(c));
      if (!code) throw new Error('Kode otomatis tidak tersedia');
      await handleCode(code, { auto: true });
    } catch (e) { setErrorMsg(e.message); }
  };

  const saveBag = () => {
    if (!scanned) return;
    const w = Number(weight || 0);
    if (!w || w <= 0) { setErrorMsg('Isi berat karung dulu.'); return; }
    if (!expFinal) { setErrorMsg('Tanggal kadaluarsa belum benar. Cek di langkah Detail.'); return; }
    const item = {
      _id: Math.random().toString(36).slice(2),
      kodeSimpan: scanned.code,
      productId, productName: product?.name, productSku: product?.sku,
      weight: w, quantity: 1, packagingType,
      expiredDate: ymd(expFinal),
      zoneId: zoneId || null, zoneCode: zoneObj?.code || null,
    };
    const next = [...staged, item];
    setStaged(next);
    setScanned(null);
    setWeight(0);
    setErrorMsg(null);
    setFlash(`Tersimpan: ${item.kodeSimpan} · ${kg(w)} kg`);
    persist(next).catch(e => toast.error(e.message));
  };

  const undoLast = () => {
    if (!staged.length) return;
    const last = staged[staged.length - 1];
    if (!confirm(`Batalkan karung terakhir (${last.kodeSimpan} · ${kg(last.weight)} kg)?`)) return;
    const next = staged.slice(0, -1);
    setStaged(next);
    setFlash(null);
    persist(next).catch(e => toast.error(e.message));
  };

  // ===== Finalisasi =====
  const finalize = async () => {
    if (!staged.length) return;
    setFinalizing(true);
    try {
      const id = await persist(staged); // pastikan data terakhir + centang PO selesai ikut tersimpan
      const res = await fetch(`/api/tally-sessions/${id}/finalize`, { method: 'POST', credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memasukkan ke stok');
      const created = j.data?.stocks || [];
      const items = staged.map((it, i) => ({ ...it, kodeSimpan: created[i]?.kodeSimpan || it.kodeSimpan }));
      setLastSaved({
        time: new Date(),
        operator: session?.user?.name || session?.user?.email || 'Operator',
        csCode: csObj?.code, csName: csObj?.name,
        zoneCode: zoneObj?.code || null,
        refType, refNumber: refType === 'MANUAL' ? null : refNumber,
        notes, items,
        totalWeight: items.reduce((a, b) => a + Number(b.weight || 0), 0),
      });
      setScreen('done');
      mutateDrafts();
    } catch (e) { toast.error(e.message); }
    finally { setFinalizing(false); }
  };

  const resetAll = () => {
    setStaged([]); setScanned(null); setWeight(0); setErrorMsg(null); setFlash(null);
    setNotes(''); setMarkTallyDone(false); setExpManual(null); setProdDate('');
    setSessionId(null); sessionIdRef.current = null; setSaveState('idle');
    setRefId(''); setOpenRef(null); setProductId('');
    setScreen('source');
  };

  // ===== Lanjutkan draft =====
  const loadSession = async (id) => {
    try {
      const res = await fetch(`/api/tally-sessions/${id}`, { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memuat');
      const sess = j.data;
      setRefType(sess.referenceType || 'MANUAL');
      setRefId(sess.referenceId || '');
      setColdStorageId(sess.coldStorageId || '');
      setZoneId(sess.zoneId || '');
      setNotes(sess.notes || '');
      setMarkTallyDone(!!sess.markTallyComplete);
      const items = (sess.items || []).map(it => ({
        _id: Math.random().toString(36).slice(2),
        kodeSimpan: it.kodeSimpan || null,
        productId: it.productId, productName: it.productName, productSku: it.productSku,
        weight: Number(it.weight || 0), quantity: Number(it.quantity || 1),
        packagingType: it.packagingType || 'colly',
        expiredDate: it.expiredDate ? ymd(new Date(it.expiredDate)) : '',
        zoneId: it.zoneId || null, zoneCode: it.zoneCode || null,
      }));
      setStaged(items);
      const last = items[items.length - 1];
      if (last) {
        setProductId(last.productId);
        setPackagingType(last.packagingType);
        if (last.zoneId) setZoneId(last.zoneId);
        setExpManual(last.expiredDate || null);
      }
      setSessionId(id); sessionIdRef.current = id; setSaveState('saved');
      setScreen(last ? 'scan' : 'setup');
    } catch (e) { toast.error(e.message); }
  };
  const deleteDraft = async (id) => {
    if (!confirm('Hapus tally yang belum selesai ini? Karung yang sudah di-scan ikut terhapus.')) return;
    const res = await fetch(`/api/tally-sessions/${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { toast.success('Dihapus'); mutateDrafts(); } else toast.error('Gagal menghapus');
  };
  // Dibuka dari "Belum selesai" di Beranda Tally: /tally/inbound?session=<id>
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get('session');
  useEffect(() => {
    if (sessionParam) loadSession(sessionParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionParam]);

  // ===== Navigasi langkah =====
  const goSetup = () => {
    if (refType !== 'MANUAL' && !refId) { toast.error(`Pilih nomor ${refType} dulu`); return; }
    if (!productId || (refProductIds && !refProductIds.includes(productId))) {
      const first = availableProducts[0];
      if (first) { setProductId(first.id); setPackagingType(first.packagingType || 'colly'); }
    }
    if (refType === 'WO' && !prodDate) {
      const wo = workOrders.find(w => w.id === refId);
      const d = wo?.startDate ? new Date(wo.startDate) : null;
      if (d && !isNaN(d.getTime())) setProdDate(ymd(d));
    }
    setScreen('setup');
  };
  // Produk default ketika detail PO/WO baru termuat
  useEffect(() => {
    if (screen === 'setup' && !productId && availableProducts[0]) {
      setProductId(availableProducts[0].id);
      setPackagingType(availableProducts[0].packagingType || 'colly');
    }
  }, [screen, productId, availableProducts]);

  const goScan = () => {
    if (!productId) return toast.error('Pilih produk');
    if (!coldStorageId) return toast.error('Pilih gudang');
    if (!prodDate) return toast.error('Isi tanggal produksi (lihat label karung / surat jalan)');
    if (!expFinal) return toast.error('Tanggal kadaluarsa belum benar');
    setErrorMsg(null); setFlash(null);
    setScreen('scan');
  };

  const stepIdx = screen === 'source' ? 0 : screen === 'setup' ? 1 : 2;
  const stepLabel = screen === 'confirm' ? 'Cek sebelum masuk stok' : screen === 'done' ? 'Selesai' : `Langkah ${stepIdx + 1} dari 3 · ${STEP_NAMES[stepIdx]}`;

  // Ringkasan per produk untuk konfirmasi
  const byProduct = useMemo(() => {
    const m = new Map();
    for (const it of staged) {
      const r = m.get(it.productId) || { name: it.productName, count: 0, kg: 0, exp: new Set() };
      r.count += 1; r.kg += Number(it.weight || 0);
      if (it.expiredDate) r.exp.add(it.expiredDate);
      m.set(it.productId, r);
    }
    return [...m.values()];
  }, [staged]);

  const downloadCSV = () => {
    if (!lastSaved) return;
    const rows = [['No', 'Kode Simpan', 'SKU', 'Produk', 'Kemasan', 'Qty', 'Berat (kg)', 'Kadaluarsa']];
    lastSaved.items.forEach((it, i) => rows.push([
      i + 1, it.kodeSimpan || '-', it.productSku || '-', it.productName || '-', pkgLabel(it.packagingType), it.quantity,
      Number(it.weight).toFixed(2), it.expiredDate ? format(new Date(it.expiredDate), 'dd-MM-yyyy') : '-',
    ]));
    rows.push(['', '', '', '', '', 'TOTAL', lastSaved.totalWeight.toFixed(2), '']);
    const meta = [
      ['Laporan Tally Inbound'], ['Tanggal', format(lastSaved.time, 'dd MMM yyyy HH:mm')], ['Operator', lastSaved.operator],
      ['Cold Storage', `${lastSaved.csCode || ''} ${lastSaved.csName || ''}`.trim()], ['Zona', lastSaved.zoneCode || '-'],
      ['Referensi', lastSaved.refType === 'MANUAL' ? 'Manual' : `${lastSaved.refType} · ${lastSaved.refNumber || '-'}`], [''],
    ];
    const csv = [...meta, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `TallyInbound_${format(lastSaved.time, 'yyyyMMdd_HHmm')}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const showBeritaAcara = (r) => {
    try { pdfPreview.show(generateTallyInboundPDF(r), `BeritaAcaraTally_${format(new Date(r.time), 'yyyyMMdd_HHmm')}.pdf`, 'Berita Acara Tally Masuk'); }
    catch (e) { toast.error('Gagal membuat PDF: ' + e.message); }
  };
  const downloadPDF = () => { if (lastSaved) showBeritaAcara(lastSaved); };


  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-[#F1F5F9] text-[#0F1729]" style={{ fontFamily: 'Roboto, system-ui, sans-serif' }}>
      {/* Header */}
      <div className="bg-white border-b border-[#DFE5EC] px-4 py-3 flex flex-col gap-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/tally" aria-label="Kembali ke beranda" className="w-10 h-10 flex items-center justify-center rounded-[10px] text-[#0F1729]"><ArrowLeft className="w-[22px] h-[22px]" /></Link>
          <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white"><ArrowDownToLine className="w-[22px] h-[22px]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold">Barang Masuk</div>
            <div className="text-[13px] text-[#5A687C]">{stepLabel}</div>
          </div>
          {online ? <Wifi className="w-5 h-5 text-[#117956]" /> : <WifiOff className="w-5 h-5 text-red-500" />}
        </div>
        {screen !== 'done' && (
          <div className="grid grid-cols-3 gap-1.5">
            {STEP_NAMES.map((n, i) => (
              <div key={n} className="flex flex-col gap-1">
                <div className={`h-1 rounded-full ${i <= stepIdx ? 'bg-[#117956]' : 'bg-[#E2E8F0]'}`} />
                <div className={`text-xs font-medium ${i <= stepIdx ? 'text-[#0F1729]' : 'text-[#94A3B8]'}`}>{n}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Langkah 1: Sumber ===== */}
      {screen === 'source' && (
        <div className="flex-1 p-4 flex flex-col gap-3.5">
          {drafts.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className={sectionLabel}>Belum selesai</div>
              {drafts.map(d => (
                <div key={d.id} className="flex items-center gap-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-[14px] pl-4 pr-2 py-2.5">
                  <button type="button" onClick={() => loadSession(d.id)} className="flex-1 text-left min-w-0">
                    <div className="text-base font-bold truncate">{d.refNumber ? `${d.referenceType} ${d.refNumber}` : 'Manual'}</div>
                    <div className="text-sm text-[#5A687C]">{d.itemCount} karung · {kg(d.totalWeight)} kg{d.updatedAt ? ` · ${format(new Date(d.updatedAt), 'dd MMM HH:mm')}` : ''}</div>
                  </button>
                  <button type="button" onClick={() => loadSession(d.id)} className="text-[15px] font-bold text-[#117956] px-2 min-h-[44px]">Lanjutkan</button>
                  <button type="button" onClick={() => deleteDraft(d.id)} aria-label="Hapus" className="w-10 h-10 flex items-center justify-center text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}

          <div className={`${card} p-4 flex flex-col gap-2`}>
            <label htmlFor="sumber" className="text-[15px] font-medium">Sumber Barang</label>
            <select id="sumber" value={refType} onChange={(e) => { setRefType(e.target.value); setRefId(''); setOpenRef(null); setProductId(''); }} className={selectCls}>
              <option value="PO">Purchase Order (supplier)</option>
              <option value="WO">Hasil Produksi (WO)</option>
              <option value="MANUAL">Lainnya (tanpa referensi)</option>
            </select>
          </div>

          {refType !== 'MANUAL' && (
            <div className="flex flex-col gap-2">
              <div className={sectionLabel}>{refType === 'PO' ? 'Nomor PO' : 'Nomor WO'}</div>
              {refList.length === 0 && (
                <div className={`${card} p-4 text-sm text-[#5A687C]`}>{(refType === 'PO' ? poData : woData) ? `Tidak ada ${refType} yang menunggu tally.` : 'Memuat…'}</div>
              )}
              {refList.map(r => (
                <RefOption key={r.id} refType={refType} row={r} products={products}
                  selected={refId === r.id} open={openRef === r.id}
                  onPick={() => { setRefId(r.id); setProductId(''); }}
                  onToggle={() => setOpenRef(openRef === r.id ? null : r.id)} />
              ))}
            </div>
          )}

          <button type="button" onClick={goSetup} disabled={refType !== 'MANUAL' && !refId} className={`${primaryBtn} mt-auto`}>Lanjut</button>

          <Link href="/tally/riwayat" className="text-center text-[15px] font-medium text-[#117956] min-h-[44px] flex items-center justify-center">Riwayat & berita acara tally →</Link>
        </div>
      )}

      {/* ===== Langkah 2: Detail ===== */}
      {screen === 'setup' && (
        <div className="flex-1 p-4 flex flex-col gap-3.5">
          <div className={`${card} px-3.5 py-3 flex items-center gap-2.5`}>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-[#5A687C]">Sumber</div>
              <div className="text-base font-bold font-mono truncate">{refType === 'MANUAL' ? 'Lainnya' : refNumber}</div>
            </div>
            <button type="button" onClick={() => setScreen('source')} className={smallBtn} disabled={staged.length > 0} title={staged.length > 0 ? 'Sudah ada karung di-scan' : undefined}>Ubah</button>
          </div>

          <div className={`${card} p-4 flex flex-col gap-3.5`}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="produk" className="text-[15px] font-medium">Produk</label>
              <select id="produk" value={productId} onChange={(e) => { const p = products.find(x => x.id === e.target.value); setProductId(e.target.value); if (p?.packagingType) setPackagingType(p.packagingType); }} className={selectCls}>
                {!productId && <option value="">Pilih produk</option>}
                {availableProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {refProductIds && <div className="text-[13px] text-[#5A687C]">Hanya produk yang ada di {refType} ini</div>}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5 min-w-0">
                <label htmlFor="kemasan" className="text-[15px] font-medium">Kemasan</label>
                <select id="kemasan" value={packagingType} onChange={(e) => setPackagingType(e.target.value)} className={selectCls}>
                  {PACKAGING_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <label htmlFor="prod" className="text-[15px] font-medium">Tanggal Produksi</label>
                <input id="prod" type="date" value={prodDate} max={ymd(today)} onChange={(e) => { setProdDate(e.target.value); setExpManual(null); }} className={`${selectCls} px-2 min-w-0`} />
              </div>
            </div>
            <div className="bg-[#EDF8F3] border border-[#B7E4CF] rounded-xl px-3.5 py-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-[15px] font-medium text-[#0D6346]">{expManual ? 'Kadaluarsa (diubah petugas)' : 'Kadaluarsa (otomatis)'}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xl font-bold">{dmy(expFinal)}</span>
                  {!expManual && (
                    <button type="button" onClick={() => setExpManual(ymd(expAuto))} className="min-h-[32px] px-2.5 rounded-lg border border-[#B7E4CF] bg-white text-[#0D6346] text-[13px] font-medium">Ubah</button>
                  )}
                </span>
              </div>
              {expManual !== null && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="expman" className="text-[13px] font-medium">Tanggal kadaluarsa sesuai label barang</label>
                  <input id="expman" type="date" value={expManual} onChange={(e) => setExpManual(e.target.value)} className="h-12 border border-[#CBD5E1] rounded-[10px] text-base font-medium px-2 bg-white min-w-0" />
                  <button type="button" onClick={() => setExpManual(null)} className="self-start min-h-[32px] text-[13px] font-medium text-[#117956] underline">Kembalikan ke otomatis</button>
                </div>
              )}
              <div className="flex flex-col gap-1 text-[13px]">
                <div className={`flex justify-between gap-2 ${!expManual && !useProdRule ? 'font-bold' : 'text-[#5A687C]'}`}><span>Masuk gudang {dmy(today)} + {EXP_MONTHS_FROM_INBOUND} bulan</span><span>{dmy(expIn)}</span></div>
                <div className={`flex justify-between gap-2 ${!expManual && useProdRule ? 'font-bold' : 'text-[#5A687C]'}`}><span>Produksi {dmy(prodD)} + {EXP_MONTHS_FROM_PRODUCTION} bulan</span><span>{dmy(expProd)}</span></div>
              </div>
              <div className="text-xs text-[#5A687C]">{expManual ? 'Hitungan otomatis di atas hanya sebagai pembanding' : prodD ? 'Dipakai tanggal yang paling cepat' : 'Isi tanggal produksi dari label karung / surat jalan'}</div>
            </div>
          </div>

          <div className={`${card} p-4 flex flex-col gap-3.5`}>
            <div className={sectionLabel}>Lokasi Simpan</div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1.5 min-w-0">
                <label htmlFor="gudang" className="text-[15px] font-medium">Gudang</label>
                <select id="gudang" value={coldStorageId} onChange={(e) => { setColdStorageId(e.target.value); setZoneId(''); }} className={selectCls}>
                  {!coldStorageId && <option value="">Pilih</option>}
                  {coldStorages.map(cs => <option key={cs.id} value={cs.id}>{cs.code} - {cs.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <label htmlFor="zona" className="text-[15px] font-medium">Zona</label>
                <select id="zona" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={!coldStorageId || zones.length === 0} className={selectCls}>
                  <option value="">{zones.length === 0 ? 'Tidak ada' : 'Tanpa zona'}</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.code}</option>)}
                </select>
              </div>
            </div>
          </div>

          <button type="button" onClick={goScan} className={`${primaryBtn} mt-auto`}><ScanLine className="w-6 h-6" /> {staged.length ? 'Lanjut Scan' : 'Mulai Scan'}</button>
        </div>
      )}

      {/* ===== Langkah 3: Scan ===== */}
      {screen === 'scan' && (
        <div className="flex-1 p-4 flex flex-col gap-3">
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[#EEF2F6]">
              <div className="flex-1 min-w-0">
                <div className="text-base font-bold truncate">{product?.name || '-'}</div>
                <div className="text-sm text-[#5A687C] truncate">{pkgLabel(packagingType)} · ED {dmy(expFinal)} · {refType === 'MANUAL' ? 'Lainnya' : refNumber}</div>
              </div>
              <button type="button" onClick={() => { setScanning(false); setScanned(null); setScreen('setup'); }} className={smallBtn}>Ubah</button>
            </div>
            <div className="px-3.5 py-2.5 flex items-center gap-2.5">
              <label htmlFor="zona2" className="text-sm text-[#5A687C]">Zona</label>
              <select id="zona2" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={zones.length === 0} className="h-10 flex-1 border border-[#CBD5E1] rounded-lg text-[15px] font-medium px-2 bg-white">
                <option value="">{zones.length === 0 ? 'Tidak ada zona' : 'Tanpa zona'}</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.code}</option>)}
              </select>
              <span className="text-sm text-[#5A687C] truncate">{csObj?.code}</span>
            </div>
            {refType === 'PO' && sjTotal > 0 && (
              <div className="px-3.5 pb-3 flex flex-col gap-1.5 border-t border-[#EEF2F6] pt-2.5">
                <div className="flex justify-between text-[13px] text-[#5A687C]">
                  <span>Surat Jalan {kg(sjTotal)} kg</span>
                  <span>Sisa <b className={sjLeft > 0.001 ? 'text-[#C2410C]' : sjLeft < -0.001 ? 'text-blue-600' : 'text-[#117956]'}>{kg(sjLeft)} kg</b></span>
                </div>
                <div className="h-1.5 rounded-full bg-[#EEF2F6] overflow-hidden">
                  <div className="h-1.5 rounded-full bg-[#117956]" style={{ width: `${Math.min(100, Math.round((productStagedKg / sjTotal) * 100))}%` }} />
                </div>
              </div>
            )}
          </div>

          <div className={`${card} grid grid-cols-2`}>
            <div className="px-3.5 py-2.5 border-r border-[#EEF2F6]">
              <div className="text-[13px] text-[#5A687C]">Karung</div>
              <div className="text-[26px] font-bold">{staged.length}</div>
            </div>
            <div className="px-3.5 py-2.5">
              <div className="text-[13px] text-[#5A687C]">Total berat</div>
              <div className="text-[26px] font-bold">{kg(totalKg)} <span className="text-[15px] font-medium text-[#5A687C]">kg</span></div>
            </div>
          </div>

          {errorMsg && (
            <div role="alert" className="flex gap-2.5 items-start bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] rounded-xl px-3.5 py-3 text-base font-medium">
              <AlertCircle className="w-[22px] h-[22px] text-[#DC2828] shrink-0" /><span>{errorMsg}</span>
            </div>
          )}
          {flash && !errorMsg && (
            <div role="status" className="flex gap-2.5 items-center bg-[#EDF8F3] border border-[#B7E4CF] text-[#0D6346] rounded-xl px-3.5 py-3 text-base font-medium">
              <Check className="w-[22px] h-[22px] shrink-0" /><span>{flash}</span>
            </div>
          )}

          {scanned ? (
            <div className="bg-white border-2 border-[#117956] rounded-[14px] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] text-[#5A687C]">{scanned.auto ? 'Kode otomatis (tulis di karung)' : 'Kode karung'}</div>
                  <div className="text-2xl font-bold font-mono">{scanned.code}</div>
                </div>
                <button type="button" onClick={() => setScanned(null)} className="text-sm text-[#5A687C] underline min-h-[40px]">Batal</button>
              </div>
              <label htmlFor="berat" className="text-[15px] font-medium">Berat karung (kg)</label>
              <WeightInput id="berat" ref={weightRef} value={weight} onChange={setWeight}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveBag(); } }}
                placeholder="0,0" className="h-16 text-[32px] font-bold text-center" />
              <button type="button" onClick={saveBag} className={primaryBtn}><Check className="w-6 h-6" /> Simpan</button>
            </div>
          ) : textRead ? (
            <KodeConfirm result={textRead} mode="new" sessionId={sessionIdRef.current}
              onAccept={(c) => { setTextRead(null); handleCode(c); }}
              onRetake={() => { setTextRead(null); setScanning(true); }} />
          ) : (
            <>
              {scanning && <BarcodeScanner onDetect={(c) => handleCode(c)} onText={(r) => { setScanning(false); setTextRead(r); }} />}
              <button type="button" onClick={() => { setErrorMsg(null); setScanning(s => !s); }} disabled={checking}
                className="min-h-[64px] rounded-xl bg-[#117956] text-white text-xl font-bold flex items-center justify-center gap-2.5 disabled:opacity-60">
                {checking ? <Loader2 className="w-6 h-6 animate-spin" /> : <ScanLine className="w-[26px] h-[26px]" />}
                {checking ? 'Mengecek kode…' : scanning ? 'Tutup Kamera' : 'Scan Karung'}
              </button>
              {manualOpen ? (
                <div className={`${card} p-3 flex gap-2`}>
                  <input autoFocus value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Ketik kode di label"
                    onKeyDown={(e) => { if (e.key === 'Enter') { handleCode(manualCode); setManualCode(''); setManualOpen(false); } }}
                    className="flex-1 min-w-0 h-12 border border-[#CBD5E1] rounded-[10px] px-3 text-lg font-mono font-bold" />
                  <button type="button" onClick={() => { handleCode(manualCode); setManualCode(''); setManualOpen(false); }} className="h-12 px-4 rounded-[10px] bg-[#117956] text-white font-bold">OK</button>
                </div>
              ) : (
                <div className="flex justify-between gap-2">
                  <button type="button" onClick={() => { setScanning(false); setManualOpen(true); }} className="min-h-[40px] text-sm font-medium text-[#117956] flex items-center gap-1.5"><Keyboard className="w-4 h-4" /> Ketik kode manual</button>
                  <button type="button" onClick={() => { setScanning(false); useAutoCode(); }} className="min-h-[40px] text-sm font-medium text-[#5A687C] flex items-center gap-1.5"><Tag className="w-4 h-4" /> Karung tanpa label</button>
                </div>
              )}
            </>
          )}

          <div className="text-[13px] text-[#5A687C] text-center">
            {saveState === 'saving' ? 'Menyimpan…' : saveState === 'error' ? <span className="text-red-600">Gagal tersimpan. Cek sinyal, scan berikutnya akan mencoba lagi.</span> : staged.length ? 'Tersimpan otomatis. Aman kalau HP mati.' : ''}
          </div>

          {staged.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#EEF2F6]">
                <span className={sectionLabel}>Terakhir disimpan</span>
                <button type="button" onClick={undoLast} className="text-sm font-medium text-[#DC2828] min-h-[36px]">Batalkan terakhir</button>
              </div>
              {staged.slice(-5).reverse().map(it => (
                <div key={it._id} className="flex items-center justify-between px-3.5 py-2 border-b border-[#EEF2F6] last:border-0 text-[15px]">
                  <span className="font-mono">{it.kodeSimpan}</span>
                  <span className="text-[#5A687C] truncate mx-3 text-sm flex-1">{it.productName}</span>
                  <b>{kg(it.weight)} kg</b>
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={() => { setScanning(false); setScanned(null); setScreen('confirm'); }} disabled={!staged.length}
            className="min-h-[56px] rounded-xl border-2 border-[#117956] bg-white text-[#117956] text-lg font-bold mt-auto disabled:opacity-40">Selesai &amp; Masukkan ke Stok</button>
        </div>
      )}

      {/* ===== Cek sebelum masuk stok ===== */}
      {screen === 'confirm' && (
        <div className="flex-1 p-4 flex flex-col gap-3.5">
          <div className={`${card} overflow-hidden`}>
            <Row label="Sumber" value={refType === 'MANUAL' ? 'Lainnya' : refNumber} mono />
            <Row label="Gudang" value={`${csObj?.code || '-'}${zoneObj ? ` · Zona ${zoneObj.code}` : ''}`} />
            {byProduct.map(p => (
              <Row key={p.name} label={p.name} value={`${p.count} karung · ${kg(p.kg)} kg`} />
            ))}
            <Row label="Kadaluarsa" value={[...new Set(byProduct.flatMap(p => [...p.exp]))].map(e => dmy(parseYmd(e))).join(', ') || '-'} />
            <div className="flex justify-between px-4 py-3.5 bg-[#F8FAFC] text-lg font-bold"><span>Total</span><span>{staged.length} karung · {kg(totalKg)} kg</span></div>
          </div>
          {refType === 'PO' && (
            <label className="flex items-start gap-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3.5 py-3 cursor-pointer">
              <input type="checkbox" checked={markTallyDone} onChange={(e) => setMarkTallyDone(e.target.checked)} className="w-6 h-6 mt-0.5 accent-[#117956] shrink-0" />
              <span className="text-[15px]"><b>Semua barang PO ini sudah datang</b><br /><span className="text-[#5A687C] text-sm">PO tidak muncul lagi di pilihan tally</span></span>
            </label>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="catatan" className="text-[15px] font-medium">Catatan (opsional)</label>
            <textarea id="catatan" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="border border-[#CBD5E1] rounded-[10px] p-3 text-base bg-white" />
          </div>
          <div className="mt-auto flex flex-col gap-2.5">
            <button type="button" onClick={finalize} disabled={finalizing} className={primaryBtn}>
              {finalizing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-6 h-6" />} Masukkan ke Stok
            </button>
            <button type="button" onClick={() => setScreen('scan')} className={outlineBtn}>Kembali scan</button>
          </div>
        </div>
      )}

      {/* ===== Selesai ===== */}
      {screen === 'done' && lastSaved && (
        <div className="flex-1 p-4 pt-6 flex flex-col gap-3.5">
          <div className={`${card} px-4 py-7 flex flex-col items-center text-center gap-2.5`}>
            <div className="w-[72px] h-[72px] rounded-full bg-[#EDF8F3] flex items-center justify-center"><Check className="w-10 h-10 text-[#117956]" strokeWidth={2.5} /></div>
            <div className="text-[22px] font-bold">Masuk stok</div>
            <div className="text-[15px] text-[#5A687C]">{lastSaved.refNumber || 'Lainnya'} · {lastSaved.csCode}</div>
            <div className="grid grid-cols-2 w-full border-t border-[#EEF2F6] mt-1.5 pt-3">
              <div><div className="text-[13px] text-[#5A687C]">Karung</div><div className="text-2xl font-bold">{lastSaved.items.length}</div></div>
              <div><div className="text-[13px] text-[#5A687C]">Total berat</div><div className="text-2xl font-bold">{kg(lastSaved.totalWeight)} <span className="text-sm font-medium text-[#5A687C]">kg</span></div></div>
            </div>
            <div className="text-sm text-[#5A687C]">Barang sudah siap dijual.</div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={downloadPDF} className={outlineBtn}><FileText className="w-5 h-5" /> Berita Acara (PDF)</button>
            <button type="button" onClick={downloadCSV} className={outlineBtn}><Download className="w-5 h-5" /> CSV</button>
          </div>
          <div className="mt-auto flex flex-col gap-2.5">
            <button type="button" onClick={resetAll} className={primaryBtn}>Tally berikutnya</button>
            <Link href="/tally" className={outlineBtn}>Kembali ke beranda</Link>
          </div>
        </div>
      )}
      {pdfPreview.element}
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-3.5 border-b border-[#EEF2F6] text-base">
      <span className="text-[#5A687C]">{label}</span>
      <b className={`text-right ${mono ? 'font-mono' : ''}`}>{value}</b>
    </div>
  );
}

// Kartu pilihan PO/WO: ketuk kiri untuk memilih, panah kanan untuk melihat detail
function RefOption({ refType, row, products, selected, open, onPick, onToggle }) {
  const isPO = refType === 'PO';
  const { data } = useSWR(open ? `/api/${isPO ? 'purchase-orders' : 'work-orders'}/${row.id}` : null, fetcher);
  const detail = data?.data;
  const no = isPO ? row.poNumber : row.woNumber;
  const date = isPO ? (row.expectedDate || row.orderDate) : row.startDate;
  const sub = isPO
    ? [row.supplier?.name || row.supplier?.code, date ? format(new Date(date), 'dd MMM') : null].filter(Boolean).join(' · ')
    : [row.mode || row.productionType, date ? format(new Date(date), 'dd MMM') : null].filter(Boolean).join(' · ');
  const pname = (id, p) => p?.name || products.find(x => x.id === id)?.name || '-';
  const lines = detail ? (isPO ? (detail.items || []) : (detail.outputs || [])) : [];
  return (
    <div className={`w-full rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,41,0.06)] ${selected ? 'bg-[#EDF8F3] border-2 border-[#117956]' : 'bg-white border border-[#DFE5EC]'}`}>
      <div className="flex items-stretch">
        <button type="button" onClick={onPick} aria-pressed={selected} className="flex items-center gap-3 flex-1 min-h-[68px] py-3 pl-3.5 pr-1 text-left min-w-0">
          <span className={`w-[22px] h-[22px] rounded-full shrink-0 box-border bg-white ${selected ? 'border-[7px] border-[#117956]' : 'border-2 border-[#94A3B8]'}`} />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[17px] font-bold font-mono truncate">{no}</span>
            <span className="text-sm text-[#5A687C] truncate">{sub || '-'}</span>
          </span>
        </button>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Tutup' : 'Lihat'} detail ${no}`}
          className="w-[52px] shrink-0 border-l border-[#EEF2F6] flex items-center justify-center text-[#5A687C]">
          <ChevronDown className={`w-[22px] h-[22px] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="border-t border-[#DFE5EC] bg-white px-3.5 pt-2.5 pb-3 flex flex-col gap-1.5">
          {!detail && <div className="text-sm text-[#5A687C] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Memuat…</div>}
          {detail && (
            <>
              {isPO ? (
                <>
                  <Info k="Supplier" v={detail.supplier?.displayName || detail.supplier?.name || row.supplier?.name || '-'} />
                  <Info k="Tanggal order" v={detail.orderDate ? format(new Date(detail.orderDate), 'dd/MM/yy') : '-'} />
                  {detail.expectedDate && <Info k="Tanggal datang" v={format(new Date(detail.expectedDate), 'dd/MM/yy')} />}
                </>
              ) : (
                <>
                  <Info k="Mulai produksi" v={detail.startDate ? format(new Date(detail.startDate), 'dd/MM/yy') : '-'} />
                  <Info k="Status" v={detail.pipelineStatus || '-'} />
                </>
              )}
              <div className="text-xs font-medium tracking-[0.06em] uppercase text-[#5A687C] mt-1">Barang</div>
              {lines.length === 0 && <div className="text-sm text-[#5A687C]">Belum ada barang</div>}
              {lines.map((it, i) => {
                const w = isPO ? (Number(it.receivedWeight || 0) || Number(it.weight || 0)) : Number(it.weight || it.actualWeight || 0);
                return (
                  <div key={it.id || i} className="flex justify-between gap-2.5 text-[15px] px-2.5 py-1.5 bg-[#F8FAFC] rounded-lg">
                    <span className="truncate">{pname(it.productId, it.product)}</span>
                    <b className="shrink-0">{w ? `${kg(w)} kg` : '-'}</b>
                  </div>
                );
              })}
              {isPO && <div className="text-xs text-[#5A687C]">Berat menurut surat jalan (kalau sudah ada)</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ k, v }) {
  return (
    <div className="flex justify-between gap-2.5 text-sm">
      <span className="text-[#5A687C]">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}
