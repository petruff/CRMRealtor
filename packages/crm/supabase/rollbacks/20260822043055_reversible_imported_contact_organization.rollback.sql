-- Pre-activation schema rollback only. Refuse to erase audit evidence.
begin;

do $$
begin
  if exists(select 1 from public.imported_contact_organization_runs) then
    raise exception 'Schema rollback refused: use rollback_imported_contact_organization for applied data.';
  end if;
end;
$$;

drop function if exists public.rollback_imported_contact_organization(uuid,uuid,text,timestamptz);
drop function if exists public.apply_imported_contact_organization(uuid,uuid,text,text,jsonb,timestamptz);
drop table public.imported_contact_organization_items;
drop table public.imported_contact_organization_runs;

commit;
