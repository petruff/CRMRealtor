import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiSettingsForm } from './ai-settings-form';

vi.mock('@/app/settings/actions', () => ({
  INITIAL_AI_SETTINGS_ACTION_STATE: { status: 'idle' },
  saveGeminiSettingsAction: vi.fn(),
  removeGeminiSettingsAction: vi.fn(),
  toggleGeminiSettingsAction: vi.fn(),
}));

describe('AiSettingsForm', () => {
  it('renders an unprefilled password field and only a masked fingerprint', () => {
    const html = renderToStaticMarkup(<AiSettingsForm status={{
      configured: true,
      enabled: true,
      model: 'gemini-3.5-flash-lite',
      secretVersion: 3,
      keyFingerprint: 'abcdef123456',
    }} />);
    expect(html).toContain('type="password"');
    expect(html).not.toContain('value="AIza');
    expect(html).toContain('•••• abcdef123456');
    expect(html).toContain('Disable routing');
    expect(html).toContain('Remove key');
  });
});
