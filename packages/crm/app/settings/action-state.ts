export interface AiSettingsActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
}

export const INITIAL_AI_SETTINGS_ACTION_STATE: AiSettingsActionState = { status: 'idle' };
