import './globals.css'
import Script from 'next/script'
import { Providers } from './providers'
import { THEMES } from '@/lib/themes'

export const metadata = {
  title: 'ERP PT Ladang Pangan Indonesia',
  description: 'Sistem ERP terintegrasi untuk operasi peternakan dan pengolahan unggas',
}

// Apply the saved brand colour before paint to avoid a flash of the default theme.
const themeScript = `(function(){try{var T=${JSON.stringify(THEMES)};var k=localStorage.getItem('erp-accent')||'emerald';var t=T[k]||T.emerald;var r=document.documentElement;var s=function(a,b){r.style.setProperty(a,b)};s('--primary',t.primary);s('--primary-foreground','0 0% 100%');s('--ring',t.ring);s('--accent',t.accent);s('--accent-foreground',t.accentFg);s('--sidebar-primary',t.primary);s('--sidebar-primary-foreground','0 0% 100%');s('--sidebar-accent',t.accent);s('--sidebar-accent-foreground',t.accentFg);s('--sidebar-ring',t.ring);}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-background font-sans antialiased">
        <Script id="accent-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
