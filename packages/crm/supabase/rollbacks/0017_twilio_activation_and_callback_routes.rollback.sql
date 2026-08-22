-- Story 4.3 HIGH remediation / migration 0017 rollback.
-- PRE-WRITE ONLY. A requested UAT or configured /status route is security and
-- compliance evidence and must not be erased by a routine rollback.

begin;

do $$ begin
  if exists(select 1 from public.twilio_real_number_uat_jobs)
     or exists(select 1 from connector_private.twilio_real_number_uat_resources)
     or exists(select 1 from connector_private.twilio_callback_authorities where status_external_url_hash is not null)
     or exists(select 1 from public.twilio_callback_events where callback_kind='status') then
    raise exception using errcode='55000',
      message='0017 rollback refused: UAT or kind-specific callback evidence exists; preserve history and use PITR or forward remediation';
  end if;
end $$;

drop trigger if exists connector_connections_cancel_twilio_uat on public.connector_connections;
drop trigger if exists texting_phone_suppressions_cancel_twilio_uat on public.texting_phone_suppressions;
drop trigger if exists twilio_callback_events_guard_exact_route on public.twilio_callback_events;

drop function public.cancel_twilio_uat_on_connection_state();
drop function public.cancel_twilio_uat_on_suppression();
drop function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz);
drop function public.bind_twilio_real_number_uat_provider_message(uuid,uuid,bigint,text,text,timestamptz);
drop function public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz);
drop function public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz);
drop function public.claim_twilio_real_number_uat_jobs(uuid,integer,integer,timestamptz);
drop function public.request_twilio_real_number_uat(uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,text,uuid);
drop function public.register_and_apply_twilio_status_callback(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid);
drop function public.guard_twilio_callback_exact_route();
drop function public.read_twilio_callback_verification_authority(text,public.twilio_callback_kind,timestamptz);
drop function public.bind_twilio_callback_routes(uuid,uuid,uuid,text,text,text,uuid,timestamptz);
drop function public.read_twilio_setup_state(uuid,uuid,uuid);

drop function public.read_twilio_connection_readiness(uuid);
create or replace function public.read_twilio_connection_readiness(target_connection_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_authority public.twilio_connection_authorities%rowtype;
 target_policy public.twilio_compliance_policies%rowtype;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  perform public.connector_current_membership(target_connection.workspace_id,false);
  select authority.* into target_authority from public.twilio_connection_authorities authority
    where authority.connection_id=target_connection.id;
  select policy.* into target_policy from public.twilio_compliance_policies policy
    where policy.connection_id=target_connection.id and policy.superseded_at is null;
  return jsonb_build_object('connection',to_jsonb(target_connection),
    'authority',case when target_authority.id is null then null else to_jsonb(target_authority) end,
    'policy',case when target_policy.id is null then null else to_jsonb(target_policy) end,
    'providerBacked',target_authority.readiness_state='active','deviceSmsFallbackSeparate',true);
end;
$$;
revoke all on function public.read_twilio_connection_readiness(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_twilio_connection_readiness(uuid) to authenticated;
grant execute on function public.read_twilio_callback_verification_authority(text,timestamptz) to service_role;

drop table connector_private.twilio_real_number_uat_resources;
drop table public.twilio_real_number_uat_jobs;
drop type public.twilio_real_number_uat_state;

alter table connector_private.twilio_callback_authorities
  drop constraint twilio_callback_authorities_status_url_hash;
alter table connector_private.twilio_callback_authorities
  drop column status_external_url_hash;

commit;
