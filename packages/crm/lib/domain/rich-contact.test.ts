import { describe, expect, it } from 'vitest';
import {
  canonicalRelationshipPair,
  normalizeContactEmail,
  normalizeContactPhone,
  parseRelationshipKind,
  validateCustomFieldValue,
  type CustomFieldDefinition,
} from './rich-contact';

const definition = (type: CustomFieldDefinition['type'], options: readonly string[] = []): CustomFieldDefinition => ({
  id: 'definition-a', workspaceId: 'workspace-a', name: 'Preference', type, options,
  displayOrder: 0, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
});

describe('rich contact domain', () => {
  it('normalizes legacy-compatible phone and email values without workspace-wide identity claims', () => {
    expect(normalizeContactPhone('+1 (614) 555-0100')).toEqual({
      displayValue: '+1 (614) 555-0100', normalizedValue: '6145550100',
    });
    expect(normalizeContactEmail(' Ada@Example.COM ')).toEqual({
      displayValue: 'Ada@Example.COM', normalizedValue: 'ada@example.com',
    });
    expect(() => normalizeContactPhone('123')).toThrow(/invalid/i);
    expect(() => normalizeContactEmail('not-an-email')).toThrow(/invalid/i);
  });

  it('canonicalizes relationship pairs and enforces other-label semantics', () => {
    expect(canonicalRelationshipPair('contact-z', 'contact-a')).toEqual(['contact-a', 'contact-z']);
    expect(() => canonicalRelationshipPair('contact-a', 'contact-a')).toThrow(/themselves/);
    expect(parseRelationshipKind('other', 'Attorney')).toEqual({ kind: 'other', label: 'Attorney' });
    expect(() => parseRelationshipKind('spouse', 'Partner')).toThrow(/cannot have/);
  });

  it('validates typed custom values and rejects archived definitions', () => {
    expect(validateCustomFieldValue(definition('number'), 42)).toBe(42);
    expect(validateCustomFieldValue(definition('date'), '2026-08-11')).toBe('2026-08-11');
    expect(validateCustomFieldValue(definition('single-select', ['A', 'B']), 'A')).toBe('A');
    expect(() => validateCustomFieldValue(definition('single-select', ['A']), 'B')).toThrow(/allowed option/);
    expect(() => validateCustomFieldValue({ ...definition('text'), archivedAt: '2026-08-11T00:00:00.000Z' }, 'x'))
      .toThrow(/Archived/);
  });
});
