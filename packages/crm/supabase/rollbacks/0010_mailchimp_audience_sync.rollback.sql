-- Manual rollback for 0010_mailchimp_audience_sync.sql.
-- PRE-WRITE ONLY. Enum labels added by 0010 are intentionally retained;
-- PostgreSQL cannot remove enum labels safely. After any OAuth/audience/sync
-- write, use managed PITR or a reviewed forward migration.

begin;

do $$
begin
  if exists(select 1 from public.mailchimp_webhook_jobs)
     or exists(select 1 from public.mailchimp_sync_evidence)
     or exists(select 1 from public.mailchimp_subscription_authority)
     or exists(select 1 from public.mailchimp_member_links)
     or exists(select 1 from public.mailchimp_audience_bindings)
     or exists(select 1 from public.connector_receipt_events
       where event_type::text in ('oauth.started','oauth.completed','audience.selected',
         'audience.replaced','sync.applied','sync.reviewed'))
     or exists(select 1 from public.connector_automation_policies
       where action_type='audience.sync')
     or exists(select 1 from connector_private.connector_connection_secrets
       where secret_type='mailchimp-access-token')
     or exists(select 1 from connector_private.connector_oauth_transactions
       where requested_scope_bundle='mailchimp.audience-sync.v1') then
    raise exception '0010 rollback refused after Mailchimp authority/evidence writes; use PITR or a reviewed forward migration'
      using errcode='55000';
  end if;
end;
$$;

drop function if exists public.transition_mailchimp_webhook_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz);
drop function if exists public.apply_claimed_mailchimp_inbound_subscription_event(uuid,uuid,bigint,text,text,text,text,text,text,timestamptz);
drop function if exists public.read_claimed_mailchimp_webhook_payload(uuid,uuid,bigint,timestamptz);
drop function if exists public.start_mailchimp_webhook_job(uuid,uuid,bigint,timestamptz);
drop function if exists public.claim_mailchimp_webhook_jobs(uuid,integer,integer,timestamptz);
drop function if exists public.register_mailchimp_webhook_event(uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer);
drop function if exists public.confirm_mailchimp_webhook_registration(uuid,uuid,text,uuid,timestamptz);
drop function if exists public.complete_mailchimp_audience_baseline(uuid,uuid,text,uuid,timestamptz);
drop function if exists public.read_mailchimp_access_token(uuid,uuid,uuid,uuid);
drop function if exists public.ensure_mailchimp_sync_policy(uuid,uuid,timestamptz);
drop function if exists public.read_mailchimp_sync_checkpoint(uuid,uuid,bigint,timestamptz);
drop function if exists public.store_mailchimp_sync_checkpoint(uuid,uuid,bigint,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz);
drop function if exists public.record_mailchimp_outbound_sync_evidence(uuid,uuid,bigint,text,text,text,text,uuid,timestamptz);
drop function if exists public.read_mailchimp_job_binding(uuid,uuid,bigint,timestamptz);
drop function if exists public.apply_mailchimp_inbound_subscription_event(uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz);
drop function if exists public.link_mailchimp_member(uuid,uuid,text,text);
drop function if exists public.select_mailchimp_audience(uuid,text,text,text,text,integer,uuid,timestamptz);
drop function if exists public.finalize_mailchimp_oauth(uuid,text,text[],jsonb,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,uuid);
drop function if exists public.begin_mailchimp_oauth(uuid,uuid,text,uuid,text,text,text[],text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz);

drop trigger if exists mailchimp_webhook_jobs_guard_delete on public.mailchimp_webhook_jobs;
drop trigger if exists mailchimp_webhook_jobs_prepare_update on public.mailchimp_webhook_jobs;
drop trigger if exists mailchimp_sync_evidence_guard_mutation on public.mailchimp_sync_evidence;
drop trigger if exists mailchimp_subscription_authority_guard_delete on public.mailchimp_subscription_authority;
drop trigger if exists mailchimp_subscription_authority_prepare_update on public.mailchimp_subscription_authority;
drop trigger if exists mailchimp_member_links_guard_delete on public.mailchimp_member_links;
drop trigger if exists mailchimp_member_links_prepare_update on public.mailchimp_member_links;
drop trigger if exists mailchimp_audience_bindings_guard_delete on public.mailchimp_audience_bindings;
drop trigger if exists mailchimp_audience_bindings_prepare_update on public.mailchimp_audience_bindings;

drop function if exists public.prepare_mailchimp_webhook_job_update();
drop function if exists public.prepare_mailchimp_subscription_authority_update();
drop function if exists public.prepare_mailchimp_member_link_update();
drop function if exists public.prepare_mailchimp_audience_binding_update();

drop table if exists public.mailchimp_webhook_jobs;
drop table if exists public.mailchimp_sync_evidence;
drop table if exists public.mailchimp_subscription_authority;
drop table if exists public.mailchimp_member_links;
drop table if exists public.mailchimp_audience_bindings;

alter table public.contact_points
  drop constraint if exists contact_points_id_workspace_contact_unique;

commit;

-- Deliberately retained enum labels:
-- oauth.started, oauth.completed, audience.selected, audience.replaced,
-- sync.applied and sync.reviewed.
