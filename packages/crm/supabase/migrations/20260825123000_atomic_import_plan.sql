-- Story 6.11 critical repair: execute the complete ordered import plan and
-- persist its terminal aggregate evidence in the same database transaction.
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

create or replace function public.apply_contact_import_plan(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_source text,
  target_format text,
  target_file_hash text,
  target_ordered_plan jsonb,
  target_mapping_profile_id uuid,
  target_mapping_version integer,
  target_started_at timestamptz,
  target_completed_at timestamptz,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.workspace_members%rowtype;
  compatibility_owner_id uuid;
  existing_receipt public.contact_intake_receipts%rowtype;
  existing_run public.data_import_runs%rowtype;
  recorded_run public.data_import_runs%rowtype;
  plan_row jsonb;
  safe_group_plan jsonb;
  group_result jsonb;
  incomplete_record public.incomplete_records%rowtype;
  row_outcome jsonb;
  row_outcomes jsonb := '[]'::jsonb;
  contact_ids_by_row jsonb := '{}'::jsonb;
  identity_key text;
  previous_row_number integer := 0;
  row_number integer;
  target_row_number integer;
  row_kind text;
  row_error_code text;
  has_dnc boolean;
  safe_points jsonb;
  plan_hash text;
  total_count integer;
  created_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
  rejected_count integer := 0;
  quarantined_count integer := 0;
  notes_added_count integer := 0;
  aggregate_outcome public.data_operation_outcome;
  aggregate_counts jsonb;
  aggregate_result jsonb;
begin
  actor := public.assert_rich_contact_actor(
    target_actor_membership_id,
    target_workspace_id,
    false
  );

  if target_idempotency_key is null
     or target_idempotency_key !~ '^[A-Za-z0-9:_-]{8,128}$'
     or target_request_hash is null
     or target_request_hash !~ '^[a-f0-9]{64}$'
     or target_source is null
     or target_source !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or target_format is null
     or target_format not in ('csv','vcard','xls','xlsx','numbers','json')
     or target_file_hash is null
     or target_file_hash !~ '^[a-f0-9]{64}$'
     or target_ordered_plan is null
     or jsonb_typeof(target_ordered_plan) <> 'array'
     or jsonb_array_length(target_ordered_plan) > 5000
     or target_started_at is null
     or target_completed_at is null
     or target_completed_at < target_started_at
     or target_correlation_id is null
     or (target_mapping_profile_id is null) <> (target_mapping_version is null)
     or (target_mapping_version is not null and target_mapping_version < 1) then
    raise exception 'complete contact import plan is invalid or exceeds a bound'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'omnix:contact-import-plan:' || target_workspace_id::text || ':' || target_idempotency_key,
    0
  ));

  plan_hash := encode(extensions.digest(
    pg_catalog.convert_to(target_ordered_plan::text,'UTF8'),
    'sha256'
  ),'hex');

  select receipt.* into existing_receipt
  from public.contact_intake_receipts receipt
  where receipt.workspace_id = target_workspace_id
    and receipt.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_receipt.request_hash <> target_request_hash
       or existing_receipt.status_code <> 200
       or jsonb_typeof(existing_receipt.response_json) <> 'object'
       or existing_receipt.response_json->>'state' <> 'recorded'
       or existing_receipt.response_json->>'runId' is null
       or existing_receipt.response_json->>'planHash' <> plan_hash then
      raise exception 'complete import plan replay conflicts with immutable evidence'
        using errcode = '23505';
    end if;
    select run.* into existing_run
    from public.data_import_runs run
    where run.workspace_id = target_workspace_id
      and run.id = (existing_receipt.response_json->>'runId')::uuid
      and run.idempotency_key = target_idempotency_key;
    if not found then
      raise exception 'complete import plan aggregate evidence is incomplete'
        using errcode = '55000';
    end if;
    if existing_run.actor_membership_id <> target_actor_membership_id
       or existing_run.mapping_profile_id is distinct from target_mapping_profile_id
       or existing_run.mapping_version is distinct from target_mapping_version
       or existing_run.source <> target_source
       or existing_run.format <> target_format
       or existing_run.file_hash <> target_file_hash
       or existing_run.total_rows <> jsonb_array_length(target_ordered_plan)
       or existing_run.started_at <> target_started_at
       or existing_run.completed_at <> target_completed_at
       or existing_run.correlation_id <> target_correlation_id then
      raise exception 'complete import plan replay metadata conflicts with immutable evidence'
        using errcode = '23505';
    end if;
    return existing_receipt.response_json || jsonb_build_object('noOp', true);
  end if;

  if exists (
    select 1 from public.data_import_runs run
    where run.workspace_id = target_workspace_id
      and run.idempotency_key = target_idempotency_key
  ) then
    raise exception 'complete import plan is missing its exact aggregate receipt'
      using errcode = '23505';
  end if;

  total_count := jsonb_array_length(target_ordered_plan);

  -- Validate the complete sequence before taking identity locks or writing.
  for plan_row in
    select value from jsonb_array_elements(target_ordered_plan)
  loop
    if jsonb_typeof(plan_row) <> 'object'
       or not plan_row ? 'rowNumber'
       or not plan_row ? 'kind' then
      raise exception 'ordered import row is invalid' using errcode = '23514';
    end if;
    begin
      row_number := (plan_row->>'rowNumber')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'ordered import row number is invalid' using errcode = '23514';
    end;
    if row_number <= previous_row_number or row_number < 1 then
      raise exception 'ordered import rows must be strictly increasing and unique'
        using errcode = '23514';
    end if;
    previous_row_number := row_number;
    row_kind := plan_row->>'kind';
    row_error_code := nullif(plan_row->>'errorCode','');
    if row_error_code is not null and (
      length(row_error_code) > 323
      or row_error_code !~ '^[a-z][a-z0-9_.-]{1,79}(,[a-z][a-z0-9_.-]{1,79}){0,3}$'
    ) then
      raise exception 'ordered import row error code is invalid' using errcode = '23514';
    end if;

    if row_kind = 'apply' then
      if not public.jsonb_object_has_only(plan_row, array[
        'rowNumber','kind','groupIdempotencyKey','requestHash','plan','errorCode'
      ])
         or plan_row->>'groupIdempotencyKey' is null
         or plan_row->>'groupIdempotencyKey' = target_idempotency_key
         or plan_row->>'groupIdempotencyKey' !~ '^[A-Za-z0-9._:-]{8,128}$'
         or plan_row->>'requestHash' is null
         or plan_row->>'requestHash' !~ '^[a-f0-9]{64}$'
         or jsonb_typeof(plan_row->'plan') <> 'object' then
        raise exception 'ordered apply group is invalid' using errcode = '23514';
      end if;
    elsif row_kind = 'quarantine' then
      if not public.jsonb_object_has_only(plan_row, array[
        'rowNumber','kind','source','externalId','candidate','reasons',
        'intakeIdempotencyKey','errorCode'
      ])
         or plan_row->>'source' is null
         or plan_row->>'source' !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
         or jsonb_typeof(plan_row->'candidate') <> 'object'
         or jsonb_typeof(plan_row->'reasons') <> 'array'
         or jsonb_array_length(plan_row->'reasons') < 1
         or plan_row->>'intakeIdempotencyKey' is null
         or length(plan_row->>'intakeIdempotencyKey') not between 1 and 240 then
        raise exception 'ordered quarantine group is invalid' using errcode = '23514';
      end if;
    elsif row_kind = 'reject' then
      if not public.jsonb_object_has_only(plan_row, array['rowNumber','kind','errorCode'])
         or row_error_code is null then
        raise exception 'ordered rejected row is invalid' using errcode = '23514';
      end if;
    elsif row_kind = 'alias' then
      if not public.jsonb_object_has_only(plan_row, array[
        'rowNumber','kind','targetRowNumber','errorCode'
      ]) then
        raise exception 'ordered alias row is invalid' using errcode = '23514';
      end if;
      begin
        target_row_number := (plan_row->>'targetRowNumber')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'ordered alias target is invalid' using errcode = '23514';
      end;
      if target_row_number is null
         or target_row_number < 1 or target_row_number >= row_number then
        raise exception 'ordered alias target must be an earlier row'
          using errcode = '23514';
      end if;
    else
      raise exception 'ordered import row kind is unsupported' using errcode = '23514';
    end if;
  end loop;

  -- Lock every identity in global lexical order before the first mutation.
  -- This avoids duplicate active contacts and cross-plan lock inversion.
  for identity_key in
    with apply_rows as (
      select value->'plan' as plan
      from jsonb_array_elements(target_ordered_plan)
      where value->>'kind' = 'apply'
    ), identities as (
      select 'email:' || public.normalize_contact_email(plan#>>'{contact,email}') as key
      from apply_rows where nullif(btrim(plan#>>'{contact,email}'),'') is not null
      union
      select 'phone:' || public.normalize_contact_phone(plan#>>'{contact,phone}')
      from apply_rows where nullif(btrim(plan#>>'{contact,phone}'),'') is not null
      union
      select 'phone:' || public.normalize_contact_phone(plan#>>'{contact,secondaryPhone}')
      from apply_rows where nullif(btrim(plan#>>'{contact,secondaryPhone}'),'') is not null
      union
      select (point.value->>'type') || ':' || (point.value->>'normalizedValue')
      from apply_rows
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(plan->'points') = 'array'
          then plan->'points' else '[]'::jsonb end
      ) as point(value)
      where point.value->>'type' in ('email','phone')
        and nullif(point.value->>'normalizedValue','') is not null
      union
      select 'external:' || (plan#>>'{externalLink,provider}') || ':' ||
        (plan#>>'{externalLink,externalId}')
      from apply_rows
      where jsonb_typeof(plan->'externalLink') = 'object'
        and nullif(plan#>>'{externalLink,provider}','') is not null
        and nullif(plan#>>'{externalLink,externalId}','') is not null
    )
    select distinct key from identities where nullif(key,'') is not null order by key
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'omnix:contact-import-identity:' || target_workspace_id::text || ':' || identity_key,
      0
    ));
  end loop;

  previous_row_number := 0;
  for plan_row in
    select value from jsonb_array_elements(target_ordered_plan)
  loop
    row_number := (plan_row->>'rowNumber')::integer;
    row_kind := plan_row->>'kind';
    row_error_code := nullif(plan_row->>'errorCode','');

    if row_kind = 'apply' then
      safe_group_plan := plan_row->'plan';
      has_dnc := lower(
        coalesce(safe_group_plan#>>'{sourceProfile,facts}','') || ' ' ||
        coalesce(safe_group_plan#>>'{contact,tags}','')
      ) ~ '(dnc|do[ _-]?not[ _-]?contact|unsubscrib|opt[ _-]?out|suppress)';
      if has_dnc and jsonb_typeof(safe_group_plan->'contact') = 'object' then
        safe_group_plan := jsonb_set(
          safe_group_plan,
          '{contact}',
          (safe_group_plan->'contact') || jsonb_build_object('emailSubscribed',false),
          false
        );
      end if;
      if has_dnc and jsonb_typeof(safe_group_plan->'points') = 'array' then
        select coalesce(jsonb_agg(
          case when point.value->>'type' = 'email'
            then point.value || jsonb_build_object('emailSubscribed',false)
            else point.value end order by point.ordinality
        ),'[]'::jsonb)
        into safe_points
        from jsonb_array_elements(safe_group_plan->'points')
          with ordinality as point(value, ordinality);
        safe_group_plan := jsonb_set(safe_group_plan,'{points}',safe_points,false);
      end if;

      group_result := public.apply_contact_import_group(
        target_workspace_id,
        target_actor_membership_id,
        plan_row->>'groupIdempotencyKey',
        plan_row->>'requestHash',
        safe_group_plan,
        target_completed_at
      );
      if group_result->>'contactId' is null
         or group_result->>'action' not in ('create','update','unchanged')
         or jsonb_typeof(group_result->'notesAdded') <> 'boolean' then
        raise exception 'ordered import group returned an invalid outcome'
          using errcode = '55000';
      end if;

      row_outcome := jsonb_strip_nulls(jsonb_build_object(
        'rowNumber',row_number,
        'outcome',case group_result->>'action'
          when 'create' then 'created'
          when 'update' then 'updated'
          else 'unchanged' end,
        'contactId',group_result->>'contactId',
        'errorCode',row_error_code
      ));
      contact_ids_by_row := contact_ids_by_row ||
        jsonb_build_object(row_number::text,group_result->>'contactId');
      if group_result->>'action' = 'create' then created_count := created_count + 1;
      elsif group_result->>'action' = 'update' then updated_count := updated_count + 1;
      else unchanged_count := unchanged_count + 1;
      end if;
      if (group_result->>'notesAdded')::boolean then
        notes_added_count := notes_added_count + 1;
      end if;

    elsif row_kind = 'quarantine' then
      safe_group_plan := plan_row->'candidate';
      has_dnc := lower(safe_group_plan::text || ' ' || (plan_row->'reasons')::text)
        ~ '(dnc|do[ _-]?not[ _-]?contact|unsubscrib|opt[ _-]?out|suppress)';
      if has_dnc or not safe_group_plan ? 'emailSubscribed' then
        safe_group_plan := safe_group_plan || jsonb_build_object('emailSubscribed',false);
      end if;
      incomplete_record := public.create_incomplete_record(
        target_workspace_id,
        plan_row->>'source',
        nullif(plan_row->>'externalId',''),
        safe_group_plan,
        plan_row->'reasons',
        plan_row->>'intakeIdempotencyKey',
        actor.id
      );
      row_outcome := jsonb_build_object(
        'rowNumber',row_number,
        'outcome','quarantined',
        'incompleteRecordId',incomplete_record.id,
        'errorCode',coalesce(row_error_code,'validation-rejected')
      );
      quarantined_count := quarantined_count + 1;

    elsif row_kind = 'reject' then
      row_outcome := jsonb_build_object(
        'rowNumber',row_number,
        'outcome','rejected',
        'errorCode',row_error_code
      );
      rejected_count := rejected_count + 1;

    else
      target_row_number := (plan_row->>'targetRowNumber')::integer;
      if not contact_ids_by_row ? target_row_number::text then
        raise exception 'ordered alias target did not resolve a contact'
          using errcode = '23514';
      end if;
      row_outcome := jsonb_strip_nulls(jsonb_build_object(
        'rowNumber',row_number,
        'outcome','unchanged',
        'contactId',contact_ids_by_row->>target_row_number::text,
        'errorCode',row_error_code
      ));
      contact_ids_by_row := contact_ids_by_row ||
        jsonb_build_object(row_number::text,contact_ids_by_row->>target_row_number::text);
      unchanged_count := unchanged_count + 1;
    end if;

    row_outcomes := row_outcomes || jsonb_build_array(row_outcome);
    previous_row_number := row_number;
  end loop;

  aggregate_counts := jsonb_build_object(
    'total',total_count,
    'created',created_count,
    'updated',updated_count,
    'unchanged',unchanged_count,
    'rejected',rejected_count,
    'quarantined',quarantined_count,
    'failed',0,
    'notesAdded',notes_added_count
  );
  aggregate_outcome := case
    when rejected_count + quarantined_count > 0 then 'partial'::public.data_operation_outcome
    else 'succeeded'::public.data_operation_outcome
  end;

  recorded_run := public.record_data_import_run(
    target_workspace_id,
    target_actor_membership_id,
    target_mapping_profile_id,
    target_mapping_version,
    target_source,
    target_format,
    target_file_hash,
    target_idempotency_key,
    aggregate_outcome,
    aggregate_counts,
    row_outcomes,
    target_started_at,
    target_completed_at,
    target_correlation_id
  );

  aggregate_result := jsonb_build_object(
    'state','recorded',
    'runId',recorded_run.id,
    'planHash',plan_hash,
    'counts',aggregate_counts,
    'rowOutcomes',row_outcomes,
    'noOp',false
  );

  select membership.user_id into strict compatibility_owner_id
  from public.workspace_members membership
  where membership.workspace_id = target_workspace_id
    and membership.role = 'owner'
    and membership.status = 'active';

  insert into public.contact_intake_receipts(
    owner_id,workspace_id,idempotency_key,request_hash,
    status_code,response_json,created_at
  ) values (
    compatibility_owner_id,target_workspace_id,target_idempotency_key,
    target_request_hash,200,aggregate_result,target_completed_at
  );

  return aggregate_result;
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

comment on function public.apply_contact_import_plan(
  uuid,uuid,text,text,text,text,text,jsonb,uuid,integer,
  timestamptz,timestamptz,uuid
) is 'Applies one complete bounded ordered contact import plan and records its immutable terminal aggregate receipt in the same transaction.';

commit;
