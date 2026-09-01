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
  const testFingerprint = ['abcdef', '123456'].join('');

  it('renders an unprefilled password field and only a masked fingerprint', () => {
    const html = renderToStaticMarkup(<AiSettingsForm status={{
      configured: true,
      enabled: true,
      model: 'gemini-3.5-flash-lite',
      secretVersion: 3,
      keyFingerprint: testFingerprint,
    }} />);
    expect(html).toContain('type="password"');
    expect(html).not.toContain('value="AIza');
    expect(html).toContain('•••• abcdef123456');
    expect(html).toContain('Disable routing');
    expect(html).toContain('Remove key');
  });

  it('renders only redacted operational AI usage', () => {
    const html = renderToStaticMarkup(<AiSettingsForm status={{
      configured: true,
      enabled: true,
      provider: 'google-gemini',
      model: 'gemini-3.5-flash-lite',
      secretVersion: 3,
      keyFingerprint: testFingerprint,
    }} usage={{
      usageDay: '2026-08-30',
      committedMicrousd: 12500,
      runCount: 4,
      succeeded: 2,
      failed: 1,
      reserved: 1,
      lastRunAt: '2026-08-30T15:00:00.000Z',
    }} />);
    expect(html).toContain('Today’s AI activity');
    expect(html).toContain('$0.0125');
    expect(html).toContain('Redacted operational receipts only');
    expect(html).not.toContain('2026-08-30T15:00:00.000Z');
  });
});
