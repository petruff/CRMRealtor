import { describe, expect, it } from 'vitest';
import { classifyContactImportCandidate } from '@/lib/application/contact-import-classification';
import type { ContactImportCandidate, ContactImportSourceFact } from '@/lib/application/contact-import';

function fact(key: string, value: string | number): ContactImportSourceFact {
  return {
    key,
    label: key,
    category: key === 'rating' ? 'engagement' : key === 'last-closed-date' ? 'real-estate' : 'other',
    valueType: typeof value === 'number' ? 'number' : 'text',
    value,
  };
}

function candidate(overrides: Partial<ContactImportCandidate> = {}): ContactImportCandidate {
  return { rowNumber: 2, firstName: 'Synthetic', lastName: 'Contact', tags: [], ...overrides };
}

describe('automatic imported-contact classification', () => {
  it.each([
    ['Under Contract', 5, 'hot', 'active-client', 'under-contract'],
    ['Appointment Set', 3, 'warm', 'lead', 'appointment-set'],
    ['Active Client', 4, 'hot', 'active-client', 'active'],
    ['Active Lead', 2, 'warm', 'lead', 'active'],
    ['Sphere', 1, 'nurture', 'sphere', 'contacted'],
    ['Inactive Lead', 0, 'nurture', 'lead', 'lost'],
  ])('uses lifecycle %s and rating %s', (status, rating, leadType, relationship, pipelineStage) => {
    const result = classifyContactImportCandidate(candidate({
      sourceFacts: [fact('status', status), fact('rating', rating)],
    }));
    expect(result.candidate).toMatchObject({ leadType, relationship, pipelineStage, qualificationStatus: 'qualified' });
    expect(result.classification).toMatchObject({ mode: 'automatic', confidence: 'high', needsReview: false });
  });

  it('uses a closed date to identify a past client', () => {
    const result = classifyContactImportCandidate(candidate({
      sourceFacts: [fact('last-closed-date', '2025-06-04')],
    }));
    expect(result.candidate).toMatchObject({ leadType: 'nurture', relationship: 'past-client', pipelineStage: 'closed' });
  });

  it('preserves every explicit canonical classification value', () => {
    const result = classifyContactImportCandidate(candidate({
      leadType: 'warm', qualificationStatus: 'qualified', relationship: 'sphere', intent: 'seller',
      source: 'referral', pipelineStage: 'contacted', sourceFacts: [fact('status', 'Under Contract'), fact('rating', 5)],
    }));
    expect(result.candidate).toMatchObject({
      leadType: 'warm', qualificationStatus: 'qualified', relationship: 'sphere', intent: 'seller',
      source: 'referral', pipelineStage: 'contacted',
    });
    expect(result.classification.mode).toBe('explicit');
    expect(result.classification.decisions).toEqual([]);
  });

  it('uses a safe actionable fallback instead of defaulting unknown contacts to Warm', () => {
    const result = classifyContactImportCandidate(candidate());
    expect(result.candidate).toMatchObject({
      leadType: 'nurture', qualificationStatus: 'needs-qualification', relationship: 'lead',
      intent: 'unknown', source: 'other', pipelineStage: 'new',
    });
    expect(result.classification).toMatchObject({ mode: 'safe-default', confidence: 'review', needsReview: true });
  });

  it('derives intent from preserved deal type when the canonical value is absent', () => {
    const result = classifyContactImportCandidate(candidate({
      sourceFacts: [fact('status', 'Active Lead'), fact('deal-type', 'buyer and seller')],
    }));
    expect(result.candidate.intent).toBe('both');
  });
});
