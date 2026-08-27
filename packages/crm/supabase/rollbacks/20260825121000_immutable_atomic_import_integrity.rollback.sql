-- Emergency containment rollback for Story 6.11.
-- Never delete contacts or receipts and never restore mutable evidence grants.
-- This disables the affected write RPCs while preserving immutable evidence,
-- DNC-safe defaults, identity locks and all transition history.
begin;

revoke execute on function public.apply_contact_import_group(
  uuid,uuid,text,text,jsonb,timestamptz
) from authenticated, service_role;
revoke execute on function public.record_data_import_run(
  uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,
  jsonb,jsonb,timestamptz,timestamptz,uuid
) from authenticated;
revoke execute on function public.begin_contact_intake_receipt(
  uuid,uuid,text,text,uuid,timestamptz
) from authenticated;
revoke execute on function public.finalize_contact_intake_receipt(
  uuid,uuid,text,text,integer,jsonb,uuid,timestamptz
) from authenticated;
revoke execute on function public.execute_operational_contacts_api(
  text,text,text,jsonb,text,uuid,timestamptz
) from service_role;

do $$
begin
  if has_table_privilege('authenticated','public.contact_intake_receipts','UPDATE')
     or has_table_privilege('authenticated','public.contact_intake_receipts','DELETE')
     or has_table_privilege('authenticated','public.contact_intake_receipts','TRUNCATE') then
    raise exception 'containment failed: evidence mutation privilege remains';
  end if;
end;
$$;

commit;
