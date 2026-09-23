import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getRepository } from '@/lib/data';
import { getMeetingBrief } from '@/lib/application/meeting-brief-service';
import Page from './page';

vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/application/meeting-brief-service', () => ({ getMeetingBrief: vi.fn(), buildMeetingBrief: vi.fn(), refreshMeetingBrief: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: () => { throw new Error('NEXT_REDIRECT'); } }));
beforeEach(() => {
  vi.mocked(getRepository).mockResolvedValue({ repository: { get: async () => ({ id: 'contact-a' }) }, meetingBriefRepository: {} } as unknown as Awaited<ReturnType<typeof getRepository>>);
});
describe('Meeting brief route identity', () => {
  it('rejects an accessible snapshot belonging to another contact instead of swallowing notFound', async () => {
    vi.mocked(getMeetingBrief).mockResolvedValue({ snapshot: { subjectContactId: 'contact-b' } } as Awaited<ReturnType<typeof getMeetingBrief>>);
    await expect(Page({ params: Promise.resolve({ id: 'contact-a' }), searchParams: Promise.resolve({ snapshotId: 'snapshot-b' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
  it('preserves the contact fallback when briefing persistence is unavailable', async () => {
    vi.mocked(getMeetingBrief).mockRejectedValue(new Error('secret database details must stay server-side'));
    const result = await Page({ params: Promise.resolve({ id: 'contact-a' }), searchParams: Promise.resolve({ snapshotId: 'snapshot-a' }) });
    const html = renderToStaticMarkup(result);
    expect(html).not.toContain('secret database');
    expect(html).toContain('temporarily unavailable');
  });
});
