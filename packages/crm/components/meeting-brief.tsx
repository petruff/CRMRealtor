import Link from 'next/link';
import { BookOpenCheck, Check, ChevronDown, Clock3, FileText, NotebookPen } from 'lucide-react';
import type { MeetingBriefEnvelope, MeetingBriefItem, MeetingBriefSection } from '@/lib/domain/meeting-brief';
import { MeetingBriefHighlights, type BriefHighlightAction } from './meeting-brief-highlights';
import { BriefSourceLink } from './brief-source-link';

const sectionLabels: Record<string, string> = {
  confirmed: 'From your records', estimated: 'Estimated', stale: 'Needs refresh',
  contradictory: 'Needs confirmation', unknown: 'Not recorded', unavailable: 'Unavailable', omitted: 'Not included',
};

export function MeetingBrief({ brief, refreshAction, highlightAction }: {
  brief: MeetingBriefEnvelope; refreshAction: (form: FormData) => void | Promise<void>;
  highlightAction?: BriefHighlightAction;
}) {
  const { snapshot } = brief;
  const contactHref = `/contacts/${encodeURIComponent(snapshot.subjectContactId)}`;
  return <div className="conversation-workspace meeting-workspace">
    <header className="conversation-page-heading">
      <div><p className="conversation-kicker"><BookOpenCheck className="size-4" aria-hidden />Meeting brief</p><h1>{snapshot.contactName}</h1><p>The context for your next conversation. <Link href={contactHref}>Open contact</Link></p></div>
      <Link href={`${contactHref}/outcome`} className="sk-button-primary"><NotebookPen className="size-4" aria-hidden />Capture outcome</Link>
    </header>
    <div className={`conversation-freshness ${snapshot.status === 'stale' ? 'is-stale' : ''}`} role="status">
      <Clock3 className="size-4" aria-hidden /><span>{snapshot.status === 'stale' ? 'Your records changed or this brief expired. Refresh before relying on it.' : 'Prepared from saved CRM evidence'}<small>As of {new Date(snapshot.asOf).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET{brief.mode === 'sample' ? ' · Sample workspace' : ''}</small></span>
      <form action={refreshAction}><input type="hidden" name="snapshotId" value={snapshot.id} /><input type="hidden" name="version" value={snapshot.version} /><button className="sk-secondary-button" type="submit">Refresh brief</button></form>
    </div>
    <div className="conversation-brief-grid">
      <div className="conversation-brief-main">
        <section className="conversation-objective" aria-labelledby="objective-title"><h2 id="objective-title">Your conversation objective</h2><p>{snapshot.objective.text}</p><small>Suggested from your records. Confirm what has changed with your client.</small></section>
        {snapshot.sections.map((section, index) => <BriefSection key={section.id} section={section} prominent={index < 2} />)}
      </div>
      <aside className="conversation-preparation" aria-label="Conversation guide">
        {highlightAction && <MeetingBriefHighlights key={snapshot.id} contactId={snapshot.subjectContactId} snapshotId={snapshot.id} stale={snapshot.status === 'stale'} action={highlightAction} />}
        <section><h2>Keep these in mind</h2><ol className="conversation-talking-points">{snapshot.talkingPoints.map((point, index) => <li key={index}><Check className="size-4" aria-hidden /><p>{point.text}</p></li>)}</ol><small>Conversation suggestions, ready for your judgment.</small></section>
        <section className="conversation-next-step"><h2>Leave with a next step</h2><p>{snapshot.nextAction.text}</p><Link href={snapshot.nextAction.href} className="conversation-text-link">Review next action</Link><Link href={`${contactHref}/outcome`} className="sk-button-primary"><NotebookPen className="size-4" aria-hidden />Capture outcome</Link></section>
        <p className="conversation-model-note">This brief works without AI generation. It reflects your records; missing information stays visible.</p>
      </aside>
    </div>
    <details className="conversation-evidence"><summary><FileText className="size-4" aria-hidden />Evidence behind this brief <span>{snapshot.citations.length} sources</span></summary><ul>{snapshot.citations.map((citation) => <li id={`evidence-${citation.id}`} key={citation.id}><div><strong>{citation.label}</strong><small>{citation.sourceTime ? new Date(citation.sourceTime).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' }) : 'Source date not recorded'}</small></div><Link href={citation.href}>Open record</Link></li>)}</ul></details>
  </div>;
}

function FactItems({ items }: { items: readonly MeetingBriefItem[] }) {
  return <ul>{items.map((item) => <li key={item.id}><span className="conversation-fact-marker" aria-hidden /><div><p>{item.text}</p>{item.citationIds.length > 0 && <div className="conversation-citations">{item.citationIds.map((id) => <BriefSourceLink key={id} citationId={id}><FileText className="size-3" aria-hidden />Source</BriefSourceLink>)}</div>}</div></li>)}</ul>;
}

function BriefSection({ section, prominent }: { section: MeetingBriefSection; prominent: boolean }) {
  const heading = <><h2 id={`section-${section.id}`}>{section.title}</h2><span>{sectionLabels[section.state] ?? section.state}</span></>;
  if (!prominent) return <details className="conversation-fact-section conversation-section-disclosure" open={section.state === 'contradictory' || undefined}><summary className="conversation-fact-heading">{heading}<ChevronDown className="size-4" aria-hidden /></summary><FactItems items={section.items} /></details>;
  const visible = section.items.slice(0, section.id === 'changes' ? 1 : 2);
  const remaining = section.items.slice(visible.length);
  return <section className="conversation-fact-section" aria-labelledby={`section-${section.id}`}><div className="conversation-fact-heading">{heading}</div><FactItems items={visible} />{remaining.length > 0 && <details className="conversation-more-facts"><summary>{remaining.length} more {section.id === 'changes' ? 'updates' : 'commitments'}<ChevronDown className="size-3" aria-hidden /></summary><FactItems items={remaining} /></details>}</section>;
}
