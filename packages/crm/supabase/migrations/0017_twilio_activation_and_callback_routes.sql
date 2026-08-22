-- Omnix — Twilio controlled UAT and callback-route remediation
-- Story 4.3 HIGH follow-up. Apply after 0016.
--
-- This migration does not loosen ordinary message.send. It adds a separate,
-- owner-approved, bounded real-number UAT queue and binds the two Twilio
-- callback kinds to two exact URL hashes under one opaque endpoint.

begin;

alter table connector_private.twilio_callback_authorities
  add column status_external_url_hash text;

alter table connector_private.twilio_callback_authorities
  add constraint twilio_callback_authorities_status_url_hash
  check (status_external_url_hash is null or status_external_url_hash ~ '^[0-9a-f]{64}$');

comment on column connector_private.twilio_callback_authorities.exact_external_url_hash is
  'SHA-256 of the exact public inbound callback URL, including the opaque endpoint key and /inbound suffix.';
comment on column connector_private.twilio_callback_authorities.status_external_url_hash is
  'SHA-256 of the distinct exact public delivery-status callback URL, including the opaque endpoint key and /status suffix.';

create type public.twilio_real_number_uat_state as enum (
  'queued','leased','executing','retry_wait','succeeded','failed','cancelled'
);

create table public.twilio_real_number_uat_jobs (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  content_payload_ref        uuid not null,
  body_hash                  text not null,
  recipient_phone_hash       text not null,
  sender_key_hash            text not null,
  consent_event_id           uuid not null,
  texting_policy_id          uuid not null,
  texting_policy_version     integer not null,
  disclosure_version         text not null,
  recipient_timezone         text,
  timezone_source            text,
  quiet_hours_start          time not null,
  quiet_hours_end            time not null,
  quiet_hours_decision       text not null,
  evaluated_at               timestamptz not null,
  scheduled_at               timestamptz not null,
  requested_by_membership_id uuid not null,
  idempotency_key            text not null,
  correlation_id             uuid not null,
  state                      public.twilio_real_number_uat_state not null default 'queued',
  attempt_count              integer not null default 0,
  max_attempts               integer not null default 3,
  lease_owner                uuid,
  lease_expires_at           timestamptz,
  fencing_token              bigint not null default 0,
  side_effect_started_at     timestamptz,
  provider_message_sid_hash  text,
  provider_final_status      text,
  provider_evidence_hash     text,
  last_error_category        text,
  completed_at               timestamptz,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,

  constraint twilio_real_number_uat_jobs_workspace_id_unique unique(id,workspace_id),
  constraint twilio_real_number_uat_jobs_idempotency_unique unique(workspace_id,idempotency_key),
  constraint twilio_real_number_uat_jobs_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_jobs_contact_workspace_fk
    foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_jobs_point_workspace_fk
    foreign key(contact_point_id,workspace_id) references public.contact_points(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_jobs_payload_workspace_fk
    foreign key(content_payload_ref,workspace_id) references connector_private.connector_payload_envelopes(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_jobs_consent_workspace_fk
    foreign key(consent_event_id,workspace_id) references public.texting_consent_events(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_jobs_policy_workspace_fk
    foreign key(texting_policy_id,workspace_id) references public.twilio_compliance_policies(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_jobs_requester_workspace_fk
    foreign key(requested_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_jobs_hashes check (
    body_hash ~ '^[0-9a-f]{64}$' and recipient_phone_hash ~ '^[0-9a-f]{64}$'
    and sender_key_hash ~ '^[0-9a-f]{64}$'
    and (provider_message_sid_hash is null or provider_message_sid_hash ~ '^[0-9a-f]{64}$')
    and (provider_evidence_hash is null or provider_evidence_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint twilio_real_number_uat_jobs_values check (
    texting_policy_version>0 and length(disclosure_version) between 1 and 80
    and quiet_hours_start<>quiet_hours_end and quiet_hours_decision in ('send_now','defer')
    and scheduled_at>=evaluated_at and attempt_count between 0 and max_attempts and max_attempts between 1 and 3
    and fencing_token>=0 and length(idempotency_key) between 8 and 160
    and (last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$')
    and ((recipient_timezone is null and timezone_source is null and quiet_hours_decision='defer')
      or (recipient_timezone is not null and timezone_source is not null))
    and ((state='leased' and lease_owner is not null and lease_expires_at is not null)
      or (state='executing' and lease_owner is not null and lease_expires_at is not null and side_effect_started_at is not null)
      or (state not in ('leased','executing') and lease_owner is null and lease_expires_at is null))
    and ((state='succeeded' and provider_message_sid_hash is not null and provider_final_status in ('delivered','read')
      and provider_evidence_hash is not null and completed_at is not null)
      or (state<>'succeeded'))
  )
);

create unique index twilio_real_number_uat_one_open_per_connection
  on public.twilio_real_number_uat_jobs(connection_id)
  where state in ('queued','leased','executing','retry_wait');
create index twilio_real_number_uat_claim_idx
  on public.twilio_real_number_uat_jobs(state,scheduled_at,created_at,id)
  where state in ('queued','leased','retry_wait');

create table connector_private.twilio_real_number_uat_resources (
  job_id                    uuid primary key,
  workspace_id              uuid not null references public.workspaces(id) on delete restrict,
  connection_id             uuid not null,
  provider_message_sid      text not null,
  provider_message_sid_hash text not null,
  created_at                timestamptz not null,
  constraint twilio_real_number_uat_resources_job_workspace_fk
    foreign key(job_id,workspace_id) references public.twilio_real_number_uat_jobs(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_resources_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint twilio_real_number_uat_resources_sid_unique unique(connection_id,provider_message_sid),
  constraint twilio_real_number_uat_resources_values check (
    provider_message_sid ~ '^SM[0-9A-Fa-f]{32}$' and provider_message_sid_hash ~ '^[0-9a-f]{64}$'
  )
);

alter table public.twilio_real_number_uat_jobs enable row level security;
alter table public.twilio_real_number_uat_jobs force row level security;
alter table connector_private.twilio_real_number_uat_resources enable row level security;
alter table connector_private.twilio_real_number_uat_resources force row level security;

create policy twilio_real_number_uat_jobs_member_select
  on public.twilio_real_number_uat_jobs for select to authenticated
  using (public.has_workspace_access(workspace_id));

revoke all on table public.twilio_real_number_uat_jobs from public,anon,authenticated,service_role;
revoke all on table connector_private.twilio_real_number_uat_resources from public,anon,authenticated,service_role;
grant select on table public.twilio_real_number_uat_jobs to authenticated,service_role;
grant usage on type public.twilio_real_number_uat_state to authenticated,service_role;

create or replace function public.read_twilio_setup_state(
  target_connection_id uuid,target_authenticated_user_id uuid,target_membership_id uuid
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_authority public.twilio_connection_authorities%rowtype;
 target_policy public.twilio_compliance_policies%rowtype;
 provider_version integer; api_version integer; webhook_version integer;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found or not exists(select 1 from public.workspace_members member
      where member.id=target_membership_id and member.workspace_id=target_connection.workspace_id
        and member.user_id=target_authenticated_user_id and member.role='owner' and member.status='active') then
    raise exception 'active owner Twilio setup binding required' using errcode='42501';
  end if;
  select authority.* into target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection.id;
  select policy.* into target_policy from public.twilio_compliance_policies policy
  where policy.connection_id=target_connection.id and policy.superseded_at is null;
  select secret_version into provider_version from connector_private.connector_connection_secrets
  where connection_id=target_connection.id and secret_type='twilio-provider-authority' and destroyed_at is null;
  select secret_version into api_version from connector_private.connector_connection_secrets
  where connection_id=target_connection.id and secret_type='twilio-api-key-secret' and destroyed_at is null;
  select secret_version into webhook_version from connector_private.connector_connection_secrets
  where connection_id=target_connection.id and secret_type='twilio-webhook-auth-token' and destroyed_at is null;
  return jsonb_build_object('workspaceId',target_connection.workspace_id,'connectionId',target_connection.id,
    'connectionStatus',target_connection.status,
    'readinessState',case when target_authority.id is null then null else target_authority.readiness_state end,
    'enabled',coalesce(target_authority.enabled,false),'useCase',target_policy.use_case,
    'policyVersion',target_policy.version,'disclosureVersion',target_policy.disclosure_version,
    'providerAuthoritySecretVersion',provider_version,'apiCredentialSecretVersion',api_version,
    'webhookSecretVersion',webhook_version,
    'realNumberUatRequired',target_authority.id is not null and target_authority.real_number_uat_at is null);
end;
$$;

create or replace function public.read_twilio_connection_readiness(target_connection_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_authority public.twilio_connection_authorities%rowtype;
 target_policy public.twilio_compliance_policies%rowtype;
 pre_uat_ready boolean:=false;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  perform public.connector_current_membership(target_connection.workspace_id,false);
  select authority.* into target_authority from public.twilio_connection_authorities authority
    where authority.connection_id=target_connection.id;
  select policy.* into target_policy from public.twilio_compliance_policies policy
    where policy.connection_id=target_connection.id and policy.superseded_at is null;
  pre_uat_ready:=target_authority.id is not null and target_authority.enabled
    and target_authority.registration_state in ('approved','not_required')
    and target_authority.restricted_credential and target_authority.sender_ownership_verified_at is not null
    and target_authority.callback_verified_at is not null and target_policy.id is not null;
  return jsonb_build_object('connection',to_jsonb(target_connection),
    'authority',case when target_authority.id is null then null else to_jsonb(target_authority) end,
    'policy',case when target_policy.id is null then null else to_jsonb(target_policy) end,
    'disclosureVersion',target_policy.disclosure_version,
    'realNumberUatRequired',pre_uat_ready and target_authority.real_number_uat_at is null,
    'providerBacked',target_authority.readiness_state='active',
    'deviceSmsFallbackSeparate',true);
end;
$$;

create or replace function public.bind_twilio_callback_routes(
  target_connection_id uuid,target_authenticated_user_id uuid,target_membership_id uuid,
  target_endpoint_key_hash text,target_inbound_external_url_hash text,
  target_status_external_url_hash text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_authority public.twilio_connection_authorities%rowtype;
 target_callback connector_private.twilio_callback_authorities%rowtype;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$'
     or target_inbound_external_url_hash !~ '^[0-9a-f]{64}$'
     or target_status_external_url_hash !~ '^[0-9a-f]{64}$'
     or target_inbound_external_url_hash=target_status_external_url_hash
     or target_correlation_id is null or target_occurred_at is null then
    raise exception 'two distinct exact Twilio callback URL hashes are required' using errcode='22023';
  end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio'
    and connection.status not in ('revoking','disconnected','disconnected_unconfirmed') for update;
  if not found or not exists(select 1 from public.workspace_members member
      where member.id=target_membership_id and member.workspace_id=target_connection.workspace_id
        and member.user_id=target_authenticated_user_id and member.role='owner' and member.status='active') then
    raise exception 'active owner Twilio callback setup binding required' using errcode='42501';
  end if;
  select authority.* into strict target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection.id for update;
  select callback.* into target_callback from connector_private.twilio_callback_authorities callback
  where callback.connection_id=target_connection.id for update;
  if not found or target_callback.endpoint_key_hash<>target_endpoint_key_hash then
    raise exception 'existing opaque Twilio endpoint binding required' using errcode='40001'; end if;
  update connector_private.twilio_callback_authorities set
    exact_external_url_hash=target_inbound_external_url_hash,
    status_external_url_hash=target_status_external_url_hash,bound_at=target_occurred_at,revoked_at=null
  where id=target_callback.id returning * into target_callback;
  update public.twilio_connection_authorities set callback_external_url_hash=target_inbound_external_url_hash,
    updated_by_membership_id=target_membership_id,updated_at=target_occurred_at
  where id=target_authority.id returning * into target_authority;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'twilio','connection.tested',
    'twilio.callback.routes:'||target_correlation_id::text,target_correlation_id,
    target_status_external_url_hash,jsonb_build_object('callbackKinds',array['inbound','status'],
      'exactRouteCount',2),target_occurred_at
  ) on conflict(workspace_id,event_key) do nothing;
  return jsonb_build_object('workspaceId',target_connection.workspace_id,'connectionId',target_connection.id,
    'boundAt',target_callback.bound_at,'callbackKinds',jsonb_build_array('inbound','status'),
    'inboundExactUrlHash',target_callback.exact_external_url_hash,
    'statusExactUrlHash',target_callback.status_external_url_hash);
end;
$$;

create or replace function public.read_twilio_callback_verification_authority(
  target_endpoint_key_hash text,target_callback_kind public.twilio_callback_kind,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_callback connector_private.twilio_callback_authorities%rowtype;
 target_authority public.twilio_connection_authorities%rowtype;
 target_connection public.connector_connections%rowtype;
 target_secret connector_private.connector_connection_secrets%rowtype; target_url_hash text;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Twilio callback endpoint key' using errcode='22023'; end if;
  select callback.* into target_callback from connector_private.twilio_callback_authorities callback
  where callback.endpoint_key_hash=target_endpoint_key_hash and callback.revoked_at is null;
  if not found then raise exception 'active Twilio callback endpoint not found' using errcode='P0002'; end if;
  target_url_hash:=case when target_callback_kind='inbound' then target_callback.exact_external_url_hash
    else target_callback.status_external_url_hash end;
  if target_url_hash is null then raise exception 'exact Twilio callback kind route is not configured' using errcode='P0002'; end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_callback.connection_id and connection.workspace_id=target_callback.workspace_id
    and connection.provider='twilio' and connection.status in ('active','degraded','reauthorization_required','revoking','authorizing');
  if not found then raise exception 'Twilio callback connection unavailable' using errcode='42501'; end if;
  select authority.* into strict target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection.id;
  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.workspace_id=target_connection.workspace_id
    and secret.secret_type='twilio-webhook-auth-token' and secret.destroyed_at is null
    and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio webhook verification secret unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('workspaceId',target_connection.workspace_id,'connectionId',target_connection.id,
    'provider','twilio','callbackKind',target_callback_kind,'accountSidHash',target_authority.account_sid_hash,
    'messagingServiceSidHash',target_authority.messaging_service_sid_hash,
    'senderKeyHash',target_authority.sender_key_hash,'exactExternalUrlHash',target_url_hash,
    'secret',connector_private.twilio_secret_json(target_secret));
end;
$$;

create or replace function public.guard_twilio_callback_exact_route()
returns trigger language plpgsql security definer set search_path='' as $$
declare route connector_private.twilio_callback_authorities%rowtype; expected_hash text;
begin
  select callback.* into strict route from connector_private.twilio_callback_authorities callback
  where callback.connection_id=new.connection_id and callback.workspace_id=new.workspace_id and callback.revoked_at is null;
  expected_hash:=case when new.callback_kind='inbound' then route.exact_external_url_hash
    else route.status_external_url_hash end;
  if expected_hash is null or new.exact_external_url_hash<>expected_hash then
    raise exception 'Twilio callback kind exact URL mismatch' using errcode='42501'; end if;
  return new;
end;
$$;

create trigger twilio_callback_events_guard_exact_route
  before insert on public.twilio_callback_events
  for each row execute function public.guard_twilio_callback_exact_route();

-- The legacy kind-agnostic read cannot prove which exact URL was signed.
revoke execute on function public.read_twilio_callback_verification_authority(text,timestamptz) from service_role;

create or replace function public.register_and_apply_twilio_status_callback(
  target_endpoint_key_hash text,target_replay_key_hash text,target_raw_body_hash text,
  target_parameters_hash text,target_exact_external_url_hash text,target_account_sid_hash text,
  target_sender_key_hash text,target_provider_message_sid text,target_normalized_counterpart_phone text,
  target_provider_status text,target_error_category text,target_provider_occurred_at timestamptz,
  target_received_at timestamptz,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare route connector_private.twilio_callback_authorities%rowtype;
 authority public.twilio_connection_authorities%rowtype; delivery public.connector_webhook_deliveries%rowtype;
 existing public.twilio_callback_events%rowtype; created public.twilio_callback_events%rowtype;
 resource connector_private.twilio_message_resources%rowtype; message public.texting_messages%rowtype;
 receipt public.connector_receipt_events%rowtype; status_result jsonb; sid_hash text; phone_hash text;
 review_reason text;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$' or target_replay_key_hash !~ '^[0-9a-f]{64}$'
     or target_raw_body_hash !~ '^[0-9a-f]{64}$' or target_parameters_hash !~ '^[0-9a-f]{64}$'
     or target_exact_external_url_hash !~ '^[0-9a-f]{64}$' or target_account_sid_hash !~ '^[0-9a-f]{64}$'
     or target_sender_key_hash !~ '^[0-9a-f]{64}$' or target_provider_message_sid !~ '^SM[0-9A-Fa-f]{32}$'
     or target_provider_status is null or target_correlation_id is null
     or target_provider_occurred_at is null or target_received_at is null
     or target_provider_occurred_at>target_received_at+interval '5 minutes'
     or target_received_at<clock_timestamp()-interval '15 minutes'
     or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$') then
    raise exception 'invalid verified Twilio status callback metadata' using errcode='22023';
  end if;
  select callback.* into route from connector_private.twilio_callback_authorities callback
  where callback.endpoint_key_hash=target_endpoint_key_hash and callback.revoked_at is null;
  if not found or route.status_external_url_hash is null
     or route.status_external_url_hash<>target_exact_external_url_hash then
    raise exception 'exact Twilio status callback route mismatch' using errcode='42501'; end if;
  select a.* into strict authority from public.twilio_connection_authorities a
  where a.connection_id=route.connection_id and a.workspace_id=route.workspace_id;
  if authority.account_sid_hash<>target_account_sid_hash or authority.sender_key_hash<>target_sender_key_hash then
    raise exception 'Twilio status account or sender binding mismatch' using errcode='42501'; end if;
  sid_hash:=encode(extensions.digest(pg_catalog.convert_to(target_provider_message_sid,'UTF8'),'sha256'),'hex');
  phone_hash:=encode(extensions.digest(pg_catalog.convert_to(
    coalesce(public.normalize_contact_phone(target_normalized_counterpart_phone),''),'UTF8'),'sha256'),'hex');
  select callback.* into existing from public.twilio_callback_events callback
  where callback.connection_id=route.connection_id and callback.replay_key_hash=target_replay_key_hash for update;
  if found then
    if existing.callback_kind<>'status' or existing.raw_body_hash<>target_raw_body_hash
       or existing.parameters_hash<>target_parameters_hash
       or existing.exact_external_url_hash<>target_exact_external_url_hash
       or existing.provider_message_sid_hash<>sid_hash or existing.provider_status<>target_provider_status then
      raise exception 'divergent Twilio status callback replay' using errcode='23505'; end if;
    return jsonb_build_object('accepted',true,'noOp',true,'callback',to_jsonb(existing),
      'message',(select to_jsonb(m) from public.texting_messages m where m.id=existing.message_id));
  end if;
  select r.* into resource from connector_private.twilio_message_resources r
  where r.connection_id=route.connection_id and r.provider_message_sid=target_provider_message_sid;
  if not found then review_reason:='unknown_message_sid';
  else
    status_result:=connector_private.apply_twilio_message_status(resource.message_id,target_provider_status,
      target_error_category,target_provider_occurred_at);
    message:=jsonb_populate_record(null::public.texting_messages,status_result->'message');
  end if;
  insert into public.connector_webhook_deliveries(
    workspace_id,connection_id,provider,replay_key_hash,raw_body_hash,signature_valid,timestamp_valid,
    outcome,correlation_id,received_at,redacted_result
  ) values (
    route.workspace_id,route.connection_id,'twilio',target_replay_key_hash,target_raw_body_hash,true,true,
    'accepted',target_correlation_id,target_received_at,
    case when review_reason is null then 'status_applied' else 'status_review' end
  ) returning * into delivery;
  insert into public.twilio_callback_events(
    workspace_id,connection_id,webhook_delivery_id,callback_kind,state,replay_key_hash,raw_body_hash,
    parameters_hash,exact_external_url_hash,account_sid_hash,sender_key_hash,provider_message_sid_hash,
    counterpart_phone_hash,keyword_class,provider_status,review_reason,message_id,correlation_id,
    received_at,processed_at
  ) values (
    route.workspace_id,route.connection_id,delivery.id,'status',
    case when review_reason is null then 'applied'::public.twilio_callback_state else 'review'::public.twilio_callback_state end,
    target_replay_key_hash,target_raw_body_hash,target_parameters_hash,target_exact_external_url_hash,
    target_account_sid_hash,target_sender_key_hash,sid_hash,phone_hash,'none',target_provider_status,
    review_reason,message.id,target_correlation_id,target_received_at,target_received_at
  ) returning * into created;
  update public.connector_webhook_deliveries set processed_at=target_received_at where id=delivery.id returning * into delivery;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    remote_operation_id,provider_status,redacted_metadata,occurred_at
  ) values (
    route.workspace_id,route.connection_id,'twilio','webhook.accepted',
    'twilio.status.accepted:'||target_replay_key_hash,target_correlation_id,target_parameters_hash,
    sid_hash,target_provider_status,jsonb_build_object('callbackId',created.id,'callbackKind','status',
      'messageSidHash',sid_hash,'outcome',case when review_reason is null then 'applied' else 'review' end),
    target_received_at
  ) returning * into receipt;
  return jsonb_build_object('accepted',true,'noOp',false,'callback',to_jsonb(created),
    'message',case when message.id is null then null else to_jsonb(message) end,
    'statusResult',status_result,'receipt',to_jsonb(receipt));
end;
$$;

create or replace function public.request_twilio_real_number_uat(
  target_connection_id uuid,target_contact_id uuid,target_contact_point_id uuid,
  target_body_hash text,target_content_envelope jsonb,target_recipient_timezone text,
  target_timezone_source text,target_quiet_hours_decision text,target_evaluated_at timestamptz,
  target_scheduled_at timestamptz,target_idempotency_key text,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; connection public.connector_connections%rowtype;
 authority public.twilio_connection_authorities%rowtype; policy public.twilio_compliance_policies%rowtype;
 point public.contact_points%rowtype; consent public.texting_consent_states%rowtype;
 payload connector_private.connector_payload_envelopes%rowtype; existing public.twilio_real_number_uat_jobs%rowtype;
 created public.twilio_real_number_uat_jobs%rowtype; target_phone_hash text;
begin
  if target_body_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null
     or length(target_idempotency_key) not between 8 and 160
     or target_quiet_hours_decision not in ('send_now','defer')
     or target_scheduled_at<target_evaluated_at then
    raise exception 'invalid Twilio real-number UAT request' using errcode='22023'; end if;
  select c.* into connection from public.connector_connections c
  where c.id=target_connection_id and c.provider='twilio'
    and c.status in ('authorizing','degraded','reauthorization_required') for update;
  if not found then raise exception 'pre-activation Twilio connection required' using errcode='23514'; end if;
  actor:=public.connector_current_membership(connection.workspace_id,true);
  select a.* into authority from public.twilio_connection_authorities a
  where a.connection_id=connection.id and a.enabled for update;
  select p.* into policy from public.twilio_compliance_policies p
  where p.connection_id=connection.id and p.use_case=authority.approved_use_case and p.superseded_at is null;
  if authority.id is null or authority.real_number_uat_at is not null or policy.id is null
     or authority.registration_state not in ('approved','not_required') or not authority.restricted_credential
     or authority.sender_ownership_verified_at is null or authority.callback_verified_at is null
     or not exists(select 1 from connector_private.twilio_callback_authorities route
       where route.connection_id=connection.id and route.revoked_at is null
         and route.status_external_url_hash is not null)
     or not exists(select 1 from connector_private.connector_connection_secrets secret
       where secret.connection_id=connection.id and secret.destroyed_at is null
         and secret.secret_type in ('twilio-provider-authority','twilio-api-key-secret','twilio-webhook-auth-token')
       group by secret.connection_id having count(*)=3) then
    raise exception 'Twilio pre-UAT activation gates are incomplete' using errcode='23514'; end if;
  select job.* into existing from public.twilio_real_number_uat_jobs job
  where job.workspace_id=connection.workspace_id and job.idempotency_key=target_idempotency_key;
  if found then
    if existing.connection_id<>connection.id or existing.body_hash<>target_body_hash
       or existing.contact_point_id<>target_contact_point_id or existing.scheduled_at<>target_scheduled_at then
      raise exception 'divergent Twilio UAT replay' using errcode='23505'; end if;
    return jsonb_build_object('job',to_jsonb(existing),'noOp',true);
  end if;
  point:=connector_private.twilio_active_phone(connection.workspace_id,target_contact_id,target_contact_point_id);
  target_phone_hash:=encode(extensions.digest(pg_catalog.convert_to(point.normalized_value,'UTF8'),'sha256'),'hex');
  select state.* into consent from public.texting_consent_states state
  where state.connection_id=connection.id and state.contact_point_id=point.id
    and state.use_case=authority.approved_use_case and state.status='opted_in'
    and state.policy_id=policy.id and state.policy_version=policy.version;
  if not found or exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=connection.id and suppression.phone_hash=target_phone_hash
        and suppression.use_case=authority.approved_use_case and suppression.released_at is null) then
    raise exception 'current explicit consent is required for real-number UAT' using errcode='23514'; end if;
  if target_recipient_timezone is null then
    if target_timezone_source is not null or policy.unknown_timezone_action='block'
       or target_quiet_hours_decision<>'defer'
       or target_scheduled_at<target_evaluated_at+make_interval(mins=>policy.default_defer_minutes) then
      raise exception 'unknown UAT recipient timezone is fail-closed' using errcode='23514'; end if;
  elsif target_timezone_source is null or length(target_recipient_timezone)>120 or length(target_timezone_source)>64 then
    raise exception 'verified UAT recipient timezone source required' using errcode='23514';
  end if;
  payload:=connector_private.store_twilio_content_payload(connection.id,'twilio-message-body',
    'twilio-message-body.v1',target_body_hash,target_content_envelope,target_evaluated_at);
  insert into public.twilio_real_number_uat_jobs(
    workspace_id,connection_id,contact_id,contact_point_id,content_payload_ref,body_hash,
    recipient_phone_hash,sender_key_hash,consent_event_id,texting_policy_id,texting_policy_version,
    disclosure_version,recipient_timezone,timezone_source,quiet_hours_start,quiet_hours_end,
    quiet_hours_decision,evaluated_at,scheduled_at,requested_by_membership_id,idempotency_key,
    correlation_id,created_at,updated_at
  ) values (
    connection.workspace_id,connection.id,target_contact_id,point.id,payload.id,target_body_hash,
    target_phone_hash,authority.sender_key_hash,consent.current_event_id,policy.id,policy.version,
    policy.disclosure_version,target_recipient_timezone,target_timezone_source,policy.quiet_hours_start,
    policy.quiet_hours_end,target_quiet_hours_decision,target_evaluated_at,target_scheduled_at,actor.id,
    target_idempotency_key,target_correlation_id,target_evaluated_at,target_evaluated_at
  ) returning * into created;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    redacted_metadata,occurred_at
  ) values (
    created.workspace_id,created.connection_id,'twilio','connection.tested','twilio.uat.requested:'||created.id::text,
    created.correlation_id,created.body_hash,jsonb_build_object('uatJobId',created.id,'state',created.state,
      'policyVersion',created.texting_policy_version,'ownerApproved',true),created.evaluated_at
  );
  return jsonb_build_object('job',to_jsonb(created),'noOp',false);
end;
$$;

create or replace function public.claim_twilio_real_number_uat_jobs(
  target_worker_id uuid,target_batch_size integer default 5,target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; claimed public.twilio_real_number_uat_jobs%rowtype; items jsonb:='[]'::jsonb;
begin
  if target_worker_id is null or target_batch_size not between 1 and 10
     or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid Twilio UAT claim bounds' using errcode='22023'; end if;
  for candidate in select job.id from public.twilio_real_number_uat_jobs job
    join public.connector_connections connection on connection.id=job.connection_id and connection.workspace_id=job.workspace_id
    join public.twilio_connection_authorities authority on authority.connection_id=job.connection_id
    where ((job.state in ('queued','retry_wait') and job.scheduled_at<=target_now)
      or (job.state='leased' and job.lease_expires_at<=target_now))
      and job.attempt_count<job.max_attempts and connection.status in ('authorizing','degraded','reauthorization_required')
      and authority.enabled and authority.real_number_uat_at is null
    order by job.scheduled_at,job.created_at,job.id for update of job skip locked limit target_batch_size
  loop
    update public.twilio_real_number_uat_jobs set state='leased',lease_owner=target_worker_id,
      lease_expires_at=target_now+make_interval(secs=>target_lease_seconds),fencing_token=fencing_token+1,
      updated_at=target_now where id=candidate.id returning * into claimed;
    items:=items||jsonb_build_array(to_jsonb(claimed));
  end loop;
  return jsonb_build_object('count',jsonb_array_length(items),'jobs',items);
end;
$$;

create or replace function public.start_twilio_real_number_uat_attempt(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_started_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype;
begin
  select target.* into job from public.twilio_real_number_uat_jobs target where target.id=target_job_id for update;
  if not found then raise exception 'Twilio UAT job not found' using errcode='P0002'; end if;
  if job.state<>'leased' or job.lease_owner<>target_worker_id or job.fencing_token<>target_fencing_token
     or job.lease_expires_at<=target_started_at then raise exception 'stale Twilio UAT lease' using errcode='40001'; end if;
  perform 1 from public.texting_consent_states state
  where state.connection_id=job.connection_id and state.contact_point_id=job.contact_point_id
    and state.current_event_id=job.consent_event_id and state.status='opted_in'
    and state.policy_id=job.texting_policy_id and state.policy_version=job.texting_policy_version;
  if not found or exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=job.connection_id and suppression.phone_hash=job.recipient_phone_hash
        and suppression.released_at is null) then
    raise exception 'Twilio UAT consent changed before side effect' using errcode='42501'; end if;
  update public.twilio_real_number_uat_jobs set state='executing',attempt_count=attempt_count+1,
    side_effect_started_at=coalesce(side_effect_started_at,target_started_at),updated_at=target_started_at
  where id=job.id returning * into job;
  return jsonb_build_object('job',to_jsonb(job));
end;
$$;

create or replace function public.read_twilio_real_number_uat_authority(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; connection public.connector_connections%rowtype;
 authority public.twilio_connection_authorities%rowtype; policy public.twilio_compliance_policies%rowtype;
 provider_secret connector_private.connector_connection_secrets%rowtype;
 api_secret connector_private.connector_connection_secrets%rowtype;
 payload connector_private.connector_payload_envelopes%rowtype;
 resource connector_private.twilio_real_number_uat_resources%rowtype;
begin
  select target.* into job from public.twilio_real_number_uat_jobs target
  where target.id=target_job_id and target.state='executing' and target.lease_owner=target_worker_id
    and target.fencing_token=target_fencing_token and target.lease_expires_at>target_now;
  if not found then raise exception 'active fenced Twilio UAT job required' using errcode='42501'; end if;
  select c.* into strict connection from public.connector_connections c
  where c.id=job.connection_id and c.workspace_id=job.workspace_id and c.provider='twilio'
    and c.status in ('authorizing','degraded','reauthorization_required');
  select a.* into authority from public.twilio_connection_authorities a
  where a.connection_id=job.connection_id and a.workspace_id=job.workspace_id and a.enabled
    and a.real_number_uat_at is null and a.registration_state in ('approved','not_required')
    and a.restricted_credential and a.sender_ownership_verified_at is not null and a.callback_verified_at is not null;
  if not found then raise exception 'Twilio UAT pre-activation authority unavailable' using errcode='42501'; end if;
  select p.* into policy from public.twilio_compliance_policies p
  where p.id=job.texting_policy_id and p.version=job.texting_policy_version and p.superseded_at is null;
  if not found or policy.disclosure_version<>job.disclosure_version then
    raise exception 'Twilio UAT policy drift' using errcode='42501'; end if;
  perform 1 from public.texting_consent_states state
  where state.connection_id=job.connection_id and state.contact_point_id=job.contact_point_id
    and state.current_event_id=job.consent_event_id and state.status='opted_in';
  if not found or exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=job.connection_id and suppression.phone_hash=job.recipient_phone_hash
        and suppression.released_at is null) then
    raise exception 'Twilio UAT consent authority unavailable' using errcode='42501'; end if;
  select secret.* into provider_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=job.connection_id and secret.secret_type='twilio-provider-authority'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio provider authority unavailable' using errcode='P0002'; end if;
  select secret.* into api_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=job.connection_id and secret.secret_type='twilio-api-key-secret'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio API credential unavailable' using errcode='P0002'; end if;
  select p.* into payload from connector_private.connector_payload_envelopes p
  where p.id=job.content_payload_ref and p.workspace_id=job.workspace_id and p.connection_id=job.connection_id
    and p.payload_kind='twilio-message-body' and p.schema_version='twilio-message-body.v1'
    and p.canonical_hash=job.body_hash and p.destroyed_at is null;
  if not found then raise exception 'Twilio UAT payload unavailable' using errcode='P0002'; end if;
  select r.* into resource from connector_private.twilio_real_number_uat_resources r where r.job_id=job.id;
  return jsonb_build_object('job',to_jsonb(job),'connection',to_jsonb(connection),'authority',to_jsonb(authority),
    'policy',to_jsonb(policy),'providerAuthority',connector_private.twilio_secret_json(provider_secret),
    'apiCredential',connector_private.twilio_secret_json(api_secret),
    'executionMode',case when resource.job_id is null then 'send' else 'lookup-only' end,
    'payloadEnvelope',case when resource.job_id is null then connector_private.twilio_payload_json(payload) else null end,
    'providerMessageBinding',case when resource.job_id is null then null else jsonb_build_object(
      'providerMessageSid',resource.provider_message_sid,'providerMessageSidHash',resource.provider_message_sid_hash,
      'boundAt',resource.created_at) end);
end;
$$;

create or replace function public.bind_twilio_real_number_uat_provider_message(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_provider_message_sid text,target_provider_request_hash text,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; resource connector_private.twilio_real_number_uat_resources%rowtype;
 sid_hash text;
begin
  if target_provider_message_sid !~ '^SM[0-9A-Fa-f]{32}$' or target_provider_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Twilio UAT provider binding' using errcode='22023'; end if;
  select target.* into job from public.twilio_real_number_uat_jobs target
  where target.id=target_job_id and target.state='executing' and target.lease_owner=target_worker_id
    and target.fencing_token=target_fencing_token and target.lease_expires_at>target_occurred_at for update;
  if not found then raise exception 'active fenced Twilio UAT job required' using errcode='42501'; end if;
  sid_hash:=encode(extensions.digest(pg_catalog.convert_to(target_provider_message_sid,'UTF8'),'sha256'),'hex');
  select r.* into resource from connector_private.twilio_real_number_uat_resources r where r.job_id=job.id;
  if found then
    if resource.provider_message_sid<>target_provider_message_sid then raise exception 'Twilio UAT SID conflict' using errcode='23505'; end if;
    return jsonb_build_object('job',to_jsonb(job),'providerMessageSidHash',resource.provider_message_sid_hash,'noOp',true);
  end if;
  insert into connector_private.twilio_real_number_uat_resources(
    job_id,workspace_id,connection_id,provider_message_sid,provider_message_sid_hash,created_at
  ) values (job.id,job.workspace_id,job.connection_id,target_provider_message_sid,sid_hash,target_occurred_at)
  returning * into resource;
  update public.twilio_real_number_uat_jobs set provider_message_sid_hash=sid_hash,updated_at=target_occurred_at
  where id=job.id returning * into job;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    remote_operation_id,provider_status,redacted_metadata,occurred_at
  ) values (job.workspace_id,job.connection_id,'twilio','provider.accepted','twilio.uat.accepted:'||job.id::text,
    job.correlation_id,target_provider_request_hash,sid_hash,'accepted',jsonb_build_object('uatJobId',job.id),target_occurred_at);
  return jsonb_build_object('job',to_jsonb(job),'providerMessageSidHash',sid_hash,'noOp',false);
end;
$$;

create or replace function public.transition_twilio_real_number_uat_job(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_outcome text,
  target_provider_final_status text,target_provider_evidence_hash text,target_error_category text,
  target_next_attempt_at timestamptz,target_now timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; authority public.twilio_connection_authorities%rowtype;
 connection public.connector_connections%rowtype; next_state public.twilio_real_number_uat_state;
begin
  if target_outcome not in ('delivered','retry','failed')
     or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$') then
    raise exception 'invalid Twilio UAT transition' using errcode='22023'; end if;
  select target.* into job from public.twilio_real_number_uat_jobs target where target.id=target_job_id for update;
  if not found then raise exception 'Twilio UAT job not found' using errcode='P0002'; end if;
  if job.state='succeeded' then
    if target_outcome='delivered' and job.provider_final_status=target_provider_final_status
       and job.provider_evidence_hash=target_provider_evidence_hash then
      return jsonb_build_object('job',to_jsonb(job),
        'authority',(select to_jsonb(a) from public.twilio_connection_authorities a where a.connection_id=job.connection_id),
        'connection',(select to_jsonb(c) from public.connector_connections c where c.id=job.connection_id),'noOp',true);
    end if;
    raise exception 'divergent Twilio UAT completion replay' using errcode='23505';
  end if;
  if job.state<>'executing' or job.lease_owner<>target_worker_id or job.fencing_token<>target_fencing_token
     or job.lease_expires_at<=target_now then raise exception 'stale Twilio UAT lease' using errcode='40001'; end if;
  if target_outcome='delivered' then
    if target_provider_final_status not in ('delivered','read') or target_provider_evidence_hash !~ '^[0-9a-f]{64}$'
       or not exists(select 1 from connector_private.twilio_real_number_uat_resources resource
         where resource.job_id=job.id and resource.provider_message_sid_hash=job.provider_message_sid_hash) then
      raise exception 'provider-delivered Twilio UAT evidence required' using errcode='23514'; end if;
    next_state:='succeeded';
  elsif target_outcome='retry' and job.attempt_count<job.max_attempts then
    if target_next_attempt_at is null or target_next_attempt_at<=target_now then
      raise exception 'future Twilio UAT retry schedule required' using errcode='23514'; end if;
    next_state:='retry_wait';
  else next_state:='failed'; end if;
  update public.twilio_real_number_uat_jobs set state=next_state,
    provider_final_status=case when next_state='succeeded' then target_provider_final_status else provider_final_status end,
    provider_evidence_hash=case when next_state='succeeded' then target_provider_evidence_hash else provider_evidence_hash end,
    last_error_category=case when next_state='succeeded' then null else target_error_category end,
    scheduled_at=case when next_state='retry_wait' then target_next_attempt_at else scheduled_at end,
    lease_owner=null,lease_expires_at=null,
    completed_at=case when next_state in ('succeeded','failed') then target_now else null end,updated_at=target_now
  where id=job.id returning * into job;
  if next_state='succeeded' then
    update public.twilio_connection_authorities set real_number_uat_evidence_hash=target_provider_evidence_hash,
      real_number_uat_at=target_now,updated_at=target_now where connection_id=job.connection_id returning * into authority;
    update public.connector_connections set status='active',last_error_category=null
    where id=job.connection_id and status in ('authorizing','degraded','reauthorization_required') returning * into connection;
    authority:=connector_private.refresh_twilio_readiness(job.connection_id,target_now);
    insert into public.connector_receipt_events(
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
      remote_operation_id,provider_status,redacted_metadata,occurred_at
    ) values (job.workspace_id,job.connection_id,'twilio','provider.final','twilio.uat.completed:'||job.id::text,
      job.correlation_id,target_provider_evidence_hash,job.provider_message_sid_hash,target_provider_final_status,
      jsonb_build_object('uatJobId',job.id,'readinessState',authority.readiness_state,
        'productionActivated',authority.readiness_state='active'),target_now);
  else
    select a.* into authority from public.twilio_connection_authorities a where a.connection_id=job.connection_id;
    select c.* into connection from public.connector_connections c where c.id=job.connection_id;
  end if;
  return jsonb_build_object('job',to_jsonb(job),'authority',to_jsonb(authority),
    'connection',to_jsonb(connection),'noOp',false);
end;
$$;

create or replace function public.cancel_twilio_uat_on_suppression()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.released_at is null then
    update public.twilio_real_number_uat_jobs set state='cancelled',lease_owner=null,lease_expires_at=null,
      last_error_category='recipient_opted_out',completed_at=new.updated_at,updated_at=new.updated_at
    where connection_id=new.connection_id and recipient_phone_hash=new.phone_hash
      and state in ('queued','leased','retry_wait') and side_effect_started_at is null;
  end if;
  return new;
end;
$$;

create trigger texting_phone_suppressions_cancel_twilio_uat
  after insert or update on public.texting_phone_suppressions
  for each row execute function public.cancel_twilio_uat_on_suppression();

create or replace function public.cancel_twilio_uat_on_connection_state()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='twilio' and new.status is distinct from old.status
     and new.status in ('revoking','disconnected','disconnected_unconfirmed') then
    update public.twilio_real_number_uat_jobs set state='cancelled',lease_owner=null,lease_expires_at=null,
      last_error_category='connection_disabled',completed_at=new.updated_at,updated_at=new.updated_at
    where connection_id=new.id and state in ('queued','leased','retry_wait') and side_effect_started_at is null;
  end if;
  return new;
end;
$$;

create trigger connector_connections_cancel_twilio_uat
  after update on public.connector_connections
  for each row execute function public.cancel_twilio_uat_on_connection_state();

revoke all on function public.read_twilio_setup_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.read_twilio_connection_readiness(uuid) from public,anon,authenticated,service_role;
revoke all on function public.bind_twilio_callback_routes(uuid,uuid,uuid,text,text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_twilio_callback_verification_authority(text,public.twilio_callback_kind,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.guard_twilio_callback_exact_route() from public,anon,authenticated,service_role;
revoke all on function public.register_and_apply_twilio_status_callback(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.request_twilio_real_number_uat(uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_twilio_real_number_uat_jobs(uuid,integer,integer,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.bind_twilio_real_number_uat_provider_message(uuid,uuid,bigint,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.cancel_twilio_uat_on_suppression() from public,anon,authenticated,service_role;
revoke all on function public.cancel_twilio_uat_on_connection_state() from public,anon,authenticated,service_role;

grant execute on function public.read_twilio_connection_readiness(uuid) to authenticated;
grant execute on function public.request_twilio_real_number_uat(uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,text,uuid) to authenticated;
grant execute on function public.read_twilio_setup_state(uuid,uuid,uuid) to service_role;
grant execute on function public.bind_twilio_callback_routes(uuid,uuid,uuid,text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.read_twilio_callback_verification_authority(text,public.twilio_callback_kind,timestamptz) to service_role;
grant execute on function public.register_and_apply_twilio_status_callback(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.claim_twilio_real_number_uat_jobs(uuid,integer,integer,timestamptz) to service_role;
grant execute on function public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.bind_twilio_real_number_uat_provider_message(uuid,uuid,bigint,text,text,timestamptz) to service_role;
grant execute on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) to service_role;

comment on function public.request_twilio_real_number_uat(uuid,uuid,uuid,text,jsonb,text,text,text,timestamptz,timestamptz,text,uuid) is
  'Owner-only controlled UAT request. It snapshots consent/policy/quiet-hours but does not enable ordinary message.send.';
comment on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) is
  'Only a fenced delivered/read provider result records real-number UAT evidence and activates Twilio.';
comment on function public.register_and_apply_twilio_status_callback(text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid) is
  'Service-only exact /status callback ingress. Signature verification remains over the exact URL outside SQL.';

commit;
