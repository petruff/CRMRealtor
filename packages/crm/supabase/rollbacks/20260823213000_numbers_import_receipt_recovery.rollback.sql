-- Story 3.31 rollback. Existing Numbers evidence is never deleted.
begin;

drop function if exists public.prepare_data_import_run(
  uuid,uuid,text,text,text,text,integer,uuid,timestamptz
);

do $$
begin
  if not exists(select 1 from public.data_import_runs where format='numbers') then
    alter table public.data_import_runs
      drop constraint data_import_runs_format_check;
    alter table public.data_import_runs
      add constraint data_import_runs_format_check
      check (format in ('csv','vcard','xls','xlsx','json'));
  end if;
end;
$$;

commit;
