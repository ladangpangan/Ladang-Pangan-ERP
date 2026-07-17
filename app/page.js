import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth/auth';

export default async function RootPage() {
  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    if (session?.user) redirect('/dashboard');
  } catch (e) {}
  redirect('/login');
}
