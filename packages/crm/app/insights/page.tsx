import type { Metadata } from 'next';
import {
  InsightsDashboard,
  type InsightsContributorView,
  type InsightsDashboardModel,
  type InsightsDrilldownView,
} from '@/components/insights-dashboard';
import { getOperatingInsights } from '@/lib/application/operating-insights-service';
import { getRepository } from '@/lib/data';
import { PIPELINE_STAGE_ORDER } from '@/lib/domain/workspace-intelligence';
import type { InsightAvailability } from '@/lib/domain/operating-insights';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Insights' };

const PERIODS = [30, 90, 365] as const;
type Period = (typeof PERIODS)[number];
type DisplayStatus = InsightsDashboardModel['portfolioStatus'];

function period(value: unknown): Period {
  const parsed = Number(value);
  return PERIODS.includes(parsed as Period) ? parsed as Period : 90;
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator ? Math.round((numerator / denominator) * 1_000) / 10 : null;
}

function displayStatus(status: InsightAvailability): DisplayStatus {
  return status === 'unavailable' ? 'insufficient-evidence' : status;
}

function contactContributors(
  contactIds: readonly string[],
  labels: ReadonlyMap<string, string>,
  detail?: (contactId: string) => string | undefined,
): InsightsContributorView[] {
  return contactIds.map((recordId) => ({
    entityType: 'contact',
    recordId,
    label: labels.get(recordId) ?? 'Contact record',
    href: `/contacts/${encodeURIComponent(recordId)}`,
    ...(detail?.(recordId) ? { detail: detail(recordId) } : {}),
  }));
}

function taskContributors(taskIds: readonly string[], labels: ReadonlyMap<string, string>, detail: string): InsightsContributorView[] {
  return taskIds.map((recordId) => ({
    entityType: 'task', recordId, label: labels.get(recordId) ?? 'CRM task', detail,
  }));
}

function drilldown(
  id: string,
  label: string,
  status: DisplayStatus,
  scope: InsightsDrilldownView['scope'],
  contributors: readonly InsightsContributorView[],
): InsightsDrilldownView {
  return { id, label, status, scope, contributors };
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[]; detail?: string | string[] }>;
}) {
  const params = await searchParams;
  const periodDays = period(typeof params.period === 'string' ? params.period : undefined);
  const requestedDetail = typeof params.detail === 'string' ? params.detail : undefined;
  const now = new Date();
  const context = await getRepository();
  const report = await getOperatingInsights(context, { period: periodDays }, now);

  const portfolioStatus = displayStatus(report.portfolio.status);
  const pipelineStatus = displayStatus(report.pipeline.status);
  const sourceStatus = displayStatus(report.sourceProgression.status);
  const workStatus: DisplayStatus = report.taskRhythm.status === 'unavailable'
    || report.ownerAssistant.status === 'unavailable'
    ? 'insufficient-evidence'
    : report.taskRhythm.status === 'possibly-truncated'
      || report.ownerAssistant.status === 'possibly-truncated'
      ? 'possibly-truncated'
      : 'available';
  const leadMetric = (leadType: 'hot' | 'warm' | 'nurture') => (
    report.portfolio.leadTypes.find((item) => item.leadType === leadType)
  );

  const sources = report.sourceProgression.sources
    .map((source) => ({
      id: source.source,
      label: source.label,
      count: source.contactCount,
      progressed: source.current.progressedContacts,
      progressionPercentage: percentage(source.current.progressedContacts, source.contactCount),
      progressedChange: source.progressedContactChange,
      detailId: `source-${source.source}`,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  const drilldowns: InsightsDrilldownView[] = [
    drilldown('portfolio-all', 'Relationship book', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.allContactIds, report.contactDisplayNames)),
    drilldown('portfolio-attention', 'Needs attention now', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.needsAttentionContactIds, report.contactDisplayNames)),
    drilldown('portfolio-progressing', 'Progressing relationships', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.progressingContactIds, report.contactDisplayNames)),
    drilldown('portfolio-under-contract', 'Under contract', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.underContractContactIds, report.contactDisplayNames)),
    ...(['hot', 'warm', 'nurture'] as const).map((leadType) => drilldown(
      `portfolio-${leadType}`,
      `${leadMetric(leadType)?.label ?? leadType} relationships`,
      portfolioStatus,
      'snapshot',
      contactContributors(leadMetric(leadType)?.contactIds ?? [], report.contactDisplayNames),
    )),
    drilldown('portfolio-overdue', 'Overdue follow-ups', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.overdueContactIds, report.contactDisplayNames)),
    drilldown('portfolio-needs-qualification', 'Needs qualification', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.needsQualificationContactIds, report.contactDisplayNames)),
    drilldown('portfolio-never-contacted', 'Never contacted', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.neverContactedContactIds, report.contactDisplayNames)),
    drilldown('readiness-phone', 'Phone on file', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.withPhoneContactIds, report.contactDisplayNames)),
    drilldown('readiness-email', 'Email on file', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.withEmailContactIds, report.contactDisplayNames)),
    drilldown('readiness-mail', 'Mailer ready', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.mailReadyContactIds, report.contactDisplayNames)),
    drilldown('readiness-next-touch', 'Next touch set', portfolioStatus, 'snapshot', contactContributors(report.portfolio.contributors.withNextTouchContactIds, report.contactDisplayNames)),
    ...report.pipeline.current.stageMetrics.map((stage) => {
      const daysByContact = new Map(stage.contributors.map((item) => [item.recordId, item.daysInStage] as const));
      return drilldown(
        `stage-${stage.stage}`,
        `${stage.label} stage and aging`,
        pipelineStatus,
        'snapshot',
        contactContributors(stage.contributors.map((item) => item.recordId), report.contactDisplayNames, (contactId) => {
          const days = daysByContact.get(contactId);
          return days === null || days === undefined ? 'Aging evidence unavailable' : `${days} days in stage`;
        }),
      );
    }),
  ];
  const closedCohort = new Set(report.pipeline.current.conversion.closedContactIds);
  drilldowns.push(drilldown(
    'conversion-eligible',
    'Conversion eligible cohort',
    pipelineStatus,
    'current-period',
    contactContributors(report.pipeline.current.conversion.eligibleContactIds, report.contactDisplayNames, (contactId) => (
      closedCohort.has(contactId) ? 'Reached Closed strictly after leaving New' : 'Eligible; no later Closed event in period'
    )),
  ));
  drilldowns.push(
    drilldown('tasks-open', 'Open tasks', workStatus, 'snapshot', taskContributors(report.taskRhythm.workload.openTaskIds, report.taskDisplayNames, 'Open task snapshot')),
    drilldown('tasks-overdue', 'Overdue tasks', workStatus, 'snapshot', taskContributors(report.taskRhythm.workload.overdueTaskIds, report.taskDisplayNames, 'Open and due before as-of time')),
    drilldown('tasks-due-soon', 'Tasks due next 7 days', workStatus, 'snapshot', taskContributors(report.taskRhythm.workload.dueSoonTaskIds, report.taskDisplayNames, 'Open and due within seven days')),
    drilldown('tasks-completed', 'Tasks completed in period', workStatus, 'current-period', taskContributors(report.taskRhythm.current.completedTaskIds, report.taskDisplayNames, 'Distinct stored completion event in selected period')),
    ...report.sourceProgression.sources.map((source) => {
      const closed = new Set(source.current.closedContactIds);
      return drilldown(
        `source-${source.source}`,
        `${source.label} progressed cohort`,
        sourceStatus,
        'current-period',
        contactContributors(source.current.progressedContactIds, report.contactDisplayNames, (contactId) => (
          closed.has(contactId) ? `${source.label}; progressed to Closed in selected period` : `${source.label}; reached a qualifying stage in selected period`
        )),
      );
    }),
  );

  const selectedDrilldownId = requestedDetail && drilldowns.some((item) => item.id === requestedDetail)
    ? requestedDetail
    : 'portfolio-all';
  const model: InsightsDashboardModel = {
    periodDays,
    generatedAt: now.toISOString(),
    isLive: context.isLive,
    portfolioStatus,
    pipelineStatus,
    sourceStatus,
    totalContacts: report.portfolio.totalContacts,
    needsAttention: report.portfolio.health.needsAttention,
    progressing: report.portfolio.health.progressing,
    underContract: report.portfolio.health.underContract,
    portfolio: {
      hot: leadMetric('hot')?.count ?? null,
      warm: leadMetric('warm')?.count ?? null,
      nurture: leadMetric('nurture')?.count ?? null,
      overdue: report.portfolio.health.overdue,
      neverContacted: report.portfolio.health.neverContacted,
      needsQualification: report.portfolio.health.needsQualification,
    },
    pipeline: PIPELINE_STAGE_ORDER.map((stage) => {
      const metric = report.pipeline.current.stageMetrics.find((item) => item.stage === stage);
      return metric
        ? { ...metric, detailId: `stage-${stage}` }
        : { stage, label: stage, count: 0, averageDaysInStage: null, evidenceCount: 0, detailId: `stage-${stage}` };
    }),
    conversion: report.pipeline.current.conversion,
    conversionChange: report.pipeline.conversionPercentagePointChange,
    transitionEvents: report.pipeline.current.evidence.transitionEvents,
    previousTransitionEvents: report.pipeline.previous.evidence.transitionEvents,
    sources,
    work: {
      status: workStatus,
      open: report.taskRhythm.workload.open,
      overdue: report.taskRhythm.workload.overdue,
      dueSoon: report.taskRhythm.workload.dueSoon,
      completed: report.taskRhythm.current.completed,
      previousCompleted: report.taskRhythm.previous.completed,
      completionRate: report.taskRhythm.workload.dueWorkCompletionPercentage,
      onTimeRate: report.taskRhythm.workload.onTimeCompletionPercentage,
      members: report.ownerAssistant.roles.map((role) => ({
        id: role.membershipId ?? role.attribution,
        label: role.label,
        role: role.role,
        attribution: role.attribution,
        open: role.openAssignedTasks,
        overdue: role.overdueAssignedTasks,
        completed: role.completedTasks,
      })),
    },
    readiness: [
      { label: 'Phone on file', value: report.portfolio.readiness.withPhone, detailId: 'readiness-phone' },
      { label: 'Email on file', value: report.portfolio.readiness.withEmail, detailId: 'readiness-email' },
      { label: 'Mailer ready', value: report.portfolio.readiness.mailReady, detailId: 'readiness-mail' },
      { label: 'Next touch set', value: report.portfolio.readiness.withNextTouch, detailId: 'readiness-next-touch' },
    ],
    drilldowns,
    selectedDrilldownId,
    coverage: {
      contactBoundedAt: report.coverage.contacts.boundedAt ?? 500,
      contactPossiblyTruncated: report.coverage.contacts.truncated,
      transitionBoundedAt: report.pipeline.current.evidence.boundedAt,
      transitionPossiblyTruncated: report.coverage.events.truncated,
      taskBoundedAt: report.coverage.tasks.boundedAt ?? 500,
      taskPossiblyTruncated: report.coverage.tasks.truncated,
      schemaVersion: report.schemaVersion,
      currentFrom: report.currentWindow.from,
      currentTo: report.currentWindow.to,
      previousFrom: report.previousWindow.from,
      previousTo: report.previousWindow.to,
      contactRows: report.coverage.contacts.rows,
      transitionRows: report.coverage.events.rows,
      taskRows: report.coverage.tasks.rows,
      membershipRows: report.coverage.memberships.rows,
      mode: report.mode,
    },
  };

  return <InsightsDashboard model={model} />;
}
