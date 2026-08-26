-- Forward repair after Story 6.9 containment. No production data is changed.
begin;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
      and membership.status = 'active'
  );
$$;

create or replace function public.has_workspace_support_grant(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
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

revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.has_workspace_support_grant(uuid) from public, anon;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.has_workspace_support_grant(uuid) to authenticated;

do $$
begin
  if pg_get_functiondef('public.is_workspace_owner(uuid)'::regprocedure)
     ilike '%workspace_admin_grants%' then
    raise exception 'forward repair failed: support grants still satisfy ownership';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'connector_private.connector_oauth_transactions'::regclass
      and tgname = 'connector_oauth_canonical_owner_binding'
      and not tgisinternal
  ) then
    raise exception 'forward repair failed: OAuth owner-binding trigger is missing';
  end if;
end;
$$;

commit;
