-- Omnix — Google incremental OAuth, minimized Gmail metadata and dedicated
-- Calendar resource authority. Story 4.2 AC1–AC10.
--
-- Forward-only and additive. Google sign-in remains identity-only. Connector
-- OAuth uses the Story 3.5 private vault/cursor/job authority; provider HTTP,
-- PKCE decryption and token encryption remain server-only.

alter type public.crm_activity_event_type_v2
  add value if not exists 'email-metadata-linked';
alter type public.crm_activity_event_type_v2
  add value if not exists 'email-sent';

begin;

alter type connector_receipt_event_type add value if not exists 'oauth.token-refreshed';
alter type connector_receipt_event_type add value if not exists 'gmail.send-linked';

-- Story 3.1 task version is the canonical optimistic resource version.
alter table public.tasks
  add column task_version integer not null default 1;
alter table public.tasks
  add constraint tasks_task_version_positive check (task_version > 0);

create or replace function public.prepare_google_task_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    new.task_version:=1;
  else
    if new.task_version<>old.task_version then
      raise exception 'task version is database-managed' using errcode='55000';
    end if;
    new.task_version:=old.task_version+1;
  end if;
  return new;
end;
$$;

create trigger zz_tasks_google_version
before insert or update on public.tasks
for each row execute function public.prepare_google_task_version();

alter table public.activity_events drop constraint activity_events_target_shape;
alter table public.activity_events add constraint activity_events_target_shape check (
  (type in (
    'contact-created','contact-updated','contact-imported','note-added','touch-recorded',
    'contact-archived','contact-restored','contact-point-added','contact-point-updated',
    'contact-point-archived','contact-point-restored','relationship-updated',
    'assignment-updated'
  ) and contact_id is not null and task_id is null and incomplete_record_id is null)
  or (type in ('household-updated','custom-field-updated')
    and task_id is null and incomplete_record_id is null)
  or (type='incomplete-record-converted' and contact_id is not null
    and task_id is null and incomplete_record_id is not null)
  or (type::text='incomplete-record-received' and contact_id is null
    and task_id is null and incomplete_record_id is not null)
  or (type::text in ('email-metadata-linked','email-sent') and contact_id is not null
    and task_id is null and incomplete_record_id is null)
  or (type in ('task-created','task-completed','task-archived')
    and task_id is not null and incomplete_record_id is null)
);

-- Workspace-visible redacted current state --------------------------------

create table public.google_connection_capabilities (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  bundle                     text not null,
  required_scopes            text[] not null,
  granted_scopes             text[] not null,
  state                      text not null,
  account_key_hash           text not null,
  authorized_by_membership_id uuid,
  authorized_at              timestamptz,
  revoked_at                 timestamptz,
  last_error_category        text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint google_connection_capabilities_id_workspace_unique unique(id,workspace_id),
  constraint google_connection_capabilities_connection_bundle_unique unique(connection_id,bundle),
  constraint google_connection_capabilities_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_connection_capabilities_authorizer_workspace_fk
    foreign key(authorized_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint google_connection_capabilities_bundle check (
    bundle in ('gmail-send','gmail-metadata','calendar-app-created')
  ),
  constraint google_connection_capabilities_state check (
    state in ('active','missing','revoked')
  ),
  constraint google_connection_capabilities_hash check (
    account_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_connection_capabilities_scopes check (
    cardinality(required_scopes) between 3 and 4
    and cardinality(granted_scopes) between 0 and 4
  ),
  constraint google_connection_capabilities_authorized check (
    (state='active' and authorized_by_membership_id is not null
      and authorized_at is not null and revoked_at is null)
    or (state='missing' and revoked_at is null)
    or (state='revoked' and revoked_at is not null)
  ),
  constraint google_connection_capabilities_error check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create index google_connection_capabilities_workspace_idx
  on public.google_connection_capabilities(workspace_id,connection_id,bundle);

create table public.google_oauth_completions (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  transaction_id             uuid not null unique,
  bundle                     text not null,
  account_key_hash           text not null,
  granted_scopes             text[] not null,
  granted_scopes_hash        text not null,
  access_secret_version      integer not null,
  refresh_secret_version     integer,
  actor_user_id              uuid not null references auth.users(id) on delete restrict,
  actor_membership_id        uuid not null,
  correlation_id             uuid not null,
  occurred_at                timestamptz not null,
  created_at                 timestamptz not null default now(),
  constraint google_oauth_completions_id_workspace_unique unique(id,workspace_id),
  constraint google_oauth_completions_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_oauth_completions_actor_workspace_fk
    foreign key(actor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint google_oauth_completions_bundle check (
    bundle in ('gmail-send','gmail-metadata','calendar-app-created')
  ),
  constraint google_oauth_completions_hashes check (
    account_key_hash ~ '^[0-9a-f]{64}$'
    and granted_scopes_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_oauth_completions_versions check (
    access_secret_version>0 and (refresh_secret_version is null or refresh_secret_version>0)
  )
);

create table public.google_sync_health (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null,
  stream_key            text not null,
  state                 text not null default 'idle',
  cursor_generation     integer not null default 0,
  cursor_version        integer,
  last_checkpoint_hash  text,
  last_receipt_id       uuid,
  last_started_at       timestamptz,
  last_success_at       timestamptz,
  last_callback_at      timestamptz,
  lag_seconds           integer,
  last_error_category   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint google_sync_health_id_workspace_unique unique(id,workspace_id),
  constraint google_sync_health_connection_stream_unique unique(connection_id,stream_key),
  constraint google_sync_health_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_sync_health_stream check (
    stream_key in ('google.gmail-history','google.calendar-events')
  ),
  constraint google_sync_health_state check (
    state in ('idle','syncing','healthy','full_resync_required','degraded','disabled')
  ),
  constraint google_sync_health_progress check (
    cursor_generation>=0 and (cursor_version is null or cursor_version>0)
    and (lag_seconds is null or lag_seconds>=0)
  ),
  constraint google_sync_health_hash check (
    last_checkpoint_hash is null or last_checkpoint_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_sync_health_error check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create index google_sync_health_workspace_idx
  on public.google_sync_health(workspace_id,state,updated_at desc);

create table public.google_calendar_task_states (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null,
  task_id               uuid not null,
  task_version          integer not null,
  resource_key_hash     text not null,
  state                 text not null,
  provider_updated_at   timestamptz,
  last_error_category   text,
  correlation_id        uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint google_calendar_task_states_id_workspace_unique unique(id,workspace_id),
  constraint google_calendar_task_states_connection_task_unique unique(connection_id,task_id),
  constraint google_calendar_task_states_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_calendar_task_states_task_workspace_fk
    foreign key(task_id,workspace_id)
    references public.tasks(id,workspace_id) on delete restrict,
  constraint google_calendar_task_states_state check (
    state in ('pending','synced','conflict','remote-deleted','review','disconnected')
  ),
  constraint google_calendar_task_states_version check (task_version>0),
  constraint google_calendar_task_states_hash check (resource_key_hash ~ '^[0-9a-f]{64}$'),
  constraint google_calendar_task_states_error check (
    last_error_category is null
    or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create index google_calendar_task_states_workspace_idx
  on public.google_calendar_task_states(workspace_id,state,updated_at desc);

create table public.google_gmail_metadata_reviews (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null,
  resource_hash         text not null,
  counterpart_hash      text not null,
  reason                text not null,
  direction             text not null,
  provider_occurred_at  timestamptz not null,
  correlation_id        uuid not null,
  occurred_at           timestamptz not null,
  created_at            timestamptz not null default now(),
  constraint google_gmail_metadata_reviews_id_workspace_unique unique(id,workspace_id),
  constraint google_gmail_metadata_reviews_connection_resource_unique unique(connection_id,resource_hash),
  constraint google_gmail_metadata_reviews_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_gmail_metadata_reviews_hashes check (
    resource_hash ~ '^[0-9a-f]{64}$' and counterpart_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_gmail_metadata_reviews_reason check (
    reason in ('no-canonical-match','shared-email','archived-email','self-only','group-address')
  ),
  constraint google_gmail_metadata_reviews_direction check (direction in ('incoming','outgoing'))
);

create table public.google_email_drafts (
  id                         uuid primary key,
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  current_version            integer not null default 1,
  current_payload_ref        uuid not null,
  current_payload_hash       text not null,
  recipient_hash             text not null,
  status                     text not null default 'draft',
  request_key_hash           text not null,
  created_by_membership_id   uuid not null,
  last_edited_by_membership_id uuid not null,
  prepared_intent_id         uuid,
  prepared_intent_version    integer,
  correlation_id             uuid not null,
  archived_at                timestamptz,
  sent_job_id                uuid,
  sent_at                    timestamptz,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,
  constraint google_email_drafts_id_workspace_unique unique(id,workspace_id),
  constraint google_email_drafts_connection_request_unique unique(connection_id,request_key_hash),
  constraint google_email_drafts_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_email_drafts_point_workspace_fk
    foreign key(contact_point_id,workspace_id,contact_id)
    references public.contact_points(id,workspace_id,contact_id) on delete restrict,
  constraint google_email_drafts_payload_workspace_fk
    foreign key(current_payload_ref,workspace_id)
    references connector_private.connector_payload_envelopes(id,workspace_id) on delete restrict,
  constraint google_email_drafts_creator_workspace_fk
    foreign key(created_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint google_email_drafts_editor_workspace_fk
    foreign key(last_edited_by_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint google_email_drafts_intent_workspace_fk
    foreign key(prepared_intent_id,workspace_id)
    references public.connector_action_intents(id,workspace_id) on delete restrict,
  constraint google_email_drafts_sent_job_workspace_fk
    foreign key(sent_job_id,workspace_id)
    references public.connector_jobs(id,workspace_id) on delete restrict,
  constraint google_email_drafts_hashes check (
    current_payload_hash ~ '^[0-9a-f]{64}$'
    and recipient_hash ~ '^[0-9a-f]{64}$'
    and request_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_email_drafts_state check (
    status in ('draft','intent-prepared','archived','sent','reconciliation-required')
  ),
  constraint google_email_drafts_version check (current_version>0),
  constraint google_email_drafts_intent_state check (
    (status='intent-prepared' and prepared_intent_id is not null and prepared_intent_version is not null)
    or (status<>'intent-prepared' and prepared_intent_id is null and prepared_intent_version is null)
  ),
  constraint google_email_drafts_archive_state check (
    (status='archived' and archived_at is not null)
    or (status<>'archived' and archived_at is null)
  ),
  constraint google_email_drafts_sent_state check (
    (status='sent' and sent_job_id is not null and sent_at is not null)
    or (status<>'sent' and sent_job_id is null and sent_at is null)
  )
);

create index google_email_drafts_workspace_status_idx
  on public.google_email_drafts(workspace_id,status,updated_at desc);
create index google_email_drafts_contact_idx
  on public.google_email_drafts(workspace_id,contact_id,updated_at desc);

create table public.google_email_draft_versions (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  draft_id              uuid not null,
  version               integer not null,
  change_kind           text not null,
  payload_ref           uuid not null,
  payload_hash          text not null,
  recipient_hash        text not null,
  editor_membership_id  uuid not null,
  correlation_id        uuid not null,
  occurred_at           timestamptz not null,
  created_at            timestamptz not null default now(),
  constraint google_email_draft_versions_id_workspace_unique unique(id,workspace_id),
  constraint google_email_draft_versions_draft_version_unique unique(draft_id,version),
  constraint google_email_draft_versions_draft_workspace_fk
    foreign key(draft_id,workspace_id)
    references public.google_email_drafts(id,workspace_id) on delete restrict,
  constraint google_email_draft_versions_payload_workspace_fk
    foreign key(payload_ref,workspace_id)
    references connector_private.connector_payload_envelopes(id,workspace_id) on delete restrict,
  constraint google_email_draft_versions_editor_workspace_fk
    foreign key(editor_membership_id,workspace_id)
    references public.workspace_members(id,workspace_id) on delete restrict,
  constraint google_email_draft_versions_hashes check (
    payload_hash ~ '^[0-9a-f]{64}$' and recipient_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_email_draft_versions_version check (version>0),
  constraint google_email_draft_versions_change check (change_kind in ('created','edited','archived'))
);

create index google_email_draft_versions_draft_idx
  on public.google_email_draft_versions(workspace_id,draft_id,version desc);

-- Private provider identifiers and resource mappings ----------------------

create table connector_private.google_gmail_resources (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null,
  message_external_id   text not null,
  thread_external_id    text not null,
  resource_hash         text not null,
  counterpart_hash      text not null,
  direction             text not null,
  labels                text[] not null default '{}',
  provider_occurred_at  timestamptz not null,
  contact_id            uuid,
  contact_point_id      uuid,
  activity_event_id     uuid,
  source_job_id         uuid,
  draft_id              uuid,
  review_reason         text,
  correlation_id        uuid not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint google_gmail_resources_id_workspace_unique unique(id,workspace_id),
  constraint google_gmail_resources_connection_message_unique unique(connection_id,message_external_id),
  constraint google_gmail_resources_connection_hash_unique unique(connection_id,resource_hash),
  constraint google_gmail_resources_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_gmail_resources_point_workspace_fk
    foreign key(contact_point_id,workspace_id,contact_id)
    references public.contact_points(id,workspace_id,contact_id) on delete restrict,
  constraint google_gmail_resources_activity_workspace_fk
    foreign key(activity_event_id,workspace_id)
    references public.activity_events(id,workspace_id) on delete restrict,
  constraint google_gmail_resources_job_workspace_fk
    foreign key(source_job_id,workspace_id)
    references public.connector_jobs(id,workspace_id) on delete restrict,
  constraint google_gmail_resources_draft_workspace_fk
    foreign key(draft_id,workspace_id)
    references public.google_email_drafts(id,workspace_id) on delete restrict,
  constraint google_gmail_resources_ids check (
    message_external_id ~ '^[A-Za-z0-9_-]+$' and length(message_external_id)<=256
    and thread_external_id ~ '^[A-Za-z0-9_-]+$' and length(thread_external_id)<=256
  ),
  constraint google_gmail_resources_hashes check (
    resource_hash ~ '^[0-9a-f]{64}$' and counterpart_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_gmail_resources_direction check (direction in ('incoming','outgoing')),
  constraint google_gmail_resources_labels check (
    cardinality(labels)<=100
  ),
  constraint google_gmail_resources_link_state check (
    (review_reason is null and contact_id is not null and contact_point_id is not null
      and activity_event_id is not null)
    or (review_reason in ('no-canonical-match','shared-email','archived-email','self-only','group-address')
      and contact_id is null and contact_point_id is null and activity_event_id is null)
  )
);

create table connector_private.google_calendar_resources (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null unique,
  calendar_external_id  text not null,
  resource_key_hash     text not null,
  etag_hash             text not null,
  resource_version      integer not null default 1,
  created_job_id        uuid not null,
  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  deleted_at            timestamptz,
  constraint google_calendar_resources_id_workspace_unique unique(id,workspace_id),
  constraint google_calendar_resources_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_calendar_resources_job_workspace_fk
    foreign key(created_job_id,workspace_id)
    references public.connector_jobs(id,workspace_id) on delete restrict,
  constraint google_calendar_resources_external check (
    length(calendar_external_id) between 1 and 1024 and calendar_external_id !~ '[[:cntrl:]]'
  ),
  constraint google_calendar_resources_hashes check (
    resource_key_hash ~ '^[0-9a-f]{64}$' and etag_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_calendar_resources_version check (resource_version>0)
);

create table connector_private.google_calendar_task_resources (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null,
  calendar_resource_id  uuid not null,
  task_id               uuid not null,
  task_version          integer not null,
  event_external_id     text not null,
  resource_key_hash     text not null,
  etag_hash             text not null,
  provider_updated_at   timestamptz,
  created_job_id        uuid not null,
  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  constraint google_calendar_task_resources_id_workspace_unique unique(id,workspace_id),
  constraint google_calendar_task_resources_connection_task_unique unique(connection_id,task_id),
  constraint google_calendar_task_resources_connection_key_unique unique(connection_id,resource_key_hash),
  constraint google_calendar_task_resources_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_calendar_task_resources_calendar_workspace_fk
    foreign key(calendar_resource_id,workspace_id)
    references connector_private.google_calendar_resources(id,workspace_id) on delete restrict,
  constraint google_calendar_task_resources_task_workspace_fk
    foreign key(task_id,workspace_id)
    references public.tasks(id,workspace_id) on delete restrict,
  constraint google_calendar_task_resources_job_workspace_fk
    foreign key(created_job_id,workspace_id)
    references public.connector_jobs(id,workspace_id) on delete restrict,
  constraint google_calendar_task_resources_external check (
    event_external_id ~ '^[A-Za-z0-9_-]+$' and length(event_external_id)<=1024
  ),
  constraint google_calendar_task_resources_hashes check (
    resource_key_hash ~ '^[0-9a-f]{64}$' and etag_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_calendar_task_resources_version check (task_version>0)
);

create table connector_private.google_gmail_watch_resources (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  connection_id         uuid not null unique,
  channel_key_hash      text not null,
  resource_key_hash     text not null,
  resource_version      integer not null default 1,
  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  created_at            timestamptz not null,
  updated_at            timestamptz not null,
  constraint google_gmail_watch_resources_id_workspace_unique unique(id,workspace_id),
  constraint google_gmail_watch_resources_connection_workspace_fk
    foreign key(connection_id,workspace_id)
    references public.connector_connections(id,workspace_id) on delete restrict,
  constraint google_gmail_watch_resources_hashes check (
    channel_key_hash ~ '^[0-9a-f]{64}$' and resource_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_gmail_watch_resources_version check (resource_version>0),
  constraint google_gmail_watch_resources_expiry check (expires_at>created_at)
);

create index google_gmail_resources_contact_idx
  on connector_private.google_gmail_resources(workspace_id,contact_id,provider_occurred_at desc)
  where contact_id is not null;
create unique index google_gmail_resources_source_job_idx
  on connector_private.google_gmail_resources(connection_id,source_job_id)
  where source_job_id is not null;
create index google_calendar_task_resources_task_idx
  on connector_private.google_calendar_task_resources(workspace_id,task_id);

-- Private canonical helpers ----------------------------------------------

create or replace function connector_private.google_bundle_scopes(target_bundle text)
returns text[]
language sql
immutable
security definer
set search_path=''
as $$
  select case target_bundle
    when 'gmail-send' then array['openid','email','https://www.googleapis.com/auth/gmail.send']::text[]
    when 'gmail-metadata' then array['openid','email','https://www.googleapis.com/auth/gmail.metadata']::text[]
    when 'calendar-app-created' then array['openid','email','https://www.googleapis.com/auth/calendar.app.created']::text[]
    else null::text[] end;
$$;

create or replace function connector_private.google_bundle_for_action(target_action text)
returns text
language sql
immutable
security definer
set search_path=''
as $$
  select case target_action
    when 'gmail.send' then 'gmail-send'
    when 'gmail.sync-metadata' then 'gmail-metadata'
    when 'calendar.create-omnix-calendar' then 'calendar-app-created'
    when 'calendar.upsert-omnix-event' then 'calendar-app-created'
    when 'calendar.sync' then 'calendar-app-created'
    else null end;
$$;

create or replace function connector_private.google_stream_for_action(target_action text)
returns text
language sql
immutable
security definer
set search_path=''
as $$
  select case target_action
    when 'gmail.sync-metadata' then 'google.gmail-history'
    when 'calendar.sync' then 'google.calendar-events'
    else null end;
$$;

create or replace function connector_private.ensure_google_action_policies(
  target_workspace_id uuid,target_membership_id uuid,target_granted_scopes text[],
  target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  action_row record;
  target_policy public.connector_automation_policies%rowtype;
  policies jsonb:='[]'::jsonb;
  expected_constraints jsonb;
  expected_compliance constant jsonb :=
    '{"provider":"google","rawContentInReceipts":false,"rawAddressesInReceipts":false,"accountSwapAllowed":false}'::jsonb;
  expected_limits constant jsonb :=
    '{"maxAttempts":5,"maxBatchSize":500,"minimumDelayMs":250}'::jsonb;
begin
  if target_correlation_id is null or target_occurred_at is null
     or not exists(select 1 from public.workspace_members membership
       where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
         and membership.role='owner' and membership.status='active') then
    raise exception 'active owner authority required for Google policy bootstrap' using errcode='42501';
  end if;
  for action_row in
    select * from (values
      ('gmail.send','gmail-send','https://www.googleapis.com/auth/gmail.send'),
      ('gmail.sync-metadata','gmail-metadata','https://www.googleapis.com/auth/gmail.metadata'),
      ('calendar.create-omnix-calendar','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
      ('calendar.upsert-omnix-event','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created'),
      ('calendar.sync','calendar-app-created','https://www.googleapis.com/auth/calendar.app.created')
    ) as actions(action_type,bundle,required_scope)
    where actions.required_scope=any(target_granted_scopes)
    order by actions.action_type
  loop
    expected_constraints:=jsonb_build_object('provider','google','capabilityBundle',action_row.bundle,
      'connectionBound',true,'immutablePayload',true,
      'canonicalAuthority',case when action_row.action_type='calendar.upsert-omnix-event'
        then 'task-version' else 'connector-payload' end);
    perform pg_advisory_xact_lock(hashtextextended(target_workspace_id::text||':'||action_row.action_type,0));
    select policy.* into target_policy from public.connector_automation_policies policy
    where policy.workspace_id=target_workspace_id and policy.action_type=action_row.action_type
    order by policy.version desc limit 1;
    if found then
      if target_policy.version<>1 or target_policy.approval_mode<>'owner_required'
         or target_policy.allowlisted_actions is distinct from array[action_row.action_type]::text[]
         or target_policy.target_constraints<>expected_constraints
         or target_policy.compliance_requirements<>expected_compliance
         or target_policy.execution_limits<>expected_limits then
        raise exception 'existing % policy conflicts with canonical Google policy',action_row.action_type
          using errcode='23505';
      end if;
    else
      insert into public.connector_automation_policies(
        workspace_id,action_type,version,approval_mode,allowlisted_actions,
        target_constraints,compliance_requirements,execution_limits,
        created_by_membership_id,correlation_id,created_at
      ) values (
        target_workspace_id,action_row.action_type,1,'owner_required',array[action_row.action_type]::text[],
        expected_constraints,expected_compliance,expected_limits,
        target_membership_id,target_correlation_id,target_occurred_at
      ) returning * into target_policy;
    end if;
    policies:=policies||jsonb_build_array(to_jsonb(target_policy));
  end loop;
  return policies;
end;
$$;

create or replace function connector_private.google_authorized_job(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns public.connector_jobs
language plpgsql
stable
security definer
set search_path=''
as $$
declare target_job public.connector_jobs%rowtype; target_bundle text;
begin
  select job.* into target_job from public.connector_jobs job
  join public.connector_connections connection
    on connection.id=job.connection_id and connection.workspace_id=job.workspace_id
  where job.id=target_job_id and job.provider='google'
    and job.state='executing' and job.lease_owner=target_worker_id
    and job.fencing_token=target_fencing_token and job.lease_expires_at>target_now
    and connection.provider='google' and connection.status in ('active','degraded');
  if not found then raise exception 'active fenced Google job required' using errcode='42501'; end if;
  target_bundle:=connector_private.google_bundle_for_action(target_job.action_type);
  if target_bundle is null or not exists(
    select 1 from public.google_connection_capabilities capability
    join public.connector_connections bound_connection
      on bound_connection.id=capability.connection_id
      and bound_connection.workspace_id=capability.workspace_id
    where capability.connection_id=target_job.connection_id
      and capability.workspace_id=target_job.workspace_id
      and capability.bundle=target_bundle and capability.state='active'
      and capability.account_key_hash=bound_connection.provider_account_key_hash
      and capability.required_scopes=connector_private.google_bundle_scopes(target_bundle)
      and not exists(select 1 from unnest(capability.required_scopes) required_scope
        where required_scope<>all(capability.granted_scopes))
      and not exists(select 1 from unnest(capability.required_scopes) required_scope
        where required_scope<>all(bound_connection.granted_scopes))
      and not exists(select 1 from unnest(capability.granted_scopes) granted_scope
        where granted_scope<>all(bound_connection.granted_scopes))
  ) then raise exception 'active Google capability required' using errcode='42501'; end if;
  return target_job;
end;
$$;

create or replace function connector_private.upsert_google_secret(
  target_connection_id uuid,target_secret_type text,target_expected_version integer,
  target_envelope jsonb,target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_connection public.connector_connections%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
  target_expires_at timestamptz;
begin
  if target_secret_type not in ('google-access-token','google-refresh-token')
     or jsonb_typeof(target_envelope)<>'object'
     or not (target_envelope ?& array['ciphertext','nonce','authTag','wrappedDek','wrapNonce','wrapAuthTag','kekVersion','aadHash','expiresAt'])
     or (select count(*) from jsonb_object_keys(target_envelope))<>9
     or target_envelope->>'kekVersion' !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_envelope->>'aadHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid encrypted Google token envelope' using errcode='22023';
  end if;
  target_expires_at:=case when jsonb_typeof(target_envelope->'expiresAt')='null'
    then null else (target_envelope->>'expiresAt')::timestamptz end;
  if (target_secret_type='google-access-token' and (target_expires_at is null or target_expires_at<=target_occurred_at))
     or (target_secret_type='google-refresh-token' and target_expires_at is not null) then
    raise exception 'invalid Google token expiry binding' using errcode='22023';
  end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='google';
  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection_id and secret.secret_type=target_secret_type for update;
  if found then
    if target_expected_version is null or target_secret.secret_version<>target_expected_version then
      raise exception 'Google token secret version conflict' using errcode='40001';
    end if;
    update connector_private.connector_connection_secrets set
      secret_version=secret_version+1,
      ciphertext=decode(target_envelope->>'ciphertext','base64'),
      nonce=decode(target_envelope->>'nonce','base64'),
      auth_tag=decode(target_envelope->>'authTag','base64'),
      wrapped_dek=decode(target_envelope->>'wrappedDek','base64'),
      wrap_nonce=decode(target_envelope->>'wrapNonce','base64'),
      wrap_auth_tag=decode(target_envelope->>'wrapAuthTag','base64'),
      kek_version=target_envelope->>'kekVersion',aad_hash=target_envelope->>'aadHash',
      expires_at=target_expires_at,refreshed_at=target_occurred_at,destroyed_at=null,
      updated_at=target_occurred_at
    where id=target_secret.id returning * into target_secret;
  else
    if target_expected_version is not null then
      raise exception 'Google token secret version conflict' using errcode='40001';
    end if;
    insert into connector_private.connector_connection_secrets(
      workspace_id,connection_id,secret_type,ciphertext,nonce,auth_tag,wrapped_dek,
      wrap_nonce,wrap_auth_tag,kek_version,aad_hash,expires_at,refreshed_at,created_at,updated_at
    ) values (
      target_connection.workspace_id,target_connection.id,target_secret_type,
      decode(target_envelope->>'ciphertext','base64'),decode(target_envelope->>'nonce','base64'),
      decode(target_envelope->>'authTag','base64'),decode(target_envelope->>'wrappedDek','base64'),
      decode(target_envelope->>'wrapNonce','base64'),decode(target_envelope->>'wrapAuthTag','base64'),
      target_envelope->>'kekVersion',target_envelope->>'aadHash',target_expires_at,
      target_occurred_at,target_occurred_at,target_occurred_at
    ) returning * into target_secret;
  end if;
  return jsonb_build_object('secretId',target_secret.id,'secretType',target_secret.secret_type,
    'secretVersion',target_secret.secret_version,'expiresAt',target_secret.expires_at,
    'kekVersion',target_secret.kek_version);
end;
$$;

create or replace function connector_private.store_google_draft_payload(
  target_connection_id uuid,target_draft_id uuid,target_draft_version integer,
  target_payload_hash text,target_envelope jsonb,target_occurred_at timestamptz
)
returns connector_private.connector_payload_envelopes
language plpgsql
security definer
set search_path=''
as $$
declare target_connection public.connector_connections%rowtype;
 target_payload connector_private.connector_payload_envelopes%rowtype;
begin
 if target_draft_id is null or target_draft_version<1
    or target_payload_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(target_envelope)<>'object'
    or not (target_envelope ?& array['ciphertext','nonce','authTag','wrappedDek','wrapNonce','wrapAuthTag','kekVersion','aadHash'])
    or (select count(*) from jsonb_object_keys(target_envelope))<>8
    or target_envelope->>'kekVersion' !~ '^[A-Za-z0-9_.-]{1,64}$'
    or target_envelope->>'aadHash' !~ '^[0-9a-f]{64}$' then
  raise exception 'invalid encrypted Google draft envelope' using errcode='22023'; end if;
 select connection.* into target_connection from public.connector_connections connection
 where connection.id=target_connection_id and connection.provider='google'
   and connection.status in ('active','degraded');
 if not found then raise exception 'active Google connection required' using errcode='42501'; end if;
 insert into connector_private.connector_payload_envelopes(
  workspace_id,connection_id,payload_kind,schema_version,canonical_hash,
  ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,
  aad_hash,created_at,updated_at
 ) values(target_connection.workspace_id,target_connection.id,'gmail.send',
  'google-gmail-draft.v1',target_payload_hash,
  decode(target_envelope->>'ciphertext','base64'),decode(target_envelope->>'nonce','base64'),
  decode(target_envelope->>'authTag','base64'),decode(target_envelope->>'wrappedDek','base64'),
  decode(target_envelope->>'wrapNonce','base64'),decode(target_envelope->>'wrapAuthTag','base64'),
  target_envelope->>'kekVersion',target_envelope->>'aadHash',target_occurred_at,target_occurred_at)
 returning * into target_payload;
 return target_payload;
end;
$$;

revoke all on function connector_private.google_bundle_scopes(text) from public,anon,authenticated,service_role;
revoke all on function connector_private.google_bundle_for_action(text) from public,anon,authenticated,service_role;
revoke all on function connector_private.google_stream_for_action(text) from public,anon,authenticated,service_role;
revoke all on function connector_private.ensure_google_action_policies(uuid,uuid,text[],uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function connector_private.google_authorized_job(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function connector_private.upsert_google_secret(uuid,text,integer,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function connector_private.store_google_draft_payload(uuid,uuid,integer,text,jsonb,timestamptz) from public,anon,authenticated,service_role;

-- RLS and mutation boundary ------------------------------------------------

alter table public.google_connection_capabilities enable row level security;
alter table public.google_connection_capabilities force row level security;
alter table public.google_oauth_completions enable row level security;
alter table public.google_oauth_completions force row level security;
alter table public.google_sync_health enable row level security;
alter table public.google_sync_health force row level security;
alter table public.google_calendar_task_states enable row level security;
alter table public.google_calendar_task_states force row level security;
alter table public.google_gmail_metadata_reviews enable row level security;
alter table public.google_gmail_metadata_reviews force row level security;
alter table public.google_email_drafts enable row level security;
alter table public.google_email_drafts force row level security;
alter table public.google_email_draft_versions enable row level security;
alter table public.google_email_draft_versions force row level security;

create policy google_connection_capabilities_member_select on public.google_connection_capabilities
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy google_oauth_completions_member_select on public.google_oauth_completions
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy google_sync_health_member_select on public.google_sync_health
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy google_calendar_task_states_member_select on public.google_calendar_task_states
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy google_gmail_metadata_reviews_member_select on public.google_gmail_metadata_reviews
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy google_email_drafts_member_select on public.google_email_drafts
for select to authenticated using(public.has_workspace_access(workspace_id));
create policy google_email_draft_versions_member_select on public.google_email_draft_versions
for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on table public.google_connection_capabilities,public.google_oauth_completions,
  public.google_sync_health,public.google_calendar_task_states,
  public.google_gmail_metadata_reviews,public.google_email_drafts,
  public.google_email_draft_versions from anon,authenticated,service_role;
grant select on table public.google_connection_capabilities,public.google_oauth_completions,
  public.google_sync_health,public.google_calendar_task_states,
  public.google_gmail_metadata_reviews,public.google_email_drafts,
  public.google_email_draft_versions to authenticated,service_role;
revoke all on table connector_private.google_gmail_resources,
  connector_private.google_calendar_resources,
  connector_private.google_calendar_task_resources,
  connector_private.google_gmail_watch_resources from public,anon,authenticated,service_role;

create trigger google_oauth_completions_guard_mutation before update or delete
on public.google_oauth_completions for each row execute function public.guard_connector_append_only();
create trigger google_gmail_metadata_reviews_guard_mutation before update or delete
on public.google_gmail_metadata_reviews for each row execute function public.guard_connector_append_only();
create trigger google_email_draft_versions_guard_mutation before update or delete
on public.google_email_draft_versions for each row execute function public.guard_connector_append_only();

-- Incremental owner OAuth --------------------------------------------------

create or replace function public.begin_google_oauth(
  target_connection_id uuid,target_workspace_id uuid,target_bundle text,
  target_correlation_id uuid,target_state_hash text,target_session_binding_hash text,
  target_redirect_uri text,target_safe_return_path text,
  target_pkce_ciphertext bytea,target_pkce_nonce bytea,target_pkce_auth_tag bytea,
  target_pkce_wrapped_dek bytea,target_pkce_wrap_nonce bytea,target_pkce_wrap_auth_tag bytea,
  target_kek_version text,target_aad_hash text,target_expires_at timestamptz,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  target_transaction connector_private.connector_oauth_transactions%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  exact_scopes text[];
  no_op boolean:=false;
begin
  actor:=public.connector_current_membership(target_workspace_id,true);
  exact_scopes:=connector_private.google_bundle_scopes(target_bundle);
  if target_connection_id is null or exact_scopes is null or target_correlation_id is null
     or target_state_hash !~ '^[0-9a-f]{64}$'
     or target_session_binding_hash !~ '^[0-9a-f]{64}$'
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_kek_version !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_redirect_uri is null or length(target_redirect_uri) not between 8 and 2048
     or target_safe_return_path !~ '^/[^/].*|^/$' or length(target_safe_return_path)>512
     or target_expires_at<=target_occurred_at or target_expires_at>target_occurred_at+interval '10 minutes'
     or octet_length(target_pkce_ciphertext)=0 or octet_length(target_pkce_nonce)<>12
     or octet_length(target_pkce_auth_tag)<>16 or octet_length(target_pkce_wrapped_dek)=0
     or octet_length(target_pkce_wrap_nonce)<>12 or octet_length(target_pkce_wrap_auth_tag)<>16 then
    raise exception 'invalid Google OAuth start request' using errcode='22023';
  end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id for update;
  if found then
    if target_connection.workspace_id<>target_workspace_id or target_connection.provider<>'google'
       or target_connection.status not in ('active','degraded','reauthorization_required','authorizing') then
      raise exception 'Google incremental connection binding is invalid' using errcode='42501';
    end if;
  else
    insert into public.connector_connections(
      id,workspace_id,provider,display_label,status,granted_scopes,
      remote_identity_summary,created_by_membership_id,created_at,updated_at
    ) values (
      target_connection_id,target_workspace_id,'google','Google authorization pending',
      'authorizing','{}','{}',actor.id,target_occurred_at,target_occurred_at
    ) returning * into target_connection;
  end if;
  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.state_hash=target_state_hash for update;
  if found then
    if target_transaction.workspace_id<>target_workspace_id
       or target_transaction.connection_id<>target_connection_id
       or target_transaction.provider<>'google'
       or target_transaction.requested_scope_bundle<>target_bundle
       or target_transaction.requested_scopes<>exact_scopes
       or target_transaction.actor_user_id<>actor.user_id
       or target_transaction.membership_id<>actor.id
       or target_transaction.session_binding_hash<>target_session_binding_hash
       or target_transaction.redirect_uri<>target_redirect_uri
       or target_transaction.safe_return_path<>target_safe_return_path
       or target_transaction.expires_at<>target_expires_at then
      raise exception 'Google OAuth start replay conflicts' using errcode='23505';
    end if;
    no_op:=true;
  else
    insert into connector_private.connector_oauth_transactions(
      workspace_id,connection_id,provider,state_hash,requested_scope_bundle,
      requested_scopes,actor_user_id,membership_id,session_binding_hash,
      redirect_uri,safe_return_path,pkce_ciphertext,pkce_nonce,pkce_auth_tag,
      pkce_wrapped_dek,pkce_wrap_nonce,pkce_wrap_auth_tag,kek_version,aad_hash,
      expires_at,created_at
    ) values (
      target_workspace_id,target_connection_id,'google',target_state_hash,target_bundle,
      exact_scopes,actor.user_id,actor.id,target_session_binding_hash,target_redirect_uri,
      target_safe_return_path,target_pkce_ciphertext,target_pkce_nonce,target_pkce_auth_tag,
      target_pkce_wrapped_dek,target_pkce_wrap_nonce,target_pkce_wrap_auth_tag,
      target_kek_version,target_aad_hash,target_expires_at,target_occurred_at
    ) returning * into target_transaction;
  end if;
  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id=target_workspace_id
    and receipt.event_key='google.oauth.started:'||target_transaction.id::text;
  if not found then
    insert into public.connector_receipt_events(
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      provider_request_hash,redacted_metadata,occurred_at
    ) values (
      target_workspace_id,target_connection_id,'google','oauth.started',
      'google.oauth.started:'||target_transaction.id::text,target_correlation_id,
      encode(extensions.digest(pg_catalog.convert_to(target_bundle||'|'||array_to_string(exact_scopes,','),'UTF8'),'sha256'),'hex'),
      jsonb_build_object('transactionId',target_transaction.id,'bundle',target_bundle,
        'requestedScopes',exact_scopes,'actorMembershipId',actor.id),target_occurred_at
    ) returning * into target_receipt;
  end if;
  return jsonb_build_object('connection',to_jsonb(target_connection),
    'transaction',jsonb_build_object('transactionId',target_transaction.id,
      'workspaceId',target_transaction.workspace_id,'connectionId',target_transaction.connection_id,
      'provider','google','bundle',target_bundle,'requestedScopes',exact_scopes,
      'safeReturnPath',target_transaction.safe_return_path,'expiresAt',target_transaction.expires_at,
      'consumedAt',target_transaction.consumed_at),
    'receipt',to_jsonb(target_receipt),'noOp',no_op);
end;
$$;

create or replace function public.consume_google_oauth_transaction(
  target_state_hash text,target_workspace_id uuid,target_actor_user_id uuid,
  target_membership_id uuid,target_session_binding_hash text,target_redirect_uri text,
  target_consumed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare target_transaction connector_private.connector_oauth_transactions%rowtype;
 target_access_version integer; target_refresh_version integer;
begin
  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.state_hash=target_state_hash and transaction_row.provider='google'
  for update;
  if not found then raise exception 'Google OAuth transaction not found' using errcode='P0002'; end if;
  if target_transaction.consumed_at is not null or target_transaction.expires_at<=target_consumed_at
     or target_transaction.workspace_id<>target_workspace_id
     or target_transaction.actor_user_id<>target_actor_user_id
     or target_transaction.membership_id<>target_membership_id
     or target_transaction.session_binding_hash<>target_session_binding_hash
     or target_transaction.redirect_uri<>target_redirect_uri
     or connector_private.google_bundle_scopes(target_transaction.requested_scope_bundle)
        is distinct from target_transaction.requested_scopes
     or not exists(select 1 from public.workspace_members membership
       where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
         and membership.user_id=target_actor_user_id and membership.role='owner'
         and membership.status='active') then
    raise exception 'Google OAuth transaction binding, expiry or replay check failed' using errcode='42501';
  end if;
  update connector_private.connector_oauth_transactions set consumed_at=target_consumed_at
  where id=target_transaction.id returning * into target_transaction;
  select secret.secret_version into target_access_version
  from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_transaction.connection_id
    and secret.secret_type='google-access-token' and secret.destroyed_at is null;
  select secret.secret_version into target_refresh_version
  from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_transaction.connection_id
    and secret.secret_type='google-refresh-token' and secret.destroyed_at is null;
  return jsonb_build_object('transactionId',target_transaction.id,
    'workspaceId',target_transaction.workspace_id,'connectionId',target_transaction.connection_id,
    'provider','google','bundle',target_transaction.requested_scope_bundle,
    'requestedScopes',target_transaction.requested_scopes,
    'safeReturnPath',target_transaction.safe_return_path,
    'pkceCiphertext',encode(target_transaction.pkce_ciphertext,'base64'),
    'pkceNonce',encode(target_transaction.pkce_nonce,'base64'),
    'pkceAuthTag',encode(target_transaction.pkce_auth_tag,'base64'),
    'pkceWrappedDek',encode(target_transaction.pkce_wrapped_dek,'base64'),
    'pkceWrapNonce',encode(target_transaction.pkce_wrap_nonce,'base64'),
    'pkceWrapAuthTag',encode(target_transaction.pkce_wrap_auth_tag,'base64'),
    'kekVersion',target_transaction.kek_version,'aadHash',target_transaction.aad_hash,
    'expectedAccessSecretVersion',target_access_version,
    'expectedRefreshSecretVersion',target_refresh_version,
    'consumedAt',target_transaction.consumed_at);
end;
$$;

create or replace function public.finalize_google_oauth(
  target_transaction_id uuid,target_workspace_id uuid,target_actor_user_id uuid,
  target_membership_id uuid,target_provider_account_key_hash text,target_account_email text,
  target_granted_scopes text[],target_expected_access_secret_version integer,
  target_access_envelope jsonb,target_expected_refresh_secret_version integer,
  target_refresh_envelope jsonb,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_transaction connector_private.connector_oauth_transactions%rowtype;
  target_connection public.connector_connections%rowtype;
  target_completion public.google_oauth_completions%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  target_refresh connector_private.connector_connection_secrets%rowtype;
  access_metadata jsonb; refresh_metadata jsonb; capabilities jsonb; policies jsonb;
  canonical_email text; canonical_scopes text[]; scopes_hash text; bundle text;
  capability_bundle text; required text[]; state_value text;
begin
  canonical_email:=public.normalize_contact_email(target_account_email);
  select array_agg(distinct scope order by scope) into canonical_scopes
  from unnest(target_granted_scopes) scope;
  if target_transaction_id is null or target_workspace_id is null
     or target_provider_account_key_hash !~ '^[0-9a-f]{64}$'
     or canonical_email is null or canonical_email<>target_account_email
     or not public.is_valid_contact_email(target_account_email) or length(canonical_email)>120
     or target_correlation_id is null or target_occurred_at is null
     or canonical_scopes is null or cardinality(canonical_scopes)<>cardinality(target_granted_scopes)
     or exists(select 1 from unnest(canonical_scopes) scope where scope not in (
       'openid','email','https://www.googleapis.com/auth/gmail.send',
       'https://www.googleapis.com/auth/gmail.metadata',
       'https://www.googleapis.com/auth/calendar.app.created'
     )) then raise exception 'invalid Google OAuth completion request' using errcode='22023'; end if;
  scopes_hash:=encode(extensions.digest(pg_catalog.convert_to(array_to_string(canonical_scopes,','),'UTF8'),'sha256'),'hex');
  select transaction_row.* into target_transaction
  from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.id=target_transaction_id and transaction_row.provider='google' for update;
  if not found then raise exception 'Google OAuth transaction not found' using errcode='P0002'; end if;
  bundle:=target_transaction.requested_scope_bundle;
  select completion.* into target_completion from public.google_oauth_completions completion
  where completion.transaction_id=target_transaction.id for update;
  if found then
    if target_completion.workspace_id<>target_workspace_id
       or target_completion.actor_user_id<>target_actor_user_id
       or target_completion.actor_membership_id<>target_membership_id
       or target_completion.account_key_hash<>target_provider_account_key_hash
       or target_completion.granted_scopes<>canonical_scopes then
      raise exception 'Google OAuth completion replay conflicts' using errcode='23505';
    end if;
    select connection.* into strict target_connection from public.connector_connections connection
    where connection.id=target_completion.connection_id;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_completion.workspace_id
      and receipt.event_key='google.oauth.completed:'||target_completion.transaction_id::text;
    select coalesce(jsonb_agg(to_jsonb(capability) order by capability.bundle),'[]'::jsonb)
      into capabilities from public.google_connection_capabilities capability
      where capability.connection_id=target_completion.connection_id;
    select coalesce(jsonb_agg(to_jsonb(policy) order by policy.action_type),'[]'::jsonb)
      into policies from public.connector_automation_policies policy
      where policy.workspace_id=target_completion.workspace_id
        and policy.action_type=any(array[
          case when 'https://www.googleapis.com/auth/gmail.send'=any(target_completion.granted_scopes)
            then 'gmail.send' end,
          case when 'https://www.googleapis.com/auth/gmail.metadata'=any(target_completion.granted_scopes)
            then 'gmail.sync-metadata' end,
          case when 'https://www.googleapis.com/auth/calendar.app.created'=any(target_completion.granted_scopes)
            then 'calendar.create-omnix-calendar' end,
          case when 'https://www.googleapis.com/auth/calendar.app.created'=any(target_completion.granted_scopes)
            then 'calendar.upsert-omnix-event' end,
          case when 'https://www.googleapis.com/auth/calendar.app.created'=any(target_completion.granted_scopes)
            then 'calendar.sync' end
        ]::text[]);
    return jsonb_build_object('connection',to_jsonb(target_connection),
      'transaction',jsonb_build_object('transactionId',target_completion.transaction_id,
        'bundle',target_completion.bundle,'consumedAt',target_transaction.consumed_at),
      'capabilities',capabilities,'policies',policies,'secrets',jsonb_build_object(
        'access',jsonb_build_object('secretVersion',target_completion.access_secret_version),
        'refresh',case when target_completion.refresh_secret_version is null then null
          else jsonb_build_object('secretVersion',target_completion.refresh_secret_version) end),
      'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  if target_transaction.consumed_at is null
     or target_transaction.workspace_id<>target_workspace_id
     or target_transaction.actor_user_id<>target_actor_user_id
     or target_transaction.membership_id<>target_membership_id
     or target_transaction.connection_id is null
     or not exists(select 1 from public.workspace_members membership
       where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
         and membership.user_id=target_actor_user_id and membership.role='owner'
         and membership.status='active')
     or exists(select 1 from unnest(target_transaction.requested_scopes) required_scope
       where required_scope<>all(canonical_scopes)) then
    raise exception 'consumed Google OAuth owner/scope binding required' using errcode='42501';
  end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_transaction.connection_id and connection.workspace_id=target_workspace_id
    and connection.provider='google' for update;
  if not found or target_connection.status not in ('authorizing','active','degraded','reauthorization_required') then
    raise exception 'current Google connection required' using errcode='42501';
  end if;
  if target_connection.provider_account_key_hash is not null
     and target_connection.provider_account_key_hash<>target_provider_account_key_hash then
    raise exception 'Google account swap requires a new connection' using errcode='42501';
  end if;
  if target_access_envelope is null then
    raise exception 'encrypted Google access token required' using errcode='22023';
  end if;
  access_metadata:=connector_private.upsert_google_secret(
    target_connection.id,'google-access-token',target_expected_access_secret_version,
    target_access_envelope,target_occurred_at);
  select secret.* into target_refresh from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='google-refresh-token'
    and secret.destroyed_at is null for update;
  if target_refresh_envelope is not null then
    refresh_metadata:=connector_private.upsert_google_secret(
      target_connection.id,'google-refresh-token',target_expected_refresh_secret_version,
      target_refresh_envelope,target_occurred_at);
  elsif target_refresh.id is null then
    raise exception 'new Google connection requires an offline refresh token' using errcode='23514';
  else
    if target_expected_refresh_secret_version is not null
       and target_expected_refresh_secret_version<>target_refresh.secret_version then
      raise exception 'Google refresh token version conflict' using errcode='40001';
    end if;
    refresh_metadata:=jsonb_build_object('secretId',target_refresh.id,
      'secretType',target_refresh.secret_type,'secretVersion',target_refresh.secret_version,
      'expiresAt',target_refresh.expires_at,'kekVersion',target_refresh.kek_version);
  end if;
  update public.connector_connections set provider_account_key_hash=target_provider_account_key_hash,
    display_label=canonical_email,status='active',granted_scopes=canonical_scopes,
    remote_identity_summary=jsonb_build_object('accountKeyHash',target_provider_account_key_hash,
      'emailVerified',true),last_error_category=null,disconnected_at=null,
    updated_at=target_occurred_at
  where id=target_connection.id returning * into target_connection;
  foreach capability_bundle in array array['gmail-send','gmail-metadata','calendar-app-created'] loop
    required:=connector_private.google_bundle_scopes(capability_bundle);
    state_value:=case when not exists(select 1 from unnest(required) required_scope
      where required_scope<>all(canonical_scopes)) then 'active' else 'missing' end;
    insert into public.google_connection_capabilities(
      workspace_id,connection_id,bundle,required_scopes,granted_scopes,state,
      account_key_hash,authorized_by_membership_id,authorized_at,revoked_at,
      last_error_category,created_at,updated_at
    ) values (
      target_workspace_id,target_connection.id,capability_bundle,required,
      array(select scope from unnest(canonical_scopes) scope where scope=any(required)),
      state_value,target_provider_account_key_hash,
      case when state_value='active' then target_membership_id else null end,
      case when state_value='active' then target_occurred_at else null end,
      null,case when state_value='missing' then 'scope_missing' else null end,
      target_occurred_at,target_occurred_at
    ) on conflict on constraint google_connection_capabilities_connection_bundle_unique do update set
      required_scopes=excluded.required_scopes,granted_scopes=excluded.granted_scopes,
      state=excluded.state,account_key_hash=excluded.account_key_hash,
      authorized_by_membership_id=excluded.authorized_by_membership_id,
      authorized_at=excluded.authorized_at,revoked_at=null,
      last_error_category=excluded.last_error_category,updated_at=excluded.updated_at;
  end loop;
  policies:=connector_private.ensure_google_action_policies(target_workspace_id,target_membership_id,
    canonical_scopes,target_correlation_id,target_occurred_at);
  insert into public.google_oauth_completions(
    workspace_id,connection_id,transaction_id,bundle,account_key_hash,granted_scopes,
    granted_scopes_hash,access_secret_version,refresh_secret_version,actor_user_id,
    actor_membership_id,correlation_id,occurred_at,created_at
  ) values (
    target_workspace_id,target_connection.id,target_transaction.id,bundle,
    target_provider_account_key_hash,canonical_scopes,scopes_hash,
    (access_metadata->>'secretVersion')::integer,(refresh_metadata->>'secretVersion')::integer,
    target_actor_user_id,target_membership_id,target_correlation_id,target_occurred_at,target_occurred_at
  ) returning * into target_completion;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_workspace_id,target_connection.id,'google','oauth.completed',
    'google.oauth.completed:'||target_transaction.id::text,target_correlation_id,
    scopes_hash,jsonb_build_object('transactionId',target_transaction.id,'bundle',bundle,
      'accountKeyHash',target_provider_account_key_hash,'grantedScopes',canonical_scopes,
      'accessSecretVersion',target_completion.access_secret_version,
      'refreshSecretVersion',target_completion.refresh_secret_version),target_occurred_at
  ) returning * into target_receipt;
  select coalesce(jsonb_agg(to_jsonb(capability) order by capability.bundle),'[]'::jsonb)
    into capabilities from public.google_connection_capabilities capability
    where capability.connection_id=target_connection.id;
  return jsonb_build_object('connection',to_jsonb(target_connection),
    'transaction',jsonb_build_object('transactionId',target_transaction.id,
      'bundle',bundle,'consumedAt',target_transaction.consumed_at),
    'capabilities',capabilities,'policies',policies,'secrets',jsonb_build_object(
      'access',access_metadata,'refresh',refresh_metadata),
    'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.read_google_connection_capability_state(target_connection_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  target_connection public.connector_connections%rowtype;
  capabilities jsonb; sync_state jsonb; target_calendar connector_private.google_calendar_resources%rowtype;
  target_access connector_private.connector_connection_secrets%rowtype;
  target_refresh connector_private.connector_connection_secrets%rowtype;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='google';
  if not found then raise exception 'Google connection not found' using errcode='P0002'; end if;
  if not public.has_workspace_access(target_connection.workspace_id) then
    raise exception 'workspace access required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('bundle',capability.bundle,
    'requiredScopes',capability.required_scopes,'grantedScopes',capability.granted_scopes,
    'state',capability.state,'authorizedAt',capability.authorized_at,
    'lastErrorCategory',capability.last_error_category) order by capability.bundle),'[]'::jsonb)
    into capabilities from public.google_connection_capabilities capability
    where capability.connection_id=target_connection.id;
  select coalesce(jsonb_agg(jsonb_build_object('stream',health.stream_key,'state',health.state,
    'cursorGeneration',health.cursor_generation,'lastSuccessAt',health.last_success_at,
    'lastCallbackAt',health.last_callback_at,'lagSeconds',health.lag_seconds,
    'lastErrorCategory',health.last_error_category) order by health.stream_key),'[]'::jsonb)
    into sync_state from public.google_sync_health health
    where health.connection_id=target_connection.id;
  select resource.* into target_calendar from connector_private.google_calendar_resources resource
  where resource.connection_id=target_connection.id and resource.deleted_at is null;
  select secret.* into target_access from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='google-access-token'
    and secret.destroyed_at is null;
  select secret.* into target_refresh from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='google-refresh-token'
    and secret.destroyed_at is null;
  return jsonb_build_object('connection',jsonb_build_object('id',target_connection.id,
    'workspaceId',target_connection.workspace_id,'status',target_connection.status,
    'displayLabel',target_connection.display_label,'accountKeyHash',target_connection.provider_account_key_hash,
    'grantedScopes',target_connection.granted_scopes,'lastProbeAt',target_connection.last_probe_at,
    'lastErrorCategory',target_connection.last_error_category),
    'capabilities',capabilities,'sync',sync_state,
    'calendar',jsonb_build_object('created',target_calendar.id is not null),
    'tokenState',jsonb_build_object('accessExpiresAt',target_access.expires_at,
      'refreshPresent',target_refresh.id is not null));
end;
$$;

create or replace function public.create_google_email_draft(
  target_draft_id uuid,target_connection_id uuid,target_contact_id uuid,
  target_contact_point_id uuid,target_payload_hash text,target_recipient_hash text,
  target_request_key_hash text,target_envelope jsonb,target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
 target_point public.contact_points%rowtype;
 target_payload connector_private.connector_payload_envelopes%rowtype;
 target_draft public.google_email_drafts%rowtype; target_version public.google_email_draft_versions%rowtype;
begin
 select connection.* into target_connection from public.connector_connections connection
 where connection.id=target_connection_id and connection.provider='google'
   and connection.status in ('active','degraded');
 if not found then raise exception 'active Google connection required' using errcode='P0002'; end if;
 actor:=public.connector_current_membership(target_connection.workspace_id,false);
 if target_draft_id is null or target_correlation_id is null or target_occurred_at is null
    or target_payload_hash !~ '^[0-9a-f]{64}$'
    or target_recipient_hash !~ '^[0-9a-f]{64}$'
    or target_request_key_hash !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from public.google_connection_capabilities capability
      where capability.connection_id=target_connection.id and capability.bundle='gmail-send'
        and capability.state='active') then
  raise exception 'invalid Google email draft request' using errcode='22023'; end if;
 select draft.* into target_draft from public.google_email_drafts draft
 where draft.connection_id=target_connection.id and draft.request_key_hash=target_request_key_hash for update;
 if found then
  if target_draft.id<>target_draft_id or target_draft.contact_id<>target_contact_id
     or target_draft.contact_point_id<>target_contact_point_id
     or target_draft.current_payload_hash<>target_payload_hash
     or target_draft.recipient_hash<>target_recipient_hash then
   raise exception 'Google email draft replay conflicts' using errcode='23505'; end if;
  select version.* into strict target_version from public.google_email_draft_versions version
  where version.draft_id=target_draft.id and version.version=target_draft.current_version;
  return jsonb_build_object('draft',to_jsonb(target_draft),'version',to_jsonb(target_version),'noOp',true);
 end if;
 select point.* into target_point from public.contact_points point
 join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
 where point.id=target_contact_point_id and point.contact_id=target_contact_id
   and point.workspace_id=target_connection.workspace_id and point.type='email'
   and point.archived_at is null and contact.archived_at is null;
 if not found then raise exception 'active canonical recipient email required' using errcode='42501'; end if;
 if encode(extensions.digest(pg_catalog.convert_to(target_point.normalized_value,'UTF8'),'sha256'),'hex')
    <>target_recipient_hash then
  raise exception 'Google draft recipient hash mismatch' using errcode='23514'; end if;
 target_payload:=connector_private.store_google_draft_payload(target_connection.id,target_draft_id,1,
  target_payload_hash,target_envelope,target_occurred_at);
 insert into public.google_email_drafts(id,workspace_id,connection_id,contact_id,contact_point_id,
  current_payload_ref,current_payload_hash,recipient_hash,request_key_hash,
  created_by_membership_id,last_edited_by_membership_id,correlation_id,created_at,updated_at)
 values(target_draft_id,target_connection.workspace_id,target_connection.id,target_contact_id,
  target_contact_point_id,target_payload.id,target_payload_hash,target_recipient_hash,
  target_request_key_hash,actor.id,actor.id,target_correlation_id,target_occurred_at,target_occurred_at)
 returning * into target_draft;
 insert into public.google_email_draft_versions(workspace_id,draft_id,version,change_kind,
  payload_ref,payload_hash,recipient_hash,editor_membership_id,correlation_id,occurred_at,created_at)
 values(target_draft.workspace_id,target_draft.id,1,'created',target_payload.id,target_payload_hash,
  target_recipient_hash,actor.id,target_correlation_id,target_occurred_at,target_occurred_at)
 returning * into target_version;
 return jsonb_build_object('draft',to_jsonb(target_draft),'version',to_jsonb(target_version),'noOp',false);
end;
$$;

create or replace function public.edit_google_email_draft(
  target_draft_id uuid,target_expected_version integer,target_payload_hash text,
  target_recipient_hash text,target_envelope jsonb,target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_draft public.google_email_drafts%rowtype;
 target_point public.contact_points%rowtype;
 target_payload connector_private.connector_payload_envelopes%rowtype;
 target_version public.google_email_draft_versions%rowtype; next_version integer;
begin
 select draft.* into target_draft from public.google_email_drafts draft
 where draft.id=target_draft_id for update;
 if not found then raise exception 'Google email draft not found' using errcode='P0002'; end if;
 actor:=public.connector_current_membership(target_draft.workspace_id,false);
 if target_draft.status<>'draft' or target_draft.current_version<>target_expected_version
    or target_payload_hash !~ '^[0-9a-f]{64}$' or target_recipient_hash !~ '^[0-9a-f]{64}$'
    or target_correlation_id is null or target_occurred_at is null then
  raise exception 'current editable Google draft version required' using errcode='40001'; end if;
 select point.* into target_point from public.contact_points point
 join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
 where point.id=target_draft.contact_point_id and point.contact_id=target_draft.contact_id
   and point.workspace_id=target_draft.workspace_id and point.type='email'
   and point.archived_at is null and contact.archived_at is null;
 if not found or encode(extensions.digest(pg_catalog.convert_to(target_point.normalized_value,'UTF8'),'sha256'),'hex')
    <>target_recipient_hash then raise exception 'active exact draft recipient required' using errcode='42501'; end if;
 next_version:=target_draft.current_version+1;
 target_payload:=connector_private.store_google_draft_payload(target_draft.connection_id,
  target_draft.id,next_version,target_payload_hash,target_envelope,target_occurred_at);
 insert into public.google_email_draft_versions(workspace_id,draft_id,version,change_kind,
  payload_ref,payload_hash,recipient_hash,editor_membership_id,correlation_id,occurred_at,created_at)
 values(target_draft.workspace_id,target_draft.id,next_version,'edited',target_payload.id,
  target_payload_hash,target_recipient_hash,actor.id,target_correlation_id,target_occurred_at,target_occurred_at)
 returning * into target_version;
 update public.google_email_drafts set current_version=next_version,current_payload_ref=target_payload.id,
  current_payload_hash=target_payload_hash,recipient_hash=target_recipient_hash,
  last_edited_by_membership_id=actor.id,correlation_id=target_correlation_id,
  updated_at=target_occurred_at where id=target_draft.id returning * into target_draft;
 return jsonb_build_object('draft',to_jsonb(target_draft),'version',to_jsonb(target_version),'noOp',false);
end; $$;

create or replace function public.archive_google_email_draft(
  target_draft_id uuid,target_expected_version integer,target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_draft public.google_email_drafts%rowtype;
 target_version public.google_email_draft_versions%rowtype;
begin
 select draft.* into target_draft from public.google_email_drafts draft where draft.id=target_draft_id for update;
 if not found then raise exception 'Google email draft not found' using errcode='P0002'; end if;
 actor:=public.connector_current_membership(target_draft.workspace_id,false);
 if target_draft.status='archived' then
  if target_draft.current_version<>target_expected_version then raise exception 'draft version conflict' using errcode='40001'; end if;
  select version.* into strict target_version from public.google_email_draft_versions version
  where version.draft_id=target_draft.id and version.version=target_draft.current_version;
  return jsonb_build_object('draft',to_jsonb(target_draft),'version',to_jsonb(target_version),'noOp',true);
 end if;
 if target_draft.status<>'draft' or target_draft.current_version<>target_expected_version then
  raise exception 'current editable Google draft version required' using errcode='40001'; end if;
 insert into public.google_email_draft_versions(workspace_id,draft_id,version,change_kind,
  payload_ref,payload_hash,recipient_hash,editor_membership_id,correlation_id,occurred_at,created_at)
 values(target_draft.workspace_id,target_draft.id,target_draft.current_version+1,'archived',
  target_draft.current_payload_ref,target_draft.current_payload_hash,target_draft.recipient_hash,
  actor.id,target_correlation_id,target_occurred_at,target_occurred_at) returning * into target_version;
 update public.google_email_drafts set current_version=current_version+1,status='archived',
  last_edited_by_membership_id=actor.id,correlation_id=target_correlation_id,
  archived_at=target_occurred_at,updated_at=target_occurred_at
 where id=target_draft.id returning * into target_draft;
 return jsonb_build_object('draft',to_jsonb(target_draft),'version',to_jsonb(target_version),'noOp',false);
end; $$;

create or replace function public.prepare_google_gmail_send_intent(
  target_draft_id uuid,target_expected_draft_version integer,target_summary text,
  target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_draft public.google_email_drafts%rowtype;
 target_intent public.connector_action_intents%rowtype;
 target_intent_version public.connector_action_intent_versions%rowtype;
 target_receipt public.connector_receipt_events%rowtype; target_policy public.connector_automation_policies%rowtype;
begin
 select draft.* into target_draft from public.google_email_drafts draft where draft.id=target_draft_id for update;
 if not found then raise exception 'Google email draft not found' using errcode='P0002'; end if;
 actor:=public.connector_current_membership(target_draft.workspace_id,false);
 if target_draft.status='intent-prepared' then
  if target_draft.current_version<>target_expected_draft_version then raise exception 'draft version conflict' using errcode='40001'; end if;
  select intent.* into strict target_intent from public.connector_action_intents intent where intent.id=target_draft.prepared_intent_id;
  select version.* into strict target_intent_version from public.connector_action_intent_versions version
   where version.intent_id=target_intent.id and version.version=target_draft.prepared_intent_version;
  select receipt.* into target_receipt from public.connector_receipt_events receipt
   where receipt.workspace_id=target_draft.workspace_id and receipt.event_key='google.gmail.intent:'||target_draft.id::text||':'||target_draft.current_version::text;
  return jsonb_build_object('draft',to_jsonb(target_draft),'intent',to_jsonb(target_intent),
   'version',to_jsonb(target_intent_version),'receipt',to_jsonb(target_receipt),'noOp',true);
 end if;
 if target_draft.status<>'draft' or target_draft.current_version<>target_expected_draft_version
    or length(btrim(target_summary)) not between 1 and 280 or target_summary ~ '[[:cntrl:]]'
    or not exists(select 1 from public.contacts contact where contact.id=target_draft.contact_id
      and contact.workspace_id=target_draft.workspace_id and contact.archived_at is null)
    or not exists(select 1 from public.contact_points point where point.id=target_draft.contact_point_id
      and point.contact_id=target_draft.contact_id and point.workspace_id=target_draft.workspace_id
      and point.archived_at is null and point.type='email') then
  raise exception 'current sendable Google draft version required' using errcode='40001'; end if;
 select policy.* into target_policy from public.connector_automation_policies policy
 where policy.workspace_id=target_draft.workspace_id and policy.action_type='gmail.send'
   and policy.approval_mode='owner_required' order by policy.version desc limit 1;
 if not found then raise exception 'owner-required Gmail send policy required' using errcode='P0002'; end if;
 insert into public.connector_action_intents(workspace_id,connection_id,provider,action_type,
  summary,state,current_version,created_by_membership_id,correlation_id,created_at,updated_at)
 values(target_draft.workspace_id,target_draft.connection_id,'google','gmail.send',target_summary,
  'pending',1,actor.id,target_correlation_id,target_occurred_at,target_occurred_at)
 returning * into target_intent;
 insert into public.connector_action_intent_versions(workspace_id,intent_id,version,connection_id,
  action_type,payload_ref,payload_hash,policy_id,policy_version,compliance_snapshot,
  created_by_membership_id,correlation_id,created_at)
 values(target_draft.workspace_id,target_intent.id,1,target_draft.connection_id,'gmail.send',
  target_draft.current_payload_ref,target_draft.current_payload_hash,target_policy.id,target_policy.version,
  jsonb_build_object('draftId',target_draft.id,'draftVersion',target_draft.current_version,
    'recipientHash',target_draft.recipient_hash,'contactId',target_draft.contact_id,
    'contactPointId',target_draft.contact_point_id),actor.id,target_correlation_id,target_occurred_at)
 returning * into target_intent_version;
 update public.google_email_drafts set status='intent-prepared',prepared_intent_id=target_intent.id,
  prepared_intent_version=1,last_edited_by_membership_id=actor.id,
  correlation_id=target_correlation_id,updated_at=target_occurred_at
 where id=target_draft.id returning * into target_draft;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,intent_id,
  intent_version_id,event_type,event_key,correlation_id,provider_request_hash,
  redacted_metadata,occurred_at) values(target_draft.workspace_id,target_draft.connection_id,
  'google',target_intent.id,target_intent_version.id,'intent.created',
  'google.gmail.intent:'||target_draft.id::text||':'||target_draft.current_version::text,
  target_correlation_id,target_draft.current_payload_hash,
  jsonb_build_object('draftId',target_draft.id,'draftVersion',target_draft.current_version,
    'recipientHash',target_draft.recipient_hash,'contactId',target_draft.contact_id,
    'contactPointId',target_draft.contact_point_id),target_occurred_at)
 returning * into target_receipt;
 return jsonb_build_object('draft',to_jsonb(target_draft),'intent',to_jsonb(target_intent),
  'version',to_jsonb(target_intent_version),'receipt',to_jsonb(target_receipt),'noOp',false);
end; $$;

-- Worker token, cursor and provider resource authority --------------------

create or replace function public.read_google_job_authority(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_now timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  target_job public.connector_jobs%rowtype; target_connection public.connector_connections%rowtype;
  target_access connector_private.connector_connection_secrets%rowtype;
  target_refresh connector_private.connector_connection_secrets%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  target_cursor connector_private.connector_sync_cursors%rowtype;
  target_health public.google_sync_health%rowtype;
  target_calendar connector_private.google_calendar_resources%rowtype;
  target_bundle text; stream text; access_state text;
begin
  target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_now);
  target_bundle:=connector_private.google_bundle_for_action(target_job.action_type);
  stream:=connector_private.google_stream_for_action(target_job.action_type);
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_job.connection_id;
  select secret.* into target_access from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_job.connection_id and secret.secret_type='google-access-token'
    and secret.destroyed_at is null;
  if not found then raise exception 'live Google access token required' using errcode='P0002'; end if;
  select secret.* into target_refresh from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_job.connection_id and secret.secret_type='google-refresh-token'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  access_state:=case when target_access.expires_at is not null and target_access.expires_at<=target_now
    then 'refresh-required' else 'live' end;
  if access_state='refresh-required' and target_refresh.id is null then
    raise exception 'current Google refresh token required for expired access token' using errcode='P0002';
  end if;
  select payload.* into target_payload from connector_private.connector_payload_envelopes payload
  where payload.id=target_job.payload_ref and payload.workspace_id=target_job.workspace_id
    and payload.connection_id=target_job.connection_id and payload.canonical_hash=target_job.payload_hash
    and payload.schema_version=target_job.schema_version and payload.destroyed_at is null;
  if not found then raise exception 'live Google job payload envelope required' using errcode='P0002'; end if;
  if stream is not null then
    select health.* into target_health from public.google_sync_health health
    where health.connection_id=target_job.connection_id and health.stream_key=stream;
    if target_health.state is distinct from 'full_resync_required' then
      select cursor.* into target_cursor from connector_private.connector_sync_cursors cursor
      where cursor.connection_id=target_job.connection_id and cursor.stream_key=stream;
    end if;
  end if;
  if target_job.action_type like 'calendar.%' then
    select resource.* into target_calendar from connector_private.google_calendar_resources resource
    where resource.connection_id=target_job.connection_id and resource.deleted_at is null;
  end if;
  return jsonb_build_object('job',jsonb_build_object('jobId',target_job.id,
    'workspaceId',target_job.workspace_id,'connectionId',target_job.connection_id,
    'actionType',target_job.action_type,'payloadHash',target_job.payload_hash,
    'fencingToken',target_job.fencing_token,'leaseExpiresAt',target_job.lease_expires_at),
    'bundle',target_bundle,'accessState',access_state,'connection',jsonb_build_object('id',target_connection.id,
      'workspaceId',target_connection.workspace_id,'status',target_connection.status,
      'displayLabel',target_connection.display_label,'accountKeyHash',target_connection.provider_account_key_hash,
      'grantedScopes',target_connection.granted_scopes),
    'payloadEnvelope',jsonb_build_object('payloadRef',target_payload.id,
      'payloadKind',target_payload.payload_kind,'schemaVersion',target_payload.schema_version,
      'canonicalHash',target_payload.canonical_hash,'envelopeVersion',target_payload.envelope_version,
      'ciphertext',encode(target_payload.ciphertext,'base64'),
      'nonce',encode(target_payload.nonce,'base64'),'authTag',encode(target_payload.auth_tag,'base64'),
      'wrappedDek',encode(target_payload.wrapped_dek,'base64'),
      'wrapNonce',encode(target_payload.wrap_nonce,'base64'),
      'wrapAuthTag',encode(target_payload.wrap_auth_tag,'base64'),
      'kekVersion',target_payload.kek_version,'aadHash',target_payload.aad_hash),
    'accessEnvelope',jsonb_build_object('secretId',target_access.id,'secretType',target_access.secret_type,
      'secretVersion',target_access.secret_version,'ciphertext',encode(target_access.ciphertext,'base64'),
      'nonce',encode(target_access.nonce,'base64'),'authTag',encode(target_access.auth_tag,'base64'),
      'wrappedDek',encode(target_access.wrapped_dek,'base64'),'wrapNonce',encode(target_access.wrap_nonce,'base64'),
      'wrapAuthTag',encode(target_access.wrap_auth_tag,'base64'),'kekVersion',target_access.kek_version,
      'aadHash',target_access.aad_hash,'expiresAt',target_access.expires_at),
    'refreshEnvelope',case when target_refresh.id is null then null else jsonb_build_object(
      'secretId',target_refresh.id,'secretType',target_refresh.secret_type,
      'secretVersion',target_refresh.secret_version,'ciphertext',encode(target_refresh.ciphertext,'base64'),
      'nonce',encode(target_refresh.nonce,'base64'),'authTag',encode(target_refresh.auth_tag,'base64'),
      'wrappedDek',encode(target_refresh.wrapped_dek,'base64'),'wrapNonce',encode(target_refresh.wrap_nonce,'base64'),
      'wrapAuthTag',encode(target_refresh.wrap_auth_tag,'base64'),'kekVersion',target_refresh.kek_version,
      'aadHash',target_refresh.aad_hash,'expiresAt',target_refresh.expires_at) end,
    'cursorEnvelope',case when target_cursor.id is null then null else jsonb_build_object(
      'cursorId',target_cursor.id,'stream',target_cursor.stream_key,
      'cursorVersion',target_cursor.cursor_version,'ciphertext',encode(target_cursor.ciphertext,'base64'),
      'nonce',encode(target_cursor.nonce,'base64'),'authTag',encode(target_cursor.auth_tag,'base64'),
      'wrappedDek',encode(target_cursor.wrapped_dek,'base64'),'wrapNonce',encode(target_cursor.wrap_nonce,'base64'),
      'wrapAuthTag',encode(target_cursor.wrap_auth_tag,'base64'),'kekVersion',target_cursor.kek_version,
      'aadHash',target_cursor.aad_hash,'expiresAt',target_cursor.expires_at) end,
    'calendarResource',case when target_calendar.id is null then null else jsonb_build_object(
      'resourceVersion',target_calendar.resource_version,
      'calendarId',target_calendar.calendar_external_id,
      'resourceKeyHash',target_calendar.resource_key_hash,
      'etagHash',target_calendar.etag_hash) end);
end;
$$;

create or replace function public.refresh_google_job_access_token(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_expected_access_secret_version integer,target_access_envelope jsonb,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_job public.connector_jobs%rowtype;
  target_access connector_private.connector_connection_secrets%rowtype;
  target_refresh_id uuid;
  secret_metadata jsonb;
  target_receipt public.connector_receipt_events%rowtype;
  target_expires_at timestamptz;
begin
  if target_expected_access_secret_version is null or target_access_envelope is null
     or target_occurred_at is null then
    raise exception 'invalid Google access-token refresh request' using errcode='22023';
  end if;
  target_job:=connector_private.google_authorized_job(
    target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
  select secret.id into target_refresh_id from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_job.connection_id and secret.secret_type='google-refresh-token'
    and secret.destroyed_at is null
    and (secret.expires_at is null or secret.expires_at>target_occurred_at) for update;
  if target_refresh_id is null then
    raise exception 'current Google refresh token required' using errcode='P0002';
  end if;
  select secret.* into target_access from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_job.connection_id and secret.secret_type='google-access-token'
    and secret.destroyed_at is null for update;
  if not found then raise exception 'Google access token not found' using errcode='P0002'; end if;
  if target_access.secret_version<>target_expected_access_secret_version then
    raise exception 'Google access token version conflict' using errcode='40001';
  end if;
  begin
    target_expires_at:=(target_access_envelope->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'invalid Google access-token expiry' using errcode='22023';
  end;
  if target_expires_at is null or target_expires_at<=target_occurred_at
     or target_expires_at>target_occurred_at+interval '24 hours' then
    raise exception 'fresh Google access-token expiry required' using errcode='22023';
  end if;
  secret_metadata:=connector_private.upsert_google_secret(target_job.connection_id,
    'google-access-token',target_expected_access_secret_version,target_access_envelope,target_occurred_at);
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,
    event_key,correlation_id,attempt_number,fencing_token,provider_request_hash,
    redacted_metadata,occurred_at
  ) values (
    target_job.workspace_id,target_job.connection_id,'google',target_job.id,
    target_job.intent_id,target_job.intent_version_id,'oauth.token-refreshed',
    'google.oauth.token-refreshed:'||target_job.connection_id::text||':'||(secret_metadata->>'secretVersion'),
    target_job.correlation_id,target_job.attempt_count,target_job.fencing_token,
    target_access_envelope->>'aadHash',jsonb_build_object(
      'previousSecretVersion',target_expected_access_secret_version,
      'secretVersion',(secret_metadata->>'secretVersion')::integer,
      'expiresAt',secret_metadata->>'expiresAt'),target_occurred_at
  ) returning * into target_receipt;
  return jsonb_build_object('jobId',target_job.id,'connectionId',target_job.connection_id,
    'accountKeyHash',(select connection.provider_account_key_hash from public.connector_connections connection
      where connection.id=target_job.connection_id),
    'grantedScopes',(select connection.granted_scopes from public.connector_connections connection
      where connection.id=target_job.connection_id),
    'secret',secret_metadata,'receipt',to_jsonb(target_receipt));
end;
$$;

create or replace function public.commit_google_sync_checkpoint(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_stream text,
  target_expected_cursor_version integer,target_cursor_envelope jsonb,
  target_provider_checkpoint_hash text,target_has_more boolean,
  target_last_provider_event_at timestamptz,target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_job public.connector_jobs%rowtype; target_cursor connector_private.connector_sync_cursors%rowtype;
  target_health public.google_sync_health%rowtype; target_receipt public.connector_receipt_events%rowtype;
  target_expires_at timestamptz; expected_stream text;
begin
  target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
  expected_stream:=connector_private.google_stream_for_action(target_job.action_type);
  if expected_stream is null or target_stream<>expected_stream
     or target_provider_checkpoint_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(target_cursor_envelope)<>'object'
     or not (target_cursor_envelope ?& array['ciphertext','nonce','authTag','wrappedDek','wrapNonce','wrapAuthTag','kekVersion','aadHash','expiresAt'])
     or (select count(*) from jsonb_object_keys(target_cursor_envelope))<>9
     or target_cursor_envelope->>'kekVersion' !~ '^[A-Za-z0-9_.-]{1,64}$'
     or target_cursor_envelope->>'aadHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Google sync checkpoint' using errcode='22023';
  end if;
  select health.* into target_health from public.google_sync_health health
  where health.connection_id=target_job.connection_id and health.stream_key=target_stream for update;
  if found and target_health.last_checkpoint_hash=target_provider_checkpoint_hash then
    if target_health.last_receipt_id is not null then
      select receipt.* into target_receipt from public.connector_receipt_events receipt
      where receipt.id=target_health.last_receipt_id;
    end if;
    return jsonb_build_object('health',to_jsonb(target_health),'cursor',jsonb_build_object(
      'cursorVersion',target_health.cursor_version),'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  target_expires_at:=case when jsonb_typeof(target_cursor_envelope->'expiresAt')='null'
    then null else (target_cursor_envelope->>'expiresAt')::timestamptz end;
  select cursor.* into target_cursor from connector_private.connector_sync_cursors cursor
  where cursor.connection_id=target_job.connection_id and cursor.stream_key=target_stream for update;
  if found then
    if not (target_health.state='full_resync_required' and target_expected_cursor_version is null)
       and target_cursor.cursor_version is distinct from target_expected_cursor_version then
      raise exception 'Google cursor version conflict' using errcode='40001';
    end if;
    update connector_private.connector_sync_cursors set cursor_version=cursor_version+1,
      ciphertext=decode(target_cursor_envelope->>'ciphertext','base64'),
      nonce=decode(target_cursor_envelope->>'nonce','base64'),
      auth_tag=decode(target_cursor_envelope->>'authTag','base64'),
      wrapped_dek=decode(target_cursor_envelope->>'wrappedDek','base64'),
      wrap_nonce=decode(target_cursor_envelope->>'wrapNonce','base64'),
      wrap_auth_tag=decode(target_cursor_envelope->>'wrapAuthTag','base64'),
      kek_version=target_cursor_envelope->>'kekVersion',aad_hash=target_cursor_envelope->>'aadHash',
      expires_at=target_expires_at,updated_at=target_occurred_at
    where id=target_cursor.id returning * into target_cursor;
  else
    if target_expected_cursor_version is not null then
      raise exception 'Google cursor version conflict' using errcode='40001';
    end if;
    insert into connector_private.connector_sync_cursors(
      workspace_id,connection_id,stream_key,ciphertext,nonce,auth_tag,wrapped_dek,
      wrap_nonce,wrap_auth_tag,kek_version,aad_hash,expires_at,created_at,updated_at
    ) values (
      target_job.workspace_id,target_job.connection_id,target_stream,
      decode(target_cursor_envelope->>'ciphertext','base64'),decode(target_cursor_envelope->>'nonce','base64'),
      decode(target_cursor_envelope->>'authTag','base64'),decode(target_cursor_envelope->>'wrappedDek','base64'),
      decode(target_cursor_envelope->>'wrapNonce','base64'),decode(target_cursor_envelope->>'wrapAuthTag','base64'),
      target_cursor_envelope->>'kekVersion',target_cursor_envelope->>'aadHash',target_expires_at,
      target_occurred_at,target_occurred_at
    ) returning * into target_cursor;
  end if;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,event_key,
    correlation_id,fencing_token,provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_job.workspace_id,target_job.connection_id,'google',target_job.id,target_job.intent_id,
    target_job.intent_version_id,'sync.applied','google.sync.checkpoint:'||target_job.id::text||':'||target_provider_checkpoint_hash,
    target_job.correlation_id,target_job.fencing_token,target_provider_checkpoint_hash,
    jsonb_build_object('stream',target_stream,'cursorVersion',target_cursor.cursor_version,
      'hasMore',target_has_more),target_occurred_at
  ) returning * into target_receipt;
  insert into public.google_sync_health(
    workspace_id,connection_id,stream_key,state,cursor_generation,cursor_version,
    last_checkpoint_hash,last_receipt_id,last_started_at,last_success_at,lag_seconds,
    last_error_category,created_at,updated_at
  ) values (
    target_job.workspace_id,target_job.connection_id,target_stream,
    case when target_has_more then 'syncing' else 'healthy' end,1,target_cursor.cursor_version,
    target_provider_checkpoint_hash,target_receipt.id,target_occurred_at,
    case when target_has_more then null else target_occurred_at end,
    case when target_last_provider_event_at is null then null
      else greatest(0,extract(epoch from target_occurred_at-target_last_provider_event_at)::integer) end,
    null,target_occurred_at,target_occurred_at
  ) on conflict(connection_id,stream_key) do update set
    state=excluded.state,cursor_generation=public.google_sync_health.cursor_generation+1,
    cursor_version=excluded.cursor_version,last_checkpoint_hash=excluded.last_checkpoint_hash,
    last_receipt_id=excluded.last_receipt_id,last_started_at=coalesce(public.google_sync_health.last_started_at,excluded.last_started_at),
    last_success_at=coalesce(excluded.last_success_at,public.google_sync_health.last_success_at),
    lag_seconds=excluded.lag_seconds,last_error_category=null,updated_at=excluded.updated_at
  returning * into target_health;
  return jsonb_build_object('health',to_jsonb(target_health),'cursor',jsonb_build_object(
    'cursorVersion',target_cursor.cursor_version,'kekVersion',target_cursor.kek_version,
    'expiresAt',target_cursor.expires_at),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.mark_google_sync_cursor_expired(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_stream text,
  target_expected_cursor_version integer,target_error_category text,target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare target_job public.connector_jobs%rowtype; target_health public.google_sync_health%rowtype;
 target_cursor connector_private.connector_sync_cursors%rowtype; target_receipt public.connector_receipt_events%rowtype;
begin
  target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
  if connector_private.google_stream_for_action(target_job.action_type)<>target_stream
     or target_error_category not in ('gmail_history_expired','calendar_sync_token_expired') then
    raise exception 'invalid Google cursor expiry' using errcode='22023'; end if;
  select cursor.* into target_cursor from connector_private.connector_sync_cursors cursor
  where cursor.connection_id=target_job.connection_id and cursor.stream_key=target_stream for update;
  if not found or target_cursor.cursor_version<>target_expected_cursor_version then
    raise exception 'Google cursor version conflict' using errcode='40001'; end if;
  select health.* into target_health from public.google_sync_health health
  where health.connection_id=target_job.connection_id and health.stream_key=target_stream for update;
  if found and target_health.state='full_resync_required'
     and target_health.cursor_version=target_cursor.cursor_version then
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.id=target_health.last_receipt_id;
    return jsonb_build_object('health',to_jsonb(target_health),'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,event_key,
    correlation_id,fencing_token,error_category,reconciliation_result,redacted_metadata,occurred_at
  ) values (
    target_job.workspace_id,target_job.connection_id,'google',target_job.id,target_job.intent_id,
    target_job.intent_version_id,'sync.reviewed','google.sync.cursor-expired:'||target_job.id::text||':'||target_cursor.cursor_version::text,
    target_job.correlation_id,target_job.fencing_token,target_error_category,'full-resync-required',
    jsonb_build_object('stream',target_stream,'cursorVersion',target_cursor.cursor_version),target_occurred_at
  ) returning * into target_receipt;
  insert into public.google_sync_health(
    workspace_id,connection_id,stream_key,state,cursor_generation,cursor_version,
    last_receipt_id,last_error_category,created_at,updated_at
  ) values (
    target_job.workspace_id,target_job.connection_id,target_stream,'full_resync_required',
    0,target_cursor.cursor_version,target_receipt.id,target_error_category,target_occurred_at,target_occurred_at
  ) on conflict(connection_id,stream_key) do update set state='full_resync_required',
    cursor_version=excluded.cursor_version,last_receipt_id=excluded.last_receipt_id,
    last_error_category=excluded.last_error_category,updated_at=excluded.updated_at
  returning * into target_health;
  return jsonb_build_object('health',to_jsonb(target_health),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.bind_google_gmail_watch_resource(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_channel_key_hash text,target_resource_key_hash text,target_expires_at timestamptz,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_watch connector_private.google_gmail_watch_resources%rowtype;
 target_receipt public.connector_receipt_events%rowtype; no_op boolean:=false;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type<>'gmail.sync-metadata' or target_channel_key_hash !~ '^[0-9a-f]{64}$'
    or target_resource_key_hash !~ '^[0-9a-f]{64}$' or target_expires_at<=target_occurred_at then
   raise exception 'invalid Gmail watch binding' using errcode='22023'; end if;
 select watch.* into target_watch from connector_private.google_gmail_watch_resources watch
 where watch.connection_id=target_job.connection_id for update;
 if found and target_watch.channel_key_hash=target_channel_key_hash
    and target_watch.resource_key_hash=target_resource_key_hash
    and target_watch.expires_at=target_expires_at and target_watch.revoked_at is null then no_op:=true;
 elsif found then
   update connector_private.google_gmail_watch_resources set
    channel_key_hash=target_channel_key_hash,resource_key_hash=target_resource_key_hash,
    resource_version=resource_version+1,expires_at=target_expires_at,revoked_at=null,
    updated_at=target_occurred_at where id=target_watch.id returning * into target_watch;
 else
   insert into connector_private.google_gmail_watch_resources(
    workspace_id,connection_id,channel_key_hash,resource_key_hash,expires_at,created_at,updated_at
   ) values(target_job.workspace_id,target_job.connection_id,target_channel_key_hash,
    target_resource_key_hash,target_expires_at,target_occurred_at,target_occurred_at)
   returning * into target_watch;
 end if;
 select receipt.* into target_receipt from public.connector_receipt_events receipt
 where receipt.workspace_id=target_job.workspace_id
   and receipt.event_key='google.gmail.watch:'||target_watch.connection_id::text||':'||target_watch.resource_version::text;
 if not found then
  insert into public.connector_receipt_events(workspace_id,connection_id,provider,job_id,intent_id,
   intent_version_id,event_type,event_key,correlation_id,fencing_token,provider_request_hash,
   redacted_metadata,occurred_at) values(target_job.workspace_id,target_job.connection_id,'google',
   target_job.id,target_job.intent_id,target_job.intent_version_id,'sync.applied',
   'google.gmail.watch:'||target_watch.connection_id::text||':'||target_watch.resource_version::text,
   target_job.correlation_id,target_job.fencing_token,target_resource_key_hash,
   jsonb_build_object('resourceVersion',target_watch.resource_version,'expiresAt',target_expires_at),
   target_occurred_at) returning * into target_receipt;
 end if;
 return jsonb_build_object('watch',jsonb_build_object('connectionId',target_watch.connection_id,
  'resourceVersion',target_watch.resource_version,'expiresAt',target_watch.expires_at),
  'receipt',to_jsonb(target_receipt),'noOp',no_op);
end; $$;

create or replace function public.bind_google_calendar_resource(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_provider_calendar_id text,target_resource_key_hash text,target_etag_hash text,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_calendar connector_private.google_calendar_resources%rowtype;
 target_receipt public.connector_receipt_events%rowtype; no_op boolean:=false;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type<>'calendar.create-omnix-calendar'
    or length(target_provider_calendar_id) not between 1 and 1024 or target_provider_calendar_id ~ '[[:cntrl:]]'
    or target_resource_key_hash !~ '^[0-9a-f]{64}$' or target_etag_hash !~ '^[0-9a-f]{64}$' then
   raise exception 'invalid Google Calendar resource binding' using errcode='22023'; end if;
 select resource.* into target_calendar from connector_private.google_calendar_resources resource
 where resource.connection_id=target_job.connection_id for update;
 if found then
   if target_calendar.calendar_external_id<>target_provider_calendar_id
      or target_calendar.resource_key_hash<>target_resource_key_hash then
     raise exception 'Omnix Google Calendar resource conflict' using errcode='23505'; end if;
   if target_calendar.etag_hash=target_etag_hash and target_calendar.deleted_at is null then no_op:=true;
   else update connector_private.google_calendar_resources set etag_hash=target_etag_hash,
     resource_version=resource_version+1,deleted_at=null,updated_at=target_occurred_at
     where id=target_calendar.id returning * into target_calendar; end if;
 else
   insert into connector_private.google_calendar_resources(
    workspace_id,connection_id,calendar_external_id,resource_key_hash,etag_hash,
    created_job_id,created_at,updated_at
   ) values(target_job.workspace_id,target_job.connection_id,target_provider_calendar_id,
    target_resource_key_hash,target_etag_hash,target_job.id,target_occurred_at,target_occurred_at)
   returning * into target_calendar;
 end if;
 select receipt.* into target_receipt from public.connector_receipt_events receipt
 where receipt.workspace_id=target_job.workspace_id
  and receipt.event_key='google.calendar.bound:'||target_calendar.connection_id::text||':'||target_calendar.resource_version::text;
 if not found then insert into public.connector_receipt_events(workspace_id,connection_id,provider,
  job_id,intent_id,intent_version_id,event_type,event_key,correlation_id,fencing_token,
  provider_request_hash,redacted_metadata,occurred_at) values(target_job.workspace_id,
  target_job.connection_id,'google',target_job.id,target_job.intent_id,target_job.intent_version_id,
  'sync.applied','google.calendar.bound:'||target_calendar.connection_id::text||':'||target_calendar.resource_version::text,
  target_job.correlation_id,target_job.fencing_token,target_resource_key_hash,
  jsonb_build_object('resourceVersion',target_calendar.resource_version),target_occurred_at)
  returning * into target_receipt; end if;
 return jsonb_build_object('calendar',jsonb_build_object('connectionId',target_calendar.connection_id,
  'resourceKeyHash',target_calendar.resource_key_hash,'resourceVersion',target_calendar.resource_version,
  'createdAt',target_calendar.created_at),'receipt',to_jsonb(target_receipt),'noOp',no_op);
end; $$;

create or replace function public.bind_google_task_event_resource(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_task_id uuid,
  target_task_version integer,target_provider_event_id text,target_resource_key_hash text,
  target_etag_hash text,target_provider_updated_at timestamptz,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_task public.tasks%rowtype;
 target_calendar connector_private.google_calendar_resources%rowtype;
 target_resource connector_private.google_calendar_task_resources%rowtype;
 target_state public.google_calendar_task_states%rowtype; target_receipt public.connector_receipt_events%rowtype;
 no_op boolean:=false;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type<>'calendar.upsert-omnix-event'
    or target_provider_event_id !~ '^[A-Za-z0-9_-]+$' or length(target_provider_event_id)>1024
    or target_resource_key_hash !~ '^[0-9a-f]{64}$' or target_etag_hash !~ '^[0-9a-f]{64}$' then
  raise exception 'invalid Google task event binding' using errcode='22023'; end if;
 select task.* into target_task from public.tasks task where task.id=target_task_id
  and task.workspace_id=target_job.workspace_id for update;
 if not found or target_task.task_version<>target_task_version then
  raise exception 'current Omnix task version required' using errcode='40001'; end if;
 select calendar.* into target_calendar from connector_private.google_calendar_resources calendar
  where calendar.connection_id=target_job.connection_id and calendar.deleted_at is null;
 if not found then raise exception 'Omnix-created Google Calendar required' using errcode='P0002'; end if;
 select resource.* into target_resource from connector_private.google_calendar_task_resources resource
 where resource.connection_id=target_job.connection_id and resource.task_id=target_task_id for update;
 if found then
  if target_resource.resource_key_hash<>target_resource_key_hash
     or target_resource.event_external_id<>target_provider_event_id then
   raise exception 'Google task resource key conflict' using errcode='23505'; end if;
  if target_resource.task_version=target_task_version and target_resource.etag_hash=target_etag_hash then no_op:=true;
  else update connector_private.google_calendar_task_resources set task_version=target_task_version,
    etag_hash=target_etag_hash,provider_updated_at=target_provider_updated_at,
    created_job_id=target_job.id,updated_at=target_occurred_at where id=target_resource.id
    returning * into target_resource; end if;
 else
  insert into connector_private.google_calendar_task_resources(workspace_id,connection_id,
   calendar_resource_id,task_id,task_version,event_external_id,resource_key_hash,etag_hash,
   provider_updated_at,created_job_id,created_at,updated_at) values(target_job.workspace_id,
   target_job.connection_id,target_calendar.id,target_task.id,target_task_version,
   target_provider_event_id,target_resource_key_hash,target_etag_hash,target_provider_updated_at,
   target_job.id,target_occurred_at,target_occurred_at) returning * into target_resource;
 end if;
 insert into public.google_calendar_task_states(workspace_id,connection_id,task_id,task_version,
  resource_key_hash,state,provider_updated_at,last_error_category,correlation_id,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,target_task.id,target_task_version,
  target_resource_key_hash,'synced',target_provider_updated_at,null,target_job.correlation_id,
  target_occurred_at,target_occurred_at) on conflict(connection_id,task_id) do update set
  task_version=excluded.task_version,resource_key_hash=excluded.resource_key_hash,state='synced',
  provider_updated_at=excluded.provider_updated_at,last_error_category=null,
  correlation_id=excluded.correlation_id,updated_at=excluded.updated_at returning * into target_state;
 select receipt.* into target_receipt from public.connector_receipt_events receipt
 where receipt.workspace_id=target_job.workspace_id and receipt.event_key=
  'google.calendar.task:'||target_job.connection_id::text||':'||target_task.id::text||':'||target_task_version::text;
 if not found then insert into public.connector_receipt_events(workspace_id,connection_id,provider,
  job_id,intent_id,intent_version_id,event_type,event_key,correlation_id,fencing_token,
  provider_request_hash,redacted_metadata,occurred_at) values(target_job.workspace_id,
  target_job.connection_id,'google',target_job.id,target_job.intent_id,target_job.intent_version_id,
  'sync.applied','google.calendar.task:'||target_job.connection_id::text||':'||target_task.id::text||':'||target_task_version::text,
  target_job.correlation_id,target_job.fencing_token,target_resource_key_hash,
  jsonb_build_object('taskId',target_task.id,'taskVersion',target_task_version,
   'resourceKeyHash',target_resource_key_hash),target_occurred_at) returning * into target_receipt; end if;
 return jsonb_build_object('taskState',to_jsonb(target_state),'receipt',to_jsonb(target_receipt),'noOp',no_op);
end; $$;

create or replace function public.record_google_calendar_task_conflict(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_task_id uuid,
  target_task_version integer,target_resource_key_hash text,target_reason text,
  target_provider_updated_at timestamptz,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_task public.tasks%rowtype;
 target_state public.google_calendar_task_states%rowtype; target_receipt public.connector_receipt_events%rowtype;
begin
 target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
 if target_job.action_type not in ('calendar.sync','calendar.upsert-omnix-event')
    or target_resource_key_hash !~ '^[0-9a-f]{64}$'
    or target_reason not in ('remote-edited','remote-deleted','task-version-drift','timezone-invalid') then
  raise exception 'invalid Google task conflict' using errcode='22023'; end if;
 select task.* into target_task from public.tasks task where task.id=target_task_id
  and task.workspace_id=target_job.workspace_id;
 if not found then raise exception 'Omnix task not found' using errcode='P0002'; end if;
 insert into public.google_calendar_task_states(workspace_id,connection_id,task_id,task_version,
  resource_key_hash,state,provider_updated_at,last_error_category,correlation_id,created_at,updated_at)
 values(target_job.workspace_id,target_job.connection_id,target_task.id,target_task_version,
  target_resource_key_hash,case when target_reason='remote-deleted' then 'remote-deleted' else 'conflict' end,
  target_provider_updated_at,replace(target_reason,'-','_'),target_job.correlation_id,
  target_occurred_at,target_occurred_at) on conflict(connection_id,task_id) do update set
  task_version=excluded.task_version,resource_key_hash=excluded.resource_key_hash,
  state=excluded.state,provider_updated_at=excluded.provider_updated_at,
  last_error_category=excluded.last_error_category,correlation_id=excluded.correlation_id,
  updated_at=excluded.updated_at returning * into target_state;
 insert into public.connector_receipt_events(workspace_id,connection_id,provider,job_id,intent_id,
  intent_version_id,event_type,event_key,correlation_id,fencing_token,provider_request_hash,
  error_category,reconciliation_result,redacted_metadata,occurred_at) values(target_job.workspace_id,
  target_job.connection_id,'google',target_job.id,target_job.intent_id,target_job.intent_version_id,
  'sync.reviewed','google.calendar.task-conflict:'||target_job.id::text||':'||target_task.id::text||':'||target_task_version::text,
  target_job.correlation_id,target_job.fencing_token,target_resource_key_hash,replace(target_reason,'-','_'),
  'review-required',jsonb_build_object('taskId',target_task.id,'taskVersion',target_task_version,
  'reason',target_reason),target_occurred_at) returning * into target_receipt;
 return jsonb_build_object('taskState',to_jsonb(target_state),'receipt',to_jsonb(target_receipt),'noOp',false);
end; $$;

create or replace function public.bind_google_gmail_send_resource(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_message_id text,target_thread_id text,target_operation_hash text,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_job public.connector_jobs%rowtype;
  target_intent_version public.connector_action_intent_versions%rowtype;
  target_draft public.google_email_drafts%rowtype;
  target_activity public.activity_events%rowtype;
  target_resource connector_private.google_gmail_resources%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  target_actor_membership_id uuid;
begin
  target_job:=connector_private.google_authorized_job(
    target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
  if target_job.action_type<>'gmail.send'
     or target_message_id !~ '^[A-Za-z0-9_-]+$' or length(target_message_id)>256
     or target_thread_id !~ '^[A-Za-z0-9_-]+$' or length(target_thread_id)>256
     or target_operation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Gmail send resource binding' using errcode='22023';
  end if;
  select resource.* into target_resource from connector_private.google_gmail_resources resource
  where resource.connection_id=target_job.connection_id and resource.source_job_id=target_job.id for update;
  if found then
    if target_resource.message_external_id<>target_message_id
       or target_resource.thread_external_id<>target_thread_id
       or target_resource.resource_hash<>target_operation_hash then
      raise exception 'Gmail send resource replay conflicts' using errcode='23505';
    end if;
    select draft.* into strict target_draft from public.google_email_drafts draft
    where draft.id=target_resource.draft_id and draft.sent_job_id=target_job.id;
    select event.* into strict target_activity from public.activity_events event
    where event.id=target_resource.activity_event_id;
    select receipt.* into strict target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_job.workspace_id
      and receipt.event_key='google.gmail.send-linked:'||target_job.id::text;
    return jsonb_build_object('resource',jsonb_build_object(
      'resourceHash',target_resource.resource_hash,'draftId',target_resource.draft_id,
      'contactId',target_resource.contact_id,'contactPointId',target_resource.contact_point_id,
      'activityEventId',target_resource.activity_event_id),
      'draft',to_jsonb(target_draft),'activity',to_jsonb(target_activity),
      'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  select version.* into strict target_intent_version
  from public.connector_action_intent_versions version
  where version.id=target_job.intent_version_id and version.intent_id=target_job.intent_id
    and version.version=target_job.intent_version and version.connection_id=target_job.connection_id
    and version.action_type='gmail.send' and version.payload_ref=target_job.payload_ref
    and version.payload_hash=target_job.payload_hash;
  select draft.* into target_draft from public.google_email_drafts draft
  where draft.workspace_id=target_job.workspace_id and draft.connection_id=target_job.connection_id
    and draft.status='intent-prepared' and draft.prepared_intent_id=target_job.intent_id
    and draft.prepared_intent_version=target_job.intent_version
    and draft.current_payload_ref=target_job.payload_ref
    and draft.current_payload_hash=target_job.payload_hash for update;
  if not found
     or target_intent_version.compliance_snapshot->>'draftId'<>target_draft.id::text
     or (target_intent_version.compliance_snapshot->>'draftVersion')::integer<>target_draft.current_version
     or target_intent_version.compliance_snapshot->>'contactId'<>target_draft.contact_id::text
     or target_intent_version.compliance_snapshot->>'contactPointId'<>target_draft.contact_point_id::text
     or target_intent_version.compliance_snapshot->>'recipientHash'<>target_draft.recipient_hash then
    raise exception 'exact approved Gmail draft binding required' using errcode='42501';
  end if;
  perform 1 from public.contact_points point
  where point.id=target_draft.contact_point_id and point.workspace_id=target_draft.workspace_id
    and point.contact_id=target_draft.contact_id and point.type='email';
  if not found then raise exception 'canonical Gmail draft contact point required' using errcode='P0002'; end if;
  select approval.actor_membership_id into target_actor_membership_id
  from public.connector_approval_events approval
  where approval.intent_id=target_job.intent_id and approval.intent_version_id=target_job.intent_version_id
    and approval.decision='approved' order by approval.occurred_at desc limit 1;
  if target_actor_membership_id is null then
    raise exception 'owner approval evidence required for Gmail send binding' using errcode='P0002';
  end if;
  insert into public.activity_events(workspace_id,type,contact_id,actor_membership_id,
    occurred_at,idempotency_key) values(target_job.workspace_id,
    'email-sent'::public.crm_activity_event_type_v2,target_draft.contact_id,
    target_actor_membership_id,target_occurred_at,
    'google-gmail-send:'||target_job.id::text)
  on conflict(workspace_id,idempotency_key) do nothing returning * into target_activity;
  if target_activity.id is null then
    select event.* into strict target_activity from public.activity_events event
    where event.workspace_id=target_job.workspace_id
      and event.idempotency_key='google-gmail-send:'||target_job.id::text;
  end if;
  insert into connector_private.google_gmail_resources(
    workspace_id,connection_id,message_external_id,thread_external_id,resource_hash,
    counterpart_hash,direction,labels,provider_occurred_at,contact_id,contact_point_id,
    activity_event_id,source_job_id,draft_id,review_reason,correlation_id,created_at,updated_at
  ) values(target_job.workspace_id,target_job.connection_id,target_message_id,target_thread_id,
    target_operation_hash,target_draft.recipient_hash,'outgoing',array['SENT'],target_occurred_at,
    target_draft.contact_id,target_draft.contact_point_id,target_activity.id,target_job.id,
    target_draft.id,null,target_job.correlation_id,target_occurred_at,target_occurred_at)
  returning * into target_resource;
  update public.google_email_drafts set status='sent',prepared_intent_id=null,
    prepared_intent_version=null,sent_job_id=target_job.id,sent_at=target_occurred_at,
    correlation_id=target_job.correlation_id,updated_at=target_occurred_at
  where id=target_draft.id returning * into target_draft;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,
    event_key,correlation_id,attempt_number,fencing_token,provider_request_hash,
    reconciliation_result,redacted_metadata,occurred_at
  ) values(target_job.workspace_id,target_job.connection_id,'google',target_job.id,
    target_job.intent_id,target_job.intent_version_id,'gmail.send-linked',
    'google.gmail.send-linked:'||target_job.id::text,target_job.correlation_id,
    target_job.attempt_count,target_job.fencing_token,target_operation_hash,'linked',
    jsonb_build_object('resourceHash',target_operation_hash,'draftId',target_draft.id,
      'draftVersion',target_draft.current_version,'contactId',target_draft.contact_id,
      'contactPointId',target_draft.contact_point_id,'activityEventId',target_activity.id),
    target_occurred_at) returning * into target_receipt;
  return jsonb_build_object('resource',jsonb_build_object(
    'resourceHash',target_resource.resource_hash,'draftId',target_resource.draft_id,
    'contactId',target_resource.contact_id,'contactPointId',target_resource.contact_point_id,
    'activityEventId',target_resource.activity_event_id),
    'draft',to_jsonb(target_draft),'activity',to_jsonb(target_activity),
    'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.bind_google_gmail_metadata_resource(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_message_id text,target_thread_id text,target_direction text,
  target_normalized_counterpart_email text,target_counterpart_kind text,
  target_labels text[],target_provider_occurred_at timestamptz,
  target_resource_hash text,target_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_job public.connector_jobs%rowtype; target_connection public.connector_connections%rowtype;
  target_resource connector_private.google_gmail_resources%rowtype;
  target_review public.google_gmail_metadata_reviews%rowtype;
  target_receipt public.connector_receipt_events%rowtype; target_activity public.activity_events%rowtype;
  actor public.workspace_members%rowtype; matched_point public.contact_points%rowtype;
  matched_contact public.contacts%rowtype; counterpart_hash text; resolution text;
  active_count integer; archived_count integer;
begin
  target_job:=connector_private.google_authorized_job(target_job_id,target_worker_id,target_fencing_token,target_occurred_at);
  if target_job.action_type<>'gmail.sync-metadata'
     or target_message_id !~ '^[A-Za-z0-9_-]+$' or length(target_message_id)>256
     or target_thread_id !~ '^[A-Za-z0-9_-]+$' or length(target_thread_id)>256
     or target_direction not in ('incoming','outgoing')
     or target_counterpart_kind not in ('single','self-only','group-address')
     or target_resource_hash !~ '^[0-9a-f]{64}$'
     or target_normalized_counterpart_email<>public.normalize_contact_email(target_normalized_counterpart_email)
     or not public.is_valid_contact_email(target_normalized_counterpart_email)
     or cardinality(target_labels)>100
     or exists(select 1 from unnest(target_labels) label
       where length(label) not between 1 and 200 or label ~ '[[:cntrl:]]') then
    raise exception 'invalid minimized Gmail metadata item' using errcode='22023';
  end if;
  counterpart_hash:=encode(extensions.digest(pg_catalog.convert_to(target_normalized_counterpart_email,'UTF8'),'sha256'),'hex');
  select resource.* into target_resource from connector_private.google_gmail_resources resource
  where resource.connection_id=target_job.connection_id and resource.resource_hash=target_resource_hash for update;
  if found then
    if target_resource.message_external_id<>target_message_id
       or target_resource.thread_external_id<>target_thread_id
       or target_resource.direction<>target_direction
       or target_resource.counterpart_hash<>counterpart_hash
       or target_resource.provider_occurred_at<>target_provider_occurred_at
       or target_resource.labels<>target_labels then
      raise exception 'Gmail metadata replay conflicts' using errcode='23505';
    end if;
    if target_resource.review_reason is not null then
      select review.* into target_review from public.google_gmail_metadata_reviews review
      where review.connection_id=target_job.connection_id and review.resource_hash=target_resource_hash;
    end if;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_job.workspace_id
      and receipt.event_key='google.gmail.metadata:'||target_resource_hash;
    return jsonb_build_object('resource',jsonb_build_object('resourceHash',target_resource.resource_hash,
      'linkState',case when target_resource.review_reason is null then 'linked' else 'review' end,
      'contactId',target_resource.contact_id,'contactPointId',target_resource.contact_point_id,
      'activityEventId',target_resource.activity_event_id),
      'review',case when target_review.id is null then null else to_jsonb(target_review) end,
      'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_job.connection_id;
  if target_counterpart_kind='self-only'
     or target_normalized_counterpart_email=public.normalize_contact_email(target_connection.display_label) then
    resolution:='self-only';
  elsif target_counterpart_kind='group-address' then resolution:='group-address';
  else
    select count(*)::integer into active_count from public.contact_points point
    join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
    where point.workspace_id=target_job.workspace_id and point.type='email'
      and point.normalized_value=target_normalized_counterpart_email
      and point.archived_at is null and contact.archived_at is null;
    if active_count=1 then
      select point.* into matched_point
      from public.contact_points point
      join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
      where point.workspace_id=target_job.workspace_id and point.type='email'
        and point.normalized_value=target_normalized_counterpart_email
        and point.archived_at is null and contact.archived_at is null;
      select contact.* into strict matched_contact from public.contacts contact
      where contact.id=matched_point.contact_id and contact.workspace_id=matched_point.workspace_id;
      resolution:=null;
    elsif active_count>1 then resolution:='shared-email';
    else
      select count(*)::integer into archived_count from public.contact_points point
      join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
      where point.workspace_id=target_job.workspace_id and point.type='email'
        and point.normalized_value=target_normalized_counterpart_email
        and (point.archived_at is not null or contact.archived_at is not null);
      resolution:=case when archived_count>0 then 'archived-email' else 'no-canonical-match' end;
    end if;
  end if;
  if resolution is null then
    select membership.* into actor from public.workspace_members membership
    where membership.workspace_id=target_job.workspace_id and membership.role='owner'
      and membership.status='active'
    order by (membership.id=target_connection.created_by_membership_id) desc,membership.created_at,membership.id
    limit 1;
    if not found then raise exception 'active owner required for Gmail activity evidence' using errcode='42501'; end if;
    insert into public.activity_events(workspace_id,type,contact_id,actor_membership_id,
      occurred_at,idempotency_key) values(target_job.workspace_id,
      'email-metadata-linked'::public.crm_activity_event_type_v2,matched_contact.id,actor.id,
      target_provider_occurred_at,'google-gmail:'||target_resource_hash)
    on conflict(workspace_id,idempotency_key) do nothing
    returning * into target_activity;
    if target_activity.id is null then
      select event.* into strict target_activity from public.activity_events event
      where event.workspace_id=target_job.workspace_id
        and event.idempotency_key='google-gmail:'||target_resource_hash;
    end if;
  end if;
  insert into connector_private.google_gmail_resources(
    workspace_id,connection_id,message_external_id,thread_external_id,resource_hash,
    counterpart_hash,direction,labels,provider_occurred_at,contact_id,contact_point_id,
    activity_event_id,review_reason,correlation_id,created_at,updated_at
  ) values(target_job.workspace_id,target_job.connection_id,target_message_id,target_thread_id,
    target_resource_hash,counterpart_hash,target_direction,target_labels,target_provider_occurred_at,
    matched_contact.id,matched_point.id,target_activity.id,resolution,target_job.correlation_id,
    target_occurred_at,target_occurred_at) returning * into target_resource;
  if resolution is not null then
    insert into public.google_gmail_metadata_reviews(workspace_id,connection_id,resource_hash,
      counterpart_hash,reason,direction,provider_occurred_at,correlation_id,occurred_at,created_at)
    values(target_job.workspace_id,target_job.connection_id,target_resource_hash,counterpart_hash,
      resolution,target_direction,target_provider_occurred_at,target_job.correlation_id,
      target_occurred_at,target_occurred_at) returning * into target_review;
  end if;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,event_key,
    correlation_id,fencing_token,provider_request_hash,error_category,reconciliation_result,
    redacted_metadata,occurred_at
  ) values(target_job.workspace_id,target_job.connection_id,'google',target_job.id,
    target_job.intent_id,target_job.intent_version_id,
    case when resolution is null then 'sync.applied'::public.connector_receipt_event_type
      else 'sync.reviewed'::public.connector_receipt_event_type end,
    'google.gmail.metadata:'||target_resource_hash,target_job.correlation_id,
    target_job.fencing_token,target_resource_hash,resolution,
    case when resolution is null then 'linked' else 'review-required' end,
    jsonb_build_object('resourceHash',target_resource_hash,'direction',target_direction,
      'linkState',case when resolution is null then 'linked' else 'review' end,
      'contactId',matched_contact.id,'contactPointId',matched_point.id,
      'activityEventId',target_activity.id,'reviewReason',resolution),target_occurred_at)
  returning * into target_receipt;
  return jsonb_build_object('resource',jsonb_build_object('resourceHash',target_resource.resource_hash,
    'linkState',case when resolution is null then 'linked' else 'review' end,
    'contactId',target_resource.contact_id,'contactPointId',target_resource.contact_point_id,
    'activityEventId',target_resource.activity_event_id),
    'review',case when target_review.id is null then null else to_jsonb(target_review) end,
    'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

-- Disconnect preserves CRM history/resources but disables capabilities,
-- cursors/watches and new external operations. 0009 cryptoshreds the tokens.
create or replace function public.prepare_google_disconnect_state()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.provider='google' and new.status in ('disconnected','disconnected_unconfirmed')
    and old.status is distinct from new.status then
  update public.google_connection_capabilities set state='revoked',revoked_at=new.disconnected_at,
    last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
    updated_at=new.disconnected_at where connection_id=new.id;
  update public.google_sync_health set state='disabled',
    last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
    updated_at=new.disconnected_at where connection_id=new.id;
  update connector_private.google_gmail_watch_resources set revoked_at=new.disconnected_at,
    updated_at=new.disconnected_at where connection_id=new.id and revoked_at is null;
  update public.google_calendar_task_states set state='disconnected',
    last_error_category=case when new.status='disconnected' then 'disconnected' else 'disconnect_unconfirmed' end,
    updated_at=new.disconnected_at where connection_id=new.id;
 end if;
 return new;
end; $$;

create trigger connector_connections_google_disconnect_state
after update of status on public.connector_connections
for each row execute function public.prepare_google_disconnect_state();

-- Grants ------------------------------------------------------------------

revoke all on function public.begin_google_oauth(uuid,uuid,text,uuid,text,text,text,text,
  bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.consume_google_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.finalize_google_oauth(uuid,uuid,uuid,uuid,text,text,text[],integer,
  jsonb,integer,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_google_connection_capability_state(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.create_google_email_draft(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.edit_google_email_draft(uuid,integer,text,text,jsonb,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.archive_google_email_draft(uuid,integer,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.prepare_google_gmail_send_intent(uuid,integer,text,uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.read_google_job_authority(uuid,uuid,bigint,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.refresh_google_job_access_token(uuid,uuid,bigint,integer,jsonb,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.commit_google_sync_checkpoint(uuid,uuid,bigint,text,integer,jsonb,
  text,boolean,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.mark_google_sync_cursor_expired(uuid,uuid,bigint,text,integer,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.bind_google_gmail_watch_resource(uuid,uuid,bigint,text,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.bind_google_calendar_resource(uuid,uuid,bigint,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.bind_google_task_event_resource(uuid,uuid,bigint,uuid,integer,text,text,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.record_google_calendar_task_conflict(uuid,uuid,bigint,uuid,integer,text,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.bind_google_gmail_metadata_resource(uuid,uuid,bigint,text,text,text,text,text,text[],timestamptz,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.bind_google_gmail_send_resource(uuid,uuid,bigint,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;

grant execute on function public.begin_google_oauth(uuid,uuid,text,uuid,text,text,text,text,
  bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.read_google_connection_capability_state(uuid) to authenticated;
grant execute on function public.create_google_email_draft(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid,timestamptz) to authenticated;
grant execute on function public.edit_google_email_draft(uuid,integer,text,text,jsonb,uuid,timestamptz) to authenticated;
grant execute on function public.archive_google_email_draft(uuid,integer,uuid,timestamptz) to authenticated;
grant execute on function public.prepare_google_gmail_send_intent(uuid,integer,text,uuid,timestamptz) to authenticated;
grant execute on function public.consume_google_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.finalize_google_oauth(uuid,uuid,uuid,uuid,text,text,text[],integer,
  jsonb,integer,jsonb,uuid,timestamptz) to service_role;
grant execute on function public.read_google_job_authority(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.refresh_google_job_access_token(uuid,uuid,bigint,integer,jsonb,timestamptz) to service_role;
grant execute on function public.commit_google_sync_checkpoint(uuid,uuid,bigint,text,integer,jsonb,
  text,boolean,timestamptz,timestamptz) to service_role;
grant execute on function public.mark_google_sync_cursor_expired(uuid,uuid,bigint,text,integer,text,timestamptz) to service_role;
grant execute on function public.bind_google_gmail_watch_resource(uuid,uuid,bigint,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.bind_google_calendar_resource(uuid,uuid,bigint,text,text,text,timestamptz) to service_role;
grant execute on function public.bind_google_task_event_resource(uuid,uuid,bigint,uuid,integer,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.record_google_calendar_task_conflict(uuid,uuid,bigint,uuid,integer,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.bind_google_gmail_metadata_resource(uuid,uuid,bigint,text,text,text,text,text,text[],timestamptz,text,timestamptz) to service_role;
grant execute on function public.bind_google_gmail_send_resource(uuid,uuid,bigint,text,text,text,timestamptz) to service_role;

revoke all on function public.prepare_google_task_version() from public,anon,authenticated,service_role;
revoke all on function public.prepare_google_disconnect_state() from public,anon,authenticated,service_role;

commit;
