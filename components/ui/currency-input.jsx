'use client';
import * as React from 'react';
import { Input } from '@/components/ui/input';

// Input mata uang (Rp) dengan pemisah ribuan id-ID otomatis saat mengetik.
// Menyimpan angka murni & mengirim number lewat onChange. Nilai 0 tampil kosong
// (placeholder) agar mudah dihapus. Default integer; set allowDecimal untuk desimal.
const CurrencyInput = React.forwardRef(function CurrencyInput(
  { value, onChange, allowDecimal = false, ...props },
  ref
) {
  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };
  const parseText = (t) => {
    if (t == null) return 0;
    let cleaned = String(t).replace(/\./g, ''); // buang pemisah ribuan
    if (allowDecimal) cleaned = cleaned.replace(',', '.');
    cleaned = cleaned.replace(/[^\d.]/g, '');
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  };
  const fmt = (n) => {
    const num = toNum(n);
    if (!num) return '';
    return num.toLocaleString('id-ID', allowDecimal ? { maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
  };

  const [text, setText] = React.useState(() => fmt(value));

  React.useEffect(() => {
    if (toNum(value) !== parseText(text)) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (e) => {
    const raw = e.target.value;
    if (raw.trim() === '') { setText(''); onChange && onChange(0); return; }
    // izinkan trailing koma saat mengetik desimal
    const endsWithComma = allowDecimal && /,$/.test(raw);
    const num = parseText(raw);
    setText(fmt(num) + (endsWithComma ? ',' : ''));
    onChange && onChange(num);
  };

  return <Input ref={ref} type="text" inputMode="numeric" value={text} onChange={handle} {...props} />;
});

export { CurrencyInput };
