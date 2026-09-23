import { createHash, randomUUID } from 'node:crypto';
import type { ContactRepository } from '../data/repository.ts';
import type { MeetingBriefRepository, MeetingBriefSources } from '../data/meeting-brief-repository.ts';
import { displayName, INTENT_LABEL, PIPELINE_LABEL, RELATIONSHIP_LABEL, SOURCE_LABEL, type Contact } from '../domain/contact.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import { MEETING_BRIEF_SCHEMA_VERSION, MEETING_BRIEF_RULE_VERSION, MEETING_BRIEF_EXPIRY_MS, MeetingBriefError, meetingBriefIdentifier, type MeetingBriefEnvelope, type MeetingBriefInput, type MeetingBriefSnapshot, type MeetingBriefSection, type MeetingBriefItem, type MeetingBriefCitation, type MeetingBriefSourceType } from '../domain/meeting-brief.ts';
import { OMNIX_PROMPT_GUARD_VERSION, scanOmnixPromptContent } from './omnix-prompt-guard.ts';

export interface MeetingBriefContext {
  readonly repository: ContactRepository;
  readonly workspaceScope: WorkspaceScope;
  readonly isLive: boolean;
  readonly meetingBriefRepository: MeetingBriefRepository;
}
type Clock = () => Date;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function projectContact(c: Contact) {
  return { id: c.id, name: displayName(c), relationship: c.relationship, intent: c.intent, source: c.source, pipelineStage: c.pipelineStage,
    buyer: c.buyer, seller: c.seller, lastContactedAt: c.lastContactedAt, nextTouchAt: c.nextTouchAt, updatedAt: c.updatedAt,
    createdAt: c.createdAt, birthdate: c.birthdate, homePurchaseDate: c.homePurchaseDate };
}
function sourceHashes(contact: Contact, sources: MeetingBriefSources) {
  return { contact: hash(projectContact(contact)), ...Object.fromEntries([...sources.records].sort((a, b) => `${a.sourceType}:${a.id}`.localeCompare(`${b.sourceType}:${b.id}`)).map(r=>[`${r.sourceType}:${r.id}`,hash(r)])), availability: hash([sources.unavailable, sources.bounded]) };
}
function safeText(value: string): string | undefined {
  return scanOmnixPromptContent(value).safe ? value.replace(/\s+/g, ' ').trim().slice(0, 400) : undefined;
}
function instant(clock: Clock): Date {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new MeetingBriefError('invalid-input', 'Invalid brief time.');
  return value;
}
async function load(context: MeetingBriefContext, input: MeetingBriefInput) {
  const scope = validateWorkspaceScope(context.workspaceScope);
  if (scope.mode !== (context.isLive ? 'live' : 'sample')) throw new MeetingBriefError('invalid-input', 'Brief workspace mode does not match.');
  meetingBriefIdentifier(input.contactId);
  if (input.transactionId) meetingBriefIdentifier(input.transactionId);
  if (!['today', 'contact', 'transaction', 'cli'].includes(input.trigger)) throw new MeetingBriefError('invalid-input', 'Invalid brief entry point.');
  const contact = await context.repository.get(input.contactId);
  if (!contact || contact.archivedAt) throw new MeetingBriefError('not-found', 'Contact is unavailable.');
  const sources = await context.meetingBriefRepository.loadSources(scope, contact.id, input.transactionId);
  const records = sources.records.filter((r) => r.workspaceId === scope.workspaceId && r.contactId === contact.id);
  if (input.transactionId && !records.some((r) => r.sourceType === 'transaction' && r.id === input.transactionId)) throw new MeetingBriefError('not-found', 'Transaction is unavailable.');
  return { scope, contact, sources: { ...sources, records } };
}

/** Model-free read command. Authority must come from getRepository or authenticated CLI context. */
export async function buildMeetingBrief(context: MeetingBriefContext, input: MeetingBriefInput, clock: Clock = () => new Date(), prior?: MeetingBriefSnapshot): Promise<MeetingBriefEnvelope> {
  const started = Date.now();
  const now = instant(clock); const asOf = now.toISOString();
  const { scope, contact, sources } = await load(context, input);
  const contactHref = `/contacts/${encodeURIComponent(contact.id)}`;
  const citations: MeetingBriefCitation[] = [];
  const sections: MeetingBriefSection[] = [];
  let omitted = false;
  function fact(type: MeetingBriefSourceType, recordId: string, label: string, value: string, time?: string | null, href = contactHref): MeetingBriefItem {
    const text = safeText(value); const id = `fact-${citations.length + 1}`;
    const sourceTime = time && Number.isFinite(Date.parse(time)) ? time : null;
    citations.push({ id, sourceType: type, recordId, label, sourceTime, asOf, href });
    if (!text) omitted = true;
    return { id, text: text ?? 'Recorded text omitted by the content guard. Open the CRM source to review.', state: !text ? 'omitted' : sourceTime && now.getTime() - Date.parse(sourceTime) > 90 * 86400000 ? 'stale' : 'confirmed', citationIds: [id] };
  }
  function section(id: string, title: string, items: MeetingBriefItem[], empty: string, unavailable = false) {
    const state = items.some(i=>i.state==='contradictory') ? 'contradictory' : items.some(i=>i.state==='omitted') ? 'omitted' : items.some(i=>i.state==='stale') ? 'stale' : 'confirmed';
    sections.push({ id, title, state: items.length ? state : unavailable ? 'unavailable' : 'unknown',
      items: items.length ? items : [{ id: `${id}-empty`, text: empty, state: unavailable ? 'unavailable' : 'unknown', citationIds: [] }] });
  }
  const contactTime = contact.updatedAt ?? contact.createdAt;
  section('relationship', 'Relationship at a glance', [fact('contact', contact.id, 'Relationship and acquisition source', `${RELATIONSHIP_LABEL[contact.relationship]} · ${SOURCE_LABEL[contact.source]}`, contactTime), fact('contact', contact.id, 'Intent and pipeline', `${INTENT_LABEL[contact.intent]} · ${PIPELINE_LABEL[contact.pipelineStage]}`, contactTime), ...(contact.lastContactedAt ? [fact('contact', contact.id, 'Last recorded conversation', `Last recorded conversation: ${contact.lastContactedAt}`, contact.lastContactedAt)] : [])], 'Relationship context has not been recorded.');
  const buyer = contact.buyer; const seller = contact.seller; const preferences: MeetingBriefItem[] = [];
  const cf = (label: string, value: string) => preferences.push(fact('contact', contact.id, label, value, contactTime));
  if (buyer?.areas?.length) cf('Recorded buyer areas', `Areas: ${buyer.areas.join(', ')}`);
  if (buyer?.timeline) cf('Recorded buyer timeline', `Buyer timeline: ${buyer.timeline}`);
  if (buyer?.desiredPropertyType) cf('Recorded property preference', `Property preference: ${buyer.desiredPropertyType}`);
  if (buyer?.beds !== undefined || buyer?.baths !== undefined) cf('Recorded bedroom and bathroom preferences', `Bedrooms: ${buyer.beds ?? 'not recorded'} · bathrooms: ${buyer.baths ?? 'not recorded'}`);
  if (buyer?.priceMin !== undefined || buyer?.priceMax !== undefined) cf('Recorded buyer price preference', `Recorded price preference: ${buyer.priceMin ?? 'no minimum'} to ${buyer.priceMax ?? 'no maximum'}; currency not verified.`);
  if (buyer?.preApproved !== undefined) cf('Recorded financing status', `Pre-approval recorded: ${buyer.preApproved ? 'yes' : 'no'}; confirm currency of this information with the client.`);
  if (seller?.timeline) cf('Recorded seller timeline', `Seller timeline: ${seller.timeline}`);
  if (seller?.propertyAddress) cf('Recorded seller property', `Seller property: ${seller.propertyAddress}`);
  if (seller?.motivation) cf('Recorded seller motivation', `Recorded motivation: ${seller.motivation}`);
  if (buyer?.priceMin !== undefined && buyer.priceMax !== undefined && buyer.priceMin > buyer.priceMax) preferences.push({ id: 'price-conflict', text: 'Recorded minimum price exceeds maximum price. Confirm the range.', state: 'contradictory', citationIds: preferences.filter((i) => i.text.startsWith('Recorded price')).flatMap((i) => i.citationIds) });
  section('preferences', 'Preferences and constraints', preferences, 'Timeline, exclusions, geography and financing details are not recorded. Ask the client to confirm.');
  const records = [...sources.records].sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
  const toFact = (r: typeof records[number]) => fact(r.sourceType, r.id, r.label, r.text, r.time,
    r.sourceType === 'task' ? `/activities?task=${encodeURIComponent(r.id)}` : r.sourceType === 'transaction' || r.sourceType === 'milestone' ? `/transactions#transaction-${encodeURIComponent(r.transactionId ?? r.id)}` : r.sourceType==='property-behavior'?'/properties':contactHref);
  const commitments = records.filter((r) => r.sourceType === 'task' && r.status === 'open').sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')).map(toFact);
  if (contact.nextTouchAt) commitments.push(fact('contact', contact.id, 'Next planned touch', `Next planned touch: ${contact.nextTouchAt}`, contactTime));
  section('commitments', 'Open commitments', commitments, 'No open CRM tasks in the retrieved window. Client-owned promises have not been inferred.', sources.unavailable.includes('tasks'));
  section('changes', 'What changed', records.filter((r) => r.sourceType === 'activity' || r.sourceType === 'note').slice(0, 3).map(toFact), 'No recent recorded interaction in the retrieved window.', sources.unavailable.includes('notes') && sources.unavailable.includes('activities'));
  section('property', 'Property and transaction context', records.filter((r) => r.sourceType === 'transaction' || r.sourceType === 'milestone' || r.sourceType==='property-behavior').map(toFact), 'No transaction or permitted property event in the retrieved window. Appointment context is unavailable in this brief.', sources.unavailable.includes('transactions') && sources.unavailable.includes('property behavior'));
  section('relationship-detail', 'Relationship and nurture context', records.filter((r) => r.sourceType === 'relationship' || r.sourceType === 'nurture').map(toFact), 'Household and nurture context are unavailable in this brief.', true);
  section('coverage', 'Context still to confirm', [], [...sources.unavailable.map((v) => `${v} unavailable`), ...sources.bounded.map((v) => `${v}: latest 20 records only`), 'Client-owned commitments and exclusions need confirmation. Provider message contents were not accessed.'].join('. '), true);
  const focus = commitments.find((i) => i.state !== 'omitted');
  const objective = focus ? { text: 'Confirm progress on the earliest open commitment and agree on the next step.', citationIds: focus.citationIds } : { text: 'Confirm the client’s current goal, timeline and preferred next step.', citationIds: [] };
  const talkingPoints = [{text:focus?'What progress have we made on the open commitment?':'What would you most like to accomplish next?',citationIds:focus?.citationIds??[]}, { text: 'Has your timeline or property preference changed since the recorded details?', citationIds: preferences.filter((i) => i.state !== 'omitted').flatMap((i) => i.citationIds).slice(0, 3) }, { text: 'What would make our next conversation most useful?', citationIds: [] }];
  const sectionOrder=['changes','commitments','relationship','preferences','property','relationship-detail','coverage'];
  sections.sort((a,b)=>sectionOrder.indexOf(a.id)-sectionOrder.indexOf(b.id));
  const snapshot: MeetingBriefSnapshot = { id: randomUUID(), workspaceId: scope.workspaceId, createdByMembershipId: scope.membershipId,
    version: prior ? prior.version + 1 : 1, ...(prior ? { priorSnapshotId: prior.id } : {}), subjectContactId: contact.id,
    ...(input.transactionId ? { optionalTransactionId: input.transactionId } : {}), trigger: input.trigger, contactName: safeText(displayName(contact)) ?? 'Contact',
    asOf, createdAt: asOf, expiresAt: new Date(now.getTime() + MEETING_BRIEF_EXPIRY_MS).toISOString(), status: 'fresh', staleReasons: [], deterministicRuleVersion: MEETING_BRIEF_RULE_VERSION,
    sections, objective, talkingPoints, nextAction: { text: focus ? contact.nextTouchAt && focus.text.startsWith('Next planned touch:') ? `Prepare the planned touch on ${contact.nextTouchAt} and confirm the client’s preferred next step.` : 'Review the open commitment and record the agreed outcome.' : 'Open the contact and record the agreed goal and next touch.', href: focus ? citations.find((c) => c.id === focus.citationIds[0])?.href ?? contactHref : contactHref, citationIds: focus?.citationIds ?? [] },
    citations, sourceHashes: sourceHashes(contact, sources), modelState: 'not-requested', generation: { correlationId: randomUUID(), guardVersion: OMNIX_PROMPT_GUARD_VERSION, guardResult: omitted ? 'content-omitted' : 'pass', sourceCounts: Object.fromEntries(['note', 'task', 'activity', 'transaction', 'nurture', 'relationship', 'milestone','property-behavior'].map((type) => [type, records.filter((r) => r.sourceType === type).length])), latencyMs: Date.now() - started, tokens: 0, cost: 0, terminalState: 'deterministic-ready' } };
  await context.meetingBriefRepository.create(scope, snapshot);
  return { schemaVersion: MEETING_BRIEF_SCHEMA_VERSION, ok: true, mode: scope.mode, snapshot };
}

/** Freshness is recomputed on every read; stored evidence is never rewritten. */
export async function getMeetingBrief(context: MeetingBriefContext, snapshotId: string, clock: Clock = () => new Date()): Promise<MeetingBriefEnvelope> {
  meetingBriefIdentifier(snapshotId);
  const scope = validateWorkspaceScope(context.workspaceScope);
  const snapshot = await context.meetingBriefRepository.get(scope, snapshotId);
  if (!snapshot || snapshot.workspaceId !== scope.workspaceId) throw new MeetingBriefError('not-found', 'Brief is unavailable.');
  const contactHref=`/contacts/${encodeURIComponent(meetingBriefIdentifier(snapshot.subjectContactId))}`;
  if (!Array.isArray(snapshot.citations) || !Array.isArray(snapshot.sections) || !snapshot.nextAction) throw new MeetingBriefError('unavailable','Saved brief is invalid. Build a new brief.');
  // Stored member-authored JSON never supplies navigation authority.
  const citations=snapshot.citations.map(c=>{
    meetingBriefIdentifier(c.recordId);
    const href=c.sourceType==='task'?`/activities?task=${encodeURIComponent(c.recordId)}`
      :c.sourceType==='transaction'?`/transactions#transaction-${encodeURIComponent(c.recordId)}`
        :c.sourceType==='milestone'?'/transactions':c.sourceType==='property-behavior'?'/properties':contactHref;
    return {...c,href};
  });
  const nextAction={...snapshot.nextAction,href:citations.find(c=>c.id===snapshot.nextAction.citationIds[0])?.href??contactHref};
  const { contact, sources } = await load(context, { contactId: snapshot.subjectContactId, transactionId: snapshot.optionalTransactionId, trigger: snapshot.trigger });
  const staleReasons = [];
  if (instant(clock).getTime() >= Date.parse(snapshot.expiresAt)) staleReasons.push('This brief has expired.');
  if (hash(sourceHashes(contact, sources)) !== hash(snapshot.sourceHashes)) staleReasons.push('CRM source records changed since this brief was created.');
  return { schemaVersion: MEETING_BRIEF_SCHEMA_VERSION, ok: true, mode: scope.mode, snapshot: { ...snapshot, citations, nextAction, status: staleReasons.length ? 'stale' : 'fresh', staleReasons } };
}
export async function refreshMeetingBrief(context: MeetingBriefContext, snapshotId: string, expectedVersion: number, clock: Clock = () => new Date()): Promise<MeetingBriefEnvelope> {
  const { snapshot } = await getMeetingBrief(context, snapshotId, clock);
  if (!Number.isInteger(expectedVersion) || snapshot.version !== expectedVersion) throw new MeetingBriefError('conflict', 'Brief version changed. Reopen the brief.');
  return buildMeetingBrief(context, { contactId: snapshot.subjectContactId, transactionId: snapshot.optionalTransactionId, trigger: snapshot.trigger }, clock, snapshot);
}
export async function listMeetingBriefEvidence(context: MeetingBriefContext, snapshotId: string, clock?: Clock) {
  return (await getMeetingBrief(context, snapshotId, clock)).snapshot.citations;
}
