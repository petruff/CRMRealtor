#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOmnixCopilotExecutor } from '../lib/application/omnix-copilot-service.ts';
import { createAuthenticatedCliContext } from '../lib/data/authenticated-cli-context.ts';
import type { MailerRepository } from '../lib/data/mailer-repository.ts';
import { createMemoryActivityRepository } from '../lib/data/memory-activity-repository.ts';
import { memoryMailerRepository } from '../lib/data/memory-mailer-repository.ts';
import type { ContactRepository } from '../lib/data/repository.ts';
import { supabaseActivityRepository } from '../lib/data/supabase-activity-repository.ts';
import { supabaseRepository } from '../lib/data/supabase-repository.ts';
import { supabaseContactIdentityMap } from '../lib/data/supabase-contact-identity-map.ts';
import { supabaseTransactionRepository } from '../lib/data/supabase-transaction-repository.ts';
import { supabasePropertyRepository } from '../lib/data/supabase-property-repository.ts';
import { supabaseNurturePlanRepository } from '../lib/data/supabase-nurture-plan-repository.ts';
import { supabaseOmnixProposalRepository } from '../lib/data/supabase-omnix-proposal-repository.ts';
import { supabaseCaptureOutcomeRepository } from '../lib/data/supabase-capture-outcome-repository.ts';
import type { Contact } from '../lib/domain/contact.ts';
import type { MailerCampaign, MailerSend } from '../lib/domain/mailer.ts';
import { SAMPLE_WORKSPACE_SCOPE } from '../lib/domain/workspace.ts';
import type { OmnixCopilotExecutor } from '../lib/domain/omnix-copilot.ts';
import type { OmnixCopilotTelemetrySink } from '../lib/observability/omnix-copilot-telemetry.ts';
import { runOmnixCopilotCli } from './omnix-copilot-cli.ts';

function sampleContactRepository(): ContactRepository {
  const base: Omit<Contact, 'id' | 'firstName' | 'lastName'> = {
    leadType: 'warm', relationship: 'lead', intent: 'unknown', source: 'referral',
    pipelineStage: 'new', tags: [], createdAt: '2026-08-01T12:00:00.000Z', emailSubscribed: true,
  };
  const contacts: Contact[] = [
    {
      ...base, id: 'contact-sample-1', firstName: 'Alicia', lastName: 'Monroe', leadType: 'hot',
      phone: '4045550101', source: 'open-house',
    },
    {
      ...base, id: 'contact-sample-2', firstName: 'Daniel', lastName: 'Okafor',
      lastContactedAt: '2026-08-01T12:00:00.000Z', nextTouchAt: '2026-08-10',
    },
    {
      ...base, id: 'contact-sample-3', firstName: 'Marisol', lastName: 'Reyes',
      pipelineStage: 'under-contract', lastContactedAt: '2026-08-10T12:00:00.000Z',
    },
  ];
  return {
    async list() { return contacts.map((contact) => ({ ...contact })); },
    async get(id) { return contacts.find((contact) => contact.id === id); },
    async create() { throw new Error('Writes are unavailable in Omnix copilot sample mode.'); },
    async update() { throw new Error('Writes are unavailable in Omnix copilot sample mode.'); },
    async remove() { throw new Error('Writes are unavailable in Omnix copilot sample mode.'); },
    async notesFor() { return []; },
    async addNote() { throw new Error('Writes are unavailable in Omnix copilot sample mode.'); },
  };
}

function sampleRepositoryContext() {
  const repository = sampleContactRepository();
  return {
    repository,
    workspaceScope: SAMPLE_WORKSPACE_SCOPE,
    isLive: false,
    activityRepository: createMemoryActivityRepository({
      activeMembershipIds: [SAMPLE_WORKSPACE_SCOPE.membershipId],
    }),
    mailerRepository: memoryMailerRepository(repository),
  } as const;
}

function liveReadOnlyMailerRepository(
  client: SupabaseClient,
  workspaceId: string,
): MailerRepository {
  return {
    async list() {
      const { data: mailers, error: mailerError } = await client
        .from('mailers')
        .select('id, name, notes, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });
      if (mailerError) throw new Error(`Failed to load mailer campaigns: ${mailerError.message}`);
      const rows = (mailers ?? []) as Array<{
        id: string; name: string; notes: string | null; created_at: string;
      }>;
      if (rows.length === 0) return [];
      const { data: sends, error: sendsError } = await client
        .from('mailer_sends')
        .select('mailer_id, contact_id, sent_on')
        .eq('workspace_id', workspaceId)
        .in('mailer_id', rows.map((row) => row.id))
        .order('sent_on', { ascending: false });
      if (sendsError) throw new Error(`Failed to load mailer sends: ${sendsError.message}`);
      const sendRows = (sends ?? []) as Array<{
        mailer_id: string; contact_id: string; sent_on: string;
      }>;
      return rows.map((row): MailerCampaign => ({
        id: row.id,
        name: row.name,
        ...(row.notes ? { notes: row.notes } : {}),
        createdAt: row.created_at,
        sends: sendRows
          .filter((send) => send.mailer_id === row.id)
          .map((send): MailerSend => ({
            mailerId: send.mailer_id,
            contactId: send.contact_id,
            sentOn: send.sent_on,
          })),
      }));
    },
    async create() { throw new Error('Writes are unavailable through Omnix copilot.'); },
    async markSent() { throw new Error('Writes are unavailable through Omnix copilot.'); },
    async unmarkSent() { throw new Error('Writes are unavailable through Omnix copilot.'); },
  };
}

async function liveRepositoryContext() {
  const { client, scope } = await createAuthenticatedCliContext();
  const contactIdentityMap = supabaseContactIdentityMap(client);
  return {
    repository: supabaseRepository(client, scope, contactIdentityMap),
    contactIdentityMap,
    workspaceScope: scope,
    isLive: true,
    activityRepository: supabaseActivityRepository(client, contactIdentityMap),
    mailerRepository: liveReadOnlyMailerRepository(client, scope.workspaceId),
    transactionRepository: supabaseTransactionRepository(client),
    propertyRepository: supabasePropertyRepository(client),
    nurturePlanRepository: supabaseNurturePlanRepository(client),
    omnixProposalRepository: supabaseOmnixProposalRepository(client),
    captureOutcomeRepository: supabaseCaptureOutcomeRepository(client),
  } as const;
}

export function createDefaultOmnixCopilotCliExecutor(): OmnixCopilotExecutor {
  const telemetry: OmnixCopilotTelemetrySink = (event) => {
    process.stderr.write(`${JSON.stringify(event)}\n`);
  };
  return async (request) => createOmnixCopilotExecutor({
    getRepository: request.dataMode === 'live'
      ? liveRepositoryContext
      : async () => sampleRepositoryContext(),
    ...(process.env.OMNIX_TIME_ZONE ? { timeZone: process.env.OMNIX_TIME_ZONE } : {}),
    telemetry,
  })(request);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runOmnixCopilotCli(process.argv.slice(2), {
    execute: createDefaultOmnixCopilotCliExecutor(),
  }).then((code) => { process.exitCode = code; });
}
