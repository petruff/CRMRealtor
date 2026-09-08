-- Restore generation after the non-destructive rollback. Evidence remains unchanged.
begin;
grant execute on function public.create_meeting_brief_snapshot(uuid,uuid,jsonb) to authenticated;
commit;
