-- Story 6.11: least-privilege import evidence, controlled receipt transitions,
-- identity serialization and deny-by-default messaging consent.
-- Existing contacts and evidence are preserved without backfill mutation.
begin;

alter table public.contacts alter column email_subscribed set default false;
alter table public.contact_points alter column email_subscribed set default false;

create or replace function public.default_contact_point_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type = 'phone' then
    new.email_subscribed := null;
  elsif tg_op = 'INSERT' and new.email_subscribed is null then
    new.email_subscribed := false;
  end if;
  return new;
end;
$$;

drop trigger if exists contact_points_consent_default on public.contact_points;
create trigger contact_points_consent_default
before insert or update on public.contact_points
for each row execute function public.default_contact_point_consent();

create or replace function public.incomplete_candidate_contact_input(target_candidate jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  key_name text;
  result jsonb := jsonb_build_object(
    'firstName', coalesce(target_candidate->>'firstName', ''),
    'lastName', coalesce(target_candidate->>'lastName', ''),
    'leadType', coalesce(target_candidate->>'leadType', 'warm'),
    'relationship', coalesce(target_candidate->>'relationship', 'lead'),
    'intent', coalesce(target_candidate->>'intent', 'unknown'),
    'source', coalesce(target_candidate->>'source', 'other'),
    'pipelineStage', coalesce(target_candidate->>'pipelineStage', 'new'),
    'tags', coalesce(target_candidate->'tags', '[]'::jsonb),
    'emailSubscribed', coalesce((target_candidate->>'emailSubscribed')::boolean, false),
    'touchDateOverridden', false
  );
begin
  foreach key_name in array array[
    'preferredName', 'phone', 'secondaryPhone', 'email', 'mailingAddress',
    'city', 'state', 'postalCode', 'birthdate', 'homePurchaseDate'
  ] loop
    if target_candidate ? key_name then
      result := result || jsonb_build_object(key_name, target_candidate->key_name);
    end if;
  end loop;
  return result;
exception when others then
  return null;
end;
$$;

-- Keep the original operational implementation private and make omitted
-- consent explicit before either direct create or webhook intake reaches it.
alter function public.execute_operational_contacts_api(
  text,text,text,jsonb,text,uuid,timestamptz
) rename to execute_operational_contacts_api_v1;
revoke all on function public.execute_operational_contacts_api_v1(
  text,text,text,jsonb,text,uuid,timestamptz
) from public, anon, authenticated, service_role;

create function public.execute_operational_contacts_api(
  target_prefix text,
  target_verifier text,
  target_action text,
  target_payload jsonb,
  target_idempotency_hash text,
  target_correlation_id uuid,
  target_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_payload jsonb := target_payload;
begin
  if target_action = 'contacts.create'
     and jsonb_typeof(target_payload) = 'object'
     and not target_payload ? 'emailSubscribed' then
    safe_payload := target_payload || jsonb_build_object('emailSubscribed', false);
  elsif target_action = 'intake.create'
     and jsonb_typeof(target_payload->'candidate') = 'object'
     and not (target_payload->'candidate') ? 'emailSubscribed' then
    safe_payload := jsonb_set(
      target_payload,
      '{candidate}',
      (target_payload->'candidate') || jsonb_build_object('emailSubscribed', false),
      false
    );
  end if;

  return public.execute_operational_contacts_api_v1(
    target_prefix, target_verifier, target_action, safe_payload,
    target_idempotency_hash, target_correlation_id, target_now
  );
end;
$$;

revoke all on function public.execute_operational_contacts_api(
  text,text,text,jsonb,text,uuid,timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.execute_operational_contacts_api(
  text,text,text,jsonb,text,uuid,timestamptz
) to service_role;

-- Serialize each idempotency key and every normalized external/email/phone
-- identity before the legacy atomic group implementation can write.
alter function public.apply_contact_import_group(
  uuid,uuid,text,text,jsonb,timestamptz
) rename to apply_contact_import_group_v3;
revoke all on function public.apply_contact_import_group_v3(
  uuid,uuid,text,text,jsonb,timestamptz
) from public, anon, authenticated, service_role;

create function public.apply_contact_import_group(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_group_idempotency_key text,
  target_request_hash text,
  target_plan jsonb,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_plan jsonb := target_plan;
  source_facts jsonb;
  has_dnc boolean := false;
  safe_points jsonb;
  identity_key text;
  identity_keys text[] := array[]::text[];
  email_values text[] := array[]::text[];
  phone_values text[] := array[]::text[];
  external_provider text;
  external_identity_value text;
  target_contact_id uuid;
  conflicting_contact_ids uuid[];
begin
  perform public.assert_rich_contact_actor(
    target_actor_membership_id,
    target_workspace_id,
    false
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'omnix:contact-import-key:' || target_workspace_id::text || ':' || target_group_idempotency_key,
    0
  ));

  if jsonb_typeof(target_plan#>'{sourceProfile,facts}') = 'array' then
    source_facts := target_plan#>'{sourceProfile,facts}';
    select exists (
      select 1
      from jsonb_array_elements(source_facts) fact
      where lower(
        coalesce(fact->>'key','') || ' ' ||
        coalesce(fact->>'label','') || ' ' ||
        coalesce(fact->'value' #>> '{}','')
      ) ~ '(dnc|do[ _-]?not[ _-]?contact|unsubscrib|opt[ _-]?out)'
    ) into has_dnc;
  end if;

  if jsonb_typeof(target_plan->'contact') = 'object' then
    if target_plan->>'action' = 'create'
       and not (target_plan->'contact') ? 'emailSubscribed' then
      safe_plan := jsonb_set(
        safe_plan,
        '{contact}',
        (safe_plan->'contact') || jsonb_build_object('emailSubscribed', false),
        false
      );
    end if;
    if has_dnc then
      safe_plan := jsonb_set(
        safe_plan,
        '{contact}',
        (safe_plan->'contact') || jsonb_build_object('emailSubscribed', false),
        false
      );
    end if;
  end if;

  if jsonb_typeof(target_plan->'points') = 'array' then
    select coalesce(jsonb_agg(
      case
        when point.value->>'type' = 'email'
             and (has_dnc or not point.value ? 'emailSubscribed')
          then point.value || jsonb_build_object('emailSubscribed', false)
        else point.value
      end order by point.ordinality
    ), '[]'::jsonb)
    into safe_points
    from jsonb_array_elements(target_plan->'points')
      with ordinality as point(value, ordinality);
    safe_plan := jsonb_set(safe_plan, '{points}', safe_points, false);
  end if;

  if safe_plan->>'action' in ('update','unchanged')
     and safe_plan->>'contactId' ~* '^[0-9a-f-]{36}$' then
    target_contact_id := (safe_plan->>'contactId')::uuid;
  end if;

  if nullif(btrim(safe_plan#>>'{contact,email}'),'') is not null then
    email_values := array_append(
      email_values,
      public.normalize_contact_email(safe_plan#>>'{contact,email}')
    );
  end if;
  if nullif(btrim(safe_plan#>>'{contact,phone}'),'') is not null then
    phone_values := array_append(
      phone_values,
      public.normalize_contact_phone(safe_plan#>>'{contact,phone}')
    );
  end if;
  if nullif(btrim(safe_plan#>>'{contact,secondaryPhone}'),'') is not null then
    phone_values := array_append(
      phone_values,
      public.normalize_contact_phone(safe_plan#>>'{contact,secondaryPhone}')
    );
  end if;

  if jsonb_typeof(safe_plan->'points') = 'array' then
    select coalesce(array_agg(distinct point->>'normalizedValue'), '{}')
      into email_values
    from jsonb_array_elements(safe_plan->'points') point
    where point->>'type' = 'email'
      and nullif(point->>'normalizedValue','') is not null
      and not (point->>'normalizedValue' = any(email_values));
    email_values := email_values || coalesce(array[
      nullif(public.normalize_contact_email(safe_plan#>>'{contact,email}'),'')
    ]::text[], '{}');

    select coalesce(array_agg(distinct point->>'normalizedValue'), '{}')
      into phone_values
    from jsonb_array_elements(safe_plan->'points') point
    where point->>'type' = 'phone'
      and nullif(point->>'normalizedValue','') is not null
      and not (point->>'normalizedValue' = any(phone_values));
    phone_values := phone_values || coalesce(array[
      nullif(public.normalize_contact_phone(safe_plan#>>'{contact,phone}'),''),
      nullif(public.normalize_contact_phone(safe_plan#>>'{contact,secondaryPhone}'),'')
    ]::text[], '{}');
  end if;

  email_values := array(select distinct value from unnest(email_values) value where value is not null order by value);
  phone_values := array(select distinct value from unnest(phone_values) value where value is not null order by value);

  if jsonb_typeof(safe_plan->'externalLink') = 'object' then
    external_provider := safe_plan#>>'{externalLink,provider}';
    external_identity_value := safe_plan#>>'{externalLink,externalId}';
  end if;

  select coalesce(array_agg(key order by key), '{}') into identity_keys
  from (
    select 'email:' || value as key from unnest(email_values) value
    union
    select 'phone:' || value as key from unnest(phone_values) value
    union
    select 'external:' || external_provider || ':' || external_identity_value
      where external_provider is not null and external_identity_value is not null
  ) identities;

  foreach identity_key in array identity_keys loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'omnix:contact-import-identity:' || target_workspace_id::text || ':' || identity_key,
      0
    ));
  end loop;

  select array_agg(distinct matched.contact_id order by matched.contact_id)
  into conflicting_contact_ids
  from (
    select point.contact_id
    from public.contact_points point
    where point.workspace_id = target_workspace_id
      and point.archived_at is null
      and ((point.type = 'email' and point.normalized_value = any(email_values))
        or (point.type = 'phone' and point.normalized_value = any(phone_values)))
    union all
    select link.contact_id
    from public.contact_external_links link
    where link.workspace_id = target_workspace_id
      and link.provider = external_provider
      and link.external_id = external_identity_value
  ) matched;

  if coalesce(cardinality(conflicting_contact_ids), 0) > 0
     and (
       safe_plan->>'action' = 'create'
       or exists (
         select 1 from unnest(conflicting_contact_ids) matched_id
         where matched_id <> target_contact_id
       )
     ) then
    raise exception 'contact import identity changed; resolve and retry'
      using errcode = '40001';
  end if;

  return public.apply_contact_import_group_v3(
    target_workspace_id,
    target_actor_membership_id,
    target_group_idempotency_key,
    target_request_hash,
    safe_plan,
    target_occurred_at
  );
end;
$$;

revoke all on function public.apply_contact_import_group(
  uuid,uuid,text,text,jsonb,timestamptz
) from public, anon;
grant execute on function public.apply_contact_import_group(
  uuid,uuid,text,text,jsonb,timestamptz
) to authenticated, service_role;

-- Serialize and validate terminal import summaries. The underlying v1 RPC is
-- private so divergent replay cannot bypass the complete comparison.
alter function public.record_data_import_run(
  uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,
  jsonb,jsonb,timestamptz,timestamptz,uuid
) rename to record_data_import_run_v1;
revoke all on function public.record_data_import_run_v1(
  uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,
  jsonb,jsonb,timestamptz,timestamptz,uuid
) from public, anon, authenticated, service_role;

create function public.record_data_import_run(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_mapping_profile_id uuid,
  target_mapping_version integer,
  target_source text,
  target_format text,
  target_file_hash text,
  target_idempotency_key text,
  target_outcome public.data_operation_outcome,
  target_counts jsonb,
  target_rows jsonb,
  target_started_at timestamptz,
  target_completed_at timestamptz,
  target_correlation_id uuid
)
returns public.data_import_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded public.data_import_runs%rowtype;
  persisted_rows jsonb;
  expected_rows jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'omnix:data-import-run:' || target_workspace_id::text || ':' || target_idempotency_key,
    0
  ));

  if jsonb_typeof(target_counts) <> 'object'
     or target_counts - array['total','created','updated','unchanged','rejected','quarantined','failed','notesAdded'] <> '{}'::jsonb
     or jsonb_typeof(target_rows) <> 'array'
     or jsonb_array_length(target_rows) > 5000
     or target_completed_at < target_started_at then
    raise exception 'invalid terminal import receipt' using errcode = '23514';
  end if;

  recorded := public.record_data_import_run_v1(
    target_workspace_id,target_actor_membership_id,target_mapping_profile_id,
    target_mapping_version,target_source,target_format,target_file_hash,
    target_idempotency_key,target_outcome,target_counts,target_rows,
    target_started_at,target_completed_at,target_correlation_id
  );

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'rowNumber', outcome.row_number,
    'outcome', outcome.outcome,
    'contactId', outcome.contact_id,
    'incompleteRecordId', outcome.incomplete_record_id,
    'errorCode', outcome.error_code
  )) order by outcome.row_number), '[]'::jsonb)
  into persisted_rows
  from public.data_import_row_outcomes outcome
  where outcome.import_run_id = recorded.id
    and outcome.workspace_id = target_workspace_id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'rowNumber', (row_item->>'rowNumber')::integer,
    'outcome', row_item->>'outcome',
    'contactId', nullif(row_item->>'contactId','')::uuid,
    'incompleteRecordId', nullif(row_item->>'incompleteRecordId','')::uuid,
    'errorCode', nullif(row_item->>'errorCode','')
  )) order by (row_item->>'rowNumber')::integer), '[]'::jsonb)
  into expected_rows
  from jsonb_array_elements(target_rows) row_item;

  if recorded.actor_membership_id <> target_actor_membership_id
     or recorded.mapping_profile_id is distinct from target_mapping_profile_id
     or recorded.mapping_version is distinct from target_mapping_version
     or recorded.source <> target_source
     or recorded.format <> target_format
     or recorded.file_hash <> target_file_hash
     or recorded.outcome <> target_outcome
     or recorded.total_rows <> coalesce((target_counts->>'total')::integer,0)
     or recorded.created_count <> coalesce((target_counts->>'created')::integer,0)
     or recorded.updated_count <> coalesce((target_counts->>'updated')::integer,0)
     or recorded.unchanged_count <> coalesce((target_counts->>'unchanged')::integer,0)
     or recorded.rejected_count <> coalesce((target_counts->>'rejected')::integer,0)
     or recorded.quarantined_count <> coalesce((target_counts->>'quarantined')::integer,0)
     or recorded.failed_count <> coalesce((target_counts->>'failed')::integer,0)
     or recorded.started_at <> target_started_at
     or recorded.completed_at <> target_completed_at
     or recorded.correlation_id <> target_correlation_id
     or persisted_rows <> expected_rows then
    raise exception 'import terminal receipt replay conflicts with immutable evidence'
      using errcode = '23505';
  end if;

  return recorded;
end;
$$;

revoke all on function public.record_data_import_run(
  uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,
  jsonb,jsonb,timestamptz,timestamptz,uuid
) from public, anon, service_role;
grant execute on function public.record_data_import_run(
  uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,
  jsonb,jsonb,timestamptz,timestamptz,uuid
) to authenticated;

-- Existing terminal row receipts stay valid. New 102 placeholders are allowed
-- only through begin_contact_intake_receipt and may transition exactly once.
alter table public.contact_intake_receipts
  drop constraint contact_intake_receipts_status_code_check;
alter table public.contact_intake_receipts
  add constraint contact_intake_receipts_status_code_check
  check (status_code = 102 or status_code between 200 and 599);

create table public.contact_intake_receipt_transition_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  receipt_id uuid not null references public.contact_intake_receipts(id) on delete restrict,
  actor_membership_id uuid not null,
  action text not null check (action in ('placeholder-created','terminal-finalized')),
  correlation_id uuid not null,
  created_at timestamptz not null,
  foreign key (actor_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  unique (receipt_id, action)
);

alter table public.contact_intake_receipt_transition_events enable row level security;
alter table public.contact_intake_receipt_transition_events force row level security;
create policy contact_intake_receipt_transition_member_read
on public.contact_intake_receipt_transition_events for select to authenticated
using (public.has_workspace_access(workspace_id));

create or replace function public.guard_contact_intake_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'contact intake receipts are immutable' using errcode = '55000';
  end if;
  if old.status_code <> 102
     or new.status_code not between 200 and 599
     or current_setting('omnix.contact_receipt_finalize', true) <> 'allowed'
     or new.id <> old.id
     or new.workspace_id <> old.workspace_id
     or new.owner_id <> old.owner_id
     or new.idempotency_key <> old.idempotency_key
     or new.request_hash <> old.request_hash
     or new.created_at <> old.created_at then
    raise exception 'contact intake receipt transition is not allowed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists contact_intake_receipts_immutable on public.contact_intake_receipts;
create trigger contact_intake_receipts_immutable
before update or delete on public.contact_intake_receipts
for each row execute function public.guard_contact_intake_receipt_mutation();

create or replace function public.begin_contact_intake_receipt(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_user_id uuid;
  receipt public.contact_intake_receipts%rowtype;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'omnix:contact-intake-receipt:' || target_workspace_id::text || ':' || target_idempotency_key,
    0
  ));
  select membership.user_id into strict owner_user_id
  from public.workspace_members membership
  where membership.workspace_id=target_workspace_id
    and membership.role='owner' and membership.status='active';

  select existing.* into receipt
  from public.contact_intake_receipts existing
  where existing.workspace_id=target_workspace_id
    and existing.idempotency_key=target_idempotency_key;
  if found then
    if receipt.request_hash<>target_request_hash then
      raise exception 'contact intake receipt replay conflicts' using errcode='23505';
    end if;
    return jsonb_build_object(
      'receiptId',receipt.id,
      'state',case when receipt.status_code=102 then 'pending' else 'terminal' end,
      'noOp',true
    );
  end if;

  insert into public.contact_intake_receipts(
    owner_id,workspace_id,idempotency_key,request_hash,status_code,response_json,created_at
  ) values (
    owner_user_id,target_workspace_id,target_idempotency_key,target_request_hash,
    102,jsonb_build_object('state','pending'),target_occurred_at
  ) returning * into receipt;
  insert into public.contact_intake_receipt_transition_events(
    workspace_id,receipt_id,actor_membership_id,action,correlation_id,created_at
  ) values (
    target_workspace_id,receipt.id,target_actor_membership_id,
    'placeholder-created',target_correlation_id,target_occurred_at
  );
  return jsonb_build_object('receiptId',receipt.id,'state','pending','noOp',false);
end;
$$;

create or replace function public.finalize_contact_intake_receipt(
  target_workspace_id uuid,
  target_actor_membership_id uuid,
  target_idempotency_key text,
  target_request_hash text,
  target_status_code integer,
  target_response_json jsonb,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt public.contact_intake_receipts%rowtype;
begin
  perform public.assert_crm_actor_membership(target_actor_membership_id,target_workspace_id);
  if target_status_code not between 200 and 599
     or jsonb_typeof(target_response_json)<>'object' then
    raise exception 'invalid terminal contact intake receipt' using errcode='23514';
  end if;

  select existing.* into strict receipt
  from public.contact_intake_receipts existing
  where existing.workspace_id=target_workspace_id
    and existing.idempotency_key=target_idempotency_key
  for update;

  if receipt.request_hash<>target_request_hash then
    raise exception 'contact intake receipt replay conflicts' using errcode='23505';
  end if;
  if receipt.status_code<>102 then
    if receipt.status_code=target_status_code
       and receipt.response_json=target_response_json then
      return jsonb_build_object('receiptId',receipt.id,'state','terminal','noOp',true);
    end if;
    raise exception 'terminal contact intake receipt is immutable' using errcode='23505';
  end if;
  if not exists (
    select 1 from public.contact_intake_receipt_transition_events event
    where event.receipt_id=receipt.id
      and event.workspace_id=target_workspace_id
      and event.actor_membership_id=target_actor_membership_id
      and event.action='placeholder-created'
  ) then
    raise exception 'receipt finalizer does not own the placeholder' using errcode='42501';
  end if;

  perform set_config('omnix.contact_receipt_finalize','allowed',true);
  update public.contact_intake_receipts
  set status_code=target_status_code,response_json=target_response_json
  where id=receipt.id returning * into receipt;
  insert into public.contact_intake_receipt_transition_events(
    workspace_id,receipt_id,actor_membership_id,action,correlation_id,created_at
  ) values (
    target_workspace_id,receipt.id,target_actor_membership_id,
    'terminal-finalized',target_correlation_id,target_occurred_at
  );
  perform set_config('omnix.contact_receipt_finalize','',true);
  return jsonb_build_object('receiptId',receipt.id,'state','terminal','noOp',false);
end;
$$;

revoke all on table public.contact_intake_receipts
  from public, anon, authenticated;
grant select on table public.contact_intake_receipts to authenticated;
revoke all on table public.contact_intake_receipt_transition_events
  from public, anon, authenticated;
grant select on table public.contact_intake_receipt_transition_events to authenticated;
revoke all on function public.begin_contact_intake_receipt(
  uuid,uuid,text,text,uuid,timestamptz
) from public, anon;
revoke all on function public.finalize_contact_intake_receipt(
  uuid,uuid,text,text,integer,jsonb,uuid,timestamptz
) from public, anon;
grant execute on function public.begin_contact_intake_receipt(
  uuid,uuid,text,text,uuid,timestamptz
) to authenticated;
grant execute on function public.finalize_contact_intake_receipt(
  uuid,uuid,text,text,integer,jsonb,uuid,timestamptz
) to authenticated;

-- Statement-level guards make TRUNCATE fail even for privileged operational
-- mistakes. Authenticated roles also lose UPDATE/DELETE/TRUNCATE explicitly.
create or replace function public.deny_evidence_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'evidence tables cannot be truncated' using errcode='55000';
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_authority_audit_events','activity_events',
    'connector_approval_events','connector_receipt_events',
    'contact_intake_receipts','contact_intake_receipt_transition_events',
    'mailchimp_sync_evidence','texting_consent_events','twilio_callback_events',
    'meta_inbound_events','twilio_real_number_uat_evidence_events',
    'twilio_real_number_uat_evidence_state','meta_asset_subscription_events',
    'data_import_runs','data_import_row_outcomes','data_export_receipts',
    'operational_api_receipts','generic_webhook_receipts',
    'contact_import_source_facts','note_lifecycle_events','contact_merge_events',
    'attention_lifecycle_events'
  ] loop
    execute format(
      'revoke update, delete, truncate on table public.%I from authenticated',
      table_name
    );
    execute format(
      'drop trigger if exists evidence_no_truncate on public.%I',
      table_name
    );
    execute format(
      'create trigger evidence_no_truncate before truncate on public.%I for each statement execute function public.deny_evidence_truncate()',
      table_name
    );
  end loop;
end;
$$;

revoke all on function public.default_contact_point_consent()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_contact_intake_receipt_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.deny_evidence_truncate()
  from public, anon, authenticated, service_role;

comment on function public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz) is
  'Atomic import-group v4: serializes normalized identities, rejects stale create plans and defaults missing or DNC consent to false.';
comment on function public.record_data_import_run(uuid,uuid,uuid,integer,text,text,text,text,public.data_operation_outcome,jsonb,jsonb,timestamptz,timestamptz,uuid) is
  'Atomic immutable terminal import summary with full divergent-replay validation.';
comment on table public.contact_intake_receipt_transition_events is
  'Append-only audit evidence for controlled placeholder-to-terminal receipt transitions.';

commit;
