-- A capture-only idempotency wrapper. The canonical connector authority still owns approval and dispatch.
-- Explicit key order matches stablePayloadHash for this flat, versioned calendar schema.
create or replace function public.capture_calendar_payload_hash(target_workspace_id uuid,payload jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,public as $$
declare resource_key text; canonical text;
begin
  resource_key:=encode(extensions.digest(convert_to('{"taskId":'||to_jsonb(payload->>'taskId')::text||',"workspaceId":'||to_jsonb(target_workspace_id::text)::text||'}','UTF8'),'sha256'),'hex');
  canonical:='{"endAt":'||to_jsonb(to_char((payload->>'endAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
    ||',"eventId":'||to_jsonb(substr(resource_key,1,32))::text
    ||',"resourceKey":'||to_jsonb(resource_key)::text
    ||',"schemaVersion":"google-calendar-task.v1","startAt":'||to_jsonb(to_char((payload->>'startAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
    ||',"taskId":'||to_jsonb(payload->>'taskId')::text||',"taskVersion":'||((payload->>'taskVersion')::integer)::text
    ||',"timeZone":'||to_jsonb(payload->>'timeZone')::text||',"title":'||to_jsonb(payload->>'title')::text||'}';
  return encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.capture_calendar_payload_hash(uuid,jsonb) from public,anon,authenticated,service_role;
create table public.capture_calendar_intent_receipts (
  proposal_id uuid not null,
  proposal_version integer not null check(proposal_version > 0),
  workspace_id uuid not null,
  intent_id uuid not null,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(proposal_id,proposal_version),
  foreign key(proposal_id,workspace_id) references public.omnix_action_proposals(id,workspace_id),
  foreign key(intent_id,workspace_id) references public.connector_action_intents(id,workspace_id)
);
alter table public.capture_calendar_intent_receipts enable row level security;
alter table public.capture_calendar_intent_receipts force row level security;
create policy capture_calendar_intent_receipts_read on public.capture_calendar_intent_receipts for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on public.capture_calendar_intent_receipts from public,anon,authenticated,service_role;
grant select on public.capture_calendar_intent_receipts to authenticated,service_role;
create trigger capture_calendar_intent_receipts_immutable before update or delete on public.capture_calendar_intent_receipts for each row execute function public.guard_omnix_proposal_event_mutation();
create or replace function public.create_capture_calendar_intent(
  target_proposal_id uuid,target_proposal_version integer,target_connection_id uuid,target_summary text,
  target_payload_ref uuid,target_payload_hash text,target_policy_id uuid,target_policy_version integer,
  target_compliance_snapshot jsonb,target_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare proposal public.omnix_action_proposals%rowtype; payload jsonb;
  receipt public.capture_calendar_intent_receipts%rowtype; intent public.connector_action_intents%rowtype;
  result jsonb; actor public.workspace_members%rowtype;
begin
  select * into proposal from public.omnix_action_proposals where id=target_proposal_id for update;
  if not found then raise exception 'Calendar proposal not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(proposal.workspace_id,false);
  if actor.role <> 'owner' or proposal.approval_mode <> 'owner' or proposal.kind::text <> 'google-calendar-event'
    or proposal.state not in ('executing','executed') or proposal.current_version is distinct from target_proposal_version
    or proposal.correlation_id is distinct from target_correlation_id then raise exception 'Exact owner-approved calendar proposal required' using errcode='42501'; end if;
  select v.payload into payload from public.omnix_action_proposal_versions v where v.proposal_id=proposal.id and v.workspace_id=proposal.workspace_id and v.version=target_proposal_version;
  if payload->>'captureExactTarget' is distinct from 'true' or payload->>'connectionId' is distinct from target_connection_id::text
    or payload->>'taskId' is distinct from target_compliance_snapshot->>'taskId'
    or payload->>'taskVersion' is distinct from target_compliance_snapshot->>'taskVersion'
    or payload->>'timeZone' is distinct from target_compliance_snapshot->>'timeZone' then raise exception 'Calendar proposal target changed' using errcode='40001'; end if;
  if target_payload_hash is distinct from public.capture_calendar_payload_hash(proposal.workspace_id,payload) then raise exception 'Calendar encrypted payload differs from approved time and content' using errcode='40001'; end if;
  select * into receipt from public.capture_calendar_intent_receipts where proposal_id=proposal.id and proposal_version=target_proposal_version;
  if found then
    if receipt.payload_hash is distinct from target_payload_hash then raise exception 'Calendar replay payload conflict' using errcode='40001'; end if;
    select * into strict intent from public.connector_action_intents where id=receipt.intent_id and workspace_id=proposal.workspace_id;
    return jsonb_build_object('intent',to_jsonb(intent),'noOp',true);
  end if;
  if not exists(select 1 from public.tasks t where t.id=(payload->>'taskId')::uuid and t.workspace_id=proposal.workspace_id and t.contact_id=proposal.contact_id and t.task_version=(payload->>'taskVersion')::integer and t.status='open' and t.title=payload->>'title') then raise exception 'Approved calendar task is stale' using errcode='40001'; end if;
  result:=public.create_connector_action_intent(target_connection_id,'calendar.upsert-omnix-event',target_summary,target_payload_ref,target_payload_hash,target_policy_id,target_policy_version,target_compliance_snapshot,target_correlation_id);
  insert into public.capture_calendar_intent_receipts(proposal_id,proposal_version,workspace_id,intent_id,payload_hash) values(proposal.id,target_proposal_version,proposal.workspace_id,(result->'intent'->>'id')::uuid,target_payload_hash);
  return result;
end $$;
revoke all on function public.create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid) to authenticated;
