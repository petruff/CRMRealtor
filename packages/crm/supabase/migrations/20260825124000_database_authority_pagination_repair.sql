-- Corrective database authority and canonical pagination boundary.
--
-- This migration is forward-only and additive. It:
--   1. binds service-role workspace AI secret reads to the supplied canonical
--      owner identity and active owner membership;
--   2. exposes the exact active support-grant ID without treating support as
--      ownership; and
--   3. provides one workspace-authorized, alias-aware contact page RPC whose
--      page and facet counts share one PostgreSQL statement snapshot; and
--   4. corrects directly related validator volatility metadata and the
--      attention reconciliation text-array initializer reported by db lint.
--
-- ROLLBACK: use the matching containment rollback. It removes only the new
-- pagination/identity contracts, restores the standalone boolean support
-- predicate, and deliberately retains the hardened AI secret-read boundary.

begin;

create extension if not exists unaccent with schema extensions;

-- Date parsing depends on session formatting rules and the Smart List
-- validator calls that parser. Neither routine is safely IMMUTABLE.
alter function public.is_iso_date_value(jsonb) stable;
alter function public.is_valid_smart_list_definition(jsonb) stable;
alter function public.is_valid_incomplete_candidate(jsonb) stable;
alter function public.is_valid_contact_conversion_payload(jsonb,boolean) stable;
alter function public.incomplete_candidate_contact_patch(jsonb,public.contacts) stable;
alter function public.is_valid_incomplete_conversion_plan(jsonb) stable;
-- Membership resolution performs guarded session checks and is intentionally
-- VOLATILE; callers must not advertise a weaker volatility contract.
alter function public.read_twilio_connection_readiness(uuid) volatile;

create or replace function public.assert_canonical_workspace_owner_identity(
  target_workspace_id uuid,
  target_authenticated_user_id uuid,
  target_membership_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_workspace_id is not null
    and target_authenticated_user_id is not null
    and target_membership_id is not null
    and (
      select count(*) = 1
      from public.workspace_members owner_membership
      where owner_membership.workspace_id = target_workspace_id
        and owner_membership.role = 'owner'
        and owner_membership.status = 'active'
    )
    and exists (
      select 1
      from public.workspace_members owner_membership
      where owner_membership.id = target_membership_id
        and owner_membership.workspace_id = target_workspace_id
        and owner_membership.user_id = target_authenticated_user_id
        and owner_membership.role = 'owner'
        and owner_membership.status = 'active'
    );
$$;

create or replace function public.read_workspace_ai_secret_envelope(
  target_workspace_id uuid,
  target_authenticated_user_id uuid,
  target_membership_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  if not public.assert_canonical_workspace_owner_identity(
    target_workspace_id,
    target_authenticated_user_id,
    target_membership_id
  ) then
    raise exception 'active canonical workspace owner identity required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'workspaceId', configuration.workspace_id,
    'provider', configuration.provider,
    'model', configuration.model,
    'enabled', configuration.enabled,
    'dataPolicy', configuration.data_policy,
    'secretVersion', configuration.secret_version,
    'envelope', secret.envelope
  )
  into result
  from public.workspace_ai_configurations configuration
  join connector_private.workspace_ai_secret_envelopes secret using (workspace_id)
  where configuration.workspace_id = target_workspace_id
    and configuration.enabled = true
    and configuration.data_policy = 'paid-private'
    and configuration.secret_version = secret.secret_version;

  return result;
end;
$$;

create or replace function public.resolve_workspace_support_grant_id(
  target_workspace_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select support_grant.id
  from private.workspace_admin_grants support_grant
  join public.workspace_members membership
    on membership.workspace_id = support_grant.workspace_id
   and membership.user_id = support_grant.user_id
  where support_grant.workspace_id = target_workspace_id
    and support_grant.user_id = auth.uid()
    and support_grant.revoked_at is null
    and membership.role = 'assistant'
    and membership.status = 'active'
  order by support_grant.created_at desc, support_grant.id
  limit 1;
$$;

create or replace function public.has_workspace_support_grant(
  target_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.resolve_workspace_support_grant_id(target_workspace_id) is not null;
$$;

create or replace function public.normalize_contact_search_text(target_value text)
returns text
language sql
stable
set search_path = ''
as $$
  select regexp_replace(
    trim(regexp_replace(
      lower(extensions.unaccent(coalesce(target_value, ''))),
      '[^a-z0-9@.+_-]+', ' ', 'g'
    )),
    '[[:space:]]+', ' ', 'g'
  );
$$;

create or replace function public.contact_matches_normalized_query(
  target_contact public.contacts,
  target_normalized_query text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  searchable_values text[];
  haystack text;
  digits text;
  term text;
begin
  if coalesce(target_normalized_query, '') = '' then
    return true;
  end if;

  searchable_values := array[
    trim(concat(coalesce(target_contact.preferred_name, target_contact.first_name), ' ', target_contact.last_name)),
    target_contact.first_name,
    target_contact.preferred_name,
    target_contact.last_name,
    target_contact.email,
    target_contact.phone,
    target_contact.secondary_phone,
    target_contact.city,
    target_contact.postal_code
  ] || coalesce(target_contact.tags, '{}'::text[]);

  haystack := public.normalize_contact_search_text(array_to_string(searchable_values, ' ', ''));
  digits := regexp_replace(array_to_string(searchable_values, ' ', ''), '[^0-9]+', '', 'g');

  foreach term in array string_to_array(target_normalized_query, ' ') loop
    if term ~ '^[0-9]{3,}$' and strpos(digits, term) > 0 then
      continue;
    end if;
    if strpos(haystack, term) = 0 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.contact_matches_smart_list_definition(
  target_contact public.contacts,
  target_definition jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  criterion jsonb;
  criterion_field text;
  criterion_operator text;
  current_text text;
  expected_text text;
  current_number numeric;
  expected_number numeric;
  wanted_tags text[];
  current_tags text[];
  contact_date date;
  enum_value text;
  query_values text[];
begin
  if not public.is_valid_smart_list_definition(target_definition) then
    raise exception 'Smart List definition is invalid' using errcode = '23514';
  end if;

  for criterion in select value from jsonb_array_elements(target_definition->'criteria') loop
    criterion_field := criterion->>'field';
    criterion_operator := criterion->>'operator';

    if criterion_field = 'query' then
      expected_text := public.normalize_contact_search_text(criterion->>'value');
      if criterion_operator = 'contains' then
        if not public.contact_matches_normalized_query(target_contact, expected_text) then
          return false;
        end if;
      else
        query_values := array[
          trim(concat(coalesce(target_contact.preferred_name, target_contact.first_name), ' ', target_contact.last_name)),
          target_contact.first_name,
          target_contact.last_name,
          target_contact.preferred_name,
          target_contact.phone,
          target_contact.secondary_phone,
          target_contact.email,
          target_contact.city,
          target_contact.postal_code
        ] || coalesce(target_contact.tags, '{}'::text[]);
        if not exists (
          select 1 from unnest(query_values) value
          where public.normalize_contact_search_text(value) = expected_text
        ) then
          return false;
        end if;
      end if;
    elsif criterion_field in ('leadType','relationship','intent','source','pipelineStage') then
      enum_value := case criterion_field
        when 'leadType' then target_contact.lead_type::text
        when 'relationship' then target_contact.relationship::text
        when 'intent' then target_contact.intent::text
        when 'source' then target_contact.source::text
        else target_contact.pipeline_stage::text
      end;
      if criterion_operator = 'eq' and enum_value <> criterion->>'value' then
        return false;
      elsif criterion_operator = 'in' and not (criterion->'value' ? enum_value) then
        return false;
      end if;
    elsif criterion_field in ('city','state','postalCode','buyer.timeline','seller.timeline') then
      current_text := public.normalize_contact_search_text(case criterion_field
        when 'city' then target_contact.city
        when 'state' then target_contact.state
        when 'postalCode' then target_contact.postal_code
        when 'buyer.timeline' then target_contact.buyer_criteria->>'timeline'
        else target_contact.seller_criteria->>'timeline'
      end);
      expected_text := public.normalize_contact_search_text(criterion->>'value');
      if criterion_operator = 'eq' and current_text <> expected_text then
        return false;
      elsif criterion_operator = 'contains' and position(expected_text in current_text) = 0 then
        return false;
      end if;
    elsif criterion_field in ('buyer.priceMin','buyer.priceMax') then
      current_number := case criterion_field
        when 'buyer.priceMin' then (target_contact.buyer_criteria->>'priceMin')::numeric
        else (target_contact.buyer_criteria->>'priceMax')::numeric
      end;
      expected_number := (criterion->>'value')::numeric;
      if current_number is null
         or (criterion_operator = 'min' and current_number < expected_number)
         or (criterion_operator = 'max' and current_number > expected_number) then
        return false;
      end if;
    elsif criterion_field = 'tags' then
      select coalesce(array_agg(public.normalize_contact_search_text(value)), '{}'::text[])
      into wanted_tags from jsonb_array_elements_text(criterion->'value') value;
      select coalesce(array_agg(public.normalize_contact_search_text(value)), '{}'::text[])
      into current_tags from unnest(coalesce(target_contact.tags, '{}'::text[])) value;
      if criterion_operator = 'all' and not current_tags @> wanted_tags then
        return false;
      elsif criterion_operator = 'any' and not current_tags && wanted_tags then
        return false;
      end if;
    elsif criterion_field = 'nextTouchAt' then
      contact_date := target_contact.next_touch_at;
      if criterion_operator = 'empty' and contact_date is not null then
        return false;
      elsif criterion_operator <> 'empty' and contact_date is null then
        return false;
      elsif criterion_operator = 'before' and contact_date >= (criterion->>'value')::date then
        return false;
      elsif criterion_operator = 'on' and contact_date <> (criterion->>'value')::date then
        return false;
      elsif criterion_operator = 'after' and contact_date <= (criterion->>'value')::date then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.list_canonical_contact_page(
  target_workspace_id uuid,
  target_scope text default 'leads',
  target_query text default '',
  target_lead_type text default null,
  target_source text default null,
  target_smart_list_id uuid default null,
  target_archived_only boolean default false,
  target_offset integer default 0,
  target_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text;
  smart_definition jsonb;
  smart_sort_field text;
  smart_sort_direction text;
  current_alias_epoch bigint;
  result jsonb;
begin
  if auth.uid() is null or not public.has_workspace_access(target_workspace_id) then
    raise exception 'active workspace access is required' using errcode = '42501';
  end if;
  if target_scope not in ('leads','clients','active-clients','past-clients','needs-review','all') then
    raise exception 'contact scope is invalid' using errcode = '22023';
  end if;
  if target_lead_type is not null and target_lead_type not in ('hot','warm','nurture') then
    raise exception 'contact lead type is invalid' using errcode = '22023';
  end if;
  if target_source is not null and target_source not in (
    'cold-call','open-house','referral','social-media','website','mailer','other'
  ) then
    raise exception 'contact source is invalid' using errcode = '22023';
  end if;
  if target_query is null or length(target_query) > 200 then
    raise exception 'contact search query must be 200 characters or fewer' using errcode = '22023';
  end if;
  if target_offset < 0 or target_limit < 1 or target_limit > 100 then
    raise exception 'contact page bounds are invalid' using errcode = '22023';
  end if;

  normalized_query := public.normalize_contact_search_text(target_query);
  select coalesce(state.alias_epoch, 0)
  into current_alias_epoch
  from public.contact_merge_workspace_state state
  where state.workspace_id = target_workspace_id;
  current_alias_epoch := coalesce(current_alias_epoch, 0);

  if target_smart_list_id is not null and not target_archived_only then
    select smart_list.definition
    into smart_definition
    from public.smart_lists smart_list
    where smart_list.id = target_smart_list_id
      and smart_list.workspace_id = target_workspace_id
      and smart_list.status = 'active';
    if not found then
      raise exception 'active Smart List not found' using errcode = 'P0002';
    end if;
    smart_sort_field := coalesce(smart_definition#>>'{sort,field}', 'priority');
    smart_sort_direction := coalesce(smart_definition#>>'{sort,direction}', 'asc');
  end if;

  with canonical_contacts as materialized (
    select contact
    from public.contacts contact
    where contact.workspace_id = target_workspace_id
      and not exists (
        select 1
        from public.contact_merge_aliases alias
        where alias.workspace_id = target_workspace_id
          and alias.donor_contact_id = contact.id
          and alias.inactive_at is null
      )
  ),
  eligible_contacts as materialized (
    select contact
    from canonical_contacts
    where (target_archived_only and (contact).archived_at is not null)
       or (not target_archived_only and (contact).archived_at is null)
  ),
  ordinary_source as (
    select contact,
      row_number() over (
        order by (contact).next_touch_at asc nulls first, (contact).id asc
      ) as source_position
    from eligible_contacts
    where smart_definition is null
  ),
  smart_source_ranked as (
    select contact,
      row_number() over (order by
        case when smart_sort_field = 'priority' and smart_sort_direction = 'asc'
          then case (contact).lead_type::text when 'hot' then 0 when 'warm' then 1 else 2 end end asc,
        case when smart_sort_field = 'priority' and smart_sort_direction = 'desc'
          then case (contact).lead_type::text when 'hot' then 0 when 'warm' then 1 else 2 end end desc,
        case when smart_sort_field = 'name' and smart_sort_direction = 'asc'
          then public.normalize_contact_search_text(trim(concat(coalesce((contact).preferred_name,(contact).first_name),' ',(contact).last_name))) end asc,
        case when smart_sort_field = 'name' and smart_sort_direction = 'desc'
          then public.normalize_contact_search_text(trim(concat(coalesce((contact).preferred_name,(contact).first_name),' ',(contact).last_name))) end desc,
        case when smart_sort_field = 'nextTouchAt' and smart_sort_direction = 'asc'
          then (contact).next_touch_at end asc nulls last,
        case when smart_sort_field = 'nextTouchAt' and smart_sort_direction = 'desc'
          then (contact).next_touch_at end desc nulls last,
        case when smart_sort_field = 'createdAt' and smart_sort_direction = 'asc'
          then (contact).created_at end asc,
        case when smart_sort_field = 'createdAt' and smart_sort_direction = 'desc'
          then (contact).created_at end desc,
        (contact).id asc
      ) as source_position
    from eligible_contacts
    where smart_definition is not null
      and public.contact_matches_smart_list_definition(contact, smart_definition)
  ),
  source_contacts as materialized (
    select * from ordinary_source
    union all
    select * from smart_source_ranked
  ),
  externally_filtered as materialized (
    select contact, source_position
    from source_contacts
    where (target_lead_type is null or (contact).lead_type::text = target_lead_type)
      and (target_source is null or (contact).source::text = target_source)
      and public.contact_matches_normalized_query(contact, normalized_query)
  ),
  scoped_contacts as materialized (
    select contact, source_position
    from externally_filtered
    where target_archived_only
       or target_scope = 'all'
       or (target_scope = 'leads' and (contact).relationship::text in ('lead','sphere'))
       or (target_scope = 'clients' and (contact).relationship::text in ('active-client','past-client'))
       or (target_scope = 'active-clients' and (contact).relationship::text = 'active-client')
       or (target_scope = 'past-clients' and (contact).relationship::text = 'past-client')
       or (target_scope = 'needs-review' and (contact).qualification_status::text = 'needs-qualification')
  ),
  canonical_counts as (
    select count(*) filter (where (contact).archived_at is null) as active_total
    from canonical_contacts
  ),
  scope_counts as (
    select
      count(*) filter (where (contact).relationship::text in ('lead','sphere')) as leads,
      count(*) filter (where (contact).relationship::text in ('active-client','past-client')) as clients,
      count(*) filter (where (contact).relationship::text = 'active-client') as active_clients,
      count(*) filter (where (contact).relationship::text = 'past-client') as past_clients,
      count(*) filter (where (contact).qualification_status::text = 'needs-qualification') as needs_review,
      count(*) as all_contacts
    from externally_filtered
  ),
  scoped_counts as (
    select
      count(*) as total,
      count(*) filter (where (contact).lead_type::text = 'hot') as hot,
      count(*) filter (where (contact).lead_type::text = 'warm') as warm,
      count(*) filter (where (contact).lead_type::text = 'nurture') as nurture
    from scoped_contacts
  ),
  ordered_contacts as materialized (
    select contact,
      row_number() over (order by
        case (contact).lead_type::text when 'hot' then 0 when 'warm' then 1 else 2 end,
        source_position,
        (contact).id
      ) as final_position
    from scoped_contacts
  ),
  page_rows as (
    select contact, final_position
    from ordered_contacts
    where final_position > target_offset
      and final_position <= target_offset + target_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(page.contact) order by page.final_position)
      from page_rows page
    ), '[]'::jsonb),
    'total', (select total from scoped_counts),
    'activeTotal', (select active_total from canonical_counts),
    'scopeCounts', case when target_archived_only then jsonb_build_object(
      'leads',0,'clients',0,'active-clients',0,'past-clients',0,'needs-review',0,'all',0
    ) else jsonb_build_object(
      'leads',(select leads from scope_counts),
      'clients',(select clients from scope_counts),
      'active-clients',(select active_clients from scope_counts),
      'past-clients',(select past_clients from scope_counts),
      'needs-review',(select needs_review from scope_counts),
      'all',(select all_contacts from scope_counts)
    ) end,
    'leadTypeCounts', jsonb_build_object(
      'hot',(select hot from scoped_counts),
      'warm',(select warm from scoped_counts),
      'nurture',(select nurture from scoped_counts)
    ),
    'offset', target_offset,
    'limit', target_limit,
    'aliasEpoch', current_alias_epoch
  ) into result;

  return result;
end;
$$;

-- Preserve the existing bounded service-only attention workflow while making
-- the empty occurrence-key accumulator explicitly text[]. This is a lint-only
-- body correction; signatures, grants, limits and mutation semantics do not
-- change.
create or replace function public.reconcile_attention_items(
  target_workspace_id uuid,
  target_materializations jsonb,
  target_observed_at timestamptz,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  run_row public.attention_reconciliation_runs%rowtype;
  entry jsonb;
  current_item public.attention_items%rowtype;
  occurrence_keys text[] := '{}'::text[];
  source_count integer;
  materialized integer := 0;
  refreshed integer := 0;
  reopened integer := 0;
  resolved integer := 0;
  previous_state public.attention_state;
  should_reopen boolean;
  subject_uuid uuid;
begin
  if not exists (
    select 1 from public.workspaces where id = target_workspace_id
  ) then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if target_observed_at is null
     or target_idempotency_key !~ '^[A-Za-z0-9._:-]{1,128}$'
     or jsonb_typeof(target_materializations) <> 'array' then
    raise exception 'invalid attention reconciliation request' using errcode = '22023';
  end if;

  source_count := jsonb_array_length(target_materializations);
  if source_count > 500 then
    raise exception 'attention reconciliation exceeds 500 items' using errcode = '22023';
  end if;

  select * into run_row
  from public.attention_reconciliation_runs
  where workspace_id = target_workspace_id
    and idempotency_key = target_idempotency_key;
  if found and run_row.state = 'completed' then
    return jsonb_build_object(
      'runId', run_row.id,
      'noOp', true,
      'materialized', run_row.materialized_count,
      'refreshed', run_row.refreshed_count,
      'reopened', run_row.reopened_count,
      'resolved', run_row.resolved_count
    );
  end if;

  insert into public.attention_reconciliation_runs (
    workspace_id, idempotency_key, state, source_count, started_at
  ) values (
    target_workspace_id, target_idempotency_key, 'running', source_count,
    target_observed_at
  )
  on conflict (workspace_id, idempotency_key)
  do update set updated_at = now()
  returning * into run_row;

  for entry in select value from jsonb_array_elements(target_materializations) loop
    if not (entry ?& array[
      'rule','category','subjectType','occurrenceKey','sourceFingerprint',
      'reason','href','priority','dismissAllowed','evidence'
    ])
       or entry->>'occurrenceKey' !~ '^[A-Za-z0-9._:-]{1,200}$'
       or entry->>'sourceFingerprint' !~ '^[a-f0-9]{64}$'
       or entry->>'priority' not in ('p0','p1','p2','p3','p4')
       or entry->>'subjectType' not in ('contact','task','connection','workspace')
       or jsonb_typeof(entry->'evidence') <> 'array'
       or jsonb_array_length(entry->'evidence') > 20 then
      raise exception 'invalid attention materialization' using errcode = '22023';
    end if;
    if entry->>'occurrenceKey' = any(occurrence_keys) then
      raise exception 'duplicate attention occurrence' using errcode = '22023';
    end if;
    occurrence_keys := array_append(occurrence_keys, entry->>'occurrenceKey');
    subject_uuid := case
      when entry->>'subjectType' = 'workspace' then null
      else (entry->>'subjectId')::uuid
    end;

    if entry->>'subjectType' = 'contact' and not exists (
      select 1 from public.contacts
      where id = subject_uuid and workspace_id = target_workspace_id
    ) then
      raise exception 'attention contact scope mismatch' using errcode = '42501';
    end if;
    if entry->>'subjectType' = 'task' and not exists (
      select 1 from public.tasks
      where id = subject_uuid and workspace_id = target_workspace_id
    ) then
      raise exception 'attention task scope mismatch' using errcode = '42501';
    end if;
    if entry->>'subjectType' = 'connection' and not exists (
      select 1 from public.connector_connections
      where id = subject_uuid and workspace_id = target_workspace_id
    ) then
      raise exception 'attention connection scope mismatch' using errcode = '42501';
    end if;

    select * into current_item
    from public.attention_items
    where workspace_id = target_workspace_id
      and occurrence_key = entry->>'occurrenceKey'
    for update;

    if not found then
      insert into public.attention_items (
        workspace_id, rule, category, subject_type, subject_id, occurrence_key,
        source_fingerprint, reason, href, priority, due_at, enqueued_at,
        last_seen_at, assignee_membership_id, state, item_version,
        dismiss_allowed, state_changed_at, evidence
      ) values (
        target_workspace_id, entry->>'rule', entry->>'category',
        (entry->>'subjectType')::public.attention_subject_type, subject_uuid,
        entry->>'occurrenceKey', entry->>'sourceFingerprint', entry->>'reason',
        entry->>'href', (entry->>'priority')::public.attention_priority,
        nullif(entry->>'dueAt','')::timestamptz, target_observed_at,
        target_observed_at, nullif(entry->>'assigneeMembershipId','')::uuid,
        'open', 1, (entry->>'dismissAllowed')::boolean, target_observed_at,
        entry->'evidence'
      ) returning * into current_item;
      insert into public.attention_lifecycle_events (
        workspace_id, attention_item_id, to_state, actor_kind, reason_code,
        source_fingerprint, idempotency_key, occurred_at
      ) values (
        target_workspace_id, current_item.id, 'open', 'system',
        'source-materialized', current_item.source_fingerprint,
        left(target_idempotency_key,80)||':m:'||md5(current_item.occurrence_key),
        target_observed_at
      );
      materialized := materialized + 1;
    else
      previous_state := current_item.state;
      should_reopen := current_item.source_fingerprint <> (entry->>'sourceFingerprint')
        or (current_item.state = 'snoozed'
          and current_item.snoozed_until <= target_observed_at);
      update public.attention_items
      set rule = entry->>'rule',
          category = entry->>'category',
          subject_type = (entry->>'subjectType')::public.attention_subject_type,
          subject_id = subject_uuid,
          source_fingerprint = entry->>'sourceFingerprint',
          reason = entry->>'reason',
          href = entry->>'href',
          priority = (entry->>'priority')::public.attention_priority,
          due_at = nullif(entry->>'dueAt','')::timestamptz,
          last_seen_at = target_observed_at,
          assignee_membership_id = nullif(entry->>'assigneeMembershipId','')::uuid,
          dismiss_allowed = (entry->>'dismissAllowed')::boolean,
          evidence = entry->'evidence',
          state = case when should_reopen then 'open' else state end,
          item_version = item_version + case when should_reopen then 1 else 0 end,
          state_changed_at = case when should_reopen then target_observed_at else state_changed_at end,
          state_changed_by_membership_id = case when should_reopen then null else state_changed_by_membership_id end,
          state_change_reason = case when should_reopen then
            case when current_item.source_fingerprint <> (entry->>'sourceFingerprint')
              then 'source-changed' else 'snooze-ended' end
            else state_change_reason end,
          snoozed_until = case when should_reopen then null else snoozed_until end
      where id = current_item.id
      returning * into current_item;
      if should_reopen then
        insert into public.attention_lifecycle_events (
          workspace_id, attention_item_id, from_state, to_state, actor_kind,
          reason_code, source_fingerprint, idempotency_key, occurred_at
        ) values (
          target_workspace_id, current_item.id, previous_state, 'open', 'system',
          current_item.state_change_reason, current_item.source_fingerprint,
          left(target_idempotency_key,80)||':o:'||md5(current_item.occurrence_key),
          target_observed_at
        );
        reopened := reopened + 1;
      else
        refreshed := refreshed + 1;
      end if;
    end if;
  end loop;

  for current_item in
    select * from public.attention_items
    where workspace_id = target_workspace_id
      and state in ('open','acknowledged','snoozed','escalated')
      and not (occurrence_key = any(occurrence_keys))
    for update
  loop
    previous_state := current_item.state;
    update public.attention_items
    set state = 'completed',
        item_version = item_version + 1,
        state_changed_at = target_observed_at,
        state_changed_by_membership_id = null,
        state_change_reason = 'source-cleared',
        snoozed_until = null
    where id = current_item.id
    returning * into current_item;
    insert into public.attention_lifecycle_events (
      workspace_id, attention_item_id, from_state, to_state, actor_kind,
      reason_code, source_fingerprint, idempotency_key, occurred_at
    ) values (
      target_workspace_id, current_item.id, previous_state, 'completed', 'system',
      'source-cleared', current_item.source_fingerprint,
      left(target_idempotency_key,80)||':c:'||md5(current_item.occurrence_key),
      target_observed_at
    );
    resolved := resolved + 1;
  end loop;

  update public.attention_reconciliation_runs
  set state = 'completed',
      materialized_count = materialized,
      refreshed_count = refreshed,
      reopened_count = reopened,
      resolved_count = resolved,
      completed_at = target_observed_at,
      updated_at = now()
  where id = run_row.id
  returning * into run_row;

  return jsonb_build_object(
    'runId', run_row.id,
    'noOp', materialized = 0 and reopened = 0 and resolved = 0,
    'materialized', materialized,
    'refreshed', refreshed,
    'reopened', reopened,
    'resolved', resolved
  );
end;
$$;

revoke all on function public.assert_canonical_workspace_owner_identity(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_workspace_support_grant_id(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.has_workspace_support_grant(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.normalize_contact_search_text(text)
  from public, anon, authenticated, service_role;
revoke all on function public.contact_matches_normalized_query(public.contacts,text)
  from public, anon, authenticated, service_role;
revoke all on function public.contact_matches_smart_list_definition(public.contacts,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)
  from public, anon, authenticated, service_role;

grant execute on function public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)
  to service_role;
grant execute on function public.resolve_workspace_support_grant_id(uuid)
  to authenticated;
grant execute on function public.has_workspace_support_grant(uuid)
  to authenticated;
grant execute on function public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)
  to authenticated;

comment on function public.assert_canonical_workspace_owner_identity(uuid,uuid,uuid) is
  'Internal service-path assertion binding a supplied actor and membership to the workspace unique active canonical owner.';
comment on function public.resolve_workspace_support_grant_id(uuid) is
  'Returns the caller exact active support-grant ID only while the caller remains an active assistant in the same workspace.';
comment on function public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer) is
  'Returns one bounded canonical contact page plus exact untruncated filtered scope/lead counts from one workspace-authorized statement snapshot.';

do $$
begin
  if pg_get_functiondef('public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)'::regprocedure)
     not ilike '%assert_canonical_workspace_owner_identity%' then
    raise exception 'AI secret read is not bound to canonical owner identity';
  end if;
  if has_function_privilege('authenticated',
    'public.read_workspace_ai_secret_envelope(uuid,uuid,uuid)','execute') then
    raise exception 'authenticated role must not execute AI secret reads';
  end if;
  if not has_function_privilege('authenticated',
    'public.list_canonical_contact_page(uuid,text,text,text,text,uuid,boolean,integer,integer)','execute') then
    raise exception 'canonical contact page RPC grant is missing';
  end if;
  if exists (
    select 1
    from unnest(array[
      'public.is_iso_date_value(jsonb)'::regprocedure,
      'public.is_valid_smart_list_definition(jsonb)'::regprocedure,
      'public.is_valid_incomplete_candidate(jsonb)'::regprocedure,
      'public.is_valid_contact_conversion_payload(jsonb,boolean)'::regprocedure,
      'public.incomplete_candidate_contact_patch(jsonb,public.contacts)'::regprocedure,
      'public.is_valid_incomplete_conversion_plan(jsonb)'::regprocedure
    ]) target(oid)
    join pg_catalog.pg_proc procedure on procedure.oid = target.oid
    where procedure.provolatile <> 's'
  ) then
    raise exception 'validator volatility correction is missing';
  end if;
  if (select prosrc from pg_catalog.pg_proc
      where oid = 'public.reconcile_attention_items(uuid,jsonb,timestamptz,text)'::regprocedure)
      not like '%occurrence_keys text[] := ''{}''::text[]%' then
    raise exception 'attention occurrence-key array type correction is missing';
  end if;
end;
$$;

commit;
