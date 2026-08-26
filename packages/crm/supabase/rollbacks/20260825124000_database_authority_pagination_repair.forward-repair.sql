-- Forward repair for migration 20260825124000 after containment rollback.
-- The rollback retains the exact-page function body, corrected validator
-- volatility and attention array typing; this script restores entry-point
-- grants and verifies those retained invariants.

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
  select public.resolve_workspace_support_grant_id(target_workspace_id) is not null;
$$;

revoke all on function public.resolve_workspace_support_grant_id(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.has_workspace_support_grant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)
  from public, anon, authenticated, service_role;

grant execute on function public.resolve_workspace_support_grant_id(uuid)
  to authenticated;
grant execute on function public.has_workspace_support_grant(uuid)
  to authenticated;
grant execute on function public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)
  to authenticated;

-- An earlier forward repair intentionally restores the original attention
-- reconciliation body. Reapply this migration's explicit text-array typing
-- without duplicating the large service-only function body here.
do $$
declare
  function_definition text;
  repaired_definition text;
begin
  select pg_get_functiondef(
    'public.reconcile_attention_items(uuid,jsonb,timestamptz,text)'::regprocedure
  ) into function_definition;

  repaired_definition := replace(
    function_definition,
    'occurrence_keys text[]:=''{}'';',
    'occurrence_keys text[] := ''{}''::text[];'
  );
  repaired_definition := replace(
    repaired_definition,
    'occurrence_keys text[] := ''{}'';',
    'occurrence_keys text[] := ''{}''::text[];'
  );

  if repaired_definition not like '%occurrence_keys text[] := ''{}''::text[]%' then
    raise exception 'forward repair failed: attention array declaration is unavailable';
  end if;

  if repaired_definition <> function_definition then
    execute repaired_definition;
  end if;
end;
$$;

do $$
begin
  if pg_get_functiondef('public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)'::regprocedure)
     not ilike '%assert_canonical_workspace_owner_identity%' then
    raise exception 'forward repair failed: canonical-owner AI secret binding is missing';
  end if;
  if not has_function_privilege('authenticated',
    'public.resolve_workspace_support_grant_id(uuid)','execute')
     or not has_function_privilege('authenticated',
    'public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)','execute') then
    raise exception 'forward repair failed: corrected RPC grants are missing';
  end if;
  if pg_get_functiondef(
      'public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)'::regprocedure
    ) like '%source_position <= 500%' then
    raise exception 'forward repair failed: truncated Smart List source remains';
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
    raise exception 'forward repair failed: validator volatility correction is missing';
  end if;
  if (select prosrc from pg_catalog.pg_proc
      where oid='public.reconcile_attention_items(uuid,jsonb,timestamptz,text)'::regprocedure)
      not like '%occurrence_keys text[] := ''{}''::text[]%' then
    raise exception 'forward repair failed: attention array typing correction is missing';
  end if;
end;
$$;

commit;
