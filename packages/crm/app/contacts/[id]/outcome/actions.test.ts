import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepository } from '@/lib/data';
import { createCaptureOutcomeService } from '@/lib/application/capture-outcome-service';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import { captureOutcomeAction } from './actions';
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/application/capture-outcome-service', () => ({ createCaptureOutcomeService: vi.fn() }));
vi.mock('@/lib/application/workspace-ai-settings', () => ({ loadWorkspaceAiRuntimeCredential: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/application/omnix-provider-server-gateway', () => ({ createOmnixProviderServerGateway: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const analyze = vi.fn(); const get = vi.fn(); const confirm = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRepository).mockResolvedValue({ repository: { get: async () => ({ id: 'contact-a' }) }, workspaceScope: SAMPLE_WORKSPACE_SCOPE, captureOutcomeRepository: {} } as unknown as Awaited<ReturnType<typeof getRepository>>);
  vi.mocked(createCaptureOutcomeService).mockReturnValue({ analyze, get, confirm } as unknown as ReturnType<typeof createCaptureOutcomeService>);
});
describe('Capture action authority', () => {
  it('uses resolved membership scope and canonical contact identity for preparation', async () => {
    analyze.mockResolvedValue({ id: 'proposal-a' });
    await captureOutcomeAction({ command: 'analyze', contactId: 'alias-a', sourceText: 'Recap', idempotencyKey: 'key-a', manualOnly: true });
    expect(analyze).toHaveBeenCalledWith(SAMPLE_WORKSPACE_SCOPE, expect.objectContaining({ contactId: 'contact-a', sourceText: 'Recap' }));
  });
  it('refuses a proposal attached to another contact before confirmation', async () => {
    get.mockResolvedValue({ id: 'proposal-b', contactId: 'contact-b' });
    expect(await captureOutcomeAction({ command: 'confirm', contactId: 'contact-a', proposalId: 'proposal-b', version: 1, contentHash: 'hash' })).toEqual({ error: 'This review is unavailable for the selected contact.' });
    expect(confirm).not.toHaveBeenCalled();
  });
});
