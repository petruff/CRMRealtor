-- Containment rollback for migration 20260825124000.
--
-- Security invariants are intentionally not rolled back: the AI secret read
-- remains canonical-owner-bound, support never becomes ownership, and all
-- grant/audit data remains intact. The new support identity and contact page
-- entry points are disabled while ordinary assistant membership reads and the
-- legacy boolean support check remain available.
-- The corrected Smart List validator volatility and attention array typing
-- are safe metadata/body repairs and are intentionally retained.

begin;

create or replace function public.has_workspace_support_grant(
  target_workspace_id uuid
)
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

revoke all on function public.resolve_workspace_support_grant_id(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.has_workspace_support_grant(uuid)
  from public, anon;
grant execute on function public.has_workspace_support_grant(uuid)
  to authenticated;

do $$
begin
  if pg_get_functiondef('public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)'::regprocedure)
     not ilike '%assert_canonical_workspace_owner_identity%' then
    raise exception 'rollback refused: canonical-owner AI secret binding must be retained';
  end if;
  if not has_function_privilege('authenticated',
    'public.has_workspace_support_grant(uuid)','execute') then
    raise exception 'rollback failed: ordinary assistant scope support check is unavailable';
  end if;
  if exists (
    select 1
    from unnest(array[
      'public.is_iso_date_value(jsonb)'::regprocedure,
      'public.is_valid_smart_list_definition(jsonb)'::regprocedure,
      'public.is_valid_incomplete_candidate(jsonb)'::regprocedure,
      'public.is_valid_contact_conversion_payload(jsonb,boolean)'::regprocedure,
      'public.incomplete_candidate_contact_patch(jsonb,public.contacts)'::regprocedure,
      'public.is_valid_incomplete_conversion_plan(jsonb)'::regprocedure
    ]) target(oid)
    join pg_catalog.pg_proc procedure on procedure.oid = target.oid
    where procedure.provolatile <> 's'
  ) then
    raise exception 'rollback must retain corrected validator volatility';
  end if;
  if (select prosrc from pg_catalog.pg_proc
      where oid='public.reconcile_attention_items(uuid,jsonb,timestamptz,text)'::regprocedure)
      not like '%occurrence_keys text[] := ''{}''::text[]%' then
    raise exception 'rollback must retain corrected attention array typing';
  end if;
end;
$$;

commit;
