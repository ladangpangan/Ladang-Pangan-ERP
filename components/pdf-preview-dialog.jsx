'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, Loader2 } from 'lucide-react';

/**
 * Preview a jsPDF document inline before printing or downloading it, instead of saving straight
 * to disk. Use the `usePdfPreview()` hook below — it manages the dialog + blob URL lifecycle so
 * callers just do `pdfPreview.show(doc, 'filename.pdf', 'Judul')` wherever they used to call
 * `doc.save('filename.pdf')`, and render `{pdfPreview.element}` once in the page.
 */
export function PdfPreviewDialog({ open, onOpenChange, url, filename, title }) {
  const iframeRef = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(false); }, [url]);

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };
  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'document.pdf';
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] h-[88vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-3 border-b">
          <DialogTitle className="text-base">{title || 'Preview PDF'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 relative bg-slate-100">
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {url && (
            <iframe
              ref={iframeRef}
              src={url}
              title={title || 'PDF Preview'}
              className="w-full h-full border-0"
              onLoad={() => setReady(true)}
            />
          )}
        </div>
        <DialogFooter className="p-3 border-t">
          <Button variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 mr-2" />Print</Button>
          <Button onClick={handleDownload}><Download className="w-4 h-4 mr-2" />Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function usePdfPreview() {
  const [state, setState] = useState({ open: false, url: null, filename: 'document.pdf', title: '' });
  const urlRef = useRef(null);

  const revoke = () => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  };

  // Accepts a jsPDF document instance.
  const show = useCallback((doc, filename, title) => {
    revoke();
    const url = doc.output('bloburl').toString();
    urlRef.current = url;
    setState({ open: true, url, filename: filename || 'document.pdf', title: title || '' });
  }, []);

  const onOpenChange = useCallback((v) => {
    if (!v) { revoke(); setState(s => ({ ...s, open: false, url: null })); }
  }, []);

  useEffect(() => () => revoke(), []);

  const element = (
    <PdfPreviewDialog open={state.open} onOpenChange={onOpenChange} url={state.url} filename={state.filename} title={state.title} />
  );

  return { show, element };
}
