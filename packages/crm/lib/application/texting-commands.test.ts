import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace.ts';
import type { TwilioOperationRepository } from '../data/twilio-operation-repository.ts';
import { approveTextingIntentCommand, prepareTextingMessageCommand, recordTextingConsentCommand } from './texting-commands.ts';

const id = '11111111-1111-4111-8111-111111111111';

function repository(): TwilioOperationRepository {
  return {
    readReadiness: vi.fn(), readContactSummary: vi.fn(),
    recordConsent: vi.fn(async () => ({ noOp: false, canceledJobs: 0 })),
    createDraftAndIntent: vi.fn(async () => ({ draftId: id, draftVersion: 1, intentId: id, intentVersion: 1 })),
    approvePreparedIntent: vi.fn(async () => ({ jobId: id, noOp: false })),
    requestRealNumberUat: vi.fn(async () => ({ jobId: id, noOp: false })), disable: vi.fn(),
  };
}

describe('texting commands', () => {
  const outboundGuard = { assertTarget: vi.fn(async (_scope, contactId: string, contactPointId?: string) => ({
    contactId, contactPointId, aliasEpoch: 7,
  })) };
  it('requires explicit evidence instead of inferring consent', async () => {
    const target = repository();
    await recordTextingConsentCommand(target, { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' }, {
      connectionId: id, contactId: id, contactPointId: id, useCase: 'realtor.follow-up',
      status: 'opted_in', collectionMethod: 'documented-web-form', disclosureVersion: 'disclosure-v1',
      evidenceReference: 'signed-consent-record', recipientTimeZone: 'America/New_York', timezoneSource: 'verified-address',
    });
    expect(target.recordConsent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'opted_in' }));
    await expect(recordTextingConsentCommand(target, { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' }, {
      connectionId: id, contactId: id, contactPointId: id, useCase: 'realtor.follow-up',
      status: 'opted_in', collectionMethod: 'imported-tag', disclosureVersion: 'disclosure-v1', evidenceReference: '',
    })).rejects.toThrow('evidenceReference');
  });

  it('rejects a non-IANA consent timezone before persistence', async () => {
    const target = repository();
    await expect(recordTextingConsentCommand(target, { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' }, {
      connectionId: id, contactId: id, contactPointId: id, useCase: 'realtor.follow-up',
      status: 'opted_in', collectionMethod: 'documented-web-form', disclosureVersion: 'disclosure-v1',
      evidenceReference: 'signed-consent-record', recipientTimeZone: 'Mars/Olympus', timezoneSource: 'verified-address',
    })).rejects.toThrow(/IANA timezone/i);
    expect(target.recordConsent).not.toHaveBeenCalled();
  });

  it('prepares an encrypted provider intent without sending', async () => {
    const target = repository();
    await prepareTextingMessageCommand(target, { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' }, {
      connectionId: id, contactId: id, contactPointId: id, recipientPhone: '+12025550123',
      useCase: 'realtor.follow-up', body: 'Checking in about your home search.',
    }, outboundGuard);
    expect(target.createDraftAndIntent).toHaveBeenCalledOnce();
    expect(target.createDraftAndIntent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reviewedAliasEpoch: 7,
    }));
  });

  it('keeps specialized approval owner-only', async () => {
    const target = repository();
    await expect(approveTextingIntentCommand(target, {
      ...SAMPLE_WORKSPACE_SCOPE, role: 'assistant', mode: 'live',
    }, { intentId: id, intentVersion: 1, payloadHash: 'a'.repeat(64) })).rejects.toThrow('Only the workspace owner');
  });
});
