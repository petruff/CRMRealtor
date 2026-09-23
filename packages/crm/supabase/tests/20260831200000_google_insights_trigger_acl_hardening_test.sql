begin;
select '1..3';

do $$
begin
  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'capture_google_insights_capability'
      and privilege_type = 'EXECUTE'
      and grantee = 'PUBLIC'
  ) then
    raise exception 'Google Insights trigger function remains executable by PUBLIC';
  end if;
end $$;
select 'ok 1 - Google Insights trigger execution is not granted to PUBLIC';

do $$
begin
  if has_function_privilege('anon', 'public.capture_google_insights_capability()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.capture_google_insights_capability()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.capture_google_insights_capability()', 'EXECUTE') then
    raise exception 'Google Insights trigger function remains directly executable';
  end if;
end $$;
select 'ok 2 - Google Insights trigger execution is not exposed to API roles';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.google_oauth_completions'::regclass
      and trigger_record.tgname = 'google_oauth_completion_capture_insights'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'Google Insights capability trigger is missing';
  end if;
end $$;
select 'ok 3 - Google Insights capability capture remains trigger-driven';

rollback;
