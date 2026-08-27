-- Story 3.31: accept Apple Numbers evidence and recover a completed import
-- from its immutable atomic row receipts before any replay can mutate data.
begin;

alter table public.data_import_runs
  drop constraint data_import_runs_format_check;
alter table public.data_import_runs
  add constraint data_import_runs_format_check
  check (format in ('csv','vcard','xls','xlsx','numbers','json'));

create or replace function public.prepare_data_import_run(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_source text,
  target_format text,
  target_file_hash text,
  target_idempotency_key text,
  target_expected_rows integer,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  existing_run public.data_import_runs%rowtype;
  recovered_run public.data_import_runs%rowtype;
  group_digest text;
  group_prefix text;
  group_pattern text;
  matching_receipts integer;
  valid_receipts integer;
  distinct_rows integer;
  first_row integer;
  last_row integer;
  started_at timestamptz;
  completed_at timestamptz;
  notes_added integer;
  recovered_rows jsonb;
  recovered_counts jsonb;
begin
  perform public.assert_crm_actor_membership(
    target_actor_membership_id,
    target_workspace_id
  );

  if target_source !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or target_format not in ('csv','vcard','xls','xlsx','numbers','json')
     or target_file_hash !~ '^[a-f0-9]{64}$'
     or target_idempotency_key !~ '^[A-Za-z0-9:_-]{1,160}$'
     or target_expected_rows not between 0 and 5000
     or target_correlation_id is null
     or target_occurred_at is null then
    raise exception 'invalid import receipt preflight' using errcode='23514';
  end if;

  select run.* into existing_run
  from public.data_import_runs run
  where run.workspace_id=target_workspace_id
    and run.idempotency_key=target_idempotency_key;

  if found then
    if existing_run.source<>target_source
       or existing_run.format<>target_format
       or existing_run.file_hash<>target_file_hash
       or existing_run.total_rows<>target_expected_rows then
      raise exception 'import receipt replay conflicts with immutable evidence'
        using errcode='23505';
    end if;

    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'rowNumber', outcome.row_number,
      'outcome', outcome.outcome,
      'contactId', outcome.contact_id,
      'incompleteRecordId', outcome.incomplete_record_id,
      'errorCode', outcome.error_code
    )) order by outcome.row_number),'[]'::jsonb)
    into recovered_rows
    from public.data_import_row_outcomes outcome
    where outcome.workspace_id=target_workspace_id
      and outcome.import_run_id=existing_run.id;

    return jsonb_build_object(
      'state','recorded',
      'runId',existing_run.id,
      'counts',jsonb_build_object(
        'total',existing_run.total_rows,
        'created',existing_run.created_count,
        'updated',existing_run.updated_count,
        'unchanged',existing_run.unchanged_count,
        'rejected',existing_run.rejected_count,
        'quarantined',existing_run.quarantined_count,
        'failed',existing_run.failed_count,
        'notesAdded',0
      ),
      'rowOutcomes',recovered_rows
    );
  end if;

  group_digest:=encode(extensions.digest(
    pg_catalog.convert_to(target_idempotency_key,'UTF8'),
    'sha256'
  ),'hex');
  group_prefix:='import-group:'||group_digest||':';
  group_pattern:='^import-group:'||group_digest||':[1-9][0-9]{0,3}:[a-f0-9]{16}$';

  select count(*) into matching_receipts
  from public.contact_intake_receipts receipt
  where receipt.workspace_id=target_workspace_id
    and left(receipt.idempotency_key,length(group_prefix))=group_prefix;

  if matching_receipts=0 then
    return jsonb_build_object('state','ready');
  end if;

  select
    count(*),
    count(distinct split_part(receipt.idempotency_key,':',3)::integer),
    min(split_part(receipt.idempotency_key,':',3)::integer),
    max(split_part(receipt.idempotency_key,':',3)::integer),
    min(receipt.created_at),
    max(receipt.created_at),
    count(*) filter (where receipt.response_json->>'notesAdded'='true')
  into valid_receipts,distinct_rows,first_row,last_row,started_at,completed_at,notes_added
  from public.contact_intake_receipts receipt
  where receipt.workspace_id=target_workspace_id
    and receipt.idempotency_key ~ group_pattern
    and left(receipt.request_hash,16)=split_part(receipt.idempotency_key,':',4)
    and receipt.status_code=200
    and jsonb_typeof(receipt.response_json)='object'
    and receipt.response_json - 'contactId' - 'action' - 'notesAdded' - 'noOp'='{}'::jsonb
    and receipt.response_json->>'action' in ('create','update','unchanged')
    and receipt.response_json->>'contactId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and jsonb_typeof(receipt.response_json->'notesAdded')='boolean'
    and jsonb_typeof(receipt.response_json->'noOp')='boolean'
    and exists(
      select 1
      from public.contacts contact
      where contact.workspace_id=target_workspace_id
        and contact.id=(receipt.response_json->>'contactId')::uuid
    )
    and exists(
      select 1
      from public.activity_events event
      where event.workspace_id=target_workspace_id
        and event.contact_id=(receipt.response_json->>'contactId')::uuid
        and event.type::text='contact-imported'
        and event.idempotency_key='import:'||group_digest||':imported:'||
          split_part(receipt.idempotency_key,':',3)
    );

  if matching_receipts<>target_expected_rows
     or valid_receipts<>target_expected_rows
     or distinct_rows<>target_expected_rows
     or (target_expected_rows>0 and (first_row<>1 or last_row<>target_expected_rows)) then
    raise exception 'previous import receipt evidence is incomplete; support review required'
      using errcode='P0001';
  end if;

  select
    jsonb_build_object(
      'total',target_expected_rows,
      'created',count(*) filter (where source.action='create'),
      'updated',count(*) filter (where source.action='update'),
      'unchanged',count(*) filter (where source.action='unchanged'),
      'rejected',0,
      'quarantined',0,
      'failed',0,
      'notesAdded',notes_added
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'rowNumber',source.row_number,
      'outcome',case source.action
        when 'create' then 'created'
        when 'update' then 'updated'
        else 'unchanged'
      end,
      'contactId',source.contact_id
    ) order by source.row_number),'[]'::jsonb)
  into recovered_counts,recovered_rows
  from (
    select
      split_part(receipt.idempotency_key,':',3)::integer as row_number,
      receipt.response_json->>'action' as action,
      receipt.response_json->>'contactId' as contact_id
    from public.contact_intake_receipts receipt
    where receipt.workspace_id=target_workspace_id
      and receipt.idempotency_key ~ group_pattern
    order by split_part(receipt.idempotency_key,':',3)::integer
  ) source;

  recovered_run:=public.record_data_import_run(
    target_workspace_id,
    target_actor_membership_id,
    null,
    null,
    target_source,
    target_format,
    target_file_hash,
    target_idempotency_key,
    'succeeded',
    recovered_counts,
    recovered_rows,
    started_at,
    completed_at,
    target_correlation_id
  );

  return jsonb_build_object(
    'state','recovered',
    'runId',recovered_run.id,
    'counts',recovered_counts,
    'rowOutcomes',recovered_rows
  );
end;
$$;

revoke all on function public.prepare_data_import_run(
  uuid,uuid,text,text,text,text,integer,uuid,timestamptz
) from public,anon,authenticated,service_role;
grant execute on function public.prepare_data_import_run(
  uuid,uuid,text,text,text,text,integer,uuid,timestamptz
) to authenticated;

comment on function public.prepare_data_import_run(
  uuid,uuid,text,text,text,text,integer,uuid,timestamptz
) is 'Validates immutable import receipt compatibility before mutation and recovers an exact completed replay from atomic row receipts.';

commit;
