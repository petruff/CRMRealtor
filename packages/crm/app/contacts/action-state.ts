export interface WorkQueueActionState {
  status: "idle" | "success" | "noop" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  targetId?: string;
}

export const INITIAL_WORK_QUEUE_ACTION_STATE: WorkQueueActionState = {
  status: "idle",
};

export interface RichContactActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Readonly<Record<string, string>>;
  /** Submitted text returned on failure so a reset form can keep the user's draft. */
  values?: Readonly<Record<string, string>>;
}

export const INITIAL_RICH_CONTACT_ACTION_STATE: RichContactActionState = { status: 'idle' };

export interface TextingActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
}

export const INITIAL_TEXTING_ACTION_STATE: TextingActionState = { status: 'idle' };

export interface GoogleEmailActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
  readonly phase?: 'draft-ready' | 'queued' | 'sent';
  readonly intentId?: string;
  readonly intentVersion?: number;
  readonly recipient?: string;
  readonly subject?: string;
}

export const INITIAL_GOOGLE_EMAIL_ACTION_STATE: GoogleEmailActionState = { status: 'idle' };
