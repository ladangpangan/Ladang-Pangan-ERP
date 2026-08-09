'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import AIAssistantChat from '@/components/ai-assistant-chat';

export default function AIAssistantPage() {
  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-7rem)]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
          <Sparkles className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight">Asisten AI ERP</h1>
          <p className="text-xs text-muted-foreground">Tanya data & jalankan aksi dengan bahasa natural</p>
        </div>
      </div>
      <Card className="flex-1 overflow-hidden">
        <AIAssistantChat />
      </Card>
    </div>
  );
}
