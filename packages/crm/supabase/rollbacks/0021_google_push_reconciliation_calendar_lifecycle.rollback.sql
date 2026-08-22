-- Migration 0021 PRE-USE rollback only.
-- Refuses after any push delivery/wakeup, send reconciliation or Calendar
-- lifecycle side effect. After use, preserve evidence and use PITR or a
-- reviewed forward remediation.
begin;

do $$ begin
 if exists(select 1 from public.google_gmail_watch_deliveries)
  or exists(select 1 from public.google_gmail_history_wakeup_jobs)
  or exists(select 1 from public.google_gmail_send_reconciliations)
  or exists(select 1 from connector_private.google_calendar_task_resources
    where lifecycle_state<>'active' or last_job_id is not null or lifecycle_evidence_hash is not null)
  or exists(select 1 from public.connector_action_intents where action_type in (
    'calendar.complete-omnix-event','calendar.cancel-omnix-event','calendar.delete-omnix-event'))
 then raise exception using errcode='55000',
  message='0021 rollback refused: Google push/reconciliation/lifecycle evidence exists; preserve it and use PITR or a reviewed forward remediation';
 end if;
end $$;

drop trigger if exists google_gmail_send_reconciliation_matched on connector_private.google_gmail_resources;
drop trigger if exists google_gmail_watch_deliveries_guard_mutation on public.google_gmail_watch_deliveries;

drop function if exists public.bind_google_gmail_watch_ingress_authority(uuid,uuid,bigint,integer,text,text,text,text,text,timestamptz,uuid);
drop function if exists public.register_google_gmail_push_wakeup(text,text,text,text,text,text,text,timestamptz,timestamptz,uuid);
drop function if exists public.claim_google_gmail_history_wakeup_jobs(uuid,integer,integer,timestamptz);
drop function if exists public.start_google_gmail_history_wakeup_attempt(uuid,uuid,bigint,timestamptz);
drop function if exists public.schedule_due_google_gmail_watch_renewals(timestamptz,integer,integer);
drop function if exists public.renew_google_gmail_watch_from_wakeup(uuid,uuid,bigint,integer,integer,text,text,timestamptz,text,text,text,text,timestamptz);
drop function if exists public.read_google_gmail_history_wakeup_authority(uuid,uuid,bigint,timestamptz);
drop function if exists public.refresh_google_gmail_history_wakeup_access_token(uuid,uuid,bigint,integer,jsonb,timestamptz);
drop function if exists public.bind_google_gmail_wakeup_metadata_resource(uuid,uuid,bigint,text,text,text,text,text,text[],timestamptz,text,timestamptz);
drop function if exists public.commit_google_gmail_history_wakeup_checkpoint(uuid,uuid,bigint,integer,jsonb,text,boolean,timestamptz,timestamptz);
drop function if exists public.transition_google_gmail_history_wakeup_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz);
drop function if exists public.record_google_gmail_send_ambiguity(uuid,uuid,bigint,text,timestamptz);
drop function if exists public.read_google_gmail_send_reconciliation_state(uuid,uuid,bigint,timestamptz);
drop function if exists public.record_google_gmail_send_reconciliation_unresolved(uuid,uuid,bigint,text,text,text,timestamptz);
drop function if exists public.bind_google_task_event_lifecycle(uuid,uuid,bigint,uuid,integer,text,text,text,timestamptz,timestamptz);
drop function if exists public.read_google_connection_probe_authority(uuid,uuid,uuid,timestamptz);
drop function if exists public.refresh_google_connection_probe_access_token(uuid,uuid,uuid,integer,jsonb,timestamptz,uuid);
drop function if exists public.record_google_connection_probe(uuid,uuid,uuid,text,text,text,text,text,timestamptz,uuid);
drop function if exists connector_private.google_authorized_wakeup_job(uuid,uuid,bigint,timestamptz);
drop function if exists connector_private.mark_google_gmail_send_reconciliation_matched();

-- Restore the 0009 function object and its original grant.
drop function public.transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz);
alter function public.transition_connector_revocation_job_pre_0021(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz)
 rename to transition_connector_revocation_job;
revoke all on function public.transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamptz,jsonb,timestamptz)
 to service_role;

delete from public.connector_automation_policies
 where action_type in ('calendar.complete-omnix-event','calendar.cancel-omnix-event','calendar.delete-omnix-event');

alter table connector_private.google_gmail_resources
 drop constraint google_gmail_resources_one_source,
 drop constraint google_gmail_resources_wakeup_job_workspace_fk,
 drop column source_wakeup_job_id;

alter table connector_private.google_calendar_task_resources
 drop constraint google_calendar_task_resources_lifecycle_time,
 drop constraint google_calendar_task_resources_lifecycle_hash,
 drop constraint google_calendar_task_resources_lifecycle_state,
 drop constraint google_calendar_task_resources_last_job_workspace_fk,
 drop column lifecycle_state,
 drop column last_job_id,
 drop column lifecycle_evidence_hash,
 drop column completed_at,
 drop column cancelled_at,
 drop column deleted_at;

alter table public.google_calendar_task_states
 drop constraint google_calendar_task_states_state,
 add constraint google_calendar_task_states_state check(
  state in ('pending','synced','conflict','remote-deleted','review','disconnected')
 );

drop table public.google_gmail_watch_deliveries;
drop table public.google_gmail_send_reconciliations;
drop table public.google_gmail_history_wakeup_jobs;
drop table connector_private.google_gmail_watch_ingress_authorities;
drop type public.google_gmail_wakeup_job_state;

-- Restore frozen 0014 action mapping and exact executing-job authority.
create or replace function connector_private.google_bundle_for_action(target_action text)
returns text language sql immutable security definer set search_path='' as $$
 select case target_action
  when 'gmail.send' then 'gmail-send'
  when 'gmail.sync-metadata' then 'gmail-metadata'
  when 'calendar.create-omnix-calendar' then 'calendar-app-created'
  when 'calendar.upsert-omnix-event' then 'calendar-app-created'
  when 'calendar.sync' then 'calendar-app-created'
  else null end;
$$;

create or replace function connector_private.google_authorized_job(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns public.connector_jobs language plpgsql stable security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_bundle text;
begin
 select job.* into target_job from public.connector_jobs job
 join public.connector_connections connection on connection.id=job.connection_id and connection.workspace_id=job.workspace_id
 where job.id=target_job_id and job.provider='google' and job.state='executing'
  and job.lease_owner=target_worker_id and job.fencing_token=target_fencing_token
  and job.lease_expires_at>target_now and connection.provider='google'
  and connection.status in ('active','degraded');
 if not found then raise exception 'active fenced Google job required' using errcode='42501'; end if;
 target_bundle:=connector_private.google_bundle_for_action(target_job.action_type);
 if target_bundle is null or not exists(
  select 1 from public.google_connection_capabilities capability
  join public.connector_connections bound_connection on bound_connection.id=capability.connection_id
   and bound_connection.workspace_id=capability.workspace_id
  where capability.connection_id=target_job.connection_id and capability.workspace_id=target_job.workspace_id
   and capability.bundle=target_bundle and capability.state='active'
   and capability.account_key_hash=bound_connection.provider_account_key_hash
   and capability.required_scopes=connector_private.google_bundle_scopes(target_bundle)
   and not exists(select 1 from unnest(capability.required_scopes) required_scope where required_scope<>all(capability.granted_scopes))
   and not exists(select 1 from unnest(capability.required_scopes) required_scope where required_scope<>all(bound_connection.granted_scopes))
   and not exists(select 1 from unnest(capability.granted_scopes) granted_scope where granted_scope<>all(bound_connection.granted_scopes))
 ) then raise exception 'active Google capability required' using errcode='42501'; end if;
 return target_job;
end;
$$;

create or replace function connector_private.ensure_google_action_policies(
 target_workspace_id uuid,target_membership_id uuid,target_granted_scopes text[],
 target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare action_row record; target_policy public.connector_automation_policies%rowtype;
 policies jsonb:='[]'::jsonb; expected_constraints jsonb;
 expected_compliance constant jsonb :=
  '{"provider":"google","rawContentInReceipts":false,"rawAddressesInReceipts":false,"accountSwapAllowed":false}'::jsonb;
 expected_limits constant jsonb :=
  '{"maxAttempts":5,"maxBatchSize":500,"minimumDelayMs":250}'::jsonb;
begin
 if target_correlation_id is null or target_occurred_at is null or not exists(
  select 1 from public.workspace_members membership where membership.id=target_membership_id
   and membership.workspace_id=target_workspace_id and membership.role='owner' and membership.status='active'
 ) then raise exception 'active owner authority required for Google policy bootstrap' using errcode='42501'; end if;
 for action_row in select * from (values
  ('gmail.send','gmail-send','https://www.googleapis.com/auth/gmail.send'),
  ('gmail.sync-metadata','gmail-metadata','https://www.googleapis.com/auth/gmail.metadata'),
  ('calendar.create-omnix-calendar','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
  ('calendar.upsert-omnix-event','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
  ('calendar.sync','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created')
 ) as actions(action_type,bundle,required_scope)
 where actions.required_scope=any(target_granted_scopes) order by actions.action_type loop
  expected_constraints:=jsonb_build_object('provider','google','capabilityBundle',action_row.bundle,
   'connectionBound',true,'immutablePayload',true,'canonicalAuthority',
   case when action_row.action_type='calendar.upsert-omnix-event' then 'task-version' else 'connector-payload' end);
  perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':'||action_row.action_type,0));
  select policy.* into target_policy from public.connector_automation_policies policy
   where policy.workspace_id=target_workspace_id and policy.action_type=action_row.action_type
   order by policy.version desc limit 1;
  if found then
   if target_policy.version<>1 or target_policy.approval_mode<>'owner_required'
    or target_policy.allowlisted_actions is distinct from array[action_row.action_type]::text[]
    or target_policy.target_constraints<>expected_constraints
    or target_policy.compliance_requirements<>expected_compliance
    or target_policy.execution_limits<>expected_limits then
    raise exception 'existing % policy conflicts with canonical Google policy',action_row.action_type using errcode='23505'; end if;
  else
   insert into public.connector_automation_policies(workspace_id,action_type,version,approval_mode,
    allowlisted_actions,target_constraints,compliance_requirements,execution_limits,
    created_by_membership_id,correlation_id,created_at)
   values(target_workspace_id,action_row.action_type,1,'owner_required',array[action_row.action_type]::text[],
    expected_constraints,expected_compliance,expected_limits,target_membership_id,target_correlation_id,target_occurred_at)
   returning * into target_policy;
  end if;
  policies:=policies||jsonb_build_array(to_jsonb(target_policy));
 end loop;
 return policies;
end;
$$;

create or replace function public.record_google_calendar_task_conflict(
 target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_task_id uuid,
 target_task_version integer,target_resource_key_hash text,target_reason text,
 target_provider_updated_at timestamptz,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_task public.tasks%rowtype;
 target_state public.google_calendar_task_states%rowtype; target_receipt public.connector_receipt_events%rowtype;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type not in ('calendar.sync','calendar.upsert-omnix-event')
  or target_resource_key_hash !~ '^[0-9a-f]{64}$'
  or target_reason not in ('remote-edited','remote-deleted','task-version-drift','timezone-invalid') then
  raise exception 'invalid Google task conflict' using errcode='22023'; end if;
 select * into target_task from public.tasks where id=target_task_id and workspace_id=target_job.workspace_id;
 if not found then raise exception 'Omnix task not found' using errcode='P0002'; end if;
 insert into public.google_calendar_task_states(workspace_id,connection_id,task_id,task_version,
  resource_key_hash,state,provider_updated_at,last_error_category,correlation_id,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,target_task.id,target_task_version,target_resource_key_hash,
  case when target_reason='remote-deleted' then 'remote-deleted' else 'conflict' end,target_provider_updated_at,
  replace(target_reason,'-','_'),target_job.correlation_id,target_occurred_at,target_occurred_at)
 on conflict(connection_id,task_id) do update set task_version=excluded.task_version,
  resource_key_hash=excluded.resource_key_hash,state=excluded.state,provider_updated_at=excluded.provider_updated_at,
  last_error_category=excluded.last_error_category,correlation_id=excluded.correlation_id,
  updated_at=excluded.updated_at returning * into target_state;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,job_id,intent_id,
  intent_version_id,event_type,event_key,correlation_id,fencing_token,provider_request_hash,
  error_category,reconciliation_result,redacted_metadata,occurred_at)
 values(target_job.workspace_id,target_job.connection_id,'google',target_job.id,target_job.intent_id,
  target_job.intent_version_id,'sync.reviewed','google.calendar.task-conflict:'||target_job.id::text||':'||target_task.id::text||':'||target_task_version::text,
  target_job.correlation_id,target_job.fencing_token,target_resource_key_hash,replace(target_reason,'-','_'),
  'review-required',jsonb_build_object('taskId',target_task.id,'taskVersion',target_task_version,
   'reason',target_reason),target_occurred_at) returning * into target_receipt;
 return jsonb_build_object('taskState',to_jsonb(target_state),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.prepare_google_disconnect_state()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.provider='google' and new.status in ('disconnected','disconnected_unconfirmed')
  and old.status is distinct from new.status then
  update public.google_connection_capabilities set state='revoked',revoked_at=new.disconnected_at,
   last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
   updated_at=new.disconnected_at where connection_id=new.id;
  update public.google_sync_health set state='disabled',
   last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
   updated_at=new.disconnected_at where connection_id=new.id;
  update connector_private.google_gmail_watch_resources set revoked_at=new.disconnected_at,
   updated_at=new.disconnected_at where connection_id=new.id and revoked_at is null;
  update public.google_calendar_task_states set state='disconnected',
   last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
   updated_at=new.disconnected_at where connection_id=new.id;
 end if;
 return new;
end;
$$;

commit;
