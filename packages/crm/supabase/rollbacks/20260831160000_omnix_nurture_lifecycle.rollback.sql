-- Pre-use rollback only. Use a data-preserving forward repair after any plan exists.
begin;
drop function if exists public.complete_omnix_nurture_step(uuid,uuid,text,bigint,integer,uuid,text,timestamptz);
drop function if exists public.claim_due_omnix_nurture_plans(uuid,text,timestamptz,integer,integer);
drop function if exists public.transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz);
drop function if exists public.create_omnix_nurture_plan(uuid,uuid,uuid,integer,integer,timestamptz,uuid,text,timestamptz);
drop trigger if exists omnix_nurture_plans_touch_updated_at on public.omnix_nurture_plans;
drop trigger if exists omnix_nurture_plan_events_no_mutation on public.omnix_nurture_plan_events;
drop table if exists public.omnix_nurture_plan_events;
drop table if exists public.omnix_nurture_plans;
drop type if exists public.omnix_nurture_plan_state;
commit;
