import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailerCampaign, MailerSend } from '../domain/mailer.ts';
import { validateWorkspaceScope, type WorkspaceScope } from '../domain/workspace.ts';
import type { MailerRepository } from './mailer-repository';
import { supabaseContactOutboundGuard } from './supabase-contact-outbound-guard.ts';

interface MailerRow {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
}

interface MailerSendRow {
  mailer_id: string;
  contact_id: string;
  sent_on: string;
}

function sendToDomain(row: MailerSendRow): MailerSend {
  return { mailerId: row.mailer_id, contactId: row.contact_id, sentOn: row.sent_on };
}

export function supabaseMailerRepository(
  supabase: SupabaseClient,
  untrustedScope: WorkspaceScope,
): MailerRepository {
  const scope = validateWorkspaceScope(untrustedScope);
  if (scope.mode !== 'live') throw new Error('Supabase repositories require a live workspace scope.');
  const outboundGuard = supabaseContactOutboundGuard(supabase);

  async function requireTargets(mailerId: string, contactId: string) {
    const [{ data: mailer, error: mailerError }, { data: contact, error: contactError }] =
      await Promise.all([
        supabase
          .from('mailers')
          .select('id')
          .eq('id', mailerId)
          .eq('workspace_id', scope.workspaceId)
          .maybeSingle(),
        supabase
          .from('contacts')
          .select('id')
          .eq('id', contactId)
          .eq('workspace_id', scope.workspaceId)
          .maybeSingle(),
      ]);
    if (mailerError) throw new Error(`Failed to verify mailer campaign: ${mailerError.message}`);
    if (contactError) throw new Error(`Failed to verify contact: ${contactError.message}`);
    if (!mailer) throw new Error('Mailer campaign not found.');
    if (!contact) throw new Error('Contact not found.');
  }

  return {
    async list() {
      const { data: mailers, error: mailerError } = await supabase
        .from('mailers')
        .select('id, name, notes, created_at')
        .eq('workspace_id', scope.workspaceId)
        .order('created_at', { ascending: false });
      if (mailerError) throw new Error(`Failed to load mailer campaigns: ${mailerError.message}`);

      const rows = (mailers ?? []) as MailerRow[];
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);
      const { data: sends, error: sendsError } = await supabase
        .from('mailer_sends')
        .select('mailer_id, contact_id, sent_on')
        .eq('workspace_id', scope.workspaceId)
        .in('mailer_id', ids)
        .order('sent_on', { ascending: false });
      if (sendsError) throw new Error(`Failed to load mailer sends: ${sendsError.message}`);

      const sendRows = (sends ?? []) as MailerSendRow[];
      return rows.map(
        (row): MailerCampaign => ({
          id: row.id,
          name: row.name,
          notes: row.notes ?? undefined,
          createdAt: row.created_at,
          sends: sendRows.filter((send) => send.mailer_id === row.id).map(sendToDomain),
        }),
      );
    },

    async create(input) {
      const { data, error } = await supabase
        .from('mailers')
        .insert({
          workspace_id: scope.workspaceId,
          owner_id: scope.ownerUserId,
          name: input.name,
          notes: input.notes ?? null,
        })
        .select('id, name, notes, created_at')
        .single();
      if (error) throw new Error(`Failed to create mailer campaign: ${error.message}`);
      const row = data as MailerRow;
      return {
        id: row.id,
        name: row.name,
        notes: row.notes ?? undefined,
        createdAt: row.created_at,
        sends: [],
      };
    },

    async markSent(mailerId, contactId, sentOn) {
      const reviewedTarget = await outboundGuard.assertTarget(scope, contactId);
      await requireTargets(mailerId, contactId);
      await outboundGuard.assertTarget(scope, contactId, undefined, reviewedTarget.aliasEpoch);
      const { data, error } = await supabase
        .from('mailer_sends')
        .upsert(
          {
            mailer_id: mailerId,
            contact_id: contactId,
            workspace_id: scope.workspaceId,
            owner_id: scope.ownerUserId,
            sent_on: sentOn,
          },
          { onConflict: 'mailer_id,contact_id', ignoreDuplicates: true },
        )
        .select('mailer_id, contact_id, sent_on')
        .maybeSingle();
      if (error) throw new Error(`Failed to mark mailer sent: ${error.message}`);
      if (data) return sendToDomain(data as MailerSendRow);

      const { data: existing, error: existingError } = await supabase
        .from('mailer_sends')
        .select('mailer_id, contact_id, sent_on')
        .eq('mailer_id', mailerId)
        .eq('contact_id', contactId)
        .eq('workspace_id', scope.workspaceId)
        .single();
      if (existingError) throw new Error(`Failed to load existing mailer send: ${existingError.message}`);
      return sendToDomain(existing as MailerSendRow);
    },

    async unmarkSent(mailerId, contactId) {
      await requireTargets(mailerId, contactId);
      const { error } = await supabase
        .from('mailer_sends')
        .delete()
        .eq('mailer_id', mailerId)
        .eq('contact_id', contactId)
        .eq('workspace_id', scope.workspaceId);
      if (error) throw new Error(`Failed to clear mailer send: ${error.message}`);
    },
  };
}
