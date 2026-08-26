-- Emergency containment rollback for Story 6.9.
-- This intentionally does not restore the unsafe administrator-as-owner
-- predicate and does not delete support grants or audit history. If the new
-- contract causes an incident, disable affected application entry points,
-- retain this canonical predicate, and apply the matching forward repair.
begin;

do $$
begin
  if pg_get_functiondef('public.is_workspace_owner(uuid)'::regprocedure)
     ilike '%workspace_admin_grants%' then
    raise exception 'rollback refused: canonical ownership must not include support grants';
  end if;
end;
$$;

-- Keep the separately named support predicate executable. Workspace scope
-- resolution calls it for every assistant, including assistants with no
-- support grant; revoking it would remove ordinary assistant read scope rather
-- than merely containing support authority.
revoke all on function public.has_workspace_support_grant(uuid)
  from public, anon;
grant execute on function public.has_workspace_support_grant(uuid)
  to authenticated;

commit;
