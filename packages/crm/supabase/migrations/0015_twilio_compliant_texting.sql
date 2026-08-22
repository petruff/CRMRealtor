-- Omnix — Twilio compliant texting authority
-- Story 4.3: workspace-scoped Twilio readiness, canonical phone consent,
-- encrypted message content, immutable approvals, signed callback replay,
-- STOP-first suppression, monotonic delivery and bounded reconciliation.
--
-- Forward-only migration. Apply after 0014_google_connector_authority.sql.
-- Provider credentials and message bodies remain in connector_private encrypted
-- envelopes. The pre-write rollback is documented separately.

begin;

create type public.twilio_registration_state as enum (
  'not_configured', 'pending', 'approved', 'rejected', 'expired', 'not_required'
);

create type public.twilio_readiness_state as enum (
  'approval_blocked', 'registration_pending', 'configured_disabled', 'active',
  'degraded', 'credential_required', 'disconnected'
);

create type public.texting_consent_status as enum ('unknown', 'opted_in', 'opted_out');
create type public.texting_direction as enum ('inbound', 'outbound');
create type public.texting_keyword_class as enum ('stop', 'help', 'start', 'unsupported', 'none');
create type public.texting_draft_state as enum ('draft', 'prepared', 'sent', 'archived');
create type public.texting_message_status as enum (
  'queued', 'accepted', 'scheduled', 'sending', 'sent', 'delivered', 'read',
  'failed', 'undelivered', 'canceled', 'reconciliation_required', 'received'
);
create type public.twilio_callback_kind as enum ('inbound', 'status');
create type public.twilio_callback_state as enum ('accepted', 'applied', 'review', 'rejected');
create type public.twilio_reconciliation_state as enum (
  'queued', 'leased', 'executing', 'retry_wait', 'succeeded', 'failed'
);

-- Redacted provider and compliance authority --------------------------------

create table public.twilio_connection_authorities (
  id                            uuid primary key default gen_random_uuid(),
  workspace_id                  uuid not null references public.workspaces(id) on delete restrict,
  connection_id                 uuid not null,
  account_sid_hash              text not null,
  api_key_sid_hash              text not null,
  messaging_service_sid_hash    text,
  sender_key_hash               text not null,
  sender_kind                   text not null,
  registration_state            public.twilio_registration_state not null,
  registration_evidence_hash    text,
  approved_use_case             text not null,
  callback_external_url_hash    text not null,
  callback_verified_at          timestamptz,
  real_number_uat_evidence_hash text,
  real_number_uat_at            timestamptz,
  restricted_credential         boolean not null default false,
  sender_ownership_verified_at  timestamptz,
  enabled                       boolean not null default false,
  readiness_state               public.twilio_readiness_state not null default 'approval_blocked',
  last_readiness_at             timestamptz not null,
  created_by_membership_id      uuid not null,
  updated_by_membership_id      uuid not null,
  created_at                    timestamptz not null,
  updated_at                    timestamptz not null,

  constraint twilio_connection_authorities_connection_unique unique(connection_id),
  constraint twilio_connection_authorities_id_workspace_unique unique(id, workspace_id),
  constraint twilio_connection_authorities_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint twilio_connection_authorities_creator_workspace_fk
    foreign key(created_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint twilio_connection_authorities_updater_workspace_fk
    foreign key(updated_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint twilio_connection_authorities_hashes check (
    account_sid_hash ~ '^[0-9a-f]{64}$'
    and api_key_sid_hash ~ '^[0-9a-f]{64}$'
    and sender_key_hash ~ '^[0-9a-f]{64}$'
    and callback_external_url_hash ~ '^[0-9a-f]{64}$'
    and (messaging_service_sid_hash is null or messaging_service_sid_hash ~ '^[0-9a-f]{64}$')
    and (registration_evidence_hash is null or registration_evidence_hash ~ '^[0-9a-f]{64}$')
    and (real_number_uat_evidence_hash is null or real_number_uat_evidence_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint twilio_connection_authorities_sender_kind check (
    sender_kind in ('messaging_service', 'phone_number')
  ),
  constraint twilio_connection_authorities_use_case check (
    approved_use_case ~ '^[a-z][a-z0-9.-]{1,63}$'
  ),
  constraint twilio_connection_authorities_registration_evidence check (
    (registration_state in ('approved','not_required') and registration_evidence_hash is not null)
    or (registration_state not in ('approved','not_required'))
  ),
  constraint twilio_connection_authorities_uat_pair check (
    (real_number_uat_evidence_hash is null and real_number_uat_at is null)
    or (real_number_uat_evidence_hash is not null and real_number_uat_at is not null)
  )
);

create table public.twilio_compliance_policies (
  id                            uuid primary key default gen_random_uuid(),
  workspace_id                  uuid not null references public.workspaces(id) on delete restrict,
  connection_id                 uuid not null,
  use_case                      text not null,
  version                       integer not null,
  disclosure_version            text not null,
  policy_hash                   text not null,
  retention_days                integer not null,
  quiet_hours_start             time not null,
  quiet_hours_end               time not null,
  unknown_timezone_action       text not null,
  default_defer_minutes         integer,
  require_verified_timezone     boolean not null default true,
  keyword_configuration_hash    text not null,
  approved_by_membership_id     uuid not null,
  effective_at                  timestamptz not null,
  superseded_at                 timestamptz,
  correlation_id                uuid not null,
  created_at                    timestamptz not null,

  constraint twilio_compliance_policies_connection_version_unique
    unique(connection_id, use_case, version),
  constraint twilio_compliance_policies_id_workspace_unique unique(id, workspace_id),
  constraint twilio_compliance_policies_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint twilio_compliance_policies_approver_workspace_fk
    foreign key(approved_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint twilio_compliance_policies_values check (
    use_case ~ '^[a-z][a-z0-9.-]{1,63}$'
    and version > 0
    and length(disclosure_version) between 1 and 80
    and policy_hash ~ '^[0-9a-f]{64}$'
    and keyword_configuration_hash ~ '^[0-9a-f]{64}$'
    and retention_days between 1 and 3650
    and quiet_hours_start <> quiet_hours_end
    and unknown_timezone_action in ('block','defer')
    and ((unknown_timezone_action='block' and default_defer_minutes is null)
      or (unknown_timezone_action='defer' and default_defer_minutes between 15 and 1440))
    and (superseded_at is null or superseded_at >= effective_at)
  )
);

create unique index twilio_compliance_policies_active_unique_idx
  on public.twilio_compliance_policies(connection_id, use_case)
  where superseded_at is null;

create index twilio_connection_authorities_workspace_readiness_idx
  on public.twilio_connection_authorities(workspace_id, readiness_state, updated_at desc);

-- Append-only consent evidence and current projection -------------------------

create table public.texting_consent_events (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  use_case                   text not null,
  status                     public.texting_consent_status not null,
  collection_source          text not null,
  collection_method          text not null,
  disclosure_version         text not null,
  policy_id                  uuid not null,
  policy_version             integer not null,
  evidence_ref_hash          text not null,
  phone_hash                 text not null,
  recipient_timezone         text,
  timezone_source            text,
  actor_membership_id        uuid,
  provider_event_hash        text,
  correlation_id             uuid not null,
  occurred_at                timestamptz not null,
  created_at                 timestamptz not null default now(),

  constraint texting_consent_events_id_workspace_unique unique(id, workspace_id),
  constraint texting_consent_events_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_consent_events_contact_workspace_fk
    foreign key(contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint texting_consent_events_point_workspace_fk
    foreign key(contact_point_id, workspace_id)
    references public.contact_points(id, workspace_id) on delete restrict,
  constraint texting_consent_events_policy_workspace_fk
    foreign key(policy_id, workspace_id)
    references public.twilio_compliance_policies(id, workspace_id) on delete restrict,
  constraint texting_consent_events_actor_workspace_fk
    foreign key(actor_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint texting_consent_events_values check (
    use_case ~ '^[a-z][a-z0-9.-]{1,63}$'
    and policy_version > 0
    and length(collection_source) between 1 and 64
    and length(collection_method) between 1 and 64
    and length(disclosure_version) between 1 and 80
    and evidence_ref_hash ~ '^[0-9a-f]{64}$'
    and phone_hash ~ '^[0-9a-f]{64}$'
    and (provider_event_hash is null or provider_event_hash ~ '^[0-9a-f]{64}$')
    and ((recipient_timezone is null and timezone_source is null)
      or (recipient_timezone is not null and timezone_source is not null
        and length(recipient_timezone) between 1 and 120
        and length(timezone_source) between 1 and 64))
  )
);

create unique index texting_consent_events_provider_replay_unique_idx
  on public.texting_consent_events(workspace_id, connection_id, provider_event_hash)
  where provider_event_hash is not null;

create table public.texting_consent_states (
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  use_case                   text not null,
  status                     public.texting_consent_status not null,
  current_event_id           uuid not null,
  phone_hash                 text not null,
  disclosure_version         text not null,
  policy_id                  uuid not null,
  policy_version             integer not null,
  recipient_timezone         text,
  timezone_source            text,
  effective_at               timestamptz not null,
  updated_at                 timestamptz not null,

  primary key(connection_id, contact_point_id, use_case),
  constraint texting_consent_states_workspace_point_unique
    unique(workspace_id, contact_point_id, use_case),
  constraint texting_consent_states_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_consent_states_contact_workspace_fk
    foreign key(contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint texting_consent_states_point_workspace_fk
    foreign key(contact_point_id, workspace_id)
    references public.contact_points(id, workspace_id) on delete restrict,
  constraint texting_consent_states_event_workspace_fk
    foreign key(current_event_id, workspace_id)
    references public.texting_consent_events(id, workspace_id) on delete restrict,
  constraint texting_consent_states_policy_workspace_fk
    foreign key(policy_id, workspace_id)
    references public.twilio_compliance_policies(id, workspace_id) on delete restrict,
  constraint texting_consent_states_values check (
    use_case ~ '^[a-z][a-z0-9.-]{1,63}$'
    and phone_hash ~ '^[0-9a-f]{64}$'
    and policy_version > 0
  )
);

create table public.texting_phone_suppressions (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  phone_hash                 text not null,
  use_case                   text not null,
  source_callback_id         uuid,
  source_consent_event_id    uuid,
  suppressed_at              timestamptz not null,
  released_at                timestamptz,
  release_consent_event_id   uuid,
  updated_at                 timestamptz not null,

  constraint texting_phone_suppressions_scope_unique
    unique(connection_id, phone_hash, use_case),
  constraint texting_phone_suppressions_id_workspace_unique unique(id, workspace_id),
  constraint texting_phone_suppressions_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_phone_suppressions_source_event_workspace_fk
    foreign key(source_consent_event_id, workspace_id)
    references public.texting_consent_events(id, workspace_id) on delete restrict,
  constraint texting_phone_suppressions_release_event_workspace_fk
    foreign key(release_consent_event_id, workspace_id)
    references public.texting_consent_events(id, workspace_id) on delete restrict,
  constraint texting_phone_suppressions_values check (
    phone_hash ~ '^[0-9a-f]{64}$'
    and use_case ~ '^[a-z][a-z0-9.-]{1,63}$'
    and (released_at is null or (released_at >= suppressed_at and release_consent_event_id is not null))
  )
);

create index texting_consent_states_workspace_contact_idx
  on public.texting_consent_states(workspace_id, contact_id, status, updated_at desc);
create index texting_phone_suppressions_active_idx
  on public.texting_phone_suppressions(workspace_id, connection_id, phone_hash, use_case)
  where released_at is null;

-- Redacted conversations, encrypted draft/content references and approvals ----

create table public.texting_conversations (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  use_case                   text not null,
  recipient_phone_hash       text not null,
  sender_key_hash            text not null,
  state                      text not null default 'active',
  last_message_at            timestamptz,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,

  constraint texting_conversations_scope_unique
    unique(connection_id, contact_point_id, use_case),
  constraint texting_conversations_id_workspace_unique unique(id, workspace_id),
  constraint texting_conversations_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_conversations_contact_workspace_fk
    foreign key(contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint texting_conversations_point_workspace_fk
    foreign key(contact_point_id, workspace_id)
    references public.contact_points(id, workspace_id) on delete restrict,
  constraint texting_conversations_values check (
    use_case ~ '^[a-z][a-z0-9.-]{1,63}$'
    and recipient_phone_hash ~ '^[0-9a-f]{64}$'
    and sender_key_hash ~ '^[0-9a-f]{64}$'
    and state in ('active','disabled','closed')
  )
);

create table public.texting_message_drafts (
  id                         uuid primary key,
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  conversation_id            uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  use_case                   text not null,
  current_version            integer not null,
  state                      public.texting_draft_state not null default 'draft',
  created_by_membership_id   uuid not null,
  correlation_id             uuid not null,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,
  archived_at                timestamptz,

  constraint texting_message_drafts_id_workspace_unique unique(id, workspace_id),
  constraint texting_message_drafts_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_message_drafts_conversation_workspace_fk
    foreign key(conversation_id, workspace_id)
    references public.texting_conversations(id, workspace_id) on delete restrict,
  constraint texting_message_drafts_contact_workspace_fk
    foreign key(contact_id, workspace_id)
    references public.contacts(id, workspace_id) on delete restrict,
  constraint texting_message_drafts_point_workspace_fk
    foreign key(contact_point_id, workspace_id)
    references public.contact_points(id, workspace_id) on delete restrict,
  constraint texting_message_drafts_creator_workspace_fk
    foreign key(created_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint texting_message_drafts_values check (
    use_case ~ '^[a-z][a-z0-9.-]{1,63}$' and current_version > 0
    and ((state='archived' and archived_at is not null)
      or (state<>'archived' and archived_at is null))
  )
);

create table public.texting_message_draft_versions (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  draft_id                   uuid not null,
  version                    integer not null,
  connection_id              uuid not null,
  contact_point_id           uuid not null,
  content_payload_ref        uuid not null,
  body_hash                  text not null,
  recipient_phone_hash       text not null,
  sender_key_hash            text not null,
  consent_event_id           uuid,
  texting_policy_id          uuid not null,
  texting_policy_version     integer not null,
  connector_intent_id        uuid,
  connector_intent_version_id uuid,
  created_by_membership_id   uuid not null,
  correlation_id             uuid not null,
  created_at                 timestamptz not null,

  constraint texting_message_draft_versions_draft_version_unique unique(draft_id, version),
  constraint texting_message_draft_versions_id_workspace_unique unique(id, workspace_id),
  constraint texting_message_draft_versions_draft_workspace_fk
    foreign key(draft_id, workspace_id)
    references public.texting_message_drafts(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_connection_workspace_fk
    foreign key(connection_id, workspace_id)
    references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_point_workspace_fk
    foreign key(contact_point_id, workspace_id)
    references public.contact_points(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_payload_workspace_fk
    foreign key(content_payload_ref, workspace_id)
    references connector_private.connector_payload_envelopes(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_consent_workspace_fk
    foreign key(consent_event_id, workspace_id)
    references public.texting_consent_events(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_policy_workspace_fk
    foreign key(texting_policy_id, workspace_id)
    references public.twilio_compliance_policies(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_intent_workspace_fk
    foreign key(connector_intent_id, workspace_id)
    references public.connector_action_intents(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_intent_version_workspace_fk
    foreign key(connector_intent_version_id, workspace_id)
    references public.connector_action_intent_versions(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_creator_workspace_fk
    foreign key(created_by_membership_id, workspace_id)
    references public.workspace_members(id, workspace_id) on delete restrict,
  constraint texting_message_draft_versions_values check (
    version > 0 and texting_policy_version > 0
    and body_hash ~ '^[0-9a-f]{64}$'
    and recipient_phone_hash ~ '^[0-9a-f]{64}$'
    and sender_key_hash ~ '^[0-9a-f]{64}$'
    and ((connector_intent_id is null and connector_intent_version_id is null)
      or (connector_intent_id is not null and connector_intent_version_id is not null))
  )
);

create table public.texting_send_approval_snapshots (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  draft_id                   uuid not null,
  draft_version_id           uuid not null,
  intent_id                  uuid not null,
  intent_version_id          uuid not null,
  approval_event_id          uuid not null,
  job_id                     uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  recipient_phone_hash       text not null,
  sender_key_hash            text not null,
  body_hash                  text not null,
  consent_event_id           uuid not null,
  consent_status             public.texting_consent_status not null,
  texting_policy_id          uuid not null,
  texting_policy_version     integer not null,
  connector_policy_id       uuid not null,
  connector_policy_version  integer not null,
  recipient_timezone        text,
  timezone_source           text,
  quiet_hours_start         time not null,
  quiet_hours_end           time not null,
  quiet_hours_decision      text not null,
  evaluated_at              timestamptz not null,
  scheduled_at              timestamptz not null,
  approved_by_membership_id uuid not null,
  correlation_id            uuid not null,
  created_at                timestamptz not null,

  constraint texting_send_approval_snapshots_intent_version_unique unique(intent_version_id),
  constraint texting_send_approval_snapshots_job_unique unique(job_id),
  constraint texting_send_approval_snapshots_id_workspace_unique unique(id, workspace_id),
  constraint texting_send_approval_snapshots_connection_workspace_fk
    foreign key(connection_id, workspace_id) references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_draft_workspace_fk
    foreign key(draft_id, workspace_id) references public.texting_message_drafts(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_draft_version_workspace_fk
    foreign key(draft_version_id, workspace_id) references public.texting_message_draft_versions(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_intent_workspace_fk
    foreign key(intent_id, workspace_id) references public.connector_action_intents(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_intent_version_workspace_fk
    foreign key(intent_version_id, workspace_id) references public.connector_action_intent_versions(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_job_workspace_fk
    foreign key(job_id, workspace_id) references public.connector_jobs(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_contact_workspace_fk
    foreign key(contact_id, workspace_id) references public.contacts(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_point_workspace_fk
    foreign key(contact_point_id, workspace_id) references public.contact_points(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_consent_workspace_fk
    foreign key(consent_event_id, workspace_id) references public.texting_consent_events(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_texting_policy_workspace_fk
    foreign key(texting_policy_id, workspace_id) references public.twilio_compliance_policies(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_connector_policy_workspace_fk
    foreign key(connector_policy_id, workspace_id) references public.connector_automation_policies(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_approver_workspace_fk
    foreign key(approved_by_membership_id, workspace_id) references public.workspace_members(id, workspace_id) on delete restrict,
  constraint texting_send_approval_snapshots_hashes check (
    recipient_phone_hash ~ '^[0-9a-f]{64}$' and sender_key_hash ~ '^[0-9a-f]{64}$'
    and body_hash ~ '^[0-9a-f]{64}$' and consent_status='opted_in'
    and texting_policy_version>0 and connector_policy_version>0
    and quiet_hours_start<>quiet_hours_end
    and quiet_hours_decision in ('send_now','defer')
    and scheduled_at>=evaluated_at
    and ((recipient_timezone is null and timezone_source is null and quiet_hours_decision='defer')
      or (recipient_timezone is not null and timezone_source is not null))
  )
);

create table public.texting_messages (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  conversation_id            uuid,
  contact_id                 uuid,
  contact_point_id           uuid,
  draft_version_id           uuid,
  approval_snapshot_id       uuid,
  job_id                     uuid,
  direction                  public.texting_direction not null,
  content_payload_ref        uuid,
  body_hash                  text not null,
  recipient_phone_hash       text not null,
  sender_key_hash            text not null,
  provider_message_sid_hash  text,
  status                     public.texting_message_status not null,
  status_rank                integer not null,
  provider_status_at         timestamptz,
  side_effect_started_at     timestamptz,
  accepted_at                timestamptz,
  terminal_at                timestamptz,
  last_error_category        text,
  correlation_id             uuid not null,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,

  constraint texting_messages_id_workspace_unique unique(id, workspace_id),
  constraint texting_messages_job_unique unique(job_id),
  constraint texting_messages_provider_sid_hash_unique unique(connection_id, provider_message_sid_hash),
  constraint texting_messages_connection_workspace_fk
    foreign key(connection_id, workspace_id) references public.connector_connections(id, workspace_id) on delete restrict,
  constraint texting_messages_conversation_workspace_fk
    foreign key(conversation_id, workspace_id) references public.texting_conversations(id, workspace_id) on delete restrict,
  constraint texting_messages_contact_workspace_fk
    foreign key(contact_id, workspace_id) references public.contacts(id, workspace_id) on delete restrict,
  constraint texting_messages_point_workspace_fk
    foreign key(contact_point_id, workspace_id) references public.contact_points(id, workspace_id) on delete restrict,
  constraint texting_messages_draft_version_workspace_fk
    foreign key(draft_version_id, workspace_id) references public.texting_message_draft_versions(id, workspace_id) on delete restrict,
  constraint texting_messages_snapshot_workspace_fk
    foreign key(approval_snapshot_id, workspace_id) references public.texting_send_approval_snapshots(id, workspace_id) on delete restrict,
  constraint texting_messages_job_workspace_fk
    foreign key(job_id, workspace_id) references public.connector_jobs(id, workspace_id) on delete restrict,
  constraint texting_messages_payload_workspace_fk
    foreign key(content_payload_ref, workspace_id) references connector_private.connector_payload_envelopes(id, workspace_id) on delete restrict,
  constraint texting_messages_values check (
    body_hash ~ '^[0-9a-f]{64}$' and recipient_phone_hash ~ '^[0-9a-f]{64}$'
    and sender_key_hash ~ '^[0-9a-f]{64}$'
    and (provider_message_sid_hash is null or provider_message_sid_hash ~ '^[0-9a-f]{64}$')
    and status_rank between 0 and 100
    and (last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$')
    and ((direction='outbound' and draft_version_id is not null and approval_snapshot_id is not null and job_id is not null)
      or direction='inbound')
  )
);

create index texting_messages_conversation_time_idx
  on public.texting_messages(workspace_id, conversation_id, created_at desc);
create index texting_messages_reconciliation_due_idx
  on public.texting_messages(connection_id, updated_at, id)
  where direction='outbound' and terminal_at is null;

-- Private provider identifiers and exact callback authority -------------------

create table connector_private.twilio_message_resources (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  message_id                 uuid not null,
  provider_message_sid       text not null,
  provider_message_sid_hash  text not null,
  created_at                 timestamptz not null,

  constraint twilio_message_resources_message_unique unique(message_id),
  constraint twilio_message_resources_sid_unique unique(connection_id, provider_message_sid),
  constraint twilio_message_resources_id_workspace_unique unique(id, workspace_id),
  constraint twilio_message_resources_connection_workspace_fk
    foreign key(connection_id, workspace_id) references public.connector_connections(id, workspace_id) on delete restrict,
  constraint twilio_message_resources_message_workspace_fk
    foreign key(message_id, workspace_id) references public.texting_messages(id, workspace_id) on delete restrict,
  constraint twilio_message_resources_values check (
    provider_message_sid ~ '^SM[0-9A-Fa-f]{32}$'
    and provider_message_sid_hash ~ '^[0-9a-f]{64}$'
  )
);

create table connector_private.twilio_callback_authorities (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  endpoint_key_hash          text not null unique,
  exact_external_url_hash    text not null,
  webhook_secret_type        text not null default 'twilio-webhook-auth-token',
  bound_at                   timestamptz not null,
  revoked_at                 timestamptz,

  constraint twilio_callback_authorities_connection_unique unique(connection_id),
  constraint twilio_callback_authorities_connection_workspace_fk
    foreign key(connection_id, workspace_id) references public.connector_connections(id, workspace_id) on delete restrict,
  constraint twilio_callback_authorities_values check (
    endpoint_key_hash ~ '^[0-9a-f]{64}$'
    and exact_external_url_hash ~ '^[0-9a-f]{64}$'
    and webhook_secret_type='twilio-webhook-auth-token'
    and (revoked_at is null or revoked_at>=bound_at)
  )
);

create table connector_private.twilio_specialized_approval_guards (
  intent_id          uuid primary key references public.connector_action_intents(id) on delete restrict,
  intent_version_id  uuid not null unique references public.connector_action_intent_versions(id) on delete restrict,
  transaction_id     bigint not null,
  created_at         timestamptz not null,
  constraint twilio_specialized_approval_guards_transaction check (transaction_id>0)
);

create table public.twilio_callback_events (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  webhook_delivery_id        uuid not null,
  callback_kind              public.twilio_callback_kind not null,
  state                      public.twilio_callback_state not null,
  replay_key_hash            text not null,
  raw_body_hash              text not null,
  parameters_hash            text not null,
  exact_external_url_hash    text not null,
  account_sid_hash           text not null,
  sender_key_hash            text not null,
  provider_message_sid_hash  text not null,
  counterpart_phone_hash     text not null,
  keyword_class              public.texting_keyword_class not null,
  provider_status            text,
  content_payload_ref        uuid,
  message_id                 uuid,
  review_reason              text,
  correlation_id             uuid not null,
  received_at                timestamptz not null,
  processed_at               timestamptz,

  constraint twilio_callback_events_replay_unique unique(connection_id, replay_key_hash),
  constraint twilio_callback_events_id_workspace_unique unique(id, workspace_id),
  constraint twilio_callback_events_connection_workspace_fk
    foreign key(connection_id, workspace_id) references public.connector_connections(id, workspace_id) on delete restrict,
  constraint twilio_callback_events_delivery_workspace_fk
    foreign key(webhook_delivery_id, workspace_id) references public.connector_webhook_deliveries(id, workspace_id) on delete restrict,
  constraint twilio_callback_events_payload_workspace_fk
    foreign key(content_payload_ref, workspace_id) references connector_private.connector_payload_envelopes(id, workspace_id) on delete restrict,
  constraint twilio_callback_events_message_workspace_fk
    foreign key(message_id, workspace_id) references public.texting_messages(id, workspace_id) on delete restrict,
  constraint twilio_callback_events_hashes check (
    replay_key_hash ~ '^[0-9a-f]{64}$' and raw_body_hash ~ '^[0-9a-f]{64}$'
    and parameters_hash ~ '^[0-9a-f]{64}$' and exact_external_url_hash ~ '^[0-9a-f]{64}$'
    and account_sid_hash ~ '^[0-9a-f]{64}$' and sender_key_hash ~ '^[0-9a-f]{64}$'
    and provider_message_sid_hash ~ '^[0-9a-f]{64}$' and counterpart_phone_hash ~ '^[0-9a-f]{64}$'
    and (provider_status is null or provider_status ~ '^[a-z][a-z0-9_-]{1,63}$')
    and (review_reason is null or review_reason ~ '^[a-z][a-z0-9_.-]{1,79}$')
  )
);

create table public.twilio_message_reconciliation_jobs (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  message_id                 uuid not null,
  state                      public.twilio_reconciliation_state not null default 'queued',
  attempt_count              integer not null default 0,
  max_attempts               integer not null default 8,
  scheduled_at               timestamptz not null,
  lease_owner                uuid,
  lease_expires_at           timestamptz,
  fencing_token              bigint not null default 0,
  last_error_category        text,
  correlation_id             uuid not null,
  completed_at               timestamptz,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,

  constraint twilio_message_reconciliation_jobs_message_unique unique(message_id),
  constraint twilio_message_reconciliation_jobs_id_workspace_unique unique(id, workspace_id),
  constraint twilio_message_reconciliation_jobs_connection_workspace_fk
    foreign key(connection_id, workspace_id) references public.connector_connections(id, workspace_id) on delete restrict,
  constraint twilio_message_reconciliation_jobs_message_workspace_fk
    foreign key(message_id, workspace_id) references public.texting_messages(id, workspace_id) on delete restrict,
  constraint twilio_message_reconciliation_jobs_values check (
    attempt_count>=0 and max_attempts between 1 and 20 and attempt_count<=max_attempts
    and fencing_token>=0
    and ((lease_owner is null and lease_expires_at is null)
      or (lease_owner is not null and lease_expires_at is not null))
    and ((state in ('leased','executing') and lease_owner is not null)
      or (state not in ('leased','executing') and lease_owner is null))
    and ((state in ('succeeded','failed') and completed_at is not null)
      or (state not in ('succeeded','failed') and completed_at is null))
    and (last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$')
  )
);

create index twilio_callback_events_workspace_received_idx
  on public.twilio_callback_events(workspace_id, received_at desc);
create index twilio_reconciliation_jobs_due_idx
  on public.twilio_message_reconciliation_jobs(scheduled_at, created_at, id)
  where state in ('queued','retry_wait');

alter table public.texting_phone_suppressions
  add constraint texting_phone_suppressions_callback_workspace_fk
  foreign key(source_callback_id, workspace_id)
  references public.twilio_callback_events(id, workspace_id) on delete restrict;

-- Defense-in-depth guards and private helpers -------------------------------

create or replace function connector_private.twilio_status_rank(target_status text)
returns integer language sql immutable set search_path='' as $$
  select case target_status
    when 'queued' then 10 when 'accepted' then 15 when 'scheduled' then 16
    when 'sending' then 20 when 'sent' then 30 when 'delivered' then 40
    when 'read' then 50 when 'failed' then 90 when 'undelivered' then 90
    when 'canceled' then 90 when 'reconciliation_required' then 25
    when 'received' then 40 else null end
$$;

create or replace function connector_private.is_twilio_terminal_status(target_status text)
returns boolean language sql immutable set search_path='' as $$
  select target_status in ('delivered','read','failed','undelivered','canceled','received')
$$;

create or replace function connector_private.twilio_envelope_is_valid(
  target_envelope jsonb,
  target_require_expiry boolean default false
)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  return target_envelope is not null
    and jsonb_typeof(target_envelope)='object'
    and target_envelope ?& array['ciphertext','nonce','authTag','wrappedDek','wrapNonce','wrapAuthTag','kekVersion','aadHash','expiresAt']
    and (select count(*) from jsonb_object_keys(target_envelope))=9
    and target_envelope->>'ciphertext'<>'' and target_envelope->>'nonce'<>''
    and target_envelope->>'authTag'<>'' and target_envelope->>'wrappedDek'<>''
    and target_envelope->>'wrapNonce'<>'' and target_envelope->>'wrapAuthTag'<>''
    and target_envelope->>'kekVersion' ~ '^[A-Za-z0-9_.-]{1,64}$'
    and target_envelope->>'aadHash' ~ '^[0-9a-f]{64}$'
    and (not target_require_expiry or jsonb_typeof(target_envelope->'expiresAt')<>'null');
exception when others then return false;
end;
$$;

create or replace function connector_private.upsert_twilio_secret(
  target_connection_id uuid,
  target_secret_type text,
  target_expected_version integer,
  target_envelope jsonb,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_connection public.connector_connections%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
  target_expires_at timestamptz;
begin
  if target_secret_type not in (
      'twilio-provider-authority','twilio-api-key-secret','twilio-webhook-auth-token'
    ) or not connector_private.twilio_envelope_is_valid(target_envelope, false)
    or target_occurred_at is null then
    raise exception 'invalid encrypted Twilio secret envelope' using errcode='22023';
  end if;

  target_expires_at:=case when jsonb_typeof(target_envelope->'expiresAt')='null'
    then null else (target_envelope->>'expiresAt')::timestamptz end;
  if target_expires_at is not null and target_expires_at<=target_occurred_at then
    raise exception 'expired Twilio secret envelope' using errcode='22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;

  select secret.* into target_secret
  from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type=target_secret_type
  for update;

  if found then
    if target_expected_version is null or target_secret.secret_version<>target_expected_version then
      raise exception 'Twilio secret version conflict' using errcode='40001';
    end if;
    update connector_private.connector_connection_secrets set
      secret_version=secret_version+1,
      ciphertext=decode(target_envelope->>'ciphertext','base64'),
      nonce=decode(target_envelope->>'nonce','base64'),
      auth_tag=decode(target_envelope->>'authTag','base64'),
      wrapped_dek=decode(target_envelope->>'wrappedDek','base64'),
      wrap_nonce=decode(target_envelope->>'wrapNonce','base64'),
      wrap_auth_tag=decode(target_envelope->>'wrapAuthTag','base64'),
      kek_version=target_envelope->>'kekVersion', aad_hash=target_envelope->>'aadHash',
      expires_at=target_expires_at, refreshed_at=target_occurred_at,
      destroyed_at=null, updated_at=target_occurred_at
    where id=target_secret.id returning * into target_secret;
  else
    if target_expected_version is not null then
      raise exception 'Twilio secret version conflict' using errcode='40001';
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
    'secretVersion',target_secret.secret_version,'kekVersion',target_secret.kek_version,
    'expiresAt',target_secret.expires_at);
end;
$$;

create or replace function connector_private.store_twilio_content_payload(
  target_connection_id uuid,
  target_payload_kind text,
  target_schema_version text,
  target_canonical_hash text,
  target_envelope jsonb,
  target_occurred_at timestamptz
)
returns connector_private.connector_payload_envelopes
language plpgsql security definer set search_path='' as $$
declare
  target_connection public.connector_connections%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
begin
  if target_payload_kind not in ('twilio-message-body','twilio-inbound-body')
     or target_schema_version not in ('twilio-message-body.v1','twilio-inbound-body.v1')
     or target_canonical_hash !~ '^[0-9a-f]{64}$'
     or not connector_private.twilio_envelope_is_valid(target_envelope,false)
     or jsonb_typeof(target_envelope->'expiresAt')<>'null' then
    raise exception 'invalid encrypted Twilio content envelope' using errcode='22023';
  end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;

  insert into connector_private.connector_payload_envelopes(
    workspace_id,connection_id,payload_kind,schema_version,canonical_hash,
    ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,
    created_at,updated_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_payload_kind,target_schema_version,
    target_canonical_hash,decode(target_envelope->>'ciphertext','base64'),
    decode(target_envelope->>'nonce','base64'),decode(target_envelope->>'authTag','base64'),
    decode(target_envelope->>'wrappedDek','base64'),decode(target_envelope->>'wrapNonce','base64'),
    decode(target_envelope->>'wrapAuthTag','base64'),target_envelope->>'kekVersion',
    target_envelope->>'aadHash',target_occurred_at,target_occurred_at
  ) returning * into target_payload;
  return target_payload;
end;
$$;

create or replace function connector_private.twilio_active_phone(
  target_workspace_id uuid,
  target_contact_id uuid,
  target_contact_point_id uuid
)
returns public.contact_points language plpgsql stable security definer set search_path='' as $$
declare target_point public.contact_points%rowtype; match_count integer;
begin
  select point.* into target_point
  from public.contact_points point join public.contacts contact
    on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
  where point.id=target_contact_point_id and point.workspace_id=target_workspace_id
    and point.contact_id=target_contact_id and point.type='phone'
    and point.archived_at is null and contact.archived_at is null;
  if not found then raise exception 'active canonical phone point required' using errcode='P0002'; end if;
  select count(*) into match_count from public.contact_points point
  join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
  where point.workspace_id=target_workspace_id and point.type='phone'
    and point.archived_at is null and contact.archived_at is null
    and point.normalized_value=target_point.normalized_value;
  if match_count<>1 then raise exception 'canonical phone point is shared or ambiguous' using errcode='23514'; end if;
  return target_point;
end;
$$;

create or replace function connector_private.refresh_twilio_readiness(
  target_connection_id uuid,
  target_occurred_at timestamptz
)
returns public.twilio_connection_authorities
language plpgsql security definer set search_path='' as $$
declare
  target_authority public.twilio_connection_authorities%rowtype;
  target_connection public.connector_connections%rowtype;
  next_state public.twilio_readiness_state;
begin
  select authority.* into target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection_id for update;
  if not found then raise exception 'Twilio authority not found' using errcode='P0002'; end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_authority.connection_id and connection.workspace_id=target_authority.workspace_id;

  if target_connection.status in ('revoking','disconnected','disconnected_unconfirmed') then
    next_state:='disconnected';
  elsif not target_authority.enabled then next_state:='configured_disabled';
  elsif not exists(select 1 from connector_private.connector_connection_secrets secret
      where secret.connection_id=target_authority.connection_id
        and secret.secret_type in ('twilio-provider-authority','twilio-api-key-secret','twilio-webhook-auth-token')
        and secret.destroyed_at is null
      group by secret.connection_id having count(*)=3) then next_state:='credential_required';
  elsif target_authority.registration_state in ('not_configured','pending') then next_state:='registration_pending';
  elsif target_authority.registration_state in ('rejected','expired') then next_state:='approval_blocked';
  elsif not target_authority.restricted_credential
     or target_authority.sender_ownership_verified_at is null
     or target_authority.callback_verified_at is null
     or target_authority.real_number_uat_at is null
     or not exists(select 1 from public.twilio_compliance_policies policy
       where policy.connection_id=target_authority.connection_id
         and policy.use_case=target_authority.approved_use_case and policy.superseded_at is null)
    then next_state:='approval_blocked';
  elsif target_connection.status='degraded' then next_state:='degraded';
  elsif target_connection.status='active' then next_state:='active';
  else next_state:='approval_blocked'; end if;

  update public.twilio_connection_authorities set readiness_state=next_state,
    last_readiness_at=target_occurred_at,updated_at=target_occurred_at
  where id=target_authority.id returning * into target_authority;
  return target_authority;
end;
$$;

create or replace function public.prepare_twilio_authority_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.connection_id<>old.connection_id
     or new.created_by_membership_id<>old.created_by_membership_id or new.created_at<>old.created_at then
    raise exception 'Twilio authority identity is immutable' using errcode='55000';
  end if;
  if new.updated_at<old.updated_at then raise exception 'Twilio authority time cannot regress' using errcode='23514'; end if;
  return new;
end;
$$;

create or replace function public.prepare_texting_consent_state_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.workspace_id<>old.workspace_id or new.connection_id<>old.connection_id
     or new.contact_id<>old.contact_id or new.contact_point_id<>old.contact_point_id
     or new.use_case<>old.use_case or new.phone_hash<>old.phone_hash then
    raise exception 'texting consent projection identity is immutable' using errcode='55000';
  end if;
  if new.effective_at<old.effective_at then raise exception 'texting consent time cannot regress' using errcode='23514'; end if;
  return new;
end;
$$;

create or replace function public.prepare_texting_draft_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.connection_id<>old.connection_id
     or new.conversation_id<>old.conversation_id or new.contact_id<>old.contact_id
     or new.contact_point_id<>old.contact_point_id or new.use_case<>old.use_case
     or new.created_by_membership_id<>old.created_by_membership_id or new.created_at<>old.created_at then
    raise exception 'texting draft identity is immutable' using errcode='55000';
  end if;
  if new.current_version<old.current_version or new.current_version>old.current_version+1 then
    raise exception 'texting draft version must advance once' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_texting_draft_version_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.draft_id<>old.draft_id
     or new.version<>old.version or new.connection_id<>old.connection_id
     or new.contact_point_id<>old.contact_point_id or new.content_payload_ref<>old.content_payload_ref
     or new.body_hash<>old.body_hash or new.recipient_phone_hash<>old.recipient_phone_hash
     or new.sender_key_hash<>old.sender_key_hash or new.consent_event_id is distinct from old.consent_event_id
     or new.texting_policy_id<>old.texting_policy_id or new.texting_policy_version<>old.texting_policy_version
     or new.created_by_membership_id<>old.created_by_membership_id
     or new.correlation_id<>old.correlation_id or new.created_at<>old.created_at then
    raise exception 'texting draft version is immutable' using errcode='55000';
  end if;
  if old.connector_intent_id is not null
     or new.connector_intent_id is null or new.connector_intent_version_id is null then
    raise exception 'texting intent binding is immutable and single-use' using errcode='55000';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_texting_message_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.connection_id<>old.connection_id
     or new.conversation_id is distinct from old.conversation_id or new.contact_id is distinct from old.contact_id
     or new.contact_point_id is distinct from old.contact_point_id or new.draft_version_id is distinct from old.draft_version_id
     or new.approval_snapshot_id is distinct from old.approval_snapshot_id or new.job_id is distinct from old.job_id
     or new.direction<>old.direction or new.content_payload_ref is distinct from old.content_payload_ref
     or new.body_hash<>old.body_hash or new.recipient_phone_hash<>old.recipient_phone_hash
     or new.sender_key_hash<>old.sender_key_hash or new.correlation_id<>old.correlation_id
     or new.created_at<>old.created_at then
    raise exception 'texting message authority binding is immutable' using errcode='55000';
  end if;
  if new.status_rank<old.status_rank and new.status<>old.status then
    raise exception 'texting message status cannot regress' using errcode='23514';
  end if;
  if old.provider_message_sid_hash is not null
     and new.provider_message_sid_hash is distinct from old.provider_message_sid_hash then
    raise exception 'provider message SID binding is immutable' using errcode='55000';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_twilio_callback_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.connection_id<>old.connection_id
     or new.webhook_delivery_id<>old.webhook_delivery_id or new.callback_kind<>old.callback_kind
     or new.replay_key_hash<>old.replay_key_hash or new.raw_body_hash<>old.raw_body_hash
     or new.parameters_hash<>old.parameters_hash or new.exact_external_url_hash<>old.exact_external_url_hash
     or new.account_sid_hash<>old.account_sid_hash or new.sender_key_hash<>old.sender_key_hash
     or new.provider_message_sid_hash<>old.provider_message_sid_hash
     or new.counterpart_phone_hash<>old.counterpart_phone_hash or new.keyword_class<>old.keyword_class
     or new.provider_status is distinct from old.provider_status
     or new.content_payload_ref is distinct from old.content_payload_ref
     or new.correlation_id<>old.correlation_id or new.received_at<>old.received_at then
    raise exception 'Twilio callback verification binding is immutable' using errcode='55000';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_twilio_reconciliation_job_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.connection_id<>old.connection_id
     or new.message_id<>old.message_id or new.correlation_id<>old.correlation_id or new.created_at<>old.created_at then
    raise exception 'Twilio reconciliation authority is immutable' using errcode='55000';
  end if;
  if new.fencing_token<old.fencing_token then raise exception 'Twilio reconciliation fence cannot regress' using errcode='23514'; end if;
  if new.state<>old.state and not (
    (old.state in ('queued','retry_wait') and new.state='leased')
    or (old.state='leased' and new.state in ('executing','retry_wait','failed'))
    or (old.state='executing' and new.state in ('retry_wait','succeeded','failed'))
  ) then raise exception 'invalid Twilio reconciliation transition' using errcode='23514'; end if;
  return new;
end;
$$;

revoke all on function connector_private.twilio_status_rank(text) from public;
revoke all on function connector_private.is_twilio_terminal_status(text) from public;
revoke all on function connector_private.twilio_envelope_is_valid(jsonb,boolean) from public;
revoke all on function connector_private.upsert_twilio_secret(uuid,text,integer,jsonb,timestamptz) from public;
revoke all on function connector_private.store_twilio_content_payload(uuid,text,text,text,jsonb,timestamptz) from public;
revoke all on function connector_private.twilio_active_phone(uuid,uuid,uuid) from public;
revoke all on function connector_private.refresh_twilio_readiness(uuid,timestamptz) from public;

create trigger twilio_connection_authorities_prepare_update before update on public.twilio_connection_authorities
  for each row execute function public.prepare_twilio_authority_update();
create trigger twilio_connection_authorities_guard_delete before delete on public.twilio_connection_authorities
  for each row execute function public.guard_connector_append_only();
create trigger twilio_compliance_policies_guard_update_delete before update or delete on public.twilio_compliance_policies
  for each row execute function public.guard_connector_append_only();
create trigger texting_consent_events_guard_update_delete before update or delete on public.texting_consent_events
  for each row execute function public.guard_connector_append_only();
create trigger texting_consent_states_prepare_update before update on public.texting_consent_states
  for each row execute function public.prepare_texting_consent_state_update();
create trigger texting_consent_states_guard_delete before delete on public.texting_consent_states
  for each row execute function public.guard_connector_append_only();
create trigger texting_message_drafts_prepare_update before update on public.texting_message_drafts
  for each row execute function public.prepare_texting_draft_update();
create trigger texting_message_drafts_guard_delete before delete on public.texting_message_drafts
  for each row execute function public.guard_connector_append_only();
create trigger texting_message_draft_versions_prepare_update before update on public.texting_message_draft_versions
  for each row execute function public.prepare_texting_draft_version_update();
create trigger texting_message_draft_versions_guard_delete before delete on public.texting_message_draft_versions
  for each row execute function public.guard_connector_append_only();
create trigger texting_send_approval_snapshots_guard_update_delete before update or delete on public.texting_send_approval_snapshots
  for each row execute function public.guard_connector_append_only();
create trigger texting_messages_prepare_update before update on public.texting_messages
  for each row execute function public.prepare_texting_message_update();
create trigger texting_messages_guard_delete before delete on public.texting_messages
  for each row execute function public.guard_connector_append_only();
create trigger twilio_callback_events_prepare_update before update on public.twilio_callback_events
  for each row execute function public.prepare_twilio_callback_update();
create trigger twilio_callback_events_guard_delete before delete on public.twilio_callback_events
  for each row execute function public.guard_connector_append_only();
create trigger twilio_reconciliation_jobs_prepare_update before update on public.twilio_message_reconciliation_jobs
  for each row execute function public.prepare_twilio_reconciliation_job_update();
create trigger twilio_reconciliation_jobs_guard_delete before delete on public.twilio_message_reconciliation_jobs
  for each row execute function public.guard_connector_append_only();

-- Workspace RLS. Authenticated roles receive read-only redacted projections. --

alter table public.twilio_connection_authorities enable row level security;
alter table public.twilio_connection_authorities force row level security;
alter table public.twilio_compliance_policies enable row level security;
alter table public.twilio_compliance_policies force row level security;
alter table public.texting_consent_events enable row level security;
alter table public.texting_consent_events force row level security;
alter table public.texting_consent_states enable row level security;
alter table public.texting_consent_states force row level security;
alter table public.texting_phone_suppressions enable row level security;
alter table public.texting_phone_suppressions force row level security;
alter table public.texting_conversations enable row level security;
alter table public.texting_conversations force row level security;
alter table public.texting_message_drafts enable row level security;
alter table public.texting_message_drafts force row level security;
alter table public.texting_message_draft_versions enable row level security;
alter table public.texting_message_draft_versions force row level security;
alter table public.texting_send_approval_snapshots enable row level security;
alter table public.texting_send_approval_snapshots force row level security;
alter table public.texting_messages enable row level security;
alter table public.texting_messages force row level security;
alter table public.twilio_callback_events enable row level security;
alter table public.twilio_callback_events force row level security;
alter table public.twilio_message_reconciliation_jobs enable row level security;
alter table public.twilio_message_reconciliation_jobs force row level security;
alter table connector_private.twilio_specialized_approval_guards enable row level security;
alter table connector_private.twilio_specialized_approval_guards force row level security;

create policy twilio_connection_authorities_member_select on public.twilio_connection_authorities
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy twilio_compliance_policies_member_select on public.twilio_compliance_policies
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_consent_events_member_select on public.texting_consent_events
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_consent_states_member_select on public.texting_consent_states
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_phone_suppressions_member_select on public.texting_phone_suppressions
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_conversations_member_select on public.texting_conversations
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_message_drafts_member_select on public.texting_message_drafts
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_message_draft_versions_member_select on public.texting_message_draft_versions
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_send_approval_snapshots_member_select on public.texting_send_approval_snapshots
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy texting_messages_member_select on public.texting_messages
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy twilio_callback_events_member_select on public.twilio_callback_events
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy twilio_reconciliation_jobs_member_select on public.twilio_message_reconciliation_jobs
  for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on table public.twilio_connection_authorities from public,anon,authenticated,service_role;
revoke all on table public.twilio_compliance_policies from public,anon,authenticated,service_role;
revoke all on table public.texting_consent_events from public,anon,authenticated,service_role;
revoke all on table public.texting_consent_states from public,anon,authenticated,service_role;
revoke all on table public.texting_phone_suppressions from public,anon,authenticated,service_role;
revoke all on table public.texting_conversations from public,anon,authenticated,service_role;
revoke all on table public.texting_message_drafts from public,anon,authenticated,service_role;
revoke all on table public.texting_message_draft_versions from public,anon,authenticated,service_role;
revoke all on table public.texting_send_approval_snapshots from public,anon,authenticated,service_role;
revoke all on table public.texting_messages from public,anon,authenticated,service_role;
revoke all on table public.twilio_callback_events from public,anon,authenticated,service_role;
revoke all on table public.twilio_message_reconciliation_jobs from public,anon,authenticated,service_role;
revoke all on table connector_private.twilio_message_resources from public,anon,authenticated,service_role;
revoke all on table connector_private.twilio_callback_authorities from public,anon,authenticated,service_role;
revoke all on table connector_private.twilio_specialized_approval_guards from public,anon,authenticated,service_role;

grant select on table public.twilio_connection_authorities to authenticated,service_role;
grant select on table public.twilio_compliance_policies to authenticated,service_role;
grant select on table public.texting_consent_events to authenticated,service_role;
grant select on table public.texting_consent_states to authenticated,service_role;
grant select on table public.texting_phone_suppressions to authenticated,service_role;
grant select on table public.texting_conversations to authenticated,service_role;
grant select on table public.texting_message_drafts to authenticated,service_role;
grant select on table public.texting_message_draft_versions to authenticated,service_role;
grant select on table public.texting_send_approval_snapshots to authenticated,service_role;
grant select on table public.texting_messages to authenticated,service_role;
grant select on table public.twilio_callback_events to authenticated,service_role;
grant select on table public.twilio_message_reconciliation_jobs to authenticated,service_role;

grant usage on type public.twilio_registration_state to authenticated,service_role;
grant usage on type public.twilio_readiness_state to authenticated,service_role;
grant usage on type public.texting_consent_status to authenticated,service_role;
grant usage on type public.texting_direction to authenticated,service_role;
grant usage on type public.texting_keyword_class to authenticated,service_role;
grant usage on type public.texting_draft_state to authenticated,service_role;
grant usage on type public.texting_message_status to authenticated,service_role;
grant usage on type public.twilio_callback_kind to authenticated,service_role;
grant usage on type public.twilio_callback_state to authenticated,service_role;
grant usage on type public.twilio_reconciliation_state to authenticated,service_role;

-- Owner configuration and redacted readiness --------------------------------

create or replace function public.bind_twilio_connection_authority(
  target_authenticated_user_id uuid,
  target_membership_id uuid,
  target_connection_id uuid,
  target_account_sid_hash text,
  target_api_key_sid_hash text,
  target_messaging_service_sid_hash text,
  target_sender_key_hash text,
  target_sender_kind text,
  target_registration_state public.twilio_registration_state,
  target_registration_evidence_hash text,
  target_approved_use_case text,
  target_exact_external_url_hash text,
  target_callback_verified_at timestamptz,
  target_real_number_uat_evidence_hash text,
  target_real_number_uat_at timestamptz,
  target_restricted_credential boolean,
  target_sender_ownership_verified_at timestamptz,
  target_enabled boolean,
  target_endpoint_key_hash text,
  target_expected_provider_authority_version integer,
  target_provider_authority_envelope jsonb,
  target_expected_api_secret_version integer,
  target_api_secret_envelope jsonb,
  target_expected_webhook_secret_version integer,
  target_webhook_secret_envelope jsonb,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_connection public.connector_connections%rowtype;
  target_authority public.twilio_connection_authorities%rowtype;
  provider_secret jsonb; api_secret jsonb; webhook_secret jsonb;
  callback_authority connector_private.twilio_callback_authorities%rowtype;
  is_gate_complete boolean;
begin
  if target_correlation_id is null or target_occurred_at is null
     or target_account_sid_hash !~ '^[0-9a-f]{64}$'
     or target_api_key_sid_hash !~ '^[0-9a-f]{64}$'
     or target_sender_key_hash !~ '^[0-9a-f]{64}$'
     or target_exact_external_url_hash !~ '^[0-9a-f]{64}$'
     or target_endpoint_key_hash !~ '^[0-9a-f]{64}$'
     or (target_messaging_service_sid_hash is not null and target_messaging_service_sid_hash !~ '^[0-9a-f]{64}$')
     or (target_registration_evidence_hash is not null and target_registration_evidence_hash !~ '^[0-9a-f]{64}$')
     or (target_real_number_uat_evidence_hash is not null and target_real_number_uat_evidence_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'invalid Twilio authority binding' using errcode='22023';
  end if;

  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio' for update;
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.workspace_members member
      where member.id=target_membership_id and member.workspace_id=target_connection.workspace_id
        and member.user_id=target_authenticated_user_id and member.role='owner' and member.status='active') then
    raise exception 'active owner authority required for Twilio configuration' using errcode='42501';
  end if;
  if target_connection.status in ('revoking','disconnected','disconnected_unconfirmed') then
    raise exception 'disconnected Twilio connection cannot be configured' using errcode='23514';
  end if;

  provider_secret:=connector_private.upsert_twilio_secret(target_connection.id,
    'twilio-provider-authority',target_expected_provider_authority_version,
    target_provider_authority_envelope,target_occurred_at);
  api_secret:=connector_private.upsert_twilio_secret(target_connection.id,
    'twilio-api-key-secret',target_expected_api_secret_version,target_api_secret_envelope,target_occurred_at);
  webhook_secret:=connector_private.upsert_twilio_secret(target_connection.id,
    'twilio-webhook-auth-token',target_expected_webhook_secret_version,
    target_webhook_secret_envelope,target_occurred_at);

  insert into connector_private.twilio_callback_authorities(
    workspace_id,connection_id,endpoint_key_hash,exact_external_url_hash,bound_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_endpoint_key_hash,
    target_exact_external_url_hash,target_occurred_at
  ) on conflict(connection_id) do update set
    endpoint_key_hash=excluded.endpoint_key_hash,
    exact_external_url_hash=excluded.exact_external_url_hash,
    bound_at=excluded.bound_at,revoked_at=null
  returning * into callback_authority;

  insert into public.twilio_connection_authorities(
    workspace_id,connection_id,account_sid_hash,api_key_sid_hash,
    messaging_service_sid_hash,sender_key_hash,sender_kind,registration_state,
    registration_evidence_hash,approved_use_case,callback_external_url_hash,
    callback_verified_at,real_number_uat_evidence_hash,real_number_uat_at,
    restricted_credential,sender_ownership_verified_at,enabled,readiness_state,
    last_readiness_at,created_by_membership_id,updated_by_membership_id,created_at,updated_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_account_sid_hash,
    target_api_key_sid_hash,target_messaging_service_sid_hash,target_sender_key_hash,
    target_sender_kind,target_registration_state,target_registration_evidence_hash,
    target_approved_use_case,target_exact_external_url_hash,target_callback_verified_at,
    target_real_number_uat_evidence_hash,target_real_number_uat_at,target_restricted_credential,
    target_sender_ownership_verified_at,target_enabled,'approval_blocked',target_occurred_at,
    target_membership_id,target_membership_id,target_occurred_at,target_occurred_at
  ) on conflict(connection_id) do update set
    account_sid_hash=excluded.account_sid_hash,api_key_sid_hash=excluded.api_key_sid_hash,
    messaging_service_sid_hash=excluded.messaging_service_sid_hash,
    sender_key_hash=excluded.sender_key_hash,sender_kind=excluded.sender_kind,
    registration_state=excluded.registration_state,
    registration_evidence_hash=excluded.registration_evidence_hash,
    approved_use_case=excluded.approved_use_case,
    callback_external_url_hash=excluded.callback_external_url_hash,
    callback_verified_at=excluded.callback_verified_at,
    real_number_uat_evidence_hash=excluded.real_number_uat_evidence_hash,
    real_number_uat_at=excluded.real_number_uat_at,
    restricted_credential=excluded.restricted_credential,
    sender_ownership_verified_at=excluded.sender_ownership_verified_at,
    enabled=excluded.enabled,updated_by_membership_id=excluded.updated_by_membership_id,
    updated_at=excluded.updated_at
  returning * into target_authority;

  is_gate_complete:=target_enabled and target_restricted_credential
    and target_registration_state in ('approved','not_required')
    and target_callback_verified_at is not null and target_real_number_uat_at is not null
    and target_sender_ownership_verified_at is not null
    and exists(select 1 from public.twilio_compliance_policies policy
      where policy.connection_id=target_connection.id and policy.use_case=target_approved_use_case
        and policy.superseded_at is null);
  if is_gate_complete and target_connection.status in ('authorizing','degraded','reauthorization_required') then
    update public.connector_connections set status='active',provider_account_key_hash=target_account_sid_hash,
      granted_scopes=array['messages:create','messages:read'],
      remote_identity_summary=jsonb_build_object('accountSidHash',target_account_sid_hash,
        'messagingServiceSidHash',target_messaging_service_sid_hash,'senderKeyHash',target_sender_key_hash),
      last_error_category=null
    where id=target_connection.id returning * into target_connection;
  else
    update public.connector_connections set provider_account_key_hash=target_account_sid_hash,
      granted_scopes=array['messages:create','messages:read'],
      remote_identity_summary=jsonb_build_object('accountSidHash',target_account_sid_hash,
        'messagingServiceSidHash',target_messaging_service_sid_hash,'senderKeyHash',target_sender_key_hash)
    where id=target_connection.id returning * into target_connection;
  end if;

  target_authority:=connector_private.refresh_twilio_readiness(target_connection.id,target_occurred_at);
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    error_category,redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'twilio','connection.tested',
    'twilio.authority.bound:'||target_correlation_id::text,target_correlation_id,
    case when target_authority.readiness_state='active' then null else 'activation_gate_incomplete' end,
    jsonb_build_object('readinessState',target_authority.readiness_state,
      'registrationState',target_authority.registration_state,'senderKind',target_authority.sender_kind),
    target_occurred_at
  ) on conflict(workspace_id,event_key) do nothing;

  return jsonb_build_object('connection',to_jsonb(target_connection),
    'authority',to_jsonb(target_authority),
    'secrets',jsonb_build_array(provider_secret,api_secret,webhook_secret),
    'callback',jsonb_build_object('connectionId',callback_authority.connection_id,
      'boundAt',callback_authority.bound_at,'revokedAt',callback_authority.revoked_at));
end;
$$;

create or replace function public.prepare_twilio_compliance_policy_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id or new.connection_id<>old.connection_id
     or new.use_case<>old.use_case or new.version<>old.version
     or new.disclosure_version<>old.disclosure_version or new.policy_hash<>old.policy_hash
     or new.retention_days<>old.retention_days or new.quiet_hours_start<>old.quiet_hours_start
     or new.quiet_hours_end<>old.quiet_hours_end or new.unknown_timezone_action<>old.unknown_timezone_action
     or new.default_defer_minutes is distinct from old.default_defer_minutes
     or new.require_verified_timezone<>old.require_verified_timezone
     or new.keyword_configuration_hash<>old.keyword_configuration_hash
     or new.approved_by_membership_id<>old.approved_by_membership_id
     or new.effective_at<>old.effective_at or new.correlation_id<>old.correlation_id
     or new.created_at<>old.created_at or old.superseded_at is not null
     or new.superseded_at is null or new.superseded_at<old.effective_at then
    raise exception 'Twilio compliance policy is append-only' using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger twilio_compliance_policies_guard_update_delete on public.twilio_compliance_policies;
create trigger twilio_compliance_policies_prepare_update before update on public.twilio_compliance_policies
  for each row execute function public.prepare_twilio_compliance_policy_update();
create trigger twilio_compliance_policies_guard_delete before delete on public.twilio_compliance_policies
  for each row execute function public.guard_connector_append_only();

create or replace function public.configure_twilio_compliance_policy(
  target_connection_id uuid,
  target_use_case text,
  target_disclosure_version text,
  target_policy_hash text,
  target_retention_days integer,
  target_quiet_hours_start time,
  target_quiet_hours_end time,
  target_unknown_timezone_action text,
  target_default_defer_minutes integer,
  target_require_verified_timezone boolean,
  target_keyword_configuration_hash text,
  target_correlation_id uuid,
  target_effective_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  previous_policy public.twilio_compliance_policies%rowtype;
  created_policy public.twilio_compliance_policies%rowtype;
  target_authority public.twilio_connection_authorities%rowtype;
  next_version integer;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_connection.workspace_id,true);
  if target_correlation_id is null or target_effective_at is null then
    raise exception 'Twilio policy correlation and effective time required' using errcode='22023';
  end if;
  select policy.* into previous_policy from public.twilio_compliance_policies policy
  where policy.connection_id=target_connection.id and policy.use_case=target_use_case
    and policy.superseded_at is null for update;
  next_version:=coalesce(previous_policy.version,0)+1;
  if found then
    update public.twilio_compliance_policies set superseded_at=target_effective_at
    where id=previous_policy.id;
  end if;
  insert into public.twilio_compliance_policies(
    workspace_id,connection_id,use_case,version,disclosure_version,policy_hash,
    retention_days,quiet_hours_start,quiet_hours_end,unknown_timezone_action,
    default_defer_minutes,require_verified_timezone,keyword_configuration_hash,
    approved_by_membership_id,effective_at,correlation_id,created_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_use_case,next_version,
    target_disclosure_version,target_policy_hash,target_retention_days,target_quiet_hours_start,
    target_quiet_hours_end,target_unknown_timezone_action,target_default_defer_minutes,
    target_require_verified_timezone,target_keyword_configuration_hash,actor.id,target_effective_at,
    target_correlation_id,target_effective_at
  ) returning * into created_policy;
  select * into target_authority from public.twilio_connection_authorities authority
    where authority.connection_id=target_connection.id;
  if found then target_authority:=connector_private.refresh_twilio_readiness(target_connection.id,target_effective_at); end if;
  return jsonb_build_object('policy',to_jsonb(created_policy),
    'authority',case when target_authority.id is null then null else to_jsonb(target_authority) end,
    'noOp',false);
end;
$$;

create or replace function public.ensure_twilio_message_send_policy(
  target_workspace_id uuid,
  target_connection_id uuid,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
 target_policy public.connector_automation_policies%rowtype; expected_constraints jsonb;
 expected_compliance jsonb; expected_limits jsonb;
begin
  actor:=public.connector_current_membership(target_workspace_id,true);
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.workspace_id=target_workspace_id
    and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  expected_constraints:=jsonb_build_object('provider','twilio','channel','sms',
    'connectionId',target_connection.id,'payloadSchema','twilio-message-body.v1');
  expected_compliance:=jsonb_build_object('exactCanonicalPhone',true,'consentRequired',true,
    'stopSuppressionRequired',true,'quietHoursDecisionRequired',true,'ownerApprovalRequired',true);
  expected_limits:=jsonb_build_object('maxAttempts',3,'reconcileOnUnknown',true,'maxBatchSize',25);
  select policy.* into target_policy from public.connector_automation_policies policy
  where policy.workspace_id=target_workspace_id and policy.action_type='message.send'
  order by policy.version desc limit 1;
  if found then
    if target_policy.approval_mode<>'owner_required' or target_policy.allowlisted_actions<>array['message.send']::text[]
       or target_policy.target_constraints<>expected_constraints
       or target_policy.compliance_requirements<>expected_compliance
       or target_policy.execution_limits<>expected_limits then
      raise exception 'existing message.send policy conflicts with canonical Twilio policy' using errcode='23505';
    end if;
    return jsonb_build_object('policy',to_jsonb(target_policy),'noOp',true);
  end if;
  insert into public.connector_automation_policies(
    workspace_id,action_type,version,approval_mode,allowlisted_actions,target_constraints,
    compliance_requirements,execution_limits,created_by_membership_id,correlation_id,created_at
  ) values (
    target_workspace_id,'message.send',1,'owner_required',array['message.send']::text[],
    expected_constraints,expected_compliance,expected_limits,actor.id,target_correlation_id,target_occurred_at
  ) returning * into target_policy;
  return jsonb_build_object('policy',to_jsonb(target_policy),'noOp',false);
end;
$$;

create or replace function public.read_twilio_connection_readiness(target_connection_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_authority public.twilio_connection_authorities%rowtype;
 target_policy public.twilio_compliance_policies%rowtype;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  perform public.connector_current_membership(target_connection.workspace_id,false);
  select authority.* into target_authority from public.twilio_connection_authorities authority
    where authority.connection_id=target_connection.id;
  select policy.* into target_policy from public.twilio_compliance_policies policy
    where policy.connection_id=target_connection.id and policy.superseded_at is null;
  return jsonb_build_object('connection',to_jsonb(target_connection),
    'authority',case when target_authority.id is null then null else to_jsonb(target_authority) end,
    'policy',case when target_policy.id is null then null else to_jsonb(target_policy) end,
    'providerBacked',target_authority.readiness_state='active',
    'deviceSmsFallbackSeparate',true);
end;
$$;

-- Consent mutation is an append-only event plus a deterministic projection. --

create or replace function connector_private.apply_twilio_consent_event(
  target_connection_id uuid,target_contact_id uuid,target_contact_point_id uuid,
  target_use_case text,target_status public.texting_consent_status,
  target_collection_source text,target_collection_method text,target_disclosure_version text,
  target_evidence_ref_hash text,target_recipient_timezone text,target_timezone_source text,
  target_actor_membership_id uuid,target_provider_event_hash text,
  target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; target_policy public.twilio_compliance_policies%rowtype;
 target_point public.contact_points%rowtype; created_event public.texting_consent_events%rowtype;
 target_state public.texting_consent_states%rowtype; phone_hash text; apply_projection boolean:=true;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  target_point:=connector_private.twilio_active_phone(target_connection.workspace_id,target_contact_id,target_contact_point_id);
  select policy.* into target_policy from public.twilio_compliance_policies policy
  where policy.connection_id=target_connection.id and policy.use_case=target_use_case
    and policy.superseded_at is null;
  if not found then raise exception 'active Twilio compliance policy required' using errcode='23514'; end if;
  if target_evidence_ref_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null
     or target_occurred_at is null or length(target_collection_source) not between 1 and 64
     or length(target_collection_method) not between 1 and 64
     or target_disclosure_version<>target_policy.disclosure_version then
    raise exception 'invalid texting consent evidence' using errcode='22023';
  end if;
  phone_hash:=encode(extensions.digest(pg_catalog.convert_to(target_point.normalized_value,'UTF8'),'sha256'),'hex');
  if target_provider_event_hash is not null then
    select event.* into created_event from public.texting_consent_events event
    where event.workspace_id=target_connection.workspace_id and event.connection_id=target_connection.id
      and event.provider_event_hash=target_provider_event_hash;
    if found then return jsonb_build_object('event',to_jsonb(created_event),
      'state',(select to_jsonb(state) from public.texting_consent_states state
       where state.connection_id=target_connection.id and state.contact_point_id=target_point.id and state.use_case=target_use_case),
      'noOp',true); end if;
  end if;
  insert into public.texting_consent_events(
    workspace_id,connection_id,contact_id,contact_point_id,use_case,status,
    collection_source,collection_method,disclosure_version,policy_id,policy_version,
    evidence_ref_hash,phone_hash,recipient_timezone,timezone_source,actor_membership_id,
    provider_event_hash,correlation_id,occurred_at,created_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_contact_id,target_point.id,target_use_case,
    target_status,target_collection_source,target_collection_method,target_disclosure_version,
    target_policy.id,target_policy.version,target_evidence_ref_hash,phone_hash,target_recipient_timezone,
    target_timezone_source,target_actor_membership_id,target_provider_event_hash,target_correlation_id,
    target_occurred_at,clock_timestamp()
  ) returning * into created_event;
  select state.* into target_state from public.texting_consent_states state
  where state.connection_id=target_connection.id and state.contact_point_id=target_point.id
    and state.use_case=target_use_case for update;
  if found and target_status<>'opted_out' and target_occurred_at<=target_state.effective_at then apply_projection:=false; end if;
  if apply_projection then
    insert into public.texting_consent_states(
      workspace_id,connection_id,contact_id,contact_point_id,use_case,status,current_event_id,
      phone_hash,disclosure_version,policy_id,policy_version,recipient_timezone,timezone_source,
      effective_at,updated_at
    ) values (
      target_connection.workspace_id,target_connection.id,target_contact_id,target_point.id,target_use_case,
      target_status,created_event.id,phone_hash,target_policy.disclosure_version,target_policy.id,target_policy.version,
      target_recipient_timezone,target_timezone_source,target_occurred_at,clock_timestamp()
    ) on conflict(connection_id,contact_point_id,use_case) do update set
      status=excluded.status,current_event_id=excluded.current_event_id,
      disclosure_version=excluded.disclosure_version,policy_id=excluded.policy_id,
      policy_version=excluded.policy_version,recipient_timezone=excluded.recipient_timezone,
      timezone_source=excluded.timezone_source,effective_at=greatest(public.texting_consent_states.effective_at,excluded.effective_at),
      updated_at=excluded.updated_at
    returning * into target_state;
  end if;
  return jsonb_build_object('event',to_jsonb(created_event),'state',to_jsonb(target_state),'noOp',false);
end;
$$;

create or replace function public.record_texting_consent(
  target_connection_id uuid,target_contact_id uuid,target_contact_point_id uuid,
  target_use_case text,target_status public.texting_consent_status,
  target_collection_method text,target_disclosure_version text,target_evidence_ref_hash text,
  target_recipient_timezone text,target_timezone_source text,target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; actor public.workspace_members%rowtype;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_connection.workspace_id,false);
  return connector_private.apply_twilio_consent_event(target_connection.id,target_contact_id,
    target_contact_point_id,target_use_case,target_status,
    case when actor.role='owner' then 'owner-recorded' else 'assistant-recorded' end,
    target_collection_method,target_disclosure_version,target_evidence_ref_hash,
    target_recipient_timezone,target_timezone_source,actor.id,null,target_correlation_id,target_occurred_at);
end;
$$;

-- Encrypted local draft lifecycle and exact Story 3.5 action binding ----------

create or replace function public.create_twilio_message_draft(
  target_connection_id uuid,
  target_draft_id uuid,
  target_contact_id uuid,
  target_contact_point_id uuid,
  target_use_case text,
  target_body_hash text,
  target_content_envelope jsonb,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
  target_authority public.twilio_connection_authorities%rowtype; target_policy public.twilio_compliance_policies%rowtype;
  target_point public.contact_points%rowtype; target_conversation public.texting_conversations%rowtype;
  created_draft public.texting_message_drafts%rowtype;
  created_version public.texting_message_draft_versions%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  target_consent public.texting_consent_states%rowtype; phone_hash text;
begin
  if target_draft_id is null or target_body_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null or target_occurred_at is null then
    raise exception 'invalid Twilio draft request' using errcode='22023';
  end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio'
    and connection.status in ('active','degraded');
  if not found then raise exception 'available Twilio connection required' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_connection.workspace_id,false);
  target_point:=connector_private.twilio_active_phone(target_connection.workspace_id,target_contact_id,target_contact_point_id);
  select authority.* into target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection.id;
  if not found or target_authority.enabled=false then
    raise exception 'configured Twilio authority required' using errcode='23514';
  end if;
  if target_use_case<>target_authority.approved_use_case then
    raise exception 'Twilio draft use case is not approved' using errcode='23514';
  end if;
  select policy.* into target_policy from public.twilio_compliance_policies policy
  where policy.connection_id=target_connection.id and policy.use_case=target_use_case
    and policy.superseded_at is null;
  if not found then raise exception 'active Twilio compliance policy required' using errcode='23514'; end if;
  phone_hash:=encode(extensions.digest(pg_catalog.convert_to(target_point.normalized_value,'UTF8'),'sha256'),'hex');
  select state.* into target_consent from public.texting_consent_states state
  where state.connection_id=target_connection.id and state.contact_point_id=target_point.id
    and state.use_case=target_use_case;

  target_payload:=connector_private.store_twilio_content_payload(target_connection.id,
    'twilio-message-body','twilio-message-body.v1',target_body_hash,target_content_envelope,target_occurred_at);
  insert into public.texting_conversations(
    workspace_id,connection_id,contact_id,contact_point_id,use_case,recipient_phone_hash,
    sender_key_hash,state,created_at,updated_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_contact_id,target_point.id,target_use_case,
    phone_hash,target_authority.sender_key_hash,'active',target_occurred_at,target_occurred_at
  ) on conflict(connection_id,contact_point_id,use_case) do update set
    updated_at=excluded.updated_at
  returning * into target_conversation;
  insert into public.texting_message_drafts(
    id,workspace_id,connection_id,conversation_id,contact_id,contact_point_id,use_case,
    current_version,state,created_by_membership_id,correlation_id,created_at,updated_at
  ) values (
    target_draft_id,target_connection.workspace_id,target_connection.id,target_conversation.id,
    target_contact_id,target_point.id,target_use_case,1,'draft',actor.id,target_correlation_id,
    target_occurred_at,target_occurred_at
  ) returning * into created_draft;
  insert into public.texting_message_draft_versions(
    workspace_id,draft_id,version,connection_id,contact_point_id,content_payload_ref,
    body_hash,recipient_phone_hash,sender_key_hash,consent_event_id,texting_policy_id,
    texting_policy_version,created_by_membership_id,correlation_id,created_at
  ) values (
    target_connection.workspace_id,created_draft.id,1,target_connection.id,target_point.id,
    target_payload.id,target_body_hash,phone_hash,target_authority.sender_key_hash,
    target_consent.current_event_id,target_policy.id,target_policy.version,actor.id,
    target_correlation_id,target_occurred_at
  ) returning * into created_version;
  return jsonb_build_object('draft',to_jsonb(created_draft),'version',to_jsonb(created_version),
    'conversation',to_jsonb(target_conversation),'consentStatus',coalesce(target_consent.status::text,'unknown'),
    'noOp',false);
end;
$$;

create or replace function public.revise_twilio_message_draft(
  target_draft_id uuid,target_expected_version integer,target_body_hash text,
  target_content_envelope jsonb,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_draft public.texting_message_drafts%rowtype;
 previous_version public.texting_message_draft_versions%rowtype; created_version public.texting_message_draft_versions%rowtype;
 target_payload connector_private.connector_payload_envelopes%rowtype;
 target_policy public.twilio_compliance_policies%rowtype; target_consent public.texting_consent_states%rowtype;
begin
  select draft.* into target_draft from public.texting_message_drafts draft
  where draft.id=target_draft_id for update;
  if not found then raise exception 'Twilio draft not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_draft.workspace_id,false);
  if target_draft.state<>'draft' or target_draft.current_version<>target_expected_version then
    raise exception 'Twilio draft version conflict' using errcode='40001';
  end if;
  select version_row.* into strict previous_version from public.texting_message_draft_versions version_row
  where version_row.draft_id=target_draft.id and version_row.version=target_expected_version;
  select policy.* into target_policy from public.twilio_compliance_policies policy
  where policy.connection_id=target_draft.connection_id and policy.use_case=target_draft.use_case
    and policy.superseded_at is null;
  if not found then raise exception 'active Twilio compliance policy required' using errcode='23514'; end if;
  select state.* into target_consent from public.texting_consent_states state
  where state.connection_id=target_draft.connection_id and state.contact_point_id=target_draft.contact_point_id
    and state.use_case=target_draft.use_case;
  target_payload:=connector_private.store_twilio_content_payload(target_draft.connection_id,
    'twilio-message-body','twilio-message-body.v1',target_body_hash,target_content_envelope,target_occurred_at);
  insert into public.texting_message_draft_versions(
    workspace_id,draft_id,version,connection_id,contact_point_id,content_payload_ref,body_hash,
    recipient_phone_hash,sender_key_hash,consent_event_id,texting_policy_id,texting_policy_version,
    created_by_membership_id,correlation_id,created_at
  ) values (
    target_draft.workspace_id,target_draft.id,target_expected_version+1,target_draft.connection_id,
    target_draft.contact_point_id,target_payload.id,target_body_hash,previous_version.recipient_phone_hash,
    previous_version.sender_key_hash,target_consent.current_event_id,target_policy.id,target_policy.version,
    actor.id,target_correlation_id,target_occurred_at
  ) returning * into created_version;
  update public.texting_message_drafts set current_version=target_expected_version+1,
    correlation_id=target_correlation_id,updated_at=target_occurred_at
  where id=target_draft.id returning * into target_draft;
  return jsonb_build_object('draft',to_jsonb(target_draft),'version',to_jsonb(created_version),'noOp',false);
end;
$$;

create or replace function public.prepare_twilio_message_send_intent(
  target_draft_id uuid,target_expected_draft_version integer,target_connector_policy_id uuid,
  target_connector_policy_version integer,target_summary text,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_draft public.texting_message_drafts%rowtype;
 target_version public.texting_message_draft_versions%rowtype; target_authority public.twilio_connection_authorities%rowtype;
 target_consent public.texting_consent_states%rowtype; prepared jsonb; prepared_intent_id uuid;
 prepared_version_id uuid;
begin
  select draft.* into target_draft from public.texting_message_drafts draft
  where draft.id=target_draft_id for update;
  if not found then raise exception 'Twilio draft not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_draft.workspace_id,false);
  if target_draft.state<>'draft' or target_draft.current_version<>target_expected_draft_version then
    raise exception 'Twilio draft version conflict' using errcode='40001'; end if;
  select version_row.* into strict target_version from public.texting_message_draft_versions version_row
  where version_row.draft_id=target_draft.id and version_row.version=target_expected_draft_version for update;
  if target_version.connector_intent_id is not null then
    return jsonb_build_object('draft',to_jsonb(target_draft),'draftVersion',to_jsonb(target_version),
      'intent',(select to_jsonb(intent) from public.connector_action_intents intent where intent.id=target_version.connector_intent_id),
      'intentVersion',(select to_jsonb(v) from public.connector_action_intent_versions v where v.id=target_version.connector_intent_version_id),
      'noOp',true);
  end if;
  select authority.* into target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_draft.connection_id and authority.enabled
    and authority.readiness_state='active';
  if not found then raise exception 'active Twilio readiness required' using errcode='23514'; end if;
  select state.* into target_consent from public.texting_consent_states state
  where state.connection_id=target_draft.connection_id and state.contact_point_id=target_draft.contact_point_id
    and state.use_case=target_draft.use_case and state.status='opted_in'
    and state.current_event_id=target_version.consent_event_id
    and state.policy_id=target_version.texting_policy_id
    and state.policy_version=target_version.texting_policy_version;
  if not found or exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=target_draft.connection_id
        and suppression.phone_hash=target_version.recipient_phone_hash
        and suppression.use_case=target_draft.use_case and suppression.released_at is null) then
    raise exception 'current explicit texting consent required' using errcode='23514';
  end if;
  prepared:=public.create_connector_action_intent(target_draft.connection_id,'message.send',target_summary,
    target_version.content_payload_ref,target_version.body_hash,target_connector_policy_id,
    target_connector_policy_version,jsonb_build_object(
      'draftId',target_draft.id,'draftVersion',target_version.version,
      'recipientPhoneHash',target_version.recipient_phone_hash,'senderKeyHash',target_version.sender_key_hash,
      'bodyHash',target_version.body_hash,'consentEventId',target_consent.current_event_id,
      'textingPolicyId',target_version.texting_policy_id,'textingPolicyVersion',target_version.texting_policy_version),
    target_correlation_id);
  prepared_intent_id:=(prepared->'intent'->>'id')::uuid;
  prepared_version_id:=(prepared->'version'->>'id')::uuid;
  update public.texting_message_draft_versions set connector_intent_id=prepared_intent_id,
    connector_intent_version_id=prepared_version_id where id=target_version.id
  returning * into target_version;
  return jsonb_build_object('draft',to_jsonb(target_draft),'draftVersion',to_jsonb(target_version),
    'intent',prepared->'intent','intentVersion',prepared->'version','noOp',false);
end;
$$;

create or replace function public.approve_and_enqueue_twilio_message_send(
  target_intent_id uuid,target_expected_intent_version integer,target_payload_hash text,
  target_idempotency_key text,target_recipient_timezone text,target_timezone_source text,
  target_quiet_hours_decision text,target_evaluated_at timestamptz,target_scheduled_at timestamptz,
  target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_intent public.connector_action_intents%rowtype;
 target_intent_version public.connector_action_intent_versions%rowtype;
 target_draft_version public.texting_message_draft_versions%rowtype;
 target_draft public.texting_message_drafts%rowtype; target_policy public.twilio_compliance_policies%rowtype;
 target_consent public.texting_consent_states%rowtype; target_authority public.twilio_connection_authorities%rowtype;
 enqueued jsonb; target_job public.connector_jobs%rowtype; target_approval public.connector_approval_events%rowtype;
 target_snapshot public.texting_send_approval_snapshots%rowtype; target_message public.texting_messages%rowtype;
begin
  select intent.* into target_intent from public.connector_action_intents intent
  where intent.id=target_intent_id and intent.provider='twilio' and intent.action_type='message.send' for update;
  if not found then raise exception 'Twilio message intent not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_intent.workspace_id,true);
  select version_row.* into target_intent_version from public.connector_action_intent_versions version_row
  where version_row.intent_id=target_intent.id and version_row.version=target_expected_intent_version;
  if not found or target_intent.current_version<>target_expected_intent_version
     or target_intent_version.payload_hash<>target_payload_hash then
    raise exception 'Twilio approval intent version conflict' using errcode='40001'; end if;
  select version_row.* into target_draft_version from public.texting_message_draft_versions version_row
  where version_row.connector_intent_version_id=target_intent_version.id;
  if not found then raise exception 'Twilio draft binding missing' using errcode='23503'; end if;
  select draft.* into target_draft from public.texting_message_drafts draft
  where draft.id=target_draft_version.draft_id for update;
  select snapshot.* into target_snapshot from public.texting_send_approval_snapshots snapshot
  where snapshot.intent_version_id=target_intent_version.id;
  if found then
    select message.* into target_message from public.texting_messages message
      where message.approval_snapshot_id=target_snapshot.id;
    select job.* into target_job from public.connector_jobs job where job.id=target_snapshot.job_id;
    if target_job.idempotency_key<>target_idempotency_key
       or target_snapshot.body_hash<>target_payload_hash
       or target_snapshot.recipient_timezone is distinct from target_recipient_timezone
       or target_snapshot.timezone_source is distinct from target_timezone_source
       or target_snapshot.quiet_hours_decision<>target_quiet_hours_decision
       or target_snapshot.evaluated_at<>target_evaluated_at
       or target_snapshot.scheduled_at<>target_scheduled_at then
      raise exception 'divergent Twilio approval replay' using errcode='23505';
    end if;
    return jsonb_build_object('snapshot',to_jsonb(target_snapshot),'message',to_jsonb(target_message),
      'job',to_jsonb(target_job),'noOp',true);
  end if;
  if target_draft.current_version<>target_draft_version.version or target_draft.state<>'draft' then
    raise exception 'Twilio draft changed after intent preparation' using errcode='40001'; end if;
  select authority.* into target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_intent.connection_id and authority.enabled
    and authority.readiness_state='active';
  if not found then raise exception 'active Twilio readiness required' using errcode='23514'; end if;
  select policy.* into target_policy from public.twilio_compliance_policies policy
  where policy.id=target_draft_version.texting_policy_id and policy.version=target_draft_version.texting_policy_version
    and policy.superseded_at is null;
  if not found then raise exception 'Twilio compliance policy drift requires reapproval' using errcode='40001'; end if;
  select state.* into target_consent from public.texting_consent_states state
  where state.connection_id=target_draft.connection_id and state.contact_point_id=target_draft.contact_point_id
    and state.use_case=target_draft.use_case and state.status='opted_in'
    and state.current_event_id=target_draft_version.consent_event_id;
  if not found or exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=target_draft.connection_id
        and suppression.phone_hash=target_draft_version.recipient_phone_hash
        and suppression.use_case=target_draft.use_case and suppression.released_at is null) then
    raise exception 'texting consent drift or STOP suppression blocks approval' using errcode='23514'; end if;
  if target_quiet_hours_decision not in ('send_now','defer') or target_scheduled_at<target_evaluated_at then
    raise exception 'invalid quiet-hours decision' using errcode='22023'; end if;
  if target_recipient_timezone is null then
    if target_timezone_source is not null or target_policy.unknown_timezone_action='block'
       or target_quiet_hours_decision<>'defer'
       or target_scheduled_at<target_evaluated_at+make_interval(mins=>target_policy.default_defer_minutes) then
      raise exception 'unknown recipient timezone is fail-closed' using errcode='23514'; end if;
  elsif target_timezone_source is null or length(target_recipient_timezone)>120 or length(target_timezone_source)>64 then
    raise exception 'verified recipient timezone source required' using errcode='23514';
  end if;

  insert into connector_private.twilio_specialized_approval_guards(
    intent_id,intent_version_id,transaction_id,created_at
  ) values (target_intent.id,target_intent_version.id,pg_catalog.txid_current(),target_evaluated_at);
  enqueued:=public.approve_and_enqueue_connector_action(target_intent.id,target_expected_intent_version,
    target_payload_hash,target_idempotency_key,target_correlation_id,target_scheduled_at,3);
  delete from connector_private.twilio_specialized_approval_guards
  where intent_id=target_intent.id and intent_version_id=target_intent_version.id
    and transaction_id=pg_catalog.txid_current();
  target_job:=jsonb_populate_record(null::public.connector_jobs,enqueued->'job');
  select approval.* into strict target_approval from public.connector_approval_events approval
  where approval.intent_version_id=target_intent_version.id;
  insert into public.texting_send_approval_snapshots(
    workspace_id,connection_id,draft_id,draft_version_id,intent_id,intent_version_id,
    approval_event_id,job_id,contact_id,contact_point_id,recipient_phone_hash,sender_key_hash,
    body_hash,consent_event_id,consent_status,texting_policy_id,texting_policy_version,
    connector_policy_id,connector_policy_version,recipient_timezone,timezone_source,
    quiet_hours_start,quiet_hours_end,quiet_hours_decision,evaluated_at,scheduled_at,
    approved_by_membership_id,correlation_id,created_at
  ) values (
    target_intent.workspace_id,target_intent.connection_id,target_draft.id,target_draft_version.id,
    target_intent.id,target_intent_version.id,target_approval.id,target_job.id,target_draft.contact_id,
    target_draft.contact_point_id,target_draft_version.recipient_phone_hash,target_draft_version.sender_key_hash,
    target_draft_version.body_hash,target_consent.current_event_id,'opted_in',target_policy.id,target_policy.version,
    target_intent_version.policy_id,target_intent_version.policy_version,target_recipient_timezone,
    target_timezone_source,target_policy.quiet_hours_start,target_policy.quiet_hours_end,
    target_quiet_hours_decision,target_evaluated_at,target_scheduled_at,actor.id,target_correlation_id,
    target_evaluated_at
  ) returning * into target_snapshot;
  insert into public.texting_messages(
    workspace_id,connection_id,conversation_id,contact_id,contact_point_id,draft_version_id,
    approval_snapshot_id,job_id,direction,content_payload_ref,body_hash,recipient_phone_hash,
    sender_key_hash,status,status_rank,correlation_id,created_at,updated_at
  ) values (
    target_intent.workspace_id,target_intent.connection_id,target_draft.conversation_id,target_draft.contact_id,
    target_draft.contact_point_id,target_draft_version.id,target_snapshot.id,target_job.id,'outbound',
    target_draft_version.content_payload_ref,target_draft_version.body_hash,target_draft_version.recipient_phone_hash,
    target_draft_version.sender_key_hash,'queued',10,target_correlation_id,target_evaluated_at,target_evaluated_at
  ) returning * into target_message;
  update public.texting_message_drafts set state='prepared',updated_at=target_evaluated_at
  where id=target_draft.id returning * into target_draft;
  return jsonb_build_object('draft',to_jsonb(target_draft),'snapshot',to_jsonb(target_snapshot),
    'message',to_jsonb(target_message),'job',to_jsonb(target_job),'receipt',enqueued->'receipt','noOp',false);
end;
$$;

create or replace function public.guard_twilio_generic_approval_bypass()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_intent public.connector_action_intents%rowtype;
begin
  select intent.* into target_intent from public.connector_action_intents intent
  where intent.id=new.intent_id and intent.workspace_id=new.workspace_id;
  if target_intent.provider='twilio' and target_intent.action_type='message.send'
     and not exists(
       select 1 from connector_private.twilio_specialized_approval_guards guard_row
       where guard_row.intent_id=new.intent_id
         and guard_row.intent_version_id=new.intent_version_id
         and guard_row.transaction_id=pg_catalog.txid_current()
     ) then
    raise exception 'Twilio message.send requires specialized consent and quiet-hours approval'
      using errcode='23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_twilio_generic_approval_bypass()
  from public,anon,authenticated,service_role;

create trigger connector_approval_events_guard_twilio_specialized
  before insert on public.connector_approval_events
  for each row execute function public.guard_twilio_generic_approval_bypass();

create or replace function public.archive_twilio_message_draft(
  target_draft_id uuid,target_expected_version integer,target_correlation_id uuid,
  target_archived_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_draft public.texting_message_drafts%rowtype;
begin
  select draft.* into target_draft from public.texting_message_drafts draft
  where draft.id=target_draft_id for update;
  if not found then raise exception 'Twilio draft not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_draft.workspace_id,false);
  if target_draft.current_version<>target_expected_version then
    raise exception 'Twilio draft version conflict' using errcode='40001'; end if;
  if target_draft.state='archived' then return jsonb_build_object('draft',to_jsonb(target_draft),'noOp',true); end if;
  if target_draft.state<>'draft' then raise exception 'prepared or sent Twilio draft cannot be archived' using errcode='23514'; end if;
  update public.texting_message_drafts set state='archived',archived_at=target_archived_at,
    correlation_id=target_correlation_id,updated_at=target_archived_at
  where id=target_draft.id returning * into target_draft;
  return jsonb_build_object('draft',to_jsonb(target_draft),'noOp',false);
end;
$$;

-- Fenced worker authority and provider SID binding ---------------------------

create or replace function connector_private.twilio_secret_json(target_secret connector_private.connector_connection_secrets)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('secretId',target_secret.id,'secretType',target_secret.secret_type,
    'secretVersion',target_secret.secret_version,'ciphertext',encode(target_secret.ciphertext,'base64'),
    'nonce',encode(target_secret.nonce,'base64'),'authTag',encode(target_secret.auth_tag,'base64'),
    'wrappedDek',encode(target_secret.wrapped_dek,'base64'),'wrapNonce',encode(target_secret.wrap_nonce,'base64'),
    'wrapAuthTag',encode(target_secret.wrap_auth_tag,'base64'),'kekVersion',target_secret.kek_version,
    'aadHash',target_secret.aad_hash,'expiresAt',target_secret.expires_at)
$$;

create or replace function connector_private.twilio_payload_json(target_payload connector_private.connector_payload_envelopes)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('payloadRef',target_payload.id,'payloadKind',target_payload.payload_kind,
    'schemaVersion',target_payload.schema_version,'canonicalHash',target_payload.canonical_hash,
    'ciphertext',encode(target_payload.ciphertext,'base64'),'nonce',encode(target_payload.nonce,'base64'),
    'authTag',encode(target_payload.auth_tag,'base64'),'wrappedDek',encode(target_payload.wrapped_dek,'base64'),
    'wrapNonce',encode(target_payload.wrap_nonce,'base64'),'wrapAuthTag',encode(target_payload.wrap_auth_tag,'base64'),
    'kekVersion',target_payload.kek_version,'aadHash',target_payload.aad_hash,
    'envelopeVersion',target_payload.envelope_version)
$$;

create or replace function public.start_twilio_message_send_attempt(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_started_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare started jsonb; target_job public.connector_jobs%rowtype; target_message public.texting_messages%rowtype;
begin
  select job.* into target_job from public.connector_jobs job
  where job.id=target_job_id and job.provider='twilio' and job.action_type='message.send';
  if not found then raise exception 'Twilio message job not found' using errcode='P0002'; end if;
  started:=public.start_connector_job_attempt(target_job_id,target_worker_id,target_fencing_token,target_started_at);
  update public.texting_messages set side_effect_started_at=coalesce(side_effect_started_at,target_started_at),
    updated_at=target_started_at where job_id=target_job_id returning * into target_message;
  if not found then raise exception 'Twilio message authorization missing' using errcode='23503'; end if;
  return jsonb_build_object('job',started->'job','intent',started->'intent',
    'receipt',started->'receipt','message',to_jsonb(target_message));
end;
$$;

create or replace function public.read_twilio_job_authority(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_connection public.connector_connections%rowtype;
 target_authority public.twilio_connection_authorities%rowtype; target_message public.texting_messages%rowtype;
 target_snapshot public.texting_send_approval_snapshots%rowtype; target_consent public.texting_consent_states%rowtype;
 target_draft_version public.texting_message_draft_versions%rowtype;
 provider_secret connector_private.connector_connection_secrets%rowtype;
 api_secret connector_private.connector_connection_secrets%rowtype;
 target_payload connector_private.connector_payload_envelopes%rowtype;
 target_resource connector_private.twilio_message_resources%rowtype;
begin
  select job.* into target_job from public.connector_jobs job
  where job.id=target_job_id and job.provider='twilio' and job.action_type='message.send'
    and job.state='executing' and job.lease_owner=target_worker_id
    and job.fencing_token=target_fencing_token and job.lease_expires_at>target_now;
  if not found then raise exception 'active fenced Twilio message job required' using errcode='42501'; end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_job.connection_id and connection.workspace_id=target_job.workspace_id
    and connection.provider='twilio' and connection.status in ('active','degraded');
  select authority.* into target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_job.connection_id and authority.workspace_id=target_job.workspace_id
    and authority.enabled and authority.readiness_state='active';
  if not found then raise exception 'active Twilio readiness required' using errcode='42501'; end if;
  select message.* into strict target_message from public.texting_messages message
  where message.job_id=target_job.id and message.workspace_id=target_job.workspace_id;
  select snapshot.* into strict target_snapshot from public.texting_send_approval_snapshots snapshot
  where snapshot.id=target_message.approval_snapshot_id and snapshot.job_id=target_job.id;
  select version_row.* into strict target_draft_version
  from public.texting_message_draft_versions version_row
  where version_row.id=target_snapshot.draft_version_id
    and version_row.draft_id=target_snapshot.draft_id
    and version_row.content_payload_ref=target_job.payload_ref
    and version_row.body_hash=target_job.payload_hash;
  perform connector_private.twilio_active_phone(target_job.workspace_id,
    target_snapshot.contact_id,target_snapshot.contact_point_id);
  select state.* into target_consent from public.texting_consent_states state
  where state.connection_id=target_job.connection_id and state.contact_point_id=target_snapshot.contact_point_id
    and state.use_case=(select draft.use_case from public.texting_message_drafts draft where draft.id=target_snapshot.draft_id)
    and state.status='opted_in' and state.current_event_id=target_snapshot.consent_event_id;
  if not found or exists(select 1 from public.texting_phone_suppressions suppression
      where suppression.connection_id=target_job.connection_id
        and suppression.phone_hash=target_snapshot.recipient_phone_hash
        and suppression.released_at is null) then
    raise exception 'current Twilio consent authority unavailable' using errcode='42501'; end if;
  select secret.* into provider_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_job.connection_id and secret.secret_type='twilio-provider-authority'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio provider authority secret unavailable' using errcode='P0002'; end if;
  select secret.* into api_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_job.connection_id and secret.secret_type='twilio-api-key-secret'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio API credential unavailable' using errcode='P0002'; end if;
  select payload.* into target_payload from connector_private.connector_payload_envelopes payload
  where payload.id=target_job.payload_ref and payload.workspace_id=target_job.workspace_id
    and payload.connection_id=target_job.connection_id and payload.canonical_hash=target_job.payload_hash
    and payload.payload_kind='twilio-message-body' and payload.destroyed_at is null;
  if not found then raise exception 'Twilio message payload unavailable' using errcode='P0002'; end if;
  select resource.* into target_resource from connector_private.twilio_message_resources resource
  where resource.message_id=target_message.id and resource.workspace_id=target_job.workspace_id
    and resource.connection_id=target_job.connection_id;
  return jsonb_build_object('job',to_jsonb(target_job),'connection',to_jsonb(target_connection),
    'authority',to_jsonb(target_authority),'approvalSnapshot',to_jsonb(target_snapshot),
    'draftVersion',to_jsonb(target_draft_version),
    'message',to_jsonb(target_message),'providerAuthority',connector_private.twilio_secret_json(provider_secret),
    'apiCredential',connector_private.twilio_secret_json(api_secret),
    'executionMode',case when target_resource.message_id is null then 'send' else 'lookup-only' end,
    'payloadEnvelope',case when target_resource.message_id is null
      then connector_private.twilio_payload_json(target_payload) else null end,
    'providerMessageBinding',case when target_resource.message_id is null then null else
      jsonb_build_object('providerMessageSid',target_resource.provider_message_sid,
        'providerMessageSidHash',target_resource.provider_message_sid_hash,
        'boundAt',target_resource.created_at) end);
end;
$$;

create or replace function public.bind_twilio_provider_message(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_provider_message_sid text,target_provider_status text,
  target_provider_request_hash text,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; target_message public.texting_messages%rowtype;
 target_resource connector_private.twilio_message_resources%rowtype; target_receipt public.connector_receipt_events%rowtype;
 sid_hash text; next_rank integer;
begin
  if target_provider_message_sid !~ '^SM[0-9A-Fa-f]{32}$'
     or target_provider_request_hash !~ '^[0-9a-f]{64}$'
     or target_provider_status not in ('accepted','scheduled','queued','sending','sent') then
    raise exception 'invalid Twilio provider acceptance' using errcode='22023'; end if;
  select job.* into target_job from public.connector_jobs job
  where job.id=target_job_id and job.provider='twilio' and job.action_type='message.send'
    and job.state='executing' and job.lease_owner=target_worker_id
    and job.fencing_token=target_fencing_token and job.lease_expires_at>target_occurred_at;
  if not found then raise exception 'active fenced Twilio message job required' using errcode='42501'; end if;
  sid_hash:=encode(extensions.digest(pg_catalog.convert_to(target_provider_message_sid,'UTF8'),'sha256'),'hex');
  select message.* into strict target_message from public.texting_messages message
  where message.job_id=target_job.id for update;
  select resource.* into target_resource from connector_private.twilio_message_resources resource
  where resource.message_id=target_message.id;
  if found then
    if target_resource.provider_message_sid<>target_provider_message_sid then
      raise exception 'Twilio provider SID binding conflict' using errcode='23505'; end if;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_job.workspace_id and receipt.event_key='twilio.provider.accepted:'||target_message.id::text;
    return jsonb_build_object('message',to_jsonb(target_message),'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  insert into connector_private.twilio_message_resources(
    workspace_id,connection_id,message_id,provider_message_sid,provider_message_sid_hash,created_at
  ) values (target_job.workspace_id,target_job.connection_id,target_message.id,target_provider_message_sid,sid_hash,target_occurred_at)
  returning * into target_resource;
  next_rank:=connector_private.twilio_status_rank(target_provider_status);
  update public.texting_messages set provider_message_sid_hash=sid_hash,status=target_provider_status::public.texting_message_status,
    status_rank=next_rank,provider_status_at=target_occurred_at,accepted_at=target_occurred_at,
    updated_at=target_occurred_at where id=target_message.id returning * into target_message;
  update public.texting_message_drafts set state='sent',updated_at=target_occurred_at
    where id=(select version_row.draft_id from public.texting_message_draft_versions version_row
      where version_row.id=target_message.draft_version_id);
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,event_key,
    correlation_id,attempt_number,fencing_token,provider_request_hash,remote_operation_id,
    provider_status,redacted_metadata,occurred_at
  ) values (
    target_job.workspace_id,target_job.connection_id,'twilio',target_job.id,target_job.intent_id,
    target_job.intent_version_id,'provider.accepted','twilio.provider.accepted:'||target_message.id::text,
    target_job.correlation_id,target_job.attempt_count,target_job.fencing_token,target_provider_request_hash,
    sid_hash,target_provider_status,jsonb_build_object('messageId',target_message.id,'messageSidHash',sid_hash,
      'direction','outbound'),target_occurred_at
  ) returning * into target_receipt;
  return jsonb_build_object('message',to_jsonb(target_message),'receipt',to_jsonb(target_receipt),
    'providerMessageSidHash',sid_hash,'noOp',false);
end;
$$;

create or replace function connector_private.apply_twilio_message_status(
  target_message_id uuid,target_provider_status text,target_error_category text,
  target_status_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_message public.texting_messages%rowtype; next_rank integer; next_status public.texting_message_status;
begin
  next_rank:=connector_private.twilio_status_rank(target_provider_status);
  if next_rank is null or target_provider_status='received'
     or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$') then
    raise exception 'invalid Twilio delivery status' using errcode='22023'; end if;
  next_status:=target_provider_status::public.texting_message_status;
  select message.* into target_message from public.texting_messages message
  where message.id=target_message_id for update;
  if not found then raise exception 'Twilio message not found' using errcode='P0002'; end if;
  if connector_private.is_twilio_terminal_status(target_message.status::text)
     or next_rank<target_message.status_rank
     or (next_rank=target_message.status_rank and next_status<>target_message.status) then
    return jsonb_build_object('message',to_jsonb(target_message),'noOp',true,'ignoredOutOfOrder',true);
  end if;
  if next_status=target_message.status and target_status_at<=coalesce(target_message.provider_status_at,'-infinity'::timestamptz) then
    return jsonb_build_object('message',to_jsonb(target_message),'noOp',true,'ignoredOutOfOrder',true);
  end if;
  update public.texting_messages set status=next_status,status_rank=next_rank,
    provider_status_at=greatest(coalesce(provider_status_at,target_status_at),target_status_at),
    terminal_at=case when connector_private.is_twilio_terminal_status(target_provider_status)
      then coalesce(terminal_at,target_status_at) else terminal_at end,
    last_error_category=target_error_category,updated_at=greatest(updated_at,target_status_at)
  where id=target_message.id returning * into target_message;
  return jsonb_build_object('message',to_jsonb(target_message),'noOp',false,'ignoredOutOfOrder',false);
end;
$$;

-- Exact-URL callback verification material and atomic verified ingress --------

create or replace function public.read_twilio_callback_verification_authority(
  target_endpoint_key_hash text,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_callback connector_private.twilio_callback_authorities%rowtype;
 target_authority public.twilio_connection_authorities%rowtype;
 target_connection public.connector_connections%rowtype;
 target_secret connector_private.connector_connection_secrets%rowtype;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Twilio callback endpoint key' using errcode='22023'; end if;
  select callback.* into target_callback from connector_private.twilio_callback_authorities callback
  where callback.endpoint_key_hash=target_endpoint_key_hash and callback.revoked_at is null;
  if not found then raise exception 'active Twilio callback endpoint not found' using errcode='P0002'; end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_callback.connection_id and connection.workspace_id=target_callback.workspace_id
    and connection.provider='twilio' and connection.status in ('active','degraded','reauthorization_required','revoking');
  if not found then raise exception 'Twilio callback connection unavailable' using errcode='42501'; end if;
  select authority.* into strict target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.callback_external_url_hash=target_callback.exact_external_url_hash;
  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.workspace_id=target_connection.workspace_id
    and secret.secret_type='twilio-webhook-auth-token' and secret.destroyed_at is null
    and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio webhook verification secret unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('workspaceId',target_connection.workspace_id,'connectionId',target_connection.id,
    'provider','twilio','accountSidHash',target_authority.account_sid_hash,
    'messagingServiceSidHash',target_authority.messaging_service_sid_hash,
    'senderKeyHash',target_authority.sender_key_hash,
    'exactExternalUrlHash',target_callback.exact_external_url_hash,
    'secret',connector_private.twilio_secret_json(target_secret));
end;
$$;

create or replace function public.register_and_apply_twilio_callback(
  target_endpoint_key_hash text,
  target_replay_key_hash text,
  target_raw_body_hash text,
  target_parameters_hash text,
  target_exact_external_url_hash text,
  target_account_sid_hash text,
  target_sender_key_hash text,
  target_provider_message_sid text,
  target_callback_kind public.twilio_callback_kind,
  target_normalized_counterpart_phone text,
  target_keyword_class public.texting_keyword_class,
  target_provider_status text,
  target_error_category text,
  target_content_body_hash text,
  target_content_envelope jsonb,
  target_provider_occurred_at timestamptz,
  target_received_at timestamptz,
  target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_callback_authority connector_private.twilio_callback_authorities%rowtype;
  target_authority public.twilio_connection_authorities%rowtype;
  target_delivery public.connector_webhook_deliveries%rowtype;
  target_callback public.twilio_callback_events%rowtype;
  existing_callback public.twilio_callback_events%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  target_point public.contact_points%rowtype; target_contact public.contacts%rowtype;
  target_conversation public.texting_conversations%rowtype; target_message public.texting_messages%rowtype;
  target_resource connector_private.twilio_message_resources%rowtype;
  consent_result jsonb; created_consent public.texting_consent_events%rowtype;
  target_suppression public.texting_phone_suppressions%rowtype;
  target_incomplete public.incomplete_records%rowtype; canceled_job public.connector_jobs%rowtype;
  callback_receipt public.connector_receipt_events%rowtype;
  target_phone_hash text; sid_hash text; active_count integer; archived_count integer;
  target_review_reason text; status_result jsonb; canceled_count integer:=0;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$'
     or target_replay_key_hash !~ '^[0-9a-f]{64}$'
     or target_raw_body_hash !~ '^[0-9a-f]{64}$'
     or target_parameters_hash !~ '^[0-9a-f]{64}$'
     or target_exact_external_url_hash !~ '^[0-9a-f]{64}$'
     or target_account_sid_hash !~ '^[0-9a-f]{64}$'
     or target_sender_key_hash !~ '^[0-9a-f]{64}$'
     or target_provider_message_sid !~ '^SM[0-9A-Fa-f]{32}$'
     or target_correlation_id is null or target_provider_occurred_at is null or target_received_at is null
     or target_provider_occurred_at>target_received_at+interval '5 minutes'
     or target_received_at<clock_timestamp()-interval '15 minutes' then
    raise exception 'invalid verified Twilio callback metadata' using errcode='22023';
  end if;
  if target_callback_kind='status' and (target_keyword_class<>'none' or target_provider_status is null) then
    raise exception 'invalid Twilio status callback classification' using errcode='22023'; end if;
  if target_callback_kind='inbound' and target_provider_status is not null then
    raise exception 'inbound Twilio callback cannot carry delivery status' using errcode='22023'; end if;
  if target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$' then
    raise exception 'invalid Twilio callback error category' using errcode='22023'; end if;

  select callback.* into target_callback_authority from connector_private.twilio_callback_authorities callback
  where callback.endpoint_key_hash=target_endpoint_key_hash and callback.revoked_at is null;
  if not found then raise exception 'Twilio callback endpoint not found' using errcode='P0002'; end if;
  select authority.* into strict target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_callback_authority.connection_id
    and authority.workspace_id=target_callback_authority.workspace_id;
  if target_callback_authority.exact_external_url_hash<>target_exact_external_url_hash
     or target_authority.callback_external_url_hash<>target_exact_external_url_hash
     or target_authority.account_sid_hash<>target_account_sid_hash
     or target_authority.sender_key_hash<>target_sender_key_hash then
    raise exception 'Twilio callback account, sender, or exact URL binding mismatch' using errcode='42501';
  end if;
  sid_hash:=encode(extensions.digest(pg_catalog.convert_to(target_provider_message_sid,'UTF8'),'sha256'),'hex');
  if public.is_valid_contact_phone(target_normalized_counterpart_phone) then
    target_phone_hash:=encode(extensions.digest(pg_catalog.convert_to(
      public.normalize_contact_phone(target_normalized_counterpart_phone),'UTF8'),'sha256'),'hex');
  else
    target_phone_hash:=encode(extensions.digest(pg_catalog.convert_to(coalesce(target_normalized_counterpart_phone,''),'UTF8'),'sha256'),'hex');
    target_review_reason:='invalid_phone';
  end if;

  select callback.* into existing_callback from public.twilio_callback_events callback
  where callback.connection_id=target_callback_authority.connection_id
    and callback.replay_key_hash=target_replay_key_hash for update;
  if found then
    if existing_callback.raw_body_hash<>target_raw_body_hash
       or existing_callback.parameters_hash<>target_parameters_hash
       or existing_callback.exact_external_url_hash<>target_exact_external_url_hash
       or existing_callback.provider_message_sid_hash<>sid_hash
       or existing_callback.callback_kind<>target_callback_kind
       or existing_callback.keyword_class<>target_keyword_class
       or existing_callback.provider_status is distinct from target_provider_status then
      raise exception 'divergent Twilio callback replay' using errcode='23505'; end if;
    return jsonb_build_object('accepted',true,'noOp',true,'callback',to_jsonb(existing_callback),
      'message',(select to_jsonb(message) from public.texting_messages message where message.id=existing_callback.message_id),
      'canceledJobs',0);
  end if;

  insert into public.connector_webhook_deliveries(
    workspace_id,connection_id,provider,replay_key_hash,raw_body_hash,signature_valid,
    timestamp_valid,outcome,correlation_id,received_at,redacted_result
  ) values (
    target_callback_authority.workspace_id,target_callback_authority.connection_id,'twilio',
    target_replay_key_hash,target_raw_body_hash,true,true,'accepted',target_correlation_id,
    target_received_at,'verified_exact_url'
  ) returning * into target_delivery;
  insert into public.twilio_callback_events(
    workspace_id,connection_id,webhook_delivery_id,callback_kind,state,replay_key_hash,
    raw_body_hash,parameters_hash,exact_external_url_hash,account_sid_hash,sender_key_hash,
    provider_message_sid_hash,counterpart_phone_hash,keyword_class,provider_status,
    review_reason,correlation_id,received_at
  ) values (
    target_callback_authority.workspace_id,target_callback_authority.connection_id,target_delivery.id,
    target_callback_kind,'accepted',target_replay_key_hash,target_raw_body_hash,target_parameters_hash,
    target_exact_external_url_hash,target_account_sid_hash,target_sender_key_hash,sid_hash,target_phone_hash,
    target_keyword_class,target_provider_status,target_review_reason,target_correlation_id,target_received_at
  ) returning * into target_callback;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    remote_operation_id,provider_status,redacted_metadata,occurred_at
  ) values (
    target_delivery.workspace_id,target_delivery.connection_id,'twilio','webhook.accepted',
    'twilio.webhook.accepted:'||target_delivery.id::text,target_delivery.correlation_id,
    target_parameters_hash,sid_hash,target_provider_status,jsonb_build_object(
      'callbackId',target_callback.id,'callbackKind',target_callback_kind,
      'keywordClass',target_keyword_class,'messageSidHash',sid_hash),target_received_at
  ) returning * into callback_receipt;

  if target_review_reason is null and target_callback_kind='inbound' then
    select count(*) filter(where contact.archived_at is null and point.archived_at is null),
      count(*) filter(where contact.archived_at is not null or point.archived_at is not null)
      into active_count,archived_count
    from public.contact_points point join public.contacts contact
      on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
    where point.workspace_id=target_callback.workspace_id and point.type='phone'
      and point.normalized_value=public.normalize_contact_phone(target_normalized_counterpart_phone);
    if active_count=1 then
      select point.* into target_point
      from public.contact_points point join public.contacts contact
        on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
      where point.workspace_id=target_callback.workspace_id and point.type='phone'
        and point.archived_at is null and contact.archived_at is null
        and point.normalized_value=public.normalize_contact_phone(target_normalized_counterpart_phone);
      select contact.* into strict target_contact from public.contacts contact
      where contact.id=target_point.contact_id and contact.workspace_id=target_point.workspace_id;
    elsif active_count>1 then target_review_reason:='shared_phone';
    elsif archived_count>0 then target_review_reason:='archived_phone';
    else target_review_reason:='no_phone_match'; end if;
  end if;

  -- STOP is first: install a workspace/connection/use-case suppression and
  -- cancel every pre-side-effect job before considering content/history.
  if target_callback_kind='inbound' and target_keyword_class='stop' then
    insert into public.texting_phone_suppressions(
      workspace_id,connection_id,phone_hash,use_case,source_callback_id,suppressed_at,updated_at
    ) values (
      target_callback.workspace_id,target_callback.connection_id,target_phone_hash,
      target_authority.approved_use_case,target_callback.id,target_provider_occurred_at,target_received_at
    ) on conflict(connection_id,phone_hash,use_case) do update set
      source_callback_id=excluded.source_callback_id,source_consent_event_id=null,
      suppressed_at=greatest(public.texting_phone_suppressions.suppressed_at,excluded.suppressed_at),
      released_at=null,release_consent_event_id=null,updated_at=excluded.updated_at
    returning * into target_suppression;

    for canceled_job in
      select job.* from public.connector_jobs job join public.texting_messages message on message.job_id=job.id
      where job.workspace_id=target_callback.workspace_id and job.connection_id=target_callback.connection_id
        and job.action_type='message.send' and message.recipient_phone_hash=target_phone_hash
        and message.side_effect_started_at is null and job.state in ('queued','retry_wait','leased')
      for update of job
    loop
      if canceled_job.state='leased' then
        update public.connector_jobs set state='queued',lease_owner=null,lease_expires_at=null
          where id=canceled_job.id;
      end if;
      update public.connector_jobs set state='cancelled',cancelled_at=target_received_at,
        last_error_category='recipient_opted_out',lease_owner=null,lease_expires_at=null
      where id=canceled_job.id;
      update public.connector_action_intents set state='cancelled' where id=canceled_job.intent_id and state='queued';
      update public.texting_messages set status='canceled',status_rank=90,terminal_at=target_received_at,
        last_error_category='recipient_opted_out',updated_at=target_received_at where job_id=canceled_job.id;
      insert into public.connector_receipt_events(
        workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,event_key,
        correlation_id,error_category,redacted_metadata,occurred_at
      ) values (
        canceled_job.workspace_id,canceled_job.connection_id,'twilio',canceled_job.id,canceled_job.intent_id,
        canceled_job.intent_version_id,'job.cancelled','twilio.stop.cancelled:'||canceled_job.id::text,
        target_correlation_id,'recipient_opted_out',jsonb_build_object('reason','verified_stop'),target_received_at
      ) on conflict(workspace_id,event_key) do nothing;
      canceled_count:=canceled_count+1;
    end loop;

    if target_review_reason is null then
      consent_result:=connector_private.apply_twilio_consent_event(target_callback.connection_id,
        target_contact.id,target_point.id,target_authority.approved_use_case,'opted_out',
        'provider-keyword','twilio-opt-out-type',
        (select policy.disclosure_version from public.twilio_compliance_policies policy
          where policy.connection_id=target_callback.connection_id and policy.superseded_at is null),
        target_parameters_hash,null,null,null,target_replay_key_hash,target_correlation_id,target_provider_occurred_at);
      created_consent:=jsonb_populate_record(null::public.texting_consent_events,consent_result->'event');
      update public.texting_phone_suppressions set source_consent_event_id=created_consent.id,
        updated_at=target_received_at where id=target_suppression.id returning * into target_suppression;
    end if;
    update public.twilio_callback_events set state=case when target_review_reason is null
      then 'applied'::public.twilio_callback_state else 'review'::public.twilio_callback_state end,
      review_reason=target_review_reason,processed_at=target_received_at where id=target_callback.id returning * into target_callback;
    update public.connector_webhook_deliveries set processed_at=target_received_at,
      redacted_result=case when target_review_reason is null then 'stop_applied' else 'stop_suppressed_review' end
      where id=target_delivery.id;
    return jsonb_build_object('accepted',true,'noOp',false,'callback',to_jsonb(target_callback),
      'consent',consent_result,'suppression',to_jsonb(target_suppression),'canceledJobs',canceled_count);
  end if;

  if target_callback_kind='inbound' and target_keyword_class='start' then
    if target_review_reason is null then
      consent_result:=connector_private.apply_twilio_consent_event(target_callback.connection_id,
        target_contact.id,target_point.id,target_authority.approved_use_case,'opted_in',
        'provider-keyword','twilio-opt-out-type',
        (select policy.disclosure_version from public.twilio_compliance_policies policy
          where policy.connection_id=target_callback.connection_id and policy.superseded_at is null),
        target_parameters_hash,null,null,null,target_replay_key_hash,target_correlation_id,target_provider_occurred_at);
      created_consent:=jsonb_populate_record(null::public.texting_consent_events,consent_result->'event');
      update public.texting_phone_suppressions suppression set released_at=target_provider_occurred_at,
        release_consent_event_id=created_consent.id,updated_at=target_received_at
      where suppression.connection_id=target_callback.connection_id and suppression.phone_hash=target_phone_hash
        and suppression.use_case=target_authority.approved_use_case and suppression.released_at is null;
    end if;
    update public.twilio_callback_events set state=case when target_review_reason is null
      then 'applied'::public.twilio_callback_state else 'review'::public.twilio_callback_state end,
      review_reason=target_review_reason,processed_at=target_received_at where id=target_callback.id returning * into target_callback;
    update public.connector_webhook_deliveries set processed_at=target_received_at,
      redacted_result=case when target_review_reason is null then 'start_applied' else 'start_review' end
      where id=target_delivery.id;
    return jsonb_build_object('accepted',true,'noOp',false,'callback',to_jsonb(target_callback),
      'consent',consent_result,'canceledJobs',0);
  end if;

  if target_callback_kind='inbound' and target_keyword_class='help' then
    update public.twilio_callback_events set state=case when target_review_reason is null
      then 'applied'::public.twilio_callback_state else 'review'::public.twilio_callback_state end,
      review_reason=target_review_reason,processed_at=target_received_at where id=target_callback.id returning * into target_callback;
    update public.connector_webhook_deliveries set processed_at=target_received_at,redacted_result='help_recorded'
      where id=target_delivery.id;
    return jsonb_build_object('accepted',true,'noOp',false,'callback',to_jsonb(target_callback),'canceledJobs',0);
  end if;

  if target_callback_kind='status' then
    select resource.* into target_resource from connector_private.twilio_message_resources resource
    where resource.connection_id=target_callback.connection_id
      and resource.provider_message_sid=target_provider_message_sid;
    if not found then target_review_reason:='unknown_message_sid';
    else
      status_result:=connector_private.apply_twilio_message_status(target_resource.message_id,
        target_provider_status,target_error_category,target_provider_occurred_at);
      target_message:=jsonb_populate_record(null::public.texting_messages,status_result->'message');
    end if;
    update public.twilio_callback_events set state=case when target_review_reason is null
      then 'applied'::public.twilio_callback_state else 'review'::public.twilio_callback_state end,
      review_reason=target_review_reason,message_id=target_message.id,processed_at=target_received_at
    where id=target_callback.id returning * into target_callback;
    update public.connector_webhook_deliveries set processed_at=target_received_at,
      redacted_result=case when target_review_reason is null then 'status_applied' else 'status_review' end
      where id=target_delivery.id;
    return jsonb_build_object('accepted',true,'noOp',false,'callback',to_jsonb(target_callback),
      'message',case when target_message.id is null then null else to_jsonb(target_message) end,
      'statusResult',status_result,'canceledJobs',0);
  end if;

  -- Unsupported keywords and unresolved/shared/archived identities are
  -- quarantined without storing raw phone/body in the public review record.
  if target_keyword_class='unsupported' then target_review_reason:=coalesce(target_review_reason,'unsupported_keyword'); end if;
  if target_review_reason is not null then
    insert into public.incomplete_records(
      workspace_id,source,external_id,candidate,validation_reasons,status,
      intake_idempotency_key,intake_request_hash,created_at,updated_at
    ) values (
      target_callback.workspace_id,'twilio-callback',target_replay_key_hash,'{}'::jsonb,
      jsonb_build_array(jsonb_build_object('field','phone','code',target_review_reason,
        'message','Verified Twilio callback requires human identity review')),
      'pending','twilio-callback:'||target_replay_key_hash,target_parameters_hash,target_received_at,target_received_at
    ) on conflict(workspace_id,intake_idempotency_key)
      where intake_idempotency_key is not null
      do update set updated_at=excluded.updated_at
    returning * into target_incomplete;
    insert into public.activity_events(
      workspace_id,type,incomplete_record_id,actor_membership_id,occurred_at,idempotency_key
    ) values (
      target_callback.workspace_id,'incomplete-record-received',target_incomplete.id,
      target_authority.created_by_membership_id,target_received_at,'twilio-review:'||target_replay_key_hash
    ) on conflict(workspace_id,idempotency_key) do nothing;
    update public.twilio_callback_events set state='review',review_reason=target_review_reason,
      processed_at=target_received_at where id=target_callback.id returning * into target_callback;
    update public.connector_webhook_deliveries set processed_at=target_received_at,redacted_result='identity_review'
      where id=target_delivery.id;
    return jsonb_build_object('accepted',true,'noOp',false,'callback',to_jsonb(target_callback),
      'reviewRecord',to_jsonb(target_incomplete),'canceledJobs',0);
  end if;

  if target_content_body_hash !~ '^[0-9a-f]{64}$' or target_content_envelope is null then
    raise exception 'encrypted inbound Twilio body required' using errcode='22023'; end if;
  target_payload:=connector_private.store_twilio_content_payload(target_callback.connection_id,
    'twilio-inbound-body','twilio-inbound-body.v1',target_content_body_hash,
    target_content_envelope,target_received_at);
  insert into public.texting_conversations(
    workspace_id,connection_id,contact_id,contact_point_id,use_case,recipient_phone_hash,
    sender_key_hash,state,last_message_at,created_at,updated_at
  ) values (
    target_callback.workspace_id,target_callback.connection_id,target_contact.id,target_point.id,
    target_authority.approved_use_case,target_phone_hash,target_authority.sender_key_hash,'active',
    target_provider_occurred_at,target_received_at,target_received_at
  ) on conflict(connection_id,contact_point_id,use_case) do update set
    last_message_at=greatest(coalesce(public.texting_conversations.last_message_at,excluded.last_message_at),excluded.last_message_at),
    updated_at=excluded.updated_at returning * into target_conversation;
  insert into public.texting_messages(
    workspace_id,connection_id,conversation_id,contact_id,contact_point_id,direction,
    content_payload_ref,body_hash,recipient_phone_hash,sender_key_hash,provider_message_sid_hash,
    status,status_rank,provider_status_at,terminal_at,correlation_id,created_at,updated_at
  ) values (
    target_callback.workspace_id,target_callback.connection_id,target_conversation.id,target_contact.id,
    target_point.id,'inbound',target_payload.id,target_content_body_hash,target_phone_hash,
    target_authority.sender_key_hash,sid_hash,'received',40,target_provider_occurred_at,
    target_provider_occurred_at,target_correlation_id,target_received_at,target_received_at
  ) returning * into target_message;
  insert into connector_private.twilio_message_resources(
    workspace_id,connection_id,message_id,provider_message_sid,provider_message_sid_hash,created_at
  ) values (target_callback.workspace_id,target_callback.connection_id,target_message.id,
    target_provider_message_sid,sid_hash,target_received_at) returning * into target_resource;
  update public.twilio_callback_events set state='applied',content_payload_ref=target_payload.id,
    message_id=target_message.id,processed_at=target_received_at
  where id=target_callback.id returning * into target_callback;
  update public.connector_webhook_deliveries set processed_at=target_received_at,redacted_result='inbound_applied'
    where id=target_delivery.id;
  return jsonb_build_object('accepted',true,'noOp',false,'callback',to_jsonb(target_callback),
    'message',to_jsonb(target_message),'conversation',to_jsonb(target_conversation),'canceledJobs',0);
end;
$$;

-- Bounded reconciliation for missing/ambiguous terminal callbacks ------------

create or replace function public.schedule_due_twilio_reconciliation_jobs(
  target_now timestamptz,target_minimum_age_seconds integer default 300,
  target_limit integer default 25
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; created_job public.twilio_message_reconciliation_jobs%rowtype;
 items jsonb:='[]'::jsonb;
begin
  if target_minimum_age_seconds not between 60 and 86400 or target_limit not between 1 and 100 then
    raise exception 'invalid Twilio reconciliation schedule bounds' using errcode='22023'; end if;
  for candidate in
    select message.* from public.texting_messages message
    join public.connector_connections connection on connection.id=message.connection_id
      and connection.workspace_id=message.workspace_id
    where message.direction='outbound' and message.provider_message_sid_hash is not null
      and message.terminal_at is null and message.updated_at<=target_now-make_interval(secs=>target_minimum_age_seconds)
      and connection.provider='twilio' and connection.status in ('active','degraded','reauthorization_required','revoking')
      and not exists(select 1 from public.twilio_message_reconciliation_jobs job where job.message_id=message.id)
    order by message.updated_at,message.id for update of message skip locked limit target_limit
  loop
    insert into public.twilio_message_reconciliation_jobs(
      workspace_id,connection_id,message_id,state,scheduled_at,correlation_id,created_at,updated_at
    ) values (
      candidate.workspace_id,candidate.connection_id,candidate.id,'queued',target_now,
      candidate.correlation_id,target_now,target_now
    ) returning * into created_job;
    update public.texting_messages set status='reconciliation_required',
      status_rank=greatest(status_rank,25),updated_at=target_now where id=candidate.id;
    items:=items||jsonb_build_array(to_jsonb(created_job));
  end loop;
  return jsonb_build_object('count',jsonb_array_length(items),'jobs',items);
end;
$$;

create or replace function public.claim_twilio_reconciliation_jobs(
  target_worker_id uuid,target_batch_size integer default 10,
  target_lease_seconds integer default 90,target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; claimed public.twilio_message_reconciliation_jobs%rowtype;
 items jsonb:='[]'::jsonb;
begin
  if target_worker_id is null or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid Twilio reconciliation claim' using errcode='22023'; end if;
  for candidate in
    select job.id from public.twilio_message_reconciliation_jobs job
    where ((job.state in ('queued','retry_wait') and job.scheduled_at<=target_now)
      or (job.state='leased' and job.lease_expires_at<=target_now))
      and job.attempt_count<job.max_attempts
    order by job.scheduled_at,job.created_at,job.id for update skip locked limit target_batch_size
  loop
    update public.twilio_message_reconciliation_jobs set state='leased',lease_owner=target_worker_id,
      lease_expires_at=target_now+make_interval(secs=>target_lease_seconds),fencing_token=fencing_token+1,
      updated_at=target_now where id=candidate.id returning * into claimed;
    items:=items||jsonb_build_array(to_jsonb(claimed));
  end loop;
  return jsonb_build_object('count',jsonb_array_length(items),'jobs',items);
end;
$$;

create or replace function public.start_twilio_reconciliation_attempt(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_started_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.twilio_message_reconciliation_jobs%rowtype;
begin
  select job.* into target_job from public.twilio_message_reconciliation_jobs job
  where job.id=target_job_id for update;
  if not found then raise exception 'Twilio reconciliation job not found' using errcode='P0002'; end if;
  if target_job.state<>'leased' or target_job.lease_owner<>target_worker_id
     or target_job.fencing_token<>target_fencing_token or target_job.lease_expires_at<=target_started_at then
    raise exception 'stale Twilio reconciliation lease' using errcode='40001'; end if;
  update public.twilio_message_reconciliation_jobs set state='executing',
    attempt_count=attempt_count+1,updated_at=target_started_at
  where id=target_job.id returning * into target_job;
  return jsonb_build_object('job',to_jsonb(target_job));
end;
$$;

create or replace function public.read_twilio_reconciliation_authority(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_job public.twilio_message_reconciliation_jobs%rowtype; target_message public.texting_messages%rowtype;
 target_connection public.connector_connections%rowtype; target_authority public.twilio_connection_authorities%rowtype;
 target_resource connector_private.twilio_message_resources%rowtype;
 provider_secret connector_private.connector_connection_secrets%rowtype;
 api_secret connector_private.connector_connection_secrets%rowtype;
begin
  select job.* into target_job from public.twilio_message_reconciliation_jobs job
  where job.id=target_job_id and job.state='executing' and job.lease_owner=target_worker_id
    and job.fencing_token=target_fencing_token and job.lease_expires_at>target_now;
  if not found then raise exception 'active fenced Twilio reconciliation required' using errcode='42501'; end if;
  select message.* into strict target_message from public.texting_messages message
  where message.id=target_job.message_id and message.workspace_id=target_job.workspace_id;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_job.connection_id and connection.workspace_id=target_job.workspace_id
    and connection.provider='twilio' and connection.status in ('active','degraded','reauthorization_required','revoking');
  select authority.* into strict target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection.id;
  select resource.* into strict target_resource from connector_private.twilio_message_resources resource
  where resource.message_id=target_message.id;
  select secret.* into provider_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='twilio-provider-authority'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio provider authority secret unavailable' using errcode='P0002'; end if;
  select secret.* into api_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='twilio-api-key-secret'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Twilio API credential unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('job',to_jsonb(target_job),'message',to_jsonb(target_message),
    'connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
    'providerMessageSid',target_resource.provider_message_sid,
    'providerMessageSidHash',target_resource.provider_message_sid_hash,
    'providerAuthority',connector_private.twilio_secret_json(provider_secret),
    'apiCredential',connector_private.twilio_secret_json(api_secret));
end;
$$;

create or replace function public.transition_twilio_reconciliation_job(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,
  target_outcome text,target_provider_status text,target_error_category text,
  target_next_attempt_at timestamptz,target_provider_occurred_at timestamptz,
  target_now timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.twilio_message_reconciliation_jobs%rowtype;
 status_result jsonb; next_state public.twilio_reconciliation_state; exhausted boolean;
begin
  if target_outcome not in ('resolved','retry','unknown','terminal') then
    raise exception 'invalid Twilio reconciliation outcome' using errcode='22023'; end if;
  select job.* into target_job from public.twilio_message_reconciliation_jobs job
  where job.id=target_job_id for update;
  if not found then raise exception 'Twilio reconciliation job not found' using errcode='P0002'; end if;
  if target_job.state<>'executing' or target_job.lease_owner<>target_worker_id
     or target_job.fencing_token<>target_fencing_token or target_job.lease_expires_at<=target_now then
    raise exception 'stale Twilio reconciliation lease' using errcode='40001'; end if;
  exhausted:=target_job.attempt_count>=target_job.max_attempts;
  if target_outcome='resolved' then
    if target_provider_status is null or target_provider_occurred_at is null
       or target_next_attempt_at is not null then raise exception 'resolved reconciliation evidence required' using errcode='23514'; end if;
    status_result:=connector_private.apply_twilio_message_status(target_job.message_id,
      target_provider_status,target_error_category,target_provider_occurred_at);
    if not connector_private.is_twilio_terminal_status((status_result->'message'->>'status')) then
      raise exception 'resolved reconciliation must produce terminal provider state' using errcode='23514'; end if;
    next_state:='succeeded';
  elsif target_outcome in ('retry','unknown') and not exhausted then
    if target_error_category is null or target_next_attempt_at is null or target_next_attempt_at<=target_now then
      raise exception 'retry reconciliation requires future schedule' using errcode='23514'; end if;
    next_state:='retry_wait';
  else
    if target_error_category is null then raise exception 'terminal reconciliation error required' using errcode='23514'; end if;
    next_state:='failed';
  end if;
  update public.twilio_message_reconciliation_jobs set state=next_state,
    scheduled_at=case when next_state='retry_wait' then target_next_attempt_at else scheduled_at end,
    lease_owner=null,lease_expires_at=null,last_error_category=target_error_category,
    completed_at=case when next_state in ('succeeded','failed') then target_now else null end,
    updated_at=target_now where id=target_job.id returning * into target_job;
  return jsonb_build_object('job',to_jsonb(target_job),'statusResult',status_result,
    'noOp',false);
end;
$$;

-- Disable is owner-controlled, preserves evidence and cancels only work that
-- has not crossed the side-effect boundary. Webhook verification remains so
-- STOP and late delivery evidence can still be accepted until disconnect.
create or replace function public.disable_twilio_connection(
  target_connection_id uuid,target_destroy_send_credentials boolean,
  target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
 target_authority public.twilio_connection_authorities%rowtype; canceled_job public.connector_jobs%rowtype;
 canceled_count integer:=0; destroyed_count integer:=0;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio' for update;
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_connection.workspace_id,true);
  select authority.* into target_authority from public.twilio_connection_authorities authority
  where authority.connection_id=target_connection.id for update;
  if not found then raise exception 'Twilio authority not found' using errcode='P0002'; end if;
  if not target_authority.enabled and (not target_destroy_send_credentials or not exists(
      select 1 from connector_private.connector_connection_secrets secret
      where secret.connection_id=target_connection.id
        and secret.secret_type in ('twilio-provider-authority','twilio-api-key-secret')
        and secret.destroyed_at is null)) then
    return jsonb_build_object('connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
      'canceledJobs',0,'destroyedSecrets',0,'noOp',true);
  end if;
  update public.twilio_connection_authorities set enabled=false,readiness_state='configured_disabled',
    last_readiness_at=target_occurred_at,updated_by_membership_id=actor.id,updated_at=target_occurred_at
  where id=target_authority.id returning * into target_authority;
  for canceled_job in
    select job.* from public.connector_jobs job join public.texting_messages message on message.job_id=job.id
    where job.connection_id=target_connection.id and message.side_effect_started_at is null
      and job.state in ('queued','retry_wait','leased') for update of job
  loop
    if canceled_job.state='leased' then update public.connector_jobs set state='queued',lease_owner=null,
      lease_expires_at=null where id=canceled_job.id; end if;
    update public.connector_jobs set state='cancelled',cancelled_at=target_occurred_at,
      last_error_category='connection_disabled',lease_owner=null,lease_expires_at=null where id=canceled_job.id;
    update public.connector_action_intents set state='cancelled' where id=canceled_job.intent_id and state='queued';
    update public.texting_messages set status='canceled',status_rank=90,terminal_at=target_occurred_at,
      last_error_category='connection_disabled',updated_at=target_occurred_at where job_id=canceled_job.id;
    canceled_count:=canceled_count+1;
  end loop;
  if target_destroy_send_credentials then
    update connector_private.connector_connection_secrets set ciphertext=null,nonce=null,auth_tag=null,
      wrapped_dek=null,wrap_nonce=null,wrap_auth_tag=null,destroyed_at=target_occurred_at,updated_at=target_occurred_at
    where connection_id=target_connection.id and secret_type in ('twilio-provider-authority','twilio-api-key-secret')
      and destroyed_at is null;
    get diagnostics destroyed_count=row_count;
  end if;
  if target_connection.status='active' then
    update public.connector_connections set status='degraded',last_error_category='connection_disabled'
    where id=target_connection.id returning * into target_connection;
  end if;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,error_category,
    redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'twilio','connection.tested',
    'twilio.disabled:'||target_correlation_id::text,target_correlation_id,'connection_disabled',
    jsonb_build_object('canceledJobs',canceled_count,'destroyedSendSecrets',destroyed_count),target_occurred_at
  ) on conflict(workspace_id,event_key) do nothing;
  return jsonb_build_object('connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
    'canceledJobs',canceled_count,'destroyedSecrets',destroyed_count,'noOp',false);
end;
$$;

create or replace function public.sync_twilio_authority_on_connection_state()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='twilio' and new.status in ('revoking','disconnected','disconnected_unconfirmed')
     and new.status is distinct from old.status then
    update public.twilio_connection_authorities set enabled=false,readiness_state='disconnected',
      last_readiness_at=clock_timestamp(),updated_at=clock_timestamp()
    where connection_id=new.id;
    if new.status in ('disconnected','disconnected_unconfirmed') then
      update connector_private.twilio_callback_authorities set revoked_at=coalesce(revoked_at,clock_timestamp())
      where connection_id=new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger connector_connections_sync_twilio_authority
  after update of status on public.connector_connections
  for each row execute function public.sync_twilio_authority_on_connection_state();

-- The generic Story 3.5 worker remains the canonical starter. This trigger
-- closes the STOP race for every caller (including the generic repository):
-- leased -> executing establishes the local side-effect boundary in the same
-- transaction, before the worker can invoke Twilio.
create or replace function public.mark_twilio_side_effect_boundary_on_job_start()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='twilio' and new.action_type='message.send'
     and old.state='leased' and new.state='executing' then
    update public.texting_messages set side_effect_started_at=coalesce(side_effect_started_at,clock_timestamp()),
      updated_at=greatest(updated_at,clock_timestamp()) where job_id=new.id;
    if not found then
      raise exception 'Twilio message authorization missing at side-effect boundary' using errcode='23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger connector_jobs_mark_twilio_side_effect_boundary
  after update of state on public.connector_jobs
  for each row execute function public.mark_twilio_side_effect_boundary_on_job_start();

create or replace function connector_private.cancel_twilio_pre_side_effect_jobs(
  target_connection_id uuid,target_phone_hash text,target_use_case text,
  target_correlation_id uuid,target_occurred_at timestamptz,target_reason text
)
returns integer language plpgsql security definer set search_path='' as $$
declare target_job public.connector_jobs%rowtype; canceled_count integer:=0;
begin
  for target_job in
    select job.* from public.connector_jobs job
    join public.texting_messages message on message.job_id=job.id
    join public.texting_message_drafts draft on draft.id=(
      select version_row.draft_id from public.texting_message_draft_versions version_row
      where version_row.id=message.draft_version_id)
    where job.connection_id=target_connection_id and job.action_type='message.send'
      and message.recipient_phone_hash=target_phone_hash and draft.use_case=target_use_case
      and message.side_effect_started_at is null and job.state in ('queued','retry_wait','leased')
    for update of job
  loop
    if target_job.state='leased' then
      update public.connector_jobs set state='queued',lease_owner=null,lease_expires_at=null
      where id=target_job.id;
    end if;
    update public.connector_jobs set state='cancelled',cancelled_at=target_occurred_at,
      last_error_category=target_reason,lease_owner=null,lease_expires_at=null where id=target_job.id;
    update public.connector_action_intents set state='cancelled' where id=target_job.intent_id and state='queued';
    update public.texting_messages set status='canceled',status_rank=90,terminal_at=target_occurred_at,
      last_error_category=target_reason,updated_at=target_occurred_at where job_id=target_job.id;
    insert into public.connector_receipt_events(
      workspace_id,connection_id,provider,job_id,intent_id,intent_version_id,event_type,event_key,
      correlation_id,error_category,redacted_metadata,occurred_at
    ) values (
      target_job.workspace_id,target_job.connection_id,'twilio',target_job.id,target_job.intent_id,
      target_job.intent_version_id,'job.cancelled','twilio.consent.cancelled:'||target_job.id::text,
      target_correlation_id,target_reason,jsonb_build_object('reason',target_reason),target_occurred_at
    ) on conflict(workspace_id,event_key) do nothing;
    canceled_count:=canceled_count+1;
  end loop;
  return canceled_count;
end;
$$;

create or replace function public.record_texting_consent(
  target_connection_id uuid,target_contact_id uuid,target_contact_point_id uuid,
  target_use_case text,target_status public.texting_consent_status,
  target_collection_method text,target_disclosure_version text,target_evidence_ref_hash text,
  target_recipient_timezone text,target_timezone_source text,target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; actor public.workspace_members%rowtype;
 result jsonb; target_event public.texting_consent_events%rowtype; canceled_count integer:=0;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='twilio';
  if not found then raise exception 'Twilio connection not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_connection.workspace_id,false);
  result:=connector_private.apply_twilio_consent_event(target_connection.id,target_contact_id,
    target_contact_point_id,target_use_case,target_status,
    case when actor.role='owner' then 'owner-recorded' else 'assistant-recorded' end,
    target_collection_method,target_disclosure_version,target_evidence_ref_hash,
    target_recipient_timezone,target_timezone_source,actor.id,null,target_correlation_id,target_occurred_at);
  target_event:=jsonb_populate_record(null::public.texting_consent_events,result->'event');
  if target_status='opted_out' then
    canceled_count:=connector_private.cancel_twilio_pre_side_effect_jobs(target_connection.id,
      target_event.phone_hash,target_use_case,target_correlation_id,target_occurred_at,'recipient_opted_out');
  end if;
  return result||jsonb_build_object('canceledJobs',canceled_count);
end;
$$;

-- Least-privilege RPC grants -------------------------------------------------

revoke all on function public.bind_twilio_connection_authority(uuid,uuid,uuid,text,text,text,text,text,public.twilio_registration_state,text,text,text,timestamptz,text,timestamptz,boolean,timestamptz,boolean,text,integer,jsonb,integer,jsonb,integer,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.configure_twilio_compliance_policy(uuid,text,text,text,integer,time,time,text,integer,boolean,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.ensure_twilio_message_send_policy(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_twilio_connection_readiness(uuid) from public,anon,authenticated,service_role;
revoke all on function public.record_texting_consent(uuid,uuid,uuid,text,public.texting_consent_status,text,text,text,text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.create_twilio_message_draft(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.revise_twilio_message_draft(uuid,integer,text,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.approve_and_enqueue_twilio_message_send(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.archive_twilio_message_draft(uuid,integer,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.disable_twilio_connection(uuid,boolean,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.start_twilio_message_send_attempt(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.bind_twilio_provider_message(uuid,uuid,bigint,text,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_twilio_callback_verification_authority(text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.schedule_due_twilio_reconciliation_jobs(timestamptz,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_twilio_reconciliation_jobs(uuid,integer,integer,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.start_twilio_reconciliation_attempt(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_twilio_reconciliation_authority(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.transition_twilio_reconciliation_job(uuid,uuid,bigint,text,text,text,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

grant execute on function public.configure_twilio_compliance_policy(uuid,text,text,text,integer,time,time,text,integer,boolean,text,uuid,timestamptz) to authenticated;
grant execute on function public.ensure_twilio_message_send_policy(uuid,uuid,uuid,timestamptz) to authenticated;
grant execute on function public.read_twilio_connection_readiness(uuid) to authenticated;
grant execute on function public.record_texting_consent(uuid,uuid,uuid,text,public.texting_consent_status,text,text,text,text,text,uuid,timestamptz) to authenticated;
grant execute on function public.create_twilio_message_draft(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,timestamptz) to authenticated;
grant execute on function public.revise_twilio_message_draft(uuid,integer,text,jsonb,uuid,timestamptz) to authenticated;
grant execute on function public.prepare_twilio_message_send_intent(uuid,integer,uuid,integer,text,uuid) to authenticated;
grant execute on function public.approve_and_enqueue_twilio_message_send(uuid,integer,text,text,text,text,text,timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.archive_twilio_message_draft(uuid,integer,uuid,timestamptz) to authenticated;
grant execute on function public.disable_twilio_connection(uuid,boolean,uuid,timestamptz) to authenticated;

grant execute on function public.bind_twilio_connection_authority(uuid,uuid,uuid,text,text,text,text,text,public.twilio_registration_state,text,text,text,timestamptz,text,timestamptz,boolean,timestamptz,boolean,text,integer,jsonb,integer,jsonb,integer,jsonb,uuid,timestamptz) to service_role;
grant execute on function public.start_twilio_message_send_attempt(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.read_twilio_job_authority(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.bind_twilio_provider_message(uuid,uuid,bigint,text,text,text,timestamptz) to service_role;
grant execute on function public.read_twilio_callback_verification_authority(text,timestamptz) to service_role;
grant execute on function public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.schedule_due_twilio_reconciliation_jobs(timestamptz,integer,integer) to service_role;
grant execute on function public.claim_twilio_reconciliation_jobs(uuid,integer,integer,timestamptz) to service_role;
grant execute on function public.start_twilio_reconciliation_attempt(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.read_twilio_reconciliation_authority(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.transition_twilio_reconciliation_job(uuid,uuid,bigint,text,text,text,timestamptz,timestamptz,timestamptz) to service_role;

revoke all on function public.prepare_twilio_authority_update() from public;
revoke all on function public.prepare_twilio_compliance_policy_update() from public;
revoke all on function public.prepare_texting_consent_state_update() from public;
revoke all on function public.prepare_texting_draft_update() from public;
revoke all on function public.prepare_texting_draft_version_update() from public;
revoke all on function public.prepare_texting_message_update() from public;
revoke all on function public.prepare_twilio_callback_update() from public;
revoke all on function public.prepare_twilio_reconciliation_job_update() from public;
revoke all on function public.sync_twilio_authority_on_connection_state() from public;
revoke all on function public.mark_twilio_side_effect_boundary_on_job_start() from public;
revoke all on function connector_private.twilio_secret_json(connector_private.connector_connection_secrets) from public,anon,authenticated;
revoke all on function connector_private.twilio_payload_json(connector_private.connector_payload_envelopes) from public,anon,authenticated;
revoke all on function connector_private.apply_twilio_consent_event(uuid,uuid,uuid,text,public.texting_consent_status,text,text,text,text,text,text,uuid,text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function connector_private.apply_twilio_message_status(uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function connector_private.cancel_twilio_pre_side_effect_jobs(uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated;

comment on table public.twilio_connection_authorities is
  'Workspace-visible redacted Twilio sender, registration and activation authority. No SID, phone or token plaintext.';
comment on table public.texting_consent_events is
  'Append-only channel/use-case consent evidence for an exact canonical active phone point.';
comment on table public.texting_consent_states is
  'Current deterministic texting consent projection; history remains in texting_consent_events.';
comment on table public.texting_send_approval_snapshots is
  'Immutable owner approval binding recipient/sender/body hashes, exact consent, policies, timezone and quiet-hours decision.';
comment on table public.texting_messages is
  'Redacted message/conversation state. Content references encrypted connector_private payload envelopes.';
comment on table public.twilio_callback_events is
  'Verified callback replay metadata only. Signature is checked by official SDK over exact URL and raw evolving parameters before this RPC.';
comment on function public.read_twilio_callback_verification_authority(text,timestamptz) is
  'Service-only lookup of endpoint-bound encrypted Twilio Auth Token and exact external URL hash for official SDK signature validation.';
comment on function public.register_and_apply_twilio_callback(text,text,text,text,text,text,text,text,public.twilio_callback_kind,text,public.texting_keyword_class,text,text,text,jsonb,timestamptz,timestamptz,uuid) is
  'Service-only atomic verified callback ingress. Replays dedupe; STOP suppresses/cancels pre-side-effect work before other processing.';

commit;
