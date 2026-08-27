-- Emergency rollback for Story 6.1 before Production adoption.
-- Snapshot the schema and retain exported lifecycle evidence before executing.
-- Existing tasks, activity events and deterministic Omnix alerts are unaffected.

begin;
drop function if exists public.reconcile_attention_items(uuid,jsonb,timestamptz,text);
drop function if exists public.transition_attention_item(uuid,uuid,integer,text,uuid,timestamptz,text,timestamptz,text);
drop trigger if exists attention_items_guard_identity on public.attention_items;
drop trigger if exists attention_lifecycle_events_no_mutation on public.attention_lifecycle_events;
drop function if exists public.guard_attention_identity();
drop function if exists public.guard_attention_event_mutation();
drop table if exists public.attention_reconciliation_runs;
drop table if exists public.attention_lifecycle_events;
drop table if exists public.attention_items;
drop type if exists public.attention_run_state;
drop type if exists public.attention_actor_kind;
drop type if exists public.attention_subject_type;
drop type if exists public.attention_state;
drop type if exists public.attention_priority;
commit;
