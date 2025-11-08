'use server';

import { auth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect('/sign-in');
}
