-- Omnix — verified Twilio UAT sequence and retry-safe Meta subscriptions
-- Forward-only HIGH remediation after 0018. Frozen provider contracts remain
-- unchanged; this migration adds evidence/projection guards and bounded reads.

begin;

-- Twilio: four independent signed/side-effect facts are required. -----------

create type public.twilio_uat_evidence_type as enum (
  'delivery_callback_verified','inbound_reply_verified','stop_applied','pre_side_effect_cancelled'
);

create table public.twilio_real_number_uat_safety_probe_jobs (
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete restrict,
  connection_id uuid not null,uat_job_id uuid not null unique,recipient_phone_hash text not null,
  state text not null default 'queued',side_effect_started_at timestamptz,cancelled_at timestamptz,
  created_at timestamptz not null,updated_at timestamptz not null,
  constraint twilio_uat_probe_job_workspace_fk foreign key(uat_job_id,workspace_id)
    references public.twilio_real_number_uat_jobs(id,workspace_id) on delete restrict,
  constraint twilio_uat_probe_connection_workspace_fk foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint twilio_uat_probe_hash check(recipient_phone_hash ~ '^[0-9a-f]{64}$'),
  constraint twilio_uat_probe_id_workspace_unique unique(id,workspace_id),
  constraint twilio_uat_probe_state check((state='queued' and side_effect_started_at is null and cancelled_at is null)
    or (state='cancelled' and side_effect_started_at is null and cancelled_at is not null))
);

create table public.twilio_real_number_uat_evidence_events (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null,
  uat_job_id            uuid not null,
  evidence_type         public.twilio_uat_evidence_type not null,
  callback_event_id     uuid,
  canceled_probe_job_id uuid,
  evidence_hash         text not null,
  correlation_id        uuid not null,
  occurred_at           timestamptz not null,
  created_at            timestamptz not null,
  constraint twilio_uat_evidence_job_workspace_fk foreign key(uat_job_id,workspace_id)
    references public.twilio_real_number_uat_jobs(id,workspace_id) on delete restrict,
  constraint twilio_uat_evidence_connection_workspace_fk foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint twilio_uat_evidence_callback_workspace_fk foreign key(callback_event_id,workspace_id)
    references public.twilio_callback_events(id,workspace_id) on delete restrict,
  constraint twilio_uat_evidence_cancelled_probe_workspace_fk foreign key(canceled_probe_job_id,workspace_id)
    references public.twilio_real_number_uat_safety_probe_jobs(id,workspace_id) on delete restrict,
  constraint twilio_uat_evidence_one_type unique(uat_job_id,evidence_type),
  constraint twilio_uat_evidence_hash check(evidence_hash ~ '^[0-9a-f]{64}$'),
  constraint twilio_uat_evidence_binding check(
    (evidence_type in ('delivery_callback_verified','inbound_reply_verified','stop_applied') and callback_event_id is not null)
    or (evidence_type='pre_side_effect_cancelled' and callback_event_id is not null and canceled_probe_job_id is not null)
  )
);

create table public.twilio_real_number_uat_evidence_state (
  uat_job_id                    uuid primary key,
  workspace_id                  uuid not null references public.workspaces(id) on delete restrict,
  connection_id                 uuid not null,
  delivery_callback_verified_at timestamptz,
  inbound_reply_verified_at     timestamptz,
  stop_applied_at               timestamptz,
  pre_side_effect_cancelled_at  timestamptz,
  sequence_complete_at          timestamptz,
  evidence_count                integer not null default 0,
  updated_at                    timestamptz not null,
  constraint twilio_uat_evidence_state_job_workspace_fk foreign key(uat_job_id,workspace_id)
    references public.twilio_real_number_uat_jobs(id,workspace_id) on delete restrict,
  constraint twilio_uat_evidence_state_connection_workspace_fk foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint twilio_uat_evidence_state_count check(evidence_count between 0 and 4),
  constraint twilio_uat_evidence_state_complete check(
    (sequence_complete_at is null) or (
      delivery_callback_verified_at is not null and inbound_reply_verified_at is not null
      and stop_applied_at is not null and pre_side_effect_cancelled_at is not null
      and delivery_callback_verified_at<=inbound_reply_verified_at
      and inbound_reply_verified_at<=stop_applied_at
      and stop_applied_at<=pre_side_effect_cancelled_at
      and sequence_complete_at=pre_side_effect_cancelled_at
    )
  )
);

alter table public.twilio_real_number_uat_evidence_events enable row level security;
alter table public.twilio_real_number_uat_evidence_events force row level security;
alter table public.twilio_real_number_uat_evidence_state enable row level security;
alter table public.twilio_real_number_uat_evidence_state force row level security;
alter table public.twilio_real_number_uat_safety_probe_jobs enable row level security;
alter table public.twilio_real_number_uat_safety_probe_jobs force row level security;
create policy twilio_uat_evidence_events_member_select on public.twilio_real_number_uat_evidence_events
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy twilio_uat_evidence_state_member_select on public.twilio_real_number_uat_evidence_state
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy twilio_uat_probe_member_select on public.twilio_real_number_uat_safety_probe_jobs
  for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on table public.twilio_real_number_uat_evidence_events from public,anon,authenticated,service_role;
revoke all on table public.twilio_real_number_uat_evidence_state from public,anon,authenticated,service_role;
revoke all on table public.twilio_real_number_uat_safety_probe_jobs from public,anon,authenticated,service_role;
grant select on table public.twilio_real_number_uat_evidence_events to authenticated,service_role;
grant select on table public.twilio_real_number_uat_evidence_state to authenticated,service_role;
grant select on table public.twilio_real_number_uat_safety_probe_jobs to authenticated,service_role;
grant usage on type public.twilio_uat_evidence_type to authenticated,service_role;

create trigger twilio_uat_evidence_events_no_update before update or delete
  on public.twilio_real_number_uat_evidence_events for each row execute function public.guard_connector_append_only();

create or replace function public.create_twilio_uat_safety_probe()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.twilio_real_number_uat_safety_probe_jobs(workspace_id,connection_id,uat_job_id,
    recipient_phone_hash,state,created_at,updated_at)
  values(new.workspace_id,new.connection_id,new.id,new.recipient_phone_hash,'queued',new.created_at,new.created_at)
  on conflict(uat_job_id) do nothing;
  return new;
end;
$$;
create trigger twilio_uat_create_safety_probe after insert on public.twilio_real_number_uat_jobs
  for each row execute function public.create_twilio_uat_safety_probe();

create or replace function connector_private.record_twilio_uat_evidence(
  target_uat_job_id uuid,target_type public.twilio_uat_evidence_type,target_callback_event_id uuid,
  target_cancelled_probe_job_id uuid,target_evidence_hash text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; existing public.twilio_real_number_uat_evidence_events%rowtype;
 state public.twilio_real_number_uat_evidence_state%rowtype; inserted boolean:=false;
begin
  if target_evidence_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null or target_occurred_at is null then
    raise exception 'invalid Twilio UAT evidence' using errcode='22023'; end if;
  select j.* into strict job from public.twilio_real_number_uat_jobs j where j.id=target_uat_job_id for update;
  select e.* into existing from public.twilio_real_number_uat_evidence_events e
    where e.uat_job_id=job.id and e.evidence_type=target_type;
  if found then
    if existing.callback_event_id is distinct from target_callback_event_id
       or existing.canceled_probe_job_id is distinct from target_cancelled_probe_job_id
       or existing.evidence_hash<>target_evidence_hash then
      raise exception 'divergent Twilio UAT evidence replay' using errcode='23505'; end if;
    return false;
  end if;
  insert into public.twilio_real_number_uat_evidence_events(
    workspace_id,connection_id,uat_job_id,evidence_type,callback_event_id,canceled_probe_job_id,
    evidence_hash,correlation_id,occurred_at,created_at
  ) values (job.workspace_id,job.connection_id,job.id,target_type,target_callback_event_id,
    target_cancelled_probe_job_id,target_evidence_hash,target_correlation_id,target_occurred_at,target_occurred_at);
  inserted:=true;
  insert into public.twilio_real_number_uat_evidence_state(
    uat_job_id,workspace_id,connection_id,updated_at
  ) values(job.id,job.workspace_id,job.connection_id,target_occurred_at)
  on conflict(uat_job_id) do nothing;
  select s.* into strict state from public.twilio_real_number_uat_evidence_state s where s.uat_job_id=job.id for update;
  update public.twilio_real_number_uat_evidence_state set
    delivery_callback_verified_at=case when target_type='delivery_callback_verified' then target_occurred_at else delivery_callback_verified_at end,
    inbound_reply_verified_at=case when target_type='inbound_reply_verified' then target_occurred_at else inbound_reply_verified_at end,
    stop_applied_at=case when target_type='stop_applied' then target_occurred_at else stop_applied_at end,
    pre_side_effect_cancelled_at=case when target_type='pre_side_effect_cancelled' then target_occurred_at else pre_side_effect_cancelled_at end,
    evidence_count=evidence_count+1,updated_at=target_occurred_at
  where uat_job_id=job.id returning * into state;
  if state.delivery_callback_verified_at is not null and state.inbound_reply_verified_at is not null
     and state.stop_applied_at is not null and state.pre_side_effect_cancelled_at is not null
     and state.delivery_callback_verified_at<=state.inbound_reply_verified_at
     and state.inbound_reply_verified_at<=state.stop_applied_at
     and state.stop_applied_at<=state.pre_side_effect_cancelled_at then
    update public.twilio_real_number_uat_evidence_state set sequence_complete_at=state.pre_side_effect_cancelled_at,
      updated_at=target_occurred_at where uat_job_id=job.id;
  end if;
  return inserted;
end;
$$;

create or replace function public.capture_twilio_uat_callback_insert()
returns trigger language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; resource connector_private.twilio_real_number_uat_resources%rowtype;
begin
  if new.callback_kind='status' and new.provider_status in ('delivered','read') then
    select r.* into resource from connector_private.twilio_real_number_uat_resources r
      where r.connection_id=new.connection_id and r.provider_message_sid_hash=new.provider_message_sid_hash;
    if found then
      select j.* into strict job from public.twilio_real_number_uat_jobs j where j.id=resource.job_id;
      if new.received_at>=job.side_effect_started_at then
        perform connector_private.record_twilio_uat_evidence(job.id,'delivery_callback_verified',new.id,null,
          new.parameters_hash,new.correlation_id,new.received_at); end if;
    end if;
  elsif new.callback_kind='inbound' and new.keyword_class in ('none','help','start') then
    select j.* into job from public.twilio_real_number_uat_jobs j
      where j.connection_id=new.connection_id and j.recipient_phone_hash=new.counterpart_phone_hash
        and j.side_effect_started_at is not null and j.side_effect_started_at<=new.received_at
      order by j.side_effect_started_at desc,j.id limit 1;
    if found then perform connector_private.record_twilio_uat_evidence(job.id,'inbound_reply_verified',new.id,null,
      new.parameters_hash,new.correlation_id,new.received_at); end if;
  end if;
  return new;
end;
$$;

create or replace function public.capture_twilio_uat_stop_application()
returns trigger language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; probe public.twilio_real_number_uat_safety_probe_jobs%rowtype;
begin
  if new.callback_kind='inbound' and new.keyword_class='stop' and new.state='applied'
     and old.state is distinct from new.state then
    select j.* into job from public.twilio_real_number_uat_jobs j
      where j.connection_id=new.connection_id and j.recipient_phone_hash=new.counterpart_phone_hash
        and j.side_effect_started_at is not null and j.side_effect_started_at<=new.received_at
      order by j.side_effect_started_at desc,j.id limit 1;
    if found then
      perform connector_private.record_twilio_uat_evidence(job.id,'stop_applied',new.id,null,
        new.parameters_hash,new.correlation_id,new.processed_at);
      update public.twilio_real_number_uat_safety_probe_jobs set state='cancelled',cancelled_at=new.processed_at,
        updated_at=new.processed_at where uat_job_id=job.id and state='queued' and side_effect_started_at is null
        returning * into probe;
      if found then perform connector_private.record_twilio_uat_evidence(job.id,'pre_side_effect_cancelled',new.id,probe.id,
        encode(extensions.digest(pg_catalog.convert_to(probe.id::text||':'||new.parameters_hash,'UTF8'),'sha256'),'hex'),
        new.correlation_id,new.processed_at); end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger twilio_callbacks_capture_uat_insert after insert on public.twilio_callback_events
  for each row execute function public.capture_twilio_uat_callback_insert();
create trigger twilio_callbacks_capture_uat_stop after update of state on public.twilio_callback_events
  for each row execute function public.capture_twilio_uat_stop_application();

create or replace function public.guard_twilio_verified_activation_fields()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.callback_verified_at is not null or new.real_number_uat_at is not null
       or new.real_number_uat_evidence_hash is not null then
      raise exception 'Twilio activation evidence cannot be supplied declaratively' using errcode='42501'; end if;
  elsif coalesce(current_setting('omnix.twilio_verified_uat_activation',true),'')<>'on' then
    if old.callback_verified_at is null and new.callback_verified_at is not null
       or old.real_number_uat_at is null and new.real_number_uat_at is not null
       or old.real_number_uat_evidence_hash is null and new.real_number_uat_evidence_hash is not null then
      raise exception 'verified Twilio callback/UAT evidence required' using errcode='42501'; end if;
    new.callback_verified_at:=old.callback_verified_at;
    new.real_number_uat_at:=old.real_number_uat_at;
    new.real_number_uat_evidence_hash:=old.real_number_uat_evidence_hash;
  end if;
  return new;
end;
$$;
create trigger twilio_authority_guard_verified_activation before insert or update
  on public.twilio_connection_authorities for each row execute function public.guard_twilio_verified_activation_fields();

-- A real signed callback is one of the UAT outcomes. Requesting that UAT must
-- require two exact callback routes, but cannot require callback evidence that
-- the UAT itself has not produced yet.
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
     or authority.callback_verified_at is not null
     or authority.registration_state not in ('approved','not_required') or not authority.restricted_credential
     or authority.sender_ownership_verified_at is null
     or not exists(select 1 from connector_private.twilio_callback_authorities route
       where route.connection_id=connection.id and route.revoked_at is null
         and route.exact_external_url_hash is not null and route.status_external_url_hash is not null
         and route.exact_external_url_hash<>route.status_external_url_hash)
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
    and a.real_number_uat_at is null and a.callback_verified_at is null
    and a.registration_state in ('approved','not_required')
    and a.restricted_credential and a.sender_ownership_verified_at is not null;
  if not found or not exists(select 1 from connector_private.twilio_callback_authorities route
      where route.connection_id=job.connection_id and route.workspace_id=job.workspace_id
        and route.revoked_at is null and route.exact_external_url_hash is not null
        and route.status_external_url_hash is not null
        and route.exact_external_url_hash<>route.status_external_url_hash) then
    raise exception 'Twilio UAT pre-activation authority unavailable' using errcode='42501'; end if;
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

-- Replace only completion semantics: provider polling is necessary but never sufficient.
create or replace function public.transition_twilio_real_number_uat_job(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_outcome text,
  target_provider_final_status text,target_provider_evidence_hash text,target_error_category text,
  target_next_attempt_at timestamptz,target_now timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; authority public.twilio_connection_authorities%rowtype;
 connection public.connector_connections%rowtype; next_state public.twilio_real_number_uat_state;
 evidence public.twilio_real_number_uat_evidence_state%rowtype; combined_hash text;
begin
  if target_outcome not in ('delivered','retry','failed')
     or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$') then
    raise exception 'invalid Twilio UAT transition' using errcode='22023'; end if;
  select target.* into job from public.twilio_real_number_uat_jobs target where target.id=target_job_id for update;
  if not found then raise exception 'Twilio UAT job not found' using errcode='P0002'; end if;
  if job.state='succeeded' then
    if target_outcome='delivered' and job.provider_final_status=target_provider_final_status
       and job.provider_evidence_hash=target_provider_evidence_hash then
      return jsonb_build_object('job',to_jsonb(job),'evidence',(select to_jsonb(s) from public.twilio_real_number_uat_evidence_state s where s.uat_job_id=job.id),
        'authority',(select to_jsonb(a) from public.twilio_connection_authorities a where a.connection_id=job.connection_id),
        'connection',(select to_jsonb(c) from public.connector_connections c where c.id=job.connection_id),'noOp',true); end if;
    raise exception 'divergent Twilio UAT completion replay' using errcode='23505';
  end if;
  if job.state<>'executing' or job.lease_owner<>target_worker_id or job.fencing_token<>target_fencing_token
     or job.lease_expires_at<=target_now then raise exception 'stale Twilio UAT lease' using errcode='40001'; end if;
  if target_outcome='delivered' then
    if target_provider_final_status not in ('delivered','read') or target_provider_evidence_hash !~ '^[0-9a-f]{64}$'
       or not exists(select 1 from connector_private.twilio_real_number_uat_resources r
         where r.job_id=job.id and r.provider_message_sid_hash=job.provider_message_sid_hash) then
      raise exception 'provider-delivered Twilio UAT evidence required' using errcode='23514'; end if;
    select s.* into evidence from public.twilio_real_number_uat_evidence_state s
      where s.uat_job_id=job.id and s.sequence_complete_at is not null and s.evidence_count=4;
    if not found then raise exception 'complete signed Twilio UAT callback/reply/STOP/cancellation sequence required' using errcode='23514'; end if;
    next_state:='succeeded';
  elsif target_outcome='retry' and job.attempt_count<job.max_attempts then
    if target_next_attempt_at is null or target_next_attempt_at<=target_now then raise exception 'future Twilio UAT retry schedule required' using errcode='23514'; end if;
    next_state:='retry_wait';
  else next_state:='failed'; end if;
  update public.twilio_real_number_uat_jobs set state=next_state,
    provider_final_status=case when next_state='succeeded' then target_provider_final_status else provider_final_status end,
    provider_evidence_hash=case when next_state='succeeded' then target_provider_evidence_hash else provider_evidence_hash end,
    last_error_category=case when next_state='succeeded' then null else target_error_category end,
    scheduled_at=case when next_state='retry_wait' then target_next_attempt_at else scheduled_at end,
    lease_owner=null,lease_expires_at=null,completed_at=case when next_state in ('succeeded','failed') then target_now else null end,
    updated_at=target_now where id=job.id returning * into job;
  if next_state='succeeded' then
    combined_hash:=encode(extensions.digest(pg_catalog.convert_to(target_provider_evidence_hash||':'||
      (select string_agg(e.evidence_hash,':' order by e.evidence_type::text) from public.twilio_real_number_uat_evidence_events e where e.uat_job_id=job.id),'UTF8'),'sha256'),'hex');
    perform set_config('omnix.twilio_verified_uat_activation','on',true);
    update public.twilio_connection_authorities set callback_verified_at=evidence.sequence_complete_at,
      real_number_uat_evidence_hash=combined_hash,real_number_uat_at=target_now,updated_at=target_now
      where connection_id=job.connection_id returning * into authority;
    update public.connector_connections set status='active',last_error_category=null
      where id=job.connection_id and status in ('authorizing','degraded','reauthorization_required') returning * into connection;
    authority:=connector_private.refresh_twilio_readiness(job.connection_id,target_now);
    insert into public.connector_receipt_events(workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      provider_request_hash,remote_operation_id,provider_status,redacted_metadata,occurred_at)
    values(job.workspace_id,job.connection_id,'twilio','provider.final','twilio.uat.completed:'||job.id::text,
      job.correlation_id,combined_hash,job.provider_message_sid_hash,target_provider_final_status,
      jsonb_build_object('uatJobId',job.id,'evidenceCount',4,'readinessState',authority.readiness_state,
        'productionActivated',authority.readiness_state='active'),target_now);
  else
    select a.* into authority from public.twilio_connection_authorities a where a.connection_id=job.connection_id;
    select c.* into connection from public.connector_connections c where c.id=job.connection_id;
  end if;
  return jsonb_build_object('job',to_jsonb(job),'evidence',to_jsonb(evidence),'authority',to_jsonb(authority),
    'connection',to_jsonb(connection),'noOp',false);
end;
$$;

-- Meta: explicit retryable subscription attempts and durable redacted state. -

create type public.meta_asset_subscription_status as enum('pending','subscribed','failed','unsubscribed');
create type public.meta_asset_subscription_event_type as enum('attempted','subscribed','failed','unsubscribed');

create table public.meta_asset_subscription_events(
  id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete restrict,
  connection_id uuid not null,asset_binding_id uuid not null,event_type public.meta_asset_subscription_event_type not null,
  operation_key_hash text not null,provider_evidence_hash text,error_category text,correlation_id uuid not null,
  occurred_at timestamptz not null,created_at timestamptz not null,
  constraint meta_subscription_events_asset_workspace_fk foreign key(asset_binding_id,workspace_id)
    references public.meta_asset_bindings(id,workspace_id) on delete restrict,
  constraint meta_subscription_events_connection_workspace_fk foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_subscription_events_id_workspace_unique unique(id,workspace_id),
  constraint meta_subscription_events_operation_unique unique(connection_id,operation_key_hash),
  constraint meta_subscription_events_hashes check(operation_key_hash ~ '^[0-9a-f]{64}$'
    and (provider_evidence_hash is null or provider_evidence_hash ~ '^[0-9a-f]{64}$')
    and (error_category is null or error_category ~ '^[a-z][a-z0-9_.-]{1,79}$')),
  constraint meta_subscription_events_outcome check(
    (event_type in ('attempted','failed') and provider_evidence_hash is null)
    or (event_type in ('subscribed','unsubscribed') and provider_evidence_hash is not null))
);

create table public.meta_asset_subscription_states(
  asset_binding_id uuid primary key,workspace_id uuid not null references public.workspaces(id) on delete restrict,
  connection_id uuid not null,status public.meta_asset_subscription_status not null default 'pending',
  attempt_count integer not null default 0,last_event_id uuid not null,last_operation_key_hash text not null,
  last_provider_evidence_hash text,last_error_category text,last_attempt_at timestamptz,
  subscribed_at timestamptz,unsubscribed_at timestamptz,updated_at timestamptz not null,
  constraint meta_subscription_state_asset_workspace_fk foreign key(asset_binding_id,workspace_id)
    references public.meta_asset_bindings(id,workspace_id) on delete restrict,
  constraint meta_subscription_state_connection_workspace_fk foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_subscription_state_event_workspace_fk foreign key(last_event_id,workspace_id)
    references public.meta_asset_subscription_events(id,workspace_id) on delete restrict,
  constraint meta_subscription_state_values check(attempt_count>=0 and last_operation_key_hash ~ '^[0-9a-f]{64}$'
    and (last_provider_evidence_hash is null or last_provider_evidence_hash ~ '^[0-9a-f]{64}$')
    and (last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'))
);

alter table public.meta_asset_subscription_events enable row level security;
alter table public.meta_asset_subscription_events force row level security;
alter table public.meta_asset_subscription_states enable row level security;
alter table public.meta_asset_subscription_states force row level security;
create policy meta_subscription_events_member_select on public.meta_asset_subscription_events for select to authenticated
  using(public.has_workspace_access(workspace_id));
create policy meta_subscription_states_member_select on public.meta_asset_subscription_states for select to authenticated
  using(public.has_workspace_access(workspace_id));
revoke all on table public.meta_asset_subscription_events,public.meta_asset_subscription_states from public,anon,authenticated,service_role;
grant select on table public.meta_asset_subscription_events,public.meta_asset_subscription_states to authenticated,service_role;
grant usage on type public.meta_asset_subscription_status,public.meta_asset_subscription_event_type to authenticated,service_role;
create trigger meta_subscription_events_no_mutation before update or delete on public.meta_asset_subscription_events
  for each row execute function public.guard_connector_append_only();

create or replace function public.ensure_meta_subscription_pending()
returns trigger language plpgsql security definer set search_path='' as $$
declare event public.meta_asset_subscription_events%rowtype; key_hash text;
begin
  if new.state='selected' and old.state is distinct from new.state then
    key_hash:=encode(extensions.digest(pg_catalog.convert_to('selection:'||new.id::text||':'||new.eligibility_snapshot_hash,'UTF8'),'sha256'),'hex');
    insert into public.meta_asset_subscription_events(workspace_id,connection_id,asset_binding_id,event_type,
      operation_key_hash,correlation_id,occurred_at,created_at)
    values(new.workspace_id,new.connection_id,new.id,'attempted',key_hash,gen_random_uuid(),new.updated_at,new.updated_at)
    on conflict(connection_id,operation_key_hash) do nothing returning * into event;
    if event.id is null then select e.* into strict event from public.meta_asset_subscription_events e
      where e.connection_id=new.connection_id and e.operation_key_hash=key_hash; end if;
    insert into public.meta_asset_subscription_states(asset_binding_id,workspace_id,connection_id,status,attempt_count,
      last_event_id,last_operation_key_hash,last_attempt_at,updated_at)
    values(new.id,new.workspace_id,new.connection_id,'pending',1,event.id,key_hash,new.updated_at,new.updated_at)
    on conflict(asset_binding_id) do update set status='pending',
      attempt_count=public.meta_asset_subscription_states.attempt_count+1,last_event_id=excluded.last_event_id,
      last_operation_key_hash=excluded.last_operation_key_hash,last_attempt_at=excluded.last_attempt_at,
      last_error_category=null,updated_at=excluded.updated_at;
  end if;
  return new;
end;
$$;
create trigger meta_assets_initialize_subscription after update of state on public.meta_asset_bindings
  for each row execute function public.ensure_meta_subscription_pending();

-- Existing selected assets predate this projection. Give each one a
-- deterministic pending fact rather than treating local selection as remote
-- subscription success.
insert into public.meta_asset_subscription_events(
  workspace_id,connection_id,asset_binding_id,event_type,operation_key_hash,
  correlation_id,occurred_at,created_at
)
select asset.workspace_id,asset.connection_id,asset.id,'attempted',
  encode(extensions.digest(pg_catalog.convert_to(
    'selection-backfill:'||asset.id::text||':'||asset.eligibility_snapshot_hash,'UTF8'),'sha256'),'hex'),
  gen_random_uuid(),coalesce(asset.selected_at,asset.updated_at),coalesce(asset.selected_at,asset.updated_at)
from public.meta_asset_bindings asset where asset.state='selected'
on conflict(connection_id,operation_key_hash) do nothing;

insert into public.meta_asset_subscription_states(
  asset_binding_id,workspace_id,connection_id,status,attempt_count,last_event_id,
  last_operation_key_hash,last_attempt_at,updated_at
)
select asset.id,asset.workspace_id,asset.connection_id,'pending',1,event.id,
  event.operation_key_hash,event.occurred_at,event.occurred_at
from public.meta_asset_bindings asset
join public.meta_asset_subscription_events event on event.asset_binding_id=asset.id
 and event.operation_key_hash=encode(extensions.digest(pg_catalog.convert_to(
   'selection-backfill:'||asset.id::text||':'||asset.eligibility_snapshot_hash,'UTF8'),'sha256'),'hex')
where asset.state='selected'
on conflict(asset_binding_id) do nothing;

-- Exact selection replay is a no-op. This is the setup retry seam: failed or
-- pending provider subscription never forces the owner to rediscover/reselect
-- the same asset set, and it never resets a successful subscription fact.
create or replace function public.select_meta_assets(
  target_connection_id uuid,target_snapshot_hash text,target_asset_hashes text[],target_retention_days integer,
  target_retention_policy_hash text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
 target_authority public.meta_connection_authorities%rowtype; target_receipt public.connector_receipt_events%rowtype;
 assets jsonb; current_hashes text[]; normalized_hashes text[];
begin
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta'
    and connection.status in ('active','degraded') for update;
  actor:=public.connector_current_membership(target_connection.workspace_id,true);
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled for update;
  select array_agg(value order by value) into normalized_hashes from unnest(target_asset_hashes) value;
  select array_agg(binding.asset_id_hash order by binding.asset_id_hash) into current_hashes
  from public.meta_asset_bindings binding where binding.connection_id=target_connection.id and binding.state='selected';
  if target_snapshot_hash<>target_authority.eligibility_snapshot_hash or target_snapshot_hash !~ '^[0-9a-f]{64}$'
     or cardinality(target_asset_hashes) not between 1 and 20
     or (select count(distinct value) from unnest(target_asset_hashes) value)<>cardinality(target_asset_hashes)
     or exists(select 1 from unnest(target_asset_hashes) value where value !~ '^[0-9a-f]{64}$')
     or target_retention_days not between 1 and 3650 or target_retention_policy_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null or target_occurred_at is null
     or (select count(*) from public.meta_asset_bindings binding where binding.connection_id=target_connection.id
       and binding.state in ('eligible','selected') and binding.eligibility_snapshot_hash=target_snapshot_hash
       and binding.asset_id_hash=any(target_asset_hashes))<>cardinality(target_asset_hashes) then
    raise exception 'Meta asset selection is stale or invalid' using errcode='40001'; end if;
  if current_hashes=normalized_hashes
     and target_authority.selected_asset_snapshot_hash=target_snapshot_hash
     and target_authority.retention_days=target_retention_days
     and target_authority.retention_policy_hash=target_retention_policy_hash then
    select jsonb_agg(to_jsonb(binding) order by binding.channel,binding.display_label,binding.id) into assets
    from public.meta_asset_bindings binding where binding.connection_id=target_connection.id and binding.state='selected';
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_connection.workspace_id
      and receipt.event_key='meta.assets.selected:'||target_connection.id::text||':'||target_snapshot_hash;
    return jsonb_build_object('authority',to_jsonb(target_authority),'selectedAssets',coalesce(assets,'[]'::jsonb),
      'receipt',case when target_receipt.id is null then null else to_jsonb(target_receipt) end,'noOp',true);
  end if;
  update public.meta_asset_bindings set state='eligible',selected_at=null,removed_at=null,updated_at=target_occurred_at
  where connection_id=target_connection.id and state='selected';
  update public.meta_asset_bindings set state='selected',selected_at=target_occurred_at,removed_at=null,updated_at=target_occurred_at
  where connection_id=target_connection.id and state='eligible' and asset_id_hash=any(target_asset_hashes);
  update public.meta_connection_authorities set selected_asset_snapshot_hash=target_snapshot_hash,
    retention_days=target_retention_days,retention_policy_hash=target_retention_policy_hash,
    selected_by_membership_id=actor.id,selected_at=target_occurred_at,
    readiness_state='webhook_setup_required',webhook_challenge_confirmed=false,updated_at=target_occurred_at
  where connection_id=target_connection.id returning * into target_authority;
  select jsonb_agg(to_jsonb(binding) order by binding.channel,binding.display_label,binding.id) into assets
  from public.meta_asset_bindings binding where binding.connection_id=target_connection.id and binding.state='selected';
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'meta','sync.applied',
    'meta.assets.selected:'||target_connection.id::text||':'||target_snapshot_hash,target_correlation_id,target_snapshot_hash,
    jsonb_build_object('assetCount',cardinality(target_asset_hashes),'snapshotHash',target_snapshot_hash,
      'graphVersion',target_authority.graph_version,'inboundOnly',true),target_occurred_at
  ) on conflict(workspace_id,event_key) do nothing returning * into target_receipt;
  if target_receipt.id is null then select receipt.* into strict target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_connection.workspace_id
      and receipt.event_key='meta.assets.selected:'||target_connection.id::text||':'||target_snapshot_hash; end if;
  return jsonb_build_object('authority',to_jsonb(target_authority),'selectedAssets',coalesce(assets,'[]'::jsonb),
    'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.record_meta_asset_subscription_result(
  target_connection_id uuid,target_asset_id_hash text,target_outcome text,target_operation_key_hash text,
  target_provider_evidence_hash text,target_error_category text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare connection public.connector_connections%rowtype; asset public.meta_asset_bindings%rowtype;
 event public.meta_asset_subscription_events%rowtype; state public.meta_asset_subscription_states%rowtype;
 event_type public.meta_asset_subscription_event_type;
begin
  if target_outcome not in ('attempted','subscribed','failed','unsubscribed')
     or target_asset_id_hash !~ '^[0-9a-f]{64}$' or target_operation_key_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null or target_occurred_at is null
     or (target_outcome in ('subscribed','unsubscribed') and target_provider_evidence_hash !~ '^[0-9a-f]{64}$')
     or (target_outcome in ('attempted','failed') and target_provider_evidence_hash is not null)
     or (target_outcome='failed' and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$') then
    raise exception 'invalid Meta subscription result' using errcode='22023'; end if;
  select c.* into connection from public.connector_connections c where c.id=target_connection_id
    and c.provider='meta' and c.status in ('active','degraded','revoking') for update;
  if not found then raise exception 'Meta connection unavailable' using errcode='42501'; end if;
  select a.* into asset from public.meta_asset_bindings a where a.connection_id=connection.id
    and a.asset_id_hash=target_asset_id_hash and (a.state='selected' or target_outcome='unsubscribed') for update;
  if not found then raise exception 'selected Meta asset unavailable' using errcode='P0002'; end if;
  event_type:=target_outcome::public.meta_asset_subscription_event_type;
  select e.* into event from public.meta_asset_subscription_events e
    where e.connection_id=connection.id and e.operation_key_hash=target_operation_key_hash;
  if found then
    if event.asset_binding_id<>asset.id or event.event_type<>event_type
       or event.provider_evidence_hash is distinct from target_provider_evidence_hash
       or event.error_category is distinct from target_error_category then
      raise exception 'divergent Meta subscription replay' using errcode='23505'; end if;
    select s.* into state from public.meta_asset_subscription_states s where s.asset_binding_id=asset.id;
    return jsonb_build_object('event',to_jsonb(event),'state',to_jsonb(state),'noOp',true);
  end if;
  insert into public.meta_asset_subscription_events(workspace_id,connection_id,asset_binding_id,event_type,
    operation_key_hash,provider_evidence_hash,error_category,correlation_id,occurred_at,created_at)
  values(connection.workspace_id,connection.id,asset.id,event_type,target_operation_key_hash,
    target_provider_evidence_hash,target_error_category,target_correlation_id,target_occurred_at,target_occurred_at)
  returning * into event;
  insert into public.meta_asset_subscription_states(asset_binding_id,workspace_id,connection_id,status,attempt_count,
    last_event_id,last_operation_key_hash,last_provider_evidence_hash,last_error_category,last_attempt_at,
    subscribed_at,unsubscribed_at,updated_at)
  values(asset.id,connection.workspace_id,connection.id,
    case target_outcome when 'attempted' then 'pending' when 'subscribed' then 'subscribed'
      when 'failed' then 'failed' else 'unsubscribed' end::public.meta_asset_subscription_status,
    case when target_outcome='attempted' then 1 else 0 end,event.id,target_operation_key_hash,
    target_provider_evidence_hash,target_error_category,
    case when target_outcome='attempted' then target_occurred_at else null end,
    case when target_outcome='subscribed' then target_occurred_at else null end,
    case when target_outcome='unsubscribed' then target_occurred_at else null end,target_occurred_at)
  on conflict(asset_binding_id) do update set status=excluded.status,
    attempt_count=public.meta_asset_subscription_states.attempt_count+case when target_outcome='attempted' then 1 else 0 end,
    last_event_id=excluded.last_event_id,last_operation_key_hash=excluded.last_operation_key_hash,
    last_provider_evidence_hash=excluded.last_provider_evidence_hash,last_error_category=excluded.last_error_category,
    last_attempt_at=coalesce(excluded.last_attempt_at,public.meta_asset_subscription_states.last_attempt_at),
    subscribed_at=coalesce(excluded.subscribed_at,public.meta_asset_subscription_states.subscribed_at),
    unsubscribed_at=coalesce(excluded.unsubscribed_at,public.meta_asset_subscription_states.unsubscribed_at),
    updated_at=excluded.updated_at returning * into state;
  return jsonb_build_object('event',to_jsonb(event),'state',to_jsonb(state),'noOp',false);
end;
$$;

-- Add retry state to the existing selected-Page token authority without changing its signature.
create or replace function public.read_meta_page_subscription_authority(
  target_connection_id uuid,target_asset_id_hash text,target_authenticated_user_id uuid,
  target_membership_id uuid,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare connection public.connector_connections%rowtype; authority public.meta_connection_authorities%rowtype;
 asset public.meta_asset_bindings%rowtype; identity connector_private.meta_asset_identities%rowtype;
 token connector_private.meta_page_access_token_bindings%rowtype; payload connector_private.connector_payload_envelopes%rowtype;
 subscription public.meta_asset_subscription_states%rowtype;
begin
  if target_asset_id_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid Facebook Page hash' using errcode='22023'; end if;
  select c.* into connection from public.connector_connections c where c.id=target_connection_id and c.provider='meta'
    and c.status in ('active','degraded');
  if not found or not exists(select 1 from public.workspace_members m where m.id=target_membership_id
      and m.workspace_id=connection.workspace_id and m.user_id=target_authenticated_user_id and m.role='owner' and m.status='active') then
    raise exception 'active owner Meta Page subscription binding required' using errcode='42501'; end if;
  select a.* into authority from public.meta_connection_authorities a where a.connection_id=connection.id
    and a.login_mode='facebook-page' and a.enabled and a.app_review_approved and a.business_verified
    and a.readiness_state in ('webhook_setup_required','webhook_challenge_required','active','degraded');
  if not found then raise exception 'Facebook Page subscription authority unavailable' using errcode='42501'; end if;
  select b.* into asset from public.meta_asset_bindings b where b.connection_id=connection.id
    and b.channel='facebook' and b.asset_id_hash=target_asset_id_hash and b.state='selected';
  if not found then raise exception 'selected Facebook Page unavailable' using errcode='P0002'; end if;
  select exact.* into strict identity from connector_private.meta_asset_identities exact where exact.asset_binding_id=asset.id;
  select b.* into token from connector_private.meta_page_access_token_bindings b where b.asset_binding_id=asset.id
    and b.connection_id=connection.id and b.destroyed_at is null and (b.expires_at is null or b.expires_at>target_now);
  if not found then raise exception 'Facebook Page access token unavailable' using errcode='P0002'; end if;
  select e.* into payload from connector_private.connector_payload_envelopes e where e.id=token.token_payload_ref
    and e.workspace_id=connection.workspace_id and e.connection_id=connection.id and e.payload_kind='meta-page-access-token'
    and e.schema_version='meta-page-access-token.v1' and e.canonical_hash=token.token_hash and e.destroyed_at is null;
  if not found then raise exception 'Facebook Page token envelope unavailable' using errcode='P0002'; end if;
  select s.* into subscription from public.meta_asset_subscription_states s where s.asset_binding_id=asset.id;
  return jsonb_build_object('workspaceId',connection.workspace_id,'connectionId',connection.id,'graphVersion',authority.graph_version,
    'asset',jsonb_build_object('bindingId',asset.id,'assetIdHash',asset.asset_id_hash,'assetId',identity.asset_id,'displayLabel',asset.display_label),
    'subscriptionState',case when subscription.asset_binding_id is null then null else to_jsonb(subscription) end,
    'retryAllowed',subscription.asset_binding_id is null or subscription.status in ('pending','failed','unsubscribed'),
    'pageAccessToken',connector_private.meta_page_token_payload_json(token,payload));
end;
$$;

create or replace function public.read_meta_asset_subscription_retry_authority(
  target_connection_id uuid,target_authenticated_user_id uuid,target_membership_id uuid,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare connection public.connector_connections%rowtype; authority public.meta_connection_authorities%rowtype;
 access_secret connector_private.connector_connection_secrets%rowtype; assets jsonb; selected_count integer;
begin
  select c.* into connection from public.connector_connections c where c.id=target_connection_id
    and c.provider='meta' and c.status in ('active','degraded');
  if not found or not exists(select 1 from public.workspace_members member
      where member.id=target_membership_id and member.workspace_id=connection.workspace_id
        and member.user_id=target_authenticated_user_id and member.role='owner' and member.status='active') then
    raise exception 'active Meta owner subscription retry binding required' using errcode='42501'; end if;
  select a.* into authority from public.meta_connection_authorities a where a.connection_id=connection.id
    and a.enabled and a.business_verified and a.app_review_approved
    and a.version_approved_by_membership_id is not null and a.version_reviewed_at is not null;
  if not found then raise exception 'Meta subscription retry authority unavailable' using errcode='42501'; end if;
  select s.* into access_secret from connector_private.connector_connection_secrets s
    where s.connection_id=connection.id and s.workspace_id=connection.workspace_id
      and s.secret_type='meta-access-token' and s.destroyed_at is null
      and (s.expires_at is null or s.expires_at>target_now);
  if not found then raise exception 'Meta subscription access token unavailable' using errcode='P0002'; end if;
  select count(*) into selected_count from public.meta_asset_bindings asset
    where asset.connection_id=connection.id and asset.state='selected';
  if selected_count=0 or exists(select 1 from public.meta_asset_bindings asset
      left join public.meta_asset_subscription_states state on state.asset_binding_id=asset.id
      where asset.connection_id=connection.id and asset.state='selected'
        and (state.asset_binding_id is null or state.status not in ('pending','failed','unsubscribed','subscribed')))
     or not exists(select 1 from public.meta_asset_bindings asset
      join public.meta_asset_subscription_states state on state.asset_binding_id=asset.id
      where asset.connection_id=connection.id and asset.state='selected'
        and state.status in ('pending','failed','unsubscribed')) then
    raise exception 'no retryable selected Meta subscription' using errcode='P0002'; end if;
  if authority.login_mode='facebook-page' and exists(select 1 from public.meta_asset_bindings asset
      where asset.connection_id=connection.id and asset.state='selected' and (
        asset.channel<>'facebook' or not exists(select 1
          from connector_private.meta_page_access_token_bindings token
          join connector_private.connector_payload_envelopes payload on payload.id=token.token_payload_ref
            and payload.workspace_id=asset.workspace_id and payload.connection_id=asset.connection_id
          where token.asset_binding_id=asset.id and token.workspace_id=asset.workspace_id
            and token.connection_id=asset.connection_id and token.destroyed_at is null
            and (token.expires_at is null or token.expires_at>target_now)
            and payload.payload_kind='meta-page-access-token'
            and payload.schema_version='meta-page-access-token.v1'
            and payload.canonical_hash=token.token_hash and payload.destroyed_at is null))) then
    raise exception 'complete selected Page retry tokens required' using errcode='P0002'; end if;
  if authority.login_mode='instagram-login' and exists(select 1 from public.meta_asset_bindings asset
      where asset.connection_id=connection.id and asset.state='selected' and asset.channel<>'instagram') then
    raise exception 'Instagram Login selected-asset channel drift' using errcode='42501'; end if;
  select jsonb_agg(jsonb_build_object('bindingId',asset.id,'channel',asset.channel,
    'assetIdHash',asset.asset_id_hash,'assetId',identity.asset_id,
    'subscriptionState',to_jsonb(state),'retryAllowed',state.status in ('pending','failed','unsubscribed'),
    'pageAccessToken',case when authority.login_mode='facebook-page'
      then connector_private.meta_page_token_payload_json(page_token,page_payload) else null end)
    order by asset.channel,asset.id) into assets
  from public.meta_asset_bindings asset
  join connector_private.meta_asset_identities identity on identity.asset_binding_id=asset.id
  join public.meta_asset_subscription_states state on state.asset_binding_id=asset.id
  left join connector_private.meta_page_access_token_bindings page_token on page_token.asset_binding_id=asset.id
    and page_token.destroyed_at is null and (page_token.expires_at is null or page_token.expires_at>target_now)
  left join connector_private.connector_payload_envelopes page_payload on page_payload.id=page_token.token_payload_ref
    and page_payload.destroyed_at is null
  where asset.connection_id=connection.id and asset.state='selected';
  return jsonb_build_object('workspaceId',connection.workspace_id,'connectionId',connection.id,
    'graphVersion',authority.graph_version,'loginMode',authority.login_mode,'selectedAssets',assets,
    'connectionAccessToken',connector_private.meta_secret_json(access_secret));
end;
$$;

-- Meta revocation and human-review reads. -----------------------------------

create or replace function public.read_meta_revocation_authority(
  target_revocation_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare job public.connector_revocation_jobs%rowtype; connection public.connector_connections%rowtype;
 authority public.meta_connection_authorities%rowtype; access_secret connector_private.connector_connection_secrets%rowtype;
 assets jsonb;
begin
  select j.* into job from public.connector_revocation_jobs j where j.id=target_revocation_job_id
    and j.provider='meta' and j.state in ('leased','executing') and j.lease_owner=target_worker_id
    and j.fencing_token=target_fencing_token and j.lease_expires_at>target_now;
  if not found then raise exception 'active fenced Meta revocation required' using errcode='42501'; end if;
  select c.* into strict connection from public.connector_connections c where c.id=job.connection_id
    and c.workspace_id=job.workspace_id and c.provider='meta' and c.status='revoking';
  select a.* into strict authority from public.meta_connection_authorities a where a.connection_id=connection.id;
  select s.* into access_secret from connector_private.connector_connection_secrets s where s.connection_id=connection.id
    and s.workspace_id=connection.workspace_id and s.secret_type='meta-access-token' and s.destroyed_at is null
    and (s.expires_at is null or s.expires_at>target_now);
  if not found then raise exception 'Meta revocation access token unavailable' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('bindingId',asset.id,'channel',asset.channel,
    'assetIdHash',asset.asset_id_hash,'assetId',identity.asset_id,'subscriptionState',subscription.status,
    'pageAccessToken',case when authority.login_mode='facebook-page' then
      connector_private.meta_page_token_payload_json(page_token,page_payload) else null end)
    order by asset.channel,asset.id),'[]'::jsonb) into assets
  from public.meta_asset_bindings asset
  join connector_private.meta_asset_identities identity on identity.asset_binding_id=asset.id
  left join public.meta_asset_subscription_states subscription on subscription.asset_binding_id=asset.id
  left join connector_private.meta_page_access_token_bindings page_token on page_token.asset_binding_id=asset.id
    and page_token.destroyed_at is null and (page_token.expires_at is null or page_token.expires_at>target_now)
  left join connector_private.connector_payload_envelopes page_payload on page_payload.id=page_token.token_payload_ref
    and page_payload.destroyed_at is null
  where asset.connection_id=connection.id and asset.state='selected';
  if authority.login_mode='facebook-page' and exists(select 1 from public.meta_asset_bindings a
      where a.connection_id=connection.id and a.state='selected' and not exists(select 1
        from connector_private.meta_page_access_token_bindings t
        join connector_private.connector_payload_envelopes p on p.id=t.token_payload_ref
          and p.workspace_id=a.workspace_id and p.connection_id=a.connection_id
        where t.asset_binding_id=a.id and t.workspace_id=a.workspace_id and t.connection_id=a.connection_id
          and p.payload_kind='meta-page-access-token' and p.schema_version='meta-page-access-token.v1'
          and t.token_payload_ref=p.id and t.token_hash=p.canonical_hash
          and t.destroyed_at is null and (t.expires_at is null or t.expires_at>target_now)
          and p.destroyed_at is null)) then
    raise exception 'complete selected Page revocation tokens required' using errcode='P0002'; end if;
  return jsonb_build_object('revocationJob',jsonb_build_object('id',job.id,'workspaceId',job.workspace_id,
    'connectionId',job.connection_id,'state',job.state,'fencingToken',job.fencing_token,'correlationId',job.correlation_id),
    'graphVersion',authority.graph_version,'loginMode',authority.login_mode,'selectedAssets',assets,
    'connectionAccessToken',connector_private.meta_secret_json(access_secret));
end;
$$;

create or replace function public.read_meta_enquiry_review_authority(
  target_event_id uuid,target_authenticated_user_id uuid,target_membership_id uuid,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare event public.meta_inbound_events%rowtype; payload connector_private.connector_payload_envelopes%rowtype;
 conversation public.meta_conversations%rowtype; external_identity public.meta_external_identities%rowtype;
begin
  if target_now is null then raise exception 'review authority time required' using errcode='22023'; end if;
  select e.* into event from public.meta_inbound_events e where e.id=target_event_id and e.state='review';
  if not found or not exists(select 1 from public.workspace_members m where m.id=target_membership_id
      and m.workspace_id=event.workspace_id and m.user_id=target_authenticated_user_id
      and m.status='active' and m.role in ('owner','assistant')) then
    raise exception 'active workspace reviewer authority required' using errcode='42501'; end if;
  select p.* into payload from connector_private.connector_payload_envelopes p where p.id=event.content_payload_ref
    and p.workspace_id=event.workspace_id and p.connection_id=event.connection_id
    and p.payload_kind='meta-inbound-message' and p.schema_version='meta-inbound-message.v1'
    and p.canonical_hash=event.content_hash and p.destroyed_at is null;
  if not found then raise exception 'Meta review content unavailable' using errcode='P0002'; end if;
  select c.* into strict conversation from public.meta_conversations c where c.id=event.conversation_id;
  select i.* into strict external_identity from public.meta_external_identities i where i.id=event.external_identity_id;
  return jsonb_build_object('event',jsonb_build_object('id',event.id,'workspaceId',event.workspace_id,
    'connectionId',event.connection_id,'channel',event.channel,'state',event.state,'reviewReason',event.review_reason,
    'attachmentTypes',event.attachment_types,'providerOccurredAt',event.provider_occurred_at,
    'receivedAt',event.received_at,'contentHash',event.content_hash,'incompleteRecordId',event.incomplete_record_id,
    'conversationId',event.conversation_id,'assetBindingId',event.asset_binding_id),
    'provenance',jsonb_build_object('conversationKeyHash',conversation.conversation_key_hash,
      'senderKeyHash',external_identity.sender_key_hash,'eventKeyHash',event.event_key_hash,
      'messageKeyHash',event.message_key_hash,'correlationId',event.correlation_id),
    'payloadEnvelope',connector_private.meta_payload_json(payload));
end;
$$;

revoke all on function connector_private.record_twilio_uat_evidence(uuid,public.twilio_uat_evidence_type,uuid,uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.create_twilio_uat_safety_probe() from public,anon,authenticated,service_role;
revoke all on function public.capture_twilio_uat_callback_insert() from public,anon,authenticated,service_role;
revoke all on function public.capture_twilio_uat_stop_application() from public,anon,authenticated,service_role;
revoke all on function public.guard_twilio_verified_activation_fields() from public,anon,authenticated,service_role;
revoke all on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) to service_role;
revoke all on function public.ensure_meta_subscription_pending() from public,anon,authenticated,service_role;
revoke all on function public.record_meta_asset_subscription_result(uuid,text,text,text,text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.record_meta_asset_subscription_result(uuid,text,text,text,text,text,uuid,timestamptz) to service_role;
revoke all on function public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.read_meta_page_subscription_authority(uuid,text,uuid,uuid,timestamptz) to service_role;
revoke all on function public.read_meta_asset_subscription_retry_authority(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.read_meta_asset_subscription_retry_authority(uuid,uuid,uuid,timestamptz) to service_role;
revoke all on function public.read_meta_revocation_authority(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.read_meta_revocation_authority(uuid,uuid,bigint,timestamptz) to service_role;
revoke all on function public.read_meta_enquiry_review_authority(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.read_meta_enquiry_review_authority(uuid,uuid,uuid,timestamptz) to service_role;

comment on table public.twilio_real_number_uat_evidence_events is 'Append-only redacted signed callback/reply/STOP/pre-side-effect cancellation evidence; all four ordered facts gate activation.';
comment on table public.meta_asset_subscription_states is 'Redacted retryable selected-asset subscription projection; local selection is never claimed as provider subscription success.';
comment on function public.read_meta_asset_subscription_retry_authority(uuid,uuid,uuid,timestamptz) is 'Owner-bound service authority for retrying only pending/failed/unsubscribed selected Facebook Page or Instagram subscriptions.';
comment on function public.read_meta_revocation_authority(uuid,uuid,bigint,timestamptz) is 'Lease/fence-only Meta token and exact selected-asset authority for provider unsubscribe/revoke calls.';
comment on function public.read_meta_enquiry_review_authority(uuid,uuid,uuid,timestamptz) is 'Service-only active reviewer-bound encrypted content read with hash-only provenance.';

commit;
