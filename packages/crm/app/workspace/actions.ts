'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SELECTED_WORKSPACE_COOKIE } from '@/lib/data/selected-workspace';

export async function selectWorkspaceAction(formData: FormData): Promise<never> {
  const workspaceId = String(formData.get('workspaceId') ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) redirect('/workspace?switch=invalid');

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const { data, error } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) redirect('/workspace?switch=forbidden');

  (await cookies()).set(SELECTED_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
  redirect('/');
}
