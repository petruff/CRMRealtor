-- Omnix — Story 3.15 inert exact-contact merge foundation.
--
-- This migration is additive. It does not alter existing foreign keys or
-- immutable ledgers. Productive apply/reverse is structurally disabled here;
-- a later forward migration (0028) may activate it only after every repository,
-- import and outbound path is alias-aware.
--
-- ROLLBACK: ../rollbacks/0027_contact_merge_foundation.rollback.sql is allowed
-- only before the first plan/event write. Never use the down migration after an
-- activated merge; use reverse_exact_contact_merge instead.

begin;

create type public.contact_merge_evidence_kind as enum ('external-id','email','phone');
create type public.contact_merge_plan_state as enum ('pending','review-only','applied','reversed','expired');
create type public.contact_merge_member_role as enum ('survivor','donor');
create type public.contact_merge_event_kind as enum ('planned','review-required','applied','reversed');

-- One row per workspace carries the alias epoch. The CHECK makes productive
-- apply impossible in 0027 even if a caller can reach an RPC. 0028 must replace
-- this constraint explicitly; there is no dashboard/configuration bypass.
create table public.contact_merge_workspace_state (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete restrict,
  alias_epoch bigint not null default 0 check (alias_epoch >= 0),
  apply_enabled boolean not null default false,
  activation_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_merge_foundation_inert check (
    apply_enabled = false and activation_version = 0
  )
);

create table public.contact_merge_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_membership_id uuid not null,
  survivor_contact_id uuid not null,
  evidence_kind public.contact_merge_evidence_kind not null,
  group_hash text not null check (group_hash ~ '^[a-f0-9]{64}$'),
  dependency_counts jsonb not null default '[]'::jsonb check (jsonb_typeof(dependency_counts)='array'),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  alias_epoch bigint not null check (alias_epoch >= 0),
  state public.contact_merge_plan_state not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  reason_codes text[] not null default '{}',
  correlation_id uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  applied_at timestamptz,
  reversed_at timestamptz,
  apply_idempotency_key text,
  reverse_idempotency_key text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint contact_merge_plans_actor_workspace_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint contact_merge_plans_survivor_workspace_fk foreign key(survivor_contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint contact_merge_plans_workspace_key_unique unique(workspace_id,idempotency_key),
  constraint contact_merge_plans_workspace_request_unique unique(workspace_id,request_hash),
  constraint contact_merge_plans_id_workspace_unique unique(id,workspace_id),
  constraint contact_merge_plans_reason_codes_valid check (
    cardinality(reason_codes) <= 20 and array_position(reason_codes,null) is null
  ),
  constraint contact_merge_plans_lifecycle check (
    expires_at > created_at
    and ((state in ('pending','review-only','expired') and applied_at is null and reversed_at is null)
      or (state='applied' and applied_at is not null and reversed_at is null)
      or (state='reversed' and applied_at is not null and reversed_at is not null))
  )
);

create index contact_merge_plans_workspace_state_expiry_idx
  on public.contact_merge_plans(workspace_id,state,expires_at,id);

create table public.contact_merge_plan_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_id uuid not null,
  contact_id uuid not null,
  role public.contact_merge_member_role not null,
  dependency_fingerprint text not null check (dependency_fingerprint ~ '^[a-f0-9]{64}$'),
  original_archived_at timestamptz,
  original_archived_by_membership_id uuid,
  original_archive_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint contact_merge_plan_members_plan_workspace_fk foreign key(plan_id,workspace_id)
    references public.contact_merge_plans(id,workspace_id) on delete restrict,
  constraint contact_merge_plan_members_contact_workspace_fk foreign key(contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint contact_merge_plan_members_archiver_workspace_fk
    foreign key(original_archived_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint contact_merge_plan_members_plan_contact_unique unique(plan_id,contact_id),
  constraint contact_merge_plan_members_archive_projection check (
    (original_archived_at is null and original_archived_by_membership_id is null and original_archive_reason is null)
    or (original_archived_at is not null and original_archived_by_membership_id is not null
      and original_archive_reason is not null)
  )
);

create index contact_merge_plan_members_contact_role_idx
  on public.contact_merge_plan_members(contact_id,role,plan_id);
create unique index contact_merge_plan_members_one_survivor_idx
  on public.contact_merge_plan_members(plan_id) where role='survivor';

create table public.contact_merge_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_id uuid not null,
  donor_contact_id uuid not null,
  survivor_contact_id uuid not null,
  alias_epoch bigint not null check (alias_epoch > 0),
  active_from timestamptz not null,
  inactive_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint contact_merge_aliases_plan_workspace_fk foreign key(plan_id,workspace_id)
    references public.contact_merge_plans(id,workspace_id) on delete restrict,
  constraint contact_merge_aliases_donor_workspace_fk foreign key(donor_contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint contact_merge_aliases_survivor_workspace_fk foreign key(survivor_contact_id,workspace_id)
    references public.contacts(id,workspace_id) on delete restrict,
  constraint contact_merge_aliases_distinct_contacts check (donor_contact_id<>survivor_contact_id),
  constraint contact_merge_aliases_time_order check (inactive_at is null or inactive_at>=active_from),
  constraint contact_merge_aliases_plan_donor_unique unique(plan_id,donor_contact_id)
);

create unique index contact_merge_aliases_active_donor_idx
  on public.contact_merge_aliases(workspace_id,donor_contact_id) where inactive_at is null;
create index contact_merge_aliases_active_survivor_idx
  on public.contact_merge_aliases(workspace_id,survivor_contact_id,donor_contact_id)
  where inactive_at is null;

create table public.contact_merge_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_id uuid not null,
  actor_membership_id uuid not null,
  kind public.contact_merge_event_kind not null,
  correlation_id uuid not null,
  reason_code text not null check (reason_code ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  receipt jsonb not null default '{}'::jsonb check (jsonb_typeof(receipt)='object'),
  occurred_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint contact_merge_events_plan_workspace_fk foreign key(plan_id,workspace_id)
    references public.contact_merge_plans(id,workspace_id) on delete restrict,
  constraint contact_merge_events_actor_workspace_fk foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict
);

create index contact_merge_events_workspace_plan_occurred_idx
  on public.contact_merge_events(workspace_id,plan_id,occurred_at,id);

-- Direct mutation is never a product API. SECURITY DEFINER RPCs set the local
-- transaction marker only after revalidating owner authority.
create function public.guard_contact_merge_internal_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if coalesce(current_setting('omnix.contact_merge_internal_write',true),'')<>'on' then
    raise exception 'contact merge tables are RPC-only' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create trigger contact_merge_plans_internal_write before insert or update or delete
  on public.contact_merge_plans for each row execute function public.guard_contact_merge_internal_write();
create trigger contact_merge_members_internal_write before insert or update or delete
  on public.contact_merge_plan_members for each row execute function public.guard_contact_merge_internal_write();
create trigger contact_merge_aliases_internal_write before insert or update or delete
  on public.contact_merge_aliases for each row execute function public.guard_contact_merge_internal_write();
create trigger contact_merge_events_internal_write before insert or update or delete
  on public.contact_merge_events for each row execute function public.guard_contact_merge_internal_write();

create function public.guard_contact_merge_alias_star()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.inactive_at is not null then return new; end if;
  if exists(select 1 from public.contact_merge_aliases a
    where a.workspace_id=new.workspace_id and a.inactive_at is null and a.id<>new.id
      and (a.donor_contact_id=new.survivor_contact_id
        or a.survivor_contact_id=new.donor_contact_id)) then
    raise exception 'active contact aliases must remain a one-level star'
      using errcode='23514';
  end if;
  return new;
end;
$$;

create constraint trigger contact_merge_aliases_star_guard
  after insert or update of donor_contact_id,survivor_contact_id,inactive_at
  on public.contact_merge_aliases deferrable initially immediate
  for each row execute function public.guard_contact_merge_alias_star();

create function public.contact_merge_group_hash(target_kind text,target_value text)
returns text language sql immutable strict set search_path='' as $$
  select encode(extensions.digest(convert_to(target_kind||':'||target_value,'UTF8'),'sha256'),'hex');
$$;

-- Canonical digest of one contact plus every present FK consumer discovered
-- from the catalog. Values are hashed inside the database and never returned;
-- counts are aggregate-only. Newly added FK consumers automatically make old
-- plans stale instead of being silently omitted.
create function public.contact_merge_contact_snapshot(target_workspace_id uuid,target_contact_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  contact_row jsonb;
  point_row record;
  fk record;
  row_count bigint;
  row_digest text;
  fragments jsonb := '[]'::jsonb;
  counts jsonb := '[]'::jsonb;
  provider_count bigint := 0;
  provider_tables constant text[] := array[
    'mailer_sends','mailchimp_member_links','mailchimp_sync_evidence',
    'mailchimp_outbound_backfill_items','google_email_drafts','google_gmail_resources',
    'meta_external_identities','meta_conversations','texting_consent_events',
    'texting_consent_states','texting_conversations','texting_message_drafts',
    'texting_messages','texting_send_approval_snapshots','twilio_real_number_uat_jobs'
  ];
begin
  select to_jsonb(c) into contact_row from public.contacts c
   where c.id=target_contact_id and c.workspace_id=target_workspace_id;
  if contact_row is null then raise exception 'contact not found' using errcode='P0002'; end if;
  fragments := fragments || jsonb_build_array(jsonb_build_object(
    'path','public.contacts','digest',encode(extensions.digest(convert_to(contact_row::text,'UTF8'),'sha256'),'hex')));

  for fk in
    select con.oid,con.conname,con.conrelid::regclass child_rel,n.nspname,cl.relname,
      string_agg(format('(%I)::text=%L',ca.attname,contact_row->>pa.attname),' and ' order by u.ord) predicate
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class cl on cl.oid=con.conrelid
    join pg_catalog.pg_namespace n on n.oid=cl.relnamespace
    join unnest(con.conkey,con.confkey) with ordinality u(child_attnum,parent_attnum,ord) on true
    join pg_catalog.pg_attribute ca on ca.attrelid=con.conrelid and ca.attnum=u.child_attnum
    join pg_catalog.pg_attribute pa on pa.attrelid=con.confrelid and pa.attnum=u.parent_attnum
    where con.contype='f' and con.confrelid='public.contacts'::regclass
      and cl.relname not like 'contact_merge_%'
    group by con.oid,con.conname,con.conrelid,n.nspname,cl.relname
    order by n.nspname,cl.relname,con.conname
  loop
    execute format('select count(*)::bigint,encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text),''[]''::jsonb)::text,''UTF8''),''sha256''),''hex'') from %s d where %s',fk.child_rel,fk.predicate)
      into row_count,row_digest;
    counts := counts || jsonb_build_array(jsonb_build_object('path',fk.nspname||'.'||fk.relname||':'||fk.conname,'count',row_count));
    fragments := fragments || jsonb_build_array(jsonb_build_object('path',fk.nspname||'.'||fk.relname||':'||fk.conname,'digest',row_digest));
    if fk.relname=any(provider_tables) then provider_count:=provider_count+row_count; end if;
  end loop;

  for point_row in select to_jsonb(p) body from public.contact_points p
    where p.workspace_id=target_workspace_id and p.contact_id=target_contact_id order by p.id
  loop
    for fk in
      select con.oid,con.conname,con.conrelid::regclass child_rel,n.nspname,cl.relname,
        string_agg(format('(%I)::text=%L',ca.attname,point_row.body->>pa.attname),' and ' order by u.ord) predicate
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class cl on cl.oid=con.conrelid
      join pg_catalog.pg_namespace n on n.oid=cl.relnamespace
      join unnest(con.conkey,con.confkey) with ordinality u(child_attnum,parent_attnum,ord) on true
      join pg_catalog.pg_attribute ca on ca.attrelid=con.conrelid and ca.attnum=u.child_attnum
      join pg_catalog.pg_attribute pa on pa.attrelid=con.confrelid and pa.attnum=u.parent_attnum
      where con.contype='f' and con.confrelid='public.contact_points'::regclass
      group by con.oid,con.conname,con.conrelid,n.nspname,cl.relname
      order by n.nspname,cl.relname,con.conname
    loop
      execute format('select count(*)::bigint,encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text),''[]''::jsonb)::text,''UTF8''),''sha256''),''hex'') from %s d where %s',fk.child_rel,fk.predicate)
        into row_count,row_digest;
      counts := counts || jsonb_build_array(jsonb_build_object('path',fk.nspname||'.'||fk.relname||':'||fk.conname,'count',row_count));
      fragments := fragments || jsonb_build_array(jsonb_build_object('path',fk.nspname||'.'||fk.relname||':'||fk.conname,'digest',row_digest));
      if fk.relname=any(provider_tables) then provider_count:=provider_count+row_count; end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'digest',encode(extensions.digest(convert_to(fragments::text,'UTF8'),'sha256'),'hex'),
    'counts',counts,'providerBoundCount',provider_count
  );
end;
$$;

create function public.contact_merge_plan_snapshot(
  target_workspace_id uuid,target_contact_ids uuid[],target_survivor_contact_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshots jsonb; epoch bigint;
begin
  select coalesce(s.alias_epoch,0) into epoch from public.contact_merge_workspace_state s
   where s.workspace_id=target_workspace_id;
  epoch:=coalesce(epoch,0);
  select jsonb_agg(jsonb_build_object('contactId',x.id,'snapshot',public.contact_merge_contact_snapshot(target_workspace_id,x.id)) order by x.id)
    into snapshots from unnest(target_contact_ids) x(id);
  return jsonb_build_object(
    'snapshotHash',encode(extensions.digest(convert_to(jsonb_build_object(
      'members',snapshots,'survivor',target_survivor_contact_id,'aliasEpoch',epoch
    )::text,'UTF8'),'sha256'),'hex'),
    'dependencyCounts',(select coalesce(jsonb_agg(e order by e->>'path'),'[]'::jsonb)
      from jsonb_array_elements(coalesce(snapshots,'[]'::jsonb)) m,
           jsonb_array_elements(m->'snapshot'->'counts') e),
    'aliasEpoch',epoch,
    'providerBoundCount',(select coalesce(sum((m->'snapshot'->>'providerBoundCount')::bigint),0)
      from jsonb_array_elements(coalesce(snapshots,'[]'::jsonb)) m)
  );
end;
$$;

create function public.resolve_canonical_contact_id(target_workspace_id uuid,target_contact_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
  if auth.uid() is null or not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode='42501';
  end if;
  select c.id into result from public.contacts c
   where c.id=target_contact_id and c.workspace_id=target_workspace_id;
  if result is null then raise exception 'contact not found' using errcode='P0002'; end if;
  select a.survivor_contact_id into result from public.contact_merge_aliases a
   where a.workspace_id=target_workspace_id and a.donor_contact_id=target_contact_id
     and a.inactive_at is null;
  return coalesce(result,target_contact_id);
end;
$$;

create function public.list_contact_alias_group_ids(target_workspace_id uuid,target_contact_id uuid)
returns table(contact_id uuid,is_canonical boolean,alias_epoch bigint)
language plpgsql stable security definer set search_path='' as $$
declare canonical_id uuid; current_epoch bigint;
begin
  canonical_id:=public.resolve_canonical_contact_id(target_workspace_id,target_contact_id);
  select coalesce(s.alias_epoch,0) into current_epoch from public.contact_merge_workspace_state s
   where s.workspace_id=target_workspace_id;
  return query
    select canonical_id,true,coalesce(current_epoch,0)
    union all
    select a.donor_contact_id,false,coalesce(current_epoch,0)
      from public.contact_merge_aliases a
      where a.workspace_id=target_workspace_id and a.survivor_contact_id=canonical_id
        and a.inactive_at is null
      order by 2 desc,1;
end;
$$;

create function public.assert_contact_outbound_target(
  target_workspace_id uuid,target_contact_id uuid,target_contact_point_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_contact public.contacts%rowtype; current_epoch bigint;
begin
  if auth.uid() is null or not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode='42501';
  end if;
  select * into target_contact from public.contacts c
   where c.id=target_contact_id and c.workspace_id=target_workspace_id;
  if not found or target_contact.archived_at is not null then
    raise exception 'outbound contact target is unavailable' using errcode='42501';
  end if;
  if exists(select 1 from public.contact_merge_aliases a where a.workspace_id=target_workspace_id
    and a.donor_contact_id=target_contact_id and a.inactive_at is null) then
    raise exception 'outbound target is an aliased donor' using errcode='55000';
  end if;
  if target_contact_point_id is not null then
    perform 1 from public.contact_points p where p.id=target_contact_point_id
      and p.workspace_id=target_workspace_id and p.contact_id=target_contact_id and p.archived_at is null;
    if not found then raise exception 'outbound contact point target is unavailable' using errcode='55000'; end if;
  end if;
  select coalesce(s.alias_epoch,0) into current_epoch from public.contact_merge_workspace_state s
   where s.workspace_id=target_workspace_id;
  return jsonb_build_object('contactId',target_contact_id,'contactPointId',target_contact_point_id,
    'aliasEpoch',coalesce(current_epoch,0));
end;
$$;

create function public.plan_exact_contact_merge(
  target_workspace_id uuid,target_actor_membership_id uuid,target_evidence_kind text,
  target_group_hash text,target_request_hash text,target_idempotency_key text,
  target_reason_codes text[],target_expires_at timestamptz,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members%rowtype; existing public.contact_merge_plans%rowtype;
  candidate_ids uuid[]; survivor_id uuid; snapshot jsonb; plan_id uuid; plan_state public.contact_merge_plan_state;
  reasons text[]:=coalesce(target_reason_codes,'{}'); active_count integer; conflicting boolean:=false;
begin
  if auth.uid() is null then raise exception 'authentication is required' using errcode='42501'; end if;
  actor:=public.assert_rich_contact_actor(target_actor_membership_id,target_workspace_id,true);
  if target_evidence_kind not in ('external-id','email','phone') or target_group_hash !~ '^[a-f0-9]{64}$'
    or target_request_hash !~ '^[a-f0-9]{64}$' or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    or target_expires_at<=target_occurred_at or target_expires_at>target_occurred_at+interval '24 hours' then
    raise exception 'contact merge plan command is invalid' using errcode='23514';
  end if;
  select * into existing from public.contact_merge_plans p where p.workspace_id=target_workspace_id
    and (p.idempotency_key=target_idempotency_key or p.request_hash=target_request_hash) for update;
  if found then
    if existing.request_hash<>target_request_hash or existing.idempotency_key<>target_idempotency_key then
      raise exception 'contact merge plan replay conflicts with original request' using errcode='23505';
    end if;
    return jsonb_build_object('planId',existing.id,'state',existing.state,'survivorContactId',existing.survivor_contact_id,
      'snapshotHash',existing.snapshot_hash,'memberCount',(select count(*) from public.contact_merge_plan_members m where m.plan_id=existing.id),
      'reasonCodes',existing.reason_codes,'noOp',true);
  end if;

  select array_agg(distinct x.contact_id order by x.contact_id) into candidate_ids from (
    select l.contact_id from public.contact_external_links l where target_evidence_kind='external-id'
      and l.workspace_id=target_workspace_id
      and public.contact_merge_group_hash('external-id',l.provider||':'||l.external_id)=target_group_hash
    union all
    select p.contact_id from public.contact_points p where target_evidence_kind='email'
      and p.workspace_id=target_workspace_id and p.type='email' and p.archived_at is null
      and public.contact_merge_group_hash('email',p.normalized_value)=target_group_hash
    union all
    select p.contact_id from public.contact_points p where target_evidence_kind='phone'
      and p.workspace_id=target_workspace_id and p.type='phone' and p.archived_at is null
      and public.contact_merge_group_hash('phone',p.normalized_value)=target_group_hash
  ) x;
  if coalesce(cardinality(candidate_ids),0)<2 or cardinality(candidate_ids)>50 then
    raise exception 'exact contact merge group must contain between 2 and 50 contacts' using errcode='23514';
  end if;
  select count(*) into active_count from public.contacts c where c.id=any(candidate_ids) and c.archived_at is null;
  select c.id into survivor_id from public.contacts c where c.id=any(candidate_ids)
    order by exists(select 1 from public.contact_external_links l where l.workspace_id=target_workspace_id and l.contact_id=c.id) desc,
      c.created_at,c.id limit 1;

  conflicting:=exists(
    select 1 from public.contact_external_links a join public.contact_external_links b
      on b.workspace_id=a.workspace_id and b.provider=a.provider and b.external_id=a.external_id
      and not(b.contact_id=any(candidate_ids)) where a.contact_id=any(candidate_ids)
    union all
    select 1 from public.contact_points a join public.contact_points b
      on b.workspace_id=a.workspace_id and b.type=a.type and b.normalized_value=a.normalized_value
      and b.archived_at is null and not(b.contact_id=any(candidate_ids))
      where a.contact_id=any(candidate_ids) and a.archived_at is null
  );
  snapshot:=public.contact_merge_plan_snapshot(target_workspace_id,candidate_ids,survivor_id);
  if active_count<2 then reasons:=array_append(reasons,'fewer-than-two-active'); end if;
  if conflicting then reasons:=array_append(reasons,'conflicting-exact-identity'); end if;
  if exists(select 1 from public.contact_merge_aliases a where a.workspace_id=target_workspace_id and a.inactive_at is null
    and (a.donor_contact_id=any(candidate_ids) or a.survivor_contact_id=any(candidate_ids))) then
    reasons:=array_append(reasons,'existing-alias');
  end if;
  if (snapshot->>'providerBoundCount')::bigint>0 then reasons:=array_append(reasons,'provider-bound'); end if;
  select coalesce(array_agg(distinct r order by r),'{}') into reasons from unnest(reasons) r;
  plan_state:=case when cardinality(reasons)>0 then 'review-only'::public.contact_merge_plan_state else 'pending'::public.contact_merge_plan_state end;

  perform set_config('omnix.contact_merge_internal_write','on',true);
  insert into public.contact_merge_workspace_state(workspace_id,created_at,updated_at)
    values(target_workspace_id,target_occurred_at,target_occurred_at) on conflict(workspace_id) do nothing;
  insert into public.contact_merge_plans(workspace_id,actor_membership_id,survivor_contact_id,evidence_kind,
    group_hash,dependency_counts,snapshot_hash,alias_epoch,state,request_hash,idempotency_key,reason_codes,
    expires_at,created_at,updated_at)
  values(target_workspace_id,actor.id,survivor_id,target_evidence_kind::public.contact_merge_evidence_kind,
    target_group_hash,snapshot->'dependencyCounts',snapshot->>'snapshotHash',(snapshot->>'aliasEpoch')::bigint,
    plan_state,target_request_hash,target_idempotency_key,reasons,target_expires_at,target_occurred_at,target_occurred_at)
  returning id into plan_id;
  insert into public.contact_merge_plan_members(workspace_id,plan_id,contact_id,role,dependency_fingerprint,
    original_archived_at,original_archived_by_membership_id,original_archive_reason,created_at,updated_at)
  select target_workspace_id,plan_id,c.id,case when c.id=survivor_id then 'survivor' else 'donor' end::public.contact_merge_member_role,
    public.contact_merge_contact_snapshot(target_workspace_id,c.id)->>'digest',c.archived_at,c.archived_by_membership_id,c.archive_reason,
    target_occurred_at,target_occurred_at from public.contacts c where c.id=any(candidate_ids);
  insert into public.contact_merge_events(workspace_id,plan_id,actor_membership_id,kind,correlation_id,reason_code,receipt,
    occurred_at,created_at,updated_at)
  values(target_workspace_id,plan_id,actor.id,(case when plan_state='pending' then 'planned' else 'review-required' end)::public.contact_merge_event_kind,
    gen_random_uuid(),case when plan_state='pending' then 'exact-identity' else reasons[1] end,
    jsonb_build_object('memberCount',cardinality(candidate_ids),'groupHash',target_group_hash,'snapshotHash',snapshot->>'snapshotHash'),
    target_occurred_at,target_occurred_at,target_occurred_at);
  return jsonb_build_object('planId',plan_id,'state',plan_state,'survivorContactId',survivor_id,
    'snapshotHash',snapshot->>'snapshotHash','memberCount',cardinality(candidate_ids),'reasonCodes',reasons,'noOp',false);
end;
$$;

create function public.apply_exact_contact_merge(
  target_plan_id uuid,target_actor_membership_id uuid,target_snapshot_hash text,
  target_idempotency_key text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare plan_row public.contact_merge_plans%rowtype; member_ids uuid[]; current_snapshot jsonb; gate public.contact_merge_workspace_state%rowtype; next_epoch bigint; donor record;
begin
  if auth.uid() is null then raise exception 'authentication is required' using errcode='42501'; end if;
  select * into plan_row from public.contact_merge_plans p where p.id=target_plan_id for update;
  if not found then raise exception 'contact merge plan not found' using errcode='P0002'; end if;
  perform public.assert_rich_contact_actor(target_actor_membership_id,plan_row.workspace_id,true);
  if plan_row.state='applied' and plan_row.apply_idempotency_key=target_idempotency_key then
    return jsonb_build_object('planId',plan_row.id,'state','applied','noOp',true);
  end if;
  if plan_row.state<>'pending' or plan_row.expires_at<=target_occurred_at then
    raise exception 'contact merge plan is not applicable' using errcode='55000';
  end if;
  select array_agg(m.contact_id order by m.contact_id) into member_ids from public.contact_merge_plan_members m where m.plan_id=plan_row.id;
  perform 1 from public.contacts c where c.id=any(member_ids) order by c.id for update;
  current_snapshot:=public.contact_merge_plan_snapshot(plan_row.workspace_id,member_ids,plan_row.survivor_contact_id);
  if target_snapshot_hash<>plan_row.snapshot_hash or current_snapshot->>'snapshotHash'<>plan_row.snapshot_hash then
    raise exception 'stale contact merge plan' using errcode='40001';
  end if;
  select * into gate from public.contact_merge_workspace_state s where s.workspace_id=plan_row.workspace_id for update;
  if not found or not gate.apply_enabled or gate.activation_version<2 then
    raise exception 'contact merge apply is activation-gated until migration 0028' using errcode='0A000';
  end if;

  perform set_config('omnix.contact_merge_internal_write','on',true);
  update public.contact_merge_workspace_state set alias_epoch=alias_epoch+1,updated_at=target_occurred_at
    where workspace_id=plan_row.workspace_id returning alias_epoch into next_epoch;
  for donor in select m.* from public.contact_merge_plan_members m where m.plan_id=plan_row.id and m.role='donor' order by m.contact_id loop
    update public.contacts set archived_at=target_occurred_at,archived_by_membership_id=target_actor_membership_id,
      archive_reason='merged:'||plan_row.id::text where id=donor.contact_id;
    insert into public.contact_merge_aliases(workspace_id,plan_id,donor_contact_id,survivor_contact_id,alias_epoch,
      active_from,created_at,updated_at) values(plan_row.workspace_id,plan_row.id,donor.contact_id,
      plan_row.survivor_contact_id,next_epoch,target_occurred_at,target_occurred_at,target_occurred_at);
  end loop;
  update public.contact_merge_plans set state='applied',applied_at=target_occurred_at,
    apply_idempotency_key=target_idempotency_key,updated_at=target_occurred_at where id=plan_row.id;
  insert into public.contact_merge_events(workspace_id,plan_id,actor_membership_id,kind,correlation_id,reason_code,receipt,
    occurred_at,created_at,updated_at) values(plan_row.workspace_id,plan_row.id,target_actor_membership_id,'applied',
    gen_random_uuid(),'owner-approved',jsonb_build_object('memberCount',cardinality(member_ids),'aliasEpoch',next_epoch),
    target_occurred_at,target_occurred_at,target_occurred_at);
  return jsonb_build_object('planId',plan_row.id,'state','applied','aliasEpoch',next_epoch,'noOp',false);
end;
$$;

create function public.reverse_exact_contact_merge(
  target_plan_id uuid,target_actor_membership_id uuid,target_idempotency_key text,
  target_reason_code text,target_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare plan_row public.contact_merge_plans%rowtype; gate public.contact_merge_workspace_state%rowtype; next_epoch bigint; donor record;
begin
  if auth.uid() is null then raise exception 'authentication is required' using errcode='42501'; end if;
  select * into plan_row from public.contact_merge_plans p where p.id=target_plan_id for update;
  if not found then raise exception 'contact merge plan not found' using errcode='P0002'; end if;
  perform public.assert_rich_contact_actor(target_actor_membership_id,plan_row.workspace_id,true);
  if plan_row.state='reversed' and plan_row.reverse_idempotency_key=target_idempotency_key then
    return jsonb_build_object('planId',plan_row.id,'state','reversed','noOp',true);
  end if;
  if plan_row.state<>'applied' then raise exception 'contact merge plan is not reversible' using errcode='55000'; end if;
  select * into gate from public.contact_merge_workspace_state s where s.workspace_id=plan_row.workspace_id for update;
  if not found or not gate.apply_enabled or gate.activation_version<2 then
    raise exception 'contact merge reverse is activation-gated until migration 0028' using errcode='0A000';
  end if;
  perform 1 from public.contacts c join public.contact_merge_plan_members m on m.contact_id=c.id
    where m.plan_id=plan_row.id order by c.id for update of c;
  if exists(select 1 from public.contact_merge_plan_members m join public.contacts c on c.id=m.contact_id
    where m.plan_id=plan_row.id and m.role='donor'
      and (c.archive_reason is distinct from 'merged:'||plan_row.id::text or c.archived_at is null)) then
    raise exception 'contact merge donor archive projection diverged' using errcode='40001';
  end if;
  perform set_config('omnix.contact_merge_internal_write','on',true);
  update public.contact_merge_aliases set inactive_at=target_occurred_at,updated_at=target_occurred_at
    where plan_id=plan_row.id and inactive_at is null;
  for donor in select m.* from public.contact_merge_plan_members m where m.plan_id=plan_row.id and m.role='donor' order by m.contact_id loop
    update public.contacts set archived_at=donor.original_archived_at,
      archived_by_membership_id=donor.original_archived_by_membership_id,
      archive_reason=donor.original_archive_reason where id=donor.contact_id;
  end loop;
  update public.contact_merge_workspace_state set alias_epoch=alias_epoch+1,updated_at=target_occurred_at
    where workspace_id=plan_row.workspace_id returning alias_epoch into next_epoch;
  update public.contact_merge_plans set state='reversed',reversed_at=target_occurred_at,
    reverse_idempotency_key=target_idempotency_key,updated_at=target_occurred_at where id=plan_row.id;
  insert into public.contact_merge_events(workspace_id,plan_id,actor_membership_id,kind,correlation_id,reason_code,receipt,
    occurred_at,created_at,updated_at) values(plan_row.workspace_id,plan_row.id,target_actor_membership_id,'reversed',
    gen_random_uuid(),target_reason_code,jsonb_build_object('aliasEpoch',next_epoch),
    target_occurred_at,target_occurred_at,target_occurred_at);
  return jsonb_build_object('planId',plan_row.id,'state','reversed','aliasEpoch',next_epoch,'noOp',false);
end;
$$;

-- An active donor cannot be manually restored or have its archive evidence
-- rewritten. The internal marker is used only inside apply/reverse.
create function public.reject_active_merge_donor_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(current_setting('omnix.contact_merge_internal_write',true),'')<>'on'
    and (new.archived_at,new.archived_by_membership_id,new.archive_reason)
      is distinct from (old.archived_at,old.archived_by_membership_id,old.archive_reason)
    and exists(select 1 from public.contact_merge_aliases a where a.workspace_id=old.workspace_id
      and a.donor_contact_id=old.id and a.inactive_at is null) then
    raise exception 'active merge donor archive projection is immutable' using errcode='55000';
  end if;
  return new;
end;
$$;
create trigger contacts_reject_active_merge_donor_mutation before update
  on public.contacts for each row execute function public.reject_active_merge_donor_mutation();

alter table public.contact_merge_workspace_state enable row level security;
alter table public.contact_merge_workspace_state force row level security;
alter table public.contact_merge_plans enable row level security;
alter table public.contact_merge_plans force row level security;
alter table public.contact_merge_plan_members enable row level security;
alter table public.contact_merge_plan_members force row level security;
alter table public.contact_merge_aliases enable row level security;
alter table public.contact_merge_aliases force row level security;
alter table public.contact_merge_events enable row level security;
alter table public.contact_merge_events force row level security;

create policy contact_merge_aliases_member_read on public.contact_merge_aliases for select to authenticated
  using(public.has_workspace_access(workspace_id));
create policy contact_merge_events_owner_read on public.contact_merge_events for select to authenticated
  using(public.is_workspace_owner(workspace_id));

revoke all on table public.contact_merge_workspace_state,public.contact_merge_plans,
  public.contact_merge_plan_members,public.contact_merge_aliases,public.contact_merge_events from public,anon,authenticated;
grant select on public.contact_merge_aliases to authenticated;
grant select on public.contact_merge_events to authenticated;

revoke all on function public.guard_contact_merge_internal_write() from public,anon,authenticated,service_role;
revoke all on function public.guard_contact_merge_alias_star() from public,anon,authenticated,service_role;
revoke all on function public.contact_merge_group_hash(text,text) from public,anon,authenticated,service_role;
revoke all on function public.contact_merge_contact_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.contact_merge_plan_snapshot(uuid,uuid[],uuid) from public,anon,authenticated,service_role;
revoke all on function public.reject_active_merge_donor_mutation() from public,anon,authenticated,service_role;

revoke all on function public.resolve_canonical_contact_id(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_contact_alias_group_ids(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.assert_contact_outbound_target(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.plan_exact_contact_merge(uuid,uuid,text,text,text,text,text[],timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.apply_exact_contact_merge(uuid,uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.reverse_exact_contact_merge(uuid,uuid,text,text,timestamptz) from public,anon,authenticated,service_role;

grant execute on function public.resolve_canonical_contact_id(uuid,uuid) to authenticated;
grant execute on function public.list_contact_alias_group_ids(uuid,uuid) to authenticated;
grant execute on function public.assert_contact_outbound_target(uuid,uuid,uuid) to authenticated;
grant execute on function public.plan_exact_contact_merge(uuid,uuid,text,text,text,text,text[],timestamptz,timestamptz) to authenticated;
grant execute on function public.apply_exact_contact_merge(uuid,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.reverse_exact_contact_merge(uuid,uuid,text,text,timestamptz) to authenticated;

comment on table public.contact_merge_workspace_state is 'Story 3.15 alias epoch and forward-only activation gate; 0027 cannot enable apply.';
comment on table public.contact_merge_plans is 'Redacted, group-scoped exact-identity merge plans with canonical stale-plan digest.';
comment on table public.contact_merge_plan_members is 'Physical contact members and exact archive projections retained for whole-plan reversal.';
comment on table public.contact_merge_aliases is 'One-level logical alias star; dependent rows retain their physical contact IDs.';
comment on table public.contact_merge_events is 'Append-only PII-free merge lifecycle evidence.';
comment on function public.resolve_canonical_contact_id(uuid,uuid) is 'Returns an active logical survivor or the original in-workspace contact ID.';
comment on function public.list_contact_alias_group_ids(uuid,uuid) is 'Returns the canonical contact plus physical alias-group members and current epoch.';
comment on function public.assert_contact_outbound_target(uuid,uuid,uuid) is 'Fails closed for aliased donors, donor-owned points and archived outbound targets.';
comment on function public.apply_exact_contact_merge(uuid,uuid,text,text,timestamptz) is 'Full transactional contract, structurally disabled until forward activation migration 0028.';

commit;
