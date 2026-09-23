import { describe, expect, it } from 'vitest';
import type { CrmTask } from '@/lib/domain/activity';
import type { OmnixCopilotAlert } from '@/lib/domain/omnix-copilot';
import type { OmnixActionProposal } from '@/lib/domain/omnix-operational-brain';
import type { InboundResponseSignal } from '@/lib/domain/operational-signal';
import { buildInboxProjection } from './inbox-projection';

const NOW = new Date('2026-09-23T15:00:00.000Z');

const reply = (id: string, patch: Partial<InboundResponseSignal> = {}) => ({
  id, workspaceId: 'w', contactId: `c-${id}`, activityEventId: 'e', contactName: `Person ${id}`, resourceHash: 'h',
  receivedAt: '2026-09-23T12:00:00.000Z', intelligenceState: 'classified', unknowns: [], ...patch,
}) as InboundResponseSignal;
const proposal = (id: string, patch: Partial<OmnixActionProposal> = {}) => ({
  id, workspaceId: 'w', kind: 'follow-up', state: 'pending', origin: 'deterministic', approvalMode: 'active-member',
  priority: 'p2', priorityScore: 1, priorityFactors: { urgency: 1, leadTemperature: 'hot', daysOverdue: 0, awaitingReply: false, potentialValueCents: 0 },
  title: `Proposal ${id}`, rationale: 'Because', currentVersion: 1, correlationId: 'x', expiresAt: '2026-09-30T00:00:00.000Z',
  createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', ...patch,
}) as OmnixActionProposal;
const task = (id: string, dueAt: string, patch: Partial<CrmTask> = {}) => ({
  id, workspaceId: 'w', title: `Task ${id}`, dueAt, status: 'open', creatorMembershipId: 'm', assigneeMembershipId: 'm',
  createdAt: dueAt, updatedAt: dueAt, ...patch,
}) as CrmTask;
const alert = (id: string, category: OmnixCopilotAlert['category'], patch: Partial<OmnixCopilotAlert> = {}) => ({
  id, rule: 'x', category, priority: 'normal', order: 1, reason: `Alert ${id}`, asOf: NOW.toISOString(), recordId: 'c-1',
  href: '/alerts', citations: [], ...patch,
}) as unknown as OmnixCopilotAlert;

describe('inbox projection', () => {
  it('collects only what waits on a decision and never duplicates Today follow-ups', () => {
    const inbox = buildInboxProjection({
      replies: [reply('a'), reply('b', { acknowledgedAt: '2026-09-23T13:00:00Z' })],
      proposals: [proposal('p'), proposal('expired', { expiresAt: '2026-09-01T00:00:00Z' }), proposal('done', { state: 'executed' })],
      tasks: [task('late', '2026-09-22T10:00:00Z'), task('today', '2026-09-23T20:00:00Z'), task('later', '2026-09-26T10:00:00Z'), task('closed', '2026-09-22T10:00:00Z', { status: 'completed' })],
      alerts: [alert('f', 'follow-up'), alert('c', 'celebration'), alert('t', 'task'), alert('deal', 'pipeline'), alert('m', 'mailer', { priority: 'urgent' })],
    }, NOW);

    const byKind = Object.fromEntries(inbox.sections.map((entry) => [entry.kind, entry.items.map((item) => item.id)]));
    expect(byKind.reply).toEqual(['reply:a']);
    expect(byKind.approval).toEqual(['approval:p']);
    expect(byKind.task).toEqual(['task:late', 'task:today']);
    expect(byKind.alert).toEqual(['alert:m', 'alert:deal']);
    expect(inbox.total).toBe(6);
    expect(inbox.urgent).toBe(2);
  });

  it('orders urgent replies first and links to the person', () => {
    const inbox = buildInboxProjection({ replies: [reply('calm', { receivedAt: '2026-09-23T14:00:00Z' }), reply('hot', { urgency: 'high' })] }, NOW);
    const replies = inbox.sections[0]!;
    expect(replies.items.map((item) => item.id)).toEqual(['reply:hot', 'reply:calm']);
    expect(replies.items[0]!.href).toBe('/contacts/c-hot');
  });

  it('distinguishes an unavailable source from an empty one and caps each section', () => {
    const inbox = buildInboxProjection({ tasks: Array.from({ length: 8 }, (_, index) => task(String(index), '2026-09-23T10:00:00Z')) }, NOW);
    const tasks = inbox.sections.find((entry) => entry.kind === 'task')!;
    expect(tasks.total).toBe(8);
    expect(tasks.items).toHaveLength(5);
    expect(inbox.sections.find((entry) => entry.kind === 'reply')!.available).toBe(false);
  });

  it('collapses many alerts from one rule into a single decision', () => {
    const inbox = buildInboxProjection({
      alerts: ['a', 'b', 'c', 'd'].map((id) => alert(id, 'mailer', { rule: 'mailer-incomplete-address', reason: 'Street, city, state, or ZIP is blank.' } as unknown as Partial<OmnixCopilotAlert>)),
    }, NOW);
    const alerts = inbox.sections[3]!;
    expect(alerts.items).toEqual([expect.objectContaining({ id: 'alert-group:mailer-incomplete-address', title: 'Street, city, state, or ZIP is blank', detail: '4 records · review together' })]);
    const known = buildInboxProjection({
      alerts: ['a', 'b', 'c'].map((id) => alert(id, 'mailer', { rule: 'mailer-missing-address' } as Partial<OmnixCopilotAlert>)),
    }, NOW);
    expect(known.sections[3]!.items[0]).toMatchObject({ title: '3 mailing addresses are incomplete', href: '/mailers' });
    expect(inbox.total).toBe(1);
  });

  it('uses contact names for approvals and alerts when known', () => {
    const inbox = buildInboxProjection({
      proposals: [proposal('p', { contactId: 'c-1' })],
      alerts: [alert('d', 'pipeline')],
      contactNames: { 'c-1': 'Ruth Hollings' },
    }, NOW);
    expect(inbox.sections[1]!.items[0]!.detail).toBe('For Ruth Hollings');
    expect(inbox.sections[3]!.items[0]!.title).toBe('Ruth Hollings · Alert d');
  });

  it('puts Florida readiness gaps with deal alerts, urgent first, linked to the deal', () => {
    const gap = (transactionId: string, tone: 'attention' | 'urgent') => ({
      key: 'buyer-agreement' as const, transactionId, title: 'Written buyer agreement', state: 'missing' as const, tone,
      detail: 'Needed before you tour homes together.', sourceUrl: 'https://www.nar.realtor/the-facts', milestoneKind: 'buyer-agreement' as const,
      transactionTitle: `Deal ${transactionId}`, contactId: 'c-1',
    });
    const inbox = buildInboxProjection({ alerts: [alert('a', 'pipeline')], readiness: [gap('t-1', 'attention'), gap('t-2', 'urgent')] }, NOW);
    const deals = inbox.sections[3]!;
    expect(deals.items.map((item) => item.id)).toEqual(['readiness:t-2:buyer-agreement', 'readiness:t-1:buyer-agreement', 'alert:a']);
    expect(deals.items[0]).toMatchObject({ urgent: true, href: '/transactions#transaction-t-2', title: 'Written buyer agreement · Deal t-2' });
    expect(inbox.urgent).toBe(1);
  });
});
