-- Story 4.3 / migration 0015 rollback.
--
-- SAFE WINDOW: this rollback is intentionally pre-write only. Once any Twilio
-- authority, policy, consent, draft, message, callback, reconciliation, secret,
-- payload, intent, job or receipt exists, preserve the evidence and use PITR or
-- a reviewed forward remediation. Never erase consent/STOP or delivery history.

begin;

do $$
begin
  if exists (select 1 from public.twilio_connection_authorities)
     or exists (select 1 from public.twilio_compliance_policies)
     or exists (select 1 from public.texting_consent_events)
     or exists (select 1 from public.texting_consent_states)
     or exists (select 1 from public.texting_phone_suppressions)
     or exists (select 1 from public.texting_conversations)
     or exists (select 1 from public.texting_message_drafts)
     or exists (select 1 from public.texting_message_draft_versions)
     or exists (select 1 from public.texting_send_approval_snapshots)
     or exists (select 1 from public.texting_messages)
     or exists (select 1 from public.twilio_callback_events)
     or exists (select 1 from public.twilio_message_reconciliation_jobs)
     or exists (select 1 from connector_private.twilio_message_resources)
     or exists (select 1 from connector_private.twilio_callback_authorities)
     or exists (
       select 1 from connector_private.connector_connection_secrets
       where secret_type in (
         'twilio-provider-authority',
         'twilio-api-key-secret',
         'twilio-webhook-auth-token'
       )
     )
     or exists (
       select 1 from connector_private.connector_payload_envelopes
       where payload_kind = 'twilio-message-body'
     )
     or exists (
       select 1 from public.connector_automation_policies
       where action_type = 'message.send'
         and target_constraints->>'provider' = 'twilio'
     )
     or exists (
       select 1 from public.connector_action_intents
       where provider = 'twilio' and action_type = 'message.send'
     )
     or exists (
       select 1 from public.connector_jobs
       where provider = 'twilio' and action_type = 'message.send'
     )
     or exists (
       select 1 from public.connector_receipt_events
       where provider = 'twilio'
     ) then
    raise exception using
      errcode = '55000',
      message = '0015 rollback refused: Twilio/texting evidence exists; preserve history and use PITR or a reviewed forward remediation';
  end if;
end;
$$;

drop trigger if exists connector_jobs_mark_twilio_side_effect_boundary
  on public.connector_jobs;
drop trigger if exists connector_approval_events_guard_twilio_specialized
  on public.connector_approval_events;
drop trigger if exists connector_connections_sync_twilio_authority
  on public.connector_connections;

drop trigger if exists twilio_connection_authorities_prepare_update on public.twilio_connection_authorities;
drop trigger if exists twilio_connection_authorities_guard_delete on public.twilio_connection_authorities;
drop trigger if exists twilio_compliance_policies_prepare_update on public.twilio_compliance_policies;
drop trigger if exists twilio_compliance_policies_guard_delete on public.twilio_compliance_policies;
drop trigger if exists texting_consent_events_guard_update_delete on public.texting_consent_events;
drop trigger if exists texting_consent_states_prepare_update on public.texting_consent_states;
drop trigger if exists texting_consent_states_guard_delete on public.texting_consent_states;
drop trigger if exists texting_message_drafts_prepare_update on public.texting_message_drafts;
drop trigger if exists texting_message_drafts_guard_delete on public.texting_message_drafts;
drop trigger if exists texting_message_draft_versions_prepare_update on public.texting_message_draft_versions;
drop trigger if exists texting_message_draft_versions_guard_delete on public.texting_message_draft_versions;
drop trigger if exists texting_send_approval_snapshots_guard_update_delete on public.texting_send_approval_snapshots;
drop trigger if exists texting_messages_prepare_update on public.texting_messages;
drop trigger if exists texting_messages_guard_delete on public.texting_messages;
drop trigger if exists twilio_callback_events_prepare_update on public.twilio_callback_events;
drop trigger if exists twilio_callback_events_guard_delete on public.twilio_callback_events;
drop trigger if exists twilio_reconciliation_jobs_prepare_update on public.twilio_message_reconciliation_jobs;
drop trigger if exists twilio_reconciliation_jobs_guard_delete on public.twilio_message_reconciliation_jobs;

drop function public.record_texting_consent(uuid,uuid,uuid,text,public.texting_consent_status,text,text,text,text,text,uuid,timestamptz);
drop function public.guard_twilio_generic_approval_bypass();
drop function connector_private.cancel_twilio_pre_side_effect_jobs(uuid,text,text,uuid,timestamptz,text);
drop function public.mark_twilio_side_effect_boundary_on_job_start();
drop function public.sync_twilio_authority_on_connection_state();
drop function public.disable_twilio_connection(uuid,boolean,uuid,timestamptz);
drop function public.transition_twilio_reconciliation_job(uuid,uuid,bigint,text,text,text,timestamptz,timestamptz,timestamptz);
drop function public.read_twilio_reconciliation_authority(uuid,uuid,bigint,timestamptz);
drop function public.start_twilio_reconciliation_attempt(uuid,uuid,bigint,timestamptz);
drop function public.claim_twilio_reconciliation_jobs(uuid,integer,integer,timestamptz);
drop function public.schedule_due_twilio_reconciliation_jobs(timestamptz,integer,integer);
drop function public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid);
drop function public.read_twilio_callback_verification_authority(text,timestamptz);
drop function connector_private.apply_twilio_message_status(uuid,text,text,timestamptz);
drop function public.bind_twilio_provider_message(uuid,uuid,bigint,text,text,text,timestamptz);
drop function public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz);
drop function public.start_twilio_message_send_attempt(uuid,uuid,bigint,timestamptz);
drop function connector_private.twilio_payload_json(connector_private.connector_payload_envelopes);
drop function connector_private.twilio_secret_json(connector_private.connector_connection_secrets);
drop function public.archive_twilio_message_draft(uuid,integer,uuid,timestamptz);
drop function public.approve_and_enqueue_twilio_message_send(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid);
drop function public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid);
drop function public.revise_twilio_message_draft(uuid,integer,text,jsonb,uuid,timestamptz);
drop function public.create_twilio_message_draft(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,timestamptz);
drop function connector_private.apply_twilio_consent_event(uuid,uuid,uuid,text,public.texting_consent_status,text,text,text,text,text,text,uuid,text,uuid,timestamptz);
drop function public.read_twilio_connection_readiness(uuid);
drop function public.ensure_twilio_message_send_policy(uuid,uuid,uuid,timestamptz);
drop function public.configure_twilio_compliance_policy(uuid,text,text,text,integer,time,time,text,integer,boolean,text,uuid,timestamptz);
drop function public.prepare_twilio_compliance_policy_update();
drop function public.bind_twilio_connection_authority(uuid,uuid,uuid,text,text,text,text,text,public.twilio_registration_state,text,text,text,timestamptz,text,timestamptz,boolean,timestamptz,boolean,text,integer,jsonb,integer,jsonb,integer,jsonb,uuid,timestamptz);
drop function public.prepare_twilio_reconciliation_job_update();
drop function public.prepare_twilio_callback_update();
drop function public.prepare_texting_message_update();
drop function public.prepare_texting_draft_version_update();
drop function public.prepare_texting_draft_update();
drop function public.prepare_texting_consent_state_update();
drop function public.prepare_twilio_authority_update();
drop function connector_private.refresh_twilio_readiness(uuid,timestamptz);
drop function connector_private.twilio_active_phone(uuid,uuid,uuid);
drop function connector_private.store_twilio_content_payload(uuid,text,text,text,jsonb,timestamptz);
drop function connector_private.upsert_twilio_secret(uuid,text,integer,jsonb,timestamptz);
drop function connector_private.twilio_envelope_is_valid(jsonb,boolean);
drop function connector_private.is_twilio_terminal_status(text);
drop function connector_private.twilio_status_rank(text);

drop table public.twilio_message_reconciliation_jobs;
drop table connector_private.twilio_specialized_approval_guards;
drop table connector_private.twilio_message_resources;
drop table public.texting_phone_suppressions;
drop table public.twilio_callback_events;
drop table connector_private.twilio_callback_authorities;
drop table public.texting_messages;
drop table public.texting_send_approval_snapshots;
drop table public.texting_message_draft_versions;
drop table public.texting_message_drafts;
drop table public.texting_conversations;
drop table public.texting_consent_states;
drop table public.texting_consent_events;
drop table public.twilio_compliance_policies;
drop table public.twilio_connection_authorities;

drop type public.twilio_reconciliation_state;
drop type public.twilio_callback_state;
drop type public.twilio_callback_kind;
drop type public.texting_message_status;
drop type public.texting_draft_state;
drop type public.texting_keyword_class;
drop type public.texting_direction;
drop type public.texting_consent_status;
drop type public.twilio_readiness_state;
drop type public.twilio_registration_state;

commit;
