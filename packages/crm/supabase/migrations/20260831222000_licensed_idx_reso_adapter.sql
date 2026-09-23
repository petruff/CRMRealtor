-- Story 9.3: licensed provider authority and fail-closed listing reconciliation.

create table public.listing_provider_authorities (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  provider_key text not null, display_name text not null, state text not null,
  rights_reference text not null, credential_binding_reference text,
  effective_at timestamptz not null, expires_at timestamptz,
  attribution_label text not null, attribution_url text not null,
  freshness_minutes integer not null, display_hours integer not null, retention_hours integer not null, deletion_deadline_hours integer not null,
  media_permitted boolean not null default false,
  created_by_membership_id uuid not null, updated_by_membership_id uuid not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  constraint listing_provider_authorities_workspace_unique unique(id,workspace_id),
  constraint listing_provider_authorities_provider_unique unique(workspace_id,provider_key),
  constraint listing_provider_authorities_creator_fk foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint listing_provider_authorities_updater_fk foreign key(updated_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint listing_provider_authorities_values check(provider_key~'^[a-z][a-z0-9-]{2,79}$' and length(trim(display_name)) between 1 and 120 and state in ('disabled','pending','active','suspended','revoked','expired') and length(rights_reference) between 8 and 240 and attribution_url~'^https://' and freshness_minutes between 1 and 43200 and display_hours between 1 and 8760 and retention_hours between display_hours and 87600 and deletion_deadline_hours between 1 and 720 and (expires_at is null or expires_at>effective_at) and (state<>'active' or credential_binding_reference is not null))
);

create table public.listing_sync_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  authority_id uuid not null, idempotency_key text not null, request_hash text not null,
  cursor_before text, cursor_after text, status text not null, support_reference text not null,
  seen_count integer not null default 0, upsert_count integer not null default 0, delete_count integer not null default 0,
  failure_category text, started_at timestamptz not null, completed_at timestamptz, updated_at timestamptz not null,
  constraint listing_sync_runs_workspace_unique unique(id,workspace_id),
  constraint listing_sync_runs_authority_fk foreign key(authority_id,workspace_id) references public.listing_provider_authorities(id,workspace_id) on delete restrict,
  constraint listing_sync_runs_replay_unique unique(authority_id,idempotency_key),
  constraint listing_sync_runs_support_unique unique(support_reference),
  constraint listing_sync_runs_values check(idempotency_key~'^[A-Za-z0-9._:-]{8,160}$' and request_hash~'^[a-f0-9]{64}$' and length(coalesce(cursor_before,''))<=512 and length(coalesce(cursor_after,''))<=512 and status in ('processing','completed','failed','cancelled') and support_reference~'^[A-F0-9]{8}$' and seen_count>=0 and upsert_count>=0 and delete_count>=0 and upsert_count+delete_count<=seen_count and (failure_category is null or failure_category~'^[a-z][a-z0-9._-]{1,79}$') and ((status='processing' and completed_at is null) or (status<>'processing' and completed_at is not null)))
);

create table public.licensed_listing_records (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  authority_id uuid not null, provider_record_id text not null, property_id uuid,
  payload_hash text not null, provider_modified_at timestamptz not null, permission_state text not null,
  display_until timestamptz not null, retention_until timestamptz not null, deletion_due_at timestamptz,
  deleted_at timestamptz, last_sync_run_id uuid not null, created_at timestamptz not null, updated_at timestamptz not null,
  constraint licensed_listing_records_workspace_unique unique(id,workspace_id),
  constraint licensed_listing_records_remote_unique unique(authority_id,provider_record_id),
  constraint licensed_listing_records_authority_fk foreign key(authority_id,workspace_id) references public.listing_provider_authorities(id,workspace_id) on delete restrict,
  constraint licensed_listing_records_property_fk foreign key(property_id,workspace_id) references public.properties(id,workspace_id) on delete restrict,
  constraint licensed_listing_records_run_fk foreign key(last_sync_run_id,workspace_id) references public.listing_sync_runs(id,workspace_id) on delete restrict,
  constraint licensed_listing_records_values check(length(provider_record_id) between 1 and 160 and payload_hash~'^[a-f0-9]{64}$' and permission_state in ('allowed','restricted','revoked') and retention_until>=display_until and ((deleted_at is null and deletion_due_at is null) or (deleted_at is not null and deletion_due_at is not null)))
);
create index listing_sync_runs_authority_time_idx on public.listing_sync_runs(authority_id,started_at desc);
create index licensed_listing_records_display_idx on public.licensed_listing_records(workspace_id,permission_state,display_until);

create or replace function public.configure_listing_provider_authority(target_workspace_id uuid,target_membership_id uuid,target_provider_key text,target_display_name text,target_state text,target_rights_reference text,target_credential_binding_reference text,target_effective_at timestamptz,target_expires_at timestamptz,target_attribution_label text,target_attribution_url text,target_freshness_minutes integer,target_display_hours integer,target_retention_hours integer,target_deletion_deadline_hours integer,target_media_permitted boolean,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; saved public.listing_provider_authorities%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into actor from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id;
  if actor.role<>'owner' then raise exception 'owner authority required' using errcode='42501'; end if;
  if target_provider_key!~'^[a-z][a-z0-9-]{2,79}$' or length(trim(target_display_name)) not between 1 and 120 or target_state not in ('disabled','pending','active','suspended') or length(target_rights_reference) not between 8 and 240 or target_attribution_url!~'^https://' or target_freshness_minutes not between 1 and 43200 or target_display_hours not between 1 and 8760 or target_retention_hours not between target_display_hours and 87600 or target_deletion_deadline_hours not between 1 and 720 or (target_expires_at is not null and target_expires_at<=target_effective_at) or (target_state='active' and nullif(trim(target_credential_binding_reference),'') is null) then raise exception 'invalid listing provider authority' using errcode='22023'; end if;
  insert into public.listing_provider_authorities(workspace_id,provider_key,display_name,state,rights_reference,credential_binding_reference,effective_at,expires_at,attribution_label,attribution_url,freshness_minutes,display_hours,retention_hours,deletion_deadline_hours,media_permitted,created_by_membership_id,updated_by_membership_id,created_at,updated_at)
  values(target_workspace_id,target_provider_key,trim(target_display_name),target_state,target_rights_reference,nullif(trim(target_credential_binding_reference),''),target_effective_at,target_expires_at,trim(target_attribution_label),target_attribution_url,target_freshness_minutes,target_display_hours,target_retention_hours,target_deletion_deadline_hours,target_media_permitted,target_membership_id,target_membership_id,target_occurred_at,target_occurred_at)
  on conflict(workspace_id,provider_key) do update set display_name=excluded.display_name,state=excluded.state,rights_reference=excluded.rights_reference,credential_binding_reference=excluded.credential_binding_reference,effective_at=excluded.effective_at,expires_at=excluded.expires_at,attribution_label=excluded.attribution_label,attribution_url=excluded.attribution_url,freshness_minutes=excluded.freshness_minutes,display_hours=excluded.display_hours,retention_hours=excluded.retention_hours,deletion_deadline_hours=excluded.deletion_deadline_hours,media_permitted=excluded.media_permitted,updated_by_membership_id=excluded.updated_by_membership_id,updated_at=excluded.updated_at returning * into saved;
  return jsonb_build_object('authorityId',saved.id,'state',saved.state,'updatedAt',saved.updated_at);
end $$;

create or replace function public.revoke_listing_provider_authority(target_workspace_id uuid,target_membership_id uuid,target_authority_id uuid,target_reason_code text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; saved public.listing_provider_authorities%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id); select * into actor from public.workspace_members where id=target_membership_id and workspace_id=target_workspace_id;
  if actor.role<>'owner' then raise exception 'owner authority required' using errcode='42501'; end if;
  if target_reason_code!~'^[a-z][a-z0-9._-]{1,79}$' then raise exception 'invalid revocation reason' using errcode='22023'; end if;
  update public.listing_provider_authorities set state='revoked',credential_binding_reference=null,updated_by_membership_id=target_membership_id,updated_at=target_occurred_at where id=target_authority_id and workspace_id=target_workspace_id returning * into saved;
  if not found then raise exception 'listing authority not found' using errcode='P0002'; end if;
  update public.licensed_listing_records set permission_state='revoked',display_until=least(display_until,target_occurred_at),updated_at=target_occurred_at where authority_id=saved.id and workspace_id=target_workspace_id and permission_state<>'revoked';
  update public.property_facts set permission_state='revoked',display_until=least(coalesce(display_until,target_occurred_at),target_occurred_at),updated_at=target_occurred_at where workspace_id=target_workspace_id and authority='licensed-provider' and provider=saved.provider_key and permission_state<>'revoked';
  update public.listing_sync_runs set status='cancelled',failure_category=target_reason_code,completed_at=target_occurred_at,updated_at=target_occurred_at where authority_id=saved.id and status='processing';
  return jsonb_build_object('authorityId',saved.id,'state','revoked');
end $$;

create or replace function public.claim_listing_sync(target_workspace_id uuid,target_provider_key text,target_idempotency_key text,target_request_hash text,target_cursor text,target_started_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority public.listing_provider_authorities%rowtype; existing public.listing_sync_runs%rowtype; saved public.listing_sync_runs%rowtype; support text;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext(target_workspace_id::text||':'||target_provider_key));
  select * into authority from public.listing_provider_authorities where workspace_id=target_workspace_id and provider_key=target_provider_key;
  if not found or authority.state<>'active' or authority.credential_binding_reference is null or target_started_at<authority.effective_at or (authority.expires_at is not null and target_started_at>=authority.expires_at) then return jsonb_build_object('outcome','disabled'); end if;
  select * into existing from public.listing_sync_runs where authority_id=authority.id and idempotency_key=target_idempotency_key for update;
  if found then if existing.request_hash<>target_request_hash then return jsonb_build_object('outcome','conflict','supportReference',existing.support_reference); end if; if existing.status='processing' then return jsonb_build_object('outcome','processing','supportReference',existing.support_reference); end if; return jsonb_build_object('outcome','replay','status',existing.status,'supportReference',existing.support_reference); end if;
  support:=upper(substr(encode(extensions.digest(pg_catalog.convert_to(gen_random_uuid()::text||target_request_hash,'UTF8'),'sha256'),'hex'),1,8));
  insert into public.listing_sync_runs(workspace_id,authority_id,idempotency_key,request_hash,cursor_before,status,support_reference,started_at,updated_at) values(target_workspace_id,authority.id,target_idempotency_key,target_request_hash,target_cursor,'processing',support,target_started_at,target_started_at) returning * into saved;
  return jsonb_build_object('outcome','accepted','runId',saved.id,'authorityId',authority.id,'supportReference',support,'credentialBindingReference',authority.credential_binding_reference,'policy',jsonb_build_object('displayHours',authority.display_hours,'retentionHours',authority.retention_hours,'deletionDeadlineHours',authority.deletion_deadline_hours,'freshnessMinutes',authority.freshness_minutes,'mediaPermitted',authority.media_permitted));
end $$;

create or replace function public.record_listing_sync_change(target_workspace_id uuid,target_run_id uuid,target_provider_record_id text,target_property_id uuid,target_change_kind text,target_payload_hash text,target_provider_modified_at timestamptz,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run public.listing_sync_runs%rowtype; authority public.listing_provider_authorities%rowtype; saved public.licensed_listing_records%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select * into run from public.listing_sync_runs where id=target_run_id and workspace_id=target_workspace_id and status='processing'; if not found then raise exception 'listing sync run not processable' using errcode='55000'; end if;
  select * into authority from public.listing_provider_authorities where id=run.authority_id and workspace_id=target_workspace_id and state='active'; if not found then raise exception 'listing authority unavailable' using errcode='55000'; end if;
  if length(target_provider_record_id) not between 1 and 160 or target_change_kind not in ('upsert','delete') or target_payload_hash!~'^[a-f0-9]{64}$' then raise exception 'invalid listing change evidence' using errcode='22023'; end if;
  if target_property_id is not null then perform 1 from public.properties where id=target_property_id and workspace_id=target_workspace_id; if not found then raise exception 'property unavailable' using errcode='P0002'; end if; end if;
  insert into public.licensed_listing_records(workspace_id,authority_id,provider_record_id,property_id,payload_hash,provider_modified_at,permission_state,display_until,retention_until,deletion_due_at,deleted_at,last_sync_run_id,created_at,updated_at)
  values(target_workspace_id,authority.id,target_provider_record_id,target_property_id,target_payload_hash,target_provider_modified_at,case when target_change_kind='delete' then 'revoked' else 'allowed' end,target_occurred_at+make_interval(hours=>authority.display_hours),target_occurred_at+make_interval(hours=>authority.retention_hours),case when target_change_kind='delete' then target_occurred_at+make_interval(hours=>authority.deletion_deadline_hours) end,case when target_change_kind='delete' then target_occurred_at end,target_run_id,target_occurred_at,target_occurred_at)
  on conflict(authority_id,provider_record_id) do update set property_id=excluded.property_id,payload_hash=excluded.payload_hash,provider_modified_at=excluded.provider_modified_at,permission_state=excluded.permission_state,display_until=excluded.display_until,retention_until=excluded.retention_until,deletion_due_at=excluded.deletion_due_at,deleted_at=excluded.deleted_at,last_sync_run_id=excluded.last_sync_run_id,updated_at=excluded.updated_at where public.licensed_listing_records.provider_modified_at<=excluded.provider_modified_at returning * into saved;
  if not found then select * into saved from public.licensed_listing_records where authority_id=authority.id and provider_record_id=target_provider_record_id; return jsonb_build_object('recordId',saved.id,'noOp',true); end if;
  return jsonb_build_object('recordId',saved.id,'noOp',false,'permissionState',saved.permission_state);
end $$;

create or replace function public.finalize_listing_sync(target_workspace_id uuid,target_run_id uuid,target_cursor_after text,target_seen_count integer,target_upsert_count integer,target_delete_count integer,target_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$ declare saved public.listing_sync_runs%rowtype; begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  if length(coalesce(target_cursor_after,''))>512 or target_seen_count<0 or target_upsert_count<0 or target_delete_count<0 or target_upsert_count+target_delete_count>target_seen_count then raise exception 'invalid listing sync counts' using errcode='22023'; end if;
  update public.listing_sync_runs set cursor_after=target_cursor_after,status='completed',seen_count=target_seen_count,upsert_count=target_upsert_count,delete_count=target_delete_count,completed_at=target_completed_at,updated_at=target_completed_at where id=target_run_id and workspace_id=target_workspace_id and status='processing' returning * into saved;
  if not found then select * into saved from public.listing_sync_runs where id=target_run_id and workspace_id=target_workspace_id and status='completed'; if not found then raise exception 'listing sync run not processable' using errcode='55000'; end if; return jsonb_build_object('status','completed','supportReference',saved.support_reference,'noOp',true); end if;
  return jsonb_build_object('status','completed','supportReference',saved.support_reference,'noOp',false);
end $$;

alter table public.listing_provider_authorities enable row level security; alter table public.listing_provider_authorities force row level security;
alter table public.listing_sync_runs enable row level security; alter table public.listing_sync_runs force row level security;
alter table public.licensed_listing_records enable row level security; alter table public.licensed_listing_records force row level security;
create policy listing_provider_authorities_member_select on public.listing_provider_authorities for select to authenticated using(public.has_workspace_access(workspace_id));
create policy listing_sync_runs_member_select on public.listing_sync_runs for select to authenticated using(public.has_workspace_access(workspace_id));
create policy licensed_listing_records_member_select on public.licensed_listing_records for select to authenticated using(public.has_workspace_access(workspace_id));
revoke all on public.listing_provider_authorities,public.listing_sync_runs,public.licensed_listing_records from public,anon,authenticated,service_role;
grant select on public.listing_provider_authorities,public.listing_sync_runs,public.licensed_listing_records to authenticated,service_role;
revoke all on function public.configure_listing_provider_authority(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text,text,integer,integer,integer,integer,boolean,timestamptz),public.revoke_listing_provider_authority(uuid,uuid,uuid,text,timestamptz),public.claim_listing_sync(uuid,text,text,text,text,timestamptz),public.record_listing_sync_change(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz),public.finalize_listing_sync(uuid,uuid,text,integer,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.configure_listing_provider_authority(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text,text,integer,integer,integer,integer,boolean,timestamptz),public.revoke_listing_provider_authority(uuid,uuid,uuid,text,timestamptz) to authenticated;
grant execute on function public.claim_listing_sync(uuid,text,text,text,text,timestamptz),public.record_listing_sync_change(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz),public.finalize_listing_sync(uuid,uuid,text,integer,integer,integer,timestamptz) to service_role;

comment on table public.listing_provider_authorities is 'Recorded listing rights and display/retention authority; credential_binding_reference identifies a server secret and is not the secret.';
comment on table public.licensed_listing_records is 'Minimal licensed record evidence; unrestricted provider payloads are intentionally excluded.';
