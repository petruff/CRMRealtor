import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Contact } from '@/lib/domain/contact';
import type { ContactRepository } from '@/lib/data/repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';

vi.mock('@/lib/data', () => ({ getRepository: vi.fn() }));
vi.mock('@/lib/application/smart-list-commands', () => ({
  listSmartListsCommand: vi.fn(async () => []),
  applySmartListCommand: vi.fn(),
}));

import { getRepository } from '@/lib/data';
import { listSmartListsCommand } from '@/lib/application/smart-list-commands';
import ContactsPage from './page';

const contact: Contact = {
  id: 'contact-a', firstName: 'Judith', lastName: 'Client', leadType: 'hot',
  relationship: 'lead', intent: 'buyer', source: 'referral', pipelineStage: 'new',
  tags: [], createdAt: '2026-08-25T12:00:00.000Z',
};

describe('ContactsPage repository pagination', () => {
  const list = vi.fn(async () => [contact]);
  const listPage = vi.fn(async (request: Parameters<NonNullable<ContactRepository['listPage']>>[0]) => ({
    items: [contact],
    total: 120,
    activeTotal: 501,
    scopeCounts: {
      leads: 120, clients: 80, 'active-clients': 50, 'past-clients': 30, 'needs-review': 10, all: 200,
    },
    leadTypeCounts: { hot: 60, warm: 30, nurture: 30 },
    offset: request.offset,
    limit: request.limit,
    aliasEpoch: 9,
  }));
  const listContactAggregates = vi.fn(async (_scope: unknown, contactIds: readonly string[]) => new Map(
    contactIds.map((contactId) => [contactId, {
      activityCount: 0, openTaskCount: 0, completedTaskCount: 0,
    }]),
  ));

  beforeEach(() => {
    list.mockClear();
    listPage.mockClear();
    listContactAggregates.mockClear();
    vi.mocked(listSmartListsCommand).mockResolvedValue([]);
    vi.mocked(getRepository).mockResolvedValue({
      repository: { list, listPage } as unknown as ContactRepository,
      smartListRepository: {},
      activityRepository: {
        listContactAggregates,
        listTasks: vi.fn(async () => []),
        listEvents: vi.fn(async () => []),
      },
      workspaceScope: SAMPLE_WORKSPACE_SCOPE,
      isLive: false,
    } as unknown as Awaited<ReturnType<typeof getRepository>>);
  });

  it('uses a bounded repository range and never calls the exhaustive list for an ordinary page', async () => {
    await ContactsPage({ searchParams: Promise.resolve({ page: '2' }) });

    expect(list).not.toHaveBeenCalled();
    expect(listPage).toHaveBeenCalledTimes(1);
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'leads', offset: 50, limit: 50,
    }));
    expect(listPage.mock.calls.every(([request]) => request.limit <= CONTACT_PAGE_LIMIT)).toBe(true);
  });

  it('passes search and filters to the canonical page without exhaustive client-side matching', async () => {
    await ContactsPage({ searchParams: Promise.resolve({
      q: 'Judith', leadType: 'hot', source: 'referral', scope: 'clients',
    }) });

    expect(list).not.toHaveBeenCalled();
    expect(listPage).toHaveBeenCalledTimes(1);
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'clients', query: 'Judith', leadType: 'hot', source: 'referral',
    }));
  });

  it('passes an active Smart List identity and definition through the bounded page seam', async () => {
    vi.mocked(listSmartListsCommand).mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
      name: 'Priority people',
      definition: { schemaVersion: 'smart-list-filter.v1', criteria: [] },
      status: 'active',
      createdByMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
      createdAt: '2026-08-25T12:00:00.000Z',
      updatedAt: '2026-08-25T12:00:00.000Z',
    }]);
    await ContactsPage({ searchParams: Promise.resolve({
      smartList: '11111111-1111-4111-8111-111111111111',
    }) });

    expect(list).not.toHaveBeenCalled();
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({
      smartListId: '11111111-1111-4111-8111-111111111111',
      smartListDefinition: expect.objectContaining({ schemaVersion: 'smart-list-filter.v1' }),
    }));
  });

  it('renders exact metadata only for the visible 50-contact window beyond 1,000 contacts', async () => {
    const contacts = Array.from({ length: 1001 }, (_, index): Contact => ({
      ...contact,
      id: `contact-${index}`,
      firstName: `Contact ${index}`,
      lastName: 'Scaled',
    }));
    listPage.mockImplementationOnce(async (request) => ({
      items: contacts.slice(request.offset, request.offset + request.limit),
      total: contacts.length,
      activeTotal: contacts.length,
      scopeCounts: {
        leads: contacts.length, clients: 0, 'active-clients': 0,
        'past-clients': 0, 'needs-review': 0, all: contacts.length,
      },
      leadTypeCounts: { hot: contacts.length, warm: 0, nurture: 0 },
      offset: request.offset,
      limit: request.limit,
      aliasEpoch: 0,
    }));
    listContactAggregates.mockImplementationOnce(async (_scope, contactIds) => new Map(
      contactIds.map((contactId, index) => [contactId, {
        activityCount: 700 + index,
        openTaskCount: 600 + index,
        completedTaskCount: 500 + index,
      }]),
    ));

    const markup = renderToStaticMarkup(await ContactsPage({
      searchParams: Promise.resolve({ page: '20' }),
    }));

    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ offset: 950, limit: 50 }));
    expect(listContactAggregates).toHaveBeenCalledWith(
      SAMPLE_WORKSPACE_SCOPE,
      contacts.slice(950, 1000).map((item) => item.id),
    );
    expect(markup).toContain('Contact 950');
    expect(markup).toContain('700 activities · 600 open tasks · 500 completed');
    expect(markup).toContain('Contact 999');
    expect(markup).toContain('749 activities · 649 open tasks · 549 completed');
    expect(markup).not.toContain('Contact 1000');
  });

  it('opens records with the list context so archiving can continue in the same list', async () => {
    const markup = renderToStaticMarkup(await ContactsPage({
      searchParams: Promise.resolve({ q: 'Judith', leadType: 'hot', page: '2' }),
    }));

    expect(markup).toContain('href="/contacts/contact-a?q=Judith&amp;leadType=hot&amp;page=2&amp;from=list"');
  });

  it('confirms an archive that ended the list without implying another record was archived', async () => {
    const markup = renderToStaticMarkup(await ContactsPage({
      searchParams: Promise.resolve({ saved: 'archived-end' }),
    }));

    expect(markup).toContain('Contact archived. There are no more contacts after it in this list.');
    const archivedView = renderToStaticMarkup(await ContactsPage({
      searchParams: Promise.resolve({ view: 'archived', saved: 'archived-end' }),
    }));
    expect(archivedView).not.toContain('Contact archived.');
  });
});

const CONTACT_PAGE_LIMIT = 50;
