import { describe, expect, it } from 'vitest';
import type { Contact } from './contact';
import {
  applySmartListDefinition,
  archiveSmartList,
  parseSmartListDefinition,
  parseSmartListName,
  restoreSmartList,
  SMART_LIST_EVALUATION_INPUT_MAX,
  SMART_LIST_SCHEMA_VERSION,
  type SmartList,
} from './smart-list';

function contact(id: string, leadType: Contact['leadType'], patch: Partial<Contact> = {}): Contact {
  return {
    id,
    firstName: id,
    lastName: 'Realtor',
    leadType,
    relationship: 'lead',
    intent: 'buyer',
    source: 'referral',
    pipelineStage: 'new',
    tags: [],
    createdAt: `2026-01-${id.padStart(2, '0')}T00:00:00.000Z`,
    ...patch,
  };
}

const definition = (criteria: unknown[] = []) => ({
  schemaVersion: SMART_LIST_SCHEMA_VERSION,
  criteria,
});

describe('Smart List domain', () => {
  it('validates the versioned allowlist and reports field-level failures', () => {
    expect(parseSmartListDefinition(definition([
      { field: 'leadType', operator: 'in', value: ['hot', 'warm'] },
      { field: 'nextTouchAt', operator: 'empty' },
    ]))).toMatchObject({ schemaVersion: SMART_LIST_SCHEMA_VERSION });
    expect(() => parseSmartListDefinition({ schemaVersion: 'v2', criteria: [] }))
      .toThrow(/only smart-list-filter\.v1/i);
    expect(() => parseSmartListDefinition(definition([
      { field: 'rawSql', operator: 'eq', value: 'drop table' },
    ]))).toThrow(/unknown smart list field/i);
    expect(() => parseSmartListDefinition(definition(Array.from({ length: 21 }, () => ({
      field: 'leadType', operator: 'eq', value: 'hot',
    }))))).toThrow(/20 criteria/i);
    expect(() => parseSmartListName('x'.repeat(81))).toThrow(/80/);
  });

  it('evaluates enum, text, number, date, tag and bounded query criteria together', () => {
    const match = contact('1', 'hot', {
      firstName: 'José',
      city: 'Miami Beach',
      nextTouchAt: '2026-08-12',
      tags: ['Luxury', 'Buyer'],
      buyer: { priceMin: 500_000, priceMax: 900_000, timeline: 'This fall' },
    });
    const other = contact('2', 'warm', { city: 'Orlando', tags: ['Seller'] });
    const result = applySmartListDefinition([other, match], definition([
      { field: 'query', operator: 'contains', value: 'Jose' },
      { field: 'leadType', operator: 'eq', value: 'hot' },
      { field: 'city', operator: 'contains', value: 'miami' },
      { field: 'buyer.priceMin', operator: 'min', value: 400_000 },
      { field: 'buyer.priceMax', operator: 'max', value: 1_000_000 },
      { field: 'tags', operator: 'all', value: ['luxury', 'buyer'] },
      { field: 'nextTouchAt', operator: 'on', value: '2026-08-12' },
    ]));
    expect(result.map((item) => item.id)).toEqual(['1']);
  });

  it('orders every result beyond 500 deterministically without truncation', () => {
    const contacts = Array.from({ length: 510 }, (_, index) => contact(
      String(index + 1),
      index % 3 === 0 ? 'nurture' : index % 3 === 1 ? 'warm' : 'hot',
    ));
    const result = applySmartListDefinition(contacts.reverse(), definition());
    expect(result).toHaveLength(510);
    expect(result.slice(0, 3).every((item) => item.leadType === 'hot')).toBe(true);
    expect(applySmartListDefinition([...contacts].reverse(), definition()).map((item) => item.id))
      .toEqual(result.map((item) => item.id));
  });

  it('fails closed when an exhaustive evaluation exceeds its explicit memory bound', () => {
    const contacts = Array.from(
      { length: SMART_LIST_EVALUATION_INPUT_MAX + 1 },
      (_, index) => contact(String(index + 1), 'warm'),
    );
    expect(() => applySmartListDefinition(contacts, definition()))
      .toThrow(/at most 10,000 contacts.*bounded pagination/i);
  });

  it('supports explicit name sorting with a stable ID tie-breaker', () => {
    const parsed = parseSmartListDefinition({
      ...definition(),
      sort: { field: 'name', direction: 'desc' },
    });
    expect(applySmartListDefinition([
      contact('1', 'nurture', { firstName: 'Amy' }),
      contact('2', 'hot', { firstName: 'Zed' }),
    ], parsed).map((item) => item.id)).toEqual(['2', '1']);
  });

  it('archives and restores without destructive deletion', () => {
    const list: SmartList = {
      id: 'list-1', workspaceId: 'workspace-a', name: 'Hot', definition: parseSmartListDefinition(definition()),
      status: 'active', createdByMembershipId: 'member-a', createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    const archived = archiveSmartList(list, 'member-a', '2026-08-12T00:00:00.000Z', 'cleanup');
    expect(archived).toMatchObject({ noOp: false, list: { status: 'archived', archiveReason: 'cleanup' } });
    expect(archiveSmartList(archived.list, 'member-a', '2026-08-13T00:00:00.000Z').noOp).toBe(true);
    expect(restoreSmartList(archived.list, '2026-08-14T00:00:00.000Z'))
      .toMatchObject({ noOp: false, list: { status: 'active' } });
  });
});
