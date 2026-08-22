export interface MailerActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

export const INITIAL_MAILER_ACTION_STATE: MailerActionState = { status: 'idle' };
