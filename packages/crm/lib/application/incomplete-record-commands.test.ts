import { describe, expect, it } from 'vitest';
import { createMemoryIncompleteRecordRepository } from '@/lib/data/memory-incomplete-record-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '@/lib/domain/workspace';
import {
  archiveIncompleteRecordCommand,
  convertIncompleteRecordCommand,
  createIncompleteRecordCommand,
  listIncompleteRecordsCommand,
  previewIncompleteRecordInboxCommand,
  restoreIncompleteRecordCommand,
} from './incomplete-record-commands';

const now = new Date('2026-08-11T12:00:00.000Z');

describe('incomplete record commands', () => {
  it('stores safe projection idempotently and strips raw payload fields', async () => {
    const repository = createMemoryIncompleteRecordRepository();
    const input = {
      source: 'website', intakeIdempotencyKey: 'request-1',
      candidate: { firstName: 'Ana', email: 'broken@', authorization: 'Bearer secret' },
      reasons: ['Email is invalid.'],
    };
    const first = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, input, now);
    const replay = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, input, now);
    expect(replay.id).toBe(first.id);
    expect(JSON.stringify(first)).not.toMatch(/authorization|bearer|secret/i);
    expect(await listIncompleteRecordsCommand(repository, SAMPLE_WORKSPACE_SCOPE)).toHaveLength(1);
  });

  it('previews and converts exactly once into a deterministic contact receipt', async () => {
    const repository = createMemoryIncompleteRecordRepository();
    const incomplete = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      source: 'website', candidate: { email: 'ana@example.com' }, reasons: ['Name required.'],
    }, now);
    const input = { correction: { firstName: 'Ana' }, idempotencyKey: 'convert-1' };
    const first = await convertIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, incomplete.id, input, now);
    const replay = await convertIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, incomplete.id, input, now);
    expect(first).toMatchObject({ contactId: 'contact-0001', action: 'create', noOp: false });
    expect(replay).toMatchObject({ contactId: 'contact-0001', action: 'create', noOp: true });
  });

  it('keeps nameless quarantined records visible when their conversion preview is invalid', async () => {
    const repository = createMemoryIncompleteRecordRepository();
    const nameless = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      source: 'mailchimp-live', candidate: { email: 'subscriber@example.com' }, reasons: ['Name required.'],
    }, now);
    const named = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      source: 'mailchimp-live', candidate: { firstName: 'Ana', email: 'ana@example.com' }, reasons: ['Review.'],
    }, now);

    await expect(previewIncompleteRecordInboxCommand(
      repository,
      SAMPLE_WORKSPACE_SCOPE,
      [nameless, named],
    )).resolves.toMatchObject({
      [nameless.id]: undefined,
      [named.id]: { action: 'create' },
    });
  });

  it('rejects conversion until invalid quarantined contact values are corrected', async () => {
    const repository = createMemoryIncompleteRecordRepository();
    const incomplete = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      source: 'website',
      candidate: { firstName: 'Ana', email: 'broken@' },
      reasons: ['Email is invalid.'],
    }, now);

    await expect(convertIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, incomplete.id, {
      idempotencyKey: 'convert-invalid',
    }, now)).rejects.toMatchObject({
      code: 'invalid-input',
      fieldErrors: { email: 'email is invalid.' },
    });

    await expect(convertIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, incomplete.id, {
      correction: { email: 'ana@example.com' },
      idempotencyKey: 'convert-corrected',
    }, now)).resolves.toMatchObject({ action: 'create', noOp: false });
  });

  it('archives/restores with required actor/reason and rejects conversion while archived', async () => {
    const repository = createMemoryIncompleteRecordRepository();
    const incomplete = await createIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, {
      source: 'website', candidate: { firstName: 'Ana', email: 'broken@' }, reasons: ['Email invalid.'],
    }, now);
    expect((await archiveIncompleteRecordCommand(
      repository, SAMPLE_WORKSPACE_SCOPE, incomplete.id, 'duplicate', now,
    )).record.status).toBe('archived');
    await expect(convertIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, incomplete.id, {
      idempotencyKey: 'convert-1',
    }, now)).rejects.toThrow(/restored/i);
    expect((await restoreIncompleteRecordCommand(repository, SAMPLE_WORKSPACE_SCOPE, incomplete.id, now)).record.status)
      .toBe('pending');
  });
});
