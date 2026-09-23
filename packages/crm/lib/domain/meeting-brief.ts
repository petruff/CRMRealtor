/** Shared CLI/UI evidence contract. Free text is always a recorded statement, never an instruction. */
export const MEETING_BRIEF_SCHEMA_VERSION = 'meeting-brief.v1' as const;
export const MEETING_BRIEF_RULE_VERSION = 'meeting-brief.rules.v1' as const;
export const MEETING_BRIEF_EXPIRY_MS = 15 * 60 * 1000;
export const MEETING_BRIEF_SOURCE_LIMIT = 20;
export type MeetingBriefTruthState = 'confirmed' | 'estimated' | 'stale' | 'contradictory' | 'unknown' | 'unavailable' | 'omitted';
export type MeetingBriefSourceType = 'contact' | 'note' | 'task' | 'activity' | 'transaction' | 'nurture' | 'relationship' | 'milestone' | 'property-behavior';
export interface MeetingBriefCitation {
  readonly id: string;
  readonly sourceType: MeetingBriefSourceType;
  readonly recordId: string;
  readonly label: string;
  readonly sourceTime: string | null;
  readonly asOf: string;
  readonly href: string;
}
export interface MeetingBriefSuggestion { readonly text: string; readonly citationIds: readonly string[] }
export interface MeetingBriefItem extends MeetingBriefSuggestion { readonly id: string; readonly state: MeetingBriefTruthState }
export interface MeetingBriefSection { readonly id: string; readonly title: string; readonly state: MeetingBriefTruthState; readonly items: readonly MeetingBriefItem[] }
export interface MeetingBriefInput { readonly contactId: string; readonly transactionId?: string; readonly trigger: 'today' | 'contact' | 'transaction' | 'cli' }
export interface MeetingBriefSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdByMembershipId: string;
  readonly version: number;
  readonly priorSnapshotId?: string;
  readonly subjectContactId: string;
  readonly optionalTransactionId?: string;
  readonly trigger: MeetingBriefInput['trigger'];
  readonly contactName: string;
  readonly asOf: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'fresh' | 'stale';
  readonly staleReasons: readonly string[];
  readonly deterministicRuleVersion: typeof MEETING_BRIEF_RULE_VERSION;
  readonly sections: readonly MeetingBriefSection[];
  readonly objective: MeetingBriefSuggestion;
  readonly talkingPoints: readonly MeetingBriefSuggestion[];
  readonly nextAction: MeetingBriefSuggestion & { readonly href: string };
  readonly citations: readonly MeetingBriefCitation[];
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly modelState: 'not-requested';
  readonly generation: {
    readonly correlationId: string; readonly guardVersion: string; readonly guardResult: 'pass' | 'content-omitted';
    readonly sourceCounts: Readonly<Record<string, number>>; readonly latencyMs: number;
    readonly tokens: 0; readonly cost: 0; readonly terminalState: 'deterministic-ready';
  };
}
export interface MeetingBriefEnvelope { readonly schemaVersion: typeof MEETING_BRIEF_SCHEMA_VERSION; readonly ok: true; readonly mode: 'live' | 'sample'; readonly snapshot: MeetingBriefSnapshot }
export class MeetingBriefError extends Error {
  readonly code: 'invalid-input' | 'not-found' | 'conflict' | 'unavailable';
  constructor(code: MeetingBriefError['code'], message: string) { super(message); this.name = 'MeetingBriefError'; this.code = code; }
}
export function meetingBriefIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new MeetingBriefError('invalid-input', 'Invalid brief reference.');
  return value;
}
