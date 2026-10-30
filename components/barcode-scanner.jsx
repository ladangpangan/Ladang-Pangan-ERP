'use client';

import { useEffect, useRef, useState } from 'react';

// Pemindai kode karung lewat kamera HP (Tally Masuk/Keluar/Opname): QR, barcode, dan tulisan spidol.
// Barcode/QR: BarcodeDetector bawaan browser (Chrome Android) bila ada; selain itu @zxing/browser.
// Tulisan spidol (angka): dibaca di HP oleh lib/ocr/digit-ocr bila `onText` diberikan. Barcode didahulukan;
// tulisan baru dicoba kalau tidak ada barcode yang terlihat. Hasil tulisan wajib dikonfirmasi petugas.
// Kamera hanya bisa dibuka di alamat https (atau localhost).
const NATIVE_FORMATS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'];

// Kotak bidik (pecahan dari area kamera). Tulisan dibaca hanya di dalam kotak ini.
const GUIDE = { x: 0.06, y: 0.24, w: 0.88, h: 0.5 };
const OCR_IDLE_MS = 1200;   // tulisan dicoba setelah sekian lama tidak ada barcode
const OCR_EVERY_MS = 1400;  // jeda antar percobaan baca tulisan otomatis
const OCR_REPEAT_MS = 20000; // tulisan yang sama tidak dibaca ulang otomatis (karung masih di depan kamera)
// Disimpan di luar komponen karena kamera dibuka-tutup di sekitar layar konfirmasi.
const recentText = { code: '', at: 0 };

export function BarcodeScanner({ onDetect, onText, continuous = false, accent = '#34D399', height = 200 }) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const onTextRef = useRef(onText);
  const lastRef = useRef({ code: '', at: 0 });
  const lastBarcodeAt = useRef(0);
  const ocrBusy = useRef(false);
  const ocrPrev = useRef('');
  const pausedRef = useRef(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false);
  const [hint, setHint] = useState(null);
  const ocrOn = typeof onText === 'function';

  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  // Baca tulisan di kotak bidik. `manual` = petugas menekan tombol: tampilkan hasil apa pun yang terbaca.
  const readText = async (manual) => {
    const video = videoRef.current;
    if (!video || ocrBusy.current || pausedRef.current || video.readyState < 2) return;
    ocrBusy.current = true;
    if (manual) { setReading(true); setHint(null); }
    try {
      const { cropVideo, readKode } = await import('@/lib/ocr/digit-ocr');
      const crop = cropVideo(video, GUIDE);
      if (!crop) return;
      const r = await readKode(crop, { quick: !manual });
      if (pausedRef.current) return;
      const okAuto = r && r.digits.length >= 8 && r.digits.every(d => d.conf >= 55);
      const repeat = !manual && r && r.code === recentText.code && Date.now() - recentText.at < OCR_REPEAT_MS;
      if (!repeat && (manual ? (r && r.digits.length >= 4) : (okAuto && r.code === ocrPrev.current))) {
        ocrPrev.current = '';
        recentText.code = r.code; recentText.at = Date.now();
        pausedRef.current = true; // tunggu konfirmasi petugas
        try { navigator.vibrate?.(60); } catch {}
        onTextRef.current?.({ ...r, image: crop.toDataURL('image/jpeg', 0.8) });
        return;
      }
      ocrPrev.current = okAuto ? r.code : '';
      if (manual) setHint('Tulisan belum terbaca. Dekatkan HP, pastikan terang, lalu coba lagi.');
    } catch {
      if (manual) setHint('Pembaca tulisan tidak bisa dimuat. Pakai "Ketik kode manual".');
    } finally {
      ocrBusy.current = false;
      if (manual) setReading(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let timer = null;
    let ocrTimer = null;
    let zxingControls = null;
    pausedRef.current = false;

    const emit = (raw) => {
      const code = String(raw || '').trim();
      lastBarcodeAt.current = Date.now();
      if (!code || stopped) return;
      const now = Date.now();
      // Kode yang sama dianggap scan yang sama selama label masih terlihat (jeda < 2,5 detik antar deteksi)
      if (code === lastRef.current.code && now - lastRef.current.at < 2500) { lastRef.current.at = now; return; }
      lastRef.current = { code, at: now };
      try { navigator.vibrate?.(80); } catch {}
      onDetectRef.current?.(code);
    };

    const start = async () => {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        setError('Kamera hanya bisa dipakai lewat alamat https. Untuk sementara pakai "Ketik kode manual".');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('HP/browser ini tidak mendukung kamera. Pakai "Ketik kode manual".');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch (e) {
        setError(e?.name === 'NotAllowedError'
          ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser, lalu coba lagi.'
          : 'Kamera tidak bisa dibuka. Pakai "Ketik kode manual".');
        return;
      }
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      const video = videoRef.current;
      video.srcObject = stream;
      try { await video.play(); } catch {}
      setReady(true);
      lastBarcodeAt.current = Date.now();

      if (ocrOn) {
        import('@/lib/ocr/digit-ocr').then(m => m.loadDigitModel()).catch(() => {});
        const ocrTick = async () => {
          if (stopped) return;
          if (Date.now() - lastBarcodeAt.current > OCR_IDLE_MS && !document.hidden) await readText(false);
          if (!stopped) ocrTimer = setTimeout(ocrTick, OCR_EVERY_MS);
        };
        ocrTimer = setTimeout(ocrTick, OCR_IDLE_MS);
      }

      let detector = null;
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
          if (formats.length) detector = new window.BarcodeDetector({ formats });
        } catch {}
      }
      if (detector) {
        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2 && !pausedRef.current) {
              const found = await detector.detect(video);
              if (found && found[0]) {
                emit(found[0].rawValue);
                if (!continuous) return;
              }
            }
          } catch {}
          timer = setTimeout(tick, 200);
        };
        tick();
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (stopped) return;
        const reader = new BrowserMultiFormatReader();
        zxingControls = await reader.decodeFromVideoElement(video, (result) => {
          if (result && !pausedRef.current) {
            emit(result.getText());
            if (!continuous) zxingControls?.stop();
          }
        });
      } catch {
        setError('Pemindai tidak bisa dimuat. Pakai "Ketik kode manual".');
      }
    };

    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (ocrTimer) clearTimeout(ocrTimer);
      try { zxingControls?.stop(); } catch {}
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous, ocrOn]);

  const corner = { position: 'absolute', width: 30, height: 30, borderColor: accent, borderStyle: 'solid' };
  return (
    <div className="relative rounded-[14px] overflow-hidden bg-[#0F1729] shrink-0" style={{ height }}>
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      {!error && !ocrOn && (
        <>
          <div style={{ ...corner, left: '22%', top: '14%', borderWidth: '4px 0 0 4px', borderRadius: '6px 0 0 0' }} />
          <div style={{ ...corner, right: '22%', top: '14%', borderWidth: '4px 4px 0 0', borderRadius: '0 6px 0 0' }} />
          <div style={{ ...corner, left: '22%', bottom: '20%', borderWidth: '0 0 4px 4px', borderRadius: '0 0 0 6px' }} />
          <div style={{ ...corner, right: '22%', bottom: '20%', borderWidth: '0 4px 4px 0', borderRadius: '0 0 6px 0' }} />
          <div className="absolute left-0 right-0 bottom-2 text-center text-sm text-slate-300">
            {ready ? 'Arahkan kamera ke barcode karung' : 'Membuka kamera…'}
          </div>
        </>
      )}
      {!error && ocrOn && (
        <>
          <div className="absolute rounded-[10px]" style={{
            left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%`,
            border: `3px solid ${accent}`, boxShadow: '0 0 0 400px rgba(15,23,41,0.5)',
          }} />
          <div className="absolute left-0 right-0 top-1.5 text-center text-[13px] font-medium text-white px-3">
            {ready ? (hint || 'Arahkan kotak ke QR, barcode, atau tulisan kode') : 'Membuka kamera…'}
          </div>
          {ready && (
            <button type="button" onClick={() => readText(true)} disabled={reading}
              className="absolute left-1/2 -translate-x-1/2 bottom-1.5 min-h-[36px] px-4 rounded-full bg-white/90 text-[#0F1729] text-sm font-bold disabled:opacity-70">
              {reading ? 'Membaca tulisan…' : 'Baca tulisan sekarang'}
            </button>
          )}
        </>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-200">{error}</div>
      )}
    </div>
  );
}
