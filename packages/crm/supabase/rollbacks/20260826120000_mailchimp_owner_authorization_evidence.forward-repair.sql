-- Forward repair for canonical-owner Mailchimp authorization evidence after
-- containment rollback.

begin;

alter function public.read_mailchimp_owner_authorization_evidence(uuid) volatile;

revoke all on function public.read_mailchimp_owner_authorization_evidence(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_mailchimp_owner_authorization_evidence(uuid)
  to authenticated;

do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.read_mailchimp_owner_authorization_evidence(uuid)',
    'execute'
  ) then
    raise exception 'forward repair failed: Mailchimp owner evidence entry point is unavailable';
  end if;
  if (
    select routine.provolatile
    from pg_proc routine
    where routine.oid = 'public.read_mailchimp_owner_authorization_evidence(uuid)'::regprocedure
  ) <> 'v' then
    raise exception 'forward repair failed: Mailchimp owner evidence volatility is unsafe';
  end if;
end;
$$;

commit;
