export type WebsiteIntakeActionState = {
  readonly status: 'idle' | 'success' | 'error';
  readonly message: string;
};

export const INITIAL_WEBSITE_INTAKE_ACTION_STATE: WebsiteIntakeActionState = {
  status: 'idle',
  message: '',
};
