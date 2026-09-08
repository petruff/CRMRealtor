'use client';

import { useState } from 'react';
import type { CaptureOperationAfter, CaptureOperationType } from '@/lib/domain/capture-outcome';
import type { captureOperationOptions } from '@/lib/application/capture-outcome-operations';

export type CaptureOptions = Awaited<ReturnType<typeof captureOperationOptions>>;
export const captureOperationLabels: Record<CaptureOperationType, string> = {
  'note-append': 'Add a conversation note', 'task-create': 'Create a follow-up task',
  'pipeline-move': 'Change relationship stage', 'nurture-plan': 'Start a follow-up plan',
  'nurture-transition': 'Adjust a follow-up plan', 'google-email-draft': 'Prepare a Gmail draft',
  'google-calendar-event': 'Prepare a task calendar event',
};
export function captureLocalInputDate(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function readCaptureOperationForm(type: CaptureOperationType, form: FormData): CaptureOperationAfter {
  const text = (key: string) => String(form.get(key) ?? '');
  const instant = (key: string) => { const date = new Date(text(key)); if (!Number.isFinite(date.valueOf())) throw new Error('Choose a valid date and time.'); return date.toISOString(); };
  switch (type) {
    case 'note-append': return { text: text('text') };
    case 'task-create': return { title: text('title'), dueAt: instant('dueAt') };
    case 'pipeline-move': return { toStage: text('toStage') };
    case 'nurture-plan': return { cadenceDays: Number(text('cadenceDays')), maximumSteps: Number(text('maximumSteps')), startAt: instant('startAt') };
    case 'nurture-transition': return { planId: text('planId'), action: text('action'), ...(text('action') === 'snooze' ? { snoozedUntil: instant('snoozedUntil') } : {}), ...(text('action') === 'stop' ? { stopReason: text('stopReason') } : {}) };
    case 'google-email-draft': return { connectionId: text('connectionId'), contactPointId: text('contactPointId'), subject: text('subject'), body: text('body') };
    case 'google-calendar-event': return { connectionId: text('connectionId'), taskId: text('taskId'), startAt: instant('startAt'), endAt: instant('endAt'), timeZone: text('timeZone') };
  }
}
export function CaptureOperationFields({ type, after = {}, options }: { type: CaptureOperationType; after?: CaptureOperationAfter; options?: CaptureOptions }) {
  const [transition, setTransition] = useState(after.action ?? 'pause');
  const date = (name: string, label: string, value?: string) => <label>{label}<input name={name} type="datetime-local" required defaultValue={captureLocalInputDate(value)} /><small>Uses your device’s timezone.</small></label>;
  const connection = (kind: 'gmail' | 'calendar') => <label>Google account<select name="connectionId" required defaultValue={after.connectionId ?? ''}><option value="" disabled>Choose a connected account</option>{options?.connections.filter(item => item[kind]).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  switch (type) {
    case 'note-append': return <label>Note<textarea name="text" defaultValue={after.text} maxLength={8000} required rows={5} /></label>;
    case 'task-create': return <><label>Task title<input name="title" defaultValue={after.title} maxLength={160} required /></label>{date('dueAt', 'Due date and time', after.dueAt)}</>;
    case 'pipeline-move': return <><p>Current stage: {options?.pipelineStage ? options.pipelineStages[options.pipelineStage] : 'Shown in the review'}</p><label>New relationship stage<select name="toStage" defaultValue={after.toStage ?? ''} required><option value="" disabled>Choose a stage</option>{Object.entries(options?.pipelineStages ?? {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>;
    case 'nurture-plan': return <><label>Days between follow-ups<input name="cadenceDays" type="number" min={1} max={365} defaultValue={after.cadenceDays ?? 7} required /></label><label>Number of follow-ups<input name="maximumSteps" type="number" min={1} max={52} defaultValue={after.maximumSteps ?? 4} required /></label>{date('startAt', 'First follow-up', after.startAt)}</>;
    case 'nurture-transition': return <><label>Follow-up plan<select name="planId" defaultValue={after.planId ?? ''} required><option value="" disabled>Choose a current plan</option>{options?.nurturePlans.map(plan => <option key={plan.id} value={plan.id}>{plan.state} · every {plan.cadenceDays} days · {plan.maximumSteps} steps</option>)}</select></label><label>Change<select name="action" value={transition} onChange={event => setTransition(event.target.value)}><option value="pause">Pause</option><option value="resume">Resume</option><option value="snooze">Snooze</option><option value="stop">Stop</option></select></label>{transition === 'snooze' && date('snoozedUntil', 'Resume after', after.snoozedUntil)}{transition === 'stop' && <label>Reason for stopping<input name="stopReason" defaultValue={after.stopReason} maxLength={300} required /></label>}</>;
    case 'google-email-draft': return <>{connection('gmail')}<label>Recipient<select name="contactPointId" defaultValue={after.contactPointId ?? ''} required><option value="" disabled>Choose a contact email</option>{options?.emailRecipients.map(point => <option key={point.id} value={point.id}>{point.email}</option>)}</select></label><label>Subject<input name="subject" defaultValue={after.subject} maxLength={160} required /></label><label>Draft message<textarea name="body" defaultValue={after.body} rows={5} maxLength={5000} required /></label><p className="capture-privacy">This prepares a draft for provider review. It does not send an email.</p></>;
    case 'google-calendar-event': return <>{connection('calendar')}<label>Existing task<select name="taskId" defaultValue={after.taskId ?? ''} required><option value="" disabled>Choose an open task</option>{options?.tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>{date('startAt', 'Start', after.startAt)}{date('endAt', 'End', after.endAt)}<label>Event timezone<input name="timeZone" defaultValue={after.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} maxLength={80} required /></label><p className="capture-privacy">Times use your device timezone; the named event timezone is shown for provider review. This prepares an intent, not a confirmed appointment.</p></>;
  }
}
