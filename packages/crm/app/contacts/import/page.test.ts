import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contact import route execution envelope', () => {
  it('keeps enough provider time for the governed 144-row atomic commit', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/export const maxDuration = 60;/);
    expect(source).not.toMatch(/export const maxDuration = 15;/);
  });
});
