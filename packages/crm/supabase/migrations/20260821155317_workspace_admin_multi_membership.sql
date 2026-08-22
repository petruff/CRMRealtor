-- Audited developer/workspace administration without transferring the
-- canonical owner. Grants live outside exposed schemas and are resolved only
-- through the existing workspace authority function.

begin;

create schema if not exists private;

create table private.workspace_admin_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  granted_by_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint workspace_admin_grants_reason_length check (length(trim(reason)) between 1 and 500),
  constraint workspace_admin_grants_revocation_state check (revoked_at is null or revoked_at >= created_at)
);

create unique index workspace_admin_grants_one_active_idx
  on private.workspace_admin_grants(workspace_id, user_id)
  where revoked_at is null;

alter table private.workspace_admin_grants enable row level security;
revoke all on private.workspace_admin_grants from public, anon, authenticated;

create table private.workspace_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('admin_granted', 'admin_revoked')),
  reason text not null check (length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table private.workspace_admin_audit_events enable row level security;
revoke all on private.workspace_admin_audit_events from public, anon, authenticated;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
      and membership.status = 'active'
  ) or exists (
    select 1
    from private.workspace_admin_grants admin_grant
    join public.workspace_members membership
      on membership.workspace_id = admin_grant.workspace_id
     and membership.user_id = admin_grant.user_id
     and membership.status = 'active'
    where admin_grant.workspace_id = target_workspace_id
      and admin_grant.user_id = auth.uid()
      and admin_grant.revoked_at is null
  );
$$;

revoke all on function public.is_workspace_owner(uuid) from public;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

create or replace function public.assert_rich_contact_actor(
  target_membership_id uuid,
  target_workspace_id uuid,
  require_owner boolean default false
)
returns public.workspace_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  caller_id uuid := auth.uid();
begin
  select membership.* into actor
  from public.workspace_members membership
  where membership.id = target_membership_id
    and membership.workspace_id = target_workspace_id
    and membership.status = 'active';

  if not found
     or (caller_id is not null and actor.user_id <> caller_id)
     or (require_owner and not public.is_workspace_owner(target_workspace_id)) then
    raise exception 'active rich-contact actor authority is required'
      using errcode = '42501';
  end if;
  return actor;
end;
$$;

create or replace function public.connector_current_membership(
  target_workspace_id uuid,
  require_owner boolean default false
)
returns public.workspace_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  membership public.workspace_members%rowtype;
begin
  if caller_id is null then
    raise exception 'authenticated connector actor required' using errcode = '42501';
  end if;
  select candidate.* into membership
  from public.workspace_members candidate
  where candidate.workspace_id = target_workspace_id
    and candidate.user_id = caller_id
    and candidate.status = 'active';
  if not found then
    raise exception 'active workspace membership required' using errcode = '42501';
  end if;
  if require_owner and not public.is_workspace_owner(target_workspace_id) then
    raise exception 'workspace administrator authority required' using errcode = '42501';
  end if;
  return membership;
end;
$$;

revoke all on function public.connector_current_membership(uuid, boolean) from public;

commit;
