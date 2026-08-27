-- Containment rollback for canonical-owner Mailchimp authorization evidence.
--
-- The hardened function body is retained so rollback cannot make historical
-- support authorization trustworthy again. The public entry point is disabled
-- until the forward repair re-verifies and restores its narrow grant.

begin;

revoke all on function public.read_mailchimp_owner_authorization_evidence(uuid)
  from public, anon, authenticated, service_role;

do $$
begin
  if to_regprocedure('public.read_mailchimp_owner_authorization_evidence(uuid)') is null then
    raise exception 'rollback refused: hardened Mailchimp owner evidence function is missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.read_mailchimp_owner_authorization_evidence(uuid)',
    'execute'
  ) then
    raise exception 'rollback failed: Mailchimp owner evidence entry point remains enabled';
  end if;
end;
$$;

commit;
