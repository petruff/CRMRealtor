-- Forward repair after the pre-use rollback. The function body remains
-- versioned in the forward migration; this restores only its safe constraint
-- and authenticated execution boundary without touching persisted evidence.
begin;

alter table public.data_import_row_outcomes
  drop constraint data_import_row_outcomes_error_code_check;
alter table public.data_import_row_outcomes
  add constraint data_import_row_outcomes_error_code_check
  check (
    error_code is null
    or (
      length(error_code) <= 323
      and error_code ~ '^[a-z][a-z0-9_.-]{1,79}(,[a-z][a-z0-9_.-]{1,79}){0,3}$'
    )
  );

do $$
begin
  if to_regprocedure(
    'public.apply_contact_import_plan(uuid,uuid,text,text,text,text,text,jsonb,uuid,integer,timestamptz,timestamptz,uuid)'
  ) is null then
    raise exception 'atomic import plan forward repair requires the versioned RPC body';
  end if;
end;
$$;

revoke all on function public.apply_contact_import_plan(
  uuid,uuid,text,text,text,text,text,jsonb,uuid,integer,
  timestamptz,timestamptz,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.apply_contact_import_plan(
  uuid,uuid,text,text,text,text,text,jsonb,uuid,integer,
  timestamptz,timestamptz,uuid
) to authenticated;

commit;
