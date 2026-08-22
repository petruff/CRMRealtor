import { convertIncompleteRecordCommand } from './incomplete-record-commands.ts';
import type { MetaReviewContext } from './meta-review-service.ts';
import { ConnectorError } from '../domain/connector.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { IncompleteRecordRepository } from '../data/incomplete-record-repository.ts';
import type { MetaReviewResolutionRepository } from '../data/meta-operation-repository.ts';

export interface ConvertMetaReviewRecordInput {
  readonly scope: WorkspaceScope;
  readonly incompleteRecordRepository: IncompleteRecordRepository;
  readonly metaReviewRepository: MetaReviewResolutionRepository;
  readonly readReviewContext: () => Promise<MetaReviewContext>;
  readonly recordId: string;
  readonly eventId: string;
  readonly correction: unknown;
  readonly correlationId: string;
  readonly now?: Date;
}

/**
 * Converts the quarantined identity first, then links the exact Meta event.
 * Both persistence operations are replay-safe. If the second operation is
 * interrupted, retrying reuses the immutable conversion receipt before
 * completing the event/identity/conversation link.
 */
export async function convertMetaReviewRecord(
  input: ConvertMetaReviewRecordInput,
) {
  const scope = validateWorkspaceScope(input.scope);
  if (scope.mode !== 'live') {
    throw new ConnectorError(
      'forbidden',
      'Meta enquiries can only be resolved in an authenticated live workspace.',
    );
  }

  const context = await input.readReviewContext();
  if (
    context.eventId !== input.eventId
    || context.incompleteRecordId !== input.recordId
  ) {
    throw new ConnectorError(
      'conflict',
      'The Meta enquiry no longer matches this incomplete record.',
    );
  }

  const conversion = await convertIncompleteRecordCommand(
    input.incompleteRecordRepository,
    scope,
    input.recordId,
    {
      correction: input.correction,
      idempotencyKey: `meta-review-conversion:${input.eventId}`,
    },
    input.now,
  );
  const resolution = await input.metaReviewRepository.resolveReview(scope, {
    eventId: input.eventId,
    contactId: conversion.contactId,
    correlationId: input.correlationId,
  });

  return {
    ...conversion,
    reviewNoOp: resolution.noOp,
  };
}
