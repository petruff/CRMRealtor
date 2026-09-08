-- Non-destructive rollback: retain prior evidence, disable further snapshot generation.
begin;
-- Also contain the rejected pre-release definition whose default ACLs granted
-- broad table writes. TRUNCATE bypasses row security and row-level triggers.
revoke all on public.meeting_brief_snapshots from public,anon,authenticated,service_role;
grant select on public.meeting_brief_snapshots to authenticated,service_role;
revoke all on function public.reject_meeting_brief_mutation(),public.create_meeting_brief_snapshot(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
