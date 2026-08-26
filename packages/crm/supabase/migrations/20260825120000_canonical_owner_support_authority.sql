-- Stories 6.9 and 6.11: restore canonical ownership and keep support authority
-- separate. This migration preserves all support grants and audit history.
-- Rollback is containment-only; it must never restore administrator-as-owner.
begin;

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
  );
$$;

create or replace function public.has_workspace_support_grant(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.workspace_admin_grants support_grant
    join public.workspace_members membership
      on membership.workspace_id = support_grant.workspace_id
     and membership.user_id = support_grant.user_id
    where support_grant.workspace_id = target_workspace_id
      and support_grant.user_id = auth.uid()
      and support_grant.revoked_at is null
      and membership.role = 'assistant'
      and membership.status = 'active'
  );
$$;

create or replace function public.assert_canonical_workspace_owner(
  target_workspace_id uuid,
  target_membership_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      select count(*) = 1
      from public.workspace_members owner_membership
      where owner_membership.workspace_id = target_workspace_id
        and owner_membership.role = 'owner'
        and owner_membership.status = 'active'
    )
    and exists (
      select 1
      from public.workspace_members actor_membership
      where actor_membership.workspace_id = target_workspace_id
        and actor_membership.user_id = auth.uid()
        and actor_membership.role = 'owner'
        and actor_membership.status = 'active'
        and (target_membership_id is null or actor_membership.id = target_membership_id)
    );
$$;

create or replace function public.connector_current_membership(
  target_workspace_id uuid,
  require_owner boolean default false
)
returns public.workspace_members
language plpgsql
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

  if require_owner and not public.assert_canonical_workspace_owner(
      target_workspace_id,
      membership.id
    ) then
    raise exception 'authenticated canonical owner required' using errcode = '42501';
  end if;

  return membership;
end;
$$;

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

  if not found or (caller_id is not null and actor.user_id <> caller_id) then
    raise exception 'active rich-contact actor authority is required'
      using errcode = '42501';
  end if;

  if require_owner and not public.assert_canonical_workspace_owner(
      target_workspace_id,
      target_membership_id
    ) then
    raise exception 'authenticated canonical owner required' using errcode = '42501';
  end if;

  return actor;
end;
$$;

-- A support-created OAuth transaction from the historical broadened predicate
-- can never be consumed after this correction. Immutable binding fields also
-- prevent a callback from swapping actor, membership, workspace or provider.
create or replace function connector_private.guard_oauth_canonical_owner_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.workspace_id <> old.workspace_id
    or new.connection_id is distinct from old.connection_id
    or new.provider <> old.provider
    or new.actor_user_id <> old.actor_user_id
    or new.membership_id <> old.membership_id
    or new.state_hash <> old.state_hash
    or new.session_binding_hash <> old.session_binding_hash
  ) then
    raise exception 'OAuth transaction authority binding is immutable'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and old.consumed_at is null and new.consumed_at is not null) then
    if not exists (
      select 1
      from public.workspace_members membership
      where membership.id = new.membership_id
        and membership.workspace_id = new.workspace_id
        and membership.user_id = new.actor_user_id
        and membership.role = 'owner'
        and membership.status = 'active'
    ) then
      raise exception 'OAuth transaction requires canonical owner binding'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists connector_oauth_canonical_owner_binding
  on connector_private.connector_oauth_transactions;
create trigger connector_oauth_canonical_owner_binding
before insert or update on connector_private.connector_oauth_transactions
for each row execute function connector_private.guard_oauth_canonical_owner_binding();

revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.has_workspace_support_grant(uuid) from public, anon;
revoke all on function public.assert_canonical_workspace_owner(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.connector_current_membership(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_rich_contact_actor(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function connector_private.guard_oauth_canonical_owner_binding()
  from public, anon, authenticated, service_role;

grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.has_workspace_support_grant(uuid) to authenticated;

comment on function public.is_workspace_owner(uuid) is
  'Canonical owner predicate. Support grants never satisfy ownership.';
comment on function public.has_workspace_support_grant(uuid) is
  'Separate support classification predicate. It grants no owner-only operation by itself.';
comment on function public.assert_canonical_workspace_owner(uuid, uuid) is
  'Transactional owner assertion binding auth.uid(), workspace, active owner role and optional membership ID.';

commit;
