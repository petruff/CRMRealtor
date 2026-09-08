import type { WorkspaceScope } from '../domain/workspace.ts';
import type { MeetingBriefSnapshot, MeetingBriefSourceType } from '../domain/meeting-brief.ts';

/** Only minimal, bounded CRM facts enter the brief. Raw provider payloads have no field here. */
export interface MeetingBriefSourceRecord {
  readonly id: string;
  readonly sourceType: Exclude<MeetingBriefSourceType, 'contact'>;
  readonly contactId: string;
  readonly workspaceId: string;
  readonly time: string | null;
  readonly label: string;
  readonly text: string;
  readonly dueAt?: string;
  readonly status?: string;
  readonly transactionId?: string;
}
export interface MeetingBriefSources { readonly records: readonly MeetingBriefSourceRecord[]; readonly unavailable: readonly string[]; readonly bounded: readonly string[] }
export interface MeetingBriefRepository {
  loadSources(scope: WorkspaceScope, contactId: string, transactionId?: string): Promise<MeetingBriefSources>;
  create(scope: WorkspaceScope, snapshot: MeetingBriefSnapshot): Promise<void>;
  get(scope: WorkspaceScope, id: string): Promise<MeetingBriefSnapshot | undefined>;
}
