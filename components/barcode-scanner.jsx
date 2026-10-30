'use client';

import { useEffect, useRef, useState } from 'react';

// Pemindai barcode/QR lewat kamera HP (Tally Inbound/Outbound).
// Pakai BarcodeDetector bawaan browser (Chrome Android) bila ada; selain itu jatuh ke @zxing/browser.
// Kamera hanya bisa dibuka di alamat https (atau localhost).
const NATIVE_FORMATS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'codabar', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'];

export function BarcodeScanner({ onDetect, continuous = false, accent = '#34D399', height = 200 }) {
  const videoRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  const lastRef = useRef({ code: '', at: 0 });
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let timer = null;
    let zxingControls = null;

    const emit = (raw) => {
      const code = String(raw || '').trim();
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
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
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
            if (video.readyState >= 2) {
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
          if (result) {
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
      try { zxingControls?.stop(); } catch {}
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [continuous]);

  const corner = { position: 'absolute', width: 30, height: 30, borderColor: accent, borderStyle: 'solid' };
  return (
    <div className="relative rounded-[14px] overflow-hidden bg-[#0F1729] shrink-0" style={{ height }}>
      <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      {!error && (
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
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-200">{error}</div>
      )}
    </div>
  );
}
