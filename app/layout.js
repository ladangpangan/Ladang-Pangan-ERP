import './globals.css'
import { Providers } from './providers'

export const metadata = {
  title: 'ERP PT Ladang Pangan Indonesia',
  description: 'Sistem ERP terintegrasi untuk operasi peternakan dan pengolahan unggas',
}

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
