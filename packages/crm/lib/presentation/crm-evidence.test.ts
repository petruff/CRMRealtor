import { describe, expect, it } from 'vitest';
import {
  alertCategoryLabel,
  evidenceEntityLabel,
  evidenceFactLabel,
  evidenceFactSummary,
  evidenceTimestamp,
} from '@/lib/presentation/crm-evidence';

describe('CRM evidence presentation', () => {
  it('turns internal CRM identifiers into plain-language labels', () => {
    expect(evidenceEntityLabel('contact')).toBe('Contact record');
    expect(evidenceFactLabel('lastContactedAt')).toBe('last contact');
    expect(evidenceFactLabel('customFollowUpField')).toBe('custom follow up field');
    expect(alertCategoryLabel('follow-up')).toBe('Follow-up');
  });

  it('deduplicates facts and joins them as a natural sentence', () => {
    expect(evidenceFactSummary([
      'pipelineStage', 'lastContactedAt', 'createdAt', 'leadType', 'source', 'source',
    ])).toBe('pipeline stage, last contact, date added, lead temperature, and lead source');
  });

  it('formats valid timestamps and safely omits invalid values', () => {
    expect(evidenceTimestamp('2026-08-20T17:54:45.764Z', 'America/New_York')).toBe('Aug 20, 2026, 1:54 PM');
    expect(evidenceTimestamp('not-a-date')).toBeUndefined();
  });
});
