'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/auth/auth-client';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { KodeConfirm } from '@/components/kode-confirm';
import { WeightInput } from '@/components/ui/weight-input';
import { ArrowLeft, ArrowUpFromLine, ChevronRight, Loader2, ScanLine, Keyboard, ListChecks, Check, AlertCircle, Search, X, Snowflake, Scale } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const card = 'bg-white border border-[#DFE5EC] rounded-[14px] shadow-[0_1px_2px_rgba(15,23,41,0.06)]';
const sectionLabel = 'text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C]';
const smallBtn = 'min-h-[36px] px-3 rounded-lg border border-[#CBD5E1] bg-white text-[#0F1729] text-sm font-medium shrink-0';
const ORANGE = '#C2410C';
// Toleransi "Cukup": boleh lebih sampai 3 kg dari pesanan (karung utuh jarang pas)
const OVER_TOLERANCE_KG = 3;

export default function TallyOutboundPage() {
  const { data: session } = useSession();
  const [selectedSo, setSelectedSo] = useState(null);
  const [done, setDone] = useState(null);
  const screen = done ? 'done' : selectedSo ? 'scan' : 'pick';
  // Dibuka dari "Belum selesai" di Beranda Tally: /tally/outbound?so=<id>
  const searchParams = useSearchParams();
  const soParam = searchParams.get('so');
  useEffect(() => { if (soParam) setSelectedSo(soParam); }, [soParam]);

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-[#F1F5F9] text-[#0F1729]" style={{ fontFamily: 'Roboto, system-ui, sans-serif' }}>
      <div className="bg-white border-b border-[#DFE5EC] px-4 py-3 flex flex-col gap-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          {screen === 'scan' ? (
            <button type="button" onClick={() => setSelectedSo(null)} aria-label="Kembali ke daftar pesanan" className="w-10 h-10 flex items-center justify-center rounded-[10px]"><ArrowLeft className="w-[22px] h-[22px]" /></button>
          ) : (
            <Link href="/tally" aria-label="Kembali ke beranda" className="w-10 h-10 flex items-center justify-center rounded-[10px] text-[#0F1729]"><ArrowLeft className="w-[22px] h-[22px]" /></Link>
          )}
          <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-orange-400 to-orange-700 flex items-center justify-center text-white"><ArrowUpFromLine className="w-[22px] h-[22px]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold">Barang Keluar</div>
            <div className="text-[13px] text-[#5A687C] truncate">{screen === 'done' ? 'Selesai' : screen === 'pick' ? 'Langkah 1 dari 2 · Pesanan' : 'Langkah 2 dari 2 · Scan'}</div>
          </div>
        </div>
        {screen !== 'done' && (
          <div className="grid grid-cols-2 gap-1.5">
            {['Pesanan', 'Scan'].map((n, i) => {
              const on = i === 0 || screen === 'scan';
              return (
                <div key={n} className="flex flex-col gap-1">
                  <div className="h-1 rounded-full" style={{ background: on ? ORANGE : '#E2E8F0' }} />
                  <div className={`text-xs font-medium ${on ? 'text-[#0F1729]' : 'text-[#94A3B8]'}`}>{n}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {screen === 'pick' && <OrderList onSelect={setSelectedSo} />}
      {screen === 'scan' && <OrderScan soId={selectedSo} operator={session?.user?.name} onDone={(d) => { setDone(d); setSelectedSo(null); }} />}
      {screen === 'done' && (
        <div className="flex-1 p-4 pt-6 flex flex-col gap-3.5">
          <div className={`${card} px-4 py-7 flex flex-col items-center text-center gap-2.5`}>
            <div className="w-[72px] h-[72px] rounded-full bg-[#EDF8F3] flex items-center justify-center"><Check className="w-10 h-10 text-[#117956]" strokeWidth={2.5} /></div>
            <div className="text-[22px] font-bold">{done.complete ? 'Siap dikirim' : 'Tersimpan'}</div>
            <div className="text-[15px] text-[#5A687C]">{done.customerName} · {done.soNumber}</div>
            <div className="grid grid-cols-2 w-full border-t border-[#EEF2F6] mt-1.5 pt-3">
              <div><div className="text-[13px] text-[#5A687C]">Karung</div><div className="text-2xl font-bold">{done.bags}</div></div>
              <div><div className="text-[13px] text-[#5A687C]">Total berat</div><div className="text-2xl font-bold">{kg(done.kg)} <span className="text-sm font-medium text-[#5A687C]">kg</span></div></div>
            </div>
            <div className="text-sm text-[#5A687C]">{done.complete ? 'Karung sudah dikunci untuk pesanan ini.' : 'Karung sudah dikunci. Pesanan belum lengkap, bisa dilanjutkan nanti.'}</div>
            {done.reweigh?.length > 0 && (
              <div className="w-full mt-1 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3.5 py-3 text-left text-sm">
                <b>{done.reweigh.reduce((a, o) => a + o.count, 0)} karung ditimbang ulang</b>, menunggu persetujuan admin
                ({done.reweigh.map(o => o.opnameNumber).join(', ')}). Berat & tagihan berubah setelah disetujui.
              </div>
            )}
          </div>
          <div className="mt-auto flex flex-col gap-2.5">
            <button type="button" onClick={() => setDone(null)} className="min-h-[56px] rounded-xl text-white text-lg font-bold" style={{ background: ORANGE }}>Pesanan berikutnya</button>
            <Link href="/tally" className="min-h-[52px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium flex items-center justify-center">Kembali ke beranda</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderList({ onSelect }) {
  const { data, isLoading } = useSWR('/api/tally-outbound/orders', fetcher, { refreshInterval: 15000 });
  const rows = data?.data || [];
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  return (
    <div className="flex-1 p-4 flex flex-col gap-2.5">
      <div className={sectionLabel}>Pesanan siap kirim ({rows.length})</div>
      {isLoading && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
      {!isLoading && rows.length === 0 && (
        <div className={`${card} p-5 text-center text-sm text-[#5A687C]`}>Belum ada pesanan. SO baru (Draft, dari stok gudang) akan muncul di sini.</div>
      )}
      {rows.map(so => {
        const d = so.orderDate ? new Date(so.orderDate) : null;
        const isToday = d && format(d, 'yyyy-MM-dd') === todayKey;
        return (
          <button key={so.id} type="button" onClick={() => onSelect(so.id)} className={`${card} text-left px-4 py-3.5 flex items-center gap-3`}>
            <span className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-[17px] font-bold truncate">{so.customerName}</span>
                {d && <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${isToday ? 'bg-[#FFF4EC] text-[#C2410C]' : 'bg-[#F1F5F9] text-[#5A687C]'}`}>{isToday ? 'hari ini' : format(d, 'dd MMM')}</span>}
              </span>
              <span className="text-sm text-[#5A687C] font-mono">{so.soNumber}</span>
              <span className="text-sm">
                {so.itemCount} produk · {kg(so.totalWeight)} kg
                {so.allocatedItemCount > 0 && <span className="text-[#117956]"> · {so.allocatedItemCount}/{so.itemCount} selesai</span>}
                {so.draftItemCount > 0 && <span className="text-[#C2410C]"> · sedang di-scan</span>}
              </span>
            </span>
            <ChevronRight className="w-[22px] h-[22px] text-[#5A687C] shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function OrderScan({ soId, onDone }) {
  const { data, isLoading, mutate } = useSWR(`/api/tally-outbound/orders/${soId}`, fetcher, { revalidateOnFocus: false });
  const so = data?.data;
  // bags: { [itemId]: [{ stockId, code, weight, loc }] } — urutan scan disimpan di `order`
  const [bags, setBags] = useState(null);
  const [order, setOrder] = useState([]); // [{ itemId, stockId }]
  const [result, setResult] = useState(null); // { ok, title, text }
  const [scanning, setScanning] = useState(true);
  const [textRead, setTextRead] = useState(null); // hasil baca tulisan spidol, menunggu konfirmasi
  const [checking, setChecking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const saveChain = useRef(Promise.resolve());
  const bagsRef = useRef(null);
  // Timbang ulang: { [stockId]: beratBaru } — disimpan di HP sampai SO disimpan (lalu jadi Stock Opname)
  const rwKey = `tallyOutRw:${soId}`;
  const [rwMap, setRwMap] = useState(() => { try { return JSON.parse(localStorage.getItem(rwKey) || '{}'); } catch { return {}; } });
  const [rwOpen, setRwOpen] = useState(false);
  const [rwInput, setRwInput] = useState(0);
  const setRw = (next) => { setRwMap(next); try { localStorage.setItem(rwKey, JSON.stringify(next)); } catch {} };

  useEffect(() => {
    if (!so || bags) return;
    const init = {};
    const ord = [];
    for (const it of so.items || []) {
      init[it.id] = (it.allocations || []).map(a => ({ stockId: a.stockId, code: a.kodeSimpan, weight: Number(a.weight || 0), loc: null }));
      for (const a of it.allocations || []) ord.push({ itemId: it.id, stockId: a.stockId });
    }
    bagsRef.current = init;
    setBags(init);
    setOrder(ord);
  }, [so, bags]);

  const items = so?.items || [];
  const lines = items.map(it => {
    const mine = (bags && bags[it.id]) || [];
    const got = mine.reduce((a, b) => a + Number(rwMap[b.stockId] ?? b.weight), 0);
    const need = Number(it.orderedWeight || 0);
    const diff = got - need;
    let status, color, bar;
    if (!mine.length) { status = 'Belum ada'; color = '#5A687C'; bar = '#CBD5E1'; }
    else if (diff < -0.05) { status = `Kurang ${kg(-diff)} kg`; color = ORANGE; bar = '#F97316'; }
    else if (diff <= OVER_TOLERANCE_KG) { status = 'Cukup'; color = '#117956'; bar = '#117956'; }
    else { status = `Lebih ${kg(diff)} kg`; color = '#92400E'; bar = '#D97706'; }
    return { ...it, mine, got, need, status, color, bar, pct: need > 0 ? Math.min(100, Math.round((got / need) * 100)) : 0, ok: got >= need - 0.05 };
  });
  const allOk = lines.length > 0 && lines.every(l => l.ok);
  const lastOrd = order[order.length - 1];
  const lastBag = lastOrd && bags ? (bags[lastOrd.itemId] || []).find(b => b.stockId === lastOrd.stockId) : null;
  const totalBags = lines.reduce((a, l) => a + l.mine.length, 0);
  const totalKg = lines.reduce((a, l) => a + l.got, 0);

  // Simpan sementara (draft, stok belum dikunci) per item — berantai agar urut
  const saveDraft = (itemId) => {
    const stockIds = (bagsRef.current[itemId] || []).map(b => b.stockId);
    const run = async () => {
      setSaveState('saving');
      const res = await fetch(`/api/tally-outbound/orders/${soId}/items/${itemId}/allocate`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockIds, mode: 'draft' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan');
      setSaveState('saved');
    };
    const p = saveChain.current.then(run, run);
    saveChain.current = p.catch((e) => { setSaveState('error'); toast.error(e.message); });
    return p;
  };

  const addBag = (itemId, bag, title) => {
    const next = { ...bagsRef.current, [itemId]: [...(bagsRef.current[itemId] || []), bag] };
    bagsRef.current = next;
    setBags(next);
    setOrder(o => [...o, { itemId, stockId: bag.stockId }]);
    setResult({ ok: true, title, text: `${bag.productName} · ${kg(bag.weight)} kg${bag.loc ? ` · ${bag.loc}` : ''}` });
    saveDraft(itemId);
  };

  const handleCode = async (raw) => {
    const code = String(raw || '').trim();
    if (!code || !bagsRef.current) return;
    for (const list of Object.values(bagsRef.current)) {
      if (list.some(b => b.code === code)) { setResult({ ok: false, title: 'Sudah di-scan', text: `${code} sudah ada di pesanan ini.` }); return; }
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/tally-outbound/orders/${soId}/scan?code=${encodeURIComponent(code)}`, { credentials: 'include' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal cek kode');
      const r = j.data;
      if (!r.ok) {
        const titles = { not_found: 'Kode tidak dikenal', wrong_product: 'Produk salah', allocated: 'Karung sudah dipakai', inactive: 'Karung tidak tersedia' };
        setResult({ ok: false, title: titles[r.reason] || 'Ditolak', text: r.message });
        try { navigator.vibrate?.([120, 80, 120]); } catch {}
        return;
      }
      const loc = [r.csCode, r.zoneCode ? `Zona ${r.zoneCode}` : null].filter(Boolean).join(' · ');
      addBag(r.itemId, { stockId: r.stockId, code: r.code, weight: Number(r.weight || 0), productName: r.productName, loc }, `Masuk: ${r.code}`);
    } catch (e) {
      setResult({ ok: false, title: 'Gagal', text: e.message });
    } finally { setChecking(false); }
  };

  const undo = () => {
    const last = order[order.length - 1];
    if (!last) return;
    const list = bagsRef.current[last.itemId] || [];
    const bag = list.find(b => b.stockId === last.stockId);
    const next = { ...bagsRef.current, [last.itemId]: list.filter(b => b.stockId !== last.stockId) };
    bagsRef.current = next;
    setBags(next);
    setOrder(o => o.slice(0, -1));
    if (rwMap[last.stockId] !== undefined) { const n = { ...rwMap }; delete n[last.stockId]; setRw(n); }
    setRwOpen(false);
    setResult({ ok: false, title: 'Dibatalkan', text: `${bag?.code || 'Karung'} dikeluarkan dari daftar.` });
    saveDraft(last.itemId);
  };

  const save = async () => {
    if (!totalBags) return;
    if (!allOk && !confirm('Pesanan belum lengkap. Tetap simpan dan kunci karung yang sudah di-scan?')) return;
    const over = lines.filter(l => l.mine.length && l.got - l.need > OVER_TOLERANCE_KG);
    if (allOk && over.length && !confirm(`${over.map(l => `${l.productName} lebih ${kg(l.got - l.need)} kg`).join(', ')} dari pesanan. Tetap simpan?`)) return;
    setSaving(true);
    try {
      await saveChain.current;
      for (const l of lines) {
        if (!l.mine.length) continue;
        const res = await fetch(`/api/tally-outbound/orders/${soId}/items/${l.id}/allocate`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stockIds: l.mine.map(b => b.stockId), mode: 'final' }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${l.productName}: ${j.error || 'Gagal menyimpan'}`);
      }
      const rwItems = lines.flatMap(l => l.mine.filter(b => rwMap[b.stockId] !== undefined && Math.abs(Number(rwMap[b.stockId]) - b.weight) >= 0.01)
        .map(b => ({ stockId: b.stockId, weight: Number(rwMap[b.stockId]) })));
      let reweigh = [];
      if (rwItems.length) {
        const res = await fetch(`/api/tally-outbound/orders/${soId}/reweigh`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: rwItems }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Karung sudah dikunci, tapi timbang ulang gagal dikirim: ${j.error || 'error'}. Tekan Simpan lagi.`);
        reweigh = j.data?.opnames || [];
      }
      try { localStorage.removeItem(rwKey); } catch {}
      mutate();
      onDone({ soNumber: so.soNumber, customerName: so.customerName, bags: totalBags, kg: totalKg, complete: allOk, reweigh });
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  if (isLoading || !so || !bags) return <div className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  return (
    <div className="flex-1 p-4 flex flex-col gap-3">
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-[#EEF2F6]">
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold truncate">{so.customerName}</div>
            <div className="text-[13px] text-[#5A687C] font-mono">{so.soNumber}</div>
          </div>
        </div>
        {lines.map(l => (
          <div key={l.id} className="px-3.5 py-2.5 flex flex-col gap-1.5 border-b border-[#EEF2F6] last:border-0">
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[15px] font-medium truncate">{l.productName}</span>
              <span className="text-sm text-[#5A687C] shrink-0"><b className="text-[#0F1729]">{kg(l.got)}</b> / {kg(l.need)} kg</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#EEF2F6] overflow-hidden"><div className="h-1.5 rounded-full" style={{ width: `${l.pct}%`, background: l.bar }} /></div>
            <div className="text-[13px] font-medium" style={{ color: l.color }}>{l.status} · {l.mine.length} karung</div>
          </div>
        ))}
      </div>

      {result && (
        <div role="status" className={`rounded-xl px-3.5 py-3 flex gap-2.5 items-start border ${result.ok ? 'bg-[#EDF8F3] border-[#B7E4CF] text-[#0D6346]' : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'}`}>
          {result.ok ? <Check className="w-[22px] h-[22px] shrink-0" /> : <AlertCircle className="w-[22px] h-[22px] shrink-0 text-[#DC2828]" />}
          <div className="flex-1">
            <div className="text-base font-bold">{result.title}</div>
            <div className="text-[15px]">{result.text}</div>
            {result.ok && lastBag && !rwOpen && (
              <button type="button" onClick={() => { setScanning(false); setRwInput(rwMap[lastBag.stockId] ?? 0); setRwOpen(true); }}
                className="mt-2 min-h-[36px] px-3 rounded-lg border border-[#B7E4CF] bg-white text-[#0D6346] text-sm font-medium inline-flex items-center gap-1.5">
                <Scale className="w-4 h-4" /> Timbang ulang
              </button>
            )}
          </div>
        </div>
      )}

      {rwOpen && lastBag && (
        <div className={`${card} p-4 flex flex-col gap-2.5`}>
          <label htmlFor="rw" className="text-[15px] font-medium">Berat timbang ulang {lastBag.code} (kg)</label>
          <div className="text-[13px] text-[#5A687C]">Berat saat masuk: {kg(lastBag.weight)} kg. Berat baru berlaku setelah disetujui admin.</div>
          <WeightInput id="rw" value={rwInput} onChange={setRwInput} placeholder="0,0" className="h-[60px] text-[28px] font-bold text-center" autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setRwOpen(false)} className="min-h-[52px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium">Batal</button>
            <button type="button" onClick={() => {
              const w = Number(rwInput || 0);
              if (!(w > 0)) { toast.error('Isi berat baru'); return; }
              const next = { ...rwMap };
              if (Math.abs(w - lastBag.weight) < 0.01) delete next[lastBag.stockId]; else next[lastBag.stockId] = w;
              setRw(next);
              setRwOpen(false);
              const d = lastBag.weight - w;
              setResult({ ok: true, title: `Berat dicatat: ${lastBag.code}`, text: `${kg(lastBag.weight)} → ${kg(w)} kg${d > 0 ? ` (susut ${kg(d)} kg)` : ''} · menunggu persetujuan admin` });
            }} className="min-h-[52px] rounded-xl text-white text-base font-bold" style={{ background: ORANGE }}>Pakai berat ini</button>
          </div>
        </div>
      )}

      {textRead && (
        <KodeConfirm result={textRead} mode="stock" accent={ORANGE}
          onAccept={(c) => { setTextRead(null); setScanning(true); handleCode(c); }}
          onRetake={() => { setTextRead(null); setScanning(true); }} />
      )}
      {scanning && !textRead && <BarcodeScanner continuous accent="#FB923C" height={170} onDetect={handleCode} onText={(r) => { setScanning(false); setTextRead(r); }} />}
      {!textRead && (
        <button type="button" onClick={() => setScanning(s => !s)} className="min-h-[60px] rounded-xl text-white text-xl font-bold flex items-center justify-center gap-2.5" style={{ background: ORANGE }}>
          {checking ? <Loader2 className="w-6 h-6 animate-spin" /> : <ScanLine className="w-[26px] h-[26px]" />}
          {scanning ? 'Tutup Kamera' : 'Scan Karung'}
        </button>
      )}
      {scanning && <div className="text-[13px] text-[#5A687C] text-center -mt-1">Kamera tetap menyala. Scan karung satu per satu.</div>}

      {manualOpen ? (
        <div className={`${card} p-3 flex gap-2`}>
          <input autoFocus value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Ketik kode di label"
            onKeyDown={(e) => { if (e.key === 'Enter') { handleCode(manualCode); setManualCode(''); setManualOpen(false); } }}
            className="flex-1 min-w-0 h-12 border border-[#CBD5E1] rounded-[10px] px-3 text-lg font-mono font-bold" />
          <button type="button" onClick={() => { handleCode(manualCode); setManualCode(''); setManualOpen(false); }} className="h-12 px-4 rounded-[10px] text-white font-bold" style={{ background: ORANGE }}>OK</button>
        </div>
      ) : (
        <div className="flex justify-between gap-2">
          <button type="button" onClick={undo} disabled={!order.length} className="min-h-[40px] text-sm font-medium text-[#DC2828] disabled:opacity-40">Batalkan karung terakhir</button>
          <button type="button" onClick={() => setManualOpen(true)} className="min-h-[40px] text-sm font-medium flex items-center gap-1.5" style={{ color: ORANGE }}><Keyboard className="w-4 h-4" /> Ketik kode manual</button>
        </div>
      )}
      <button type="button" onClick={() => { setScanning(false); setPickerOpen(true); }} className="min-h-[46px] rounded-xl border border-dashed border-[#FDBA74] bg-[#FFF7ED] text-[#9A3412] text-[15px] font-medium flex items-center justify-center gap-2">
        <ListChecks className="w-4 h-4" /> Barcode rusak: pilih karung dari daftar
      </button>

      <div className="text-[13px] text-[#5A687C] text-center">
        {saveState === 'saving' ? 'Menyimpan…' : saveState === 'error' ? <span className="text-red-600">Gagal tersimpan. Cek sinyal.</span> : totalBags ? 'Tersimpan otomatis. Karung dikunci saat tombol di bawah ditekan.' : ''}
      </div>

      <button type="button" onClick={save} disabled={saving || !totalBags}
        className={`min-h-[56px] rounded-xl text-[17px] font-bold mt-auto flex items-center justify-center gap-2 disabled:opacity-50 ${allOk ? 'bg-[#117956] text-white' : 'border border-[#CBD5E1] bg-white text-[#5A687C]'}`}>
        {saving && <Loader2 className="w-5 h-5 animate-spin" />}
        {allOk ? 'Simpan & Kunci Karung' : 'Simpan (pesanan belum lengkap)'}
      </button>

      {pickerOpen && (
        <StockPicker soId={soId} lines={lines} onClose={() => setPickerOpen(false)}
          onPick={(itemId, st, productName) => {
            setPickerOpen(false);
            const loc = [st.csCode, st.zoneCode ? `Zona ${st.zoneCode}` : null].filter(Boolean).join(' · ');
            addBag(itemId, { stockId: st.id, code: st.kodeSimpan, weight: Number(st.weight || 0), productName, loc }, `Masuk: ${st.kodeSimpan}`);
          }} />
      )}
    </div>
  );
}

// Cadangan bila barcode rusak: pilih produk, lalu pilih karung dari daftar stok
function StockPicker({ soId, lines, onClose, onPick }) {
  const [itemId, setItemId] = useState(lines.find(l => !l.ok)?.id || lines[0]?.id);
  const [q, setQ] = useState('');
  const line = lines.find(l => l.id === itemId);
  const { data, isLoading } = useSWR(itemId ? `/api/tally-outbound/orders/${soId}/items/${itemId}/stocks` : null, fetcher, { revalidateOnFocus: false });
  const taken = useMemo(() => new Set(lines.flatMap(l => l.mine.map(b => b.stockId))), [lines]);
  const stocks = (data?.data?.stocks || []).filter(st => !taken.has(st.id));
  const term = q.trim().toLowerCase();
  const shown = term ? stocks.filter(st => (st.kodeSimpan || '').toLowerCase().includes(term) || String(st.weight).includes(term.replace(',', '.'))) : stocks;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Pilih karung dari daftar" className="w-full max-w-md bg-[#F1F5F9] rounded-t-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-t-2xl border-b border-[#DFE5EC]">
          <div className="flex-1 text-[17px] font-bold">Pilih karung</div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="w-10 h-10 flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3 flex flex-col gap-2.5 bg-white border-b border-[#DFE5EC]">
          {lines.length > 1 && (
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-12 w-full border border-[#CBD5E1] rounded-[10px] text-base font-medium px-3 bg-white">
              {lines.map(l => <option key={l.id} value={l.id}>{l.productName} ({l.status})</option>)}
            </select>
          )}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5A687C]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode / berat" className="h-11 w-full border border-[#CBD5E1] rounded-[10px] pl-9 pr-3 text-base" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {isLoading && <div className="text-center py-6"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
          {!isLoading && shown.length === 0 && <div className="text-center text-sm text-[#5A687C] py-6">Tidak ada karung tersedia.</div>}
          {shown.map(st => (
            <button key={st.id} type="button" onClick={() => onPick(itemId, st, line?.productName)} className={`${card} text-left px-3.5 py-3 flex items-center justify-between gap-2`}>
              <span className="min-w-0">
                <span className="block font-mono font-bold">{st.kodeSimpan}</span>
                <span className="text-[13px] text-[#5A687C] flex items-center gap-2">
                  {st.csCode && <span className="inline-flex items-center gap-0.5"><Snowflake className="w-3 h-3" />{st.csCode}{st.zoneCode ? `/${st.zoneCode}` : ''}</span>}
                  {st.expiredDate && <span>ED {format(new Date(st.expiredDate), 'dd/MM/yy')}</span>}
                </span>
              </span>
              <b className="shrink-0">{kg(st.weight)} kg</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
