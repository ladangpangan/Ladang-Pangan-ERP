'use client';

import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import AIAssistantChat from '@/components/ai-assistant-chat';

export default function FloatingAIAssistant() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Panel */}
      <div
        className={cn(
          'fixed z-[60] bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[400px] h-[560px] max-h-[calc(100vh-8rem)]',
          'bg-white rounded-2xl shadow-2xl border flex flex-col overflow-hidden origin-bottom-right transition-all duration-200',
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

      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'fixed z-[60] bottom-5 right-4 sm:right-6 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-xl transition-all duration-200 hover:scale-105 active:scale-95',
          'bg-gradient-to-br from-violet-500 to-indigo-600'
        )}
        aria-label="Buka Asisten AI"
      >
        {open ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </button>
    </>
  );
}
