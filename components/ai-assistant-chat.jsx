'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Send, Bot, User as UserIcon, Loader2, Check, X, ShieldAlert,
  CheckCircle2, AlertCircle, Trash2, Wand2, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'Ringkasan bisnis keseluruhan',
  'Tampilkan 5 sales order terbaru',
  'Produk apa saja yang stoknya di bawah minimum?',
  'Berapa total piutang yang belum lunas?',
];

function genId() {
  try { return crypto.randomUUID(); } catch { return 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
}

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

export default function AIAssistantChat({ compact = false, onNavigate }) {
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    } finally { setBusy(false); }
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
        ...m, pendingActions: m.pendingActions.map(x => x.id === pa.id ? { ...x, state: 'done', result: data.message, link: data.link || null } : x),
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
  const chips = compact ? SUGGESTIONS.slice(0, 3) : SUGGESTIONS;

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 relative">
        {messages.length > 0 && (
          <div className="sticky top-0 z-10 flex justify-end -mt-1 mb-1 pointer-events-none">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground pointer-events-auto bg-white/80 backdrop-blur" onClick={clearChat}>
              <Trash2 className="w-3.5 h-3.5 mr-1" />Bersihkan
            </Button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center mb-3">
              <Wand2 className="w-7 h-7 text-indigo-500" />
            </div>
            <h2 className="font-semibold text-base">Halo! Ada yang bisa saya bantu?</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">Cari data, buat ringkasan, atau perintahkan aksi (dengan konfirmasi Anda).</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-lg">
              {chips.map((sug, i) => (
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
            <div className={cn('max-w-[85%] space-y-2', m.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn('rounded-2xl px-4 py-2.5',
                m.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-sm'
                  : m.error ? 'bg-red-50 text-red-700 border border-red-200 rounded-tl-sm'
                    : 'bg-slate-100 text-slate-800 rounded-tl-sm')}>
                {m.role === 'user' ? <div className="text-sm whitespace-pre-wrap">{m.content}</div> : <RichText text={m.content} />}
              </div>

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
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2 text-sm text-emerald-700 font-medium"><CheckCircle2 className="w-4 h-4" />{pa.result || 'Berhasil dijalankan.'}</div>
                          {pa.link && (
                            <Link href={pa.link} onClick={() => onNavigate && onNavigate()}>
                              <Button size="sm" variant="outline" className="h-8 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />Buka detail
                              </Button>
                            </Link>
                          )}
                        </div>
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

      <div className="border-t p-3 bg-white">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ketik pertanyaan atau perintah..." disabled={busy} className="flex-1" />
          <Button type="submit" disabled={busy || !input.trim()} className="bg-indigo-600 hover:bg-indigo-700">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Asisten AI dapat keliru. Setiap aksi tulis memerlukan konfirmasi Anda.</p>
      </div>
    </div>
  );
}
