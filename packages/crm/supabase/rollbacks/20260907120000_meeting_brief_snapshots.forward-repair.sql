-- Restore generation after the non-destructive rollback. Evidence remains unchanged.
begin;
-- Restore the explicit allowlist even if the failed pre-release definition
-- inherited broad schema default grants. Do not rely on GRANT alone.
revoke all on public.meeting_brief_snapshots from public,anon,authenticated,service_role;
grant select on public.meeting_brief_snapshots to authenticated;
grant select,insert on public.meeting_brief_snapshots to service_role;
revoke all on function public.reject_meeting_brief_mutation(),public.create_meeting_brief_snapshot(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_meeting_brief_snapshot(uuid,uuid,jsonb) to authenticated;
commit;
