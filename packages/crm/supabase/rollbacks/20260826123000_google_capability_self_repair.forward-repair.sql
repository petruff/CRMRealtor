-- Restore the narrow authenticated self-repair entry point after containment.
begin;

revoke all on function public.repair_google_connection_capabilities(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.repair_google_connection_capabilities(uuid, timestamptz)
  to authenticated;

commit;
