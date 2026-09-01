-- Data-preserving containment rollback. Existing plans and immutable lifecycle
-- evidence remain available while every mutation and scheduler entry point is
-- disabled.

begin;

revoke execute on function public.create_omnix_nurture_plan(
  uuid,uuid,uuid,integer,integer,timestamptz,uuid,text,timestamptz
) from authenticated;
revoke execute on function public.transition_omnix_nurture_plan(
  uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz
) from authenticated;
revoke execute on function public.claim_due_omnix_nurture_plans(
  uuid,text,timestamptz,integer,integer
) from service_role;
revoke execute on function public.complete_omnix_nurture_step(
  uuid,uuid,text,bigint,integer,uuid,text,timestamptz
) from service_role;

comment on table public.omnix_nurture_plans is
  'CONTAINED: nurture mutation and scheduler entry points are revoked; plans and lifecycle evidence are retained.';

commit;
