import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');

describe('affordability scenario experience contract', () => {
  it('keeps unknowns, authority, dates, assumptions and verification visible for every input', () => {
    expect(page).toMatch(/Unknown — do not use zero/);
    expect(page).toMatch(/Authority/);
    expect(page).toMatch(/As of/);
    expect(page).toMatch(/Verified against source/);
    expect(page).toMatch(/Planning assumption/);
  });

  it('uses responsive layouts and a preview-only consent boundary', () => {
    expect(page).toMatch(/sm:grid-cols-2/);
    expect(page).toMatch(/2xl:grid-cols-/);
    expect(page).toMatch(/It does not send email/);
    expect(page).toMatch(/consented to this exact version and recipient/);
    expect(actions).toMatch(/previewPayload:\{scenarioId:scenario\.id,scenarioVersion:scenario\.version/);
    expect(actions).not.toMatch(/gmail|sendEmail|mailchimp/i);
  });
});
