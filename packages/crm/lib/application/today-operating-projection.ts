import { effectiveAttentionPriority, type AttentionItem, type AttentionPriority } from '@/lib/domain/attention';
import type { ConnectorConnection } from '@/lib/domain/connector';
import type { NurturePlan } from '@/lib/domain/nurture-plan';
import type { OmnixActionProposal } from '@/lib/domain/omnix-operational-brain';
import type { InboundResponseSignal, TransactionMilestone } from '@/lib/domain/operational-signal';
import type { RealEstateTransaction } from '@/lib/domain/transaction';

export type TodaySourceState = 'available' | 'unavailable';

export interface TodaySourceResult<T> {
  readonly state: TodaySourceState;
  readonly value: readonly T[];
}

export interface TodayPriorityContributor {
  readonly id: string;
  readonly priority: AttentionPriority;
  readonly category: string;
  readonly reason: string;
  readonly href: string;
  readonly dueAt?: string;
  readonly evidenceCount: number;
}

export interface TodayOperatingProjection {
  readonly asOf: string;
  readonly sourceState: TodaySourceState;
  readonly priorityContributors: readonly TodayPriorityContributor[];
  readonly approvals: { readonly state: TodaySourceState; readonly count: number; readonly topLabel?: string };
  readonly replies: { readonly state: TodaySourceState; readonly count: number; readonly topLabel?: string };
  readonly deadlines: { readonly state: TodaySourceState; readonly count: number; readonly overdue: number; readonly topLabel?: string };
  readonly growth: { readonly state: TodaySourceState; readonly activeNurtures: number; readonly dueNurtures: number };
  readonly connections: { readonly state: TodaySourceState; readonly connected: number; readonly needsAttention: number; readonly labels: readonly string[] };
  readonly business: { readonly state: TodaySourceState; readonly activeTransactions: number; readonly underContract: number };
  readonly unknowns: { readonly count: number; readonly labels: readonly string[] };
}

export interface TodayOperatingSources {
  readonly attention: TodaySourceResult<AttentionItem>;
  readonly proposals: TodaySourceResult<OmnixActionProposal>;
  readonly inbound: TodaySourceResult<InboundResponseSignal>;
  readonly milestones: TodaySourceResult<TransactionMilestone>;
  readonly connections: TodaySourceResult<ConnectorConnection>;
  readonly nurture: TodaySourceResult<NurturePlan>;
  readonly transactions: TodaySourceResult<RealEstateTransaction>;
}

const PROVIDER_LABEL: Readonly<Record<ConnectorConnection['provider'], string>> = {
  'contract-test': 'Test connector',
  google: 'Google Workspace',
  mailchimp: 'Mailchimp',
  twilio: 'Texting',
  meta: 'Instagram and Facebook',
};

function validTime(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function earliestProposal(items: readonly OmnixActionProposal[]): OmnixActionProposal | undefined {
  return [...items].sort((left, right) => right.priorityScore - left.priorityScore
    || validTime(left.dueAt) - validTime(right.dueAt)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id))[0];
}

function earliestInbound(items: readonly InboundResponseSignal[]): InboundResponseSignal | undefined {
  return [...items].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt)
    || left.id.localeCompare(right.id))[0];
}

function earliestMilestone(items: readonly TransactionMilestone[]): TransactionMilestone | undefined {
  return [...items].sort((left, right) => left.dueAt.localeCompare(right.dueAt)
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id))[0];
}

function uniqueLabels(labels: readonly (string | undefined)[], maximum = 3): string[] {
  return [...new Set(labels.filter((label): label is string => Boolean(label)))].slice(0, maximum);
}

export function buildTodayOperatingProjection(
  sources: TodayOperatingSources,
  now = new Date(),
): TodayOperatingProjection {
  const asOf = now.toISOString();
  const proposals = sources.proposals.value.filter((item) => item.state === 'pending');
  const inbound = sources.inbound.value.filter((item) => !item.acknowledgedAt);
  const milestones = sources.milestones.value.filter((item) => item.state === 'open');
  const connections = sources.connections.value.filter((item) => item.provider !== 'contract-test' && !item.disconnectedAt);
  const nurture = sources.nurture.value;
  const transactions = sources.transactions.value.filter((item) => !['closed', 'lost', 'cancelled'].includes(item.status));
  const topProposal = earliestProposal(proposals);
  const topInbound = earliestInbound(inbound);
  const topMilestone = earliestMilestone(milestones);
  const degradedConnections = connections.filter((item) => item.status !== 'active');
  const unknownLabels = uniqueLabels([
    inbound.some((item) => item.intelligenceState !== 'classified' || item.unknowns.length > 0)
      ? 'Some replies still need human interpretation' : undefined,
    milestones.some((item) => item.verificationState !== 'verified')
      ? 'Some transaction dates are not verified' : undefined,
    transactions.some((item) => !item.kindVerified || item.kind === 'unclassified')
      ? 'Some transactions need a verified type' : undefined,
    sources.connections.state === 'unavailable' ? 'Connection health could not be checked' : undefined,
  ]);

  const sourceStates = Object.values(sources).map((source) => source.state);
  return Object.freeze({
    asOf,
    sourceState: sourceStates.every((state) => state === 'available') ? 'available' : 'unavailable',
    priorityContributors: Object.freeze(sources.attention.value.slice(0, 5).map((item) => Object.freeze({
      id: item.id,
      priority: effectiveAttentionPriority(item, now),
      category: item.category,
      reason: item.reason,
      href: item.href,
      ...(item.dueAt ? { dueAt: item.dueAt } : {}),
      evidenceCount: item.evidence.length,
    }))),
    approvals: Object.freeze({
      state: sources.proposals.state,
      count: proposals.length,
      ...(topProposal ? { topLabel: topProposal.title } : {}),
    }),
    replies: Object.freeze({
      state: sources.inbound.state,
      count: inbound.length,
      ...(topInbound ? { topLabel: topInbound.contactName } : {}),
    }),
    deadlines: Object.freeze({
      state: sources.milestones.state,
      count: milestones.length,
      overdue: milestones.filter((item) => validTime(item.dueAt) < now.getTime()).length,
      ...(topMilestone ? { topLabel: `${topMilestone.label} · ${topMilestone.contactName}` } : {}),
    }),
    growth: Object.freeze({
      state: sources.nurture.state,
      activeNurtures: nurture.filter((item) => item.state === 'active').length,
      dueNurtures: nurture.filter((item) => item.state === 'active' && validTime(item.nextStepAt) <= now.getTime()).length,
    }),
    connections: Object.freeze({
      state: sources.connections.state,
      connected: connections.filter((item) => item.status === 'active').length,
      needsAttention: degradedConnections.length,
      labels: Object.freeze(uniqueLabels(degradedConnections.map((item) => PROVIDER_LABEL[item.provider]))),
    }),
    business: Object.freeze({
      state: sources.transactions.state,
      activeTransactions: transactions.length,
      underContract: transactions.filter((item) => item.status === 'under-contract').length,
    }),
    unknowns: Object.freeze({ count: unknownLabels.length, labels: Object.freeze(unknownLabels) }),
  });
}
