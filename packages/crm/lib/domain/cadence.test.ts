import { describe, expect, it } from 'vitest';
import type { Contact } from './contact';
import {
  CADENCE_DAYS,
  computeNextTouch,
  effectiveCadenceDays,
  ensureNextTouch,
  historicalImportNextTouch,
  isDormant,
  overrideNextTouch,
  recordTouch,
} from './cadence';

const NOW = new Date('2026-08-10T12:00:00Z');

function contact(patch: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    firstName: 'Test',
    lastName: 'Person',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'buyer',
    source: 'referral',
    pipelineStage: 'contacted',
    tags: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('cadence intervals', () => {
  it('uses the intervals the client confirmed', () => {
    expect(CADENCE_DAYS).toEqual({ hot: 7, warm: 7, nurture: 30 });
  });
});

describe('approved cadence', () => {
  it('keeps Nurture monthly even when the CRM record is new', () => {
    const fresh = contact({ leadType: 'nurture', createdAt: '2026-08-01T00:00:00.000Z' });
    const settled = contact({ leadType: 'nurture', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(effectiveCadenceDays(fresh, NOW)).toBe(30);
    expect(effectiveCadenceDays(settled, NOW)).toBe(30);
  });

  it('keeps Hot and Warm weekly regardless of CRM record age', () => {
    const hot = contact({ leadType: 'hot', createdAt: '2026-08-01T00:00:00.000Z' });
    const warm = contact({ leadType: 'warm', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(effectiveCadenceDays(hot, NOW)).toBe(7);
    expect(effectiveCadenceDays(warm, NOW)).toBe(7);
  });
});

describe('dormancy', () => {
  it('treats closed and lost as dormant', () => {
    expect(isDormant(contact({ pipelineStage: 'closed' }))).toBe(true);
    expect(isDormant(contact({ pipelineStage: 'lost' }))).toBe(true);
    expect(isDormant(contact({ pipelineStage: 'active' }))).toBe(false);
  });

  it('schedules nothing for a dormant contact', () => {
    expect(computeNextTouch(contact({ pipelineStage: 'closed' }), NOW)).toBeUndefined();
  });
});

describe('recordTouch', () => {
  it('schedules the next touch one interval out', () => {
    const updated = recordTouch(contact({ leadType: 'nurture', createdAt: '2026-01-01T00:00:00.000Z' }), NOW);
    expect(updated.nextTouchAt).toBe('2026-09-09'); // 30 days on
    expect(updated.lastContactedAt).toBe(NOW.toISOString());
  });

  it('advances a brand-new contact out of the new stage', () => {
    expect(recordTouch(contact({ pipelineStage: 'new' }), NOW).pipelineStage).toBe('contacted');
  });

  it('leaves a later stage alone', () => {
    expect(recordTouch(contact({ pipelineStage: 'under-contract' }), NOW).pipelineStage).toBe(
      'under-contract',
    );
  });

  it('clears a manual override once the conversation has happened', () => {
    const overridden = overrideNextTouch(contact(), '2026-12-25');
    expect(overridden.touchDateOverridden).toBe(true);
    expect(recordTouch(overridden, NOW).touchDateOverridden).toBe(false);
  });
});

describe('ensureNextTouch', () => {
  it('backfills a missing touch date', () => {
    const result = ensureNextTouch(contact({ lastContactedAt: '2026-08-05T00:00:00.000Z' }), NOW);
    expect(result.nextTouchAt).toBe('2026-08-12'); // 7 days after last contact
  });

  it('never schedules into the past', () => {
    const stale = contact({ lastContactedAt: '2020-01-01T00:00:00.000Z' });
    expect(ensureNextTouch(stale, NOW).nextTouchAt).toBe('2026-08-10'); // due now, not overdue by years
  });

  it('leaves an existing date untouched', () => {
    const withDate = contact({ nextTouchAt: '2026-09-01' });
    expect(ensureNextTouch(withDate, NOW).nextTouchAt).toBe('2026-09-01');
  });

  it('respects a manual override', () => {
    const overridden = { ...contact(), touchDateOverridden: true };
    expect(ensureNextTouch(overridden, NOW).nextTouchAt).toBeUndefined();
  });
});

describe('historicalImportNextTouch', () => {
  it('distributes historical Nurture records within the approved monthly window', () => {
    const dates = new Set(Array.from({ length: 40 }, (_, index) => historicalImportNextTouch(
      contact({ id: `import-${index}`, leadType: 'nurture' }),
      NOW,
    )));
    expect(dates.size).toBeGreaterThan(15);
    for (const date of dates) {
      expect(date && date >= '2026-08-10' && date <= '2026-09-08').toBe(true);
    }
  });

  it('is stable for retries on the same CRM day', () => {
    const imported = contact({ id: 'stable-import', leadType: 'warm' });
    expect(historicalImportNextTouch(imported, NOW)).toBe(
      historicalImportNextTouch(imported, new Date('2026-08-10T23:59:00Z')),
    );
  });
});
