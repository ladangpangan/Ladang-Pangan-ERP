// Shared PDF branding + theme helpers for all documents.
// Holds company profile (Setting > Profil Perusahaan) and PDF settings
// (Setting > PDF & Dokumen) as module-level singletons so every generator
// (invoice.js, financial.js) uses the same elegant look & feel.

import { format } from 'date-fns';

export const DEFAULT_ACCENT = '#107A57';

const COMPANY_DEFAULTS = {
  name: 'PT LADANG PANGAN INDONESIA',
  address: 'Jl. Raya Cikarang No. 123, Bekasi, Jawa Barat 17530',
  contact: 'Telp: 021-5551000  ·  Email: info@lpi.co.id  ·  NPWP: 01.234.567.8-XXX.000',
  bank: '',
  logo: null,
};

export const PDF_DEFAULTS = {
  accent: DEFAULT_ACCENT,
  template: 'modern',            // modern | classic | minimal
  showLogo: true,
  logoSize: 22,                  // mm
  showWatermark: true,
  showSignature: true,
  showPayment: true,
  showPrintedAt: true,
  paymentInfo:
    'Transfer ke: Bank BCA · a/n PT Ladang Pangan Indonesia · No. Rek: 1234-567-890\nKonfirmasi pembayaran: keuangan@lpi.co.id / WA 0811-XXXX',
  signerLabel: 'Hormat kami,',
  signerName: 'PT Ladang Pangan Indonesia',
  footerNote: 'Dokumen ini digenerate otomatis oleh sistem ERP PT Ladang Pangan Indonesia',
};

// ---- module state ----
let _company = null;
let _settings = null;

export function setBranding({ company, settings } = {}) {
  if (company !== undefined) {
    _company = company && (company.name || company.address || company.contact || company.logo || company.bank) ? company : null;
  }
  if (settings !== undefined) _settings = settings || null;
}
// Backward-compatible setters (imported around the app)
export function setPdfCompany(c) { setBranding({ company: c }); }
export function setPdfSettings(cfg) { setBranding({ settings: cfg }); }

export function getCompany(override) {
  const src = override || _company || {};
  return {
    name: src.name || COMPANY_DEFAULTS.name,
    address: src.address || COMPANY_DEFAULTS.address,
    contact: src.contact || COMPANY_DEFAULTS.contact,
    bank: src.bank || COMPANY_DEFAULTS.bank,
    logo: src.logo || COMPANY_DEFAULTS.logo,
  };
}

export function getSettings() {
  return { ...PDF_DEFAULTS, ...(_settings || {}) };
}

// ---- color helpers ----
export function hexToRgb(hex, fb = [16, 122, 87]) {
  if (!hex) return fb;
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return fb;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// The effective accent respects the "minimal" template (monochrome slate).
export function accentRGB() {
  const st = getSettings();
  return st.template === 'minimal' ? [55, 65, 81] : hexToRgb(st.accent);
}
// mix a colour toward white; amt=0 keeps colour, amt=1 = white
export function tint(rgb, amt = 0.9) {
  const [r, g, b] = rgb;
  return [Math.round(r + (255 - r) * amt), Math.round(g + (255 - g) * amt), Math.round(b + (255 - b) * amt)];
}
// darken a colour toward black
export function shade(rgb, amt = 0.15) {
  const [r, g, b] = rgb;
  return [Math.round(r * (1 - amt)), Math.round(g * (1 - amt)), Math.round(b * (1 - amt))];
}

// ---- table styling ----
export function tableHeadStyle(extra = {}) {
  return { fillColor: accentRGB(), textColor: 255, fontSize: 8.9, halign: 'center', fontStyle: 'bold', cellPadding: { top: 2.6, bottom: 2.6, left: 2, right: 2 }, ...extra };
}

// ---- text-overflow safety helpers ----
// Truncate `text` (at the CURRENT font settings) so it fits within `maxWidth` mm,
// appending an ellipsis. Prevents right-aligned values from overlapping their labels
// and long single-line text from spilling out of its box / off the page.
export function ellipsize(doc, text, maxWidth) {
  let s = String(text == null ? '' : text);
  if (maxWidth <= 0) return '';
  if (doc.getTextWidth(s) <= maxWidth) return s;
  const ell = '\u2026';
  while (s.length > 1 && doc.getTextWidth(s + ell) > maxWidth) s = s.slice(0, -1);
  return s + ell;
}

/**
 * Draw an elegant, editorial document header (logo + company + accent title).
 * @returns {number} startY (mm) where body content should begin.
 */
export function drawDocHeader(doc, opts = {}) {
  const { title, docNumber, subtitle, company, centered = false } = opts;
  const co = getCompany(company);
  const st = getSettings();
  const tpl = st.template || 'minimal';
  const accent = accentRGB();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  // slim accent ribbon at very top (modern only)
  if (tpl === 'modern') { doc.setFillColor(accent[0], accent[1], accent[2]); doc.rect(0, 0, pageWidth, 2.5, 'F'); }

  // logo
  let textX = margin;
  const hasLogo = st.showLogo && co.logo;
  const logoSize = Math.min(Math.max(Number(st.logoSize) || 22, 10), 34);
  if (hasLogo) {
    try {
      const fmt = /png/i.test(co.logo) ? 'PNG' : 'JPEG';
      doc.addImage(co.logo, fmt, margin, 8, logoSize, logoSize, undefined, 'FAST');
      textX = margin + logoSize + 5;
    } catch (e) { /* skip broken logo */ }
  }

  // company name (accent, subtle letter-spacing)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14.5);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setCharSpace(0.3);
  doc.text(co.name, textX, 15.5);
  doc.setCharSpace(0);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(120);
  const wrapW = (centered ? pageWidth - margin : pageWidth - margin - 66) - textX;
  const addrLines = co.address ? doc.splitTextToSize(String(co.address), Math.max(wrapW, 40)) : [];
  let cy = 20.5;
  if (addrLines.length) { doc.text(addrLines, textX, cy); cy += addrLines.length * 4; }
  if (co.contact) { doc.text(String(co.contact), textX, cy); cy += 4; }

  if (centered) {
    // Letterhead: company block then centred report title with accent underline.
    const divY = Math.max(cy, 27);
    doc.setDrawColor(accent[0], accent[1], accent[2]); doc.setLineWidth(0.7);
    doc.line(margin, divY, pageWidth - margin, divY);
    doc.setDrawColor(...tint(accent, 0.6)); doc.setLineWidth(0.2);
    doc.line(margin, divY + 0.9, pageWidth - margin, divY + 0.9);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13.5); doc.setTextColor(35);
    doc.setCharSpace(0.7);
    doc.text(String(title || ''), pageWidth / 2, divY + 8, { align: 'center' });
    doc.setCharSpace(0);
    const uw = 26; doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(pageWidth / 2 - uw / 2, divY + 10, uw, 1, 'F');
    if (subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110); doc.text(String(subtitle), pageWidth / 2, divY + 15.5, { align: 'center' }); }
    doc.setTextColor(0); doc.setLineWidth(0.2);
    return divY + 21;
  }

  // Right-aligned big accent title with underline accent bar.
  const t = String(title || '').toUpperCase();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(23);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.setCharSpace(1.3);
  doc.text(t, pageWidth - margin, 15.5, { align: 'right' });
  const rawW = doc.getTextWidth(t);
  doc.setCharSpace(0);
  const uW = Math.min(Math.max(rawW + (t.length) * 1.3, 24), 62);
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(pageWidth - margin - uW, 18.5, uW, 1.3, 'F');
  if (docNumber) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110); doc.text(String(docNumber), pageWidth - margin, 25.5, { align: 'right' }); }
  if (subtitle) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(190, 45, 45); doc.text(String(subtitle), pageWidth - margin, 30, { align: 'right' }); }

  const divY = 35;
  doc.setDrawColor(accent[0], accent[1], accent[2]); doc.setLineWidth(0.7);
  doc.line(margin, divY, pageWidth - margin, divY);
  doc.setDrawColor(...tint(accent, 0.6)); doc.setLineWidth(0.2);
  doc.line(margin, divY + 0.9, pageWidth - margin, divY + 0.9);
  doc.setTextColor(0); doc.setLineWidth(0.2);
  return 42;
}

/** Diagonal watermark (e.g. INTERNAL copy). */
export function drawWatermark(doc, text = 'INTERNAL') {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  try {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(68);
    doc.setTextColor(242, 228, 228);
    doc.text(String(text), pageWidth / 2, pageHeight / 2 + 10, { align: 'center', angle: 35 });
  } catch (e) { /* ignore */ }
  doc.setTextColor(0);
}

/** Fixed elegant footer on every page: accent hairline + note + printed + page number. */
export function drawFooter(doc, opts = {}) {
  const st = getSettings();
  const accent = accentRGB();
  const note = opts.note !== undefined ? opts.note : st.footerNote;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(accent[0], accent[1], accent[2]); doc.setLineWidth(0.5);
    doc.line(margin, pageHeight - 13.5, pageWidth - margin, pageHeight - 13.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4); doc.setTextColor(150);
    if (note) doc.text(String(note), margin, pageHeight - 8.5, { maxWidth: pageWidth - margin * 2 - 62 });
    const right = [];
    if (st.showPrintedAt) right.push('Dicetak ' + format(new Date(), 'dd/MM/yyyy HH:mm'));
    right.push(`Hal ${i}/${n}`);
    doc.text(right.join('   ·   '), pageWidth - margin, pageHeight - 8.5, { align: 'right' });
  }
  doc.setTextColor(0); doc.setLineWidth(0.2);
}
