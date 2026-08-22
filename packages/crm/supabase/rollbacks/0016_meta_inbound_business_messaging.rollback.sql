-- Story 4.4 / migration 0016 rollback.
-- PRE-WRITE ONLY. Once any Meta authority, OAuth, asset, secret, webhook,
-- message, review, job, receipt or payload exists, preserve evidence and use
-- PITR or a reviewed forward remediation.

begin;

do $$ begin
  if exists(select 1 from public.meta_connection_authorities)
     or exists(select 1 from public.meta_asset_bindings)
     or exists(select 1 from public.meta_external_identities)
     or exists(select 1 from public.meta_conversations)
     or exists(select 1 from public.meta_inbound_events)
     or exists(select 1 from public.meta_normalization_jobs)
     or exists(select 1 from connector_private.meta_webhook_authorities)
     or exists(select 1 from connector_private.connector_connection_secrets where secret_type like 'meta-%')
     or exists(select 1 from connector_private.connector_payload_envelopes where payload_kind='meta-inbound-message')
     or exists(select 1 from connector_private.connector_oauth_transactions where provider='meta')
     or exists(select 1 from public.connector_receipt_events where provider='meta') then
    raise exception using errcode='55000',
      message='0016 rollback refused: Meta evidence exists; preserve history and use PITR or a reviewed forward remediation';
  end if;
end $$;

drop trigger if exists connector_connections_sync_meta_authority on public.connector_connections;

drop function public.sync_meta_authority_on_connection_state();
drop function public.purge_expired_meta_content(timestamptz,integer);
drop function public.read_meta_connection_state(uuid);
drop function public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz);
drop function public.transition_meta_normalization_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz);
drop function public.apply_meta_normalized_enquiry(uuid,uuid,bigint,text,text,text,timestamptz);
drop function public.read_meta_normalization_authority(uuid,uuid,bigint,timestamptz);
drop function public.start_meta_normalization_attempt(uuid,uuid,bigint,timestamptz);
drop function public.claim_meta_normalization_jobs(uuid,integer,integer,timestamptz);
drop function public.register_meta_webhook_delivery_encrypted(text,text,text,text,boolean,jsonb,timestamptz,uuid);
drop function public.confirm_meta_webhook_challenge(text,text,timestamptz);
drop function public.read_meta_webhook_authority(text,timestamptz);
drop function public.bind_meta_webhook_authority(uuid,text,integer,jsonb,integer,jsonb,text,uuid,timestamptz);
drop function public.select_meta_assets(uuid,text,text[],integer,text,uuid,timestamptz);
drop function public.replace_meta_eligible_assets(uuid,text,text,jsonb,timestamptz);
drop function public.read_meta_asset_discovery_authority(uuid,uuid,uuid,timestamptz);
drop function public.finalize_meta_oauth(uuid,uuid,uuid,uuid,text,text[],boolean,text,boolean,text,integer,jsonb,uuid,timestamptz);
drop function public.consume_meta_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz);
drop function public.begin_meta_oauth(uuid,uuid,public.meta_login_mode,text,text,text,timestamptz,text[],uuid,text,text,text,text,jsonb,timestamptz,timestamptz);
drop function connector_private.store_meta_payload(uuid,text,jsonb,timestamptz,timestamptz);
drop function connector_private.meta_payload_json(connector_private.connector_payload_envelopes);
drop function connector_private.meta_secret_json(connector_private.connector_connection_secrets);
drop function connector_private.upsert_meta_secret(uuid,text,integer,jsonb,timestamptz);
drop function connector_private.meta_envelope_is_valid(jsonb,boolean);
drop function connector_private.meta_expected_channel(public.meta_login_mode);
drop function connector_private.meta_expected_scopes(public.meta_login_mode);

drop table public.meta_normalization_jobs;
drop table connector_private.meta_event_identities;
drop table public.meta_inbound_events;
drop table public.meta_conversations;
drop table public.meta_external_identities;
drop table connector_private.meta_webhook_authorities;
drop table connector_private.meta_asset_identities;
drop table public.meta_asset_bindings;
drop table public.meta_connection_authorities;

drop type public.meta_normalization_job_state;
drop type public.meta_inbound_event_state;
drop type public.meta_asset_state;
drop type public.meta_readiness_state;
drop type public.meta_channel;
drop type public.meta_login_mode;

commit;
