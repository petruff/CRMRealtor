import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { createMailchimpCampaignDraftCommand } from '@/lib/application/mailchimp-campaign-service';
import { createCampaignDraftAction } from './actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }) }));
vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/data/mailchimp-operation-server-context', () => ({ createMailchimpServerRepository: vi.fn(() => ({ campaigns: {} })) }));
vi.mock('@/lib/application/mailchimp-campaign-service', () => ({
  createMailchimpCampaignDraftCommand: vi.fn(async () => ({ eligibleCount: 12 })),
  executeMailchimpCampaignActionCommand: vi.fn(),
  updateMailchimpCampaignDraftCommand: vi.fn(),
}));

function form(message: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ segment: 'all-subscribers', title: 'Sept', subject: 'Market update', previewText: 'Quick update', fromName: 'Paula', replyTo: 'p@example.com', connectionId: 'c', message })) data.set(key, value);
  return data;
}

describe('campaign Fair Housing guard', () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
    vi.mocked(createMailchimpCampaignDraftCommand).mockClear();
    vi.mocked(getRepository).mockResolvedValue({ isLive: true, workspaceScope: {} } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  it('refuses to draft marketing copy with an excluding phrase and says what to rephrase', async () => {
    await expect(createCampaignDraftAction(form('New condo downtown — adults only.'))).rejects.toThrow('NEXT_REDIRECT');
    expect(createMailchimpCampaignDraftCommand).not.toHaveBeenCalled();
    expect(vi.mocked(redirect).mock.calls[0]?.[0]).toContain(encodeURIComponent('“adults only”').replaceAll('%20', '+'));
  });

  it('lets clean copy through', async () => {
    await expect(createCampaignDraftAction(form('Three new listings near Bayshore this week.'))).rejects.toThrow('NEXT_REDIRECT');
    expect(createMailchimpCampaignDraftCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(redirect).mock.calls[0]?.[0]).toContain('success=');
  });
});
