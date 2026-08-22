-- Story 3.7 pre-write rollback only.
-- After any imported fact exists, use PITR or an approved forward migration.
begin;

do $$
begin
  if to_regclass('public.contact_import_source_facts') is not null
    and exists (select 1 from public.contact_import_source_facts) then
    raise exception '0026 rollback is forbidden after source-fact writes; use PITR or forward remediation';
  end if;
end;
$$;

drop function if exists public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz);
alter function public.apply_contact_import_group_v2(uuid,uuid,text,text,jsonb,timestamptz)
  rename to apply_contact_import_group;
revoke all on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz) from public;
grant execute on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz)
  to authenticated, service_role;

drop trigger if exists contact_import_source_facts_immutable on public.contact_import_source_facts;
drop function if exists public.contact_import_source_facts_immutable_guard();
drop policy if exists contact_import_source_facts_member_read on public.contact_import_source_facts;
drop table if exists public.contact_import_source_facts;

commit;
