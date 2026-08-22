-- Story 3.4: governed data portability and operational API authority.
-- Raw import/export files and plaintext API/webhook secrets are never stored.
begin;

create type public.operational_api_key_state as enum ('active','revoked','expired');
create type public.data_operation_outcome as enum ('previewed','succeeded','partial','failed');

create table public.data_mapping_profiles (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120), version integer not null check(version>0),
  definition jsonb not null check(jsonb_typeof(definition)='object' and pg_column_size(definition)<=16384),
  created_by_membership_id uuid not null, created_at timestamptz not null, archived_at timestamptz,
  foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  unique(workspace_id,name,version), unique(id,workspace_id)
);
create unique index data_mapping_profiles_current_name_idx on public.data_mapping_profiles(workspace_id,lower(name)) where archived_at is null;

create table public.data_import_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_membership_id uuid not null, mapping_profile_id uuid, mapping_version integer,
  source text not null check(source ~ '^[a-z0-9][a-z0-9_-]{0,63}$'), format text not null check(format in ('csv','vcard','xls','xlsx','json')),
  file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'), idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9:_-]{1,160}$'),
  outcome public.data_operation_outcome not null, total_rows integer not null check(total_rows between 0 and 5000),
  created_count integer not null default 0 check(created_count>=0), updated_count integer not null default 0 check(updated_count>=0),
  unchanged_count integer not null default 0 check(unchanged_count>=0), rejected_count integer not null default 0 check(rejected_count>=0),
  quarantined_count integer not null default 0 check(quarantined_count>=0), failed_count integer not null default 0 check(failed_count>=0),
  started_at timestamptz not null, completed_at timestamptz not null, correlation_id uuid not null,
  foreign key(actor_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  foreign key(mapping_profile_id,workspace_id) references public.data_mapping_profiles(id,workspace_id) on delete restrict,
  unique(workspace_id,idempotency_key), unique(id,workspace_id)
);
create index data_import_runs_workspace_completed_idx on public.data_import_runs(workspace_id,completed_at desc);

create table public.data_import_row_outcomes (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, import_run_id uuid not null,
  row_number integer not null check(row_number>0), outcome text not null check(outcome in ('created','updated','unchanged','rejected','quarantined','failed')),
  contact_id uuid, incomplete_record_id uuid, error_code text check(error_code is null or error_code ~ '^[a-z][a-z0-9_.-]{1,79}$'), created_at timestamptz not null,
  foreign key(import_run_id,workspace_id) references public.data_import_runs(id,workspace_id) on delete restrict,
  foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  foreign key(incomplete_record_id,workspace_id) references public.incomplete_records(id,workspace_id) on delete restrict,
  unique(import_run_id,row_number)
);

create table public.data_export_receipts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_membership_id uuid not null, entity_type text not null check(entity_type in ('contacts','tasks','activities','incomplete-records')),
  format text not null check(format in ('csv','xlsx')), selection jsonb not null check(jsonb_typeof(selection)='object' and pg_column_size(selection)<=8192),
  selection_hash text not null check(selection_hash ~ '^[a-f0-9]{64}$'), row_count integer not null check(row_count between 0 and 5000),
  outcome public.data_operation_outcome not null, correlation_id uuid not null, created_at timestamptz not null,
  foreign key(actor_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  unique(id,workspace_id)
);
create index data_export_receipts_workspace_created_idx on public.data_export_receipts(workspace_id,created_at desc);

create table public.operational_api_keys (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  name text not null check(length(btrim(name)) between 1 and 120), key_prefix text not null check(key_prefix ~ '^omx_[A-Za-z0-9]{8,20}$'),
  verifier text not null check(verifier ~ '^[a-f0-9]{64}$'), scopes text[] not null check(cardinality(scopes) between 1 and 8 and scopes <@ array['contacts.create','contacts.read','contacts.update','contacts.archive','contacts.search','status.read','intake.create']::text[]),
  state public.operational_api_key_state not null default 'active', expires_at timestamptz not null, revoked_at timestamptz,
  rotated_from_key_id uuid references public.operational_api_keys(id) on delete restrict, created_by_membership_id uuid not null,
  created_at timestamptz not null, last_used_at timestamptz,
  foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  unique(key_prefix), unique(verifier), unique(id,workspace_id)
);
create index operational_api_keys_workspace_state_idx on public.operational_api_keys(workspace_id,state,expires_at);

create table public.operational_api_receipts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, api_key_id uuid not null,
  correlation_id uuid not null, method text not null check(method in ('GET','POST','PATCH')),
  route text not null check(length(route) between 1 and 160), scope text not null, status_code integer not null check(status_code between 100 and 599),
  outcome text not null check(outcome in ('succeeded','denied','failed','rate-limited','conflict')),
  error_code text check(error_code is null or error_code ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  idempotency_key_hash text check(idempotency_key_hash is null or idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  resource_type text, resource_id uuid, occurred_at timestamptz not null,
  foreign key(api_key_id,workspace_id) references public.operational_api_keys(id,workspace_id) on delete restrict
);
create index operational_api_receipts_workspace_occurred_idx on public.operational_api_receipts(workspace_id,occurred_at desc);
create unique index operational_api_receipts_idempotency_idx on public.operational_api_receipts(api_key_id,route,idempotency_key_hash) where idempotency_key_hash is not null and outcome='succeeded';

create table public.generic_webhook_endpoints (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  name text not null check(length(btrim(name)) between 1 and 120), endpoint_key text not null check(endpoint_key ~ '^[A-Za-z0-9_-]{24,80}$'),
  auth_mode text not null check(auth_mode in ('hmac-sha256','bearer')),
  current_verifier text not null check(current_verifier ~ '^[a-f0-9]{64}$'), previous_verifier text check(previous_verifier is null or previous_verifier ~ '^[a-f0-9]{64}$'),
  previous_valid_until timestamptz, enabled boolean not null default true, created_by_membership_id uuid not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  unique(endpoint_key), unique(id,workspace_id)
);
create table public.generic_webhook_receipts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, endpoint_id uuid not null,
  correlation_id uuid not null, replay_hash text not null check(replay_hash ~ '^[a-f0-9]{64}$'), body_hash text not null check(body_hash ~ '^[a-f0-9]{64}$'),
  accepted boolean not null, status_code integer not null check(status_code between 100 and 599), error_code text,
  received_at timestamptz not null, foreign key(endpoint_id,workspace_id) references public.generic_webhook_endpoints(id,workspace_id) on delete restrict,
  unique(endpoint_id,replay_hash)
);
create index generic_webhook_receipts_endpoint_received_idx on public.generic_webhook_receipts(endpoint_id,received_at desc);

create or replace function public.create_generic_webhook_endpoint(target_workspace_id uuid,target_name text,target_endpoint_key text,target_auth_mode text,target_verifier text,target_actor_membership_id uuid,target_created_at timestamptz)
returns public.generic_webhook_endpoints language plpgsql security definer set search_path='' as $$ declare created public.generic_webhook_endpoints%rowtype;
begin perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id); if not public.is_workspace_owner(target_workspace_id) then raise exception 'owner required' using errcode='42501'; end if; insert into public.generic_webhook_endpoints(workspace_id,name,endpoint_key,auth_mode,current_verifier,created_by_membership_id,created_at,updated_at) values(target_workspace_id,btrim(target_name),target_endpoint_key,target_auth_mode,target_verifier,target_actor_membership_id,target_created_at,target_created_at) returning * into created; return created; end $$;

create or replace function public.rotate_generic_webhook_secret(target_endpoint_id uuid,target_new_verifier text,target_overlap_until timestamptz,target_actor_membership_id uuid,target_rotated_at timestamptz)
returns public.generic_webhook_endpoints language plpgsql security definer set search_path='' as $$ declare target public.generic_webhook_endpoints%rowtype;
begin select * into target from public.generic_webhook_endpoints where id=target_endpoint_id for update; if target.id is null then raise exception 'endpoint not found' using errcode='42501'; end if; perform public.assert_crm_actor_membership(target_actor_membership_id,target.workspace_id); if not public.is_workspace_owner(target.workspace_id) or target_overlap_until<=target_rotated_at or target_overlap_until>target_rotated_at+interval '24 hours' then raise exception 'invalid rotation' using errcode='42501'; end if; update public.generic_webhook_endpoints set previous_verifier=current_verifier,previous_valid_until=target_overlap_until,current_verifier=target_new_verifier,updated_at=target_rotated_at where id=target.id returning * into target; return target; end $$;

create or replace function public.resolve_generic_webhook_authority(target_endpoint_key text,target_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$ declare target public.generic_webhook_endpoints%rowtype;
begin select * into target from public.generic_webhook_endpoints where endpoint_key=target_endpoint_key and enabled; if target.id is null then raise exception 'endpoint denied' using errcode='42501'; end if; return jsonb_build_object('endpointId',target.id,'workspaceId',target.workspace_id,'authMode',target.auth_mode,'currentVerifier',target.current_verifier,'previousVerifier',case when target.previous_valid_until>target_now then target.previous_verifier end,'previousValidUntil',target.previous_valid_until); end $$;

create or replace function public.record_generic_webhook_delivery(target_endpoint_id uuid,target_replay_hash text,target_body_hash text,target_accepted boolean,target_status_code integer,target_error_code text,target_received_at timestamptz,target_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$ declare target public.generic_webhook_endpoints%rowtype; created public.generic_webhook_receipts%rowtype;
begin select * into target from public.generic_webhook_endpoints where id=target_endpoint_id; if target.id is null then raise exception 'endpoint denied' using errcode='42501'; end if; insert into public.generic_webhook_receipts(workspace_id,endpoint_id,correlation_id,replay_hash,body_hash,accepted,status_code,error_code,received_at) values(target.workspace_id,target.id,target_correlation_id,target_replay_hash,target_body_hash,target_accepted,target_status_code,target_error_code,target_received_at) on conflict(endpoint_id,replay_hash) do nothing returning * into created; if created.id is null then return jsonb_build_object('accepted',false,'duplicate',true); end if; return jsonb_build_object('accepted',target_accepted,'duplicate',false,'receiptId',created.id); end $$;

create or replace function public.prevent_data_portability_evidence_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'operational evidence is append-only' using errcode='55000'; end; $$;
create trigger data_import_runs_immutable before update or delete on public.data_import_runs for each row execute function public.prevent_data_portability_evidence_mutation();
create trigger data_import_row_outcomes_immutable before update or delete on public.data_import_row_outcomes for each row execute function public.prevent_data_portability_evidence_mutation();
create trigger data_export_receipts_immutable before update or delete on public.data_export_receipts for each row execute function public.prevent_data_portability_evidence_mutation();
create trigger operational_api_receipts_immutable before update or delete on public.operational_api_receipts for each row execute function public.prevent_data_portability_evidence_mutation();
create trigger generic_webhook_receipts_immutable before update or delete on public.generic_webhook_receipts for each row execute function public.prevent_data_portability_evidence_mutation();

alter table public.data_mapping_profiles enable row level security; alter table public.data_mapping_profiles force row level security;
alter table public.data_import_runs enable row level security; alter table public.data_import_runs force row level security;
alter table public.data_import_row_outcomes enable row level security; alter table public.data_import_row_outcomes force row level security;
alter table public.data_export_receipts enable row level security; alter table public.data_export_receipts force row level security;
alter table public.operational_api_keys enable row level security; alter table public.operational_api_keys force row level security;
alter table public.operational_api_receipts enable row level security; alter table public.operational_api_receipts force row level security;
alter table public.generic_webhook_endpoints enable row level security; alter table public.generic_webhook_endpoints force row level security;
alter table public.generic_webhook_receipts enable row level security; alter table public.generic_webhook_receipts force row level security;

create policy data_mapping_profiles_read on public.data_mapping_profiles for select to authenticated using(public.has_workspace_access(workspace_id));
create policy data_import_runs_read on public.data_import_runs for select to authenticated using(public.has_workspace_access(workspace_id));
create policy data_import_rows_read on public.data_import_row_outcomes for select to authenticated using(public.has_workspace_access(workspace_id));
create policy data_export_receipts_read on public.data_export_receipts for select to authenticated using(public.has_workspace_access(workspace_id));
create policy operational_api_keys_owner_read on public.operational_api_keys for select to authenticated using(public.is_workspace_owner(workspace_id));
create policy operational_api_receipts_owner_read on public.operational_api_receipts for select to authenticated using(public.is_workspace_owner(workspace_id));
create policy generic_webhook_endpoints_owner_read on public.generic_webhook_endpoints for select to authenticated using(public.is_workspace_owner(workspace_id));
create policy generic_webhook_receipts_owner_read on public.generic_webhook_receipts for select to authenticated using(public.is_workspace_owner(workspace_id));

grant select on public.data_mapping_profiles,public.data_import_runs,public.data_import_row_outcomes,public.data_export_receipts to authenticated;
grant select on public.operational_api_keys,public.operational_api_receipts,public.generic_webhook_endpoints,public.generic_webhook_receipts to authenticated;

create or replace function public.create_operational_api_key(target_workspace_id uuid,target_name text,target_prefix text,target_verifier text,target_scopes text[],target_expires_at timestamptz,target_actor_membership_id uuid,target_created_at timestamptz)
returns public.operational_api_keys language plpgsql security definer set search_path='' as $$ declare created public.operational_api_keys%rowtype;
begin perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id); if not public.is_workspace_owner(target_workspace_id) then raise exception 'owner required' using errcode='42501'; end if;
if target_expires_at<=target_created_at or target_scopes is null then raise exception 'invalid key request' using errcode='23514'; end if;
if (select count(*) from public.operational_api_keys where workspace_id=target_workspace_id and state='active' and expires_at>target_created_at)>=10 then raise exception 'active key limit reached' using errcode='23514'; end if;
insert into public.operational_api_keys(workspace_id,name,key_prefix,verifier,scopes,expires_at,created_by_membership_id,created_at) values(target_workspace_id,btrim(target_name),target_prefix,target_verifier,array(select distinct unnest(target_scopes) order by 1),target_expires_at,target_actor_membership_id,target_created_at) returning * into created; return created; end $$;

create or replace function public.save_data_mapping_profile(target_workspace_id uuid,target_name text,target_definition jsonb,target_actor_membership_id uuid,target_created_at timestamptz)
returns public.data_mapping_profiles language plpgsql security definer set search_path='' as $$ declare created public.data_mapping_profiles%rowtype; next_version integer;
begin perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id); if target_definition-'mapping'-'defaults'<>'{}'::jsonb or jsonb_typeof(target_definition->'mapping')<>'object' or coalesce(jsonb_typeof(target_definition->'defaults'),'object')<>'object' then raise exception 'invalid mapping profile' using errcode='23514'; end if;
update public.data_mapping_profiles set archived_at=target_created_at where workspace_id=target_workspace_id and lower(name)=lower(btrim(target_name)) and archived_at is null; select coalesce(max(version),0)+1 into next_version from public.data_mapping_profiles where workspace_id=target_workspace_id and lower(name)=lower(btrim(target_name));
insert into public.data_mapping_profiles(workspace_id,name,version,definition,created_by_membership_id,created_at) values(target_workspace_id,btrim(target_name),next_version,target_definition,target_actor_membership_id,target_created_at) returning * into created; return created; end $$;

create or replace function public.record_data_import_run(target_workspace_id uuid,target_actor_membership_id uuid,target_mapping_profile_id uuid,target_mapping_version integer,target_source text,target_format text,target_file_hash text,target_idempotency_key text,target_outcome public.data_operation_outcome,target_counts jsonb,target_rows jsonb,target_started_at timestamptz,target_completed_at timestamptz,target_correlation_id uuid)
returns public.data_import_runs language plpgsql security definer set search_path='' as $$ declare created public.data_import_runs%rowtype; row_item jsonb;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id);
  insert into public.data_import_runs(workspace_id,actor_membership_id,mapping_profile_id,mapping_version,source,format,file_hash,idempotency_key,outcome,total_rows,created_count,updated_count,unchanged_count,rejected_count,quarantined_count,failed_count,started_at,completed_at,correlation_id)
  values(target_workspace_id,target_actor_membership_id,target_mapping_profile_id,target_mapping_version,target_source,target_format,target_file_hash,target_idempotency_key,target_outcome,coalesce((target_counts->>'total')::int,0),coalesce((target_counts->>'created')::int,0),coalesce((target_counts->>'updated')::int,0),coalesce((target_counts->>'unchanged')::int,0),coalesce((target_counts->>'rejected')::int,0),coalesce((target_counts->>'quarantined')::int,0),coalesce((target_counts->>'failed')::int,0),target_started_at,target_completed_at,target_correlation_id)
  on conflict(workspace_id,idempotency_key) do nothing returning * into created;
  if created.id is not null then
    if jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows)>5000 then raise exception 'invalid import row outcomes' using errcode='23514'; end if;
    for row_item in select value from jsonb_array_elements(target_rows) loop
      if row_item - 'rowNumber' - 'outcome' - 'contactId' - 'incompleteRecordId' - 'errorCode'<>'{}'::jsonb then raise exception 'invalid import row outcome' using errcode='23514'; end if;
      insert into public.data_import_row_outcomes(workspace_id,import_run_id,row_number,outcome,contact_id,incomplete_record_id,error_code,created_at)
      values(target_workspace_id,created.id,(row_item->>'rowNumber')::integer,row_item->>'outcome',nullif(row_item->>'contactId','')::uuid,nullif(row_item->>'incompleteRecordId','')::uuid,nullif(row_item->>'errorCode',''),target_completed_at);
    end loop;
    return created;
  end if;
  select * into strict created from public.data_import_runs where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if created.file_hash<>target_file_hash or created.mapping_profile_id is distinct from target_mapping_profile_id or created.mapping_version is distinct from target_mapping_version then
    raise exception 'import idempotency key conflicts with another request' using errcode='23505';
  end if;
  return created;
end $$;

create or replace function public.record_data_export_receipt(target_workspace_id uuid,target_actor_membership_id uuid,target_entity_type text,target_format text,target_selection jsonb,target_selection_hash text,target_row_count integer,target_outcome public.data_operation_outcome,target_correlation_id uuid,target_created_at timestamptz)
returns public.data_export_receipts language plpgsql security definer set search_path='' as $$ declare created public.data_export_receipts%rowtype;
begin perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id); insert into public.data_export_receipts(workspace_id,actor_membership_id,entity_type,format,selection,selection_hash,row_count,outcome,correlation_id,created_at) values(target_workspace_id,target_actor_membership_id,target_entity_type,target_format,target_selection,target_selection_hash,target_row_count,target_outcome,target_correlation_id,target_created_at) returning * into created; return created; end $$;

create or replace function public.revoke_operational_api_key(target_key_id uuid,target_actor_membership_id uuid,target_revoked_at timestamptz)
returns public.operational_api_keys language plpgsql security definer set search_path='' as $$ declare target public.operational_api_keys%rowtype;
begin select * into target from public.operational_api_keys where id=target_key_id for update; if target.id is null then raise exception 'key not found' using errcode='42501'; end if; perform public.assert_crm_actor_membership(target_actor_membership_id,target.workspace_id); if not public.is_workspace_owner(target.workspace_id) then raise exception 'owner required' using errcode='42501'; end if;
if target.state='active' then update public.operational_api_keys set state='revoked',revoked_at=target_revoked_at where id=target.id returning * into target; end if; return target; end $$;

create or replace function public.rotate_operational_api_key(target_key_id uuid,target_new_prefix text,target_new_verifier text,target_expires_at timestamptz,target_actor_membership_id uuid,target_rotated_at timestamptz)
returns public.operational_api_keys language plpgsql security definer set search_path='' as $$ declare previous public.operational_api_keys%rowtype; created public.operational_api_keys%rowtype;
begin select * into previous from public.operational_api_keys where id=target_key_id for update; if previous.id is null then raise exception 'key not found' using errcode='42501'; end if; perform public.assert_crm_actor_membership(target_actor_membership_id,previous.workspace_id); if not public.is_workspace_owner(previous.workspace_id) or previous.state<>'active' or target_expires_at<=target_rotated_at then raise exception 'invalid key rotation' using errcode='42501'; end if;
insert into public.operational_api_keys(workspace_id,name,key_prefix,verifier,scopes,expires_at,rotated_from_key_id,created_by_membership_id,created_at) values(previous.workspace_id,previous.name,target_new_prefix,target_new_verifier,previous.scopes,target_expires_at,previous.id,target_actor_membership_id,target_rotated_at) returning * into created;
update public.operational_api_keys set state='revoked',revoked_at=target_rotated_at where id=previous.id; return created; end $$;

create or replace function public.authenticate_operational_api_key(target_prefix text,target_verifier text,target_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$ declare target public.operational_api_keys%rowtype; owner_membership uuid;
begin select * into target from public.operational_api_keys where key_prefix=target_prefix and verifier=target_verifier for update; if target.id is null or target.state<>'active' or target.expires_at<=target_now then raise exception 'api key denied' using errcode='42501'; end if;
select id into owner_membership from public.workspace_members where workspace_id=target.workspace_id and role='owner' and status='active'; if owner_membership is null then raise exception 'workspace owner unavailable' using errcode='42501'; end if;
update public.operational_api_keys set last_used_at=target_now where id=target.id; return jsonb_build_object('keyId',target.id,'workspaceId',target.workspace_id,'ownerMembershipId',owner_membership,'scopes',target.scopes,'expiresAt',target.expires_at); end $$;

create or replace function public.execute_operational_contacts_api(target_prefix text,target_verifier text,target_action text,target_payload jsonb,target_idempotency_hash text,target_correlation_id uuid,target_now timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority jsonb; key_id uuid; workspace uuid; owner_member uuid; owner_user uuid; required_scope text; route_name text; target_contact public.contacts%rowtype; target_incomplete public.incomplete_records%rowtype; prior public.operational_api_receipts%rowtype; page_size integer; result jsonb; response_status integer:=200;
begin
  if target_action not in ('contacts.list','contacts.read','contacts.search','contacts.create','contacts.update','contacts.archive','intake.create','status.read') or target_payload is null or jsonb_typeof(target_payload)<>'object' or pg_column_size(target_payload)>262144 or target_correlation_id is null then raise exception 'invalid operational request' using errcode='23514'; end if;
  authority:=public.authenticate_operational_api_key(target_prefix,target_verifier,target_now); key_id:=(authority->>'keyId')::uuid; workspace:=(authority->>'workspaceId')::uuid; owner_member:=(authority->>'ownerMembershipId')::uuid;
  select wm.user_id into owner_user from public.workspace_members wm where wm.id=owner_member and wm.workspace_id=workspace and wm.status='active';
  required_scope:=case target_action when 'contacts.create' then 'contacts.create' when 'contacts.update' then 'contacts.update' when 'contacts.archive' then 'contacts.archive' when 'contacts.search' then 'contacts.search' when 'intake.create' then 'intake.create' when 'status.read' then 'status.read' else 'contacts.read' end;
  if not (authority->'scopes' ? required_scope) then raise exception 'scope denied' using errcode='42501'; end if;
  if (select count(*) from public.operational_api_receipts where api_key_id=key_id and occurred_at>target_now-interval '1 minute')>=120 then raise exception 'rate limited' using errcode='P0001'; end if;
  route_name:='/api/v1/'||replace(target_action,'.','/');
  if target_action in ('contacts.create','contacts.update','contacts.archive','intake.create') then
    if target_idempotency_hash !~ '^[a-f0-9]{64}$' then raise exception 'idempotency key required' using errcode='23514'; end if;
    select * into prior from public.operational_api_receipts where api_key_id=key_id and route=route_name and idempotency_key_hash=target_idempotency_hash and outcome='succeeded';
    if prior.id is not null then
      if prior.resource_type='incomplete-record' then
        select * into target_incomplete from public.incomplete_records where id=prior.resource_id and workspace_id=workspace;
        return jsonb_build_object('data',to_jsonb(target_incomplete)-'workspace_id'-'intake_request_hash'-'conversion_request_hash','meta',jsonb_build_object('noOp',true,'correlationId',prior.correlation_id));
      end if;
      select * into target_contact from public.contacts where id=prior.resource_id and workspace_id=workspace;
      return jsonb_build_object('data',to_jsonb(target_contact)-'owner_id'-'workspace_id','meta',jsonb_build_object('noOp',true,'correlationId',prior.correlation_id));
    end if;
  end if;
  if target_action='status.read' then result:=jsonb_build_object('status','available','schemaVersion','operational-api.v1');
  elsif target_action in ('contacts.list','contacts.search') then
    page_size:=least(greatest(coalesce((target_payload->>'limit')::integer,50),1),100);
    select coalesce(jsonb_agg(to_jsonb(c)-'owner_id'-'workspace_id' order by c.updated_at desc,c.id), '[]'::jsonb) into result from (select * from public.contacts where workspace_id=workspace and archived_at is null and (target_action='contacts.list' or coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||coalesce(email,'')||' '||coalesce(phone,'') ilike '%'||coalesce(target_payload->>'query','')||'%') and (not target_payload ? 'cursor' or (updated_at,id)<((target_payload->'cursor'->>'updatedAt')::timestamptz,(target_payload->'cursor'->>'id')::uuid)) order by updated_at desc,id limit page_size) c;
    result:=jsonb_build_object('items',result,'limit',page_size,'nextCursor',case when jsonb_array_length(result)=page_size then jsonb_build_object('updatedAt',(result->(page_size-1))->>'updated_at','id',(result->(page_size-1))->>'id') end);
  elsif target_action='contacts.read' then select * into target_contact from public.contacts where id=(target_payload->>'contactId')::uuid and workspace_id=workspace; if target_contact.id is null then raise exception 'contact not found' using errcode='P0002'; end if; result:=to_jsonb(target_contact)-'owner_id'-'workspace_id';
  elsif target_action='contacts.create' then
    if target_payload - 'firstName' - 'lastName' - 'email' - 'phone' - 'leadType' - 'relationship' - 'intent' - 'source' - 'pipelineStage' - 'tags' - 'emailSubscribed' <> '{}'::jsonb then raise exception 'unsupported contact fields' using errcode='23514'; end if;
    insert into public.contacts(workspace_id,owner_id,first_name,last_name,email,phone,lead_type,relationship,intent,source,pipeline_stage,tags,email_subscribed,created_at,updated_at)
    values(workspace,owner_user,coalesce(target_payload->>'firstName',''),coalesce(target_payload->>'lastName',''),nullif(lower(target_payload->>'email'),''),nullif(target_payload->>'phone',''),coalesce(target_payload->>'leadType','warm')::public.lead_type,coalesce(target_payload->>'relationship','lead')::public.relationship,coalesce(target_payload->>'intent','unknown')::public.intent,coalesce(target_payload->>'source','other')::public.lead_source,coalesce(target_payload->>'pipelineStage','new')::public.pipeline_stage,coalesce(array(select jsonb_array_elements_text(target_payload->'tags')),'{}'),coalesce((target_payload->>'emailSubscribed')::boolean,true),target_now,target_now) returning * into target_contact; response_status:=201; result:=to_jsonb(target_contact)-'owner_id'-'workspace_id';
  elsif target_action='contacts.update' then
    if target_payload - 'contactId' - 'expectedUpdatedAt' - 'firstName' - 'lastName' - 'email' - 'phone' - 'leadType' - 'relationship' - 'intent' - 'source' - 'pipelineStage' - 'tags' - 'emailSubscribed' <> '{}'::jsonb then raise exception 'unsupported contact fields' using errcode='23514'; end if;
    select * into target_contact from public.contacts where id=(target_payload->>'contactId')::uuid and workspace_id=workspace and archived_at is null for update; if target_contact.id is null then raise exception 'contact not found' using errcode='P0002'; end if; if target_contact.updated_at<>(target_payload->>'expectedUpdatedAt')::timestamptz then raise exception 'version conflict' using errcode='40001'; end if;
    update public.contacts set first_name=coalesce(target_payload->>'firstName',first_name),last_name=coalesce(target_payload->>'lastName',last_name),email=case when target_payload?'email' then nullif(lower(target_payload->>'email'),'') else email end,phone=case when target_payload?'phone' then nullif(target_payload->>'phone','') else phone end,lead_type=coalesce((target_payload->>'leadType')::public.lead_type,lead_type),relationship=coalesce((target_payload->>'relationship')::public.relationship,relationship),intent=coalesce((target_payload->>'intent')::public.intent,intent),source=coalesce((target_payload->>'source')::public.lead_source,source),pipeline_stage=coalesce((target_payload->>'pipelineStage')::public.pipeline_stage,pipeline_stage),tags=case when target_payload?'tags' then array(select jsonb_array_elements_text(target_payload->'tags')) else tags end,email_subscribed=coalesce((target_payload->>'emailSubscribed')::boolean,email_subscribed),updated_at=target_now where id=target_contact.id returning * into target_contact; result:=to_jsonb(target_contact)-'owner_id'-'workspace_id';
  elsif target_action='contacts.archive' then
    select * into target_contact from public.contacts where id=(target_payload->>'contactId')::uuid and workspace_id=workspace and archived_at is null for update; if target_contact.id is null then raise exception 'contact not found' using errcode='P0002'; end if; if target_contact.updated_at<>(target_payload->>'expectedUpdatedAt')::timestamptz then raise exception 'version conflict' using errcode='40001'; end if;
    update public.contacts set archived_at=target_now,archived_by_membership_id=owner_member,archive_reason=left(coalesce(target_payload->>'reason','Archived through operational API'),240),updated_at=target_now where id=target_contact.id returning * into target_contact; result:=to_jsonb(target_contact)-'owner_id'-'workspace_id';
  else
    if target_payload - 'source' - 'externalId' - 'candidate' - 'validationReasons' <> '{}'::jsonb
       or jsonb_typeof(target_payload->'candidate')<>'object'
       or not public.is_valid_incomplete_candidate(target_payload->'candidate') then
      raise exception 'invalid intake payload' using errcode='23514';
    end if;
    insert into public.incomplete_records(workspace_id,source,external_id,candidate,validation_reasons,intake_idempotency_key,intake_request_hash)
    values(workspace,coalesce(nullif(btrim(target_payload->>'source'),''),'operational-api'),nullif(btrim(target_payload->>'externalId'),''),target_payload->'candidate',coalesce(target_payload->'validationReasons',jsonb_build_array(jsonb_build_object('field','record','code','external-intake','message','Review this externally submitted record.'))),target_idempotency_hash,encode(extensions.digest(convert_to(target_payload::text,'UTF8'),'sha256'),'hex'))
    returning * into target_incomplete;
    response_status:=202; result:=to_jsonb(target_incomplete)-'workspace_id'-'intake_request_hash'-'conversion_request_hash';
  end if;
  insert into public.operational_api_receipts(workspace_id,api_key_id,correlation_id,method,route,scope,status_code,outcome,idempotency_key_hash,resource_type,resource_id,occurred_at) values(workspace,key_id,target_correlation_id,case when target_action in ('contacts.list','contacts.read','contacts.search','status.read') then 'GET' when target_action='contacts.update' then 'PATCH' else 'POST' end,route_name,required_scope,response_status,'succeeded',target_idempotency_hash,case when target_action='intake.create' then 'incomplete-record' when target_action like 'contacts.%' then 'contact' end,case when target_action='intake.create' then target_incomplete.id else target_contact.id end,target_now);
  return jsonb_build_object('data',result,'meta',jsonb_build_object('noOp',false,'correlationId',target_correlation_id));
end $$;

revoke all on function public.create_operational_api_key(uuid,text,text,text,text[],timestamptz,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.create_operational_api_key(uuid,text,text,text,text[],timestamptz,uuid,timestamptz) to authenticated;
revoke all on function public.save_data_mapping_profile(uuid,text,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.save_data_mapping_profile(uuid,text,jsonb,uuid,timestamptz) to authenticated;
revoke all on function public.record_data_import_run(uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,jsonb,jsonb,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role; grant execute on function public.record_data_import_run(uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,jsonb,jsonb,timestamptz,timestamptz,uuid) to authenticated;
revoke all on function public.record_data_export_receipt(uuid,uuid,text,text,jsonb,text,integer,public.data_operation_outcome,uuid,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.record_data_export_receipt(uuid,uuid,text,text,jsonb,text,integer,public.data_operation_outcome,uuid,timestamptz) to authenticated;
revoke all on function public.revoke_operational_api_key(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.revoke_operational_api_key(uuid,uuid,timestamptz) to authenticated;
revoke all on function public.rotate_operational_api_key(uuid,text,text,timestamptz,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.rotate_operational_api_key(uuid,text,text,timestamptz,uuid,timestamptz) to authenticated;
revoke all on function public.authenticate_operational_api_key(text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.authenticate_operational_api_key(text,text,timestamptz) to service_role;
revoke all on function public.execute_operational_contacts_api(text,text,text,jsonb,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.execute_operational_contacts_api(text,text,text,jsonb,text,uuid,timestamptz) to service_role;
revoke all on function public.create_generic_webhook_endpoint(uuid,text,text,text,text,uuid,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.create_generic_webhook_endpoint(uuid,text,text,text,text,uuid,timestamptz) to authenticated;
revoke all on function public.rotate_generic_webhook_secret(uuid,text,timestamptz,uuid,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.rotate_generic_webhook_secret(uuid,text,timestamptz,uuid,timestamptz) to authenticated;
revoke all on function public.resolve_generic_webhook_authority(text,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.resolve_generic_webhook_authority(text,timestamptz) to service_role;
revoke all on function public.record_generic_webhook_delivery(uuid,text,text,boolean,integer,text,timestamptz,uuid) from public,anon,authenticated,service_role; grant execute on function public.record_generic_webhook_delivery(uuid,text,text,boolean,integer,text,timestamptz,uuid) to service_role;

commit;
