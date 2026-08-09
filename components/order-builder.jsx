'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Plus, Trash2, ShoppingCart, TrendingUp, CheckCircle2,
  AlertCircle, ExternalLink, ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const nf = new Intl.NumberFormat('id-ID');
const money = (n) => 'Rp' + nf.format(Math.round(Number(n || 0)));

function newItem() {
  return { key: Math.random().toString(36).slice(2), productId: '', weight: '', quantity: '', unitPrice: '', discount: '' };
}

export default function OrderBuilder({ orderType: initialType = null, onNavigate, onDone }) {
  const [orderType, setOrderType] = useState(initialType);
  const [opts, setOpts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // {ok, message, link, number}
  const [errorMsg, setErrorMsg] = useState('');

  // form state
  const [contactId, setContactId] = useState('');       // customer (SO) or supplier (PO)
  const [fulfillmentType, setFulfillmentType] = useState('stock');
  const [dropshipSupplierId, setDropshipSupplierId] = useState('');
  const [dropshipperId, setDropshipperId] = useState('');
  const [poType, setPoType] = useState('Bahan Baku');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([newItem()]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/ai/options');
        const data = await res.json();
        if (alive) setOpts(data);
      } catch (e) { if (alive) setErrorMsg('Gagal memuat pilihan data.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const productMap = useMemo(() => {
    const m = {};
    (opts?.products || []).forEach(p => { m[p.id] = p; });
    return m;
  }, [opts]);

  const updateItem = (key, patch) => setItems(prev => prev.map(it => it.key === key ? { ...it, ...patch } : it));
  const removeItem = (key) => setItems(prev => (prev.length > 1 ? prev.filter(it => it.key !== key) : prev));
  const addItem = () => setItems(prev => [...prev, newItem()]);

  const onSelectProduct = (key, productId) => {
    const p = productMap[productId];
    setItems(prev => prev.map(it => it.key === key
      ? { ...it, productId, unitPrice: (it.unitPrice === '' || it.unitPrice == null) ? (p ? String(p.basePrice || '') : '') : it.unitPrice }
      : it));
  };

  const lineTotal = (it) => {
    const basis = Number(it.weight || it.quantity || 0);
    const price = Number(it.unitPrice || 0);
    const disc = Number(it.discount || 0);
    return Math.max(0, price * basis - disc);
  };
  const grandTotal = items.reduce((a, it) => a + lineTotal(it), 0);

  const isSO = orderType === 'SO';
  const isPO = orderType === 'PO';

  const validItems = items.filter(it => it.productId && Number(it.weight || it.quantity || 0) > 0);
  const canSubmit = orderType && contactId && validItems.length > 0 &&
    (!isSO || fulfillmentType !== 'dropship' || dropshipSupplierId);

  const submit = async () => {
    setErrorMsg('');
    if (!canSubmit) { setErrorMsg('Lengkapi kontak dan minimal 1 item (produk + berat/jumlah).'); return; }
    setSubmitting(true);
    try {
      const payloadItems = validItems.map(it => ({
        productId: it.productId,
        weight: Number(it.weight || 0),
        quantity: Number(it.quantity || 0),
        unitPrice: Number(it.unitPrice || 0),
        discount: Number(it.discount || 0),
      }));
      let url, body, numberField, basePath;
      if (isSO) {
        url = '/api/sales-orders';
        body = {
          customerId: contactId,
          fulfillmentType,
          supplierId: fulfillmentType === 'dropship' ? dropshipSupplierId : undefined,
          dropshipperId: dropshipperId || undefined,
          notes: notes || undefined,
          items: payloadItems,
        };
        numberField = 'soNumber'; basePath = '/dashboard/sales-orders';
      } else {
        url = '/api/purchase-orders';
        body = { supplierId: contactId, poType, notes: notes || undefined, items: payloadItems };
        numberField = 'poNumber'; basePath = '/dashboard/purchase-orders';
      }
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Gagal membuat order');
      const created = data.data || {};
      const number = created[numberField] || '';
      const link = created.id ? `${basePath}/${created.id}` : basePath;
      const msg = `${isSO ? 'Sales Order' : 'Purchase Order'} ${number} berhasil dibuat (Draft, total ${money(grandTotal)}).`;
      setResult({ ok: true, message: msg, link, number });
      if (onDone) onDone({ message: msg, link });
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- render ----------
  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Memuat formulir...
      </div>
    );
  }

  if (result?.ok) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-emerald-800 font-medium"><CheckCircle2 className="w-4 h-4" />{result.message}</div>
        {result.link && (
          <Link href={result.link} onClick={() => onNavigate && onNavigate()}>
            <Button size="sm" variant="outline" className="h-8 border-emerald-300 text-emerald-700 hover:bg-emerald-100">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />Buka detail order
            </Button>
          </Link>
        )}
      </div>
    );
  }

  const contactOptions = isPO ? (opts?.suppliers || []) : (opts?.customers || []);

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
        <ClipboardList className="w-4 h-4" /> Formulir Buat Order
      </div>

      {/* Order type selector */}
      {!orderType && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Pilih jenis order:</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 h-9" onClick={() => setOrderType('SO')}>
              <TrendingUp className="w-4 h-4 mr-1.5 text-emerald-600" />Sales Order
            </Button>
            <Button size="sm" variant="outline" className="flex-1 h-9" onClick={() => setOrderType('PO')}>
              <ShoppingCart className="w-4 h-4 mr-1.5 text-blue-600" />Purchase Order
            </Button>
          </div>
        </div>
      )}

      {orderType && (
        <>
          <div className="flex items-center gap-2">
            <span className={cn('text-[10px] uppercase font-bold px-2 py-0.5 rounded', isSO ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700')}>
              {isSO ? 'Sales Order' : 'Purchase Order'}
            </span>
            {!initialType && (
              <button className="text-[11px] text-muted-foreground underline" onClick={() => { setOrderType(null); setContactId(''); }}>ganti</button>
            )}
          </div>

          {/* Contact */}
          <div className="space-y-1">
            <label className="text-xs font-medium">{isPO ? 'Supplier' : 'Customer'} <span className="text-red-500">*</span></label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger className="h-9 bg-white"><SelectValue placeholder={`Pilih ${isPO ? 'supplier' : 'customer'}...`} /></SelectTrigger>
              <SelectContent className="z-[80]">
                {contactOptions.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Tidak ada data</div>}
                {contactOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* SO: fulfillment + dropship */}
          {isSO && (
            <div className="grid grid-cols-1 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Jenis Pemenuhan</label>
                <Select value={fulfillmentType} onValueChange={setFulfillmentType}>
                  <SelectTrigger className="h-9 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[80]">
                    {(opts?.fulfillmentTypes || []).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {fulfillmentType === 'dropship' && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Supplier (dropship) <span className="text-red-500">*</span></label>
                    <Select value={dropshipSupplierId} onValueChange={setDropshipSupplierId}>
                      <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Pilih supplier..." /></SelectTrigger>
                      <SelectContent className="z-[80]">
                        {(opts?.suppliers || []).map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Dropshipper (opsional)</label>
                    <Select value={dropshipperId} onValueChange={setDropshipperId}>
                      <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Pilih dropshipper..." /></SelectTrigger>
                      <SelectContent className="z-[80]">
                        {(opts?.dropshippers || []).map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>
          )}

          {/* PO: poType */}
          {isPO && (
            <div className="space-y-1">
              <label className="text-xs font-medium">Jenis PO</label>
              <Select value={poType} onValueChange={setPoType}>
                <SelectTrigger className="h-9 bg-white"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[80]">
                  {(opts?.poTypes || []).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Items */}
          <div className="space-y-2">
            <label className="text-xs font-medium">Item Produk <span className="text-red-500">*</span></label>
            {items.map((it, idx) => (
              <div key={it.key} className="rounded-lg border bg-white p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-4">{idx + 1}.</span>
                  <div className="flex-1">
                    <Select value={it.productId} onValueChange={(v) => onSelectProduct(it.key, v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih produk..." /></SelectTrigger>
                      <SelectContent className="z-[80]">
                        {(opts?.products || []).map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <button onClick={() => removeItem(it.key)} className="text-slate-400 hover:text-red-500" disabled={items.length === 1}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" placeholder="Berat (kg)" className="h-8 text-xs" value={it.weight} onChange={(e) => updateItem(it.key, { weight: e.target.value })} />
                  <Input type="number" placeholder="Jumlah (unit)" className="h-8 text-xs" value={it.quantity} onChange={(e) => updateItem(it.key, { quantity: e.target.value })} />
                  <Input type="number" placeholder="Harga /kg" className="h-8 text-xs" value={it.unitPrice} onChange={(e) => updateItem(it.key, { unitPrice: e.target.value })} />
                  {isSO
                    ? <Input type="number" placeholder="Diskon (Rp)" className="h-8 text-xs" value={it.discount} onChange={(e) => updateItem(it.key, { discount: e.target.value })} />
                    : <div className="flex items-center justify-end text-xs text-muted-foreground pr-1">{money(lineTotal(it))}</div>}
                </div>
                {isSO && <div className="text-right text-[11px] text-muted-foreground">Subtotal: {money(lineTotal(it))}</div>}
              </div>
            ))}
            <Button size="sm" variant="ghost" className="h-7 text-xs text-indigo-600" onClick={addItem}>
              <Plus className="w-3.5 h-3.5 mr-1" />Tambah item
            </Button>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium">Catatan (opsional)</label>
            <Input className="h-9 bg-white" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan order..." />
          </div>

          {/* Total + submit */}
          <div className="flex items-center justify-between pt-1 border-t">
            <div className="text-sm">Total: <span className="font-bold text-indigo-900">{money(grandTotal)}</span></div>
            <Button size="sm" className="h-9 bg-indigo-600 hover:bg-indigo-700" onClick={submit} disabled={!canSubmit || submitting}>
              {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Buat Draft {isSO ? 'SO' : 'PO'}
            </Button>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 text-xs text-red-600"><AlertCircle className="w-4 h-4" />{errorMsg}</div>
          )}
        </>
      )}
    </div>
  );
}
