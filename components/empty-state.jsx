'use client';
import { Button } from '@/components/ui/button';

// Tampilan "belum ada data" yang memberi tahu langkah berikutnya.
// action: { label, onClick } atau { label, href }.
export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-4">
      {Icon && <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center text-muted-foreground"><Icon className="w-5 h-5" /></div>}
      <div className="font-medium text-foreground">{title}</div>
      {hint && <p className="text-sm text-muted-foreground max-w-sm">{hint}</p>}
      {action && (action.href
        ? <Button asChild size="sm" className="mt-1"><a href={action.href}>{action.label}</a></Button>
        : <Button size="sm" className="mt-1" onClick={action.onClick}>{action.label}</Button>)}
    </div>
  );
}

// Versi untuk di dalam <TableBody>.
export function EmptyRow({ colSpan, ...props }) {
  return <tr><td colSpan={colSpan}><EmptyState {...props} /></td></tr>;
}
