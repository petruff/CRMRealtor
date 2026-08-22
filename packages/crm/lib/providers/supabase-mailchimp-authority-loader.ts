import type { ConnectorJob } from '../domain/connector.ts';
import type { MailchimpMemberOperation } from '../domain/mailchimp.ts';
import type { SupabaseMailchimpJobAuthorityReader } from '../data/supabase-mailchimp-worker-authority.ts';
import {
  createEnvironmentKekResolver,
  decryptConnectorSecret,
  type ConnectorKekResolver,
} from '../security/connector-secret-envelope.ts';
import { ConnectorError, stablePayloadHash } from '../domain/connector.ts';
import { MailchimpMarketingClient, type MailchimpFetch } from './mailchimp-client.ts';
import type { MailchimpJobAuthorityLoader } from './mailchimp-adapter.ts';

function operation(value: string): MailchimpMemberOperation {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ConnectorError('conflict', 'Mailchimp payload JSON is invalid.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConnectorError('conflict', 'Mailchimp payload is invalid.');
  }
  const row = parsed as Record<string, unknown>;
  const desiredTag = row.desiredTag;
  const reviewedAliasEpoch = Number(row.reviewedAliasEpoch);
  if (!['Omnix: Hot', 'Omnix: Warm', 'Omnix: Nurture'].includes(String(desiredTag))
    || !/^[a-f0-9]{32}$/.test(String(row.subscriberHash))
    || !/^[a-f0-9]{64}$/.test(String(row.operationKey))
    || !Number.isSafeInteger(row.mappingVersion)
    || typeof row.contactId !== 'string' || !row.contactId
    || typeof row.contactPointId !== 'string' || !row.contactPointId
    || !Number.isSafeInteger(reviewedAliasEpoch) || reviewedAliasEpoch < 0) {
    throw new ConnectorError('conflict', 'Mailchimp payload is outside the approved mapping contract.');
  }
  return {
    audienceId: String(row.audienceId), subscriberHash: String(row.subscriberHash),
    desiredTag: desiredTag as MailchimpMemberOperation['desiredTag'],
    mappingVersion: Number(row.mappingVersion), operationKey: String(row.operationKey),
    contactId: row.contactId, contactPointId: row.contactPointId, reviewedAliasEpoch,
  };
}

export function createSupabaseMailchimpAuthorityLoader(input: {
  readonly reader: SupabaseMailchimpJobAuthorityReader;
  readonly resolver?: ConnectorKekResolver;
  readonly fetcher?: MailchimpFetch;
}): MailchimpJobAuthorityLoader {
  return {
    async load(job: ConnectorJob) {
      const encrypted = await input.reader.read(job);
      const resolver = input.resolver ?? createEnvironmentKekResolver();
      const operationValue = decryptConnectorSecret(encrypted.operationEnvelope, {
        workspaceId: job.workspaceId,
        connectionId: encrypted.binding.connectionId,
        provider: 'mailchimp',
        secretType: 'audience.sync',
        recordVersion: encrypted.operationVersion,
      }, resolver);
      const resolved = operation(operationValue);
      const expectedOperationKey = stablePayloadHash({
        audienceId: resolved.audienceId,
        subscriberHash: resolved.subscriberHash,
        desiredTag: resolved.desiredTag,
        mappingVersion: resolved.mappingVersion,
      });
      if (resolved.audienceId !== encrypted.binding.audienceId
        || resolved.mappingVersion !== encrypted.binding.mappingVersion
        || resolved.operationKey !== expectedOperationKey) {
        throw new ConnectorError('conflict', 'Mailchimp operation does not match the selected audience authority.');
      }
      const token = decryptConnectorSecret(encrypted.accessTokenEnvelope, {
        workspaceId: job.workspaceId,
        connectionId: encrypted.binding.connectionId,
        provider: 'mailchimp',
        secretType: 'mailchimp-access-token',
        recordVersion: encrypted.accessTokenVersion,
      }, resolver);
      return {
        operation: resolved,
        client: new MailchimpMarketingClient(encrypted.binding.dataCenter, token, input.fetcher),
      };
    },
  };
}
