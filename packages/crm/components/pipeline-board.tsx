'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { CheckCircle2, GripVertical } from 'lucide-react';
import { LeadBadge } from '@/components/ui';
import { displayName, PIPELINE_LABEL, type Contact, type PipelineStage } from '@/lib/domain/contact';
import { movePipelineStageAction } from '@/app/pipeline/actions';
import type { PipelineContactEvidence, PipelineEvidenceResult } from '@/lib/application/pipeline-evidence';

const STAGES = Object.keys(PIPELINE_LABEL) as PipelineStage[];

function displayDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(value) ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

function NextStepEvidence({ contact, evidence, availability }: {
  contact: Contact;
  evidence?: PipelineContactEvidence;
  availability: PipelineEvidenceResult['availability'];
}) {
  const nextStep = evidence?.nextStep;
  const activity = evidence?.latestActivity;
  if (availability === 'unavailable') {
    return (
      <div className="mt-3 rounded-[var(--sk-control-radius)] bg-surface-2 p-3 text-xs leading-relaxed">
        <p className="font-semibold text-warm">Task and activity evidence unavailable</p>
        <p className="mt-1 text-muted">No task or activity detail is shown until the authorized work queue can be read.</p>
        <Link href="/activities" className="sk-secondary-button mt-3 min-h-11 px-3 text-xs">Open activities</Link>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-[var(--sk-control-radius)] bg-surface-2 p-3 text-xs leading-relaxed">
      {nextStep ? (
        <>
          <p className="text-ink">
            <span className="font-semibold">Next step:</span> {nextStep.label} · <time dateTime={nextStep.date}>{displayDate(nextStep.date)}</time>
          </p>
          <p className="mt-1 text-muted"><span className="font-medium">Source:</span> {nextStep.source}</p>
          <Link href={nextStep.href} className="sk-secondary-button mt-3 min-h-11 px-3 text-xs">
            {nextStep.kind === 'task' ? 'Review task' : 'Review contact'}
          </Link>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-warm">Next step missing</p>
          <Link href={`/contacts/${encodeURIComponent(contact.id)}/edit`} className="sk-secondary-button min-h-11 px-3 text-xs">Add next touch</Link>
        </div>
      )}
      {activity ? (
        <p className="mt-3 break-words border-t border-line pt-2 text-subtle">
          <span className="font-medium text-muted">Latest activity:</span> {activity.type.replaceAll('-', ' ')} · <time dateTime={activity.occurredAt}>{displayDate(activity.occurredAt)}</time> · {activity.source}
        </p>
      ) : (
        <p className="mt-3 break-words border-t border-line pt-2 text-subtle"><span className="font-medium text-muted">Activity evidence:</span> No stored activity for this contact.</p>
      )}
      <p className="mt-2 break-words text-subtle"><span className="font-medium text-muted">Stage evidence:</span> stored stage “{PIPELINE_LABEL[contact.pipelineStage]}”{contact.updatedAt ? ` · updated ${contact.updatedAt}` : ''}.</p>
    </div>
  );
}

export function PipelineBoard({ initialContacts, evidence }: { initialContacts: readonly Contact[]; evidence: PipelineEvidenceResult }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [message, setMessage] = useState('Move cards by drag and drop or the stage selector.');
  const [pending, startTransition] = useTransition();
  const columns = useMemo(() => STAGES.map((stage) => ({ stage, contacts: contacts.filter((contact) => contact.pipelineStage === stage) })), [contacts]);

  const move = (contactId: string, toStage: PipelineStage) => {
    const current = contacts.find((contact) => contact.id === contactId);
    if (!current || current.pipelineStage === toStage || pending) return;
    const before = contacts;
    setContacts((items) => items.map((item) => item.id === contactId ? { ...item, pipelineStage: toStage } : item));
    setMessage(`Saving ${displayName(current)}…`);
    startTransition(async () => {
      const response = await movePipelineStageAction({
        contactId, fromStage: current.pipelineStage, toStage,
        expectedUpdatedAt: current.updatedAt ?? current.createdAt,
        idempotencyKey: `pipeline-${contactId}-${current.pipelineStage}-${toStage}-${Date.now()}`,
      });
      if (!response.ok) { setContacts(before); setMessage(`${response.message} The card was restored.`); return; }
      setMessage(response.message);
      setContacts((items) => items.map((item) => item.id === contactId ? {
        ...item,
        pipelineStage: toStage,
        updatedAt: response.updatedAt ?? item.updatedAt,
      } : item));
    });
  };

  return <>
    <p className="mb-4 text-sm text-muted" aria-live="polite">{message}</p>
    <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {columns.map((column) => <section key={column.stage} aria-labelledby={`stage-${column.stage}`} className="sk-group min-w-0 bg-surface-2 p-1" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); move(event.dataTransfer.getData('text/contact-id'), column.stage); }}>
        <div className="flex min-h-14 items-center gap-3 px-3 py-2"><GripVertical className="size-[18px] shrink-0 text-accent" aria-hidden /><h2 id={`stage-${column.stage}`} className="min-w-0 flex-1 font-display text-lg text-ink">{PIPELINE_LABEL[column.stage]}</h2><span className="tabular rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">{column.contacts.length}</span></div>
        {column.contacts.length ? <ul className="grid gap-px">{column.contacts.map((contact) => <li key={contact.id} draggable={!pending} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/contact-id', contact.id); }} className="bg-surface p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-ink">{displayName(contact)}</p><p className="mt-1 truncate text-xs text-muted">{contact.intent === 'unknown' ? 'Intent not set' : contact.intent.replace('-', ' ')}</p></div><LeadBadge leadType={contact.leadType} /></div>
          <NextStepEvidence contact={contact} evidence={evidence.byContactId[contact.id]} availability={evidence.availability} />
          <label className="mt-3 block text-xs font-medium text-muted" htmlFor={`move-${contact.id}`}>Move stage</label><select id={`move-${contact.id}`} value={contact.pipelineStage} disabled={pending} onChange={(event) => move(contact.id, event.target.value as PipelineStage)} className="mt-1 min-h-11 w-full rounded-[var(--sk-control-radius)] border border-line bg-surface-2 px-3 text-sm text-ink">{STAGES.map((stage) => <option key={stage} value={stage}>{PIPELINE_LABEL[stage]}</option>)}</select>
        </li>)}</ul> : <p className="flex min-h-24 items-center gap-2 bg-surface px-4 text-sm text-muted"><CheckCircle2 className="size-4 text-nurture" aria-hidden /> No contacts in this stage.</p>}
      </section>)}
    </div>
  </>;
}
