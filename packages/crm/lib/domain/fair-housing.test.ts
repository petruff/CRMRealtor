import { describe, expect, it } from 'vitest';
import { blockingFairHousingFindings, fairHousingBlockMessage, lintFairHousing } from './fair-housing.ts';

describe('lintFairHousing', () => {
  it('blocks explicit exclusions', () => {
    const findings = lintFairHousing('Charming condo, adults only, no kids, no Section 8. Must be able to climb stairs.');
    expect(findings.map((finding) => [finding.phrase, finding.severity, finding.category])).toEqual([
      ['adults only', 'avoid', 'familial-status'],
      ['no kids', 'avoid', 'familial-status'],
      ['no Section 8', 'avoid', 'source-of-income'],
      ['Must be able to climb', 'avoid', 'disability'],
    ]);
  });

  it('flags preferences for review with a safer alternative', () => {
    const findings = lintFairHousing('Perfect for young professionals in a safe neighborhood — family-friendly and exclusive community.');
    expect(findings.map((finding) => [finding.phrase, finding.severity])).toEqual([
      ['Perfect for young professionals', 'review'], ['safe neighborhood', 'review'], ['family-friendly', 'review'], ['exclusive community', 'review'],
    ]);
    expect(findings[0]?.suggestion).toContain('Describe features');
  });

  it('catches religious and ethnic descriptions of people or places', () => {
    expect(lintFairHousing('Located in a Christian community').map((finding) => finding.category)).toEqual(['religion']);
    expect(lintFairHousing('Mostly Hispanic neighborhood').map((finding) => finding.category)).toEqual(['race-national-origin']);
  });

  it('does not flag names, property features or neutral facts', () => {
    expect(lintFairHousing('Christian Lopez loved the master bedroom, the walk-in closet and the family room near the park.')).toEqual([]);
    expect(lintFairHousing('Three bedrooms, fenced yard, 0.3 miles to the park, 55+ community with HOPA certification.')).toEqual([]);
  });

  it('summarizes blocking phrases for the realtor', () => {
    const blocking = blockingFairHousingFindings('Great home', 'No children please');
    expect(blocking).toHaveLength(1);
    expect(fairHousingBlockMessage(blocking)).toBe('Fair Housing check: please rephrase “No children” before this goes out.');
  });
});
