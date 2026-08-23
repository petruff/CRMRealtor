import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function listAvailableWorkspaceMemberships(isLive: boolean) {
  if (!isLive) return [];
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(name)')
    .eq('user_id', auth.user.id)
    .eq('status', 'active');
  return data ?? [];
}
