'use client';

import { useState } from 'react';
import { TableHead } from '@/components/ui/table';
import { ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';

// -----------------------------------------------------------------------------
// useSort — client-side sorting hook for list tables (clickable column headers)
// Usage:
//   const sort = useSort();                      // no sort initially (server order)
//   const rows = sort.sortRows(data, {           // getters map: key -> (row) => value
//     code: r => r.code, total: r => r.totalAmount,
//   });
//   <SortHead field="code" sort={sort}>Kode</SortHead>
// -----------------------------------------------------------------------------
export function useSort(defaultKey = '', defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortRows = (rows, getters = {}) => {
    if (!sortKey || !Array.isArray(rows)) return rows || [];
    const get = getters[sortKey] || ((r) => (r ? r[sortKey] : undefined));
    const arr = [...rows];
    arr.sort((a, b) => {
      let va = get(a);
      let vb = get(b);
      if (va === null || va === undefined || va === '') return 1;   // empty last
      if (vb === null || vb === undefined || vb === '') return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        // Try numeric compare when both look numeric, else locale string compare
        const na = Number(va), nb = Number(vb);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) {
          return sortDir === 'asc' ? na - nb : nb - na;
        }
        return sortDir === 'asc' ? va.localeCompare(vb, 'id') : vb.localeCompare(va, 'id');
      }
      const na = Number(va), nb = Number(vb);
      if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
      return sortDir === 'asc' ? na - nb : nb - na;
    });
    return arr;
  };
  return { sortKey, sortDir, toggleSort, sortRows };
}

// Clickable, sortable table header cell.
export function SortHead({ field, sort, children, className = '', ...rest }) {
  const active = sort?.sortKey === field;
  return (
    <TableHead className={className} {...rest}>
      <button
        type="button"
        onClick={() => sort?.toggleSort(field)}
        className="inline-flex items-center gap-1 hover:text-emerald-700 font-medium select-none cursor-pointer"
      >
        {children}
        {active
          ? (sort.sortDir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)
          : <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />}
      </button>
    </TableHead>
  );
}

// Segmented control to switch between Aktif (active) and Arsip (archived) views.
export function ArchiveTabs({ value, onChange, activeLabel = 'Aktif', archivedLabel = 'Arsip', className = '' }) {
  const items = [['active', activeLabel], ['archived', archivedLabel]];
  return (
    <div className={`inline-flex rounded-lg border bg-slate-50 p-0.5 ${className}`}>
      {items.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-sm rounded-md transition ${
            value === v ? 'bg-white shadow-sm font-medium text-emerald-700' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Fire an archive / restore request. `resource` is the API segment
// (contacts | products | cold-storages | purchase-orders | sales-orders | work-orders | inventory-stocks | users)
export async function toggleArchive(resource, id, isCurrentlyArchived) {
  const action = isCurrentlyArchived ? 'restore' : 'archive';
  try {
    const res = await fetch(`/api/${resource}/${id}/${action}`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Gagal');
    toast.success(isCurrentlyArchived ? 'Data dipulihkan dari arsip' : 'Data diarsipkan');
    return true;
  } catch (e) {
    toast.error(e.message || 'Gagal memproses arsip');
    return false;
  }
}
