-- Effective privilege regression: catches Supabase default grants as well as
-- explicit grants. Existing scoped actor/RLS tests remain independently required.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
select ok(not exists(
  select 1 from unnest(array['meeting_brief_snapshots','capture_outcomes','capture_outcome_versions','capture_outcome_note_receipts','capture_calendar_intent_receipts','capture_run_telemetry']) t
  where not has_table_privilege('authenticated','public.'||t,'SELECT')
),'authenticated members retain read privileges for all conversation evidence');
select ok(not exists(
  select 1 from unnest(array['meeting_brief_snapshots','capture_outcomes','capture_outcome_versions','capture_outcome_note_receipts','capture_calendar_intent_receipts','capture_run_telemetry']) t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
  where has_table_privilege('anon','public.'||t,permission)
),'anonymous callers inherit no conversation table privileges');
select ok(not exists(
  select 1 from unnest(array['meeting_brief_snapshots','capture_outcomes','capture_outcome_versions','capture_outcome_note_receipts','capture_calendar_intent_receipts','capture_run_telemetry']) t
  cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
  where has_table_privilege('authenticated','public.'||t,permission) is distinct from (t='capture_run_telemetry' and permission='INSERT')
),'authenticated direct writes are limited to scoped telemetry append');
select ok(not exists(
  select 1 from unnest(array['meeting_brief_snapshots','capture_outcomes','capture_outcome_versions','capture_outcome_note_receipts','capture_calendar_intent_receipts','capture_run_telemetry']) t
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
  where has_table_privilege('service_role','public.'||t,permission) is distinct from (permission='SELECT' or (t='meeting_brief_snapshots' and permission='INSERT'))
),'service evidence grants match the explicit read and brief-append allowlist');
select ok(not exists(
  select 1 from unnest(array['create_meeting_brief_snapshot(uuid,uuid,jsonb)','save_capture_outcome(uuid,uuid,jsonb,integer,text)','append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz)','create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid)','transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz)']) signature
  where not has_function_privilege('authenticated','public.'||signature,'EXECUTE')
),'guarded conversation commands remain callable by authenticated actors');
select ok(not exists(
  select 1 from unnest(array['create_meeting_brief_snapshot(uuid,uuid,jsonb)','save_capture_outcome(uuid,uuid,jsonb,integer,text)','append_capture_outcome_note(uuid,uuid,uuid,integer,uuid,text,text,timestamptz)','create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid)','transition_omnix_nurture_plan(uuid,uuid,integer,text,timestamptz,text,uuid,text,timestamptz)']) signature
  cross join unnest(array['anon','service_role']) actor
  where has_function_privilege(actor,'public.'||signature,'EXECUTE')
),'anonymous and service callers inherit no guarded member-command execution');
select ok(not exists(
  select 1 from unnest(array['reject_meeting_brief_mutation()','capture_operation_child_payload(text,jsonb)','capture_calendar_payload_hash(uuid,jsonb)']) signature
  cross join unnest(array['anon','authenticated','service_role']) actor
  where has_function_privilege(actor,'public.'||signature,'EXECUTE')
),'internal trigger and payload helpers are not browser or service APIs');
select ok(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) permission
  where n.nspname='public' and p.proname in ('reject_meeting_brief_mutation','capture_operation_child_payload','capture_calendar_payload_hash','create_meeting_brief_snapshot','save_capture_outcome','append_capture_outcome_note','create_capture_calendar_intent','transition_omnix_nurture_plan')
    and permission.grantee=0 and permission.privilege_type='EXECUTE'
),'PUBLIC has no implicit execution on the affected helpers or commands');
select ok(not exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('meeting_brief_snapshots','capture_outcomes','capture_outcome_versions','capture_outcome_note_receipts','capture_calendar_intent_receipts','capture_run_telemetry') and not c.relrowsecurity
),'all conversation evidence tables enable row-level security');
select ok(not exists(
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('create_meeting_brief_snapshot','save_capture_outcome','append_capture_outcome_note','create_capture_calendar_intent','transition_omnix_nurture_plan')
    and (not p.prosecdef or not exists(select 1 from unnest(p.proconfig) setting where regexp_replace(setting,'[[:space:]]','','g') in ('search_path=public,pg_temp','search_path=pg_catalog,public')))
),'guarded commands retain explicit security-definer search paths');
-- Deliberately reproduce the rejected default-ALL state. The policy statements
-- below match brief rollback/repair; the CI recovery stage separately executes
-- the actual files. This fixture is fully reverted by the enclosing rollback.
grant all on public.meeting_brief_snapshots to public,anon,authenticated,service_role;
grant execute on function public.reject_meeting_brief_mutation(),public.create_meeting_brief_snapshot(uuid,uuid,jsonb) to public,anon,authenticated,service_role;
select ok(has_table_privilege('anon','public.meeting_brief_snapshots','TRUNCATE') and has_function_privilege('service_role','public.create_meeting_brief_snapshot(uuid,uuid,jsonb)','EXECUTE'),'recovery fixture reproduces broad inherited table and function privileges');
revoke all on public.meeting_brief_snapshots from public,anon,authenticated,service_role;
grant select on public.meeting_brief_snapshots to authenticated,service_role;
revoke all on function public.reject_meeting_brief_mutation(),public.create_meeting_brief_snapshot(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
select ok(not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) actor
  cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) permission
  where has_table_privilege(actor,'public.meeting_brief_snapshots',permission)
) and not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) actor
  cross join unnest(array['reject_meeting_brief_mutation()','create_meeting_brief_snapshot(uuid,uuid,jsonb)']) signature
  where has_function_privilege(actor,'public.'||signature,'EXECUTE')
),'containment removes inherited writes including TRUNCATE and every direct generation path');
revoke all on public.meeting_brief_snapshots from public,anon,authenticated,service_role;
grant select on public.meeting_brief_snapshots to authenticated;
grant select,insert on public.meeting_brief_snapshots to service_role;
revoke all on function public.reject_meeting_brief_mutation(),public.create_meeting_brief_snapshot(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_meeting_brief_snapshot(uuid,uuid,jsonb) to authenticated;
select ok(not has_table_privilege('anon','public.meeting_brief_snapshots','SELECT')
  and not has_table_privilege('authenticated','public.meeting_brief_snapshots','INSERT')
  and not has_table_privilege('service_role','public.meeting_brief_snapshots','TRUNCATE')
  and has_table_privilege('service_role','public.meeting_brief_snapshots','INSERT')
  and has_function_privilege('authenticated','public.create_meeting_brief_snapshot(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.create_meeting_brief_snapshot(uuid,uuid,jsonb)','EXECUTE')
,'forward repair restores only intended availability after poisoned privilege containment');
select * from finish();
rollback;
