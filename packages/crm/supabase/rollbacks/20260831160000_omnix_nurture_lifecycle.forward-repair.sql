-- Restore the exact mutation and scheduler grants revoked by containment.

begin;

grant execute on function public.create_omnix_nurture_plan(
  uuid,uuid,uuid,integer,integer,timestamptz,uuid,text,timestamptz
) to authenticated;
grant execute on function public.transition_omnix_nurture_plan(
  uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz
) to authenticated;
grant execute on function public.claim_due_omnix_nurture_plans(
  uuid,text,timestamptz,integer,integer
) to service_role;
grant execute on function public.complete_omnix_nurture_step(
  uuid,uuid,text,bigint,integer,uuid,text,timestamptz
) to service_role;

comment on table public.omnix_nurture_plans is
  'Governed contact nurture lifecycle. Scheduler steps remain pending proposals and never auto-approve.';

commit;
