-- Read-only Production preflight for Story 3.29.
-- Run with release-operator database authority before deploying application
-- code that depends on the exact contact-merge read/write contract.

do $$
declare
  missing_capabilities text[] := array[]::text[];
begin
  if to_regprocedure('public.resolve_canonical_contact_id(uuid,uuid)') is null then
    missing_capabilities := array_append(missing_capabilities, 'resolve_canonical_contact_id(uuid,uuid)');
  end if;
  if to_regprocedure('public.list_contact_alias_group_ids(uuid,uuid)') is null then
    missing_capabilities := array_append(missing_capabilities, 'list_contact_alias_group_ids(uuid,uuid)');
  end if;
  if to_regprocedure('public.apply_exact_contact_merge(uuid,uuid,text,text,timestamptz)') is null then
    missing_capabilities := array_append(missing_capabilities, 'apply_exact_contact_merge(uuid,uuid,text,text,timestamptz)');
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '0027') then
    missing_capabilities := array_append(missing_capabilities, 'migration 0027');
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '0028') then
    missing_capabilities := array_append(missing_capabilities, 'migration 0028');
  end if;

  if cardinality(missing_capabilities) > 0 then
    raise exception 'Omnix contact-merge preflight failed. Missing: %', array_to_string(missing_capabilities, ', ')
      using errcode = 'P0001';
  end if;
end
$$;

select jsonb_build_object(
  'schemaVersion', 'omnix.contact-merge-preflight.v1',
  'ready', true,
  'migrations', jsonb_build_array('0027', '0028'),
  'capabilities', jsonb_build_array(
    'resolve_canonical_contact_id(uuid,uuid)',
    'list_contact_alias_group_ids(uuid,uuid)',
    'apply_exact_contact_merge(uuid,uuid,text,text,timestamptz)'
  )
) as preflight_receipt;
