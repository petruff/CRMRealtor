-- Pre-use rollback only. It disables the new entry point and restores the
-- prior single-token error-code constraint without deleting import evidence.
begin;

do $$
begin
  if exists (
    select 1 from public.data_import_row_outcomes
    where error_code like '%,%'
  ) then
    raise exception 'atomic import plan rollback is unsafe after multi-disposition evidence exists';
  end if;
end;
$$;

revoke execute on function public.apply_contact_import_plan(
  uuid,uuid,text,text,text,text,text,jsonb,uuid,integer,
  timestamptz,timestamptz,uuid
) from authenticated;

alter table public.data_import_row_outcomes
  drop constraint data_import_row_outcomes_error_code_check;
alter table public.data_import_row_outcomes
  add constraint data_import_row_outcomes_error_code_check
  check (error_code is null or error_code ~ '^[a-z][a-z0-9_.-]{1,79}$');

commit;
