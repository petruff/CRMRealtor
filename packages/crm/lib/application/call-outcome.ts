import type { FollowUpChoice } from './contact-commands.ts';

export const CALL_OUTCOMES = ['talked', 'voicemail', 'no-answer'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  talked: 'We talked',
  voicemail: 'Left a voicemail',
  'no-answer': 'No answer',
};

/** Sensible next step per outcome; the realtor can always change it. */
export const DEFAULT_FOLLOW_UP: Record<CallOutcome, FollowUpChoice> = {
  talked: 'cadence',
  voicemail: 'three-days',
  'no-answer': 'tomorrow',
};

export function parseCallOutcome(value: unknown): CallOutcome | undefined {
  return (CALL_OUTCOMES as readonly string[]).includes(String(value)) ? value as CallOutcome : undefined;
}

/** The note saved on the timeline, e.g. "Call — left a voicemail. Asked about Saturday." */
export function callOutcomeNote(outcome: CallOutcome, note: string): string {
  const summary = outcome === 'talked' ? 'Call — talked' : outcome === 'voicemail' ? 'Call — left a voicemail' : 'Call — no answer';
  const detail = note.replace(/\r\n?/g, '\n').trim();
  return detail ? `${summary}. ${detail}` : `${summary}.`;
}

export interface PendingCall {
  readonly contactId: string;
  readonly name: string;
  readonly startedAt: number;
  readonly left?: boolean;
}

export const PENDING_CALL_KEY = 'omnix-pending-call';
export const CALL_PROMPT_PREFERENCE_KEY = 'omnix-call-followup';

/** Ask only after the realtor actually left the app and came back 5s–2h later. */
export function shouldPromptForCall(pending: PendingCall | undefined, now: number): boolean {
  if (!pending?.left) return false;
  const elapsed = now - pending.startedAt;
  return elapsed >= 5_000 && elapsed <= 2 * 60 * 60 * 1000;
}
