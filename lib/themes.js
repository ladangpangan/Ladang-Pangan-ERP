// Selectable accent/brand colour themes for the app UI.
// Values are HSL triplets matching the CSS tokens in globals.css so they can be
// applied at runtime by writing CSS variables on <html>.

export const THEMES = {
  emerald: { name: 'Emerald', dot: '#107A57', primary: '160 76% 27%', ring: '160 70% 32%', accent: '152 45% 95%', accentFg: '160 76% 22%' },
  blue:    { name: 'Biru',    dot: '#2456C7', primary: '222 72% 42%', ring: '222 72% 46%', accent: '214 90% 95%', accentFg: '222 72% 32%' },
  teal:    { name: 'Teal',    dot: '#0F766E', primary: '178 70% 28%', ring: '178 65% 32%', accent: '178 55% 95%', accentFg: '178 70% 20%' },
  violet:  { name: 'Violet',  dot: '#6D3BD1', primary: '262 60% 48%', ring: '262 60% 52%', accent: '262 70% 96%', accentFg: '262 60% 34%' },
  rose:    { name: 'Rose',    dot: '#D42A5B', primary: '347 70% 46%', ring: '347 70% 50%', accent: '347 80% 96%', accentFg: '347 70% 36%' },
  slate:   { name: 'Slate',   dot: '#1E293B', primary: '222 47% 16%', ring: '222 30% 30%', accent: '210 40% 96%', accentFg: '222 47% 16%' },
};
export const THEME_KEYS = Object.keys(THEMES);
export const DEFAULT_ACCENT_KEY = 'emerald';

// Apply a theme by writing CSS variables on the document root (client only).
export function applyAccent(key) {
  if (typeof document === 'undefined') return;
  const t = THEMES[key] || THEMES[DEFAULT_ACCENT_KEY];
  const r = document.documentElement;
  const s = (a, b) => r.style.setProperty(a, b);
  s('--primary', t.primary); s('--primary-foreground', '0 0% 100%');
  s('--ring', t.ring);
  s('--accent', t.accent); s('--accent-foreground', t.accentFg);
  s('--sidebar-primary', t.primary); s('--sidebar-primary-foreground', '0 0% 100%');
  s('--sidebar-accent', t.accent); s('--sidebar-accent-foreground', t.accentFg);
  s('--sidebar-ring', t.ring);
}
