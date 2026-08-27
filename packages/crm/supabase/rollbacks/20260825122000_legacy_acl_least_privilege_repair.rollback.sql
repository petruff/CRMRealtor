-- Containment rollback for 20260825122000.
-- Do not restore the known broad client privileges. No schema or data was
-- introduced by the forward migration, so safe rollback is to retain the
-- least-privilege boundary and verify that controlled RPCs remain callable.
begin;

-- Security containment rollback: never re-open post-archive evidence writes.
-- This intentionally preserves the corrected trigger semantics while keeping
-- the pre-existing archive/restore and guarded RPC contracts available.
create or replace function public.prepare_incomplete_record_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'new incomplete records must be pending' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.created_at <> old.created_at then
    raise exception 'incomplete record identity is immutable' using errcode = '23514';
  end if;

  if old.status = 'converted' then
    raise exception 'converted incomplete records are immutable' using errcode = '23514';
  elsif old.status = 'archived' then
    if new.status not in ('archived', 'pending') then
      raise exception 'archived incomplete records can only be restored' using errcode = '23514';
    end if;
    if (new.source, new.external_id, new.candidate, new.validation_reasons,
        new.intake_idempotency_key, new.intake_request_hash,
        new.converted_contact_id, new.conversion_action,
        new.conversion_idempotency_key, new.conversion_request_hash,
        new.converted_at, new.converted_by_membership_id)
       is distinct from
       (old.source, old.external_id, old.candidate, old.validation_reasons,
        old.intake_idempotency_key, old.intake_request_hash,
        old.converted_contact_id, old.conversion_action,
        old.conversion_idempotency_key, old.conversion_request_hash,
        old.converted_at, old.converted_by_membership_id) then
      raise exception 'archived incomplete record evidence is immutable' using errcode = '23514';
    end if;
    if new.status = 'archived'
       and (new.archived_at, new.archived_by_membership_id, new.archive_reason)
         is distinct from
         (old.archived_at, old.archived_by_membership_id, old.archive_reason) then
      raise exception 'incomplete record archive evidence is immutable' using errcode = '23514';
    end if;
  elsif old.status = 'pending' and new.status = 'converted' then
    null;
  end if;

  if new.status = 'archived' and old.status <> 'archived' then
    if new.archived_by_membership_id is null or new.archive_reason is null then
      raise exception 'archive actor and reason are required' using errcode = '23514';
    end if;
    perform public.assert_crm_actor_membership(new.archived_by_membership_id,new.workspace_id);
    new.archived_at := coalesce(new.archived_at, now());
  elsif new.status = 'pending' and old.status = 'archived' then
    new.archived_at := null;
    new.archived_by_membership_id := null;
    new.archive_reason := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke insert, update, delete on table public.incomplete_records
  from public, anon, authenticated;
revoke update on table public.notes from public, anon, authenticated;
grant select on table public.incomplete_records to authenticated;
grant update (
  status,
  archived_at,
  archived_by_membership_id,
  archive_reason,
  updated_at
) on table public.incomplete_records to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.incomplete_records', 'INSERT')
     or has_table_privilege('authenticated', 'public.incomplete_records', 'UPDATE')
     or has_table_privilege('authenticated', 'public.incomplete_records', 'DELETE')
     or has_table_privilege('anon', 'public.incomplete_records', 'INSERT')
     or has_table_privilege('anon', 'public.incomplete_records', 'UPDATE')
     or has_table_privilege('anon', 'public.incomplete_records', 'DELETE')
     or has_table_privilege('authenticated', 'public.notes', 'UPDATE')
     or has_table_privilege('anon', 'public.notes', 'UPDATE') then
    raise exception 'containment rollback must not restore unsafe client table privileges';
  end if;

  if not has_column_privilege('authenticated', 'public.incomplete_records', 'status', 'UPDATE')
     or has_column_privilege('authenticated', 'public.incomplete_records', 'candidate', 'UPDATE')
     or has_column_privilege('authenticated', 'public.incomplete_records', 'intake_request_hash', 'UPDATE') then
    raise exception 'containment rollback lost the narrow lifecycle boundary';
  end if;

  if not (select prosecdef from pg_proc
          where oid = 'public.prepare_incomplete_record_write()'::regprocedure) then
    raise exception 'containment rollback lost the archive evidence guard';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.create_incomplete_record(uuid,text,text,jsonb,jsonb,text,uuid)',
      'EXECUTE'
    )
     or not has_function_privilege(
      'authenticated',
      'public.convert_incomplete_record(uuid,jsonb,jsonb,text,uuid,timestamptz)',
      'EXECUTE'
    )
     or not has_function_privilege(
      'authenticated',
      'public.archive_contact_note(uuid,text,uuid,timestamptz)',
      'EXECUTE'
    )
     or not has_function_privilege(
      'authenticated',
      'public.restore_contact_note(uuid,uuid,timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'controlled mutation RPC access is missing';
  end if;
end;
$$;

commit;
