import { describe, expect, it } from 'vitest';
import { rankSearchCandidate, resolveCrmCommand } from './crm-search.ts';

describe('crm search domain', () => {
  it('uses deterministic ranking tiers', () => {
    expect(rankSearchCandidate('Ada', 'Ada', [], 'id')).toBe(95);
    expect(rankSearchCandidate('Ada', 'Ada Lovelace', [], 'id')).toBe(85);
    expect(rankSearchCandidate('Ada', 'Grace', ['Ada@example.com'], 'id')).toBe(55);
  });
  it('accepts only allowlisted commands', () => {
    expect(resolveCrmCommand('open-pipeline').href).toBe('/pipeline');
    expect(() => resolveCrmCommand('run-arbitrary-code')).toThrow('not allowlisted');
  });
});
