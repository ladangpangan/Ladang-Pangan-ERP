'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { WeightInput } from '@/components/ui/weight-input';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { KodeConfirm } from '@/components/kode-confirm';
import { ArrowLeft, ClipboardCheck, ScanLine, Check, AlertCircle, Loader2, Keyboard, Trash2 } from 'lucide-react';

const fetcher = (url) => fetch(url, { credentials: 'include' }).then(r => r.json());
const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dmy = (d) => { if (!d) return '-'; const t = new Date(d); return isNaN(t.getTime()) ? '-' : format(t, 'dd/MM/yy'); };
const BLUE = '#1D4ED8';
const card = 'bg-white border border-[#DFE5EC] rounded-[14px] shadow-[0_1px_2px_rgba(15,23,41,0.06)]';
const selectCls = 'h-[52px] w-full border border-[#CBD5E1] rounded-[10px] text-[17px] font-medium px-3 bg-white text-[#0F1729]';
const sectionLabel = 'text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C]';
const STEP_NAMES = ['Lokasi', 'Hitung', 'Cek'];

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Gagal');
  return j.data;
};

export default function TallyOpnamePage() {
  const { data: csData } = useSWR('/api/cold-storages', fetcher);
  const coldStorages = csData?.data || [];
  const { data: activeData, mutate: mutateActive } = useSWR('/api/opnames/tally/active', fetcher);
  const drafts = activeData?.data || [];

  const [screen, setScreen] = useState('setup'); // setup | scan | review | done
  const [csId, setCsId] = useState('');
  const [zoneId, setZoneId] = useState(''); // '' = semua zona
  const [op, setOp] = useState(null); // ringkasan opname aktif dari server
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [textRead, setTextRead] = useState(null); // hasil baca tulisan spidol, menunggu konfirmasi
  const [checking, setChecking] = useState(false);
  const [current, setCurrent] = useState(null); // hasil scan yang menunggu konfirmasi
  const [weighing, setWeighing] = useState(false);
  const [weight, setWeight] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);
  const [flash, setFlash] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [submitted, setSubmitted] = useState(null);

  useEffect(() => { if (!csId && coldStorages.length === 1) setCsId(coldStorages[0].id); }, [coldStorages, csId]);
  const { data: zoneData } = useSWR(csId ? `/api/cold-storages/${csId}` : null, fetcher);
  const zones = zoneData?.data?.zones || [];
  const { data: expData } = useSWR(csId ? `/api/opnames/tally/expected?${new URLSearchParams({ coldStorageId: csId, ...(zoneId ? { zoneId } : {}) })}` : null, fetcher);
  const { data: detailData, mutate: mutateDetail } = useSWR(screen === 'review' && op ? `/api/opnames/${op.id}` : null, fetcher);
  const zoneLabel = op ? (op.zoneCode ? `Zona ${op.zoneCode}` : 'Semua zona') : '';

  const start = async () => {
    if (!csId) return toast.error('Pilih gudang');
    setBusy(true);
    try { setOp(await post('/api/opnames/tally/start', { coldStorageId: csId, zoneId: zoneId || null })); setScreen('scan'); mutateActive(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const resume = (d) => { setOp(d); setCsId(d.coldStorageId); setZoneId(d.zoneId || ''); setScreen('scan'); };
  const removeDraft = async (d) => {
    if (!confirm(`Hapus opname ${d.opnameNumber}? Hitungan yang sudah di-scan ikut terhapus.`)) return;
    const res = await fetch(`/api/opnames/${d.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { toast.success('Dihapus'); mutateActive(); } else toast.error('Gagal menghapus');
  };

  const handleCode = async (raw) => {
    const code = String(raw || '').trim();
    if (!code || !op) return;
    setScanning(false); setErrorMsg(null); setFlash(null); setChecking(true);
    try {
      const r = await post(`/api/opnames/${op.id}/scan`, { code });
      if (!r.ok) { setErrorMsg(r.message); try { navigator.vibrate?.([120, 80, 120]); } catch {} return; }
      setCurrent(r); setWeighing(false); setWeight(0);
    } catch (e) { setErrorMsg(e.message); } finally { setChecking(false); }
  };
  const confirmCount = async (w) => {
    if (!current) return;
    setBusy(true);
    try {
      const v = await post(`/api/opnames/${op.id}/count`, { itemId: current.itemId, ...(w != null ? { weight: w } : {}) });
      setOp(v);
      const diff = w != null ? w - current.systemWeight : 0;
      setFlash(`Dihitung: ${current.code}${Math.abs(diff) >= 0.05 ? ` · ${kg(current.systemWeight)} → ${kg(w)} kg` : ''}`);
      setCurrent(null); setWeighing(false);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const undoLast = async () => {
    const last = op?.recent?.[0];
    if (!last) return;
    if (!confirm(`Batalkan hitungan ${last.kodeSimpan}?`)) return;
    try { setOp(await post(`/api/opnames/${op.id}/uncount`, { itemId: last.itemId })); setFlash(null); setErrorMsg(`${last.kodeSimpan} dibatalkan, belum dihitung.`); }
    catch (e) { toast.error(e.message); }
  };
  const submit = async () => {
    setBusy(true);
    try { await post(`/api/opnames/${op.id}/submit`, {}); setSubmitted(op); setScreen('done'); mutateActive(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  // Ringkasan untuk layar cek
  const review = useMemo(() => {
    const items = detailData?.data?.items || [];
    const counted = items.filter(i => !i.missing);
    const diff = counted.filter(i => Math.abs(Number(i.deltaWeight || 0)) >= 0.05);
    const moved = counted.filter(i => i.moved);
    const missing = items.filter(i => i.missing);
    const ok = counted.filter(i => Math.abs(Number(i.deltaWeight || 0)) < 0.05 && !i.moved);
    return { items, ok, diff, moved, missing, diffKg: diff.reduce((a, i) => a + Number(i.deltaWeight || 0), 0) };
  }, [detailData]);

  const stepIdx = screen === 'setup' ? 0 : screen === 'scan' ? 1 : 2;
  const expected = op?.expected || 0;
  const countedN = op?.counted || 0;

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col bg-[#F1F5F9] text-[#0F1729]" style={{ fontFamily: 'Roboto, system-ui, sans-serif' }}>
      <div className="bg-white border-b border-[#DFE5EC] px-4 py-3 flex flex-col gap-3 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/tally" aria-label="Kembali ke beranda" className="w-10 h-10 flex items-center justify-center rounded-[10px] text-[#0F1729]"><ArrowLeft className="w-[22px] h-[22px]" /></Link>
          <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-blue-400 to-blue-700 flex items-center justify-center text-white"><ClipboardCheck className="w-[22px] h-[22px]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-bold">Stock Opname</div>
            <div className="text-[13px] text-[#5A687C]">{screen === 'done' ? 'Selesai' : `Langkah ${stepIdx + 1} dari 3 · ${STEP_NAMES[stepIdx]}`}</div>
          </div>
        </div>
        {screen !== 'done' && (
          <div className="grid grid-cols-3 gap-1.5">
            {STEP_NAMES.map((n, i) => (
              <div key={n} className="flex flex-col gap-1">
                <div className="h-1 rounded-full" style={{ background: i <= stepIdx ? BLUE : '#E2E8F0' }} />
                <div className={`text-xs font-medium ${i <= stepIdx ? 'text-[#0F1729]' : 'text-[#94A3B8]'}`}>{n}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Lokasi ===== */}
      {screen === 'setup' && (
        <div className="flex-1 p-4 flex flex-col gap-3.5">
          {drafts.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className={sectionLabel}>Belum selesai</div>
              {drafts.map(d => (
                <div key={d.id} className="flex items-center gap-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-[14px] pl-4 pr-2 py-2.5">
                  <button type="button" onClick={() => resume(d)} className="flex-1 text-left min-w-0">
                    <div className="text-base font-bold truncate">{d.csCode} · {d.zoneCode ? `Zona ${d.zoneCode}` : 'Semua zona'}</div>
                    <div className="text-sm text-[#5A687C]">{d.counted} / {d.expected} karung · {d.opnameNumber}</div>
                  </button>
                  <button type="button" onClick={() => resume(d)} className="text-[15px] font-bold px-2 min-h-[44px]" style={{ color: BLUE }}>Lanjutkan</button>
                  <button type="button" onClick={() => removeDraft(d)} aria-label="Hapus" className="w-10 h-10 flex items-center justify-center text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
          <div className={`${card} p-4 flex flex-col gap-3.5`}>
            <div className={sectionLabel}>Lokasi yang dihitung</div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="gudang" className="text-[15px] font-medium">Gudang</label>
              <select id="gudang" value={csId} onChange={(e) => { setCsId(e.target.value); setZoneId(''); }} className={selectCls}>
                {!csId && <option value="">Pilih gudang</option>}
                {coldStorages.map(cs => <option key={cs.id} value={cs.id}>{cs.code} - {cs.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="zona" className="text-[15px] font-medium">Zona</label>
              <select id="zona" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={!csId} className={selectCls}>
                {zones.map(z => <option key={z.id} value={z.id}>Zona {z.code}</option>)}
                <option value="">Semua zona (satu gudang)</option>
              </select>
            </div>
            {csId && (
              <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl px-3.5 py-3 flex justify-between items-baseline gap-2.5">
                <span className="text-[15px] text-[#1E3A8A]">Menurut sistem ada</span>
                <span className="text-xl font-bold">{expData?.data ? `${expData.data.count} karung` : '…'}</span>
              </div>
            )}
          </div>
          <div className={`${card} px-4 py-3.5 flex flex-col gap-2 text-sm text-[#5A687C]`}>
            <div className={sectionLabel}>Cara kerja</div>
            <div>Scan setiap karung di lokasi ini. Kalau beratnya terlihat wajar, tekan <b className="text-[#0F1729]">Berat sama</b>. Timbang hanya kalau ragu.</div>
            <div>Karung yang tidak ter-scan nanti ditandai <b className="text-[#0F1729]">tidak ditemukan</b>, lalu admin yang memutuskan.</div>
          </div>
          <button type="button" onClick={start} disabled={!csId || busy} className="mt-auto min-h-[56px] rounded-xl text-white text-lg font-bold disabled:opacity-50 flex items-center justify-center gap-2" style={{ background: BLUE }}>
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}Mulai Hitung
          </button>
        </div>
      )}

      {/* ===== Hitung ===== */}
      {screen === 'scan' && op && (
        <div className="flex-1 p-4 flex flex-col gap-3">
          <div className={`${card} px-3.5 py-3 flex flex-col gap-2`}>
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[15px] font-medium truncate">{op.csCode} · {zoneLabel}</span>
              <span className="text-[15px] shrink-0"><b className="text-xl">{countedN}</b> / {expected} karung</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#EEF2F6] overflow-hidden"><div className="h-1.5 rounded-full" style={{ background: BLUE, width: `${Math.min(100, Math.round(countedN / Math.max(1, expected) * 100))}%` }} /></div>
          </div>

          {errorMsg && (
            <div role="alert" className="flex gap-2.5 items-start bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] rounded-xl px-3.5 py-3 text-[15px] font-medium">
              <AlertCircle className="w-[22px] h-[22px] text-[#DC2828] shrink-0" /><span>{errorMsg}</span>
            </div>
          )}
          {flash && !errorMsg && !current && (
            <div role="status" className="flex gap-2.5 items-center bg-[#EDF8F3] border border-[#B7E4CF] text-[#0D6346] rounded-xl px-3.5 py-3 text-[15px] font-medium">
              <Check className="w-[22px] h-[22px] shrink-0" /><span>{flash}</span>
            </div>
          )}

          {current ? (
            <div className="bg-white rounded-[14px] overflow-hidden" style={{ border: `2px solid ${BLUE}` }}>
              <div className="px-3.5 py-3 flex justify-between items-center gap-2 border-b border-[#EEF2F6]">
                <div className="min-w-0">
                  <div className="text-[22px] font-bold font-mono">{current.code}</div>
                  <div className="text-[15px] font-medium truncate">{current.productName}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[13px] text-[#5A687C]">Berat sistem</div>
                  <div className="text-xl font-bold">{kg(current.systemWeight)} kg</div>
                </div>
              </div>
              <div className="px-3.5 py-2.5 flex flex-col gap-1 bg-[#F8FAFC] text-sm">
                <div className="text-xs font-medium tracking-[0.06em] uppercase text-[#5A687C]">Asal-usul karung</div>
                <Row k="Asal" v={current.origin?.sourceNumber || current.origin?.sourceType || 'Input manual'} />
                {current.origin?.partyLabel && <Row k={current.origin.partyLabel} v={current.origin.partyLabel === 'Tanggal produksi' ? dmy(current.origin.party) : (current.origin.party || '-')} />}
                <Row k="Masuk gudang" v={dmy(current.origin?.inDate)} />
                <Row k="Kadaluarsa" v={dmy(current.origin?.expiredDate)} />
                <Row k="Zona di sistem" v={current.zoneCode || '-'} />
              </div>
              {current.moved && (
                <div className="px-3.5 py-2.5 bg-[#FFFBEB] border-t border-[#FDE68A] text-sm text-[#92400E]">Tercatat di <b>Zona {current.zoneCode || '-'}</b>, ditemukan di <b>{zoneLabel}</b>. Zona diperbarui setelah disetujui admin.</div>
              )}
              {current.allocated && (
                <div className="px-3.5 py-2.5 bg-[#EFF6FF] border-t border-[#BFDBFE] text-sm text-[#1E3A8A]">Karung ini sudah dipesan untuk SO, tetap dihitung.</div>
              )}
              {weighing ? (
                <div className="px-3.5 py-3 flex flex-col gap-2 border-t border-[#EEF2F6]">
                  <label htmlFor="berat" className="text-[15px] font-medium">Berat timbang (kg)</label>
                  <WeightInput id="berat" value={weight} onChange={setWeight} autoFocus placeholder="0,0" className="h-[60px] text-[28px] font-bold text-center"
                    onKeyDown={(e) => { if (e.key === 'Enter' && Number(weight) > 0) confirmCount(Number(weight)); }} />
                  <button type="button" disabled={busy || !(Number(weight) > 0)} onClick={() => confirmCount(Number(weight))} className="min-h-[52px] rounded-xl text-white text-[17px] font-bold disabled:opacity-50" style={{ background: BLUE }}>Simpan berat</button>
                </div>
              ) : (
                <div className="px-3.5 py-3 grid grid-cols-[1.4fr_1fr] gap-2 border-t border-[#EEF2F6]">
                  <button type="button" disabled={busy} onClick={() => confirmCount(null)} className="min-h-[56px] rounded-xl bg-[#117956] text-white text-[17px] font-bold flex items-center justify-center gap-2 disabled:opacity-60"><Check className="w-5 h-5" />Berat sama</button>
                  <button type="button" onClick={() => setWeighing(true)} className="min-h-[56px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium">Timbang</button>
                </div>
              )}
              <button type="button" onClick={() => setCurrent(null)} className="w-full py-2 text-sm text-[#5A687C] border-t border-[#EEF2F6]">Batal, bukan karung ini</button>
            </div>
          ) : textRead ? (
            <KodeConfirm result={textRead} mode="stock" accent={BLUE}
              onAccept={(c) => { setTextRead(null); handleCode(c); }}
              onRetake={() => { setTextRead(null); setScanning(true); }} />
          ) : (
            <>
              {scanning && <BarcodeScanner accent="#60A5FA" height={170} onDetect={(c) => handleCode(c)} onText={(r) => { setScanning(false); setTextRead(r); }} />}
              <button type="button" onClick={() => { setErrorMsg(null); setScanning(s => !s); }} disabled={checking}
                className="min-h-[64px] rounded-xl text-white text-xl font-bold flex items-center justify-center gap-2.5 disabled:opacity-60" style={{ background: BLUE }}>
                {checking ? <Loader2 className="w-6 h-6 animate-spin" /> : <ScanLine className="w-[26px] h-[26px]" />}
                {checking ? 'Mengecek kode…' : scanning ? 'Tutup Kamera' : 'Scan Karung'}
              </button>
              {manualOpen ? (
                <div className={`${card} p-3 flex gap-2`}>
                  <input autoFocus value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Ketik kode di label"
                    onKeyDown={(e) => { if (e.key === 'Enter') { handleCode(manualCode); setManualCode(''); setManualOpen(false); } }}
                    className="flex-1 min-w-0 h-12 border border-[#CBD5E1] rounded-[10px] px-3 text-lg font-mono font-bold" />
                  <button type="button" onClick={() => { handleCode(manualCode); setManualCode(''); setManualOpen(false); }} className="h-12 px-4 rounded-[10px] text-white font-bold" style={{ background: BLUE }}>OK</button>
                </div>
              ) : (
                <div className="flex justify-between gap-2">
                  <button type="button" onClick={undoLast} disabled={!op.recent?.length} className="min-h-[40px] text-sm font-medium text-[#DC2828] disabled:opacity-40">Batalkan terakhir</button>
                  <button type="button" onClick={() => { setScanning(false); setManualOpen(true); }} className="min-h-[40px] text-sm font-medium flex items-center gap-1.5" style={{ color: BLUE }}><Keyboard className="w-4 h-4" /> Ketik kode manual</button>
                </div>
              )}
            </>
          )}

          <div className="text-[13px] text-[#5A687C] text-center">Tersimpan otomatis. Bisa dilanjutkan besok.</div>

          {op.recent?.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <div className="px-3.5 py-2.5 border-b border-[#EEF2F6]"><span className={sectionLabel}>Terakhir dihitung</span></div>
              {op.recent.map(r => (
                <div key={r.itemId} className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-[#EEF2F6] last:border-0 text-[15px]">
                  <span className="font-mono">{r.kodeSimpan}</span>
                  <span className="text-[#5A687C] truncate text-sm flex-1">{r.productName}</span>
                  <b className={Math.abs(r.diff) >= 0.05 ? 'text-[#C2410C]' : ''}>{kg(r.weight)} kg</b>
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={() => { setScanning(false); setCurrent(null); setScreen('review'); }} disabled={!countedN}
            className="mt-auto min-h-[56px] rounded-xl bg-white text-[17px] font-bold disabled:opacity-40" style={{ border: `2px solid ${BLUE}`, color: BLUE }}>Selesai Hitung</button>
        </div>
      )}

      {/* ===== Cek ===== */}
      {screen === 'review' && op && (
        <div className="flex-1 p-4 flex flex-col gap-3">
          {!detailData ? <div className="text-center py-10"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Tile label="Cocok" value={review.ok.length} cls="bg-[#EDF8F3] border-[#B7E4CF] text-[#0D6346]" />
                <Tile label="Berat beda" value={review.diff.length} sub={review.diff.length ? `${review.diffKg > 0 ? '+' : ''}${kg(review.diffKg)} kg` : ''} cls="bg-[#FFF7ED] border-[#FED7AA] text-[#9A3412]" />
                <Tile label="Pindah zona" value={review.moved.length} cls="bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]" />
                <Tile label="Tidak ditemukan" value={review.missing.length} cls="bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]" />
              </div>
              {(review.diff.length + review.moved.length + review.missing.length) > 0 && (
                <div className={`${card} overflow-hidden`}>
                  <div className="px-3.5 py-2.5 border-b border-[#EEF2F6]"><span className={sectionLabel}>Perlu dicek admin</span></div>
                  {review.diff.map(i => <Att key={`d${i.id}`} code={i.stock?.kodeSimpan} tag="Berat beda" color="#9A3412" detail={`${i.product?.name || '-'} · ${kg(i.systemWeight)} → ${kg(i.physicalWeight)} kg`} />)}
                  {review.moved.map(i => <Att key={`m${i.id}`} code={i.stock?.kodeSimpan} tag="Pindah zona" color="#92400E" detail={`${i.product?.name || '-'} · Zona ${i.zoneCode || '-'} → ${i.foundZoneCode || '-'}`} />)}
                  {review.missing.map(i => <Att key={`x${i.id}`} code={i.stock?.kodeSimpan} tag="Tidak ditemukan" color="#991B1B" detail={`${i.product?.name || '-'} · ${kg(i.systemWeight)} kg${i.origin?.sourceNumber ? ` · ${i.origin.sourceNumber}` : ''}`} />)}
                </div>
              )}
              <div className="text-[13px] text-[#5A687C]">Stok belum berubah. Perubahan berlaku setelah admin menyetujui di ERP.</div>
              <div className="mt-auto flex flex-col gap-2.5">
                <button type="button" onClick={submit} disabled={busy} className="min-h-[56px] rounded-xl text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: BLUE }}>
                  {busy && <Loader2 className="w-5 h-5 animate-spin" />}Ajukan ke Admin
                </button>
                <button type="button" onClick={() => { mutateDetail(); setScreen('scan'); }} className="min-h-[52px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium">Kembali scan</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===== Selesai ===== */}
      {screen === 'done' && submitted && (
        <div className="flex-1 p-4 pt-6 flex flex-col gap-3.5">
          <div className={`${card} px-4 py-7 flex flex-col items-center text-center gap-2.5`}>
            <div className="w-[72px] h-[72px] rounded-full bg-[#EFF6FF] flex items-center justify-center"><Check className="w-10 h-10" style={{ color: BLUE }} strokeWidth={2.5} /></div>
            <div className="text-[22px] font-bold">Terkirim ke admin</div>
            <div className="text-[15px] text-[#5A687C]">{submitted.opnameNumber} · {submitted.csCode} · {submitted.zoneCode ? `Zona ${submitted.zoneCode}` : 'Semua zona'}</div>
            <div className="text-sm text-[#5A687C]">{submitted.counted} karung dihitung. Admin menyetujui di menu Stock Opname.</div>
          </div>
          <div className="mt-auto flex flex-col gap-2.5">
            <button type="button" onClick={() => { setOp(null); setSubmitted(null); setFlash(null); setErrorMsg(null); setScreen('setup'); }} className="min-h-[56px] rounded-xl text-white text-lg font-bold" style={{ background: BLUE }}>Hitung lokasi lain</button>
            <Link href="/tally" className="min-h-[52px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium flex items-center justify-center">Kembali ke beranda</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }) {
  return <div className="flex justify-between gap-2.5"><span className="text-[#5A687C]">{k}</span><b className="text-right">{v}</b></div>;
}
function Tile({ label, value, sub, cls }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${cls}`}>
      <div className="text-[13px]">{label}</div>
      <div className="text-2xl font-bold text-[#0F1729]">{value} {sub && <span className="text-sm font-medium">{sub}</span>}</div>
    </div>
  );
}
function Att({ code, tag, color, detail }) {
  return (
    <div className="px-3.5 py-2.5 border-b border-[#EEF2F6] last:border-0 flex flex-col gap-0.5">
      <div className="flex justify-between gap-2 text-[15px]"><span className="font-mono font-bold">{code}</span><span className="text-[13px] font-medium" style={{ color }}>{tag}</span></div>
      <div className="text-[13px] text-[#5A687C]">{detail}</div>
    </div>
  );
}
