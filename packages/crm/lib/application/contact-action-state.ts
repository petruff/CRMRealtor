export interface ContactActionState {
  status: 'idle' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

export const INITIAL_CONTACT_ACTION_STATE: ContactActionState = { status: 'idle' };
