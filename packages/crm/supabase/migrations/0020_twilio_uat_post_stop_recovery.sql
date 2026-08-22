-- Omnix — Twilio UAT post-STOP fenced recovery
-- Forward-only HIGH remediation after 0019. No new provider-side send is
-- authorized after the exact UAT provider SID has been bound.

begin;

-- [AUTO-DECISION] Preserve the frozen signatures and distinguish initial
-- side-effect authority from crash/retry recovery by the immutable first
-- side_effect_started_at plus the exact private provider-SID binding.

create or replace function public.start_twilio_real_number_uat_attempt(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_started_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype;
 evidence_complete boolean:=false; consent_current boolean:=false; sid_bound boolean:=false;
begin
  select target.* into job from public.twilio_real_number_uat_jobs target
  where target.id=target_job_id for update;
  if not found then raise exception 'Twilio UAT job not found' using errcode='P0002'; end if;
  if job.state<>'leased' or job.lease_owner<>target_worker_id or job.fencing_token<>target_fencing_token
     or job.lease_expires_at<=target_started_at then
    raise exception 'stale Twilio UAT lease' using errcode='40001'; end if;

  select exists(select 1 from public.texting_consent_states state
      where state.connection_id=job.connection_id and state.contact_point_id=job.contact_point_id
        and state.current_event_id=job.consent_event_id and state.status='opted_in'
        and state.policy_id=job.texting_policy_id and state.policy_version=job.texting_policy_version)
    and not exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=job.connection_id
        and suppression.phone_hash=job.recipient_phone_hash and suppression.released_at is null)
  into consent_current;
  select exists(select 1 from public.twilio_real_number_uat_evidence_state evidence
      where evidence.uat_job_id=job.id and evidence.workspace_id=job.workspace_id
        and evidence.connection_id=job.connection_id and evidence.evidence_count=4
        and evidence.sequence_complete_at is not null)
  into evidence_complete;
  select exists(select 1 from connector_private.twilio_real_number_uat_resources resource
      where resource.job_id=job.id and resource.workspace_id=job.workspace_id
        and resource.connection_id=job.connection_id
        and resource.provider_message_sid_hash=job.provider_message_sid_hash)
  into sid_bound;

  if job.side_effect_started_at is null then
    if not consent_current then
      raise exception 'Twilio UAT consent changed before side effect' using errcode='42501'; end if;
  elsif not consent_current and not (evidence_complete and sid_bound) then
    raise exception 'complete same-job Twilio UAT evidence required after opt-out' using errcode='42501';
  end if;

  update public.twilio_real_number_uat_jobs set state='executing',attempt_count=attempt_count+1,
    side_effect_started_at=coalesce(side_effect_started_at,target_started_at),updated_at=target_started_at
  where id=job.id returning * into job;
  return jsonb_build_object('job',to_jsonb(job),'evidenceComplete',evidence_complete);
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
 evidence_complete boolean:=false; consent_current boolean:=false;
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

  select r.* into resource from connector_private.twilio_real_number_uat_resources r
    where r.job_id=job.id and r.workspace_id=job.workspace_id and r.connection_id=job.connection_id
      and r.provider_message_sid_hash=job.provider_message_sid_hash;
  select exists(select 1 from public.twilio_real_number_uat_evidence_state evidence
      where evidence.uat_job_id=job.id and evidence.workspace_id=job.workspace_id
        and evidence.connection_id=job.connection_id and evidence.evidence_count=4
        and evidence.sequence_complete_at is not null)
  into evidence_complete;
  select exists(select 1 from public.texting_consent_states state
      where state.connection_id=job.connection_id and state.contact_point_id=job.contact_point_id
        and state.current_event_id=job.consent_event_id and state.status='opted_in'
        and state.policy_id=job.texting_policy_id and state.policy_version=job.texting_policy_version)
    and not exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=job.connection_id
        and suppression.phone_hash=job.recipient_phone_hash and suppression.released_at is null)
  into consent_current;
  if job.side_effect_started_at is null then
    if not consent_current then
      raise exception 'Twilio UAT consent authority unavailable' using errcode='42501'; end if;
  elsif not consent_current and not (evidence_complete and resource.job_id is not null) then
    raise exception 'complete same-job Twilio UAT evidence required after opt-out' using errcode='42501';
  end if;

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
  return jsonb_build_object('job',to_jsonb(job),'connection',to_jsonb(connection),'authority',to_jsonb(authority),
    'policy',to_jsonb(policy),'providerAuthority',connector_private.twilio_secret_json(provider_secret),
    'apiCredential',connector_private.twilio_secret_json(api_secret),'evidenceComplete',evidence_complete,
    'executionMode',case when resource.job_id is null then 'send' else 'lookup-only' end,
    'payloadEnvelope',case when resource.job_id is null then connector_private.twilio_payload_json(payload) else null end,
    'providerMessageBinding',case when resource.job_id is null then null else jsonb_build_object(
      'providerMessageSid',resource.provider_message_sid,'providerMessageSidHash',resource.provider_message_sid_hash,
      'boundAt',resource.created_at) end);
end;
$$;

revoke all on function public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz) to service_role;
revoke all on function public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz) to service_role;

comment on function public.start_twilio_real_number_uat_attempt(uuid,uuid,bigint,timestamptz) is
  'Initial UAT side-effect requires current opt-in; post-STOP fenced recovery requires the same job complete signed evidence and bound SID.';
comment on function public.read_twilio_real_number_uat_authority(uuid,uuid,bigint,timestamptz) is
  'Fenced UAT authority with additive evidenceComplete; a bound SID always yields lookup-only and never resend authority.';

-- Waiting for a human reply/STOP after provider delivery is not a provider
-- attempt failure. Keep that wait retryable without replenishing any other
-- provider-error budget and without removing the bound-SID lookup guard.
create or replace function public.transition_twilio_real_number_uat_job(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_outcome text,
  target_provider_final_status text,target_provider_evidence_hash text,target_error_category text,
  target_next_attempt_at timestamptz,target_now timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.twilio_real_number_uat_jobs%rowtype; authority public.twilio_connection_authorities%rowtype;
 connection public.connector_connections%rowtype; next_state public.twilio_real_number_uat_state;
 evidence public.twilio_real_number_uat_evidence_state%rowtype; combined_hash text;
 sequence_pending boolean:=false; finalize_pending boolean:=false; budget_neutral_retry boolean:=false;
begin
  if target_outcome not in ('delivered','retry','failed')
     or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$') then
    raise exception 'invalid Twilio UAT transition' using errcode='22023'; end if;
  select target.* into job from public.twilio_real_number_uat_jobs target where target.id=target_job_id for update;
  if not found then raise exception 'Twilio UAT job not found' using errcode='P0002'; end if;
  if job.state='succeeded' then
    if target_outcome='delivered' and job.provider_final_status=target_provider_final_status
       and job.provider_evidence_hash=target_provider_evidence_hash then
      return jsonb_build_object('job',to_jsonb(job),'evidence',(select to_jsonb(state) from public.twilio_real_number_uat_evidence_state state where state.uat_job_id=job.id),
        'authority',(select to_jsonb(target) from public.twilio_connection_authorities target where target.connection_id=job.connection_id),
        'connection',(select to_jsonb(target) from public.connector_connections target where target.id=job.connection_id),'noOp',true); end if;
    raise exception 'divergent Twilio UAT completion replay' using errcode='23505';
  end if;
  if job.state<>'executing' or job.lease_owner<>target_worker_id or job.fencing_token<>target_fencing_token
     or job.lease_expires_at<=target_now then raise exception 'stale Twilio UAT lease' using errcode='40001'; end if;
  select state.* into evidence from public.twilio_real_number_uat_evidence_state state
    where state.uat_job_id=job.id and state.workspace_id=job.workspace_id and state.connection_id=job.connection_id;
  if target_outcome='delivered' then
    if target_provider_final_status not in ('delivered','read') or target_provider_evidence_hash !~ '^[0-9a-f]{64}$'
       or not exists(select 1 from connector_private.twilio_real_number_uat_resources resource
         where resource.job_id=job.id and resource.provider_message_sid_hash=job.provider_message_sid_hash) then
      raise exception 'provider-delivered Twilio UAT evidence required' using errcode='23514'; end if;
    if evidence.uat_job_id is null or evidence.sequence_complete_at is null or evidence.evidence_count<>4 then
      raise exception 'complete signed Twilio UAT callback/reply/STOP/cancellation sequence required' using errcode='23514'; end if;
    next_state:='succeeded';
  elsif target_outcome='retry' then
    if target_next_attempt_at is null or target_next_attempt_at<=target_now then
      raise exception 'future Twilio UAT retry schedule required' using errcode='23514'; end if;
    sequence_pending:=target_error_category='uat_sequence_pending'
      and job.provider_message_sid_hash is not null
      and exists(select 1 from connector_private.twilio_real_number_uat_resources resource
        where resource.job_id=job.id and resource.provider_message_sid_hash=job.provider_message_sid_hash)
      and (evidence.uat_job_id is null or evidence.sequence_complete_at is null or evidence.evidence_count<>4);
    finalize_pending:=target_error_category='uat_finalize_pending'
      and job.provider_message_sid_hash is not null
      and exists(select 1 from connector_private.twilio_real_number_uat_resources resource
        where resource.job_id=job.id and resource.provider_message_sid_hash=job.provider_message_sid_hash)
      and evidence.uat_job_id is not null and evidence.sequence_complete_at is not null and evidence.evidence_count=4;
    budget_neutral_retry:=sequence_pending or finalize_pending;
    if budget_neutral_retry or job.attempt_count<job.max_attempts then next_state:='retry_wait';
    else next_state:='failed'; end if;
  else next_state:='failed'; end if;
  update public.twilio_real_number_uat_jobs set state=next_state,
    attempt_count=case when budget_neutral_retry then greatest(attempt_count-1,0) else attempt_count end,
    provider_final_status=case when next_state='succeeded' then target_provider_final_status else provider_final_status end,
    provider_evidence_hash=case when next_state='succeeded' then target_provider_evidence_hash else provider_evidence_hash end,
    last_error_category=case when next_state='succeeded' then null else target_error_category end,
    scheduled_at=case when next_state='retry_wait' then target_next_attempt_at else scheduled_at end,
    lease_owner=null,lease_expires_at=null,completed_at=case when next_state in ('succeeded','failed') then target_now else null end,
    updated_at=target_now where id=job.id returning * into job;
  if next_state='succeeded' then
    combined_hash:=encode(extensions.digest(pg_catalog.convert_to(target_provider_evidence_hash||':'||
      (select string_agg(event.evidence_hash,':' order by event.evidence_type::text)
       from public.twilio_real_number_uat_evidence_events event where event.uat_job_id=job.id),'UTF8'),'sha256'),'hex');
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
    select target.* into authority from public.twilio_connection_authorities target where target.connection_id=job.connection_id;
    select target.* into connection from public.connector_connections target where target.id=job.connection_id;
  end if;
  return jsonb_build_object('job',to_jsonb(job),'evidence',case when evidence.uat_job_id is null then null else to_jsonb(evidence) end,
    'authority',to_jsonb(authority),'connection',to_jsonb(connection),'sequencePending',sequence_pending,
    'finalizationPending',finalize_pending,'noOp',false);
end;
$$;

revoke all on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz)
  to service_role;

comment on function public.transition_twilio_real_number_uat_job(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz) is
  'Fenced UAT transition. Bound-SID uat_sequence_pending human waits and complete-sequence uat_finalize_pending handoffs do not consume provider attempt budget.';

-- A generic incomplete-record conversion may intentionally create the
-- Contact before the reviewer finishes the provider identity link. Accept
-- only that exact already-converted contact; never convert twice or infer a
-- different target.
create or replace function public.resolve_meta_enquiry_review(
  target_event_id uuid,target_contact_id uuid,target_actor_membership_id uuid,
  target_idempotency_key text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_event public.meta_inbound_events%rowtype;
 target_contact public.contacts%rowtype; target_identity public.meta_external_identities%rowtype;
 target_conversation public.meta_conversations%rowtype; target_incomplete public.incomplete_records%rowtype;
 converted jsonb; conversion_was_preexisting boolean:=false;
begin
  if target_idempotency_key is null or target_correlation_id is null or target_occurred_at is null then
    raise exception 'complete Meta review resolution evidence required' using errcode='22023'; end if;
  select event.* into target_event from public.meta_inbound_events event
    where event.id=target_event_id for update;
  if not found then raise exception 'Meta review event not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_event.workspace_id,false);
  if actor.id<>target_actor_membership_id then
    raise exception 'Meta review actor binding failed' using errcode='42501'; end if;
  select contact.* into target_contact from public.contacts contact
  where contact.id=target_contact_id and contact.workspace_id=target_event.workspace_id
    and contact.archived_at is null;
  if not found then raise exception 'active review contact required' using errcode='P0002'; end if;
  if target_event.state='linked' then
    select identity.* into strict target_identity from public.meta_external_identities identity
      where identity.id=target_event.external_identity_id;
    if target_identity.contact_id<>target_contact_id then
      raise exception 'Meta review replay conflicts' using errcode='23505'; end if;
    return jsonb_build_object('event',to_jsonb(target_event),'externalIdentity',to_jsonb(target_identity),
      'conversation',(select to_jsonb(c) from public.meta_conversations c where c.id=target_event.conversation_id),
      'conversionPreexisting',true,'noOp',true);
  end if;
  if target_event.state<>'review' or target_event.incomplete_record_id is null then
    raise exception 'pending Meta review required' using errcode='23514'; end if;
  select incomplete.* into target_incomplete from public.incomplete_records incomplete
    where incomplete.id=target_event.incomplete_record_id
      and incomplete.workspace_id=target_event.workspace_id for update;
  if not found then raise exception 'Meta review record unavailable' using errcode='P0002'; end if;
  if target_incomplete.status='pending' then
    converted:=public.convert_incomplete_record(target_incomplete.id,'{}'::jsonb,
      jsonb_build_object('action','unchanged','matchedContactId',target_contact.id),
      target_idempotency_key,actor.id,target_occurred_at);
  elsif target_incomplete.status='converted' then
    if target_incomplete.converted_contact_id is distinct from target_contact.id
       or target_incomplete.converted_at is null
       or target_incomplete.converted_by_membership_id is null then
      raise exception 'converted Meta review record targets another contact' using errcode='23505'; end if;
    conversion_was_preexisting:=true;
    converted:=jsonb_build_object('record',to_jsonb(target_incomplete),
      'contactId',target_incomplete.converted_contact_id,'noOp',true);
  else
    raise exception 'pending or exact converted Meta review required' using errcode='23514';
  end if;
  select identity.* into strict target_identity from public.meta_external_identities identity
    where identity.id=target_event.external_identity_id
      and identity.workspace_id=target_event.workspace_id
      and identity.connection_id=target_event.connection_id
      and identity.asset_binding_id=target_event.asset_binding_id for update;
  if target_identity.contact_id is not null and target_identity.contact_id<>target_contact.id then
    raise exception 'Meta sender identity already links another contact' using errcode='23505'; end if;
  select conversation.* into strict target_conversation from public.meta_conversations conversation
    where conversation.id=target_event.conversation_id
      and conversation.workspace_id=target_event.workspace_id
      and conversation.connection_id=target_event.connection_id
      and conversation.asset_binding_id=target_event.asset_binding_id
      and conversation.external_identity_id=target_event.external_identity_id for update;
  if target_conversation.contact_id is not null and target_conversation.contact_id<>target_contact.id then
    raise exception 'Meta conversation already links another contact' using errcode='23505'; end if;
  update public.meta_external_identities set contact_id=target_contact.id,
    linked_by_membership_id=actor.id,linked_at=coalesce(linked_at,target_occurred_at),
    updated_at=target_occurred_at where id=target_identity.id returning * into target_identity;
  update public.meta_conversations set contact_id=target_contact.id,updated_at=target_occurred_at
    where id=target_conversation.id returning * into target_conversation;
  update public.meta_inbound_events set state='linked',review_reason=null,
    normalized_at=target_occurred_at,correlation_id=target_correlation_id,
    updated_at=target_occurred_at where id=target_event.id returning * into target_event;
  return jsonb_build_object('event',to_jsonb(target_event),'externalIdentity',to_jsonb(target_identity),
    'conversation',to_jsonb(target_conversation),'conversion',converted,
    'conversionPreexisting',conversion_was_preexisting,'noOp',false);
end;
$$;

revoke all on function public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz) to authenticated;

comment on function public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz) is
  'Links a reviewed Meta enquiry after pending conversion or exact same-contact generic conversion; cross-contact converted records fail closed.';

commit;
