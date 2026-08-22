-- Omnix — canonical shared-workspace authority
-- Story 3.0: create the workspace boundary before any later CRM domain adds
-- persisted rows. Legacy owner_id columns remain during the compatibility
-- window, but every authorization decision after this migration uses
-- workspace_id plus an active workspace_members row.
--
-- Forward-only migration. Take a schema snapshot before applying. The manual
-- rollback is documented in ../rollbacks/0004_shared_workspace_authority.rollback.sql.

begin;

-- Workspace authority -------------------------------------------------------

create type workspace_role as enum ('owner', 'assistant');
create type workspace_membership_status as enum ('active', 'revoked');

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workspaces_name_length check (length(trim(name)) between 1 and 80)
);

create table workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete restrict,
  role         workspace_role not null,
  status       workspace_membership_status not null default 'active',
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint workspace_members_user_unique unique (workspace_id, user_id),
  constraint workspace_members_id_workspace_unique unique (id, workspace_id),
  constraint workspace_members_revocation_state check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create unique index workspace_members_one_active_owner_idx
  on workspace_members (workspace_id)
  where role = 'owner' and status = 'active';

create index workspace_members_active_user_idx
  on workspace_members (user_id, workspace_id)
  where status = 'active';

-- Audit rows are append-only evidence of authority changes. actor_user_id is
-- retained when a membership is revoked; authority records never depend on an
-- email address or other mutable profile data.
create table workspace_authority_audit_events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete restrict,
  membership_id   uuid,
  actor_user_id   uuid references auth.users (id) on delete set null,
  action          text not null,
  result          text not null default 'succeeded',
  reason          text,
  correlation_id  uuid not null default gen_random_uuid(),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),

  constraint workspace_authority_audit_events_membership_workspace_fk
    foreign key (membership_id, workspace_id)
    references workspace_members (id, workspace_id)
    on delete restrict,
  constraint workspace_authority_audit_events_action check (action in (
    'workspace_bootstrapped',
    'workspace_renamed',
    'member_added',
    'member_revoked',
    'member_reactivated'
  )),
  constraint workspace_authority_audit_events_result check (result in (
    'succeeded', 'denied', 'failed'
  )),
  constraint workspace_authority_audit_events_reason_length check (
    reason is null or length(reason) <= 500
  ),
  constraint workspace_authority_audit_events_metadata_object check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index workspace_authority_audit_events_workspace_created_idx
  on workspace_authority_audit_events (workspace_id, created_at desc);

-- Invariants and audit triggers ---------------------------------------------

create or replace function assert_workspace_owner_invariant(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_owner_count integer;
begin
  -- A deleted workspace has no remaining invariant to enforce. Product roles
  -- receive no workspace DELETE policy; this branch is for FK cascades only.
  if not exists (
    select 1 from public.workspaces where id = target_workspace_id
  ) then
    return;
  end if;

  select count(*)::integer
    into active_owner_count
    from public.workspace_members
   where workspace_id = target_workspace_id
     and role = 'owner'
     and status = 'active';

  if active_owner_count <> 1 then
    raise exception 'workspace % must have exactly one active owner', target_workspace_id
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function assert_workspace_owner_invariant(uuid) from public;

create or replace function enforce_workspace_owner_from_workspace()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_workspace_owner_invariant(new.id);
  return new;
end;
$$;

create or replace function enforce_workspace_owner_from_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_workspace_owner_invariant(coalesce(new.workspace_id, old.workspace_id));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function enforce_workspace_owner_from_workspace() from public;
revoke all on function enforce_workspace_owner_from_member() from public;

create constraint trigger workspaces_exactly_one_owner
  after insert on workspaces
  deferrable initially deferred
  for each row execute function enforce_workspace_owner_from_workspace();

create constraint trigger workspace_members_exactly_one_owner
  after insert or update or delete on workspace_members
  deferrable initially deferred
  for each row execute function enforce_workspace_owner_from_member();

create or replace function guard_workspace_identity()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id then
    raise exception 'workspace id is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workspaces_guard_identity
  before update on workspaces
  for each row execute function guard_workspace_identity();

create or replace function prepare_workspace_member_update()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.user_id <> old.user_id then
    raise exception 'workspace membership identity is immutable' using errcode = '23514';
  end if;

  if old.role = 'owner'
     and (new.role <> old.role or new.status <> old.status) then
    raise exception 'the active owner membership cannot be changed' using errcode = '23514';
  end if;

  if old.role = 'assistant' and new.role <> old.role then
    raise exception 'ownership transfer is not supported' using errcode = '23514';
  end if;

  if new.status = 'revoked' and old.status <> 'revoked' then
    new.revoked_at = now();
  elsif new.status = 'active' then
    new.revoked_at = null;
  end if;

  return new;
end;
$$;

create trigger workspace_members_prepare_update
  before update on workspace_members
  for each row execute function prepare_workspace_member_update();

create trigger workspaces_touch_updated_at
  before update on workspaces
  for each row execute function touch_updated_at();

create trigger workspace_members_touch_updated_at
  before update on workspace_members
  for each row execute function touch_updated_at();

create or replace function workspace_audit_actor(fallback_user_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid;
  configured_actor text;
begin
  actor_id := auth.uid();
  if actor_id is not null then
    return actor_id;
  end if;

  configured_actor := current_setting('omnix.actor_user_id', true);
  if configured_actor is not null and configured_actor ~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return configured_actor::uuid;
  end if;

  if fallback_user_id is not null then
    return fallback_user_id;
  end if;

  raise exception 'workspace authority changes require an actor identity'
    using errcode = '23514';
end;
$$;

revoke all on function workspace_audit_actor(uuid) from public;

create or replace function workspace_audit_correlation()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  configured_correlation text;
begin
  configured_correlation := current_setting('omnix.correlation_id', true);
  if configured_correlation is not null and configured_correlation ~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return configured_correlation::uuid;
  end if;

  return gen_random_uuid();
end;
$$;

revoke all on function workspace_audit_correlation() from public;

create or replace function audit_workspace_member_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_action text;
  actor_id uuid;
begin
  if tg_op = 'INSERT' then
    event_action := case
      when new.role = 'owner' then 'workspace_bootstrapped'
      else 'member_added'
    end;
  elsif new.status = old.status then
    return new;
  elsif new.status = 'revoked' then
    event_action := 'member_revoked';
  else
    event_action := 'member_reactivated';
  end if;

  actor_id := public.workspace_audit_actor(
    case when tg_op = 'INSERT' and new.role = 'owner' then new.user_id else null end
  );

  insert into public.workspace_authority_audit_events (
    workspace_id,
    membership_id,
    actor_user_id,
    action,
    result,
    reason,
    correlation_id,
    metadata
  ) values (
    new.workspace_id,
    new.id,
    actor_id,
    event_action,
    'succeeded',
    nullif(left(current_setting('omnix.audit_reason', true), 500), ''),
    public.workspace_audit_correlation(),
    jsonb_build_object(
      'member_user_id', new.user_id,
      'role', new.role,
      'status', new.status
    )
  );

  return new;
end;
$$;

create or replace function audit_workspace_rename()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.name is not distinct from old.name then
    return new;
  end if;

  insert into public.workspace_authority_audit_events (
    workspace_id,
    actor_user_id,
    action,
    result,
    reason,
    correlation_id,
    metadata
  ) values (
    new.id,
    public.workspace_audit_actor(null),
    'workspace_renamed',
    'succeeded',
    nullif(left(current_setting('omnix.audit_reason', true), 500), ''),
    public.workspace_audit_correlation(),
    '{}'::jsonb
  );

  return new;
end;
$$;

revoke all on function audit_workspace_member_change() from public;
revoke all on function audit_workspace_rename() from public;

create trigger workspace_members_audit
  after insert or update on workspace_members
  for each row execute function audit_workspace_member_change();

create trigger workspaces_rename_audit
  after update on workspaces
  for each row execute function audit_workspace_rename();

-- Forward-only backfill -----------------------------------------------------

alter table contacts add column workspace_id uuid;
alter table notes add column workspace_id uuid;
alter table mailers add column workspace_id uuid;
alter table mailer_sends add column workspace_id uuid;
alter table contact_external_links add column workspace_id uuid;
alter table contact_intake_receipts add column workspace_id uuid;

-- Count-only and owner/workspace mapping tables are transaction-local and are
-- dropped automatically at COMMIT. They are not data backups.
create temporary table _omnix_workspace_backfill_counts (
  table_name text primary key,
  row_count bigint not null
) on commit drop;

insert into _omnix_workspace_backfill_counts (table_name, row_count) values
  ('contacts', (select count(*) from contacts)),
  ('notes', (select count(*) from notes)),
  ('mailers', (select count(*) from mailers)),
  ('mailer_sends', (select count(*) from mailer_sends)),
  ('contact_external_links', (select count(*) from contact_external_links)),
  ('contact_intake_receipts', (select count(*) from contact_intake_receipts));

create temporary table _omnix_workspace_backfill_map (
  owner_id uuid primary key,
  workspace_id uuid not null unique
) on commit drop;

insert into _omnix_workspace_backfill_map (owner_id, workspace_id)
select owner_id, gen_random_uuid()
from (
  select owner_id from contacts
  union
  select owner_id from notes
  union
  select owner_id from mailers
  union
  select owner_id from mailer_sends
  union
  select owner_id from contact_external_links
  union
  select owner_id from contact_intake_receipts
) tenant_owners
order by owner_id;

insert into workspaces (id, name)
select workspace_id, 'Omnix workspace'
from _omnix_workspace_backfill_map
order by owner_id;

insert into workspace_members (workspace_id, user_id, role, status)
select workspace_id, owner_id, 'owner', 'active'
from _omnix_workspace_backfill_map
order by owner_id;

update contacts target
set workspace_id = mapping.workspace_id
from _omnix_workspace_backfill_map mapping
where target.owner_id = mapping.owner_id;

update notes target
set workspace_id = mapping.workspace_id
from _omnix_workspace_backfill_map mapping
where target.owner_id = mapping.owner_id;

update mailers target
set workspace_id = mapping.workspace_id
from _omnix_workspace_backfill_map mapping
where target.owner_id = mapping.owner_id;

update mailer_sends target
set workspace_id = mapping.workspace_id
from _omnix_workspace_backfill_map mapping
where target.owner_id = mapping.owner_id;

update contact_external_links target
set workspace_id = mapping.workspace_id
from _omnix_workspace_backfill_map mapping
where target.owner_id = mapping.owner_id;

update contact_intake_receipts target
set workspace_id = mapping.workspace_id
from _omnix_workspace_backfill_map mapping
where target.owner_id = mapping.owner_id;

do $$
declare
  owner_record record;
  table_record record;
  actual_count bigint;
begin
  for owner_record in select workspace_id from _omnix_workspace_backfill_map loop
    perform public.assert_workspace_owner_invariant(owner_record.workspace_id);
  end loop;

  for table_record in select table_name, row_count from _omnix_workspace_backfill_counts loop
    execute format(
      'select count(*) from %I where workspace_id is not null',
      table_record.table_name
    ) into actual_count;

    if actual_count <> table_record.row_count then
      raise exception 'workspace backfill count mismatch for %: expected %, got %',
        table_record.table_name, table_record.row_count, actual_count;
    end if;
  end loop;

  if exists (
    select 1
    from contacts child
    join contacts parent on parent.id = child.referred_by_id
    where child.workspace_id <> parent.workspace_id
  ) then
    raise exception 'cross-workspace contact referral found during backfill';
  end if;

  if exists (
    select 1
    from notes child
    join contacts parent on parent.id = child.contact_id
    where child.workspace_id <> parent.workspace_id
  ) then
    raise exception 'cross-workspace note found during backfill';
  end if;

  if exists (
    select 1
    from mailer_sends child
    join mailers mailer on mailer.id = child.mailer_id
    join contacts contact on contact.id = child.contact_id
    where child.workspace_id <> mailer.workspace_id
       or child.workspace_id <> contact.workspace_id
  ) then
    raise exception 'cross-workspace mailer send found during backfill';
  end if;

  if exists (
    select 1
    from contact_external_links child
    join contacts parent on parent.id = child.contact_id
    where child.workspace_id <> parent.workspace_id
  ) then
    raise exception 'cross-workspace external contact link found during backfill';
  end if;
end;
$$;

alter table contacts alter column workspace_id set not null;
alter table notes alter column workspace_id set not null;
alter table mailers alter column workspace_id set not null;
alter table mailer_sends alter column workspace_id set not null;
alter table contact_external_links alter column workspace_id set not null;
alter table contact_intake_receipts alter column workspace_id set not null;

-- Direct workspace authority and composite relationships prevent a caller
-- with a privileged client from joining rows across workspaces accidentally.
alter table contacts
  add constraint contacts_workspace_fk
    foreign key (workspace_id) references workspaces (id) on delete restrict,
  add constraint contacts_id_workspace_unique unique (id, workspace_id);

alter table contacts drop constraint contacts_referred_by_id_fkey;
alter table contacts
  add constraint contacts_referred_by_workspace_fk
    foreign key (referred_by_id, workspace_id)
    references contacts (id, workspace_id)
    on delete set null (referred_by_id);

alter table notes
  add constraint notes_workspace_fk
    foreign key (workspace_id) references workspaces (id) on delete restrict,
  add constraint notes_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references contacts (id, workspace_id)
    on delete cascade;

alter table mailers
  add constraint mailers_workspace_fk
    foreign key (workspace_id) references workspaces (id) on delete restrict,
  add constraint mailers_id_workspace_unique unique (id, workspace_id);

alter table mailer_sends
  add constraint mailer_sends_workspace_fk
    foreign key (workspace_id) references workspaces (id) on delete restrict,
  add constraint mailer_sends_mailer_workspace_fk
    foreign key (mailer_id, workspace_id)
    references mailers (id, workspace_id)
    on delete cascade,
  add constraint mailer_sends_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references contacts (id, workspace_id)
    on delete cascade;

alter table contact_external_links
  add constraint contact_external_links_workspace_fk
    foreign key (workspace_id) references workspaces (id) on delete restrict,
  add constraint contact_external_links_contact_workspace_fk
    foreign key (contact_id, workspace_id)
    references contacts (id, workspace_id)
    on delete cascade,
  add constraint contact_external_links_workspace_provider_unique
    unique (workspace_id, provider, external_id);

alter table contact_intake_receipts
  add constraint contact_intake_receipts_workspace_fk
    foreign key (workspace_id) references workspaces (id) on delete restrict,
  add constraint contact_intake_receipts_workspace_idempotency_unique
    unique (workspace_id, idempotency_key);

create index contacts_workspace_next_touch_idx
  on contacts (workspace_id, next_touch_at)
  where pipeline_stage not in ('closed', 'lost');

create index contacts_workspace_lead_type_idx
  on contacts (workspace_id, lead_type);

create index notes_workspace_contact_idx
  on notes (workspace_id, contact_id, created_at desc);

create index mailers_workspace_created_idx
  on mailers (workspace_id, created_at desc);

create index mailer_sends_workspace_mailer_idx
  on mailer_sends (workspace_id, mailer_id, sent_on desc);

create index contact_external_links_workspace_contact_idx
  on contact_external_links (workspace_id, contact_id);

create index contact_intake_receipts_workspace_created_idx
  on contact_intake_receipts (workspace_id, created_at desc);

-- Membership-derived access -------------------------------------------------

create or replace function has_workspace_access(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
      and membership.status = 'active'
  );
$$;

revoke all on function has_workspace_access(uuid) from public;
revoke all on function is_workspace_owner(uuid) from public;
grant execute on function has_workspace_access(uuid) to authenticated;
grant execute on function is_workspace_owner(uuid) to authenticated;

create or replace function bootstrap_personal_workspace(workspace_name text)
returns table (
  workspace_id uuid,
  membership_id uuid,
  owner_user_id uuid,
  role workspace_role
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  active_membership_count integer;
  active_membership record;
  created_workspace_id uuid;
  created_membership_id uuid;
begin
  if caller_id is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  -- Serialize first-login bootstraps for this user so concurrent callbacks
  -- cannot create two personal workspaces.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('omnix:personal-workspace:' || caller_id::text, 0)
  );

  select count(*)::integer
    into active_membership_count
    from public.workspace_members membership
    where membership.user_id = caller_id
      and membership.status = 'active';

  if active_membership_count > 1 then
    raise exception 'active workspace membership is ambiguous'
      using errcode = '23514';
  end if;

  if active_membership_count = 1 then
    select
      membership.workspace_id,
      membership.id as membership_id,
      owner_membership.user_id as owner_user_id,
      membership.role
    into strict active_membership
    from public.workspace_members membership
    join public.workspace_members owner_membership
      on owner_membership.workspace_id = membership.workspace_id
     and owner_membership.role = 'owner'
     and owner_membership.status = 'active'
    where membership.user_id = caller_id
      and membership.status = 'active';

    workspace_id := active_membership.workspace_id;
    membership_id := active_membership.membership_id;
    owner_user_id := active_membership.owner_user_id;
    role := active_membership.role;
    return next;
    return;
  end if;

  if length(trim(workspace_name)) not between 1 and 80 then
    raise exception 'workspace name must contain 1 to 80 characters'
      using errcode = '23514';
  end if;

  insert into public.workspaces (name)
  values (trim(workspace_name))
  returning id into created_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (created_workspace_id, caller_id, 'owner', 'active')
  returning id into created_membership_id;

  workspace_id := created_workspace_id;
  membership_id := created_membership_id;
  owner_user_id := caller_id;
  role := 'owner';
  return next;
end;
$$;

revoke all on function bootstrap_personal_workspace(text) from public;
grant execute on function bootstrap_personal_workspace(text) to authenticated;

create or replace function add_workspace_assistant(
  target_user_id uuid,
  target_correlation_id uuid,
  target_reason text default null
)
returns workspace_members
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  owner_workspace_id uuid;
  target_membership public.workspace_members;
begin
  if caller_id is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  if target_user_id is null or target_user_id = caller_id then
    raise exception 'assistant user must be a different authenticated user'
      using errcode = '23514';
  end if;

  if target_correlation_id is null then
    raise exception 'correlation id is required' using errcode = '23514';
  end if;

  if target_reason is not null and length(target_reason) > 500 then
    raise exception 'reason cannot exceed 500 characters' using errcode = '23514';
  end if;

  begin
    select membership.workspace_id
      into strict owner_workspace_id
      from public.workspace_members membership
     where membership.user_id = caller_id
       and membership.role = 'owner'
       and membership.status = 'active';
  exception
    when no_data_found then
      raise exception 'active owner workspace not found' using errcode = '42501';
    when too_many_rows then
      raise exception 'active owner workspace is ambiguous' using errcode = '23514';
  end;

  perform set_config('omnix.correlation_id', target_correlation_id::text, true);
  perform set_config('omnix.audit_reason', coalesce(target_reason, ''), true);

  select membership.*
    into target_membership
    from public.workspace_members membership
   where membership.workspace_id = owner_workspace_id
     and membership.user_id = target_user_id;

  if found then
    if target_membership.role <> 'assistant' then
      raise exception 'target user already has protected workspace authority'
        using errcode = '23514';
    end if;

    if target_membership.status = 'revoked' then
      update public.workspace_members membership
         set status = 'active'
       where membership.id = target_membership.id
       returning membership.* into target_membership;
    end if;

    return target_membership;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (owner_workspace_id, target_user_id, 'assistant', 'active')
  returning * into target_membership;

  return target_membership;
end;
$$;

create or replace function revoke_workspace_assistant(
  target_membership_id uuid,
  target_correlation_id uuid,
  target_reason text default null
)
returns workspace_members
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  target_membership public.workspace_members;
begin
  if caller_id is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  if target_membership_id is null or target_correlation_id is null then
    raise exception 'membership id and correlation id are required'
      using errcode = '23514';
  end if;

  if target_reason is not null and length(target_reason) > 500 then
    raise exception 'reason cannot exceed 500 characters' using errcode = '23514';
  end if;

  select membership.*
    into target_membership
    from public.workspace_members membership
   where membership.id = target_membership_id;

  if not found or not public.is_workspace_owner(target_membership.workspace_id) then
    raise exception 'membership not found or not authorized' using errcode = '42501';
  end if;

  if target_membership.role <> 'assistant' then
    raise exception 'owner membership cannot be revoked' using errcode = '23514';
  end if;

  if target_membership.status = 'revoked' then
    return target_membership;
  end if;

  perform set_config('omnix.correlation_id', target_correlation_id::text, true);
  perform set_config('omnix.audit_reason', coalesce(target_reason, ''), true);

  update public.workspace_members membership
     set status = 'revoked'
   where membership.id = target_membership.id
   returning membership.* into target_membership;

  return target_membership;
end;
$$;

revoke all on function add_workspace_assistant(uuid, uuid, text) from public;
revoke all on function revoke_workspace_assistant(uuid, uuid, text) from public;
grant execute on function add_workspace_assistant(uuid, uuid, text) to authenticated;
grant execute on function revoke_workspace_assistant(uuid, uuid, text) to authenticated;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table workspace_authority_audit_events enable row level security;

create policy workspaces_member_select on workspaces
  for select to authenticated
  using (has_workspace_access(id));

create policy workspaces_owner_update on workspaces
  for update to authenticated
  using (is_workspace_owner(id))
  with check (is_workspace_owner(id));

create policy workspace_members_self_or_owner_select on workspace_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or is_workspace_owner(workspace_id)
    or (role = 'owner' and has_workspace_access(workspace_id))
  );

create policy workspace_authority_audit_events_owner_select on workspace_authority_audit_events
  for select to authenticated
  using (is_workspace_owner(workspace_id));

grant select, update on workspaces to authenticated;
grant select on workspace_members to authenticated;
grant select on workspace_authority_audit_events to authenticated;

-- Replace legacy owner policies. owner_id remains populated for compatibility
-- but cannot grant access, even when a caller spoofs it in a request.
drop policy contacts_owner on contacts;
drop policy notes_owner on notes;
drop policy mailers_owner on mailers;
drop policy mailer_sends_owner on mailer_sends;
drop policy contact_external_links_owner on contact_external_links;
drop policy contact_intake_receipts_owner on contact_intake_receipts;

create policy contacts_workspace_member on contacts
  for all to authenticated
  using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));

create policy notes_workspace_member on notes
  for all to authenticated
  using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));

create policy mailers_workspace_member on mailers
  for all to authenticated
  using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));

create policy mailer_sends_workspace_member on mailer_sends
  for all to authenticated
  using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));

create policy contact_external_links_workspace_member on contact_external_links
  for all to authenticated
  using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));

create policy contact_intake_receipts_workspace_member on contact_intake_receipts
  for all to authenticated
  using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));

-- Final fail-closed verification -------------------------------------------

do $$
declare
  tenant_table_name text;
begin
  foreach tenant_table_name in array array[
    'contacts',
    'notes',
    'mailers',
    'mailer_sends',
    'contact_external_links',
    'contact_intake_receipts'
  ] loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and information_schema.columns.table_name = tenant_table_name
        and column_name = 'workspace_id'
        and is_nullable <> 'NO'
    ) then
      raise exception 'workspace_id remains nullable on %', tenant_table_name;
    end if;
  end loop;

  if exists (
    select workspace_id
    from workspace_members
    where role = 'owner' and status = 'active'
    group by workspace_id
    having count(*) <> 1
  ) then
    raise exception 'workspace owner cardinality verification failed';
  end if;

  if exists (
    select 1
    from workspaces workspace
    where not exists (
      select 1
      from workspace_members membership
      where membership.workspace_id = workspace.id
        and membership.role = 'owner'
        and membership.status = 'active'
    )
  ) then
    raise exception 'workspace without active owner found';
  end if;
end;
$$;

comment on table workspaces is
  'Canonical Omnix tenant boundary. Access is derived from active membership.';
comment on table workspace_members is
  'Owner/assistant membership authority. Revocation is stateful and auditable.';
comment on table workspace_authority_audit_events is
  'Append-only audit evidence for workspace and membership authority changes; actor FK is cleared only if the auth account is deleted.';
comment on column contacts.workspace_id is
  'Canonical tenant authority; owner_id is retained only for compatibility.';
comment on column notes.workspace_id is
  'Canonical tenant authority inherited from the related contact.';
comment on column mailer_sends.workspace_id is
  'Canonical tenant authority shared by the related mailer and contact.';
comment on function has_workspace_access(uuid) is
  'Returns true only when auth.uid() has an active membership in the workspace.';
comment on function is_workspace_owner(uuid) is
  'Returns true only for the workspace single active owner.';
comment on function bootstrap_personal_workspace(text) is
  'Returns the one active membership, or atomically creates a personal workspace and owner membership when none exists; ambiguous memberships fail closed.';

commit;
