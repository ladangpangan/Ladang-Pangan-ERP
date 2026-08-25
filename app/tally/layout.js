import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/auth';

export default async function TallyLayout({ children }) {
  let session = null;
  try { session = await getAuth().api.getSession({ headers: await headers() }); } catch (e) { /* ignore */ }
  if (!session?.user) redirect('/login');
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {children}
    </div>
  );
}
