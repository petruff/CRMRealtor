import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contact import route execution envelope', () => {
  it('keeps enough provider time for the governed 144-row atomic commit', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/export const maxDuration = 60;/);
    expect(source).not.toMatch(/export const maxDuration = 15;/);
  });

  it('keeps latest-import review terminology and destinations distinct', () => {
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('qualification review');
    expect(source).toContain('incomplete');
    expect(source).toContain('quarantined');
    expect(source).toContain('already current');
    expect(source).toContain('failed');
    expect(source).toContain('href="/contacts?scope=needs-review"');
    expect(source).toContain('href="/contacts/incomplete"');
    expect(source).toContain('latestImport.quarantined_count > 0 ?');
    expect(source).toContain('latestImport.rejected_count > 0 ?');
    expect(source).toContain('Import a corrected file');
    expect(source).toContain('latestImport.failed_count > 0 ?');
    expect(source).toContain('Select file and retry');
    expect(source).not.toContain('Retry failed rows');
    expect(source).toContain("{' '}(<strong");
  });
});
