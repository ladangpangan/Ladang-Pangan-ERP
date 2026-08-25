'use client';
import * as React from 'react';
import { Input } from '@/components/ui/input';

// Input berat (kg) dengan pemisah ribuan id-ID + dukungan desimal.
// Menerima koma ATAU titik sebagai pemisah desimal (separator terakhir dianggap desimal),
// menampilkan koma sebagai desimal & titik sebagai ribuan, dan mengirim number lewat onChange.
// Nilai 0 tampil kosong (placeholder) agar mudah dihapus.
const WeightInput = React.forwardRef(function WeightInput(
  { value, onChange, maxFraction = 3, ...props },
  ref
) {
  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };
  const parse = (raw) => {
    let s = String(raw).replace(/[^\d.,]/g, '');
    const decPos = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    let intPart, decPart;
    if (decPos === -1) { intPart = s.replace(/[.,]/g, ''); decPart = null; }
    else { intPart = s.slice(0, decPos).replace(/[.,]/g, ''); decPart = s.slice(decPos + 1).replace(/[.,]/g, ''); }
    if (decPart != null && maxFraction >= 0) decPart = decPart.slice(0, maxFraction);
    const numStr = intPart + (decPart != null && decPart !== '' ? '.' + decPart : '');
    const num = numStr === '' ? 0 : Number(numStr);
    return { num: isNaN(num) ? 0 : num, intPart, decPart };
  };
  const fmtFromValue = (v) => {
    const num = toNum(v);
    if (!num) return '';
    const [i, d] = String(num).split('.');
    const intFmt = Number(i).toLocaleString('id-ID', { maximumFractionDigits: 0 });
    return d ? `${intFmt},${d}` : intFmt;
  };

  const [text, setText] = React.useState(() => fmtFromValue(value));
  React.useEffect(() => {
    if (toNum(value) !== parse(text).num) setText(fmtFromValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (e) => {
    const raw = e.target.value;
    if (raw.trim() === '') { setText(''); onChange && onChange(0); return; }
    const { num, intPart, decPart } = parse(raw);
    const intFmt = intPart === '' ? '' : Number(intPart).toLocaleString('id-ID', { maximumFractionDigits: 0 });
    let disp = intFmt;
    if (decPart != null) disp = (intFmt || '0') + ',' + decPart; // decPart bisa '' saat baru mengetik pemisah
    setText(disp);
    onChange && onChange(num);
  };

  return <Input ref={ref} type="text" inputMode="decimal" value={text} onChange={handle} {...props} />;
});

export { WeightInput };
