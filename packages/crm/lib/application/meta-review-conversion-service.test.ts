import { describe, expect, it, vi } from 'vitest';
import { createMemoryIncompleteRecordRepository } from '../data/memory-incomplete-record-repository.ts';
import { createIncompleteRecordCommand } from './incomplete-record-commands.ts';
import { convertMetaReviewRecord } from './meta-review-conversion-service.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';

const liveScope = { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' as const };

describe('convertMetaReviewRecord', () => {
  it('converts once and links the exact Meta review to the resulting contact', async () => {
    const incompleteRecordRepository = createMemoryIncompleteRecordRepository();
    const record = await createIncompleteRecordCommand(
      incompleteRecordRepository,
      liveScope,
      {
        source: 'meta-live',
        candidate: { firstName: 'Ada', email: 'ada@example.com' },
        reasons: ['Meta identity requires review.'],
      },
      new Date('2026-08-12T12:00:00.000Z'),
    );
    const resolveReview = vi.fn().mockResolvedValue({ noOp: false });

    const result = await convertMetaReviewRecord({
      scope: liveScope,
      incompleteRecordRepository,
      metaReviewRepository: { resolveReview },
      readReviewContext: async () => ({
        eventId: 'event-a',
        incompleteRecordId: record.id,
        attachmentTypes: [],
        providerOccurredAt: '2026-08-12T11:59:00.000Z',
        sourceReference: 'source-a',
      }),
      recordId: record.id,
      eventId: 'event-a',
      correction: {},
      correlationId: 'correlation-a',
      now: new Date('2026-08-12T12:01:00.000Z'),
    });

    expect(result).toMatchObject({ action: 'create', reviewNoOp: false });
    expect(resolveReview).toHaveBeenCalledWith(
      liveScope,
      expect.objectContaining({ eventId: 'event-a', contactId: result.contactId }),
    );
  });

  it('fails before conversion when the event and quarantine record do not match', async () => {
    const incompleteRecordRepository = createMemoryIncompleteRecordRepository();
    const record = await createIncompleteRecordCommand(
      incompleteRecordRepository,
      liveScope,
      {
        source: 'meta-live',
        candidate: { firstName: 'Ada' },
        reasons: ['Review.'],
      },
    );
    const resolveReview = vi.fn();

    await expect(convertMetaReviewRecord({
      scope: liveScope,
      incompleteRecordRepository,
      metaReviewRepository: { resolveReview },
      readReviewContext: async () => ({
        eventId: 'event-other',
        incompleteRecordId: record.id,
        attachmentTypes: [],
        providerOccurredAt: '2026-08-12T11:59:00.000Z',
        sourceReference: 'source-a',
      }),
      recordId: record.id,
      eventId: 'event-a',
      correction: {},
      correlationId: 'correlation-a',
    })).rejects.toMatchObject({ code: 'conflict' });
    expect((await incompleteRecordRepository.get(liveScope, record.id))?.status)
      .toBe('pending');
    expect(resolveReview).not.toHaveBeenCalled();
  });

  it('reuses the immutable conversion when linking is retried after an interruption', async () => {
    const incompleteRecordRepository = createMemoryIncompleteRecordRepository();
    const record = await createIncompleteRecordCommand(
      incompleteRecordRepository,
      liveScope,
      {
        source: 'meta-live',
        candidate: { firstName: 'Ada', email: 'ada@example.com' },
        reasons: ['Review.'],
      },
    );
    const context = async () => ({
      eventId: 'event-a',
      incompleteRecordId: record.id,
      attachmentTypes: [] as readonly string[],
      providerOccurredAt: '2026-08-12T11:59:00.000Z',
      sourceReference: 'source-a',
    });
    const firstResolution = vi.fn().mockRejectedValue(new Error('connection lost'));
    await expect(convertMetaReviewRecord({
      scope: liveScope,
      incompleteRecordRepository,
      metaReviewRepository: { resolveReview: firstResolution },
      readReviewContext: context,
      recordId: record.id,
      eventId: 'event-a',
      correction: {},
      correlationId: 'correlation-a',
    })).rejects.toThrow('connection lost');
    const converted = await incompleteRecordRepository.get(liveScope, record.id);
    expect(converted).toMatchObject({ status: 'converted' });

    const secondResolution = vi.fn().mockResolvedValue({ noOp: false });
    const retry = await convertMetaReviewRecord({
      scope: liveScope,
      incompleteRecordRepository,
      metaReviewRepository: { resolveReview: secondResolution },
      readReviewContext: context,
      recordId: record.id,
      eventId: 'event-a',
      correction: {},
      correlationId: 'correlation-b',
    });
    expect(retry).toMatchObject({ contactId: converted?.convertedContactId, noOp: true });
    expect(secondResolution).toHaveBeenCalledWith(
      liveScope,
      expect.objectContaining({ contactId: converted?.convertedContactId }),
    );
  });
});
