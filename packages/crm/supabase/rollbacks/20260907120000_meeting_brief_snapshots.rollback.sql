-- Non-destructive rollback: retain prior evidence, disable further snapshot generation.
begin;
revoke execute on function public.create_meeting_brief_snapshot(uuid,uuid,jsonb) from authenticated;
commit;
