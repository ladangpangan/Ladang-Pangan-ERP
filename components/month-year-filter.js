'use client';

import { useMemo, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';

export const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// Convert a date-like value to a 'YYYY-MM' key using LOCAL components
// (consistent with how order dates are displayed via date-fns format()).
export const ymKey = (v) => {
  if (v == null || v === '') return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Hook: manages Month/Year selection (default = current month) and returns the
// filtered subset of `items` by `dateField`. month='all' => whole selected year.
export function useMonthFilter(items, dateField = 'orderDate') {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(now.getFullYear()));

  const years = useMemo(() => {
    const set = new Set();
    for (const it of (items || [])) {
      const k = ymKey(it?.[dateField]);
      if (k) set.add(k.slice(0, 4));
    }
    set.add(String(now.getFullYear()));
    return [...set].sort((a, b) => b.localeCompare(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, dateField]);

  const filtered = useMemo(() => (items || []).filter((it) => {
    const k = ymKey(it?.[dateField]);
    if (!k) return false;
    const [ry, rm] = k.split('-');
    if (ry !== year) return false;
    if (month !== 'all' && rm !== month) return false;
    return true;
  }), [items, dateField, month, year]);

  const label = month === 'all' ? `Tahun ${year}` : `${MONTHS_ID[Number(month) - 1]} ${year}`;

  return { month, setMonth, year, setYear, years, filtered, label };
}

export function MonthYearFilter({ month, setMonth, year, setYear, years = [], className }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <CalendarRange className="w-4 h-4 text-muted-foreground shrink-0" />
      <Select value={month} onValueChange={setMonth}>
        <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Bulan" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Bulan</SelectItem>
          {MONTHS_ID.map((m, i) => (
            <SelectItem key={i} value={String(i + 1).padStart(2, '0')}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={year} onValueChange={setYear}>
        <SelectTrigger className="w-[100px] h-9"><SelectValue placeholder="Tahun" /></SelectTrigger>
        <SelectContent>
          {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
