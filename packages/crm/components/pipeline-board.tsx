'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, CircleDot, Clock3, GripVertical, History, Search } from 'lucide-react';
import { LeadBadge } from '@/components/ui';
import {
  displayName,
  LEAD_TYPE_LABEL,
  PIPELINE_LABEL,
  type Contact,
  type LeadType,
  type PipelineStage,
} from '@/lib/domain/contact';
import { movePipelineStageAction } from '@/app/pipeline/actions';
import type { PipelineContactEvidence, PipelineEvidenceResult } from '@/lib/application/pipeline-evidence';

const STAGES = Object.keys(PIPELINE_LABEL) as PipelineStage[];
const INITIAL_VISIBLE_CARDS = 8;
const CARD_BATCH_SIZE = 12;
type LeadFilter = 'all' | LeadType;

const STAGE_GUIDANCE: Record<PipelineStage, string> = {
  new: 'New relationships to qualify',
  contacted: 'First conversation started',
  'appointment-set': 'A meeting is on the calendar',
  active: 'Actively buying or selling',
  'under-contract': 'A live transaction is moving',
  closed: 'Completed relationships',
  lost: 'Not moving forward now',
};

function displayDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric',
    ...(!dateOnly ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

function NextStep({ contact, evidence, availability }: {
  contact: Contact;
  evidence?: PipelineContactEvidence;
  availability: PipelineEvidenceResult['availability'];
}) {
  if (availability === 'unavailable') {
    return <div className="pipeline-card-next pipeline-card-next-missing"><CircleDot className="size-4" aria-hidden /><span>Follow-up details are temporarily unavailable.</span></div>;
  }
  const nextStep = evidence?.nextStep;
  if (!nextStep) {
    return (
      <Link href={`/contacts/${encodeURIComponent(contact.id)}/edit`} className="pipeline-card-next pipeline-card-next-missing">
        <CircleDot className="size-4" aria-hidden /><span>Add the next follow-up</span><ArrowRight className="ml-auto size-3.5" aria-hidden />
      </Link>
    );
  }
  return (
    <Link href={nextStep.href} className="pipeline-card-next">
      <Clock3 className="size-4" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{nextStep.label}</span>
      <time className="shrink-0 font-medium" dateTime={nextStep.date}>{displayDate(nextStep.date)}</time>
    </Link>
  );
}

function EvidenceDisclosure({ evidence, availability }: {
  evidence?: PipelineContactEvidence;
  availability: PipelineEvidenceResult['availability'];
}) {
  if (availability === 'unavailable') return <Link href="/activities" className="pipeline-card-evidence-link">Open activities</Link>;
  return (
    <details className="pipeline-card-evidence">
      <summary><History className="size-3.5" aria-hidden />Activity details<ChevronDown className="ml-auto size-3.5" aria-hidden /></summary>
      <div>
        {evidence?.latestActivity ? (
          <p>Last activity: {evidence.latestActivity.type.replaceAll('-', ' ')} on <time dateTime={evidence.latestActivity.occurredAt}>{displayDate(evidence.latestActivity.occurredAt)}</time>.</p>
        ) : <p>No activity has been recorded yet.</p>}
        {evidence?.nextStep ? <p className="mt-1">Follow-up source: {evidence.nextStep.source}.</p> : null}
      </div>
    </details>
  );
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function initialVisibleCounts(): Record<PipelineStage, number> {
  return Object.fromEntries(STAGES.map((stage) => [stage, INITIAL_VISIBLE_CARDS])) as Record<PipelineStage, number>;
}

export function PipelineBoard({ initialContacts, evidence }: { initialContacts: readonly Contact[]; evidence: PipelineEvidenceResult }) {
  const [contacts, setContacts] = useState<readonly Contact[]>(initialContacts);
  const [message, setMessage] = useState('Pipeline ready. Drag a card or use “Move to”.');
  const [search, setSearch] = useState('');
  const [leadFilter, setLeadFilter] = useState<LeadFilter>('all');
  const [visibleCounts, setVisibleCounts] = useState(initialVisibleCounts);
  const [draggingId, setDraggingId] = useState<string>();
  const [overStage, setOverStage] = useState<PipelineStage>();
  const pointerContactId = useRef<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const filteredContacts = useMemo(() => {
    const query = normalized(search);
    return contacts.filter((contact) => {
      if (leadFilter !== 'all' && contact.leadType !== leadFilter) return false;
      if (!query) return true;
      return [displayName(contact), contact.email, contact.phone, contact.intent, contact.source]
        .filter(Boolean).some((value) => normalized(String(value)).includes(query));
    });
  }, [contacts, leadFilter, search]);

  const columns = useMemo(() => STAGES.map((stage) => {
    const matches = filteredContacts.filter((contact) => contact.pipelineStage === stage);
    return {
      stage,
      total: contacts.filter((contact) => contact.pipelineStage === stage).length,
      matches,
      visible: matches.slice(0, visibleCounts[stage]),
    };
  }), [contacts, filteredContacts, visibleCounts]);

  const move = useCallback((contactId: string, toStage: PipelineStage) => {
    const current = contacts.find((contact) => contact.id === contactId);
    if (!current || current.pipelineStage === toStage || pending) return;
    const before = contacts;
    const name = displayName(current);
    setContacts((items) => items.map((item) => item.id === contactId ? { ...item, pipelineStage: toStage } : item));
    setMessage(`Moving ${name} to ${PIPELINE_LABEL[toStage]}…`);
    startTransition(async () => {
      const response = await movePipelineStageAction({
        contactId,
        fromStage: current.pipelineStage,
        toStage,
        expectedUpdatedAt: current.updatedAt ?? current.createdAt,
        idempotencyKey: `pipeline-${contactId}-${current.pipelineStage}-${toStage}-${Date.now()}`,
      });
      if (!response.ok) {
        setContacts(before);
        setMessage(`We couldn't move ${name}. Nothing changed — please try again.`);
        return;
      }
      setContacts((items) => items.map((item) => item.id === contactId ? {
        ...item, pipelineStage: toStage, updatedAt: response.updatedAt ?? item.updatedAt,
      } : item));
      setMessage(`${name} moved to ${PIPELINE_LABEL[toStage]}.`);
    });
  }, [contacts, pending]);

  const stageFromPoint = useCallback((clientX: number, clientY: number): PipelineStage | undefined => {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-pipeline-stage]');
    const stage = target?.dataset.pipelineStage;
    return STAGES.includes(stage as PipelineStage) ? stage as PipelineStage : undefined;
  }, []);

  useEffect(() => {
    if (!draggingId) return;
    const updateDestination = (event: globalThis.PointerEvent | MouseEvent) => setOverStage(stageFromPoint(event.clientX, event.clientY));
    const finish = (event: globalThis.PointerEvent | MouseEvent) => {
      const contactId = pointerContactId.current;
      if (!contactId) return;
      const destination = stageFromPoint(event.clientX, event.clientY);
      pointerContactId.current = undefined;
      setDraggingId(undefined);
      setOverStage(undefined);
      if (destination) move(contactId, destination);
      else setMessage('Card stayed in place. Drop it inside a pipeline stage.');
    };
    const cancel = () => {
      if (!pointerContactId.current) return;
      pointerContactId.current = undefined;
      setDraggingId(undefined);
      setOverStage(undefined);
      setMessage('Card stayed in place.');
    };
    window.addEventListener('pointermove', updateDestination);
    window.addEventListener('mousemove', updateDestination);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('mouseup', finish, true);
    window.addEventListener('pointercancel', cancel, true);
    return () => {
      window.removeEventListener('pointermove', updateDestination);
      window.removeEventListener('mousemove', updateDestination);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('mouseup', finish, true);
      window.removeEventListener('pointercancel', cancel, true);
    };
  }, [draggingId, move, stageFromPoint]);

  const startPointerDrag = (event: PointerEvent<HTMLButtonElement>, contactId: string) => {
    if (event.button !== 0 || pending) return;
    pointerContactId.current = contactId;
    setDraggingId(contactId);
    const contact = contacts.find((item) => item.id === contactId);
    if (contact) setMessage(`Dragging ${displayName(contact)} — drop on another stage.`);
    event.preventDefault();
  };
  const filters: readonly { value: LeadFilter; label: string }[] = [
    { value: 'all', label: 'All leads' },
    ...(['hot', 'warm', 'nurture'] as const).map((value) => ({ value, label: LEAD_TYPE_LABEL[value] })),
  ];

  return (
    <section className="pipeline-workspace" aria-labelledby="pipeline-board-title">
      <div className="pipeline-toolbar">
        <div>
          <p className="eyebrow">Relationship flow</p>
          <h2 id="pipeline-board-title">Deal desk</h2>
          <p>{filteredContacts.length === contacts.length ? `${contacts.length} relationships across seven stages` : `${filteredContacts.length} of ${contacts.length} relationships shown`}</p>
        </div>
        <label className="pipeline-search">
          <Search className="size-4" aria-hidden /><span className="sr-only">Search pipeline</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email or phone" />
        </label>
      </div>

      <div className="pipeline-filter-row" aria-label="Filter pipeline by lead temperature">
        {filters.map((filter) => (
          <button key={filter.value} type="button" aria-pressed={leadFilter === filter.value} onClick={() => setLeadFilter(filter.value)}>{filter.label}</button>
        ))}
        <p aria-live="polite">{message}</p>
      </div>

      <ol className="pipeline-stage-rail" aria-label="Pipeline stage totals">
        {columns.map((column, index) => (
          <li key={column.stage} data-stage={column.stage}>
            <span>{column.total}</span><strong>{PIPELINE_LABEL[column.stage]}</strong>
            {index < columns.length - 1 ? <ArrowRight className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="pipeline-board-scroll" tabIndex={0} aria-label="Scrollable pipeline board">
        <div className="pipeline-board-grid">
          {columns.map((column) => (
            <section
              key={column.stage}
              aria-labelledby={`stage-${column.stage}`}
              data-pipeline-stage={column.stage}
              data-drag-over={overStage === column.stage || undefined}
              className="pipeline-column"
              onDragEnter={() => setOverStage(column.stage)}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverStage(undefined); }}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              onDrop={(event) => {
                event.preventDefault();
                const contactId = event.dataTransfer.getData('text/contact-id');
                setDraggingId(undefined); setOverStage(undefined); move(contactId, column.stage);
              }}
            >
              <header data-stage={column.stage}>
                <span className="pipeline-column-index">{String(STAGES.indexOf(column.stage) + 1).padStart(2, '0')}</span>
                <div><h3 id={`stage-${column.stage}`}>{PIPELINE_LABEL[column.stage]}</h3><p>{STAGE_GUIDANCE[column.stage]}</p></div>
                <span className="pipeline-column-count" aria-label={`${column.total} total contacts`}>{column.total}</span>
              </header>

              <div className="pipeline-column-list">
                {column.visible.length ? (
                  <ul>
                    {column.visible.map((contact) => (
                      <li key={contact.id}>
                        <article className="pipeline-contact-card" data-dragging={draggingId === contact.id || undefined}>
                          <div className="pipeline-card-heading">
                            <button
                              type="button" disabled={pending} className="pipeline-drag-handle"
                              aria-label={`Drag ${displayName(contact)} to another stage`} title="Drag to another stage"
                              onPointerDown={(event) => startPointerDrag(event, contact.id)}
                            ><GripVertical className="size-4" aria-hidden /></button>
                            <div className="min-w-0 flex-1">
                              <Link href={`/contacts/${encodeURIComponent(contact.id)}`} className="pipeline-card-name">{displayName(contact)}</Link>
                              <p>{contact.intent === 'unknown' ? 'Intent not set' : contact.intent.replace('-', ' ')}</p>
                            </div>
                            <LeadBadge leadType={contact.leadType} />
                          </div>
                          <NextStep contact={contact} evidence={evidence.byContactId[contact.id]} availability={evidence.availability} />
                          <EvidenceDisclosure evidence={evidence.byContactId[contact.id]} availability={evidence.availability} />
                          <label className="pipeline-move-control" htmlFor={`move-${contact.id}`}>
                            <span>Move to</span>
                            <select id={`move-${contact.id}`} value={contact.pipelineStage} disabled={pending} onChange={(event) => move(contact.id, event.target.value as PipelineStage)}>
                              {STAGES.map((stage) => <option key={stage} value={stage}>{PIPELINE_LABEL[stage]}</option>)}
                            </select>
                          </label>
                        </article>
                      </li>
                    ))}
                  </ul>
                ) : <div className="pipeline-column-empty"><Check className="size-4" aria-hidden /><p>No matching contacts here.</p></div>}

                {column.visible.length < column.matches.length ? (
                  <button type="button" className="pipeline-show-more" onClick={() => setVisibleCounts((counts) => ({ ...counts, [column.stage]: counts[column.stage] + CARD_BATCH_SIZE }))}>
                    Show {Math.min(CARD_BATCH_SIZE, column.matches.length - column.visible.length)} more
                    <span>{column.matches.length - column.visible.length} remaining</span>
                  </button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
