import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { INITIAL_WEBSITE_INTAKE_ACTION_STATE } from './website-intake-action-state';
import { configureWebsiteIntakeAction } from './actions';

vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

function form(origin = 'https://judith.example') {
  const value = new FormData();
  value.set('displayName', 'Judith website');
  value.set('allowedOrigins', origin);
  value.set('rateLimitPerMinute', '20');
  value.set('responseSlaMinutes', '5');
  return value;
}

describe('website intake setup action', () => {
  const rpc = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OMNIX_WEBSITE_INTAKE_ENDPOINT_KEY', 'judith-web');
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      workspaceScope: { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live', role: 'owner' },
    } as Awaited<ReturnType<typeof getRepository>>);
    rpc.mockResolvedValue({ data: { enabled: true }, error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as never);
  });

  it('configures the server-bound endpoint without accepting a key from the browser', async () => {
    const result = await configureWebsiteIntakeAction(INITIAL_WEBSITE_INTAKE_ACTION_STATE, form());
    expect(result.status).toBe('success');
    expect(rpc).toHaveBeenCalledWith('configure_website_intake_endpoint', expect.objectContaining({
      target_endpoint_key: 'judith-web',
      target_allowed_origins: ['https://judith.example'],
      target_response_sla_minutes: 5,
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('secret');
  });

  it('rejects assistants before opening the database client', async () => {
    vi.mocked(getRepository).mockResolvedValue({
      isLive: true,
      workspaceScope: { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live', role: 'assistant' },
    } as Awaited<ReturnType<typeof getRepository>>);
    const result = await configureWebsiteIntakeAction(INITIAL_WEBSITE_INTAKE_ACTION_STATE, form());
    expect(result).toEqual({ status: 'error', message: 'Only the workspace owner can change website lead intake.' });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('rejects unsafe origins before the configuration RPC', async () => {
    const result = await configureWebsiteIntakeAction(INITIAL_WEBSITE_INTAKE_ACTION_STATE, form('http://judith.example/path'));
    expect(result.status).toBe('error');
    expect(rpc).not.toHaveBeenCalled();
  });
});
