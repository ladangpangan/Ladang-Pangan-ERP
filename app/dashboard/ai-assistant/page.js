'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Sparkles, Send, Bot, User as UserIcon, Loader2, Check, X,
  ShieldAlert, CheckCircle2, AlertCircle, Trash2, Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'Ringkasan bisnis keseluruhan',
  'Tampilkan 5 sales order terbaru',
  'Produk apa saja yang stoknya di bawah minimum?',
  'Berapa total piutang yang belum lunas?',
  'Cari kontak kategori Supplier',
];

function genId() {
  try { return crypto.randomUUID(); } catch { return 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
}

// Very small markdown-ish renderer: **bold**, bullet lines, line breaks.
function RichText({ text }) {
  const lines = String(text || '').split('\n');
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((ln, i) => {
        const bullet = /^\s*[-*•]\s+/.test(ln);
        const clean = ln.replace(/^\s*[-*•]\s+/, '');
        const parts = clean.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
        const rendered = parts.map((p, j) =>
          p.startsWith('**') && p.endsWith('**')
            ? <strong key={j}>{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>
        );
        if (ln.trim() === '') return <div key={i} className="h-2" />;
        return bullet
          ? <div key={i} className="flex gap-2"><span className="text-emerald-600 mt-0.5">•</span><span>{rendered}</span></div>
          : <div key={i}>{rendered}</div>;
      })}
    </div>
  );
}

export default function AIAssistantPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId] = useState(genId);
  const scrollRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, busy, scrollToBottom]);

  const send = async (textArg) => {
    const text = (typeof textArg === 'string' ? textArg : input).trim();
    if (!text || busy) return;
    setInput('');
    const history = messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { id: genId(), role: 'user', content: text }]);
    setBusy(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Permintaan gagal');
      setMessages(prev => [...prev, {
        id: genId(), role: 'assistant', content: data.answer,
        pendingActions: (data.pendingActions || []).map(a => ({ ...a, state: 'pending' })),
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: genId(), role: 'assistant', content: 'Maaf, terjadi kesalahan: ' + e.message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (msgId, pa) => {
    setMessages(prev => prev.map(m => m.id !== msgId ? m : {
      ...m, pendingActions: m.pendingActions.map(x => x.id === pa.id ? { ...x, state: 'running' } : x),
    }));
    try {
      const res = await fetch('/api/ai/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pa.action, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Gagal menjalankan aksi');
      setMessages(prev => prev.map(m => m.id !== msgId ? m : {
        ...m, pendingActions: m.pendingActions.map(x => x.id === pa.id ? { ...x, state: 'done', result: data.message } : x),
      }));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id !== msgId ? m : {
        ...m, pendingActions: m.pendingActions.map(x => x.id === pa.id ? { ...x, state: 'error', result: e.message } : x),
      }));
    }
  };

  const cancelAction = (msgId, paId) => {
    setMessages(prev => prev.map(m => m.id !== msgId ? m : {
      ...m, pendingActions: m.pendingActions.map(x => x.id === paId ? { ...x, state: 'cancelled' } : x),
    }));
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Asisten AI ERP</h1>
            <p className="text-xs text-muted-foreground">Tanya data & jalankan aksi dengan bahasa natural</p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearChat}><Trash2 className="w-4 h-4 mr-1.5" />Bersihkan</Button>
        )}
      </div>

      {/* Chat area */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center mb-4">
                <Wand2 className="w-8 h-8 text-indigo-500" />
              </div>
              <h2 className="font-semibold text-lg">Halo! Ada yang bisa saya bantu?</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">Saya bisa mencari data, membuat ringkasan, dan (dengan konfirmasi Anda) melakukan aksi di ERP.</p>
              <div className="flex flex-wrap gap-2 justify-center mt-5 max-w-lg">
                {SUGGESTIONS.map((sug, i) => (
                  <button key={i} onClick={() => send(sug)} className="text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-slate-50 hover:border-indigo-300 transition-colors text-slate-700">
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                m.role === 'user' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700')}>
                {m.role === 'user' ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={cn('max-w-[80%] space-y-2', m.role === 'user' ? 'items-end' : 'items-start')}>
                <div className={cn('rounded-2xl px-4 py-2.5',
                  m.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-sm'
                    : m.error ? 'bg-red-50 text-red-700 border border-red-200 rounded-tl-sm'
                      : 'bg-slate-100 text-slate-800 rounded-tl-sm')}>
                  {m.role === 'user' ? <div className="text-sm whitespace-pre-wrap">{m.content}</div> : <RichText text={m.content} />}
                </div>

                {/* Pending action confirmation cards */}
                {Array.isArray(m.pendingActions) && m.pendingActions.map((pa) => (
                  <div key={pa.id} className="rounded-xl border border-amber-300 bg-amber-50 p-3 w-full">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-amber-900">Konfirmasi Aksi</div>
                        <div className="text-sm text-amber-800 mt-0.5">{pa.summary}</div>
                        {pa.details && Object.keys(pa.details).length > 0 && (
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-amber-900/80">
                            {Object.entries(pa.details).map(([k, v]) => (
                              <div key={k} className="contents"><span className="font-medium">{k}:</span><span>{String(v)}</span></div>
                            ))}
                          </div>
                        )}

                        {pa.state === 'pending' && (
                          <div className="flex gap-2 mt-3">
                            <Button size="sm" className="h-8 bg-amber-600 hover:bg-amber-700" onClick={() => runAction(m.id, pa)}>
                              <Check className="w-4 h-4 mr-1" />Konfirmasi & Jalankan
                            </Button>
                            <Button size="sm" variant="outline" className="h-8" onClick={() => cancelAction(m.id, pa.id)}>
                              <X className="w-4 h-4 mr-1" />Batal
                            </Button>
                          </div>
                        )}
                        {pa.state === 'running' && (
                          <div className="flex items-center gap-2 mt-3 text-sm text-amber-800"><Loader2 className="w-4 h-4 animate-spin" />Menjalankan...</div>
                        )}
                        {pa.state === 'done' && (
                          <div className="flex items-center gap-2 mt-3 text-sm text-emerald-700 font-medium"><CheckCircle2 className="w-4 h-4" />{pa.result || 'Berhasil dijalankan.'}</div>
                        )}
                        {pa.state === 'error' && (
                          <div className="flex items-center gap-2 mt-3 text-sm text-red-700 font-medium"><AlertCircle className="w-4 h-4" />{pa.result || 'Gagal.'}</div>
                        )}
                        {pa.state === 'cancelled' && (
                          <div className="flex items-center gap-2 mt-3 text-sm text-slate-500"><X className="w-4 h-4" />Dibatalkan.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0"><Bot className="w-4 h-4" /></div>
              <div className="bg-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />Sedang berpikir...
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t p-3 bg-white">
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ketik pertanyaan atau perintah..."
              disabled={busy}
              className="flex-1"
            />
            <Button type="submit" disabled={busy || !input.trim()} className="bg-indigo-600 hover:bg-indigo-700">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Asisten AI dapat keliru. Setiap aksi tulis memerlukan konfirmasi Anda.</p>
        </div>
      </Card>
    </div>
  );
}
