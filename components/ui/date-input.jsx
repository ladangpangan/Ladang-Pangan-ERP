'use client';
import * as React from 'react';
import { CalendarDays } from 'lucide-react';
import { id as idLocale } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Input tanggal format Indonesia (dd/mm/yyyy), pengganti <Input type="date">.
// Nilai tetap 'yyyy-mm-dd' dan onChange menerima { target: { value } } seperti input bawaan,
// jadi pemanggil cukup ganti nama komponennya. Bisa diketik (angka saja, garis miring otomatis)
// atau dipilih dari kalender.
const pad = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const toDmy = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const parseDmy = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? toYmd(d) : null;
};
// Ketik "30102026" → "30/10/2026"
const mask = (raw) => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
};

export const DateInput = React.forwardRef(function DateInput(
  { value, onChange, min, max, className, disabled, id, placeholder = 'hh/bb/tttt', ...props }, ref
) {
  const [text, setText] = React.useState(toDmy(value));
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { setText(toDmy(value)); }, [value]);

  const emit = (v) => onChange?.({ target: { value: v } });
  const inRange = (v) => (!min || v >= min) && (!max || v <= max);

  const onType = (e) => {
    const t = mask(e.target.value);
    setText(t);
    if (t === '') emit('');
    else { const v = parseDmy(t); if (v && inRange(v)) emit(v); }
  };
  const onBlur = () => { if (text && !parseDmy(text)) setText(toDmy(value)); };
  const pick = (d) => { if (!d) return; emit(toYmd(d)); setOpen(false); };
  const today = toYmd(new Date());

  return (
    <div className={cn('relative flex items-center w-full', className)}>
      <input
        ref={ref} id={id} type="text" inputMode="numeric" autoComplete="off"
        value={text} onChange={onType} onBlur={onBlur} disabled={disabled} placeholder={placeholder}
        className="flex h-9 w-full rounded-md border border-input bg-transparent pl-3 pr-9 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm tabular-nums"
        {...props}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} aria-label="Pilih tanggal dari kalender"
            className="absolute right-1 h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
            <CalendarDays className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single" locale={idLocale} weekStartsOn={1}
            selected={fromYmd(value) || undefined} defaultMonth={fromYmd(value) || new Date()}
            onSelect={pick}
            disabled={[min && { before: fromYmd(min) }, max && { after: fromYmd(max) }].filter(Boolean)}
          />
          {inRange(today) && (
            <div className="border-t p-2 flex justify-end">
              <button type="button" onClick={() => { emit(today); setOpen(false); }}
                className="text-sm font-medium px-3 py-1 rounded-md hover:bg-muted">Hari ini</button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
});

// Pintasan periode untuk filter Dari–Sampai: onPick({ from, to }) dalam 'yyyy-mm-dd'.
export function PeriodPresets({ onPick, className }) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const presets = [
    ['Bulan ini', new Date(y, m, 1), now],
    ['Bulan lalu', new Date(y, m - 1, 1), new Date(y, m, 0)],
    ['Tahun ini', new Date(y, 0, 1), now],
  ];
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {presets.map(([label, a, b]) => (
        <button key={label} type="button" onClick={() => onPick({ from: toYmd(a), to: toYmd(b) })}
          className="h-9 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-muted whitespace-nowrap">{label}</button>
      ))}
    </div>
  );
}
