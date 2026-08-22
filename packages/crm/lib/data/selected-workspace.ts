import { cookies } from 'next/headers';

export const SELECTED_WORKSPACE_COOKIE = 'omnix_workspace_id';

export async function selectedWorkspaceId(): Promise<string | undefined> {
  try {
    const value = (await cookies()).get(SELECTED_WORKSPACE_COOKIE)?.value.trim();
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside a request scope')) return undefined;
    throw error;
  }
}
