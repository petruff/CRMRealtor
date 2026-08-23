import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityRepository } from '@/lib/data/activity-repository';
import type { MailerRepository } from '@/lib/data/mailer-repository';
import type { ContactRepository } from '@/lib/data/repository';
import type { ConnectorRepository } from '@/lib/data/connector-repository';
import type { ActivityEvent, CrmTask } from '@/lib/domain/activity';
import type { Contact } from '@/lib/domain/contact';
import type { MailerCampaign } from '@/lib/domain/mailer';
import {
  createOmnixCopilotRequest,
  OmnixCopilotError,
  type OmnixCopilotRequest,
} from '@/lib/domain/omnix-copilot';
import {
  SAMPLE_ASSISTANT_SCOPE,
  SAMPLE_WORKSPACE_SCOPE,
  WorkspaceAuthorityError,
  type WorkspaceScope,
} from '@/lib/domain/workspace';
import {
  buildOmnixAlertResult,
  createOmnixCopilotExecutor,
  executeOmnixCopilot,
  type OmnixCopilotRepositoryContext,
} from './omnix-copilot-service';

describe('buildOmnixAlertResult', () => {
  it('returns a deterministic immutable count/order projection and keeps unavailable tasks partial', () => {
    const input = {
      contacts: [contact('c-alert', { pipelineStage: 'active', nextTouchAt: undefined })],
      tasks: [task('task-alert', '2026-08-11T14:00:00.000Z')],
      today: '2026-08-11',
      asOf: AS_OF.toISOString(),
      taskCapabilityAvailable: false,
    } as const;

    const first = buildOmnixAlertResult(input);
    const second = buildOmnixAlertResult(input);

    expect(first.alerts.map((alert) => alert.id)).toEqual(second.alerts.map((alert) => alert.id));
    expect(first.alerts.map((alert) => alert.order)).toEqual(first.alerts.map((_, index) => index + 1));
    expect(new Set(first.alerts.map((alert) => alert.id)).size).toBe(first.alerts.length);
    expect(first.availability).toBe('partial');
    expect(first.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'capability-unavailable' }),
    ]));
    expect(Object.isFrozen(first.alerts)).toBe(true);
  });
});

const AS_OF = new Date('2026-08-11T16:00:00.000Z');
const COMPLETE_ADDRESS = {
  mailingAddress: '10 Main St',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
};

function contact(id: string, patch: Partial<Contact> = {}): Contact {
  return {
    id,
    firstName: `First ${id}`,
    lastName: 'Contact',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'unknown',
    source: 'referral',
    pipelineStage: 'contacted',
    lastContactedAt: '2026-08-01T12:00:00.000Z',
    nextTouchAt: '2026-08-18',
    tags: [],
    createdAt: '2026-07-01T12:00:00.000Z',
    emailSubscribed: true,
    ...COMPLETE_ADDRESS,
    ...patch,
  };
}

function task(id: string, dueAt: string, patch: Partial<CrmTask> = {}): CrmTask {
  return {
    id,
    workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
    title: `Task ${id}`,
    dueAt,
    status: 'open',
    creatorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
    assigneeMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...patch,
  };
}

function event(id: string, contactId: string): ActivityEvent {
  return {
    id,
    workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
    type: 'contact-updated',
    contactId,
    actorMembershipId: SAMPLE_WORKSPACE_SCOPE.membershipId,
    occurredAt: '2026-08-10T12:00:00.000Z',
    createdAt: '2026-08-10T12:00:00.000Z',
    idempotencyKey: `event-${id}`,
  };
}

function contactRepository(contacts: readonly Contact[]) {
  const writes = {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addNote: vi.fn(),
  };
  const repository: ContactRepository = {
    list: vi.fn(async () => [...contacts]),
    get: vi.fn(async (id) => contacts.find((item) => item.id === id)),
    create: writes.create,
    update: writes.update,
    remove: writes.remove,
    notesFor: vi.fn(async () => []),
    addNote: writes.addNote,
  };
  return { repository, writes };
}

function activityRepository(tasks: readonly CrmTask[] = [], events: readonly ActivityEvent[] = []) {
  const writes = {
    appendEvent: vi.fn(),
    createTask: vi.fn(),
    transitionTasks: vi.fn(),
  };
  const repository: ActivityRepository = {
    listEvents: vi.fn(async (scope, query) => events
      .filter((item) => item.workspaceId === scope.workspaceId)
      .filter((item) => !query.contactId || item.contactId === query.contactId)
      .slice(0, query.limit)),
    appendEvent: writes.appendEvent,
    listTasks: vi.fn(async (scope, query) => tasks
      .filter((item) => item.workspaceId === scope.workspaceId)
      .filter((item) => query.status === 'all' || item.status === query.status)
      .slice(0, query.limit)),
    getTask: vi.fn(async () => undefined),
    createTask: writes.createTask,
    transitionTasks: writes.transitionTasks,
  };
  return { repository, writes };
}

function mailerRepository(campaigns: readonly MailerCampaign[] = []) {
  const writes = {
    create: vi.fn(),
    markSent: vi.fn(),
    unmarkSent: vi.fn(),
  };
  const repository: MailerRepository = {
    list: vi.fn(async () => campaigns.map((campaign) => ({ ...campaign, sends: [...campaign.sends] }))),
    create: writes.create,
    markSent: writes.markSent,
    unmarkSent: writes.unmarkSent,
  };
  return { repository, writes };
}

function request(question: string, options: { live?: boolean; now?: Date } = {}): OmnixCopilotRequest {
  return createOmnixCopilotRequest({
    command: 'ask',
    question,
    correlationId: 'test-correlation',
    now: options.now ?? AS_OF,
    live: options.live,
  });
}

function context(input: {
  contacts?: readonly Contact[];
  tasks?: readonly CrmTask[];
  events?: readonly ActivityEvent[];
  campaigns?: readonly MailerCampaign[];
  scope?: WorkspaceScope;
  isLive?: boolean;
  activity?: boolean;
  mailers?: boolean;
} = {}) {
  const contacts = contactRepository(input.contacts ?? [contact('c-1')]);
  const activities = activityRepository(input.tasks, input.events);
  const mailers = mailerRepository(input.campaigns);
  const repositoryContext: OmnixCopilotRepositoryContext = {
    repository: contacts.repository,
    workspaceScope: input.scope ?? SAMPLE_WORKSPACE_SCOPE,
    isLive: input.isLive ?? false,
    ...(input.activity === false ? {} : { activityRepository: activities.repository }),
    ...(input.mailers === false ? {} : { mailerRepository: mailers.repository }),
  };
  return { repositoryContext, contacts, activities, mailers };
}

describe('executeOmnixCopilot', () => {
  let consoleInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleInfo.mockRestore();
  });

  it('preserves the workspace snapshot and adds deterministic task groups to the brief', async () => {
    const fixture = context({
      contacts: [contact('c-overdue', { nextTouchAt: '2026-08-10' })],
      tasks: [
        task('t-overdue', '2026-08-10T16:00:00.000Z'),
        task('t-today', '2026-08-11T20:00:00.000Z'),
        task('t-upcoming', '2026-08-15T16:00:00.000Z'),
      ],
    });

    const response = await executeOmnixCopilot(request('brief today'), {
      getRepository: async () => fixture.repositoryContext,
    });

    expect(response.ok).toBe(true);
    expect(response.answerBlocks.map((item) => item.id)).toEqual(['daily-brief', 'task-groups']);
    expect(response.answerBlocks[0]?.items.find((item) => item.id === 'total-contacts')?.value).toBe(1);
    expect(response.answerBlocks[1]?.items.map((item) => item.value)).toEqual([1, 1, 1]);
    expect(response.citations.every((citation) => citation.schemaVersion === 'citation.v1')).toBe(true);
  });

  it('names the exact stored facts behind brief recommendations and attention counts', async () => {
    const fixture = context({
      contacts: [
        contact('c-first', {
          lastContactedAt: undefined,
          nextTouchAt: undefined,
          createdAt: '2026-08-10T12:00:00.000Z',
          source: 'website',
        }),
        contact('c-overdue', { nextTouchAt: '2026-08-10' }),
        contact('c-address', { mailingAddress: undefined }),
        contact('c-celebration', { birthdate: '1980-08-12', homePurchaseDate: '2020-08-20' }),
        contact('c-pipeline', { pipelineStage: 'active', nextTouchAt: undefined }),
      ],
    });

    const response = await executeOmnixCopilot(request('brief today'), {
      getRepository: async () => fixture.repositoryContext,
    });
    const citation = (rule: string, recordId: string) => response.citations.find(
      (item) => item.rule === rule && item.recordId === recordId,
    );

    expect(citation('first-contact', 'c-first')?.factKeys).toEqual([
      'pipelineStage', 'lastContactedAt', 'createdAt', 'leadType', 'source',
    ]);
    expect(citation('overdue', 'c-overdue')?.factKeys).toEqual([
      'pipelineStage', 'lastContactedAt', 'nextTouchAt', 'leadType',
    ]);
    expect(citation('address', 'c-address')?.factKeys).toEqual([
      'mailingAddress', 'city', 'state', 'postalCode',
    ]);
    expect(citation('celebrations', 'c-celebration')?.factKeys).toEqual([
      'pipelineStage', 'birthdate', 'homePurchaseDate',
    ]);
    expect(citation('pipeline-risk', 'c-pipeline')?.factKeys).toEqual(['pipelineStage', 'nextTouchAt']);

    const attention = response.answerBlocks[0]?.items.find((item) => item.id === 'needs-attention-now');
    expect(new Set(attention?.citations.map((item) => item.rule))).toEqual(new Set([
      'needs-first-contact', 'overdue', 'due-today',
    ]));
  });

  it.each([
    ['Alice', 'firstName'],
    ['Ally', 'preferredName'],
    ['Wonder', 'lastName'],
    ['alice@example.com', 'email'],
    ['5121112222', 'phone'],
    ['5123334444', 'secondaryPhone'],
    ['Cedar Park', 'city'],
    ['78704', 'postalCode'],
    ['open house', 'tags'],
  ])('cites every searchable and displayed contact fact for a %s match via %s', async (query) => {
    const fixture = context({
      contacts: [contact('c-search', {
        firstName: 'Alice',
        preferredName: 'Ally',
        lastName: 'Wonder',
        email: 'alice@example.com',
        phone: '5121112222',
        secondaryPhone: '5123334444',
        city: 'Cedar Park',
        postalCode: '78704',
        tags: ['open-house'],
      })],
    });

    const response = await executeOmnixCopilot(request(`find contact ${query}`), {
      getRepository: async () => fixture.repositoryContext,
    });

    expect(response.answerBlocks[0]?.items).toHaveLength(1);
    expect(response.answerBlocks[0]?.items[0]?.citations[0]?.factKeys).toEqual([
      'firstName', 'preferredName', 'lastName', 'email', 'phone', 'secondaryPhone',
      'city', 'postalCode', 'tags', 'leadType', 'relationship',
    ]);
  });

  it('cites task titles and contact names whenever those facts are displayed', async () => {
    const fixture = context({
      contacts: [contact('c-date', { preferredName: 'Ada', birthdate: '1980-08-11' })],
      tasks: [task('t-title', '2026-08-11T20:00:00.000Z')],
    });

    const tasks = await executeOmnixCopilot(request('tasks today'), {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'UTC',
    });
    expect(tasks.answerBlocks[0]?.items[0]?.citations[0]?.factKeys).toEqual([
      'status', 'dueAt', 'createdAt', 'title',
    ]);

    const dates = await executeOmnixCopilot(request('dates today'), {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'UTC',
    });
    expect(dates.answerBlocks[0]?.items[0]?.citations[0]?.factKeys).toEqual([
      'firstName', 'preferredName', 'lastName', 'birthdate',
    ]);
  });

  it('keeps long composite mailer-send citations distinct without lossy truncation', async () => {
    const campaignId = 'm'.repeat(128);
    const fixture = context({
      campaigns: [{
        id: campaignId,
        name: 'Boundary campaign',
        createdAt: '2026-08-01T12:00:00.000Z',
        sends: [
          { mailerId: campaignId, contactId: 'a'.repeat(128), sentOn: '2026-08-10' },
          { mailerId: campaignId, contactId: 'b'.repeat(128), sentOn: '2026-08-10' },
        ],
      }],
    });

    const response = await executeOmnixCopilot(request('mailers'), {
      getRepository: async () => fixture.repositoryContext,
    });
    const sends = response.citations.filter((item) => item.entityType === 'mailer-send');

    expect(sends).toHaveLength(2);
    expect(new Set(sends.map((item) => item.id)).size).toBe(2);
    expect(sends.every((item) => /^mailer-send-[a-f0-9]{64}$/u.test(item.recordId))).toBe(true);
  });

  it('uses the configured calendar zone for due-today task grouping and rejects an invalid zone', async () => {
    const fixture = context({
      tasks: [task('t-zone', '2026-08-12T01:00:00.000Z')],
    });
    const zonedRequest = request('tasks today', { now: new Date('2026-08-12T02:00:00.000Z') });

    const response = await executeOmnixCopilot(zonedRequest, {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'America/Chicago',
    });
    expect(response.answerBlocks[0]?.items.map((item) => item.id)).toEqual(['t-zone']);

    await expect(executeOmnixCopilot(zonedRequest, {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'Not/A_Time_Zone',
    })).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('constructs the complete fixed alert catalog once per rule, record and CRM day', async () => {
    const fixture = context({
      contacts: [
        contact('c-first', { lastContactedAt: undefined, nextTouchAt: undefined, createdAt: '2026-08-10T12:00:00.000Z' }),
        contact('c-overdue', { nextTouchAt: '2026-08-10' }),
        contact('c-today', { nextTouchAt: '2026-08-11' }),
        contact('c-upcoming', { nextTouchAt: '2026-08-14' }),
        contact('c-birthday', { birthdate: '1980-08-12' }),
        contact('c-homeaversary', { homePurchaseDate: '2020-08-20' }),
        contact('c-pipeline', { pipelineStage: 'active', nextTouchAt: undefined }),
        contact('c-address', { mailingAddress: undefined }),
      ],
      tasks: [
        task('t-overdue', '2026-08-10T16:00:00.000Z'),
        task('t-today', '2026-08-11T20:00:00.000Z'),
      ],
    });

    const response = await executeOmnixCopilot(request('alerts today'), {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'UTC',
    });
    const rules = new Set(response.alerts.map((alert) => alert.rule));

    expect(rules).toEqual(new Set([
      'needs-first-contact',
      'overdue-follow-up',
      'due-today-follow-up',
      'upcoming-follow-up',
      'birthday',
      'homeaversary',
      'pipeline-missing-next-touch',
      'mailer-missing-address',
      'task-overdue',
      'task-due-today',
    ]));
    expect(new Set(response.alerts.map((alert) => alert.id)).size).toBe(response.alerts.length);
    expect(response.alerts.map((alert) => alert.order)).toEqual(
      [...response.alerts.map((alert) => alert.order)].sort((left, right) => left - right),
    );
    expect(response.alerts.every((alert) => alert.citations.length > 0)).toBe(true);
  });

  it('projects alerts as a people-first attention brief without changing canonical alert order', async () => {
    const contacts = Array.from({ length: 8 }, (_, index) => contact(`c-attention-${index + 1}`, {
      firstName: `Client ${index + 1}`,
      lastName: 'Morgan',
      leadType: index === 0 ? 'hot' : 'warm',
      relationship: 'active-client',
      source: 'open-house',
      pipelineStage: 'active',
      nextTouchAt: '2026-08-10',
    }));
    const fixture = context({
      contacts,
      tasks: [task('t-attention', '2026-08-10T16:00:00.000Z', {
        title: 'Confirm inspection window',
        contactId: contacts[0]?.id,
      })],
    });

    const response = await executeOmnixCopilot(request('who needs attention'), {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'UTC',
    });
    const summary = response.answerBlocks.find((item) => item.id === 'attention-summary');
    const actNow = response.answerBlocks.find((item) => item.id === 'attention-overdue');
    const taskBlock = response.answerBlocks.find((item) => item.id === 'attention-tasks');
    const presentedIds = response.answerBlocks
      .filter((item) => item.kind === 'list')
      .flatMap((item) => item.items.map((entry) => entry.id));

    expect(summary).toMatchObject({
      kind: 'metric',
      title: '9 attention items',
      detail: '8 people and 1 task need review. Start with Act now.',
    });
    expect(summary?.items.map((item) => [item.label, item.value])).toEqual([
      ['People', 8],
      ['Tasks', 1],
      ['Act now', 9],
      ['Due today', 0],
      ['Coming up', 0],
      ['Reminders', 0],
    ]);
    expect(actNow?.items[0]).toMatchObject({
      label: 'Client 1 Morgan',
      value: 'Hot',
      href: '/contacts/c-attention-1',
    });
    expect(actNow?.items[0]?.detail).toContain('Active client · Actively working · Open house');
    expect(taskBlock?.items[0]).toMatchObject({
      label: 'Confirm inspection window',
      value: 'Task',
      href: '/activities?task=t-attention',
    });
    expect(taskBlock?.items[0]?.detail).toContain('For Client 1 Morgan');
    expect(actNow?.items.every((item) => !item.label.includes('follow-up'))).toBe(true);
    expect(presentedIds).toEqual(response.alerts.map((alert) => alert.id));
    expect(response.alerts.map((alert) => alert.order)).toEqual(
      [...response.alerts.map((alert) => alert.order)].sort((left, right) => left - right),
    );
    expect(response.suggestions[0]).toMatchObject({ href: '/alerts', title: 'View the complete alert center' });
  });

  it('uses a calm user-facing empty state when nothing needs attention', async () => {
    const fixture = context({ contacts: [], tasks: [] });
    const response = await executeOmnixCopilot(request('alerts today'), {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'UTC',
    });

    expect(response.answerBlocks).toEqual([expect.objectContaining({
      id: 'alerts-empty',
      kind: 'empty',
      title: "You're caught up",
      detail: 'No follow-up, task or relationship reminder needs attention right now.',
    })]);
    expect(response.answerBlocks[0]?.items).toHaveLength(0);
  });

  it('cites the stored inputs used to derive missing next-touch dates from the approved cadence', async () => {
    const fixture = context({
      contacts: [
        contact('c-derived-today', {
          leadType: 'warm',
          createdAt: '2026-01-01T12:00:00.000Z',
          lastContactedAt: '2026-07-12T12:00:00.000Z',
          nextTouchAt: undefined,
          touchDateOverridden: false,
        }),
        contact('c-derived-upcoming', {
          leadType: 'warm',
          createdAt: '2026-08-01T12:00:00.000Z',
          lastContactedAt: '2026-08-08T12:00:00.000Z',
          nextTouchAt: undefined,
          touchDateOverridden: false,
        }),
      ],
    });

    const response = await executeOmnixCopilot(request('alerts today'), {
      getRepository: async () => fixture.repositoryContext,
      timeZone: 'UTC',
    });
    const dueToday = response.alerts.find((alert) => alert.recordId === 'c-derived-today');
    const upcoming = response.alerts.find((alert) => alert.recordId === 'c-derived-upcoming');
    const expected = [
      'pipelineStage', 'nextTouchAt', 'touchDateOverridden',
      'lastContactedAt', 'createdAt', 'leadType',
    ];

    expect(dueToday).toMatchObject({ rule: 'due-today-follow-up' });
    expect(dueToday?.citations[0]?.factKeys).toEqual(expected);
    expect(upcoming).toMatchObject({ rule: 'upcoming-follow-up' });
    expect(upcoming?.citations[0]?.factKeys).toEqual(expected);
  });

  it('degrades missing optional capabilities and connections honestly without sample fallback', async () => {
    const fixture = context({ activity: false, mailers: false });
    const getRepository = async () => fixture.repositoryContext;

    for (const question of ['tasks today', 'activity c-1', 'mailers', 'connections']) {
      const response = await executeOmnixCopilot(request(question), { getRepository });
      expect(response.warnings).toContainEqual(expect.objectContaining({ code: 'capability-unavailable' }));
      expect(response.answerBlocks[0]?.kind).toBe('capability');
    }
  });

  it('reads redacted workspace connection health from the connector repository', async () => {
    const fixture = context();
    const connectorRepository = {
      listDefinitions: vi.fn(async () => [{
        provider: 'google', label: 'Google', mode: 'uat', enabled: true,
        capabilities: ['gmail.send'], productionRequirements: [],
      }]),
      listConnections: vi.fn(async () => [{
        id: 'connection-google',
        workspaceId: SAMPLE_WORKSPACE_SCOPE.workspaceId,
        provider: 'google',
        remoteAccountId: 'redacted-account-hash',
        remoteAccountLabel: 'Judith Google',
        grantedScopes: ['gmail.send'],
        status: 'active',
        connectedAt: '2026-08-11T10:00:00.000Z',
        updatedAt: '2026-08-11T11:00:00.000Z',
      }]),
    } as unknown as ConnectorRepository;

    const response = await executeOmnixCopilot(request('connections'), {
      getRepository: async () => ({ ...fixture.repositoryContext, connectorRepository }),
    });

    expect(response.answerBlocks[0]).toMatchObject({ title: 'Connection health', kind: 'list' });
    expect(response.answerBlocks[0]?.items[0]).toMatchObject({
      label: 'Google', detail: 'active · 1 granted scopes', href: '/connections',
    });
    expect(response.citations[0]).toMatchObject({
      entityType: 'connector', recordId: 'connection-google', target: '/connections',
    });
    expect(JSON.stringify(response)).not.toContain('redacted-account-hash');
  });

  it('builds a bounded full contact profile from authorized CRM repositories', async () => {
    const selected = contact('c-profile', {
      firstName: 'Judith', lastName: 'Serna', email: 'judith@example.com',
      buyer: { areas: ['Vero Beach'], priceMax: 700000 },
    });
    const fixture = context({
      contacts: [selected],
      tasks: [task('task-profile', '2026-08-12T14:00:00.000Z', { contactId: selected.id })],
      events: [event('event-profile', selected.id)],
    });

    const response = await executeOmnixCopilot(request('contact profile Judith Serna'), {
      getRepository: async () => fixture.repositoryContext,
    });

    expect(response.answerBlocks.map((block) => block.title)).toEqual([
      'Judith Serna', 'Contact points, relationships and custom fields', 'Notes', 'Tasks and activity',
    ]);
    expect(response.answerBlocks[0]?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Contact', detail: expect.stringContaining('judith@example.com') }),
      expect.objectContaining({ label: 'Preferences', detail: expect.stringContaining('Vero Beach') }),
    ]));
    expect(response.answerBlocks[3]?.items).toHaveLength(2);
    expect(response.citations.length).toBeGreaterThan(0);
  });

  it('caps contact facts at 500 and returns an explicit zero-match answer', async () => {
    const contacts = Array.from({ length: 501 }, (_, index) => contact(`c-${String(index).padStart(3, '0')}`));
    const fixture = context({ contacts });
    const getRepository = async () => fixture.repositoryContext;

    const pipeline = await executeOmnixCopilot(request('pipeline'), { getRepository });
    const count = pipeline.answerBlocks[0]?.items.reduce((total, item) => total + Number(item.value ?? 0), 0);
    expect(count).toBe(500);
    expect(pipeline.warnings).toContainEqual(expect.objectContaining({ code: 'result-limit' }));

    const noMatch = await executeOmnixCopilot(request('find contact nobody'), { getRepository });
    expect(noMatch.answerBlocks[0]).toMatchObject({ kind: 'empty' });
    expect(noMatch.answerBlocks[0]?.detail).toContain('no authorized record matched');
  });

  it('keeps two workspaces and a forbidden ID indistinguishable from no match', async () => {
    const workspaceA = context({ contacts: [contact('c-a', { firstName: 'Alpha' })] });
    const workspaceBScope: WorkspaceScope = {
      ...SAMPLE_WORKSPACE_SCOPE,
      workspaceId: 'workspace-b',
      ownerUserId: 'user-b',
      authenticatedUserId: 'user-b',
      membershipId: 'membership-b',
    };
    const workspaceB = context({ contacts: [contact('c-b', { firstName: 'Beta' })], scope: workspaceBScope });

    const resultA = await executeOmnixCopilot(request('find contact Beta'), {
      getRepository: async () => workspaceA.repositoryContext,
    });
    const resultB = await executeOmnixCopilot(request('find contact Beta'), {
      getRepository: async () => workspaceB.repositoryContext,
    });
    expect(resultA.answerBlocks[0]?.items).toHaveLength(0);
    expect(resultB.answerBlocks[0]?.items.map((item) => item.id)).toEqual(['c-b']);

    const forbidden = await executeOmnixCopilot(request('activity c-b'), {
      getRepository: async () => workspaceA.repositoryContext,
    });
    expect(forbidden.answerBlocks[0]).toMatchObject({ kind: 'empty' });
  });

  it.each([
    ['owner', SAMPLE_WORKSPACE_SCOPE],
    ['assistant', SAMPLE_ASSISTANT_SCOPE],
  ])('accepts an authenticated active %s scope', async (_label, scope) => {
    const fixture = context({ scope });
    const response = await executeOmnixCopilot(request('help'), {
      getRepository: async () => fixture.repositoryContext,
    });
    expect(response.ok).toBe(true);
  });

  it('fails closed for revoked authority and mismatched sample/live mode with safe telemetry', async () => {
    const telemetry = vi.fn();
    await expect(executeOmnixCopilot(request('pipeline'), {
      getRepository: async () => {
        throw new WorkspaceAuthorityError('revoked-membership', 'Raw revoked membership detail');
      },
      telemetry,
    })).rejects.toMatchObject({ code: 'revoked-membership' });
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure',
      errorCategory: 'forbidden',
      workspaceId: 'unresolved',
    }));

    const sample = context();
    await expect(executeOmnixCopilot(request('pipeline', { live: true }), {
      getRepository: async () => sample.repositoryContext,
    })).rejects.toBeInstanceOf(OmnixCopilotError);
  });

  it('maps attacker-controlled dependency error codes to a fixed telemetry category', async () => {
    const telemetry = vi.fn();
    const unsafe = Object.assign(new Error('repository failed'), {
      code: 'private@example.com\nsecret-token',
    });

    await expect(executeOmnixCopilot(request('pipeline'), {
      getRepository: async () => { throw unsafe; },
      telemetry,
    })).rejects.toBe(unsafe);

    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure',
      errorCategory: 'internal-error',
    }));
    const serialized = JSON.stringify(telemetry.mock.calls[0]?.[0]);
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('secret-token');
  });

  it('emits redacted telemetry without question bodies or CRM content', async () => {
    const fixture = context({ contacts: [contact('c-secret', { firstName: 'Private', email: 'private@example.com' })] });
    const telemetry = vi.fn();
    const ticks = [10, 16];

    await executeOmnixCopilot(request('find contact Private'), {
      getRepository: async () => fixture.repositoryContext,
      telemetry,
      monotonicNow: () => ticks.shift() ?? 16,
    });
    expect(telemetry).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(telemetry.mock.calls[0]?.[0]);
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('find contact');
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({
      resolvedIntent: 'find-contact',
      resultCount: 1,
      durationMs: 6,
    }));
  });

  it('uses the default structured sink when no telemetry dependency is supplied', async () => {
    const fixture = context({ contacts: [contact('c-private', { firstName: 'Private', email: 'private@example.com' })] });

    await executeOmnixCopilot(request('find contact Private'), {
      getRepository: async () => fixture.repositoryContext,
    });

    expect(consoleInfo).toHaveBeenCalledTimes(1);
    const line = consoleInfo.mock.calls[0]?.[0];
    expect(typeof line).toBe('string');
    expect(() => JSON.parse(String(line))).not.toThrow();
    expect(String(line)).not.toContain('Private');
    expect(String(line)).not.toContain('private@example.com');
    expect(String(line)).not.toContain('find contact');
  });

  it('uses one executor seam and never invokes any write method for every supported intent', async () => {
    const fixture = context({
      contacts: [contact('c-1', { firstName: 'Alicia' })],
      tasks: [task('t-1', '2026-08-11T20:00:00.000Z', { contactId: 'c-1' })],
      events: [event('a-1', 'c-1')],
      campaigns: [{
        id: 'm-1',
        name: 'Postcard',
        createdAt: '2026-08-01T12:00:00.000Z',
        sends: [{ mailerId: 'm-1', contactId: 'c-1', sentOn: '2026-08-10' }],
      }],
    });
    const execute = createOmnixCopilotExecutor({ getRepository: async () => fixture.repositoryContext });
    const questions = [
      'brief today', 'alerts today', 'find contact Alicia', 'pipeline',
      'tasks overdue', 'tasks today', 'tasks upcoming',
      'tasks from 2026-08-10 to 2026-08-12', 'dates today', 'dates upcoming',
      'mailers', 'mailers m-1', 'activity c-1', 'connections', 'help',
    ];

    for (const question of questions) await execute(request(question));

    for (const write of [
      ...Object.values(fixture.contacts.writes),
      ...Object.values(fixture.activities.writes),
      ...Object.values(fixture.mailers.writes),
    ]) expect(write).not.toHaveBeenCalled();
  });
});
