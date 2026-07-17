'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, Loader2, CheckCircle2, Truck, Layers, ChevronRight, Save, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url) => fetch(url).then(r => r.json());

const STAGES = [
  { key: 'arrival', label: '🚚 Kedatangan', icon: Truck },
  { key: 'pemotongan', label: '✂️ Stage 1 - Pemotongan', icon: Layers },
  { key: 'eviscerasi', label: '🔪 Stage 2 - Eviscerasi', icon: Layers },
  { key: 'karkas', label: '🐔 Stage 3 - Karkas', icon: Layers },
  { key: 'boneless_parting', label: '🥩 Stage 4 - Boneless/Parting', icon: Layers },
  { key: 'packing_plastik', label: '📦 Packing Plastik', icon: Layers },
  { key: 'abf', label: '❄️ ABF', icon: Layers },
  { key: 'panen_abf', label: '📤 Panen ABF', icon: Layers },
  { key: 'packing_karung', label: '🎒 Packing Karung', icon: Layers },
];

const STAGE_FIELDS = {
  pemotongan: [{ k: 'inputHeadCount', l: 'Ekor Diterima' }, { k: 'outputHeadCount', l: 'Ekor Dipotong' }],
  eviscerasi: [{ k: 'beratBrangkas', l: 'Berat Brangkas (kg)' }, { k: 'ekorBrangkas', l: 'Ekor Brangkas' }, { k: 'beratHJA', l: 'Berat HJA (kg)' }, { k: 'beratUsus', l: 'Berat Usus (kg)' }, { k: 'beratTembolok', l: 'Berat Tembolok (kg)' }],
  karkas: [{ k: 'beratKarkas', l: 'Berat Karkas (kg)' }, { k: 'ekorKarkas', l: 'Ekor Karkas' }, { k: 'beratKepalaLeher', l: 'Kepala+Leher (kg)' }, { k: 'beratCeker', l: 'Ceker (kg)' }],
  boneless_parting: [{ k: 'bonelessDada', l: 'Boneless Dada (kg)' }, { k: 'bonelessPaha', l: 'Boneless Paha (kg)' }, { k: 'kerongkong', l: 'Kerongkong (kg)' }, { k: 'kulitDada', l: 'Kulit Dada (kg)' }, { k: 'kulitPaha', l: 'Kulit Paha (kg)' }, { k: 'sayap', l: 'Sayap (kg)' }, { k: 'tulangPaha', l: 'Tulang Paha (kg)' }, { k: 'tunggir', l: 'Tunggir (kg)' }],
  packing_plastik: [{ k: 'weight', l: 'Berat (kg)' }, { k: 'quantity', l: 'Jumlah Pack' }],
  abf: [{ k: 'weight', l: 'Berat (kg)' }, { k: 'quantity', l: 'Jumlah' }],
  panen_abf: [{ k: 'weight', l: 'Berat (kg)' }, { k: 'quantity', l: 'Jumlah' }],
  packing_karung: [{ k: 'weight', l: 'Berat (kg)' }, { k: 'quantity', l: 'Jumlah Pack' }, { k: 'karungCount', l: 'Jumlah Karung (25 pack/karung)' }],
};

export default function TallyWOPage() {
  const { id } = useParams();
  const { data, mutate, isLoading } = useSWR(`/api/work-orders/${id}`, fetcher);
  const wo = data?.data;
  const [selectedStage, setSelectedStage] = useState(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  if (isLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!wo) return <div className="p-4 text-center text-muted-foreground">WO tidak ditemukan</div>;

  return (
    <div className="max-w-md mx-auto p-4 min-h-screen">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/tally"><Button variant="ghost" size="icon"><ChevronLeft className="w-5 h-5" /></Button></Link>
        <div className="flex-1">
          <div className="font-mono font-bold text-sm">{wo.woNumber}</div>
          <div className="text-xs text-muted-foreground">{wo.mode} · {wo.po?.method || '-'}</div>
        </div>
        {online ? <Wifi className="w-5 h-5 text-emerald-600" /> : <WifiOff className="w-5 h-5 text-red-500" />}
      </div>

      {/* Stats */}
      <Card className="mb-4">
        <CardContent className="pt-4 grid grid-cols-2 gap-3">
          <div><div className="text-xs text-muted-foreground">Berat LB</div><div className="font-bold">{Number(wo.totalLiveBirdWeight).toLocaleString('id-ID')} kg</div></div>
          <div><div className="text-xs text-muted-foreground">Ekor</div><div className="font-bold">{wo.totalLiveBirdHeadCount}</div></div>
          <div><div className="text-xs text-muted-foreground">BW Avg</div><div className="font-bold">{Number(wo.bwAvg).toFixed(2)} kg</div></div>
          <div><div className="text-xs text-muted-foreground">Ekor Mati</div><div className="font-bold text-red-600">{wo.ekorMati || 0}</div></div>
        </CardContent>
      </Card>

      {!selectedStage ? (
        <>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Pilih Stage</div>
          <div className="space-y-2">
            {STAGES.map(s => {
              const done = wo.stages?.some(st => st.type === s.key) || (s.key === 'arrival' && wo.arrivalRecordedAt);
              return (
                <button key={s.key} onClick={() => setSelectedStage(s.key)} className="w-full text-left p-4 border rounded-xl bg-white hover:bg-slate-50 flex items-center justify-between shadow-sm">
                  <div>
                    <div className="font-semibold">{s.label}</div>
                    {done && <div className="text-xs text-emerald-600 mt-1"><CheckCircle2 className="w-3 h-3 inline mr-1" />Sudah tercatat</div>}
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <StageInput woId={id} stageKey={selectedStage} onDone={() => { setSelectedStage(null); mutate(); }} onBack={() => setSelectedStage(null)} wo={wo} />
      )}
    </div>
  );
}

function StageInput({ woId, stageKey, onDone, onBack, wo }) {
  const stageMeta = STAGES.find(s => s.key === stageKey);
  const fields = STAGE_FIELDS[stageKey] || [];
  const [outputWeight, setOutputWeight] = useState(0);
  const [headCount, setHeadCount] = useState(0);
  const [data, setData] = useState({});
  const [arrival, setArrival] = useState({ totalWeight: wo?.totalLiveBirdWeight || 0, totalHeadCount: wo?.totalLiveBirdHeadCount || 0, ekorMati: wo?.ekorMati || 0, notes: '' });
  const [saving, setSaving] = useState(false);

  // Restore draft from localStorage
  useEffect(() => {
    const key = `tally-${woId}-${stageKey}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (stageKey === 'arrival') setArrival(p.arrival || arrival);
        else { setOutputWeight(p.outputWeight || 0); setHeadCount(p.headCount || 0); setData(p.data || {}); }
      } catch (e) { /* ignore */ }
    }
  }, [stageKey, woId]);

  useEffect(() => {
    const key = `tally-${woId}-${stageKey}`;
    const payload = stageKey === 'arrival' ? { arrival } : { outputWeight, headCount, data };
    localStorage.setItem(key, JSON.stringify(payload));
  }, [outputWeight, headCount, data, arrival, woId, stageKey]);

  const save = async () => {
    setSaving(true);
    try {
      let res, j;
      if (stageKey === 'arrival') {
        res = await fetch(`/api/work-orders/${woId}/arrival`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(arrival) });
      } else {
        res = await fetch(`/api/work-orders/${woId}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: stageKey, outputWeight: Number(outputWeight), headCount: Number(headCount), rendemenData: data }) });
      }
      j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal');
      toast.success('Tersimpan!');
      localStorage.removeItem(`tally-${woId}-${stageKey}`);
      onDone();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" />Kembali</Button>
        <h2 className="font-bold text-lg flex-1">{stageMeta?.label}</h2>
      </div>

      {stageKey === 'arrival' ? (
        <Card><CardContent className="pt-4 space-y-3">
          <BigInput label="Total Berat Live Bird (kg)" value={arrival.totalWeight} onChange={v => setArrival({ ...arrival, totalWeight: Number(v) })} />
          <BigInput label="Total Ekor" value={arrival.totalHeadCount} onChange={v => setArrival({ ...arrival, totalHeadCount: Number(v) })} />
          <BigInput label="Ekor Mati" value={arrival.ekorMati} onChange={v => setArrival({ ...arrival, ekorMati: Number(v) })} />
          <div className="p-3 bg-slate-100 rounded-lg text-sm">
            <div>BW rata-rata: <b>{arrival.totalHeadCount > 0 ? (arrival.totalWeight / arrival.totalHeadCount).toFixed(3) : '0'} kg/ekor</b></div>
            <div>Ekor hidup diterima: <b>{Number(arrival.totalHeadCount) - Number(arrival.ekorMati)}</b></div>
          </div>
          <div><Label className="text-xs">Catatan</Label><Textarea rows={2} value={arrival.notes} onChange={e => setArrival({ ...arrival, notes: e.target.value })} /></div>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="pt-4 space-y-3">
          <BigInput label="Total Output Weight (kg)" value={outputWeight} onChange={setOutputWeight} />
          <BigInput label="Head Count" value={headCount} onChange={setHeadCount} />
          <div className="pt-3 border-t">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Detail Rendemen</div>
            <div className="space-y-2">
              {fields.map(f => (
                <div key={f.k}>
                  <Label className="text-xs">{f.l}</Label>
                  <Input type="number" inputMode="decimal" className="h-12 text-lg" value={data[f.k] || 0} onChange={e => setData({ ...data, [f.k]: Number(e.target.value) })} />
                </div>
              ))}
            </div>
          </div>
        </CardContent></Card>
      )}

      <div className="sticky bottom-0 mt-4 pb-2">
        <Button onClick={save} disabled={saving} className="w-full h-14 text-lg">
          {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}Simpan {stageMeta?.label}
        </Button>
        <div className="text-xs text-muted-foreground text-center mt-2">Draft auto-saved locally</div>
      </div>
    </div>
  );
}

function BigInput({ label, value, onChange }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" inputMode="decimal" className="h-14 text-2xl font-bold text-center" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
