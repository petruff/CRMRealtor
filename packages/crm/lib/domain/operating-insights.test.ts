import { describe, expect, it } from 'vitest';
import {
  buildOperatingInsights,
  operatingInsightWindows,
  parseOperatingInsightPeriod,
} from './operating-insights.ts';
import type { ActivityEvent, CrmTask } from './activity.ts';
import type { Contact, PipelineStage } from './contact.ts';
import type { WorkspaceMembership } from './workspace.ts';

function contact(id: string, source: Contact['source'], pipelineStage: PipelineStage): Contact {
  return {
    id,
    firstName: 'Contact',
    lastName: id,
    leadType: 'warm',
    relationship: pipelineStage === 'closed' ? 'past-client' : 'lead',
    intent: 'buyer',
    source,
    pipelineStage,
    tags: [],
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

function event(input: {
  id: string;
  type: ActivityEvent['type'];
  occurredAt: string;
  actorMembershipId: string;
  contactId?: string;
  taskId?: string;
  fromStage?: PipelineStage;
  toStage?: PipelineStage;
}): ActivityEvent {
  return {
    id: input.id,
    workspaceId: 'w-1',
    type: input.type,
    ...(input.contactId ? { contactId: input.contactId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    actorMembershipId: input.actorMembershipId,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    idempotencyKey: `event-${input.id}`,
    ...(input.fromStage && input.toStage
      ? { metadata: { fromStage: input.fromStage, toStage: input.toStage } }
      : {}),
  };
}

const memberships: WorkspaceMembership[] = [
  {
    id: 'owner-1', workspaceId: 'w-1', userId: 'u-1', role: 'owner', status: 'active',
    joinedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'assistant-1', workspaceId: 'w-1', userId: 'u-2', role: 'assistant', status: 'active',
    joinedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

const tasks: CrmTask[] = [{
  id: 't-open', workspaceId: 'w-1', title: 'Follow up', dueAt: '2026-04-01T00:00:00.000Z',
  status: 'open', creatorMembershipId: 'owner-1', assigneeMembershipId: 'assistant-1',
  createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z',
}];

describe('operating insights', () => {
  it('accepts only the governed 30, 90, and 365 day periods', () => {
    expect(parseOperatingInsightPeriod('30')).toBe(30);
    expect(parseOperatingInsightPeriod(90)).toBe(90);
    expect(parseOperatingInsightPeriod('365')).toBe(365);
    expect(() => parseOperatingInsightPeriod('60')).toThrow('30, 90, or 365');
  });

  it('builds contiguous current and previous windows without a shared boundary', () => {
    const windows = operatingInsightWindows(30, new Date('2026-03-31T00:00:00.000Z'));
    expect(windows.current).toEqual({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-31T00:00:00.000Z',
    });
    expect(windows.previous).toEqual({
      from: '2026-01-30T00:00:00.000Z',
      to: '2026-02-28T23:59:59.999Z',
    });
  });

  it('reports portfolio, source progression, rhythm, collaboration, and previous-period comparison', () => {
    const windows = operatingInsightWindows(30, new Date('2026-03-31T00:00:00.000Z'));
    const events: ActivityEvent[] = [
      event({ id: 'p-prev', type: 'pipeline-stage-changed', contactId: 'c-2', actorMembershipId: 'owner-1', occurredAt: '2026-02-15T00:00:00.000Z', fromStage: 'new', toStage: 'contacted' }),
      event({ id: 'p-now-1', type: 'pipeline-stage-changed', contactId: 'c-1', actorMembershipId: 'owner-1', occurredAt: '2026-03-05T00:00:00.000Z', fromStage: 'new', toStage: 'contacted' }),
      event({ id: 'p-now-2', type: 'pipeline-stage-changed', contactId: 'c-1', actorMembershipId: 'assistant-1', occurredAt: '2026-03-20T00:00:00.000Z', fromStage: 'contacted', toStage: 'closed' }),
      event({ id: 't-prev', type: 'task-created', taskId: 't-prev', actorMembershipId: 'owner-1', occurredAt: '2026-02-10T00:00:00.000Z' }),
      event({ id: 't-create', type: 'task-created', taskId: 't-1', actorMembershipId: 'owner-1', occurredAt: '2026-03-10T00:00:00.000Z' }),
      event({ id: 't-complete', type: 'task-completed', taskId: 't-1', actorMembershipId: 'assistant-1', occurredAt: '2026-03-11T00:00:00.000Z' }),
      event({ id: 't-complete-replay', type: 'task-completed', taskId: 't-1', actorMembershipId: 'assistant-1', occurredAt: '2026-03-12T00:00:00.000Z' }),
    ];
    const report = buildOperatingInsights({
      periodDays: 30,
      currentWindow: windows.current,
      previousWindow: windows.previous,
      contacts: [contact('c-1', 'referral', 'closed'), contact('c-2', 'website', 'contacted')],
      events,
      tasks,
      memberships,
    });

    expect(report.pipeline.current.conversion).toMatchObject({ numerator: 1, denominator: 1, percentage: 100 });
    expect(report.pipeline.previous.conversion).toMatchObject({ numerator: 0, denominator: 1, percentage: 0 });
    expect(report.pipeline.conversionPercentagePointChange).toBe(100);
    expect(report.portfolio).toMatchObject({ status: 'available', totalContacts: 2 });
    expect(report.sourceProgression.sources.find((item) => item.source === 'referral')).toMatchObject({
      contactCount: 1,
      current: { progressedContacts: 1, closedContacts: 1 },
      previous: { progressedContacts: 0, closedContacts: 0 },
    });
    expect(report.sourceProgression.sources.find((item) => item.source === 'website')).toMatchObject({
      current: { progressedContacts: 0, closedContacts: 0 },
      previous: { progressedContacts: 0, closedContacts: 0 },
    });
    expect(report.taskRhythm).toMatchObject({
      status: 'available',
      current: { created: 1, completed: 1, sameCohortCompletionPercentage: 100 },
      previous: { created: 1, completed: 0, sameCohortCompletionPercentage: 0 },
      workload: { open: 1, overdue: 0, dueSoon: 1, completedInPeriod: 0 },
      change: { created: 0, completed: 1, completionPercentagePoints: 100 },
    });
    expect(report.ownerAssistant.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ membershipId: 'owner-1', role: 'owner', attribution: 'active-member', createdTasks: 1, completedTasks: 0, openAssignedTasks: 0 }),
      expect.objectContaining({ membershipId: 'assistant-1', role: 'assistant', attribution: 'active-member', createdTasks: 0, completedTasks: 1, openAssignedTasks: 1 }),
      expect.objectContaining({ role: null, attribution: 'unassigned', openAssignedTasks: 0 }),
      expect.objectContaining({ role: null, attribution: 'inactive-or-unknown', openAssignedTasks: 0 }),
    ]));
    expect(report.taskRhythm.current.completedTaskIds).toEqual(['t-1']);
    expect(report.coverage).toMatchObject({ status: 'complete', truncated: false });
  });

  it('counts distinct contacts only when they reach a qualifying progression stage', () => {
    const windows = operatingInsightWindows(30, new Date('2026-03-31T00:00:00.000Z'));
    const events: ActivityEvent[] = [
      event({ id: 'contacted', type: 'pipeline-stage-changed', contactId: 'c-1', actorMembershipId: 'owner-1', occurredAt: '2026-03-02T00:00:00.000Z', fromStage: 'new', toStage: 'contacted' }),
      event({ id: 'appointment', type: 'pipeline-stage-changed', contactId: 'c-1', actorMembershipId: 'owner-1', occurredAt: '2026-03-03T00:00:00.000Z', fromStage: 'contacted', toStage: 'appointment-set' }),
      event({ id: 'active-same-contact', type: 'pipeline-stage-changed', contactId: 'c-1', actorMembershipId: 'owner-1', occurredAt: '2026-03-04T00:00:00.000Z', fromStage: 'appointment-set', toStage: 'active' }),
      event({ id: 'under-contract', type: 'pipeline-stage-changed', contactId: 'c-2', actorMembershipId: 'assistant-1', occurredAt: '2026-03-05T00:00:00.000Z', fromStage: 'active', toStage: 'under-contract' }),
    ];
    const report = buildOperatingInsights({
      periodDays: 30,
      currentWindow: windows.current,
      previousWindow: windows.previous,
      contacts: [contact('c-1', 'referral', 'active'), contact('c-2', 'referral', 'under-contract')],
      events,
      tasks: [],
      memberships,
    });

    expect(report.sourceProgression.sources).toEqual([
      expect.objectContaining({
        source: 'referral',
        current: {
          progressedContacts: 2,
          closedContacts: 0,
          progressedContactIds: ['c-1', 'c-2'],
          closedContactIds: [],
        },
      }),
    ]);
  });

  it('uses unavailable rather than invented zeroes when a source was not loaded', () => {
    const windows = operatingInsightWindows(90, new Date('2026-03-31T00:00:00.000Z'));
    const report = buildOperatingInsights({
      periodDays: 90,
      currentWindow: windows.current,
      previousWindow: windows.previous,
    });

    expect(report.pipeline.status).toBe('unavailable');
    expect(report.portfolio).toMatchObject({ status: 'unavailable', totalContacts: null });
    expect(report.sourceProgression).toMatchObject({ status: 'unavailable', sources: [] });
    expect(report.taskRhythm).toMatchObject({
      status: 'unavailable',
      current: { created: null, completed: null },
    });
    expect(report.ownerAssistant.status).toBe('unavailable');
    expect(report.coverage.status).toBe('unavailable');
  });

  it('propagates bounded-source truncation into the report', () => {
    const windows = operatingInsightWindows(30, new Date('2026-03-31T00:00:00.000Z'));
    const report = buildOperatingInsights({
      periodDays: 30,
      currentWindow: windows.current,
      previousWindow: windows.previous,
      contacts: [],
      events: [],
      tasks: [],
      memberships: [],
      contactsTruncated: true,
      eventsTruncated: true,
      tasksTruncated: true,
    });

    expect(report.pipeline.current.evidence.coverage).toBe('possibly-truncated');
    expect(report.pipeline.status).toBe('possibly-truncated');
    expect(report.portfolio.status).toBe('possibly-truncated');
    expect(report.sourceProgression.status).toBe('possibly-truncated');
    expect(report.taskRhythm.status).toBe('possibly-truncated');
    expect(report.ownerAssistant.status).toBe('possibly-truncated');
    expect(report.coverage).toMatchObject({ status: 'possibly-truncated', truncated: true });
  });

  it('attributes unassigned and inactive or unknown work without hiding it in active roles', () => {
    const windows = operatingInsightWindows(30, new Date('2026-03-31T00:00:00.000Z'));
    const revoked: WorkspaceMembership = {
      id: 'revoked-1', workspaceId: 'w-1', userId: 'u-3', role: 'assistant', status: 'revoked',
      joinedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z',
      revokedAt: '2026-03-01T00:00:00.000Z',
    };
    const attributedTasks: CrmTask[] = [
      { ...tasks[0]!, id: 'unassigned', assigneeMembershipId: '', dueAt: '2026-03-20T00:00:00.000Z' },
      { ...tasks[0]!, id: 'revoked', assigneeMembershipId: 'revoked-1', dueAt: '2026-03-20T00:00:00.000Z' },
      { ...tasks[0]!, id: 'unknown', assigneeMembershipId: 'missing-1', dueAt: '2026-04-10T00:00:00.000Z' },
    ];
    const report = buildOperatingInsights({
      periodDays: 30,
      currentWindow: windows.current,
      previousWindow: windows.previous,
      contacts: [],
      events: [
        event({ id: 'unknown-complete', type: 'task-completed', taskId: 'unknown', actorMembershipId: 'missing-1', occurredAt: '2026-03-10T00:00:00.000Z' }),
      ],
      tasks: attributedTasks,
      memberships: [...memberships, revoked],
    });

    expect(report.ownerAssistant.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ attribution: 'unassigned', openAssignedTasks: 1, overdueAssignedTasks: 1 }),
      expect.objectContaining({ attribution: 'inactive-or-unknown', completedTasks: 1, openAssignedTasks: 2, overdueAssignedTasks: 1 }),
    ]));
    expect(report.ownerAssistant).toMatchObject({
      unattributedTaskEvents: 1,
      unassignedOpenTasks: 1,
      inactiveAssignedOpenTasks: 2,
    });
  });
});
