-- Enrich unmatched Mailchimp review records with provider merge fields.
-- Existing CRM values and human corrections always win.
begin;

-- Preserve the prior implementation for an exact operational rollback.
alter function public.quarantine_mailchimp_identity_review(
  uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz
) rename to quarantine_mailchimp_identity_review_0012;

-- Keep one durable review item per selected audience member across baseline,
-- webhook, retry, and periodic reconciliation runs. Older run-scoped duplicates
-- are archived, never deleted, so their evidence remains recoverable.
create function public.quarantine_mailchimp_identity_review(
  target_workspace_id uuid,
  target_connection_id uuid,
  target_binding_id uuid,
  target_member_external_id text,
  target_subscriber_hash text,
  target_normalized_email text,
  target_review_reason text,
  target_source_key_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text;
  member_external_id_hash text;
  stable_identity_hash text;
  external_identity text;
  intake_key text;
  request_hash text;
  candidate jsonb;
  reasons jsonb;
  target_record public.incomplete_records%rowtype;
  target_activity public.activity_events%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  actor_membership_id uuid;
  created_record boolean := false;
  archived_duplicate_count integer := 0;
begin
  if target_workspace_id is null or target_connection_id is null
     or target_binding_id is null
     or target_member_external_id is null
     or length(btrim(target_member_external_id)) not between 1 and 128
     or target_member_external_id ~ '[[:cntrl:]]'
     or target_subscriber_hash !~ '^[0-9a-f]{32}$'
     or target_review_reason not in (
       'no-canonical-match','ambiguous-email','archived-email'
     )
     or target_source_key_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null
     or target_occurred_at is null then
    raise exception 'invalid Mailchimp identity quarantine request'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.mailchimp_audience_bindings binding
    where binding.id = target_binding_id
      and binding.workspace_id = target_workspace_id
      and binding.connection_id = target_connection_id
      and binding.replaced_at is null
  ) then
    raise exception 'active selected Mailchimp audience not found'
      using errcode = 'P0002';
  end if;

  normalized_email := public.normalize_contact_email(target_normalized_email);
  if normalized_email is null or encode(
    extensions.digest(pg_catalog.convert_to(normalized_email,'UTF8'),'md5'),
    'hex'
  ) <> target_subscriber_hash then
    raise exception 'Mailchimp quarantine subscriber identity mismatch'
      using errcode = '23514';
  end if;

  select membership.id into actor_membership_id
  from public.workspace_members membership
  where membership.workspace_id = target_workspace_id
    and membership.role = 'owner'
    and membership.status = 'active'
  order by membership.created_at,membership.id
  limit 1;
  if actor_membership_id is null then
    raise exception 'active owner required for Mailchimp quarantine evidence'
      using errcode = '42501';
  end if;

  member_external_id_hash := encode(extensions.digest(
    pg_catalog.convert_to(btrim(target_member_external_id),'UTF8'),'sha256'
  ),'hex');
  external_identity := 'mailchimp-member:' || member_external_id_hash;
  stable_identity_hash := encode(extensions.digest(
    pg_catalog.convert_to(target_binding_id::text || ':' || member_external_id_hash,'UTF8'),
    'sha256'
  ),'hex');
  intake_key := 'mailchimp.identity-review:' || stable_identity_hash;
  candidate := jsonb_build_object(
    'email',normalized_email,'source','other','emailSubscribed',false
  );
  reasons := jsonb_build_array(jsonb_build_object(
    'field','email','code','mailchimp-' || target_review_reason,
    'message',case target_review_reason
      when 'no-canonical-match' then 'Mailchimp email has no canonical CRM contact.'
      when 'ambiguous-email' then 'Mailchimp email matches multiple active CRM contacts.'
      else 'Mailchimp email belongs to an archived CRM identity.'
    end
  ));
  request_hash := encode(extensions.digest(pg_catalog.convert_to(jsonb_build_object(
    'source','mailchimp-live','externalId',external_identity,
    'candidate',candidate,'reasons',reasons
  )::text,'UTF8'),'sha256'),'hex');

  -- Adopt the oldest pending legacy record so the migration does not create a
  -- new card merely to introduce the stable key.
  select record.* into target_record
  from public.incomplete_records record
  where record.workspace_id = target_workspace_id
    and record.source = 'mailchimp-live'
    and record.external_id = external_identity
    and record.status = 'pending'
  order by (record.intake_idempotency_key = intake_key) desc,
           record.created_at,record.id
  limit 1
  for update;

  if found then
    update public.incomplete_records
       set intake_idempotency_key = intake_key,
           intake_request_hash = request_hash,
           validation_reasons = reasons,
           updated_at = target_occurred_at
     where id = target_record.id
    returning * into target_record;

    with archived as (
      update public.incomplete_records duplicate
         set status = 'archived',
             archived_at = target_occurred_at,
             archived_by_membership_id = actor_membership_id,
             archive_reason = 'Duplicate Mailchimp intake consolidated automatically.',
             updated_at = target_occurred_at
       where duplicate.workspace_id = target_workspace_id
         and duplicate.source = 'mailchimp-live'
         and duplicate.external_id = external_identity
         and duplicate.status = 'pending'
         and duplicate.id <> target_record.id
      returning 1
    ) select count(*) into archived_duplicate_count from archived;
  else
    insert into public.incomplete_records (
      workspace_id,source,external_id,candidate,validation_reasons,
      intake_idempotency_key,intake_request_hash,created_at,updated_at
    ) values (
      target_workspace_id,'mailchimp-live',external_identity,candidate,reasons,
      intake_key,request_hash,target_occurred_at,target_occurred_at
    )
    on conflict (workspace_id,intake_idempotency_key)
      where intake_idempotency_key is not null
    do nothing
    returning * into target_record;
    created_record := found;

    if not created_record then
      select record.* into strict target_record
      from public.incomplete_records record
      where record.workspace_id = target_workspace_id
        and record.intake_idempotency_key = intake_key
      for update;
    end if;
  end if;

  insert into public.activity_events (
    workspace_id,type,incomplete_record_id,actor_membership_id,
    occurred_at,idempotency_key
  ) values (
    target_workspace_id,
    'incomplete-record-received'::text::public.crm_activity_event_type_v2,
    target_record.id,actor_membership_id,target_occurred_at,
    'mailchimp.quarantine:' || stable_identity_hash
  ) on conflict (workspace_id,idempotency_key) do nothing
  returning * into target_activity;
  if target_activity.id is null then
    select event.* into strict target_activity from public.activity_events event
    where event.workspace_id = target_workspace_id
      and event.idempotency_key = 'mailchimp.quarantine:' || stable_identity_hash;
  end if;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    reconciliation_result,redacted_metadata,occurred_at
  ) values (
    target_workspace_id,target_connection_id,'mailchimp','sync.reviewed',
    'mailchimp.identity.quarantined:' || stable_identity_hash,
    target_correlation_id,target_review_reason,
    jsonb_build_object(
      'bindingId',target_binding_id,'incompleteRecordId',target_record.id,
      'subscriberHash',target_subscriber_hash,
      'memberExternalIdHash',member_external_id_hash,
      'reviewReason',target_review_reason,
      'duplicatesArchived',archived_duplicate_count
    ),target_occurred_at
  ) on conflict (workspace_id,event_key) do nothing
  returning * into target_receipt;
  if target_receipt.id is null then
    select receipt.* into strict target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id = target_workspace_id
      and receipt.event_key = 'mailchimp.identity.quarantined:' || stable_identity_hash;
  end if;

  return jsonb_build_object(
    'incompleteRecordId',target_record.id,'status',target_record.status,
    'source',target_record.source,'memberExternalIdHash',member_external_id_hash,
    'activityId',target_activity.id,'receipt',to_jsonb(target_receipt),
    'duplicatesArchived',archived_duplicate_count,
    'noOp',not created_record
  );
end;
$$;

revoke all on function public.quarantine_mailchimp_identity_review(
  uuid,uuid,uuid,text,text,text,text,text,uuid,timestamptz
) from public,anon,authenticated,service_role;

create or replace function public.enrich_mailchimp_reconciliation_members(
  target_run_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_page_hash text,
  target_members jsonb,
  target_enriched_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.mailchimp_reconciliation_runs%rowtype;
  target_page public.mailchimp_reconciliation_pages%rowtype;
  target_record public.incomplete_records%rowtype;
  member jsonb;
  item_source_hash text;
  intake_key text;
  first_name text;
  last_name text;
  phone_value text;
  enrichment jsonb;
  enriched_count integer := 0;
begin
  if target_run_id is null or target_worker_id is null
     or target_fencing_token is null
     or target_page_hash !~ '^[0-9a-f]{64}$'
     or target_members is null or jsonb_typeof(target_members) <> 'array'
     or jsonb_array_length(target_members) > 500
     or target_enriched_at is null then
    raise exception 'invalid Mailchimp merge-field enrichment request'
      using errcode = '22023';
  end if;

  select run.* into target_run
  from public.mailchimp_reconciliation_runs run
  where run.id = target_run_id
    and run.state = 'executing'
    and run.lease_owner = target_worker_id
    and run.fencing_token = target_fencing_token
    and run.lease_expires_at > target_enriched_at
  for update;
  if not found then
    raise exception 'active Mailchimp enrichment lease required'
      using errcode = '40001';
  end if;

  select page.* into target_page
  from public.mailchimp_reconciliation_pages page
  where page.run_id = target_run.id
    and page.page_hash = target_page_hash;
  if not found or target_page.item_count <> jsonb_array_length(target_members) then
    raise exception 'persisted Mailchimp reconciliation page required'
      using errcode = '40001';
  end if;

  for member in select value from jsonb_array_elements(target_members)
  loop
    if jsonb_typeof(member) <> 'object'
       or member - array[
         'memberId','normalizedEmail','sourceHash','firstName','lastName','phone'
       ] <> '{}'::jsonb
       or not (member ?& array['memberId','normalizedEmail','sourceHash'])
       or length(btrim(member ->> 'memberId')) not between 1 and 128
       or member ->> 'memberId' ~ '[[:cntrl:]]'
       or (member ->> 'normalizedEmail') is distinct from
         public.normalize_contact_email(member ->> 'normalizedEmail')
       or member ->> 'sourceHash' !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid Mailchimp enrichment member shape'
        using errcode = '22023';
    end if;

    first_name := nullif(btrim(member ->> 'firstName'),'');
    last_name := nullif(btrim(member ->> 'lastName'),'');
    phone_value := nullif(btrim(member ->> 'phone'),'');
    if (first_name is not null and (length(first_name) > 120 or first_name ~ '[[:cntrl:]]'))
       or (last_name is not null and (length(last_name) > 120 or last_name ~ '[[:cntrl:]]'))
       or (phone_value is not null and (length(phone_value) > 64 or phone_value ~ '[[:cntrl:]]')) then
      raise exception 'invalid Mailchimp merge-field value'
        using errcode = '22023';
    end if;
    if first_name is null and last_name is null and phone_value is null then
      continue;
    end if;

    item_source_hash := encode(extensions.digest(
      pg_catalog.convert_to(btrim(member ->> 'memberId'),'UTF8'),'sha256'
    ),'hex');
    intake_key := 'mailchimp-member:' || item_source_hash;

    select record.* into target_record
    from public.incomplete_records record
    where record.workspace_id = target_run.workspace_id
      and record.source = 'mailchimp-live'
      and record.external_id = intake_key
      and record.status = 'pending'
    for update;
    if not found then
      continue;
    end if;

    enrichment := jsonb_strip_nulls(jsonb_build_object(
      'firstName',case when target_record.candidate ? 'firstName' then null else first_name end,
      'lastName',case when target_record.candidate ? 'lastName' then null else last_name end,
      'phone',case when target_record.candidate ? 'phone' then null else phone_value end
    ));
    if enrichment <> '{}'::jsonb then
      update public.incomplete_records
         set candidate = candidate || enrichment,
             updated_at = target_enriched_at
       where id = target_record.id;
      enriched_count := enriched_count + 1;
    end if;
  end loop;

  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_run.workspace_id,target_run.connection_id,'mailchimp','sync.applied',
    'mailchimp.reconciliation.enriched:' || target_page.id::text,
    target_run.correlation_id,target_page.page_hash,
    jsonb_build_object(
      'runId',target_run.id,
      'pageId',target_page.id,
      'recordsEnriched',enriched_count
    ),target_enriched_at
  ) on conflict (workspace_id,event_key) do nothing;

  return jsonb_build_object(
    'runId',target_run.id,
    'pageId',target_page.id,
    'recordsEnriched',enriched_count
  );
end;
$$;

revoke all on function public.enrich_mailchimp_reconciliation_members(
  uuid,uuid,bigint,text,jsonb,timestamptz
) from public,anon,authenticated,service_role;
grant execute on function public.enrich_mailchimp_reconciliation_members(
  uuid,uuid,bigint,text,jsonb,timestamptz
) to service_role;

comment on function public.enrich_mailchimp_reconciliation_members(
  uuid,uuid,bigint,text,jsonb,timestamptz
) is 'Adds bounded Mailchimp merge fields to unmatched pending review records without replacing CRM or human-entered values.';

commit;
