import { randomUUID } from 'node:crypto';
import { CaptureOutcomeError, CAPTURE_SOURCE_MAX, captureInstant, captureText, type CaptureOperationAfter, type CaptureOperationType, type CaptureOutcomeOperation } from '../domain/capture-outcome.ts';
import { PIPELINE_LABEL } from '../domain/contact.ts';
import { transitionNurturePlan } from '../domain/nurture-plan.ts';
import type { WorkspaceScope } from '../domain/workspace.ts';
import type { ContactRepository } from '../data/repository.ts';
import type { ActivityRepository } from '../data/activity-repository.ts';
import type { NurturePlanRepository } from '../data/nurture-plan-repository.ts';
import type { RichContactRepository } from '../data/rich-contact-repository.ts';
import type { ConnectorRepository } from '../data/connector-repository.ts';
import type { ContactOutboundGuard } from '../data/contact-outbound-guard.ts';
import { scanOmnixPromptContent } from './omnix-prompt-guard.ts';

export interface CaptureOperationDependencies {
  readonly contacts: ContactRepository; readonly activities: ActivityRepository; readonly nurture: NurturePlanRepository;
  readonly richContacts?: RichContactRepository; readonly connectors?: ConnectorRepository; readonly outboundGuard?: ContactOutboundGuard;
}
const FIELDS: Record<CaptureOperationType, readonly (keyof CaptureOperationAfter)[]> = {
  'note-append': ['text'], 'task-create': ['title', 'dueAt'], 'pipeline-move': ['toStage'],
  'nurture-plan': ['cadenceDays', 'maximumSteps', 'startAt'], 'nurture-transition': ['planId', 'action', 'snoozedUntil', 'stopReason'],
  'google-email-draft': ['connectionId', 'contactPointId', 'subject', 'body'], 'google-calendar-event': ['connectionId', 'taskId', 'startAt', 'endAt', 'timeZone'],
};
function text(value: unknown, maximum: number, name: string) {
  const checked = captureText(value, maximum, name);
  if (!scanOmnixPromptContent(checked).safe) throw new CaptureOutcomeError('invalid-input', `${name} failed the input guard.`);
  return checked;
}
function integer(value: unknown, max: number, name: string) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) throw new CaptureOutcomeError('invalid-input', `${name} must be between 1 and ${max}.`);
  return Number(value);
}
export function captureCommunicationBlocked(source: string): boolean {
  const normalized = source.normalize('NFKC').replace(/[‘’ʼ]/gu, "'").replace(/\s+/gu, ' ');
  return /\b(?:do not|don't|stop|never|no longer)\b.{0,45}\b(?:email(?:ing|s)?|text(?:ing|s)?|contact(?:ing|s)?|messag(?:e|es|ing)|call(?:ing|s)?)\b|\b(?:unsubscribe|opt[ -]?out)\b/iu.test(normalized);
}
/** A conservative deterministic draft lint, separate from model safety instructions. */
export function validateCaptureDraftLanguage(source: string): void {
  if (/\b(?:white.only|black.only|no children|no families|no immigrants|christian.only|muslim.only|avoid.{0,25}(?:race|religion|ethnicity)|steer.{0,40}(?:race|religion|ethnicity))\b/iu.test(source)) {
    throw new CaptureOutcomeError('invalid-input', 'Remove discriminatory targeting or steering instructions before preparing a draft.');
  }
}
export async function captureOperationOptions(deps: CaptureOperationDependencies, scope: WorkspaceScope, contactId: string) {
  const contact = await deps.contacts.get(contactId);
  if (!contact || contact.archivedAt) throw new CaptureOutcomeError('not-found', 'An active contact is required.');
  const [plans, tasks, connections, points] = await Promise.all([
    deps.nurture.list(scope, { contactId, limit: 50 }), deps.activities.listTasks(scope, { contactId, status: 'open', limit: 100 }),
    deps.connectors?.listConnections(scope, { provider: 'google', limit: 20 }) ?? [], deps.richContacts?.listContactPoints(scope, contactId) ?? [],
  ]);
  return { pipelineStage: contact.pipelineStage, pipelineStages: PIPELINE_LABEL,
    nurturePlans: plans.filter((plan) => ['active', 'paused', 'snoozed'].includes(plan.state)).map(({ id, state, version, cadenceDays, maximumSteps }) => ({ id, state, version, cadenceDays, maximumSteps })),
    tasks: tasks.map(({ id, title, dueAt, taskVersion }) => ({ id, title, dueAt, taskVersion })),
    connections: connections.filter((item) => item.workspaceId === scope.workspaceId && ['active', 'degraded'].includes(item.status)).map(({ id, remoteAccountLabel, grantedScopes }) => ({ id, label: remoteAccountLabel ?? 'Google account', gmail: grantedScopes.includes('https://www.googleapis.com/auth/gmail.send'), calendar: grantedScopes.includes('https://www.googleapis.com/auth/calendar.app.created') })),
    emailRecipients: points.filter((point) => point.workspaceId === scope.workspaceId && point.contactId === contactId && point.type === 'email' && !point.archivedAt && point.emailSubscribed !== false && contact.emailSubscribed === true).map(({ id, normalizedValue }) => ({ id, email: normalizedValue })),
    providerPreparationAvailable: scope.mode === 'live' && !!deps.connectors && !!deps.richContacts && !!deps.outboundGuard,
  };
}
export async function prepareCaptureOperation(deps: CaptureOperationDependencies, scope: WorkspaceScope, contactId: string, input: { type: CaptureOperationType; after: CaptureOperationAfter }, now: Date, id: string = randomUUID()): Promise<CaptureOutcomeOperation> {
  const fields = FIELDS[input.type];
  if (!fields || !input.after || typeof input.after !== 'object' || Array.isArray(input.after) || Object.keys(input.after).some((field) => !fields.includes(field as keyof CaptureOperationAfter))) throw new CaptureOutcomeError('invalid-input', 'Unsupported capture operation fields.');
  const contact = await deps.contacts.get(contactId);
  if (!contact || contact.archivedAt) throw new CaptureOutcomeError('not-found', 'An active contact is required.');
  const base: CaptureOutcomeOperation = { id, type: input.type, after: {}, before: null, preconditions: {}, requiredAuthority: 'active-member', evidence: null, confidence: 'manual', flags: [], selected: false, state: 'pending' };
  const after = input.after;
  if (input.type === 'note-append') return { ...base, after: { text: text(after.text, CAPTURE_SOURCE_MAX, 'Note') }, consequence: 'Append a contact note; existing notes are preserved.' };
  if (input.type === 'task-create') return { ...base, after: { title: text(after.title, 160, 'Task'), dueAt: captureInstant(after.dueAt) }, consequence: 'Create one task assigned to the confirming member.' };
  if (input.type === 'pipeline-move') {
    if (!after.toStage || !Object.hasOwn(PIPELINE_LABEL, after.toStage)) throw new CaptureOutcomeError('invalid-input', 'Choose a valid relationship pipeline stage.');
    if (contact.pipelineStage === after.toStage) throw new CaptureOutcomeError('invalid-input', 'The contact already has that pipeline stage.');
    return { ...base, after: { toStage: after.toStage }, before: { pipelineStage: contact.pipelineStage, nextTouchAt: contact.nextTouchAt ?? null },
      preconditions: { pipelineStage: contact.pipelineStage, contactVersion: new Date(contact.updatedAt ?? contact.createdAt).toISOString() },
      consequence: ['closed', 'lost'].includes(after.toStage) ? 'Move the relationship pipeline and clear its next-touch date. Transaction status and deadlines stay unchanged.' : 'Move only the relationship pipeline. Transaction status and deadlines stay unchanged.' };
  }
  if (input.type === 'nurture-plan') {
    const plans = await deps.nurture.list(scope, { contactId, limit: 50 });
    if (plans.some((plan) => ['active', 'paused', 'snoozed'].includes(plan.state))) throw new CaptureOutcomeError('conflict', 'This contact already has a current nurture plan. Choose a transition instead.');
    return { ...base, after: { cadenceDays: integer(after.cadenceDays, 365, 'Cadence days'), maximumSteps: integer(after.maximumSteps, 120, 'Maximum steps'), startAt: captureInstant(after.startAt) }, before: { nurtureState: 'none' }, preconditions: { noCurrentNurture: true }, consequence: 'Start scheduled nurture steps. Each step creates a governed follow-up proposal; nothing is sent automatically.' };
  }
  if (input.type === 'nurture-transition') {
    if (!after.planId) throw new CaptureOutcomeError('invalid-input', 'Choose a nurture plan.');
    const plan = await deps.nurture.get(scope, after.planId);
    if (!plan || plan.contactId !== contactId || plan.workspaceId !== scope.workspaceId) throw new CaptureOutcomeError('not-found', 'The contact nurture plan was not found.');
    if (!after.action || !['pause', 'resume', 'snooze', 'stop'].includes(after.action)) throw new CaptureOutcomeError('invalid-input', 'Choose a valid nurture transition.');
    const clean = { planId: plan.id, action: after.action, ...(after.action === 'snooze' ? { snoozedUntil: captureInstant(after.snoozedUntil) } : {}), ...(after.action === 'stop' ? { stopReason: text(after.stopReason, 240, 'Stop reason') } : {}) };
    const next = transitionNurturePlan(plan, { ...clean, action: clean.action as 'pause' | 'resume' | 'snooze' | 'stop' }, now);
    return { ...base, after: clean, before: { nurtureState: plan.state, planVersion: plan.version }, preconditions: { planId: plan.id, planVersion: plan.version }, consequence: `Change nurture from ${plan.state} to ${next.state}; existing messages are not sent or undone.` };
  }
  if (scope.mode !== 'live' || !deps.connectors) throw new CaptureOutcomeError('unavailable', 'Provider preparation requires a connected live workspace.');
  const connections = await deps.connectors.listConnections(scope, { provider: 'google', limit: 20 });
  const connection = connections.find((item) => item.id === after.connectionId && item.workspaceId === scope.workspaceId && ['active', 'degraded'].includes(item.status));
  const requiredScope = input.type === 'google-email-draft' ? 'https://www.googleapis.com/auth/gmail.send' : 'https://www.googleapis.com/auth/calendar.app.created';
  if (!connection || !connection.grantedScopes.includes(requiredScope)) throw new CaptureOutcomeError('unavailable', 'Choose a Google connection with the required capability.');
  if (input.type === 'google-email-draft') {
    if (!deps.richContacts || !deps.outboundGuard) throw new CaptureOutcomeError('unavailable', 'Authoritative recipient checks are unavailable.');
    const points = await deps.richContacts.listContactPoints(scope, contactId);
    const recipient = points.find((point) => point.id === after.contactPointId && point.workspaceId === scope.workspaceId && point.contactId === contactId && point.type === 'email' && !point.archivedAt);
    if (!recipient || recipient.emailSubscribed === false || contact.emailSubscribed !== true) throw new CaptureOutcomeError('forbidden', 'The selected email is not eligible under the stored subscription state.');
    await deps.outboundGuard.assertTarget(scope, contactId, recipient.id);
    if (!connection.remoteAccountLabel) throw new CaptureOutcomeError('unavailable', 'The sender account is unavailable.');
    const subject = text(after.subject, 160, 'Subject').trim(); const body = text(after.body, 8000, 'Email body').trim();
    validateCaptureDraftLanguage(`${subject}\n${body}`);
    return { ...base, requiredAuthority: 'owner', after: { connectionId: connection.id, contactPointId: recipient.id, subject, body },
      before: { recipient: recipient.normalizedValue, sender: connection.remoteAccountLabel }, preconditions: { contactPointVersion: recipient.updatedAt, recipient: recipient.normalizedValue, connectionVersion: connection.updatedAt, sender: connection.remoteAccountLabel },
      consequence: 'Prepare an encrypted Gmail draft and a separate owner approval intent. This does not send the email.' };
  }
  if (!after.taskId) throw new CaptureOutcomeError('invalid-input', 'Choose an existing contact task for the calendar intent.');
  const task = await deps.activities.getTask(scope, after.taskId);
  if (!task || task.contactId !== contactId || task.status !== 'open' || !task.taskVersion) throw new CaptureOutcomeError('not-found', 'An open task for this contact is required.');
  const startAt = captureInstant(after.startAt); const endAt = captureInstant(after.endAt);
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new CaptureOutcomeError('invalid-input', 'Event end must follow its start.');
  const timeZone = text(after.timeZone, 80, 'Timezone');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(now); } catch { throw new CaptureOutcomeError('invalid-input', 'Choose a valid IANA timezone.'); }
  return { ...base, requiredAuthority: 'owner', after: { connectionId: connection.id, taskId: task.id, startAt, endAt, timeZone }, before: { taskTitle: task.title, taskVersion: task.taskVersion, taskDueAt: task.dueAt },
    preconditions: { taskVersion: task.taskVersion, taskTitle: task.title, connectionVersion: connection.updatedAt }, consequence: 'Prepare a separate approval intent to synchronize this task with the Omnix calendar. No event is published yet.' };
}

export function captureChildPayload(contactId: string, operation: CaptureOutcomeOperation): Readonly<Record<string, unknown>> {
  const after = operation.after; const pre = operation.preconditions ?? {};
  switch (operation.type) {
    case 'note-append': return { contactId, body: after.text! };
    case 'task-create': return { contactId, title: after.title!, dueAt: captureInstant(after.dueAt) };
    case 'pipeline-move': return { contactId, fromStage: pre.pipelineStage!, toStage: after.toStage!, expectedUpdatedAt: pre.contactVersion! };
    case 'nurture-plan': return { contactId, cadenceDays: after.cadenceDays!, maximumSteps: after.maximumSteps!, startAt: after.startAt! };
    case 'nurture-transition': return { contactId, planId: after.planId!, expectedVersion: pre.planVersion!, action: after.action!, ...(after.snoozedUntil ? { snoozedUntil: after.snoozedUntil } : {}), ...(after.stopReason ? { stopReason: after.stopReason } : {}) };
    case 'google-email-draft': return { contactId, connectionId: after.connectionId!, contactPointId: after.contactPointId!, recipient: pre.recipient!, sender: pre.sender!, contactPointVersion: pre.contactPointVersion!, connectionVersion: pre.connectionVersion!, subject: after.subject!, body: after.body!, captureExactTarget: true };
    case 'google-calendar-event': return { contactId, connectionId: after.connectionId!, connectionVersion: pre.connectionVersion!, taskId: after.taskId!, taskVersion: pre.taskVersion!, title: pre.taskTitle!, startAt: after.startAt!, endAt: after.endAt!, timeZone: after.timeZone!, captureExactTarget: true };
  }
}
export async function captureOperationIsCurrent(deps: CaptureOperationDependencies, scope: WorkspaceScope, contactId: string, operation: CaptureOutcomeOperation, now: Date): Promise<boolean> {
  try {
    const fresh = await prepareCaptureOperation(deps, scope, contactId, operation, now, operation.id);
    // Compare only the affected target precondition, never an unrelated contact-wide snapshot.
    return JSON.stringify(fresh.preconditions) === JSON.stringify(operation.preconditions);
  } catch { return false; }
}
