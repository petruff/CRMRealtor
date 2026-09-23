import { describe, expect, it } from 'vitest';
import type { Contact } from '@/lib/domain/contact';
import { captureCandidates, filterCaptureCandidates } from './capture-candidates';

const NOW = new Date('2026-09-23T15:00:00.000Z');
const person = (id: string, firstName: string, patch: Partial<Contact> = {}): Contact => ({
  id, firstName, lastName: 'Lane', leadType: 'warm', relationship: 'lead', intent: 'buyer', source: 'other',
  pipelineStage: 'contacted', tags: [], createdAt: '2026-08-01T00:00:00.000Z', lastContactedAt: '2026-09-20', nextTouchAt: '2026-10-20', ...patch,
});

describe('capture candidates', () => {
  it('puts people Today prioritizes first, then everyone else alphabetically, and hides archived', () => {
    const list = captureCandidates([
      person('z', 'Zed'),
      person('a', 'Amy'),
      person('late', 'Olga', { nextTouchAt: '2026-09-10', leadType: 'hot' }),
      person('gone', 'Gone', { archivedAt: '2026-09-01T00:00:00Z' }),
    ], NOW);
    expect(list.map((entry) => entry.id)).toEqual(['late', 'a', 'z']);
    expect(list[0]!.reason).toBeTruthy();
    expect(list[1]!.reason).toBeUndefined();
  });

  it('finds people by name, city or phone digits', () => {
    const list = captureCandidates([
      person('a', 'Amy', { city: 'Tampa', phone: '(813) 555-0101' }),
      person('b', 'Bruno', { city: 'Orlando', phone: '(407) 555-0199' }),
    ], NOW);
    expect(filterCaptureCandidates(list, 'amy').map((entry) => entry.id)).toEqual(['a']);
    expect(filterCaptureCandidates(list, 'orlando').map((entry) => entry.id)).toEqual(['b']);
    expect(filterCaptureCandidates(list, '4075550199').map((entry) => entry.id)).toEqual(['b']);
    expect(filterCaptureCandidates(list, '  ')).toHaveLength(2);
    expect(filterCaptureCandidates(list, 'nobody')).toHaveLength(0);
  });
});
