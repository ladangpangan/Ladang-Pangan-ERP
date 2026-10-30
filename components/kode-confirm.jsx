'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Camera, Keyboard } from 'lucide-react';

const kg = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Konfirmasi hasil baca tulisan spidol (Tally). Petugas wajib memastikan kode sebelum dipakai.
// mode 'stock' = kode harus ada di gudang (Keluar, Opname) → tampilkan kode mirip kalau salah baca.
// mode 'new'   = kode harus belum dipakai (Masuk).
export function KodeConfirm({ result, mode = 'stock', sessionId, accent = '#117956', onAccept, onRetake }) {
  const [code, setCode] = useState(result.code);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(result.code);
  const [check, setCheck] = useState(null); // { loading } | { ok, title, detail, candidates }

  const edited = code !== result.code;
  const digits = edited ? code.split('').map(ch => ({ ch, conf: 100 })) : result.digits;

  useEffect(() => {
    let alive = true;
    setCheck({ loading: true });
    const run = async () => {
      try {
        if (mode === 'new') {
          const qs = new URLSearchParams({ code, ...(sessionId ? { session: sessionId } : {}) });
          const res = await fetch(`/api/tally-sessions/check-kode?${qs}`, { credentials: 'include' });
          const j = await res.json();
          if (!res.ok) throw new Error(j.error || 'Gagal cek kode');
          return j.data?.available
            ? { ok: true, title: 'Kode baru, belum pernah dipakai', detail: 'Aman dipakai untuk karung ini.' }
            : { ok: false, title: 'Kode ini sudah dipakai', detail: j.data?.message || '' };
        }
        const conf = edited ? '' : result.digits.map(d => d.conf).join(',');
        const res = await fetch(`/api/tally-sessions/match-kode?${new URLSearchParams({ code, conf })}`, { credentials: 'include' });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Gagal cek kode');
        const ex = j.data?.exact;
        const candidates = j.data?.candidates || [];
        if (ex && ex.inStock) {
          return { ok: true, title: 'Ada di gudang', detail: [ex.productName, `${kg(ex.weight)} kg`, ex.zoneCode ? `Zona ${ex.zoneCode}` : null].filter(Boolean).join(' · '), candidates };
        }
        if (ex) return { ok: false, title: 'Karung ini sudah tidak di gudang', detail: `Status: ${ex.status}. Mungkin salah baca, cek kode mirip di bawah.`, candidates };
        return { ok: false, title: 'Kode ini tidak ada di gudang', detail: 'Mungkin salah baca. Pilih kode mirip di bawah, ketik ulang, atau foto ulang.', candidates };
      } catch (e) {
        return { ok: false, title: 'Kode belum bisa dicek', detail: e.message };
      }
    };
    run().then(r => { if (alive) setCheck(r); });
    return () => { alive = false; };
  }, [code, mode, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const doubt = digits.some(d => d.conf < 80);
  const candidates = check?.candidates || [];

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-[14px] overflow-hidden border-2" style={{ borderColor: accent }}>
        <div className="p-3.5 flex flex-col gap-2">
          <div className="text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C]">Foto dari karung</div>
          {result.image && <img src={result.image} alt="Tulisan kode di karung" className="w-full max-h-[90px] object-contain rounded-lg bg-[#0F1729]" />}
          <div className="text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C] mt-1">{edited ? 'Kode diketik' : 'Kode terbaca'}</div>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.max(digits.length, 1)}, minmax(0, 1fr))` }}>
            {digits.map((d, i) => (
              <div key={i} className={`h-[46px] rounded-md flex items-center justify-center font-mono text-2xl font-bold ${d.conf < 80 ? 'bg-[#FEF3C7] border-2 border-[#F59E0B] text-[#78350F]' : 'bg-[#F1F5F9] border border-[#DFE5EC]'}`}>{d.ch}</div>
            ))}
          </div>
          {doubt && <div className="text-[13px] text-[#92400E]">Kotak kuning = angka yang kurang yakin. Cocokkan dengan tulisan di karung.</div>}
        </div>

        <div className="px-3.5">
          {!check || check.loading ? (
            <div className="flex items-center gap-2 text-sm text-[#5A687C] py-2"><Loader2 className="w-4 h-4 animate-spin" /> Mengecek kode…</div>
          ) : check.ok ? (
            <div className="flex gap-2.5 items-start rounded-[10px] bg-[#EDF8F3] border border-[#B7E4CF] px-3 py-2.5 text-sm text-[#0D6346]">
              <Check className="w-5 h-5 shrink-0 mt-px" /><div><b>{check.title}</b>{check.detail ? <><br />{check.detail}</> : null}</div>
            </div>
          ) : (
            <div role="alert" className="rounded-[10px] bg-[#FEF2F2] border border-[#FECACA] px-3 py-2.5 text-sm text-[#991B1B]"><b>{check.title}</b>{check.detail ? <><br />{check.detail}</> : null}</div>
          )}
        </div>

        {editing ? (
          <div className="p-3.5 flex flex-col gap-2">
            <label htmlFor="kode-ulang" className="text-[15px] font-medium">Kode simpan (angka saja)</label>
            <input id="kode-ulang" autoFocus inputMode="numeric" value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && draft) { setCode(draft); setEditing(false); } }}
              className="h-16 border border-[#CBD5E1] rounded-[10px] text-[28px] font-bold text-center tracking-[3px] font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setDraft(code); setEditing(false); }} className="min-h-[52px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium">Batal</button>
              <button type="button" disabled={!draft} onClick={() => { setCode(draft); setEditing(false); }} className="min-h-[52px] rounded-xl text-white text-base font-bold disabled:opacity-50" style={{ background: accent }}>Cek kode ini</button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 flex flex-col gap-2">
            <button type="button" disabled={!check?.ok} onClick={() => onAccept(code)}
              className="min-h-[60px] rounded-xl text-white text-[19px] font-bold flex items-center justify-center gap-2 disabled:opacity-45" style={{ background: accent }}>
              <Check className="w-[22px] h-[22px]" /> Ya, kode benar
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onRetake} className="min-h-[52px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium flex items-center justify-center gap-2"><Camera className="w-4 h-4" /> Foto ulang</button>
              <button type="button" onClick={() => { setDraft(code); setEditing(true); }} className="min-h-[52px] rounded-xl border border-[#CBD5E1] bg-white text-base font-medium flex items-center justify-center gap-2"><Keyboard className="w-4 h-4" /> Ketik ulang</button>
            </div>
          </div>
        )}
      </div>

      {mode === 'stock' && candidates.length > 0 && !editing && (!check?.ok || doubt) && (
        <div className="bg-white border border-[#DFE5EC] rounded-[14px] overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[#EEF2F6] text-[13px] font-medium tracking-[0.06em] uppercase text-[#5A687C]">Kode mirip di gudang</div>
          {candidates.map(c => (
            <button key={c.code} type="button" onClick={() => onAccept(c.code)}
              className="w-full min-h-[56px] border-b border-[#EEF2F6] last:border-b-0 bg-white px-3.5 py-2 flex justify-between items-center gap-2.5 text-left">
              <span>
                <span className="font-mono text-lg font-bold">{c.code}</span><br />
                <span className="text-[13px] text-[#5A687C]">{[c.productName, `${kg(c.weight)} kg`, c.zoneCode ? `Zona ${c.zoneCode}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-sm font-medium" style={{ color: accent }}>Pilih</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
