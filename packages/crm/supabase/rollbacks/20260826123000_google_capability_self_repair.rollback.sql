-- Containment rollback: disable self-repair while preserving verified capability state.
begin;

revoke all on function public.repair_google_connection_capabilities(uuid, timestamptz)
  from public, anon, authenticated, service_role;

commit;
