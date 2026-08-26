-- Forward repair after Story 6.11 containment. This restores only governed
-- RPC execution and reasserts non-destructive integrity controls.
begin;

alter table public.contacts alter column email_subscribed set default false;
alter table public.contact_points alter column email_subscribed set default false;

revoke insert, update, delete, truncate on table public.contact_intake_receipts
  from authenticated;
grant select on table public.contact_intake_receipts to authenticated;

grant execute on function public.apply_contact_import_group(
  uuid,uuid,text,text,jsonb,timestamptz
) to authenticated, service_role;
grant execute on function public.record_data_import_run(
  uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,
  jsonb,jsonb,timestamptz,timestamptz,uuid
) to authenticated;
grant execute on function public.begin_contact_intake_receipt(
  uuid,uuid,text,text,uuid,timestamptz
) to authenticated;
grant execute on function public.finalize_contact_intake_receipt(
  uuid,uuid,text,text,integer,jsonb,uuid,timestamptz
) to authenticated;
grant execute on function public.execute_operational_contacts_api(
  text,text,text,jsonb,text,uuid,timestamptz
) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.contact_intake_receipts'::regclass
      and tgname='contact_intake_receipts_immutable' and not tgisinternal
  ) then
    raise exception 'forward repair failed: receipt immutability trigger is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.contact_intake_receipts'::regclass
      and tgname='evidence_no_truncate' and not tgisinternal
  ) then
    raise exception 'forward repair failed: receipt truncate guard is missing';
  end if;
end;
$$;

commit;
