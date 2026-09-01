-- Story 9.1: provenance-aware property identities, facts, interests, and transaction links.
begin;

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  state_code text not null,
  postal_code text not null,
  country_code text not null default 'US',
  normalized_address_key text not null,
  property_kind text not null,
  lifecycle text not null,
  current_version integer not null default 1,
  created_by_membership_id uuid not null,
  updated_by_membership_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint properties_id_workspace_unique unique(id,workspace_id),
  constraint properties_address_workspace_unique unique(workspace_id,normalized_address_key),
  constraint properties_creator_workspace_fk foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint properties_updater_workspace_fk foreign key(updated_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint properties_kind_valid check(property_kind in ('single-family','condo','townhouse','multifamily','land','commercial','other','unknown')),
  constraint properties_lifecycle_valid check(lifecycle in ('off-market','coming-soon','active','pending','sold','withdrawn','unknown')),
  constraint properties_address_valid check(length(trim(address_line_1)) between 1 and 160 and length(trim(city)) between 1 and 100 and state_code ~ '^[A-Z]{2}$' and postal_code ~ '^\d{5}(-\d{4})?$' and country_code='US'),
  constraint properties_version_positive check(current_version>0)
);

create table public.property_identity_revisions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  property_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  reason_code text not null,
  actor_membership_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  constraint property_identity_revision_property_fk foreign key(property_id,workspace_id) references public.properties(id,workspace_id) on delete restrict,
  constraint property_identity_revision_actor_fk foreign key(actor_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint property_identity_revision_version_unique unique(workspace_id,property_id,version),
  constraint property_identity_revision_idempotency_unique unique(workspace_id,idempotency_key),
  constraint property_identity_revision_snapshot_object check(jsonb_typeof(snapshot)='object'),
  constraint property_identity_revision_reason_valid check(length(trim(reason_code)) between 1 and 80)
);

create table public.property_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  property_id uuid not null,
  field_key text not null,
  fact_value jsonb not null,
  authority text not null,
  provider text,
  provider_record_id text,
  source_reference text not null,
  as_of timestamptz not null,
  permission_state text not null,
  display_until timestamptz,
  retention_until timestamptz,
  current_version integer not null default 1,
  recorded_by_membership_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint property_facts_id_workspace_unique unique(id,workspace_id),
  constraint property_facts_property_workspace_fk foreign key(property_id,workspace_id) references public.properties(id,workspace_id) on delete restrict,
  constraint property_facts_actor_workspace_fk foreign key(recorded_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint property_facts_current_unique unique nulls not distinct(workspace_id,property_id,field_key,authority,provider),
  constraint property_facts_field_valid check(field_key in ('bedrooms','bathrooms','square-feet','year-built','list-price-cents','association-name','flood-zone','parcel-reference','listing-status')),
  constraint property_facts_authority_valid check(authority in ('manual','licensed-provider')),
  constraint property_facts_permission_valid check(permission_state in ('allowed','restricted','revoked','unknown')),
  constraint property_facts_source_valid check(length(trim(source_reference)) between 1 and 240),
  constraint property_facts_provider_authority check((authority='manual' and provider is null and provider_record_id is null) or (authority='licensed-provider' and length(trim(provider)) between 1 and 120 and length(trim(provider_record_id)) between 1 and 160 and permission_state<>'unknown')),
  constraint property_facts_dates_valid check((display_until is null or display_until>=as_of) and (retention_until is null or display_until is null or retention_until>=display_until)),
  constraint property_facts_version_positive check(current_version>0)
);

create table public.property_fact_revisions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  property_fact_id uuid not null,
  property_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  actor_membership_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  constraint property_fact_revision_fact_fk foreign key(property_fact_id,workspace_id) references public.property_facts(id,workspace_id) on delete restrict,
  constraint property_fact_revision_property_fk foreign key(property_id,workspace_id) references public.properties(id,workspace_id) on delete restrict,
  constraint property_fact_revision_actor_fk foreign key(actor_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint property_fact_revision_version_unique unique(workspace_id,property_fact_id,version),
  constraint property_fact_revision_idempotency_unique unique(workspace_id,idempotency_key),
  constraint property_fact_revision_snapshot_object check(jsonb_typeof(snapshot)='object')
);

create table public.property_interests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  property_id uuid not null,
  contact_id uuid not null,
  interest_type text not null,
  source text not null,
  source_reference text not null,
  occurred_at timestamptz not null,
  current_version integer not null default 1,
  archived_at timestamptz,
  created_by_membership_id uuid not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint property_interests_id_workspace_unique unique(id,workspace_id),
  constraint property_interests_property_workspace_fk foreign key(property_id,workspace_id) references public.properties(id,workspace_id) on delete restrict,
  constraint property_interests_contact_workspace_fk foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint property_interests_actor_workspace_fk foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint property_interests_type_valid check(interest_type in ('inquiry','saved','favorite','showing-intent','seller-owned','seller-prospect')),
  constraint property_interests_source_valid check(source in ('manual','website','licensed-provider') and length(trim(source_reference)) between 1 and 240),
  constraint property_interests_version_positive check(current_version>0)
);

create table public.property_interest_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  property_interest_id uuid not null,
  from_state text,
  to_state text not null,
  reason_code text not null,
  actor_membership_id uuid not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  constraint property_interest_event_interest_fk foreign key(property_interest_id,workspace_id) references public.property_interests(id,workspace_id) on delete restrict,
  constraint property_interest_event_actor_fk foreign key(actor_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint property_interest_event_idempotency_unique unique(workspace_id,idempotency_key),
  constraint property_interest_event_states check((from_state is null or from_state in ('active','archived')) and to_state in ('active','archived'))
);

create table public.transaction_property_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  property_id uuid not null,
  transaction_id uuid not null,
  link_role text not null,
  created_by_membership_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  constraint transaction_property_link_property_fk foreign key(property_id,workspace_id) references public.properties(id,workspace_id) on delete restrict,
  constraint transaction_property_link_transaction_fk foreign key(transaction_id,workspace_id) references public.real_estate_transactions(id,workspace_id) on delete restrict,
  constraint transaction_property_link_actor_fk foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint transaction_property_link_unique unique(workspace_id,property_id,transaction_id,link_role),
  constraint transaction_property_link_idempotency_unique unique(workspace_id,idempotency_key),
  constraint transaction_property_link_role_valid check(link_role in ('subject','comparable','other'))
);

create index properties_workspace_updated_idx on public.properties(workspace_id,updated_at desc);
create index property_facts_property_idx on public.property_facts(workspace_id,property_id,field_key);
create index property_interests_property_idx on public.property_interests(workspace_id,property_id,occurred_at desc);
create index property_interests_contact_idx on public.property_interests(workspace_id,contact_id,occurred_at desc);
create index transaction_property_links_property_idx on public.transaction_property_links(workspace_id,property_id,created_at desc);

create or replace function public.reject_property_history_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'property history is append-only' using errcode='55000'; end $$;
create trigger property_identity_revisions_no_mutation before update or delete on public.property_identity_revisions for each row execute function public.reject_property_history_mutation();
create trigger property_fact_revisions_no_mutation before update or delete on public.property_fact_revisions for each row execute function public.reject_property_history_mutation();
create trigger property_interest_events_no_mutation before update or delete on public.property_interest_events for each row execute function public.reject_property_history_mutation();

create or replace function public.normalized_property_address(target_line_1 text,target_line_2 text,target_city text,target_state text,target_postal text)
returns text language sql immutable set search_path='' as $$
  select regexp_replace(lower(trim(target_line_1)),'[^a-z0-9]+',' ','g')||'|'||
    case when nullif(trim(coalesce(target_line_2,'')),'') is null then '' else regexp_replace(lower(trim(target_line_2)),'[^a-z0-9]+',' ','g')||'|' end||
    regexp_replace(lower(trim(target_city)),'[^a-z0-9]+',' ','g')||'|'||lower(trim(target_state))||'|'||lower(trim(target_postal));
$$;

create or replace function public.create_manual_property(target_workspace_id uuid,target_membership_id uuid,target_address_line_1 text,target_address_line_2 text,target_city text,target_state_code text,target_postal_code text,target_property_kind text,target_lifecycle text,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.property_identity_revisions%rowtype; created public.properties%rowtype; normalized_key text;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into replay from public.property_identity_revisions where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('propertyId',replay.property_id,'version',replay.version,'noOp',true); end if;
  if target_occurred_at is null or length(trim(target_address_line_1)) not between 1 and 160 or length(trim(target_city)) not between 1 and 100
    or upper(trim(target_state_code)) !~ '^[A-Z]{2}$' or trim(target_postal_code) !~ '^\d{5}(-\d{4})?$'
    or target_property_kind not in ('single-family','condo','townhouse','multifamily','land','commercial','other','unknown')
    or target_lifecycle not in ('off-market','coming-soon','active','pending','sold','withdrawn','unknown')
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,160}$' then raise exception 'invalid property input' using errcode='22023'; end if;
  normalized_key:=public.normalized_property_address(target_address_line_1,target_address_line_2,target_city,target_state_code,target_postal_code);
  insert into public.properties(workspace_id,address_line_1,address_line_2,city,state_code,postal_code,normalized_address_key,property_kind,lifecycle,created_by_membership_id,updated_by_membership_id,created_at,updated_at)
  values(target_workspace_id,trim(target_address_line_1),nullif(trim(coalesce(target_address_line_2,'')),''),trim(target_city),upper(trim(target_state_code)),trim(target_postal_code),normalized_key,target_property_kind,target_lifecycle,target_membership_id,target_membership_id,target_occurred_at,target_occurred_at) returning * into created;
  insert into public.property_identity_revisions(workspace_id,property_id,version,snapshot,reason_code,actor_membership_id,idempotency_key,created_at)
  values(target_workspace_id,created.id,1,to_jsonb(created)-'workspace_id','created-manually',target_membership_id,target_idempotency_key,target_occurred_at);
  return jsonb_build_object('propertyId',created.id,'version',1,'noOp',false);
end $$;

create or replace function public.update_property_identity(target_workspace_id uuid,target_membership_id uuid,target_property_id uuid,target_expected_version integer,target_address_line_1 text,target_address_line_2 text,target_city text,target_state_code text,target_postal_code text,target_property_kind text,target_lifecycle text,target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.property_identity_revisions%rowtype; current_record public.properties%rowtype; updated public.properties%rowtype; normalized_key text;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into replay from public.property_identity_revisions where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('propertyId',replay.property_id,'version',replay.version,'noOp',true); end if;
  select * into current_record from public.properties where workspace_id=target_workspace_id and id=target_property_id for update;
  if not found then raise exception 'property not found' using errcode='P0002'; end if;
  if current_record.current_version<>target_expected_version then raise exception 'stale property version' using errcode='40001'; end if;
  if length(trim(target_reason_code)) not between 1 and 80 then raise exception 'invalid property change reason' using errcode='22023'; end if;
  normalized_key:=public.normalized_property_address(target_address_line_1,target_address_line_2,target_city,target_state_code,target_postal_code);
  update public.properties set address_line_1=trim(target_address_line_1),address_line_2=nullif(trim(coalesce(target_address_line_2,'')),''),city=trim(target_city),state_code=upper(trim(target_state_code)),postal_code=trim(target_postal_code),normalized_address_key=normalized_key,property_kind=target_property_kind,lifecycle=target_lifecycle,current_version=current_version+1,updated_by_membership_id=target_membership_id,updated_at=target_occurred_at
  where workspace_id=target_workspace_id and id=target_property_id returning * into updated;
  insert into public.property_identity_revisions(workspace_id,property_id,version,snapshot,reason_code,actor_membership_id,idempotency_key,created_at)
  values(target_workspace_id,updated.id,updated.current_version,to_jsonb(updated)-'workspace_id',trim(target_reason_code),target_membership_id,target_idempotency_key,target_occurred_at);
  return jsonb_build_object('propertyId',updated.id,'version',updated.current_version,'noOp',false);
end $$;

create or replace function public.upsert_property_fact(target_workspace_id uuid,target_membership_id uuid,target_property_id uuid,target_field_key text,target_fact_value jsonb,target_authority text,target_provider text,target_provider_record_id text,target_source_reference text,target_as_of timestamptz,target_permission_state text,target_display_until timestamptz,target_retention_until timestamptz,target_expected_version integer,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.property_fact_revisions%rowtype; current_record public.property_facts%rowtype; saved public.property_facts%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into replay from public.property_fact_revisions where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('factId',replay.property_fact_id,'version',replay.version,'noOp',true); end if;
  perform 1 from public.properties where workspace_id=target_workspace_id and id=target_property_id;
  if not found then raise exception 'property not found' using errcode='P0002'; end if;
  if target_fact_value is null or jsonb_typeof(target_fact_value) not in ('string','number','boolean') or length(trim(target_source_reference)) not between 1 and 240 then raise exception 'invalid property fact' using errcode='22023'; end if;
  if target_field_key in ('bedrooms','square-feet','year-built','list-price-cents') and (
    jsonb_typeof(target_fact_value)<>'number'
    or (target_fact_value #>> '{}')::numeric<>trunc((target_fact_value #>> '{}')::numeric)
    or (target_fact_value #>> '{}')::numeric not between 0 and 10000000000
  ) then raise exception 'integer property fact is invalid' using errcode='22023'; end if;
  if target_field_key='bathrooms' and (
    jsonb_typeof(target_fact_value)<>'number'
    or (target_fact_value #>> '{}')::numeric not between 0 and 100
    or mod((target_fact_value #>> '{}')::numeric * 2, 1)<>0
  ) then raise exception 'bathroom property fact is invalid' using errcode='22023'; end if;
  if target_field_key in ('association-name','flood-zone','parcel-reference','listing-status') and (
    jsonb_typeof(target_fact_value)<>'string'
    or length(trim(target_fact_value #>> '{}')) not between 1 and 240
  ) then raise exception 'text property fact is invalid' using errcode='22023'; end if;
  if target_authority='licensed-provider' and (length(trim(coalesce(target_provider,'')))=0 or length(trim(coalesce(target_provider_record_id,'')))=0 or target_permission_state='unknown') then raise exception 'licensed property fact lacks authority' using errcode='22023'; end if;
  if target_authority='manual' and (target_provider is not null or target_provider_record_id is not null) then raise exception 'manual property fact cannot claim provider authority' using errcode='22023'; end if;
  select * into current_record from public.property_facts where workspace_id=target_workspace_id and property_id=target_property_id and field_key=target_field_key and authority=target_authority and provider is not distinct from target_provider for update;
  if coalesce(current_record.current_version,0)<>target_expected_version then raise exception 'stale property fact version' using errcode='40001'; end if;
  if found then
    update public.property_facts set fact_value=target_fact_value,provider_record_id=target_provider_record_id,source_reference=trim(target_source_reference),as_of=target_as_of,permission_state=target_permission_state,display_until=target_display_until,retention_until=target_retention_until,current_version=current_version+1,recorded_by_membership_id=target_membership_id,updated_at=target_occurred_at where id=current_record.id returning * into saved;
  else
    insert into public.property_facts(workspace_id,property_id,field_key,fact_value,authority,provider,provider_record_id,source_reference,as_of,permission_state,display_until,retention_until,recorded_by_membership_id,created_at,updated_at)
    values(target_workspace_id,target_property_id,target_field_key,target_fact_value,target_authority,target_provider,target_provider_record_id,trim(target_source_reference),target_as_of,target_permission_state,target_display_until,target_retention_until,target_membership_id,target_occurred_at,target_occurred_at) returning * into saved;
  end if;
  insert into public.property_fact_revisions(workspace_id,property_fact_id,property_id,version,snapshot,actor_membership_id,idempotency_key,created_at)
  values(target_workspace_id,saved.id,target_property_id,saved.current_version,to_jsonb(saved)-'workspace_id',target_membership_id,target_idempotency_key,target_occurred_at);
  return jsonb_build_object('factId',saved.id,'version',saved.current_version,'noOp',false);
end $$;

create or replace function public.link_property_interest(target_workspace_id uuid,target_membership_id uuid,target_property_id uuid,target_contact_id uuid,target_interest_type text,target_source text,target_source_reference text,target_source_occurred_at timestamptz,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.property_interest_events%rowtype; created public.property_interests%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into replay from public.property_interest_events where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('interestId',replay.property_interest_id,'version',1,'noOp',true); end if;
  insert into public.property_interests(workspace_id,property_id,contact_id,interest_type,source,source_reference,occurred_at,created_by_membership_id,created_at,updated_at)
  values(target_workspace_id,target_property_id,target_contact_id,target_interest_type,target_source,trim(target_source_reference),target_source_occurred_at,target_membership_id,target_occurred_at,target_occurred_at) returning * into created;
  insert into public.property_interest_events(workspace_id,property_interest_id,to_state,reason_code,actor_membership_id,idempotency_key,occurred_at)
  values(target_workspace_id,created.id,'active','interest-linked',target_membership_id,target_idempotency_key,target_occurred_at);
  return jsonb_build_object('interestId',created.id,'version',1,'noOp',false);
end $$;

create or replace function public.archive_property_interest(target_workspace_id uuid,target_membership_id uuid,target_interest_id uuid,target_expected_version integer,target_reason_code text,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.property_interest_events%rowtype; current_record public.property_interests%rowtype; saved public.property_interests%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into replay from public.property_interest_events where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then select * into saved from public.property_interests where workspace_id=target_workspace_id and id=replay.property_interest_id; return jsonb_build_object('interestId',saved.id,'version',saved.current_version,'noOp',true); end if;
  select * into current_record from public.property_interests where workspace_id=target_workspace_id and id=target_interest_id for update;
  if not found then raise exception 'property interest not found' using errcode='P0002'; end if;
  if current_record.current_version<>target_expected_version then raise exception 'stale property interest version' using errcode='40001'; end if;
  if length(trim(coalesce(target_reason_code,''))) not between 1 and 80 then raise exception 'property interest archive reason is invalid' using errcode='22023'; end if;
  update public.property_interests set archived_at=target_occurred_at,current_version=current_version+1,updated_at=target_occurred_at where id=target_interest_id returning * into saved;
  insert into public.property_interest_events(workspace_id,property_interest_id,from_state,to_state,reason_code,actor_membership_id,idempotency_key,occurred_at)
  values(target_workspace_id,saved.id,'active','archived',trim(target_reason_code),target_membership_id,target_idempotency_key,target_occurred_at);
  return jsonb_build_object('interestId',saved.id,'version',saved.current_version,'noOp',false);
end $$;

create or replace function public.link_transaction_property(target_workspace_id uuid,target_membership_id uuid,target_property_id uuid,target_transaction_id uuid,target_link_role text,target_idempotency_key text,target_occurred_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare replay public.transaction_property_links%rowtype; created public.transaction_property_links%rowtype;
begin
  perform public.assert_crm_actor_membership(target_membership_id,target_workspace_id);
  select * into replay from public.transaction_property_links where workspace_id=target_workspace_id and idempotency_key=target_idempotency_key;
  if found then return jsonb_build_object('linkId',replay.id,'noOp',true); end if;
  select * into replay from public.transaction_property_links where workspace_id=target_workspace_id and property_id=target_property_id and transaction_id=target_transaction_id and link_role=target_link_role;
  if found then return jsonb_build_object('linkId',replay.id,'noOp',true); end if;
  insert into public.transaction_property_links(workspace_id,property_id,transaction_id,link_role,created_by_membership_id,idempotency_key,created_at)
  values(target_workspace_id,target_property_id,target_transaction_id,target_link_role,target_membership_id,target_idempotency_key,target_occurred_at)
  returning * into created;
  return jsonb_build_object('linkId',created.id,'noOp',false);
end $$;

alter table public.properties enable row level security; alter table public.properties force row level security;
alter table public.property_identity_revisions enable row level security; alter table public.property_identity_revisions force row level security;
alter table public.property_facts enable row level security; alter table public.property_facts force row level security;
alter table public.property_fact_revisions enable row level security; alter table public.property_fact_revisions force row level security;
alter table public.property_interests enable row level security; alter table public.property_interests force row level security;
alter table public.property_interest_events enable row level security; alter table public.property_interest_events force row level security;
alter table public.transaction_property_links enable row level security; alter table public.transaction_property_links force row level security;

create policy properties_member_select on public.properties for select to authenticated using(public.has_workspace_access(workspace_id));
create policy property_identity_revisions_member_select on public.property_identity_revisions for select to authenticated using(public.has_workspace_access(workspace_id));
create policy property_facts_member_select on public.property_facts for select to authenticated using(public.has_workspace_access(workspace_id));
create policy property_fact_revisions_member_select on public.property_fact_revisions for select to authenticated using(public.has_workspace_access(workspace_id));
create policy property_interests_member_select on public.property_interests for select to authenticated using(public.has_workspace_access(workspace_id));
create policy property_interest_events_member_select on public.property_interest_events for select to authenticated using(public.has_workspace_access(workspace_id));
create policy transaction_property_links_member_select on public.transaction_property_links for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on table public.properties,public.property_identity_revisions,public.property_facts,public.property_fact_revisions,public.property_interests,public.property_interest_events,public.transaction_property_links from public,anon,authenticated;
grant select on table public.properties,public.property_identity_revisions,public.property_facts,public.property_fact_revisions,public.property_interests,public.property_interest_events,public.transaction_property_links to authenticated;
grant all on table public.properties,public.property_identity_revisions,public.property_facts,public.property_fact_revisions,public.property_interests,public.property_interest_events,public.transaction_property_links to service_role;
revoke all on sequence public.property_identity_revisions_id_seq,public.property_fact_revisions_id_seq,public.property_interest_events_id_seq from public,anon,authenticated;
grant all on sequence public.property_identity_revisions_id_seq,public.property_fact_revisions_id_seq,public.property_interest_events_id_seq to service_role;
revoke all on function public.normalized_property_address(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.normalized_property_address(text,text,text,text,text) to service_role;
revoke all on function public.create_manual_property(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz),public.update_property_identity(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,timestamptz),public.upsert_property_fact(uuid,uuid,uuid,text,jsonb,text,text,text,text,timestamptz,text,timestamptz,timestamptz,integer,text,timestamptz),public.link_property_interest(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,timestamptz),public.archive_property_interest(uuid,uuid,uuid,integer,text,text,timestamptz),public.link_transaction_property(uuid,uuid,uuid,uuid,text,text,timestamptz) from public,anon;
grant execute on function public.create_manual_property(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz),public.update_property_identity(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,timestamptz),public.upsert_property_fact(uuid,uuid,uuid,text,jsonb,text,text,text,text,timestamptz,text,timestamptz,timestamptz,integer,text,timestamptz),public.link_property_interest(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,timestamptz),public.archive_property_interest(uuid,uuid,uuid,integer,text,text,timestamptz),public.link_transaction_property(uuid,uuid,uuid,uuid,text,text,timestamptz) to authenticated,service_role;

commit;
