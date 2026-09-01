-- Fail-closed Story 7.2 forward repair.
begin;
alter table public.transaction_milestones enable row level security;
alter table public.transaction_milestones force row level security;
alter table public.transaction_milestone_events enable row level security;
alter table public.transaction_milestone_events force row level security;
revoke all on function public.create_transaction_milestone(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.create_transaction_milestone_v2(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.update_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_milestone_v2(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.create_transaction_milestone_v2(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.update_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,text,timestamptz)
  to authenticated,service_role;
grant execute on function public.transition_transaction_milestone_v2(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,text,timestamptz)
  to authenticated,service_role;
commit;
