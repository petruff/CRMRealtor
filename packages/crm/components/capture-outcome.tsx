'use client';

import Link from 'next/link';
import { VoiceDictation, appendDictation } from '@/components/voice-dictation';
import { useRef, useState, useTransition } from 'react';
import { CheckCircle2, ChevronLeft, FileText, NotebookPen, Plus, Sparkles } from 'lucide-react';
import { CAPTURE_SOURCE_MAX, type CaptureOutcomeProposal, type CaptureOperationAfter, type CaptureOperationType } from '@/lib/domain/capture-outcome';
import { CaptureOperationFields, captureOperationLabels, readCaptureOperationForm, type CaptureOptions } from './capture-operation-fields';
import { PIPELINE_LABEL, type PipelineStage } from '@/lib/domain/contact';

export type CaptureUiCommand = {
  command: 'analyze' | 'edit' | 'select' | 'confirm' | 'reject' | 'defer' | 'options' | 'add';
  contactId: string; proposalId?: string; version?: number; contentHash?: string;
  sourceText?: string; idempotencyKey?: string; manualOnly?: boolean;
  tasks?: { title: string; dueAt: string }[]; operationId?: string;
  patch?: CaptureOperationAfter; operationIds?: string[]; until?: string;
  operationType?: CaptureOperationType;
};
export type CaptureUiResult = { proposal?: CaptureOutcomeProposal; options?: CaptureOptions; error?: string };

export function CaptureOutcome({ contactId, contactName, isLive, isOwner = false, initialProposal, action }: {
  contactId: string; contactName: string; isLive: boolean; initialProposal?: CaptureOutcomeProposal;
  isOwner?: boolean;
  action: (input: CaptureUiCommand) => Promise<CaptureUiResult>;
}) {
  const [proposal, setProposal] = useState(initialProposal);
  const [source, setSource] = useState('');
  const [task, setTask] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [options, setOptions] = useState<CaptureOptions>();
  const [adding, setAdding] = useState(false);
  const [operationType, setOperationType] = useState<CaptureOperationType>('pipeline-move');
  const [pending, startTransition] = useTransition();
  const key = useRef<string | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  function run(input: CaptureUiCommand) {
    setError('');
    startTransition(async () => {
      try {
        const result = await action(input);
        if (result.options) setOptions(result.options);
        if (result.error) { setError(result.error); queueMicrotask(() => feedback.current?.focus()); }
        if (result.proposal) {
          setProposal(result.proposal); setConfirming(false);
          if (input.command === 'add') setAdding(false);
          window.history.replaceState(null, '', `${window.location.pathname}?proposalId=${encodeURIComponent(result.proposal.id)}`);
        }
      } catch { setError('The request could not finish. Your review is preserved. Retry when your connection is restored.'); }
    });
  }
  function analyze(manualOnly: boolean) {
    if (!source.trim()) { setError('Enter a short recap before preparing your review.'); return; }
    if (task && (!title.trim() || !due || !Number.isFinite(new Date(due).valueOf()))) { setError('Add a task title and an exact due date and time.'); return; }
    key.current ??= crypto.randomUUID();
    run({ command: 'analyze', contactId, sourceText: source, idempotencyKey: key.current, manualOnly,
      tasks: task ? [{ title, dueAt: new Date(due).toISOString() }] : [] });
  }
  const editable = proposal && ['pending', 'selected'].includes(proposal.status)
    && !proposal.operations.some((operation) => operation.childProposalId);
  const resumable = proposal && ['deferred', 'stale'].includes(proposal.status)
    && !proposal.operations.some((operation) => operation.childProposalId);
  const recoverable = proposal && ['failed', 'partially-completed', 'executing'].includes(proposal.status);
  const selected = proposal?.operations.filter((operation) => operation.selected) ?? [];
  const needsOwner = !isOwner && selected.some(operation => operation.requiredAuthority === 'owner' && operation.state !== 'completed');
  const complete = proposal?.status === 'completed';
  const awaitingProvider = proposal?.status === 'awaiting-provider';
  const commandBase = { contactId, proposalId: proposal?.id, version: proposal?.version };
  return <div className="conversation-workspace capture-workspace">
    <header className="conversation-page-heading"><div><p className="conversation-kicker"><NotebookPen className="size-4" aria-hidden />Capture outcome</p><h1>{complete ? 'The next steps are in place.' : proposal ? 'Review the next steps.' : 'A conversation worth remembering.'}</h1><p>{contactName}{!isLive ? ' · Sample workspace' : ''}</p></div><Link className="sk-secondary-button" href={`/contacts/${encodeURIComponent(contactId)}/brief`}><ChevronLeft className="size-4" aria-hidden />Meeting brief</Link></header>
    <ol className="capture-progress" aria-label="Capture progress">{['Capture', 'Review', 'Confirm'].map((label, index) => <li key={label} aria-current={(!proposal ? index === 0 : confirming || complete ? index === 2 : index === 1) ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    {error && <p ref={feedback} tabIndex={-1} className="capture-feedback is-error" role="alert">{error}</p>}
    {pending && <p className="capture-feedback" role="status">{proposal ? 'Saving your review…' : 'Preparing your review…'}</p>}
    {!proposal ? <div className="capture-input-grid">
      <form onSubmit={(event) => { event.preventDefault(); analyze(false); }} className="capture-editor">
        <label htmlFor="conversation-recap">What happened?</label><p id="recap-help">Include what your client wants, what changed, and who agreed to do what.</p>
        <textarea id="conversation-recap" value={source} onChange={(event) => { setSource(event.target.value); key.current = null; }} maxLength={CAPTURE_SOURCE_MAX} rows={10} required aria-describedby="recap-help recap-count" placeholder="We discussed their timeline and the homes they liked. I agreed to follow up…" />
        <VoiceDictation label="Dictate the recap" onAppend={(spoken) => { setSource((current) => appendDictation(current, spoken).slice(0, CAPTURE_SOURCE_MAX)); key.current = null; }} />
        <small id="recap-count">{source.length.toLocaleString()} / {CAPTURE_SOURCE_MAX.toLocaleString()} characters</small>
        <button type="button" className="conversation-text-link" onClick={() => { setTask(!task); key.current = null; }} aria-expanded={task}><Plus className="size-4" aria-hidden />{task ? 'Remove task' : 'Add a task yourself'}</button>
        {task && <div className="capture-manual-task"><label>Task title<input value={title} onChange={(event) => { setTitle(event.target.value); key.current = null; }} maxLength={160} required /></label><label>Due date and time<input type="datetime-local" value={due} onChange={(event) => { setDue(event.target.value); key.current = null; }} required /></label><small>Uses your device timezone. The exact time will appear in your review.</small></div>}
        <div className="capture-input-actions"><button type="submit" className="sk-button-primary" disabled={pending}><Sparkles className="size-4" aria-hidden />Review outcome</button><button type="button" className="sk-secondary-button" disabled={pending} onClick={() => analyze(true)}>Prepare note without AI</button></div>
        <p className="capture-privacy">Your recap is kept in this workspace’s review history. Nothing is added to the contact until you confirm.</p>
      </form>
      <aside className="capture-guide"><span className="conversation-icon"><NotebookPen className="size-6" aria-hidden /></span><h2>Close the loop while it’s fresh.</h2><p>One recap becomes a review you can edit and save.</p><ul><li><CheckCircle2 className="size-4" aria-hidden /><span>Keep the original conversation context.</span></li><li><CheckCircle2 className="size-4" aria-hidden /><span>Review suggestions against the exact words you entered.</span></li><li><CheckCircle2 className="size-4" aria-hidden /><span>Choose which notes and tasks belong in the CRM.</span></li></ul><small>If AI is unavailable, your note and manually added task are still ready to review.</small></aside>
    </div> : <>
      {proposal.extractionState !== 'available' && <p className="capture-feedback" role="status">{proposal.extractionState === 'manual' ? 'Prepared without AI.' : 'AI extraction is unavailable for this review.'}{!complete && ' Your recap and any tasks you entered can still be saved.'}</p>}
      {complete && <p className="capture-feedback is-success" role="status"><CheckCircle2 className="size-5" aria-hidden />Selected items saved. Review their receipts below.</p>}
      {awaitingProvider && <p className="capture-feedback" role="status">Your CRM changes have receipts. Provider items still need approval or reconciliation; no email was sent or calendar event confirmed here. <Link href="/omnix">Open Omnix approvals</Link></p>}
      {['failed', 'partially-completed', 'stale', 'expired', 'deferred', 'rejected'].includes(proposal.status) && <p className="capture-feedback" role="status">Review status: {proposal.status.replaceAll('-', ' ')}. Completed items keep their receipts.</p>}
      <div className="capture-review-grid"><aside className="capture-source"><h2>The conversation</h2><blockquote>{proposal.sourceText}</blockquote>{proposal.extractionState === 'available' && <section><h2>AI summary to review</h2><p className="capture-operation-copy mt-3">{proposal.summary}</p><small>Check this interpretation against your original recap.</small></section>}{proposal.facts.length > 0 && <section><h2>Details to verify</h2><ul>{proposal.facts.map((fact, index) => <li key={index}><strong>{fact.category}</strong><p>{fact.text}</p><small>{fact.uncertain ? 'Needs clarification' : 'Extracted for review'} · {fact.confidence} confidence</small><blockquote>{fact.evidence.quote}</blockquote></li>)}</ul><p className="capture-privacy">These details do not change contact preferences, consent, or lifecycle automatically.</p></section>}{proposal.unknowns.length > 0 && <section><h2>Still to clarify</h2><ul>{proposal.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}</aside>
        <section className="capture-operations" aria-label={confirming ? 'Selected changes to confirm' : 'Proposed changes'}>
          <div className="conversation-fact-heading"><h2>{confirming ? 'Confirm these changes' : complete ? 'Saved changes' : 'Choose what to save'}</h2><span>Version {proposal.version}</span></div>
          {(confirming ? selected : proposal.operations).map((operation) => <article className={`capture-operation ${operation.selected ? 'is-selected' : ''}`} key={`${operation.id}:${proposal.version}`}>
            <div className="capture-operation-heading"><label><input type="checkbox" checked={operation.selected} disabled={pending || !editable || confirming || operation.state === 'completed'} onChange={(event) => run({ ...commandBase, command: 'select', operationIds: proposal.operations.filter((item) => item.id === operation.id ? event.target.checked : item.selected).map((item) => item.id) })} /><span>{captureOperationLabels[operation.type]}</span></label><span>{operation.state === 'completed' ? 'Saved' : operation.state === 'awaiting-provider' ? 'Awaiting provider' : operation.confidence === 'manual' ? 'Your entry' : `${operation.confidence} confidence`}</span></div>
            <p className="capture-change-label">{operation.type === 'note-append' ? 'New note' : operation.type === 'task-create' ? 'New task' : 'Proposed change'} <span>{operation.before ? 'Current values shown below' : 'Nothing removed'}</span></p>
            <p className="capture-operation-copy">{operation.after.text ?? operation.after.title}</p>
            {operation.after.toStage && <p className="capture-operation-copy">New stage: {PIPELINE_LABEL[operation.after.toStage as PipelineStage] ?? operation.after.toStage.replaceAll('-', ' ')}</p>}
            {operation.after.cadenceDays && <p className="capture-operation-copy">Follow up every {operation.after.cadenceDays} days, up to {operation.after.maximumSteps} times.</p>}
            {operation.after.action && <p className="capture-operation-copy">{operation.after.action} follow-up plan{operation.after.stopReason ? `: ${operation.after.stopReason}` : ''}</p>}
            {operation.after.subject && <p className="capture-operation-copy"><strong>{operation.after.subject}</strong></p>}
            {operation.after.body && <p className="capture-operation-copy">{operation.after.body}</p>}
            {operation.after.startAt && <p className="capture-due">Starts {new Date(operation.after.startAt).toLocaleString()}{operation.after.endAt ? ` · ends ${new Date(operation.after.endAt).toLocaleString()}` : ''}{operation.after.timeZone ? ` · event zone ${operation.after.timeZone}` : ''}</p>}
            {operation.after.snoozedUntil && <p className="capture-due">Snoozed until {new Date(operation.after.snoozedUntil).toLocaleString()}</p>}
            {operation.after.dueAt && <p className="capture-due">Due {new Date(operation.after.dueAt).toLocaleString()}</p>}
            {operation.evidence && <details className="capture-source-quote"><summary>Show source phrase</summary><blockquote>{operation.evidence.quote}</blockquote></details>}
            {operation.flags.length > 0 && <ul className="capture-flags">{operation.flags.map((flag) => <li key={flag}>{flag.replaceAll('-', ' ')}</li>)}</ul>}
            {operation.receipt && <p className="capture-receipt"><CheckCircle2 className="size-4" aria-hidden />{operation.state === 'awaiting-provider' ? 'Preparation receipt' : 'Saved receipt'} <code>{operation.receipt}</code></p>}
            {operation.error && <p role="alert" className="capture-feedback is-error">{operation.error}</p>}
            {operation.before && <dl className="capture-before-values">{Object.entries(operation.before).filter(([, value]) => value !== null).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd>{String(value)}</dd></div>)}</dl>}
            {operation.consequence && <p className="capture-feedback">{operation.consequence}</p>}
            {operation.requiredAuthority === 'owner' && <p className="capture-privacy">A workspace owner must confirm this item.</p>}
            {editable && !confirming && operation.state !== 'completed' && <details className="capture-edit" onToggle={(event) => { if (event.currentTarget.open && !options && !pending) run({ command: 'options', contactId }); }}><summary>Edit {operation.type === 'note-append' ? 'note' : operation.type === 'task-create' ? 'task' : 'change'}</summary><form onSubmit={(event) => { event.preventDefault(); try { run({ ...commandBase, command: 'edit', operationId: operation.id, patch: readCaptureOperationForm(operation.type, new FormData(event.currentTarget)) }); } catch { setError('Choose valid dates and complete the required fields.'); } }}><CaptureOperationFields type={operation.type} after={operation.after} options={options} /><button type="submit" disabled={pending} className="sk-secondary-button">Save edit</button></form></details>}
          </article>)}
          {confirming && <p className="capture-privacy">Only the {selected.length} selected {selected.length === 1 ? 'item' : 'items'} in this version will be saved. No message will be sent.</p>}
          {confirming && needsOwner && <p className="capture-feedback">A workspace owner must confirm the selected provider items. Go back and deselect those items to save the other changes.</p>}
        </section></div>
      {editable && <div className="capture-review-controls"><span><strong>{selected.length} selected</strong><small>{confirming ? 'Ready for your confirmation' : 'Review each change before saving'}</small></span><div>{confirming ? <><button className="sk-secondary-button" onClick={() => setConfirming(false)} disabled={pending}>Back to review</button><button className="sk-button-primary" disabled={pending || !selected.length || needsOwner} onClick={() => run({ ...commandBase, command: 'confirm', contentHash: proposal.contentHash })}>Confirm and save</button></> : <><button className="sk-secondary-button" disabled={pending} onClick={() => run({ ...commandBase, command: 'reject' })}>Reject review</button><button className="sk-button-primary" disabled={pending || !selected.length} onClick={() => setConfirming(true)}>Review selected changes</button></>}</div></div>}
      {recoverable && <div className="capture-review-controls"><span><strong>Recover this review</strong><small>Saved items keep their original receipts.</small></span><button disabled={pending} className="sk-button-primary" onClick={() => run({ ...commandBase, command: 'confirm', contentHash: proposal.contentHash })}>Retry unfinished items</button></div>}
      {editable && !confirming && <button className="conversation-text-link" disabled={pending} onClick={() => run({ ...commandBase, command: 'defer', until: new Date(Date.now() + 86400000).toISOString() })}>Set aside until tomorrow</button>}
      {editable && !confirming && <section className="capture-add-change"><button type="button" className="sk-secondary-button" disabled={pending} aria-expanded={adding} onClick={() => { setAdding(!adding); if (!options) run({ command: 'options', contactId }); }}><Plus className="size-4" aria-hidden />{adding ? 'Close additional change' : 'Add another change'}</button>{adding && <form onSubmit={event => { event.preventDefault(); try { run({ ...commandBase, command: 'add', operationType, patch: readCaptureOperationForm(operationType, new FormData(event.currentTarget)) }); } catch { setError('Complete the required fields and choose valid dates.'); } }}><h2 className="font-semibold">Add a change to review</h2><p>New items are unselected until you choose them in the review.</p><label>Type of change<select value={operationType} onChange={event => setOperationType(event.target.value as CaptureOperationType)}>{Object.entries(captureOperationLabels).filter(([type]) => type !== 'note-append').map(([type, label]) => <option key={type} value={type} disabled={(type.startsWith('google-') && !options?.providerPreparationAvailable) || (type === 'nurture-transition' && !options?.nurturePlans.length)}>{label}</option>)}</select></label>{options ? <CaptureOperationFields key={operationType} type={operationType} options={options} /> : <p role="status">Loading current contact options…</p>}<button type="submit" className="sk-button-primary" disabled={pending || !options}>Add to review</button>{!options?.providerPreparationAvailable && <p className="capture-privacy">Google preparation becomes available in a connected live workspace.</p>}</form>}</section>}
      {resumable && <button className="sk-button-primary" disabled={pending} onClick={() => run({ ...commandBase, command: 'select', operationIds: selected.map((operation) => operation.id) })}>Refresh and resume review</button>}
      <div className="capture-finish"><Link className="conversation-text-link" href={`/contacts/${encodeURIComponent(contactId)}`}><FileText className="size-4" aria-hidden />Open contact record</Link><Link className="conversation-text-link" href={`/contacts/${encodeURIComponent(contactId)}/brief`}>Refresh meeting context</Link><a className="conversation-text-link" href={`/contacts/${encodeURIComponent(contactId)}/outcome/export?proposalId=${encodeURIComponent(proposal.id)}&includeSource=true`}>Export this review with recap</a>{!editable && <Link className="sk-secondary-button" href={`/contacts/${encodeURIComponent(contactId)}/outcome`}>Capture another conversation</Link>}</div>
    </>}
  </div>;
}
