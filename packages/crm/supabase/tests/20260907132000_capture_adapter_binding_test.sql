-- Transactional tests against all migrated schema; not a substitute for live connector acceptance.
begin;
select '1..4';
do $$ begin
  if has_table_privilege('authenticated','public.capture_calendar_intent_receipts','INSERT')
    or has_function_privilege('anon','public.create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.capture_calendar_payload_hash(uuid,jsonb)','EXECUTE')
    or not has_function_privilege('authenticated','public.create_capture_calendar_intent(uuid,integer,uuid,text,uuid,text,uuid,integer,jsonb,uuid)','EXECUTE') then raise exception 'Unsafe capture adapter privileges'; end if;
end $$;
select 'ok 1 - calendar receipt writes stay behind canonical owner authority';
do $$ declare payload jsonb; hash text; begin
  payload:='{"taskId":"94000000-0000-4000-8000-000000000001","taskVersion":2,"title":"Reviewed showing","startAt":"2026-09-09T10:00:00-04:00","endAt":"2026-09-09T15:00:00Z","timeZone":"America/New_York"}';
  hash:=public.capture_calendar_payload_hash('92000000-0000-4000-8000-000000000001',payload);
  if hash is distinct from 'f96924562457747c9cb5bee4101379a50ed59bf428d4e21a6dac19711660e169' then raise exception 'Calendar hash differs from JavaScript stablePayloadHash'; end if;
  if hash=public.capture_calendar_payload_hash('92000000-0000-4000-8000-000000000001',jsonb_set(payload,'{startAt}','"2026-09-09T13:00:00Z"')) then raise exception 'Changed approved time retained hash'; end if;
end $$;
select 'ok 2 - canonical calendar hash matches runtime and binds exact event time';
do $$ declare payload jsonb; begin
  payload:=public.capture_operation_child_payload('contact-1','{"type":"nurture-transition","after":{"planId":"plan-1","action":"pause"},"preconditions":{"planVersion":2}}');
  if payload is distinct from '{"contactId":"contact-1","planId":"plan-1","action":"pause","expectedVersion":2}'::jsonb then raise exception 'Nurture child binding differs'; end if;
  begin
    perform public.capture_operation_child_payload('contact-1','{"type":"pipeline-move","after":{"toStage":"active"}}');
    raise exception 'Pipeline without approved prior state accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select 'ok 3 - lifecycle payload includes exact prior state and version';
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='omnix_nurture_plan_events' and column_name='transition_request') then raise exception 'Nurture replay request binding missing'; end if;
  if has_table_privilege('authenticated','public.omnix_nurture_plan_events','UPDATE') then raise exception 'Nurture replay evidence mutable'; end if;
end $$;
select 'ok 4 - nurture request evidence is additive and immutable';
rollback;
