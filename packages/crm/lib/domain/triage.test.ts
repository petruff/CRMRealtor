import { describe, expect, it } from 'vitest';
import type { Contact } from './contact';
import { buildTriage, daysOverdue, priorityScore, summarise, type BucketId } from './triage';

const NOW = new Date('2026-08-10T12:00:00Z');

function contact(patch: Partial<Contact> = {}): Contact {
  return {
    id: Math.random().toString(36).slice(2),
    firstName: 'Test',
    lastName: 'Person',
    leadType: 'warm',
    relationship: 'lead',
    intent: 'buyer',
    source: 'referral',
    pipelineStage: 'contacted',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastContactedAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

function bucket(buckets: ReturnType<typeof buildTriage>, id: BucketId) {
  const found = buckets.find((b) => b.id === id);
  if (!found) throw new Error(`bucket ${id} missing`);
  return found;
}

describe('daysOverdue', () => {
  it('is positive when past due, 0 today, negative when upcoming', () => {
    expect(daysOverdue(contact({ nextTouchAt: '2026-08-05' }), NOW)).toBe(5);
    expect(daysOverdue(contact({ nextTouchAt: '2026-08-10' }), NOW)).toBe(0);
    expect(daysOverdue(contact({ nextTouchAt: '2026-08-14' }), NOW)).toBe(-4);
  });
});

describe('priorityScore — Speed to Lead', () => {
  it('ranks a never-contacted lead above even a badly overdue one', () => {
    const fresh = contact({ lastContactedAt: undefined, createdAt: '2026-08-09T00:00:00.000Z' });
    const veryOverdue = contact({ nextTouchAt: '2026-01-01', leadType: 'hot' });
    expect(priorityScore(fresh, NOW)).toBeGreaterThan(priorityScore(veryOverdue, NOW));
  });

  it('puts the longest-waiting uncontacted lead first', () => {
    const older = contact({ lastContactedAt: undefined, createdAt: '2026-08-01T00:00:00.000Z' });
    const newer = contact({ lastContactedAt: undefined, createdAt: '2026-08-09T00:00:00.000Z' });
    expect(priorityScore(older, NOW)).toBeGreaterThan(priorityScore(newer, NOW));
  });
});

describe('priorityScore — lead weight breaks ties', () => {
  it('ranks Hot above Warm above Nurture at equal overdueness', () => {
    const hot = contact({ leadType: 'hot', nextTouchAt: '2026-08-07' });
    const warm = contact({ leadType: 'warm', nextTouchAt: '2026-08-07' });
    const nurture = contact({ leadType: 'nurture', nextTouchAt: '2026-08-07' });

    expect(priorityScore(hot, NOW)).toBeGreaterThan(priorityScore(warm, NOW));
    expect(priorityScore(warm, NOW)).toBeGreaterThan(priorityScore(nurture, NOW));
  });

  it('still lets a much more overdue Nurture outrank a barely-due Hot', () => {
    const staleNurture = contact({ leadType: 'nurture', nextTouchAt: '2026-07-01' });
    const freshHot = contact({ leadType: 'hot', nextTouchAt: '2026-08-09' });
    expect(priorityScore(staleNurture, NOW)).toBeGreaterThan(priorityScore(freshHot, NOW));
  });
});

describe('buildTriage bucketing', () => {
  it('places each contact in exactly one follow-up bucket', () => {
    const buckets = buildTriage(
      [
        contact({ id: 'never', lastContactedAt: undefined }),
        contact({ id: 'late', nextTouchAt: '2026-08-01' }),
        contact({ id: 'today', nextTouchAt: '2026-08-10' }),
        contact({ id: 'soon', nextTouchAt: '2026-08-13' }),
      ],
      NOW,
    );

    expect(bucket(buckets, 'needs-first-contact').entries.map((e) => e.contact.id)).toEqual(['never']);
    expect(bucket(buckets, 'overdue').entries.map((e) => e.contact.id)).toEqual(['late']);
    expect(bucket(buckets, 'due-today').entries.map((e) => e.contact.id)).toEqual(['today']);
    expect(bucket(buckets, 'coming-up').entries.map((e) => e.contact.id)).toEqual(['soon']);
  });

  it('keeps a historical import on its scheduled cadence instead of fresh-lead urgency', () => {
    const imported = contact({
      id: 'imported',
      lastContactedAt: undefined,
      nextTouchAt: '2026-08-13',
      createdAt: '2026-08-10T10:00:00.000Z',
    });
    const buckets = buildTriage([imported], NOW, {
      historicalImportContactIds: new Set(['imported']),
    });

    expect(bucket(buckets, 'needs-first-contact').entries).toHaveLength(0);
    expect(bucket(buckets, 'coming-up').entries.map((entry) => entry.contact.id)).toEqual(['imported']);
  });

  it('still treats a real-time new lead as immediate first-contact work', () => {
    const inbound = contact({
      id: 'inbound',
      lastContactedAt: undefined,
      nextTouchAt: '2026-08-17',
      createdAt: '2026-08-10T10:00:00.000Z',
    });
    const buckets = buildTriage([inbound], NOW, { historicalImportContactIds: new Set() });
    expect(bucket(buckets, 'needs-first-contact').entries.map((entry) => entry.contact.id)).toEqual(['inbound']);
  });

  it('excludes contacts beyond the upcoming window', () => {
    const buckets = buildTriage([contact({ nextTouchAt: '2026-09-30' })], NOW);
    expect(bucket(buckets, 'coming-up').entries).toHaveLength(0);
  });

  it('excludes dormant contacts entirely', () => {
    const buckets = buildTriage(
      [
        contact({ id: 'closed', pipelineStage: 'closed', nextTouchAt: '2026-01-01' }),
        contact({ id: 'lost', pipelineStage: 'lost', lastContactedAt: undefined }),
      ],
      NOW,
    );
    const total = buckets.reduce((sum, b) => sum + b.entries.length, 0);
    expect(total).toBe(0);
  });

  it('sorts overdue with the most overdue first', () => {
    const buckets = buildTriage(
      [
        contact({ id: 'a', nextTouchAt: '2026-08-08' }),
        contact({ id: 'b', nextTouchAt: '2026-07-01' }),
        contact({ id: 'c', nextTouchAt: '2026-08-01' }),
      ],
      NOW,
    );
    expect(bucket(buckets, 'overdue').entries.map((e) => e.contact.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('celebrations', () => {
  it('surfaces a birthday inside the 7-day window', () => {
    const buckets = buildTriage([contact({ birthdate: '1979-08-13' })], NOW);
    expect(bucket(buckets, 'celebrations').entries).toHaveLength(1);
    expect(bucket(buckets, 'celebrations').entries[0]?.reason).toContain('Birthday in 3 days');
  });

  it('ignores a birthday beyond the window', () => {
    const buckets = buildTriage([contact({ birthdate: '1979-10-01' })], NOW);
    expect(bucket(buckets, 'celebrations').entries).toHaveLength(0);
  });

  it('surfaces a homeaversary inside the 30-day window', () => {
    const buckets = buildTriage([contact({ homePurchaseDate: '2023-08-21' })], NOW);
    expect(bucket(buckets, 'celebrations').entries[0]?.reason).toContain('Homeaversary in 11 days');
  });

  it('lets a contact be both overdue and celebrating — different axes', () => {
    const buckets = buildTriage(
      [contact({ id: 'both', nextTouchAt: '2026-08-01', birthdate: '1979-08-12' })],
      NOW,
    );
    expect(bucket(buckets, 'overdue').entries).toHaveLength(1);
    expect(bucket(buckets, 'celebrations').entries).toHaveLength(1);
  });
});

describe('summarise', () => {
  it('counts what needs attention now, excluding upcoming', () => {
    const buckets = buildTriage(
      [
        contact({ lastContactedAt: undefined, leadType: 'hot' }),
        contact({ nextTouchAt: '2026-08-01', leadType: 'hot' }),
        contact({ nextTouchAt: '2026-08-10', leadType: 'warm' }),
        contact({ nextTouchAt: '2026-08-14', leadType: 'nurture' }),
      ],
      NOW,
    );
    const summary = summarise(buckets);

    expect(summary.needsAttentionNow).toBe(3);
    expect(summary.overdueCount).toBe(1);
    expect(summary.dueTodayCount).toBe(1);
    expect(summary.byLeadType).toEqual({ hot: 2, warm: 1, nurture: 0 });
  });
});
