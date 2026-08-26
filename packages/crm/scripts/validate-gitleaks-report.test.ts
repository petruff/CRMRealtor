import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateGitleaksFindings } from './validate-gitleaks-report';

const root = 'C:/candidate';
const secret = 'reviewed-false-positive';
const baseline = {
  schemaVersion: 1,
  findings: [{
    rule: 'generic-api-key',
    path: 'docs/example.md',
    line: 7,
    secretSha256Parts: createHash('sha256').update(secret).digest('hex').match(/.{8}/g)!,
    reason: 'Reviewed test fixture.',
  }],
};
const report = [{ RuleID: 'generic-api-key', File: 'C:/candidate/docs/example.md', StartLine: 7, Secret: secret }];

describe('Gitleaks baseline validation', () => {
  it('accepts only the exact reviewed finding content', () => {
    expect(() => validateGitleaksFindings(report, baseline, root)).not.toThrow();
  });

  it('rejects a new secret even at an allowlisted line', () => {
    const changed = [{ ...report[0], Secret: 'different-secret-value' }];
    expect(() => validateGitleaksFindings(changed, baseline, root)).toThrow(/baseline mismatch/i);
  });

  it('rejects findings outside the candidate snapshot', () => {
    const escaped = [{ ...report[0], File: 'C:/other/example.md' }];
    expect(() => validateGitleaksFindings(escaped, baseline, root)).toThrow(/outside the candidate snapshot/i);
  });
});
