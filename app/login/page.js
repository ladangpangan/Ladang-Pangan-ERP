'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ChickenIcon, Egg, Beef, Wheat } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@lpi.co.id');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        setError(error.message || 'Login gagal');
      } else {
        toast.success('Login berhasil');
        router.push('/dashboard');
        router.refresh();
      }
    } catch (e) {
      setError('Terjadi kesalahan: ' + e.message);
    } finally { setLoading(false); }
  };

  const handleSeed = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const data = await res.json();
      if (data.seeded) toast.success('Data awal berhasil dibuat');
      else toast.info(data.message || 'Sudah ada data');
    } catch (e) { toast.error('Gagal seed: ' + e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-emerald-50 via-white to-amber-50">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-emerald-600 to-emerald-800 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-amber-300 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
              <Wheat className="w-7 h-7" />
            </div>
            <div>
              <div className="font-bold text-xl leading-tight">PT Ladang Pangan</div>
              <div className="text-emerald-100 text-sm">Indonesia</div>
            </div>
          </div>
        </div>
        <div className="relative z-10 space-y-6">
          <h1 className="text-4xl font-bold leading-tight">Sistem ERP Terintegrasi<br/>untuk Bisnis Unggas Modern</h1>
          <p className="text-emerald-50 text-lg leading-relaxed">Kelola pengadaan ayam hidup, produksi RPH, cold storage, hingga penjualan B2B dalam satu platform terpadu.</p>
          <div className="grid grid-cols-2 gap-4 pt-4">
            {[
              { label: 'Traceability', desc: 'End-to-end tracking' },
              { label: 'FIFO/FEFO', desc: 'Cold storage optimal' },
              { label: 'COGS Real-time', desc: 'Yield & margin' },
              { label: 'Tally App', desc: 'Offline production' },
            ].map(f => (
              <div key={f.label} className="p-4 bg-white/10 backdrop-blur rounded-lg">
                <div className="font-semibold">{f.label}</div>
                <div className="text-sm text-emerald-100">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-emerald-100 text-sm">© {new Date().getFullYear()} PT Ladang Pangan Indonesia</div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center text-white">
              <Wheat className="w-7 h-7" />
            </div>
            <div>
              <div className="font-bold text-lg">PT Ladang Pangan</div>
              <div className="text-muted-foreground text-xs">Indonesia ERP</div>
            </div>
          </div>
          <Card className="border-none shadow-xl">
            <CardHeader>
              <CardTitle className="text-2xl">Masuk ke Sistem</CardTitle>
              <CardDescription>Gunakan akun yang telah diberikan oleh administrator.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@lpi.co.id" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Masuk
                </Button>
              </form>
              <div className="mt-6 pt-6 border-t">
                <p className="text-sm text-muted-foreground mb-3">Akun demo untuk testing:</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { r: 'Admin', e: 'admin@lpi.co.id', p: 'admin123' },
                    { r: 'Supervisor', e: 'supervisor@lpi.co.id', p: 'super123' },
                    { r: 'Direktur', e: 'direktur@lpi.co.id', p: 'direktur123' },
                    { r: 'Operator', e: 'operator@lpi.co.id', p: 'operator123' },
                  ].map(a => (
                    <button key={a.e} type="button" onClick={() => { setEmail(a.e); setPassword(a.p); }}
                      className="p-2 rounded border hover:bg-muted text-left">
                      <div className="font-semibold">{a.r}</div>
                      <div className="text-muted-foreground truncate">{a.e}</div>
                    </button>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="w-full mt-3" onClick={handleSeed} disabled={loading}>
                  Inisialisasi Data Awal (jika belum)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
