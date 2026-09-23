import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOmnixProviderServerGateway, omnixProviderDraftId } from './omnix-provider-gateway';
import { createGoogleEmailDraft, prepareGoogleEmailDraftIntent } from '../data/google-draft-repository';
import { SAMPLE_WORKSPACE_SCOPE } from '../domain/workspace';
import { captureCommunicationBlocked, validateCaptureDraftLanguage } from './capture-outcome-operations';
import { stablePayloadHash } from '../domain/connector';
import { createGoogleRawTextMessage } from '../domain/google-connector';
vi.mock('../data/google-draft-repository', () => ({ createGoogleEmailDraft: vi.fn(), prepareGoogleEmailDraftIntent: vi.fn() }));
vi.mock('../data/supabase-google-operation-repository', () => ({ supabaseGoogleOperationRepository: () => ({ readCapabilityState: async () => ({}) }) }));
vi.mock('./google-email-readiness', () => ({ googleEmailReadiness: () => ({ ready: true }) }));
vi.mock('../data/supabase-contact-outbound-guard', () => ({ supabaseContactOutboundGuard: () => ({ assertTarget: async () => ({}) }) }));
const scope = { ...SAMPLE_WORKSPACE_SCOPE, mode: 'live' as const };
const connection = { id: 'google-1', workspaceId: scope.workspaceId, provider: 'google', status: 'active', remoteAccountLabel: 'owner@example.test', grantedScopes: ['https://www.googleapis.com/auth/gmail.send'], updatedAt: '2026-09-07T12:00:00Z' };
const point = { id: 'email-1', workspaceId: scope.workspaceId, contactId: 'contact-1', type: 'email', normalizedValue: 'client@example.test', isPrimary: true, emailSubscribed: true, updatedAt: '2026-09-07T12:00:00Z' };
const input = { proposalId: 'proposal-1', version: 1, kind: 'google-email-draft' as const, contactId: 'contact-1', rationale: 'Reviewed follow-up', correlationId: 'correlation-1', occurredAt: '2026-09-07T15:00:00Z',
  payload: { captureExactTarget: true, contactId: 'contact-1', connectionId: connection.id, connectionVersion: connection.updatedAt, sender: connection.remoteAccountLabel, contactPointId: point.id, contactPointVersion: point.updatedAt, recipient: point.normalizedValue, subject: 'Our next steps', body: 'Thank you for sharing your preferences.' } };
function fixture(overrides: { point?: object; contact?: object; connection?: object; receipt?: object; job?: object } = {}) {
  const context = { isLive: true, workspaceScope: scope, repository: { get: async () => ({ id: 'contact-1', emailSubscribed: true, ...overrides.contact }) }, richContactRepository: { listContactPoints: async () => [{ ...point, ...overrides.point }] }, connectorRepository: { listConnections: async () => [{ ...connection, ...overrides.connection }] }, activityRepository: {} };
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: overrides.receipt ?? null, error: null }) };
  return createOmnixProviderServerGateway(context as unknown as Parameters<typeof createOmnixProviderServerGateway>[0], { from: (table: string) => table === 'connector_jobs' ? { ...query, select: () => ({ ...query, eq: () => ({ ...query, eq: () => ({ maybeSingle: async () => ({ data: overrides.job ?? null, error: null }) }) }) }) } : query } as unknown as SupabaseClient);
}
describe('Capture provider gateway exact preparation', () => {
  it.each(['targetResolutionRequired', 'audienceReviewRequired'])('rejects unresolved %s before any provider or recipient lookup', async (flag) => {
    const lookup = vi.fn();
    const context = { isLive: true, connectorRepository: { listConnections: lookup }, richContactRepository: { listContactPoints: lookup } };
    const gateway = createOmnixProviderServerGateway(context as unknown as Parameters<typeof createOmnixProviderServerGateway>[0], {} as SupabaseClient);
    await expect(gateway.prepare({ ...input, kind: flag === 'audienceReviewRequired' ? 'mailchimp-campaign-draft' : 'google-email-draft', payload: { ...input.payload, [flag]: true } })).rejects.toThrow('Review the exact');
    expect(lookup).not.toHaveBeenCalled();
    expect(createGoogleEmailDraft).not.toHaveBeenCalled();
  });
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(prepareGoogleEmailDraftIntent).mockResolvedValue({ intent: { id: 'intent-1', current_version: 1 }, noOp: false }); });
  it('uses a stable draft identity for repeated canonical handoff and never sends', async () => {
    const gateway = fixture();
    expect(await gateway.prepare(input)).toEqual({ executionReference: 'connector-intent:intent-1' });
    expect(await gateway.prepare({ ...input, occurredAt: '2026-09-08T10:00:00Z' })).toEqual({ executionReference: 'connector-intent:intent-1' });
    const calls = vi.mocked(createGoogleEmailDraft).mock.calls;
    expect(calls[0]![0].draftId).toBe(calls[1]![0].draftId);
    expect(calls[0]![0].to).toBe(point.normalizedValue);
    expect(calls[0]![0].draftId).toMatch(/^[a-f0-9-]{36}$/);
    expect(omnixProviderDraftId('proposal-1', 1)).not.toBe(omnixProviderDraftId('proposal-1', 2));
    expect(prepareGoogleEmailDraftIntent).toHaveBeenCalledTimes(2);
  });
  it.each([{ point: { normalizedValue: 'other@example.test' } }, { point: { emailSubscribed: false } }, { contact: { emailSubscribed: false } }, { connection: { remoteAccountLabel: 'other-owner@example.test' } }])('refuses changed or suppressed recipient/sender: %j', async (changes) => {
    await expect(fixture(changes).prepare(input)).rejects.toBeInstanceOf(Error);
    expect(createGoogleEmailDraft).not.toHaveBeenCalled();
  });
  it('recovers an existing prepared receipt after a recipient change without preparing another intent', async () => {
    const overrides: { point?: object; contact?: object; receipt?: object } = {};
    const gateway = fixture(overrides); await gateway.prepare(input);
    const saved = vi.mocked(createGoogleEmailDraft).mock.calls[0]![0];
    const clientMessageId = `${stablePayloadHash({ workspaceId: scope.workspaceId, connectionId: saved.connectionId, draftId: saved.draftId })}@omnix.local`;
    overrides.receipt = { current_version: 1, status: 'intent-prepared', prepared_intent_id: 'intent-1', current_payload_hash: stablePayloadHash({ schemaVersion: 'google-gmail-send.v1', contactId: saved.contactId, contactPointId: saved.contactPointId, normalizedRecipient: saved.to.toLowerCase(), clientMessageId, rawMessageBase64Url: createGoogleRawTextMessage({ from: saved.from, to: saved.to, subject: saved.subject, body: saved.body, clientMessageId }) }) };
    overrides.point = { normalizedValue: 'changed@example.test' }; overrides.contact = { emailSubscribed: false };
    expect(await gateway.prepare(input)).toEqual({ executionReference: 'connector-intent:intent-1' });
    expect(createGoogleEmailDraft).toHaveBeenCalledTimes(1); expect(prepareGoogleEmailDraftIntent).toHaveBeenCalledTimes(1);
  });
  it.each(['Do not\nemail me.', 'Don’t email me.', 'Stop texting.', 'Please unsubscribe.'])('recognizes explicit opt-out across punctuation and whitespace: %s', (source) => {
    expect(captureCommunicationBlocked(source)).toBe(true);
  });
  it('recovers an already sent draft through its original connector job without preparing again', async () => {
    const draftId = omnixProviderDraftId(input.proposalId, input.version);
    const clientMessageId = `${stablePayloadHash({ workspaceId: scope.workspaceId, connectionId: input.payload.connectionId, draftId })}@omnix.local`;
    const hash = stablePayloadHash({ schemaVersion: 'google-gmail-send.v1', contactId: input.contactId, contactPointId: point.id,
      normalizedRecipient: point.normalizedValue, clientMessageId, rawMessageBase64Url: createGoogleRawTextMessage({ from: connection.remoteAccountLabel, to: point.normalizedValue, subject: input.payload.subject, body: input.payload.body, clientMessageId }) });
    const gateway = fixture({ contact: { emailSubscribed: false }, receipt: { current_version: 1, current_payload_hash: hash, status: 'sent', sent_job_id: 'job-1' }, job: { intent_id: 'original-intent' } });
    expect(await gateway.prepare(input)).toEqual({ executionReference: 'connector-intent:original-intent' });
    expect(createGoogleEmailDraft).not.toHaveBeenCalled(); expect(prepareGoogleEmailDraftIntent).not.toHaveBeenCalled();
  });
  it('recovers the original Calendar intent without reading a subsequently changed task', async () => {
    const payload = { captureExactTarget: true, taskId: 'task-1', taskVersion: 2, title: 'Reviewed showing', startAt: '2026-09-09T14:00:00.000Z', endAt: '2026-09-09T15:00:00.000Z', timeZone: 'America/New_York' };
    const resourceKey = stablePayloadHash({ workspaceId: scope.workspaceId, taskId: payload.taskId });
    const payloadHash = stablePayloadHash({ schemaVersion: 'google-calendar-task.v1', taskId: payload.taskId, taskVersion: payload.taskVersion, title: payload.title, startAt: payload.startAt, endAt: payload.endAt, timeZone: payload.timeZone, resourceKey, eventId: resourceKey.slice(0, 32) });
    expect(await fixture({ receipt: { intent_id: 'calendar-original', payload_hash: payloadHash } }).prepare({ ...input, kind: 'google-calendar-event', payload })).toEqual({ executionReference: 'connector-intent:calendar-original' });
    await expect(fixture({ receipt: { intent_id: 'calendar-original', payload_hash: payloadHash } }).prepare({ ...input, kind: 'google-calendar-event', payload: { ...payload, startAt: '2026-09-09T13:00:00.000Z' } })).rejects.toThrow('does not match');
  });
  it('blocks deterministic discriminatory draft instructions', () => {
    expect(() => validateCaptureDraftLanguage('Find a white-only neighborhood.')).toThrow('discriminatory');
    expect(() => validateCaptureDraftLanguage('Send the agreed listing details.')).not.toThrow();
  });
});
