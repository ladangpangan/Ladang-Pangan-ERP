'use client';

// Client-only context wrapper. QueryClient is created once at module load.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { setDefaultOptions } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';

// Semua tanggal tampil berbahasa Indonesia ("30 Okt 2026") tanpa perlu menyebut locale di tiap format().
setDefaultOptions({ locale: idLocale });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
