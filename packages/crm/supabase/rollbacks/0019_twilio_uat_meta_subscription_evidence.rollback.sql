-- Story 4.3/4.4 HIGH remediation / migration 0019 rollback.
-- PRE-WRITE ONLY. Signed UAT, STOP/cancellation and provider-subscription
-- evidence cannot be discarded by a schema rollback.

begin;

do $$ begin
  if exists(select 1 from public.twilio_real_number_uat_evidence_events)
     or exists(select 1 from public.twilio_real_number_uat_safety_probe_jobs)
     or exists(select 1 from public.meta_asset_subscription_events)
     or exists(select 1 from public.meta_asset_subscription_states) then
    raise exception using errcode='55000',
      message='0019 rollback refused: UAT or Meta subscription evidence exists; preserve history and use PITR or a reviewed forward remediation';
  end if;
end $$;

drop trigger if exists twilio_authority_guard_verified_activation on public.twilio_connection_authorities;
drop trigger if exists twilio_callbacks_capture_uat_stop on public.twilio_callback_events;
drop trigger if exists twilio_callbacks_capture_uat_insert on public.twilio_callback_events;
drop trigger if exists twilio_uat_create_safety_probe on public.twilio_real_number_uat_jobs;
drop trigger if exists meta_assets_initialize_subscription on public.meta_asset_bindings;

drop function public.read_meta_enquiry_review_authority(uuid,uuid,uuid,timestamptz);
drop function public.read_meta_revocation_authority(uuid,uuid,bigint,timestamptz);
drop function public.read_meta_asset_subscription_retry_authority(uuid,uuid,uuid,timestamptz);
drop function public.record_meta_asset_subscription_result(uuid,text,text,text,text,text,uuid,timestamptz);
drop function public.ensure_meta_subscription_pending();
drop function public.guard_twilio_verified_activation_fields();
drop function public.capture_twilio_uat_stop_application();
drop function public.capture_twilio_uat_callback_insert();
drop function connector_private.record_twilio_uat_evidence(uuid,public.twilio_uat_evidence_type,uuid,uuid,text,uuid,timestamptz);
drop function public.create_twilio_uat_safety_probe();

-- Frozen 0016–0018 functions are restored below before removing 0019 tables.

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

create or replace function public.read_meta_page_subscription_authority(
  target_connection_id uuid,target_asset_id_hash text,target_authenticated_user_id uuid,
  target_membership_id uuid,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare connection public.connector_connections%rowtype; authority public.meta_connection_authorities%rowtype;
 asset public.meta_asset_bindings%rowtype; identity connector_private.meta_asset_identities%rowtype;
 token connector_private.meta_page_access_token_bindings%rowtype;
 payload connector_private.connector_payload_envelopes%rowtype;
begin
  if target_asset_id_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid Facebook Page hash' using errcode='22023'; end if;
  select c.* into connection from public.connector_connections c
  where c.id=target_connection_id and c.provider='meta' and c.status in ('active','degraded');
  if not found or not exists(select 1 from public.workspace_members member
      where member.id=target_membership_id and member.workspace_id=connection.workspace_id
        and member.user_id=target_authenticated_user_id and member.role='owner' and member.status='active') then
    raise exception 'active owner Meta Page subscription binding required' using errcode='42501'; end if;
  select a.* into authority from public.meta_connection_authorities a
  where a.connection_id=connection.id and a.login_mode='facebook-page' and a.enabled
    and a.app_review_approved and a.business_verified
    and a.readiness_state in ('webhook_setup_required','webhook_challenge_required','active','degraded');
  if not found then raise exception 'Facebook Page subscription authority unavailable' using errcode='42501'; end if;
  select binding.* into asset from public.meta_asset_bindings binding
  where binding.connection_id=connection.id and binding.channel='facebook'
    and binding.asset_id_hash=target_asset_id_hash and binding.state='selected';
  if not found then raise exception 'selected Facebook Page unavailable' using errcode='P0002'; end if;
  select exact.* into strict identity from connector_private.meta_asset_identities exact where exact.asset_binding_id=asset.id;
  select binding.* into token from connector_private.meta_page_access_token_bindings binding
  where binding.asset_binding_id=asset.id and binding.connection_id=connection.id
    and binding.destroyed_at is null and (binding.expires_at is null or binding.expires_at>target_now);
  if not found then raise exception 'Facebook Page access token unavailable' using errcode='P0002'; end if;
  select envelope.* into payload from connector_private.connector_payload_envelopes envelope
  where envelope.id=token.token_payload_ref and envelope.workspace_id=connection.workspace_id
    and envelope.connection_id=connection.id and envelope.payload_kind='meta-page-access-token'
    and envelope.schema_version='meta-page-access-token.v1' and envelope.canonical_hash=token.token_hash
    and envelope.destroyed_at is null;
  if not found then raise exception 'Facebook Page token envelope unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('workspaceId',connection.workspace_id,'connectionId',connection.id,
    'graphVersion',authority.graph_version,'asset',jsonb_build_object('bindingId',asset.id,
      'assetIdHash',asset.asset_id_hash,'assetId',identity.asset_id,'displayLabel',asset.display_label),
    'pageAccessToken',connector_private.meta_page_token_payload_json(token,payload));
end;
$$;

create or replace function public.select_meta_assets(
  target_connection_id uuid,target_snapshot_hash text,target_asset_hashes text[],target_retention_days integer,
  target_retention_policy_hash text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
 target_authority public.meta_connection_authorities%rowtype; target_receipt public.connector_receipt_events%rowtype;
 assets jsonb;
begin
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta' and connection.status in ('active','degraded') for update;
  actor:=public.connector_current_membership(target_connection.workspace_id,true);
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled for update;
  if target_snapshot_hash<>target_authority.eligibility_snapshot_hash or target_snapshot_hash !~ '^[0-9a-f]{64}$'
     or cardinality(target_asset_hashes) not between 1 and 20
     or (select count(distinct value) from unnest(target_asset_hashes) value)<>cardinality(target_asset_hashes)
     or exists(select 1 from unnest(target_asset_hashes) value where value !~ '^[0-9a-f]{64}$')
     or target_retention_days not between 1 and 3650 or target_retention_policy_hash !~ '^[0-9a-f]{64}$'
     or (select count(*) from public.meta_asset_bindings binding where binding.connection_id=target_connection.id
       and binding.state='eligible' and binding.eligibility_snapshot_hash=target_snapshot_hash
       and binding.asset_id_hash=any(target_asset_hashes))<>cardinality(target_asset_hashes) then
    raise exception 'Meta asset selection is stale or invalid' using errcode='40001'; end if;
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
  if target_receipt.id is null then
    select receipt.* into strict target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_connection.workspace_id
      and receipt.event_key='meta.assets.selected:'||target_connection.id::text||':'||target_snapshot_hash;
  end if;
  return jsonb_build_object('authority',to_jsonb(target_authority),'selectedAssets',coalesce(assets,'[]'::jsonb),
    'receipt',to_jsonb(target_receipt));
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
       where route.connection_id=connection.id and route.revoked_at is null and route.status_external_url_hash is not null)
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

drop table public.meta_asset_subscription_states;
drop table public.meta_asset_subscription_events;
drop table public.twilio_real_number_uat_evidence_state;
drop table public.twilio_real_number_uat_evidence_events;
drop table public.twilio_real_number_uat_safety_probe_jobs;
drop type public.meta_asset_subscription_event_type;
drop type public.meta_asset_subscription_status;
drop type public.twilio_uat_evidence_type;

commit;
