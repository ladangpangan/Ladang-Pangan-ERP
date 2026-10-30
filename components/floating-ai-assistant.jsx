'use client';

import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import AIAssistantChat from '@/components/ai-assistant-chat';

// Asisten AI: tombol di header + panel melayang di kanan atas.
export default function FloatingAIAssistant() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Panel */}
      <div
        className={cn(
          'fixed z-[60] top-[4.5rem] right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[400px] h-[560px] max-h-[calc(100vh-6rem)]',
          'bg-white rounded-2xl shadow-2xl border flex flex-col overflow-hidden origin-top-right transition-all duration-200',
          open ? 'scale-100 opacity-100 pointer-events-auto' : 'scale-90 opacity-0 pointer-events-none'
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            <div className="font-semibold text-sm">Asisten AI</div>
          </div>
          <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-white/20 transition-colors" aria-label="Tutup">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {open && <AIAssistantChat compact onNavigate={() => setOpen(false)} />}
        </div>
      </div>

      {/* Tombol di header (dulu tombol mengambang yang menutupi isi halaman) */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'h-9 px-2.5 sm:px-3 rounded-lg flex items-center gap-1.5 text-sm font-medium transition-colors',
          open ? 'bg-violet-600 text-white' : 'text-violet-700 hover:bg-violet-50'
        )}
        aria-label={open ? 'Tutup Asisten AI' : 'Buka Asisten AI'}
        aria-expanded={open}
      >
        {open ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
        <span className="hidden sm:inline">Asisten AI</span>
      </button>
    </>
  );
}
