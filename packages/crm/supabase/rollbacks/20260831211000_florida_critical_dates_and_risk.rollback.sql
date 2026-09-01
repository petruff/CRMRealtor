-- Non-destructive Story 7.2 feature deactivation. Sourced dates and history remain readable.
begin;
revoke all on function public.create_transaction_milestone_v2(uuid,uuid,uuid,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.update_transaction_milestone(uuid,uuid,uuid,integer,public.transaction_milestone_kind,text,timestamptz,text,uuid,text,text,date,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.transition_transaction_milestone_v2(uuid,uuid,uuid,integer,public.transaction_milestone_state,text,text,timestamptz)
  from public,anon,authenticated,service_role;
comment on table public.transaction_milestones is
  'Story 7.2 data retained in read-only recovery mode; apply paired forward repair before mutation resumes.';
commit;
