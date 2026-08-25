import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/auth';
import DashboardShell from './dashboard-shell';

export default async function DashboardLayout({ children }) {
  let session = null;
  try {
    session = await getAuth().api.getSession({ headers: await headers() });
  } catch (e) {}
  if (!session?.user) redirect('/login');
  // Operator role only has access to Tally App
  if (session.user.role === 'operator') redirect('/tally');
  return <DashboardShell user={session.user}>{children}</DashboardShell>;
}
