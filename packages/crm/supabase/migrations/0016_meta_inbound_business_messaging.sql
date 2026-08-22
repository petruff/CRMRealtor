-- Story 4.4: Meta Business inbound-message authority, first slice only.
--
-- Forward-only. Graph API version is never defaulted: an owner must supply and
-- approve a numeric pinned version together with reviewed source URL/time/hash.
-- Only Facebook Page Messaging and Instagram Login inbound business messages
-- are modeled. Lead Ads, outbound/reply and Instagram-via-Facebook are absent.
--
-- Rollback: ../rollbacks/0016_meta_inbound_business_messaging.rollback.sql is
-- pre-write only. After any provider/contact evidence, preserve it and use PITR
-- or a reviewed forward correction.

begin;

create type public.meta_login_mode as enum ('facebook-page','instagram-login');
create type public.meta_channel as enum ('facebook','instagram');
create type public.meta_readiness_state as enum (
  'version_review_required','business_verification_required','app_review_blocked',
  'asset_selection_required','webhook_setup_required','webhook_challenge_required',
  'active','degraded','reauthorization_required','disconnected'
);
create type public.meta_asset_state as enum ('eligible','selected','removed');
create type public.meta_inbound_event_state as enum (
  'accepted','ignored_stale','normalizing','linked','review','content_purged'
);
create type public.meta_normalization_job_state as enum (
  'queued','leased','executing','retry_wait','succeeded','failed','cancelled'
);

create table public.meta_connection_authorities (
  connection_id                    uuid primary key,
  workspace_id                     uuid not null references public.workspaces(id) on delete restrict,
  login_mode                       public.meta_login_mode not null,
  graph_version                    text not null,
  version_source_url               text not null,
  version_source_hash              text not null,
  version_reviewed_at              timestamptz not null,
  version_approved_by_membership_id uuid not null,
  requested_scopes                 text[] not null,
  granted_scopes                   text[] not null default '{}',
  account_key_hash                 text,
  business_verified                boolean not null default false,
  business_verification_hash       text,
  app_review_approved              boolean not null default false,
  app_review_evidence_hash         text,
  eligibility_snapshot_hash        text,
  selected_asset_snapshot_hash     text,
  retention_days                   integer,
  retention_policy_hash            text,
  readiness_state                  public.meta_readiness_state not null default 'version_review_required',
  enabled                          boolean not null default false,
  webhook_challenge_confirmed      boolean not null default false,
  last_accepted_event_at           timestamptz,
  last_webhook_at                  timestamptz,
  last_error_category              text,
  created_by_membership_id         uuid not null,
  selected_by_membership_id        uuid,
  selected_at                      timestamptz,
  created_at                       timestamptz not null,
  updated_at                       timestamptz not null,
  constraint meta_authorities_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_authorities_version_approver_fk
    foreign key(version_approved_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint meta_authorities_creator_fk
    foreign key(created_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint meta_authorities_selector_fk
    foreign key(selected_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint meta_authorities_version check (
    graph_version ~ '^v[1-9][0-9]{0,2}\.[0-9]{1,2}$'
    and length(version_source_url) between 12 and 2048
    and version_source_url ~ '^https://'
    and version_source_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint meta_authorities_hashes check (
    (account_key_hash is null or account_key_hash ~ '^[0-9a-f]{64}$')
    and (business_verification_hash is null or business_verification_hash ~ '^[0-9a-f]{64}$')
    and (app_review_evidence_hash is null or app_review_evidence_hash ~ '^[0-9a-f]{64}$')
    and (eligibility_snapshot_hash is null or eligibility_snapshot_hash ~ '^[0-9a-f]{64}$')
    and (selected_asset_snapshot_hash is null or selected_asset_snapshot_hash ~ '^[0-9a-f]{64}$')
    and (retention_policy_hash is null or retention_policy_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint meta_authorities_review_evidence check (
    (business_verified and business_verification_hash is not null)
      or (not business_verified and business_verification_hash is null)
  ),
  constraint meta_authorities_app_review_evidence check (
    (app_review_approved and app_review_evidence_hash is not null)
      or (not app_review_approved and app_review_evidence_hash is null)
  ),
  constraint meta_authorities_selection check (
    (selected_at is null and selected_by_membership_id is null
      and selected_asset_snapshot_hash is null and retention_days is null
      and retention_policy_hash is null)
    or (selected_at is not null and selected_by_membership_id is not null
      and selected_asset_snapshot_hash is not null and retention_days between 1 and 3650
      and retention_policy_hash is not null)
  ),
  constraint meta_authorities_error check (
    last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create table public.meta_asset_bindings (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  channel                    public.meta_channel not null,
  asset_id_hash              text not null,
  display_label              text not null,
  eligibility_snapshot_hash  text not null,
  state                      public.meta_asset_state not null default 'eligible',
  selected_at                timestamptz,
  removed_at                 timestamptz,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,
  constraint meta_asset_bindings_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_asset_bindings_id_workspace_unique unique(id,workspace_id),
  constraint meta_asset_bindings_identity_unique unique(connection_id,channel,asset_id_hash),
  constraint meta_asset_bindings_hashes check (
    asset_id_hash ~ '^[0-9a-f]{64}$' and eligibility_snapshot_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint meta_asset_bindings_label check (length(btrim(display_label)) between 1 and 120),
  constraint meta_asset_bindings_state check (
    (state='eligible' and selected_at is null and removed_at is null)
    or (state='selected' and selected_at is not null and removed_at is null)
    or (state='removed' and removed_at is not null)
  )
);

create table connector_private.meta_asset_identities (
  asset_binding_id uuid primary key references public.meta_asset_bindings(id) on delete restrict,
  workspace_id     uuid not null references public.workspaces(id) on delete restrict,
  connection_id    uuid not null,
  asset_id         text not null,
  created_at       timestamptz not null,
  updated_at       timestamptz not null,
  constraint meta_asset_identities_binding_workspace_fk
    foreign key(asset_binding_id,workspace_id) references public.meta_asset_bindings(id,workspace_id) on delete restrict,
  constraint meta_asset_identities_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_asset_identities_token check (
    length(asset_id) between 1 and 512 and asset_id ~ '^[A-Za-z0-9._:-]+$'
  )
);

create table connector_private.meta_webhook_authorities (
  connection_id             uuid primary key,
  workspace_id              uuid not null references public.workspaces(id) on delete restrict,
  endpoint_key_hash         text not null unique,
  app_secret_type           text not null default 'meta-app-secret',
  verify_token_secret_type  text not null default 'meta-webhook-verify-token',
  subscription_evidence_hash text not null,
  challenge_evidence_hash   text,
  bound_at                  timestamptz not null,
  challenge_confirmed_at    timestamptz,
  revoked_at                timestamptz,
  updated_at                timestamptz not null,
  constraint meta_webhook_authorities_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_webhook_authorities_hashes check (
    endpoint_key_hash ~ '^[0-9a-f]{64}$'
    and subscription_evidence_hash ~ '^[0-9a-f]{64}$'
    and (challenge_evidence_hash is null or challenge_evidence_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint meta_webhook_authorities_types check (
    app_secret_type='meta-app-secret' and verify_token_secret_type='meta-webhook-verify-token'
  ),
  constraint meta_webhook_authorities_challenge check (
    (challenge_confirmed_at is null and challenge_evidence_hash is null)
    or (challenge_confirmed_at is not null and challenge_evidence_hash is not null)
  )
);

create table public.meta_external_identities (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  asset_binding_id           uuid not null,
  channel                    public.meta_channel not null,
  sender_key_hash            text not null,
  contact_id                 uuid,
  linked_by_membership_id    uuid,
  linked_at                  timestamptz,
  first_event_at             timestamptz not null,
  last_event_at              timestamptz not null,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,
  constraint meta_external_identities_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_external_identities_asset_workspace_fk
    foreign key(asset_binding_id,workspace_id) references public.meta_asset_bindings(id,workspace_id) on delete restrict,
  constraint meta_external_identities_contact_workspace_fk
    foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint meta_external_identities_linker_workspace_fk
    foreign key(linked_by_membership_id,workspace_id) references public.workspace_members(id,workspace_id) on delete restrict,
  constraint meta_external_identities_id_workspace_unique unique(id,workspace_id),
  constraint meta_external_identities_sender_unique unique(connection_id,asset_binding_id,sender_key_hash),
  constraint meta_external_identities_hash check (sender_key_hash ~ '^[0-9a-f]{64}$'),
  constraint meta_external_identities_link check (
    (contact_id is null and linked_by_membership_id is null and linked_at is null)
    or (contact_id is not null and linked_at is not null)
  )
);

create table public.meta_conversations (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  asset_binding_id           uuid not null,
  external_identity_id       uuid not null,
  channel                    public.meta_channel not null,
  conversation_key_hash      text not null,
  contact_id                 uuid,
  last_message_key_hash      text,
  last_provider_at           timestamptz,
  last_event_at              timestamptz,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,
  constraint meta_conversations_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_conversations_asset_workspace_fk
    foreign key(asset_binding_id,workspace_id) references public.meta_asset_bindings(id,workspace_id) on delete restrict,
  constraint meta_conversations_identity_workspace_fk
    foreign key(external_identity_id,workspace_id) references public.meta_external_identities(id,workspace_id) on delete restrict,
  constraint meta_conversations_contact_workspace_fk
    foreign key(contact_id,workspace_id) references public.contacts(id,workspace_id) on delete restrict,
  constraint meta_conversations_id_workspace_unique unique(id,workspace_id),
  constraint meta_conversations_key_unique unique(connection_id,conversation_key_hash),
  constraint meta_conversations_hashes check (
    conversation_key_hash ~ '^[0-9a-f]{64}$'
    and (last_message_key_hash is null or last_message_key_hash ~ '^[0-9a-f]{64}$')
  )
);

create table public.meta_inbound_events (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces(id) on delete restrict,
  connection_id              uuid not null,
  webhook_delivery_id        uuid not null,
  asset_binding_id           uuid not null,
  external_identity_id       uuid not null,
  conversation_id            uuid not null,
  channel                    public.meta_channel not null,
  event_key_hash             text not null,
  message_key_hash           text not null,
  content_hash               text not null,
  content_payload_ref        uuid,
  attachment_types           text[] not null default '{}',
  provider_occurred_at       timestamptz not null,
  received_at                timestamptz not null,
  state                      public.meta_inbound_event_state not null,
  review_reason              text,
  incomplete_record_id       uuid,
  activity_event_id          uuid,
  normalized_at              timestamptz,
  correlation_id             uuid not null,
  created_at                 timestamptz not null,
  updated_at                 timestamptz not null,
  constraint meta_inbound_events_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_inbound_events_delivery_workspace_fk
    foreign key(webhook_delivery_id,workspace_id) references public.connector_webhook_deliveries(id,workspace_id) on delete restrict,
  constraint meta_inbound_events_asset_workspace_fk
    foreign key(asset_binding_id,workspace_id) references public.meta_asset_bindings(id,workspace_id) on delete restrict,
  constraint meta_inbound_events_identity_workspace_fk
    foreign key(external_identity_id,workspace_id) references public.meta_external_identities(id,workspace_id) on delete restrict,
  constraint meta_inbound_events_conversation_workspace_fk
    foreign key(conversation_id,workspace_id) references public.meta_conversations(id,workspace_id) on delete restrict,
  constraint meta_inbound_events_payload_fk
    foreign key(content_payload_ref) references connector_private.connector_payload_envelopes(id) on delete restrict,
  constraint meta_inbound_events_incomplete_workspace_fk
    foreign key(incomplete_record_id,workspace_id) references public.incomplete_records(id,workspace_id) on delete restrict,
  constraint meta_inbound_events_activity_workspace_fk
    foreign key(activity_event_id,workspace_id) references public.activity_events(id,workspace_id) on delete restrict,
  constraint meta_inbound_events_id_workspace_unique unique(id,workspace_id),
  constraint meta_inbound_events_event_unique unique(connection_id,event_key_hash),
  constraint meta_inbound_events_message_unique unique(connection_id,message_key_hash),
  constraint meta_inbound_events_hashes check (
    event_key_hash ~ '^[0-9a-f]{64}$' and message_key_hash ~ '^[0-9a-f]{64}$'
    and content_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint meta_inbound_events_attachments check (
    cardinality(attachment_types)<=20
    and array_to_string(attachment_types,'|') !~ '[^A-Za-z0-9._:|~-]'
  ),
  constraint meta_inbound_events_review check (
    (state='review' and review_reason is not null and incomplete_record_id is not null)
    or (state<>'review' and review_reason is null)
  )
);

create table connector_private.meta_event_identities (
  event_id       uuid primary key references public.meta_inbound_events(id) on delete restrict,
  workspace_id   uuid not null references public.workspaces(id) on delete restrict,
  connection_id  uuid not null,
  asset_id       text not null,
  sender_id      text not null,
  recipient_id   text not null,
  message_id     text not null,
  created_at     timestamptz not null,
  constraint meta_event_identities_event_workspace_fk
    foreign key(event_id,workspace_id) references public.meta_inbound_events(id,workspace_id) on delete restrict,
  constraint meta_event_identities_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_event_identities_tokens check (
    length(asset_id) between 1 and 512 and asset_id ~ '^[A-Za-z0-9._:-]+$'
    and length(sender_id) between 1 and 512 and sender_id ~ '^[A-Za-z0-9._:-]+$'
    and length(recipient_id) between 1 and 512 and recipient_id ~ '^[A-Za-z0-9._:-]+$'
    and length(message_id) between 1 and 512 and message_id ~ '^[A-Za-z0-9._:-]+$'
  )
);

create table public.meta_normalization_jobs (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete restrict,
  connection_id       uuid not null,
  event_id             uuid not null,
  state                public.meta_normalization_job_state not null default 'queued',
  scheduled_at         timestamptz not null,
  attempt_count        integer not null default 0,
  max_attempts         integer not null default 5,
  lease_owner          uuid,
  lease_expires_at     timestamptz,
  fencing_token        bigint not null default 0,
  last_error_category  text,
  completed_at         timestamptz,
  correlation_id       uuid not null,
  created_at           timestamptz not null,
  updated_at           timestamptz not null,
  constraint meta_normalization_jobs_connection_workspace_fk
    foreign key(connection_id,workspace_id) references public.connector_connections(id,workspace_id) on delete restrict,
  constraint meta_normalization_jobs_event_workspace_fk
    foreign key(event_id,workspace_id) references public.meta_inbound_events(id,workspace_id) on delete restrict,
  constraint meta_normalization_jobs_event_unique unique(event_id),
  constraint meta_normalization_jobs_id_workspace_unique unique(id,workspace_id),
  constraint meta_normalization_jobs_attempt check (
    attempt_count between 0 and max_attempts and max_attempts between 1 and 10 and fencing_token>=0
  ),
  constraint meta_normalization_jobs_lease check (
    (state in ('leased','executing') and lease_owner is not null and lease_expires_at is not null)
    or (state not in ('leased','executing') and lease_owner is null and lease_expires_at is null)
  ),
  constraint meta_normalization_jobs_complete check (
    (state in ('succeeded','failed','cancelled') and completed_at is not null)
    or (state not in ('succeeded','failed','cancelled') and completed_at is null)
  ),
  constraint meta_normalization_jobs_error check (
    last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  )
);

create index meta_assets_connection_state_idx on public.meta_asset_bindings(connection_id,state,channel,id);
create index meta_external_identities_contact_idx on public.meta_external_identities(workspace_id,contact_id) where contact_id is not null;
create index meta_conversations_workspace_recent_idx on public.meta_conversations(workspace_id,last_event_at desc,id);
create index meta_events_workspace_received_idx on public.meta_inbound_events(workspace_id,received_at desc,id);
create index meta_events_review_idx on public.meta_inbound_events(workspace_id,received_at,id) where state='review';
create index meta_normalization_due_idx on public.meta_normalization_jobs(state,scheduled_at,id)
  where state in ('queued','retry_wait','leased');

-- RLS and grants ------------------------------------------------------------

alter table public.meta_connection_authorities enable row level security;
alter table public.meta_connection_authorities force row level security;
alter table public.meta_asset_bindings enable row level security;
alter table public.meta_asset_bindings force row level security;
alter table public.meta_external_identities enable row level security;
alter table public.meta_external_identities force row level security;
alter table public.meta_conversations enable row level security;
alter table public.meta_conversations force row level security;
alter table public.meta_inbound_events enable row level security;
alter table public.meta_inbound_events force row level security;
alter table public.meta_normalization_jobs enable row level security;
alter table public.meta_normalization_jobs force row level security;
alter table connector_private.meta_asset_identities enable row level security;
alter table connector_private.meta_asset_identities force row level security;
alter table connector_private.meta_webhook_authorities enable row level security;
alter table connector_private.meta_webhook_authorities force row level security;
alter table connector_private.meta_event_identities enable row level security;
alter table connector_private.meta_event_identities force row level security;

create policy meta_authorities_member_select on public.meta_connection_authorities
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy meta_assets_member_select on public.meta_asset_bindings
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy meta_external_identities_member_select on public.meta_external_identities
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy meta_conversations_member_select on public.meta_conversations
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy meta_events_member_select on public.meta_inbound_events
  for select to authenticated using(public.has_workspace_access(workspace_id));
create policy meta_jobs_member_select on public.meta_normalization_jobs
  for select to authenticated using(public.has_workspace_access(workspace_id));

revoke all on table public.meta_connection_authorities from public,anon,authenticated,service_role;
revoke all on table public.meta_asset_bindings from public,anon,authenticated,service_role;
revoke all on table public.meta_external_identities from public,anon,authenticated,service_role;
revoke all on table public.meta_conversations from public,anon,authenticated,service_role;
revoke all on table public.meta_inbound_events from public,anon,authenticated,service_role;
revoke all on table public.meta_normalization_jobs from public,anon,authenticated,service_role;
grant select on table public.meta_connection_authorities to authenticated;
grant select on table public.meta_asset_bindings to authenticated;
grant select on table public.meta_external_identities to authenticated;
grant select on table public.meta_conversations to authenticated;
grant select on table public.meta_inbound_events to authenticated;
grant select on table public.meta_normalization_jobs to authenticated;
revoke all on table connector_private.meta_asset_identities from public,anon,authenticated,service_role;
revoke all on table connector_private.meta_webhook_authorities from public,anon,authenticated,service_role;
revoke all on table connector_private.meta_event_identities from public,anon,authenticated,service_role;
grant usage on type public.meta_login_mode,public.meta_channel,public.meta_readiness_state,
  public.meta_asset_state,public.meta_inbound_event_state,public.meta_normalization_job_state
  to authenticated,service_role;

-- Private helpers -----------------------------------------------------------

create or replace function connector_private.meta_expected_scopes(target_mode public.meta_login_mode)
returns text[] language sql immutable set search_path='' as $$
  select case target_mode
    when 'facebook-page' then array['pages_manage_metadata','pages_messaging','pages_show_list']::text[]
    when 'instagram-login' then array['instagram_business_basic','instagram_business_manage_messages']::text[]
  end
$$;

create or replace function connector_private.meta_expected_channel(target_mode public.meta_login_mode)
returns public.meta_channel language sql immutable set search_path='' as $$
  select case target_mode when 'facebook-page' then 'facebook'::public.meta_channel
    when 'instagram-login' then 'instagram'::public.meta_channel end
$$;

create or replace function connector_private.meta_envelope_is_valid(target_envelope jsonb,target_require_expiry boolean default false)
returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(target_envelope)='object'
    and target_envelope ?& array['ciphertext','nonce','authTag','wrappedDek','wrapNonce','wrapAuthTag','kekVersion','aadHash','expiresAt']
    and decode(target_envelope->>'ciphertext','base64') is not null
    and octet_length(decode(target_envelope->>'ciphertext','base64'))>0
    and octet_length(decode(target_envelope->>'nonce','base64'))=12
    and octet_length(decode(target_envelope->>'authTag','base64'))=16
    and octet_length(decode(target_envelope->>'wrappedDek','base64'))>0
    and octet_length(decode(target_envelope->>'wrapNonce','base64'))=12
    and octet_length(decode(target_envelope->>'wrapAuthTag','base64'))=16
    and target_envelope->>'kekVersion' ~ '^[A-Za-z0-9_.-]{1,64}$'
    and target_envelope->>'aadHash' ~ '^[0-9a-f]{64}$'
    and (not target_require_expiry or (target_envelope->>'expiresAt') is not null)
$$;

create or replace function connector_private.upsert_meta_secret(
  target_connection_id uuid,target_secret_type text,target_expected_version integer,
  target_envelope jsonb,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_secret connector_private.connector_connection_secrets%rowtype;
 target_expiry timestamptz;
begin
  if target_secret_type not in ('meta-access-token','meta-app-secret','meta-webhook-verify-token')
     or not connector_private.meta_envelope_is_valid(target_envelope,target_secret_type='meta-access-token') then
    raise exception 'invalid Meta encrypted secret' using errcode='22023'; end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta' for update;
  if not found then raise exception 'Meta connection not found' using errcode='P0002'; end if;
  if target_envelope->>'expiresAt' is not null then target_expiry:=(target_envelope->>'expiresAt')::timestamptz; end if;
  if target_secret_type='meta-access-token' and (target_expiry is null or target_expiry<=target_occurred_at) then
    raise exception 'Meta access token expiry required' using errcode='22023'; end if;
  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection_id and secret.secret_type=target_secret_type for update;
  if found then
    if target_expected_version is null or target_expected_version<>target_secret.secret_version then
      raise exception 'Meta secret version conflict' using errcode='40001'; end if;
    update connector_private.connector_connection_secrets set
      secret_version=secret_version+1,ciphertext=decode(target_envelope->>'ciphertext','base64'),
      nonce=decode(target_envelope->>'nonce','base64'),auth_tag=decode(target_envelope->>'authTag','base64'),
      wrapped_dek=decode(target_envelope->>'wrappedDek','base64'),wrap_nonce=decode(target_envelope->>'wrapNonce','base64'),
      wrap_auth_tag=decode(target_envelope->>'wrapAuthTag','base64'),kek_version=target_envelope->>'kekVersion',
      aad_hash=target_envelope->>'aadHash',expires_at=target_expiry,refreshed_at=target_occurred_at,
      destroyed_at=null,updated_at=target_occurred_at
    where id=target_secret.id returning * into target_secret;
  else
    if target_expected_version is not null then raise exception 'Meta secret does not exist' using errcode='40001'; end if;
    insert into connector_private.connector_connection_secrets(
      workspace_id,connection_id,secret_type,ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,
      wrap_auth_tag,kek_version,aad_hash,expires_at,refreshed_at,created_at,updated_at
    ) values (
      target_connection.workspace_id,target_connection.id,target_secret_type,
      decode(target_envelope->>'ciphertext','base64'),decode(target_envelope->>'nonce','base64'),
      decode(target_envelope->>'authTag','base64'),decode(target_envelope->>'wrappedDek','base64'),
      decode(target_envelope->>'wrapNonce','base64'),decode(target_envelope->>'wrapAuthTag','base64'),
      target_envelope->>'kekVersion',target_envelope->>'aadHash',target_expiry,target_occurred_at,
      target_occurred_at,target_occurred_at
    ) returning * into target_secret;
  end if;
  return jsonb_build_object('secretId',target_secret.id,'secretType',target_secret.secret_type,
    'secretVersion',target_secret.secret_version,'expiresAt',target_secret.expires_at,
    'kekVersion',target_secret.kek_version);
end;
$$;

create or replace function connector_private.meta_secret_json(target_secret connector_private.connector_connection_secrets)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('secretId',target_secret.id,'secretType',target_secret.secret_type,
  'secretVersion',target_secret.secret_version,'ciphertext',encode(target_secret.ciphertext,'base64'),
  'nonce',encode(target_secret.nonce,'base64'),'authTag',encode(target_secret.auth_tag,'base64'),
  'wrappedDek',encode(target_secret.wrapped_dek,'base64'),'wrapNonce',encode(target_secret.wrap_nonce,'base64'),
  'wrapAuthTag',encode(target_secret.wrap_auth_tag,'base64'),'kekVersion',target_secret.kek_version,
  'aadHash',target_secret.aad_hash,'expiresAt',target_secret.expires_at)
$$;

create or replace function connector_private.meta_payload_json(target_payload connector_private.connector_payload_envelopes)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('payloadRef',target_payload.id,'payloadKind',target_payload.payload_kind,
  'schemaVersion',target_payload.schema_version,'canonicalHash',target_payload.canonical_hash,
  'ciphertext',encode(target_payload.ciphertext,'base64'),'nonce',encode(target_payload.nonce,'base64'),
  'authTag',encode(target_payload.auth_tag,'base64'),'wrappedDek',encode(target_payload.wrapped_dek,'base64'),
  'wrapNonce',encode(target_payload.wrap_nonce,'base64'),'wrapAuthTag',encode(target_payload.wrap_auth_tag,'base64'),
  'kekVersion',target_payload.kek_version,'aadHash',target_payload.aad_hash,
  'envelopeVersion',target_payload.envelope_version)
$$;

create or replace function connector_private.store_meta_payload(
  target_connection_id uuid,target_hash text,target_envelope jsonb,
  target_expires_at timestamptz,target_occurred_at timestamptz
)
returns connector_private.connector_payload_envelopes
language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype;
 target_payload connector_private.connector_payload_envelopes%rowtype;
begin
  if target_hash !~ '^[0-9a-f]{64}$' or target_expires_at<=target_occurred_at
     or not connector_private.meta_envelope_is_valid(target_envelope,false) then
    raise exception 'invalid encrypted Meta content' using errcode='22023'; end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta';
  insert into connector_private.connector_payload_envelopes(
    workspace_id,connection_id,payload_kind,schema_version,canonical_hash,
    ciphertext,nonce,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,
    created_at,updated_at
  ) values (
    target_connection.workspace_id,target_connection.id,'meta-inbound-message','meta-inbound-message.v1',target_hash,
    decode(target_envelope->>'ciphertext','base64'),decode(target_envelope->>'nonce','base64'),
    decode(target_envelope->>'authTag','base64'),decode(target_envelope->>'wrappedDek','base64'),
    decode(target_envelope->>'wrapNonce','base64'),decode(target_envelope->>'wrapAuthTag','base64'),
    target_envelope->>'kekVersion',target_envelope->>'aadHash',target_occurred_at,target_occurred_at
  ) returning * into target_payload;
  return target_payload;
end;
$$;

revoke all on function connector_private.meta_expected_scopes(public.meta_login_mode) from public;
revoke all on function connector_private.meta_expected_channel(public.meta_login_mode) from public;
revoke all on function connector_private.meta_envelope_is_valid(jsonb,boolean) from public;
revoke all on function connector_private.upsert_meta_secret(uuid,text,integer,jsonb,timestamptz) from public;
revoke all on function connector_private.meta_secret_json(connector_private.connector_connection_secrets) from public;
revoke all on function connector_private.meta_payload_json(connector_private.connector_payload_envelopes) from public;
revoke all on function connector_private.store_meta_payload(uuid,text,jsonb,timestamptz,timestamptz) from public;

-- OAuth and asset authority -------------------------------------------------

create or replace function public.begin_meta_oauth(
  target_connection_id uuid,target_workspace_id uuid,target_login_mode public.meta_login_mode,
  target_graph_version text,target_version_source_url text,target_version_source_hash text,
  target_version_reviewed_at timestamptz,target_requested_scopes text[],target_correlation_id uuid,
  target_state_hash text,target_session_binding_hash text,target_redirect_uri text,
  target_safe_return_path text,target_state_envelope jsonb,target_expires_at timestamptz,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
 target_authority public.meta_connection_authorities%rowtype;
 target_transaction connector_private.connector_oauth_transactions%rowtype;
 target_receipt public.connector_receipt_events%rowtype; exact_scopes text[]; no_op boolean:=false;
begin
  actor:=public.connector_current_membership(target_workspace_id,true);
  exact_scopes:=connector_private.meta_expected_scopes(target_login_mode);
  if target_connection_id is null or target_graph_version !~ '^v[1-9][0-9]{0,2}\.[0-9]{1,2}$'
     or target_version_source_url !~ '^https://' or length(target_version_source_url)>2048
     or target_version_source_hash !~ '^[0-9a-f]{64}$'
     or target_version_reviewed_at is null or target_version_reviewed_at>target_occurred_at
     or target_requested_scopes is distinct from exact_scopes
     or target_state_hash !~ '^[0-9a-f]{64}$' or target_session_binding_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null or target_expires_at<=target_occurred_at
     or target_expires_at>target_occurred_at+interval '15 minutes'
     or not connector_private.meta_envelope_is_valid(target_state_envelope,false) then
    raise exception 'invalid explicitly reviewed Meta OAuth request' using errcode='22023'; end if;
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id for update;
  if found then
    if target_connection.workspace_id<>target_workspace_id or target_connection.provider<>'meta'
       or target_connection.status not in ('authorizing','active','degraded','reauthorization_required') then
      raise exception 'Meta connection binding is invalid' using errcode='42501'; end if;
    select authority.* into target_authority from public.meta_connection_authorities authority
    where authority.connection_id=target_connection.id for update;
    if found and (target_authority.login_mode<>target_login_mode
       or target_authority.graph_version<>target_graph_version
       or target_authority.version_source_hash<>target_version_source_hash) then
      raise exception 'Meta version/mode changes require a new connection' using errcode='23505'; end if;
  else
    insert into public.connector_connections(
      id,workspace_id,provider,display_label,status,granted_scopes,remote_identity_summary,
      created_by_membership_id,created_at,updated_at
    ) values (
      target_connection_id,target_workspace_id,'meta','Meta authorization pending','authorizing','{}','{}',
      actor.id,target_occurred_at,target_occurred_at
    ) returning * into target_connection;
  end if;
  if target_authority.connection_id is null then
    insert into public.meta_connection_authorities(
      connection_id,workspace_id,login_mode,graph_version,version_source_url,version_source_hash,
      version_reviewed_at,version_approved_by_membership_id,requested_scopes,created_by_membership_id,
      readiness_state,created_at,updated_at
    ) values (
      target_connection.id,target_workspace_id,target_login_mode,target_graph_version,target_version_source_url,
      target_version_source_hash,target_version_reviewed_at,actor.id,exact_scopes,actor.id,
      'business_verification_required',target_occurred_at,target_occurred_at
    ) returning * into target_authority;
  end if;
  select transaction_row.* into target_transaction from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.state_hash=target_state_hash for update;
  if found then
    if target_transaction.workspace_id<>target_workspace_id or target_transaction.connection_id<>target_connection.id
       or target_transaction.provider<>'meta' or target_transaction.requested_scope_bundle<>target_login_mode::text
       or target_transaction.requested_scopes<>exact_scopes or target_transaction.actor_user_id<>actor.user_id
       or target_transaction.membership_id<>actor.id or target_transaction.session_binding_hash<>target_session_binding_hash
       or target_transaction.redirect_uri<>target_redirect_uri or target_transaction.safe_return_path<>target_safe_return_path
       or target_transaction.expires_at<>target_expires_at then
      raise exception 'Meta OAuth start replay conflicts' using errcode='23505'; end if;
    no_op:=true;
  else
    insert into connector_private.connector_oauth_transactions(
      workspace_id,connection_id,provider,state_hash,requested_scope_bundle,requested_scopes,
      actor_user_id,membership_id,session_binding_hash,redirect_uri,safe_return_path,
      pkce_ciphertext,pkce_nonce,pkce_auth_tag,pkce_wrapped_dek,pkce_wrap_nonce,pkce_wrap_auth_tag,
      kek_version,aad_hash,expires_at,created_at
    ) values (
      target_workspace_id,target_connection.id,'meta',target_state_hash,target_login_mode::text,exact_scopes,
      actor.user_id,actor.id,target_session_binding_hash,target_redirect_uri,target_safe_return_path,
      decode(target_state_envelope->>'ciphertext','base64'),decode(target_state_envelope->>'nonce','base64'),
      decode(target_state_envelope->>'authTag','base64'),decode(target_state_envelope->>'wrappedDek','base64'),
      decode(target_state_envelope->>'wrapNonce','base64'),decode(target_state_envelope->>'wrapAuthTag','base64'),
      target_state_envelope->>'kekVersion',target_state_envelope->>'aadHash',target_expires_at,target_occurred_at
    ) returning * into target_transaction;
  end if;
  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id=target_workspace_id and receipt.event_key='meta.oauth.started:'||target_transaction.id::text;
  if not found then
    insert into public.connector_receipt_events(
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
      redacted_metadata,occurred_at
    ) values (
      target_workspace_id,target_connection.id,'meta','oauth.started','meta.oauth.started:'||target_transaction.id::text,
      target_correlation_id,target_version_source_hash,jsonb_build_object('transactionId',target_transaction.id,
        'loginMode',target_login_mode,'graphVersion',target_graph_version,'requestedScopes',exact_scopes,
        'versionSourceHash',target_version_source_hash,'versionReviewedAt',target_version_reviewed_at),target_occurred_at
    ) returning * into target_receipt;
  end if;
  return jsonb_build_object('connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
    'transaction',jsonb_build_object('transactionId',target_transaction.id,'connectionId',target_connection.id,
      'workspaceId',target_workspace_id,'loginMode',target_login_mode,'graphVersion',target_graph_version,
      'requestedScopes',exact_scopes,'safeReturnPath',target_safe_return_path,'expiresAt',target_expires_at,
      'consumedAt',target_transaction.consumed_at),'receipt',to_jsonb(target_receipt),'noOp',no_op);
end;
$$;

create or replace function public.consume_meta_oauth_transaction(
  target_state_hash text,target_workspace_id uuid,target_actor_user_id uuid,target_membership_id uuid,
  target_session_binding_hash text,target_redirect_uri text,target_consumed_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_transaction connector_private.connector_oauth_transactions%rowtype;
 target_authority public.meta_connection_authorities%rowtype; expected_version integer;
begin
  select transaction_row.* into target_transaction from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.state_hash=target_state_hash and transaction_row.provider='meta' for update;
  if not found then raise exception 'Meta OAuth transaction not found' using errcode='P0002'; end if;
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_transaction.connection_id;
  if target_transaction.consumed_at is not null or target_transaction.expires_at<=target_consumed_at
     or target_transaction.workspace_id<>target_workspace_id or target_transaction.actor_user_id<>target_actor_user_id
     or target_transaction.membership_id<>target_membership_id
     or target_transaction.session_binding_hash<>target_session_binding_hash
     or target_transaction.redirect_uri<>target_redirect_uri
     or target_transaction.requested_scopes<>connector_private.meta_expected_scopes(target_authority.login_mode)
     or not exists(select 1 from public.workspace_members membership
       where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
         and membership.user_id=target_actor_user_id and membership.role='owner' and membership.status='active') then
    raise exception 'Meta OAuth transaction binding, expiry or replay check failed' using errcode='42501'; end if;
  update connector_private.connector_oauth_transactions set consumed_at=target_consumed_at
  where id=target_transaction.id returning * into target_transaction;
  select secret.secret_version into expected_version from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_transaction.connection_id and secret.secret_type='meta-access-token'
    and secret.destroyed_at is null;
  return jsonb_build_object('transactionId',target_transaction.id,'workspaceId',target_workspace_id,
    'connectionId',target_transaction.connection_id,'provider','meta','loginMode',target_authority.login_mode,
    'graphVersion',target_authority.graph_version,'requestedScopes',target_transaction.requested_scopes,
    'safeReturnPath',target_transaction.safe_return_path,'stateEnvelope',jsonb_build_object(
      'ciphertext',encode(target_transaction.pkce_ciphertext,'base64'),'nonce',encode(target_transaction.pkce_nonce,'base64'),
      'authTag',encode(target_transaction.pkce_auth_tag,'base64'),'wrappedDek',encode(target_transaction.pkce_wrapped_dek,'base64'),
      'wrapNonce',encode(target_transaction.pkce_wrap_nonce,'base64'),'wrapAuthTag',encode(target_transaction.pkce_wrap_auth_tag,'base64'),
      'kekVersion',target_transaction.kek_version,'aadHash',target_transaction.aad_hash),
    'expectedAccessSecretVersion',expected_version,'consumedAt',target_transaction.consumed_at);
end;
$$;

create or replace function public.finalize_meta_oauth(
  target_transaction_id uuid,target_workspace_id uuid,target_actor_user_id uuid,target_membership_id uuid,
  target_account_key_hash text,target_granted_scopes text[],target_business_verified boolean,
  target_business_verification_hash text,target_app_review_approved boolean,target_app_review_evidence_hash text,
  target_expected_access_secret_version integer,target_access_token_envelope jsonb,
  target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_transaction connector_private.connector_oauth_transactions%rowtype;
 target_connection public.connector_connections%rowtype; target_authority public.meta_connection_authorities%rowtype;
 target_receipt public.connector_receipt_events%rowtype; secret_metadata jsonb; next_readiness public.meta_readiness_state;
begin
  if target_account_key_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null
     or (target_business_verified and target_business_verification_hash !~ '^[0-9a-f]{64}$')
     or (not target_business_verified and target_business_verification_hash is not null)
     or (target_app_review_approved and target_app_review_evidence_hash !~ '^[0-9a-f]{64}$')
     or (not target_app_review_approved and target_app_review_evidence_hash is not null) then
    raise exception 'invalid Meta OAuth evidence' using errcode='22023'; end if;
  select transaction_row.* into target_transaction from connector_private.connector_oauth_transactions transaction_row
  where transaction_row.id=target_transaction_id and transaction_row.provider='meta' for update;
  if not found then raise exception 'Meta OAuth transaction not found' using errcode='P0002'; end if;
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_transaction.connection_id for update;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_transaction.connection_id and connection.workspace_id=target_workspace_id
    and connection.provider='meta' for update;
  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id=target_workspace_id and receipt.event_key='meta.oauth.completed:'||target_transaction.id::text;
  if found then
    if target_connection.provider_account_key_hash<>target_account_key_hash
       or target_connection.granted_scopes<>target_granted_scopes then
      raise exception 'Meta OAuth completion replay conflicts' using errcode='23505'; end if;
    return jsonb_build_object('connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
      'secret',jsonb_build_object('secretVersion',target_expected_access_secret_version),'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;
  if target_transaction.consumed_at is null or target_transaction.workspace_id<>target_workspace_id
     or target_transaction.actor_user_id<>target_actor_user_id or target_transaction.membership_id<>target_membership_id
     or target_granted_scopes is distinct from connector_private.meta_expected_scopes(target_authority.login_mode)
     or target_transaction.requested_scopes<>target_granted_scopes
     or target_authority.version_approved_by_membership_id<>target_membership_id
     or target_authority.version_reviewed_at is null
     or not exists(select 1 from public.workspace_members membership
       where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
         and membership.user_id=target_actor_user_id and membership.role='owner' and membership.status='active') then
    raise exception 'consumed Meta OAuth owner/version/scope binding required' using errcode='42501'; end if;
  if target_connection.provider_account_key_hash is not null
     and target_connection.provider_account_key_hash<>target_account_key_hash then
    raise exception 'Meta account swap requires a new connection' using errcode='42501'; end if;
  secret_metadata:=connector_private.upsert_meta_secret(target_connection.id,'meta-access-token',
    target_expected_access_secret_version,target_access_token_envelope,target_occurred_at);
  next_readiness:=case when not target_business_verified then 'business_verification_required'::public.meta_readiness_state
    when not target_app_review_approved then 'app_review_blocked'::public.meta_readiness_state
    else 'asset_selection_required'::public.meta_readiness_state end;
  update public.meta_connection_authorities set granted_scopes=target_granted_scopes,
    account_key_hash=target_account_key_hash,business_verified=target_business_verified,
    business_verification_hash=target_business_verification_hash,app_review_approved=target_app_review_approved,
    app_review_evidence_hash=target_app_review_evidence_hash,readiness_state=next_readiness,
    enabled=target_business_verified and target_app_review_approved,last_error_category=null,updated_at=target_occurred_at
  where connection_id=target_connection.id returning * into target_authority;
  update public.connector_connections set provider_account_key_hash=target_account_key_hash,
    granted_scopes=target_granted_scopes,remote_identity_summary=jsonb_build_object(
      'accountKeyHash',target_account_key_hash,'loginMode',target_authority.login_mode,
      'graphVersion',target_authority.graph_version,'inboundOnly',true),
    status=case when target_business_verified and target_app_review_approved then 'active'::public.connector_connection_status
      else status end,updated_at=target_occurred_at
  where id=target_connection.id returning * into target_connection;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    redacted_metadata,occurred_at
  ) values (
    target_workspace_id,target_connection.id,'meta','oauth.completed','meta.oauth.completed:'||target_transaction.id::text,
    target_correlation_id,target_account_key_hash,jsonb_build_object('transactionId',target_transaction.id,
      'loginMode',target_authority.login_mode,'graphVersion',target_authority.graph_version,
      'grantedScopes',target_granted_scopes,'businessVerified',target_business_verified,
      'appReviewApproved',target_app_review_approved,'inboundOnly',true),target_occurred_at
  ) returning * into target_receipt;
  return jsonb_build_object('connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
    'secret',secret_metadata,'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.read_meta_asset_discovery_authority(
  target_connection_id uuid,target_authenticated_user_id uuid,target_membership_id uuid,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; target_authority public.meta_connection_authorities%rowtype;
 target_secret connector_private.connector_connection_secrets%rowtype;
begin
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta' and connection.status in ('active','degraded');
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled
    and authority.version_approved_by_membership_id is not null and authority.version_reviewed_at is not null;
  if not exists(select 1 from public.workspace_members membership
      where membership.id=target_membership_id and membership.workspace_id=target_connection.workspace_id
        and membership.user_id=target_authenticated_user_id and membership.role='owner' and membership.status='active') then
    raise exception 'active Meta owner discovery binding required' using errcode='42501'; end if;
  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='meta-access-token'
    and secret.destroyed_at is null and secret.expires_at>target_now;
  if not found then raise exception 'Meta access token unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
    'accessToken',connector_private.meta_secret_json(target_secret));
end;
$$;

create or replace function public.replace_meta_eligible_assets(
  target_connection_id uuid,target_graph_version text,target_snapshot_hash text,
  target_assets jsonb,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; target_authority public.meta_connection_authorities%rowtype;
 item jsonb; target_binding public.meta_asset_bindings%rowtype; expected_channel public.meta_channel;
 asset_hash text; items jsonb:='[]'::jsonb;
begin
  if target_snapshot_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(target_assets)<>'array'
     or jsonb_array_length(target_assets) not between 1 and 100 then
    raise exception 'invalid Meta eligible asset snapshot' using errcode='22023'; end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta' and connection.status in ('active','degraded') for update;
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled for update;
  if target_authority.graph_version<>target_graph_version then
    raise exception 'Meta graph version binding failed' using errcode='42501'; end if;
  if exists(select 1 from public.meta_asset_bindings binding where binding.connection_id=target_connection.id and binding.state='selected') then
    raise exception 'selected Meta assets require explicit owner reauthorization, not discovery replacement' using errcode='23514'; end if;
  expected_channel:=connector_private.meta_expected_channel(target_authority.login_mode);
  update public.meta_asset_bindings set state='removed',removed_at=target_occurred_at,updated_at=target_occurred_at
  where connection_id=target_connection.id and state='eligible';
  for item in select value from jsonb_array_elements(target_assets) value loop
    if item - array['channel','assetId','displayLabel']::text[] <> '{}'::jsonb
       or item->>'channel'<>expected_channel::text
       or length(item->>'assetId') not between 1 and 512
       or item->>'assetId' !~ '^[A-Za-z0-9._:-]+$'
       or length(btrim(item->>'displayLabel')) not between 1 and 120 then
      raise exception 'invalid or unsupported Meta asset' using errcode='22023'; end if;
    asset_hash:=encode(extensions.digest(pg_catalog.convert_to(item->>'assetId','UTF8'),'sha256'),'hex');
    insert into public.meta_asset_bindings(
      workspace_id,connection_id,channel,asset_id_hash,display_label,eligibility_snapshot_hash,
      state,created_at,updated_at
    ) values (
      target_connection.workspace_id,target_connection.id,expected_channel,asset_hash,btrim(item->>'displayLabel'),
      target_snapshot_hash,'eligible',target_occurred_at,target_occurred_at
    ) on conflict(connection_id,channel,asset_id_hash) do update set
      display_label=excluded.display_label,eligibility_snapshot_hash=excluded.eligibility_snapshot_hash,
      state='eligible',selected_at=null,removed_at=null,updated_at=excluded.updated_at
    returning * into target_binding;
    insert into connector_private.meta_asset_identities(asset_binding_id,workspace_id,connection_id,asset_id,created_at,updated_at)
    values(target_binding.id,target_binding.workspace_id,target_binding.connection_id,item->>'assetId',target_occurred_at,target_occurred_at)
    on conflict(asset_binding_id) do update set asset_id=excluded.asset_id,updated_at=excluded.updated_at;
    items:=items||jsonb_build_array(to_jsonb(target_binding));
  end loop;
  update public.meta_connection_authorities set eligibility_snapshot_hash=target_snapshot_hash,
    readiness_state='asset_selection_required',updated_at=target_occurred_at
  where connection_id=target_connection.id returning * into target_authority;
  return jsonb_build_object('authority',to_jsonb(target_authority),'snapshotHash',target_snapshot_hash,'assets',items);
end;
$$;

create or replace function public.select_meta_assets(
  target_connection_id uuid,target_snapshot_hash text,target_asset_hashes text[],target_retention_days integer,
  target_retention_policy_hash text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_connection public.connector_connections%rowtype;
 target_authority public.meta_connection_authorities%rowtype; target_receipt public.connector_receipt_events%rowtype;
 assets jsonb;
begin
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta' and connection.status in ('active','degraded') for update;
  actor:=public.connector_current_membership(target_connection.workspace_id,true);
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled for update;
  if target_snapshot_hash<>target_authority.eligibility_snapshot_hash or target_snapshot_hash !~ '^[0-9a-f]{64}$'
     or cardinality(target_asset_hashes) not between 1 and 20
     or (select count(distinct value) from unnest(target_asset_hashes) value)<>cardinality(target_asset_hashes)
     or exists(select 1 from unnest(target_asset_hashes) value where value !~ '^[0-9a-f]{64}$')
     or target_retention_days not between 1 and 3650 or target_retention_policy_hash !~ '^[0-9a-f]{64}$'
     or (select count(*) from public.meta_asset_bindings binding where binding.connection_id=target_connection.id
       and binding.state='eligible' and binding.eligibility_snapshot_hash=target_snapshot_hash
       and binding.asset_id_hash=any(target_asset_hashes))<>cardinality(target_asset_hashes) then
    raise exception 'Meta asset selection is stale or invalid' using errcode='40001'; end if;
  update public.meta_asset_bindings set state='eligible',selected_at=null,removed_at=null,updated_at=target_occurred_at
  where connection_id=target_connection.id and state='selected';
  update public.meta_asset_bindings set state='selected',selected_at=target_occurred_at,removed_at=null,updated_at=target_occurred_at
  where connection_id=target_connection.id and state='eligible' and asset_id_hash=any(target_asset_hashes);
  update public.meta_connection_authorities set selected_asset_snapshot_hash=target_snapshot_hash,
    retention_days=target_retention_days,retention_policy_hash=target_retention_policy_hash,
    selected_by_membership_id=actor.id,selected_at=target_occurred_at,
    readiness_state='webhook_setup_required',webhook_challenge_confirmed=false,updated_at=target_occurred_at
  where connection_id=target_connection.id returning * into target_authority;
  select jsonb_agg(to_jsonb(binding) order by binding.channel,binding.display_label,binding.id) into assets
  from public.meta_asset_bindings binding where binding.connection_id=target_connection.id and binding.state='selected';
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'meta','sync.applied',
    'meta.assets.selected:'||target_connection.id::text||':'||target_snapshot_hash,target_correlation_id,target_snapshot_hash,
    jsonb_build_object('assetCount',cardinality(target_asset_hashes),'snapshotHash',target_snapshot_hash,
      'graphVersion',target_authority.graph_version,'inboundOnly',true),target_occurred_at
  ) on conflict(workspace_id,event_key) do nothing returning * into target_receipt;
  if target_receipt.id is null then
    select receipt.* into strict target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id=target_connection.workspace_id
      and receipt.event_key='meta.assets.selected:'||target_connection.id::text||':'||target_snapshot_hash;
  end if;
  return jsonb_build_object('authority',to_jsonb(target_authority),'selectedAssets',coalesce(assets,'[]'::jsonb),
    'receipt',to_jsonb(target_receipt));
end;
$$;

-- Webhook endpoint and atomic ingress ---------------------------------------

create or replace function public.bind_meta_webhook_authority(
  target_connection_id uuid,target_endpoint_key_hash text,target_expected_app_secret_version integer,
  target_app_secret_envelope jsonb,target_expected_verify_token_version integer,target_verify_token_envelope jsonb,
  target_subscription_evidence_hash text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; target_authority public.meta_connection_authorities%rowtype;
 target_webhook connector_private.meta_webhook_authorities%rowtype; app_secret jsonb; verify_secret jsonb;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$' or target_subscription_evidence_hash !~ '^[0-9a-f]{64}$'
     or target_correlation_id is null then raise exception 'invalid Meta webhook binding' using errcode='22023'; end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta' and connection.status in ('active','degraded') for update;
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled and authority.business_verified
    and authority.app_review_approved and authority.selected_at is not null for update;
  app_secret:=connector_private.upsert_meta_secret(target_connection.id,'meta-app-secret',
    target_expected_app_secret_version,target_app_secret_envelope,target_occurred_at);
  verify_secret:=connector_private.upsert_meta_secret(target_connection.id,'meta-webhook-verify-token',
    target_expected_verify_token_version,target_verify_token_envelope,target_occurred_at);
  insert into connector_private.meta_webhook_authorities(
    connection_id,workspace_id,endpoint_key_hash,subscription_evidence_hash,bound_at,updated_at
  ) values (
    target_connection.id,target_connection.workspace_id,target_endpoint_key_hash,target_subscription_evidence_hash,
    target_occurred_at,target_occurred_at
  ) on conflict(connection_id) do update set endpoint_key_hash=excluded.endpoint_key_hash,
    subscription_evidence_hash=excluded.subscription_evidence_hash,challenge_evidence_hash=null,
    challenge_confirmed_at=null,revoked_at=null,bound_at=excluded.bound_at,updated_at=excluded.updated_at
  returning * into target_webhook;
  update public.meta_connection_authorities set readiness_state='webhook_challenge_required',
    webhook_challenge_confirmed=false,updated_at=target_occurred_at
  where connection_id=target_connection.id returning * into target_authority;
  return jsonb_build_object('authority',to_jsonb(target_authority),'webhook',jsonb_build_object(
    'connectionId',target_webhook.connection_id,'boundAt',target_webhook.bound_at,
    'challengeConfirmedAt',target_webhook.challenge_confirmed_at),
    'secrets',jsonb_build_array(app_secret,verify_secret));
end;
$$;

create or replace function public.read_meta_webhook_authority(target_endpoint_key_hash text,target_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_webhook connector_private.meta_webhook_authorities%rowtype;
 target_connection public.connector_connections%rowtype; target_authority public.meta_connection_authorities%rowtype;
 app_secret connector_private.connector_connection_secrets%rowtype;
 verify_secret connector_private.connector_connection_secrets%rowtype; selected_assets jsonb;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'Meta endpoint not found' using errcode='P0002'; end if;
  select webhook.* into target_webhook from connector_private.meta_webhook_authorities webhook
  where webhook.endpoint_key_hash=target_endpoint_key_hash and webhook.revoked_at is null;
  if not found then raise exception 'Meta endpoint not found' using errcode='P0002'; end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_webhook.connection_id and connection.workspace_id=target_webhook.workspace_id
    and connection.provider='meta' and connection.status in ('active','degraded');
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled and authority.business_verified
    and authority.app_review_approved and authority.version_approved_by_membership_id is not null;
  select secret.* into app_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='meta-app-secret'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Meta app secret unavailable' using errcode='P0002'; end if;
  select secret.* into verify_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.secret_type='meta-webhook-verify-token'
    and secret.destroyed_at is null and (secret.expires_at is null or secret.expires_at>target_now);
  if not found then raise exception 'Meta verify token unavailable' using errcode='P0002'; end if;
  select jsonb_agg(jsonb_build_object('channel',binding.channel,'assetId',identity.asset_id,
    'assetIdHash',binding.asset_id_hash,'displayLabel',binding.display_label) order by binding.channel,binding.id)
    into selected_assets from public.meta_asset_bindings binding
    join connector_private.meta_asset_identities identity on identity.asset_binding_id=binding.id
    where binding.connection_id=target_connection.id and binding.state='selected';
  if selected_assets is null then raise exception 'selected Meta asset unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('workspaceId',target_connection.workspace_id,'connectionId',target_connection.id,
    'graphVersion',target_authority.graph_version,'loginMode',target_authority.login_mode,
    'selectedAssets',selected_assets,'challengeConfirmed',target_webhook.challenge_confirmed_at is not null,
    'appSecret',connector_private.meta_secret_json(app_secret),
    'verifyToken',connector_private.meta_secret_json(verify_secret));
end;
$$;

create or replace function public.confirm_meta_webhook_challenge(
  target_endpoint_key_hash text,target_challenge_evidence_hash text,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_webhook connector_private.meta_webhook_authorities%rowtype;
 target_authority public.meta_connection_authorities%rowtype;
begin
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$' or target_challenge_evidence_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Meta challenge evidence' using errcode='22023'; end if;
  select webhook.* into target_webhook from connector_private.meta_webhook_authorities webhook
  where webhook.endpoint_key_hash=target_endpoint_key_hash and webhook.revoked_at is null for update;
  if not found then raise exception 'Meta endpoint not found' using errcode='P0002'; end if;
  if target_webhook.challenge_confirmed_at is not null then
    if target_webhook.challenge_evidence_hash<>target_challenge_evidence_hash then
      raise exception 'Meta challenge evidence replay conflicts' using errcode='23505'; end if;
  else
    update connector_private.meta_webhook_authorities set challenge_evidence_hash=target_challenge_evidence_hash,
      challenge_confirmed_at=target_occurred_at,updated_at=target_occurred_at
    where connection_id=target_webhook.connection_id returning * into target_webhook;
  end if;
  update public.meta_connection_authorities set readiness_state='active',webhook_challenge_confirmed=true,
    updated_at=target_occurred_at where connection_id=target_webhook.connection_id and enabled
      and business_verified and app_review_approved and selected_at is not null returning * into target_authority;
  if not found then raise exception 'Meta activation evidence incomplete' using errcode='23514'; end if;
  return jsonb_build_object('authority',to_jsonb(target_authority),'webhook',jsonb_build_object(
    'connectionId',target_webhook.connection_id,'challengeConfirmedAt',target_webhook.challenge_confirmed_at));
end;
$$;

create or replace function public.register_meta_webhook_delivery_encrypted(
  target_endpoint_key_hash text,target_replay_key_hash text,target_body_hash text,
  target_graph_version text,target_signature_valid boolean,target_events jsonb,
  target_received_at timestamptz,target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_webhook connector_private.meta_webhook_authorities%rowtype;
 target_connection public.connector_connections%rowtype; target_authority public.meta_connection_authorities%rowtype;
 existing_delivery public.connector_webhook_deliveries%rowtype; target_delivery public.connector_webhook_deliveries%rowtype;
 item jsonb; target_asset public.meta_asset_bindings%rowtype;
 target_identity public.meta_external_identities%rowtype; target_conversation public.meta_conversations%rowtype;
 target_event public.meta_inbound_events%rowtype; target_payload connector_private.connector_payload_envelopes%rowtype;
 target_job public.meta_normalization_jobs%rowtype; target_receipt public.connector_receipt_events%rowtype;
 sender_hash text; message_hash text; conversation_hash text; provider_at timestamptz;
 accepted integer:=0; duplicate integer:=0; review integer:=0; jobs jsonb:='[]'::jsonb; events_out jsonb:='[]'::jsonb;
begin
  -- No database mutation occurs for an invalid signature, wrong graph version,
  -- wrong asset or malformed event: every check precedes the first INSERT and
  -- exceptions roll back the statement transaction.
  if not target_signature_valid then raise exception 'verified Meta signature required' using errcode='42501'; end if;
  if target_endpoint_key_hash !~ '^[0-9a-f]{64}$' or target_replay_key_hash !~ '^[0-9a-f]{64}$'
     or target_body_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null
     or jsonb_typeof(target_events)<>'array' or jsonb_array_length(target_events) not between 1 and 100 then
    raise exception 'invalid Meta webhook delivery' using errcode='22023'; end if;
  select webhook.* into target_webhook from connector_private.meta_webhook_authorities webhook
  where webhook.endpoint_key_hash=target_endpoint_key_hash and webhook.revoked_at is null;
  if not found or target_webhook.challenge_confirmed_at is null then
    raise exception 'active challenged Meta endpoint required' using errcode='42501'; end if;
  select connection.* into strict target_connection from public.connector_connections connection
  where connection.id=target_webhook.connection_id and connection.workspace_id=target_webhook.workspace_id
    and connection.provider='meta' and connection.status in ('active','degraded');
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id and authority.enabled and authority.readiness_state='active'
    and authority.webhook_challenge_confirmed and authority.version_approved_by_membership_id is not null;
  if target_graph_version<>target_authority.graph_version then
    raise exception 'Meta graph version binding failed' using errcode='42501'; end if;
  select delivery.* into existing_delivery from public.connector_webhook_deliveries delivery
  where delivery.connection_id=target_connection.id and delivery.replay_key_hash=target_replay_key_hash;
  if found then
    if existing_delivery.raw_body_hash<>target_body_hash or existing_delivery.provider<>'meta'
       or not existing_delivery.signature_valid then raise exception 'divergent Meta webhook replay' using errcode='23505'; end if;
    select count(*) into accepted from public.meta_inbound_events event where event.webhook_delivery_id=existing_delivery.id;
    select count(*) into review from public.meta_inbound_events event where event.webhook_delivery_id=existing_delivery.id and event.state='review';
    return jsonb_build_object('accepted',accepted,'duplicate',accepted,'review',review,
      'delivery',to_jsonb(existing_delivery),'events','[]'::jsonb,'jobs','[]'::jsonb,'noOp',true);
  end if;
  -- Validate the full batch against selected private assets before persistence.
  for item in select value from jsonb_array_elements(target_events) value loop
    if item ?& array['channel','assetId','senderId','recipientId','messageId','providerOccurredAt',
      'eventKeyHash','contentHash','attachmentTypes','envelope'] is false
      or item->>'channel' not in ('facebook','instagram')
      or length(item->>'assetId') not between 1 and 512 or item->>'assetId' !~ '^[A-Za-z0-9._:-]+$'
      or length(item->>'senderId') not between 1 and 512 or item->>'senderId' !~ '^[A-Za-z0-9._:-]+$'
      or length(item->>'recipientId') not between 1 and 512 or item->>'recipientId' !~ '^[A-Za-z0-9._:-]+$'
      or length(item->>'messageId') not between 1 and 512 or item->>'messageId' !~ '^[A-Za-z0-9._:-]+$'
      or item->>'eventKeyHash' !~ '^[0-9a-f]{64}$' or item->>'contentHash' !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item->'attachmentTypes')<>'array' or jsonb_array_length(item->'attachmentTypes')>20
      or not connector_private.meta_envelope_is_valid(item->'envelope',false) then
      raise exception 'invalid normalized Meta event' using errcode='22023'; end if;
    perform (item->>'providerOccurredAt')::timestamptz;
    select binding.* into target_asset from public.meta_asset_bindings binding
    join connector_private.meta_asset_identities identity on identity.asset_binding_id=binding.id
    where binding.connection_id=target_connection.id and binding.state='selected'
      and binding.channel::text=item->>'channel' and identity.asset_id=item->>'assetId';
    if not found then raise exception 'Meta selected asset binding failed' using errcode='42501'; end if;
  end loop;
  insert into public.connector_webhook_deliveries(
    workspace_id,connection_id,provider,replay_key_hash,raw_body_hash,signature_valid,timestamp_valid,
    outcome,correlation_id,received_at,created_at
  ) values (
    target_connection.workspace_id,target_connection.id,'meta',target_replay_key_hash,target_body_hash,true,true,
    'accepted',target_correlation_id,target_received_at,target_received_at
  ) returning * into target_delivery;
  for item in select value from jsonb_array_elements(target_events) value loop
    select binding.* into strict target_asset from public.meta_asset_bindings binding
    join connector_private.meta_asset_identities identity on identity.asset_binding_id=binding.id
    where binding.connection_id=target_connection.id and binding.state='selected'
      and binding.channel::text=item->>'channel' and identity.asset_id=item->>'assetId';
    sender_hash:=encode(extensions.digest(pg_catalog.convert_to(item->>'senderId','UTF8'),'sha256'),'hex');
    message_hash:=encode(extensions.digest(pg_catalog.convert_to(item->>'messageId','UTF8'),'sha256'),'hex');
    conversation_hash:=encode(extensions.digest(pg_catalog.convert_to(
      (item->>'channel')||'|'||(item->>'assetId')||'|'||(item->>'senderId'),'UTF8'),'sha256'),'hex');
    provider_at:=(item->>'providerOccurredAt')::timestamptz;
    select event.* into target_event from public.meta_inbound_events event
    where event.connection_id=target_connection.id and (event.event_key_hash=item->>'eventKeyHash'
      or event.message_key_hash=message_hash);
    if found then
      if target_event.content_hash<>item->>'contentHash' then raise exception 'divergent Meta event replay' using errcode='23505'; end if;
      duplicate:=duplicate+1; events_out:=events_out||jsonb_build_array(to_jsonb(target_event)); continue;
    end if;
    insert into public.meta_external_identities(
      workspace_id,connection_id,asset_binding_id,channel,sender_key_hash,first_event_at,last_event_at,created_at,updated_at
    ) values (
      target_connection.workspace_id,target_connection.id,target_asset.id,(item->>'channel')::public.meta_channel,
      sender_hash,provider_at,provider_at,target_received_at,target_received_at
    ) on conflict(connection_id,asset_binding_id,sender_key_hash) do update set
      last_event_at=greatest(public.meta_external_identities.last_event_at,excluded.last_event_at),updated_at=excluded.updated_at
    returning * into target_identity;
    insert into public.meta_conversations(
      workspace_id,connection_id,asset_binding_id,external_identity_id,channel,conversation_key_hash,
      contact_id,created_at,updated_at
    ) values (
      target_connection.workspace_id,target_connection.id,target_asset.id,target_identity.id,
      (item->>'channel')::public.meta_channel,conversation_hash,target_identity.contact_id,target_received_at,target_received_at
    ) on conflict(connection_id,conversation_key_hash) do update set updated_at=excluded.updated_at
    returning * into target_conversation;
    if target_conversation.last_provider_at is not null and provider_at<=target_conversation.last_provider_at then
      insert into public.meta_inbound_events(
        workspace_id,connection_id,webhook_delivery_id,asset_binding_id,external_identity_id,conversation_id,
        channel,event_key_hash,message_key_hash,content_hash,attachment_types,provider_occurred_at,received_at,
        state,correlation_id,created_at,updated_at
      ) values (
        target_connection.workspace_id,target_connection.id,target_delivery.id,target_asset.id,target_identity.id,
        target_conversation.id,(item->>'channel')::public.meta_channel,item->>'eventKeyHash',message_hash,
        item->>'contentHash',array(select value from jsonb_array_elements_text(item->'attachmentTypes') value),
        provider_at,target_received_at,'ignored_stale',target_correlation_id,target_received_at,target_received_at
      ) returning * into target_event;
      review:=review+1; events_out:=events_out||jsonb_build_array(to_jsonb(target_event)); continue;
    end if;
    target_payload:=connector_private.store_meta_payload(target_connection.id,item->>'contentHash',item->'envelope',
      target_received_at+make_interval(days=>target_authority.retention_days),target_received_at);
    insert into public.meta_inbound_events(
      workspace_id,connection_id,webhook_delivery_id,asset_binding_id,external_identity_id,conversation_id,
      channel,event_key_hash,message_key_hash,content_hash,content_payload_ref,attachment_types,
      provider_occurred_at,received_at,state,correlation_id,created_at,updated_at
    ) values (
      target_connection.workspace_id,target_connection.id,target_delivery.id,target_asset.id,target_identity.id,
      target_conversation.id,(item->>'channel')::public.meta_channel,item->>'eventKeyHash',message_hash,
      item->>'contentHash',target_payload.id,array(select value from jsonb_array_elements_text(item->'attachmentTypes') value),
      provider_at,target_received_at,'accepted',target_correlation_id,target_received_at,target_received_at
    ) returning * into target_event;
    insert into connector_private.meta_event_identities(
      event_id,workspace_id,connection_id,asset_id,sender_id,recipient_id,message_id,created_at
    ) values (
      target_event.id,target_event.workspace_id,target_event.connection_id,item->>'assetId',item->>'senderId',
      item->>'recipientId',item->>'messageId',target_received_at
    );
    update public.meta_conversations set last_message_key_hash=message_hash,last_provider_at=provider_at,
      last_event_at=target_received_at,updated_at=target_received_at where id=target_conversation.id
      returning * into target_conversation;
    insert into public.meta_normalization_jobs(
      workspace_id,connection_id,event_id,state,scheduled_at,correlation_id,created_at,updated_at
    ) values (
      target_event.workspace_id,target_event.connection_id,target_event.id,'queued',target_received_at,
      target_correlation_id,target_received_at,target_received_at
    ) returning * into target_job;
    accepted:=accepted+1; events_out:=events_out||jsonb_build_array(to_jsonb(target_event));
    jobs:=jobs||jsonb_build_array(to_jsonb(target_job));
  end loop;
  update public.connector_webhook_deliveries set processed_at=target_received_at,
    redacted_result='accepted='||accepted::text||';duplicate='||duplicate::text||';stale='||review::text
  where id=target_delivery.id returning * into target_delivery;
  update public.meta_connection_authorities set last_webhook_at=target_received_at,
    last_accepted_event_at=case when accepted>0 then target_received_at else last_accepted_event_at end,
    updated_at=target_received_at where connection_id=target_connection.id returning * into target_authority;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'meta','webhook.accepted',
    'meta.webhook.accepted:'||target_replay_key_hash,target_correlation_id,target_body_hash,
    jsonb_build_object('deliveryId',target_delivery.id,'accepted',accepted,'duplicate',duplicate,
      'stale',review,'graphVersion',target_graph_version,'inboundOnly',true),target_received_at
  ) returning * into target_receipt;
  return jsonb_build_object('accepted',accepted,'duplicate',duplicate,'review',review,
    'delivery',to_jsonb(target_delivery),'events',events_out,'jobs',jobs,'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

-- Durable normalization and conservative identity --------------------------

create or replace function public.claim_meta_normalization_jobs(
  target_worker_id uuid,target_batch_size integer default 10,target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; claimed public.meta_normalization_jobs%rowtype; items jsonb:='[]'::jsonb;
begin
  if target_worker_id is null or target_batch_size not between 1 and 25 or target_lease_seconds not between 15 and 900 then
    raise exception 'invalid Meta normalization claim' using errcode='22023'; end if;
  for candidate in select job.id from public.meta_normalization_jobs job
    join public.connector_connections connection on connection.id=job.connection_id and connection.workspace_id=job.workspace_id
    join public.meta_connection_authorities authority on authority.connection_id=job.connection_id
    where (((job.state in ('queued','retry_wait')) and job.scheduled_at<=target_now)
      or (job.state='leased' and job.lease_expires_at<=target_now))
      and job.attempt_count<job.max_attempts and connection.status in ('active','degraded')
      and authority.enabled and authority.readiness_state in ('active','degraded')
    order by job.scheduled_at,job.created_at,job.id for update of job skip locked limit target_batch_size
  loop
    update public.meta_normalization_jobs set state='leased',lease_owner=target_worker_id,
      lease_expires_at=target_now+make_interval(secs=>target_lease_seconds),fencing_token=fencing_token+1,
      updated_at=target_now where id=candidate.id returning * into claimed;
    items:=items||jsonb_build_array(to_jsonb(claimed));
  end loop;
  return jsonb_build_object('count',jsonb_array_length(items),'jobs',items);
end;
$$;

create or replace function public.start_meta_normalization_attempt(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_started_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.meta_normalization_jobs%rowtype; target_event public.meta_inbound_events%rowtype;
begin
  select job.* into target_job from public.meta_normalization_jobs job where job.id=target_job_id for update;
  if not found then raise exception 'Meta normalization job not found' using errcode='P0002'; end if;
  if target_job.state<>'leased' or target_job.lease_owner<>target_worker_id
     or target_job.fencing_token<>target_fencing_token or target_job.lease_expires_at<=target_started_at then
    raise exception 'stale Meta normalization lease' using errcode='40001'; end if;
  update public.meta_normalization_jobs set state='executing',attempt_count=attempt_count+1,updated_at=target_started_at
  where id=target_job.id returning * into target_job;
  update public.meta_inbound_events set state='normalizing',updated_at=target_started_at
  where id=target_job.event_id and state='accepted' returning * into target_event;
  if not found then raise exception 'Meta event is not normalizable' using errcode='23514'; end if;
  return jsonb_build_object('job',to_jsonb(target_job),'event',to_jsonb(target_event));
end;
$$;

create or replace function public.read_meta_normalization_authority(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_now timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_job public.meta_normalization_jobs%rowtype; target_event public.meta_inbound_events%rowtype;
 target_conversation public.meta_conversations%rowtype; target_asset public.meta_asset_bindings%rowtype;
 target_identity public.meta_external_identities%rowtype; exact_identity connector_private.meta_event_identities%rowtype;
 target_payload connector_private.connector_payload_envelopes%rowtype;
begin
  select job.* into target_job from public.meta_normalization_jobs job
  where job.id=target_job_id and job.state='executing' and job.lease_owner=target_worker_id
    and job.fencing_token=target_fencing_token and job.lease_expires_at>target_now;
  if not found then raise exception 'active fenced Meta normalization required' using errcode='42501'; end if;
  if not exists(select 1 from public.connector_connections connection
      join public.meta_connection_authorities authority on authority.connection_id=connection.id
      where connection.id=target_job.connection_id and connection.workspace_id=target_job.workspace_id
        and connection.provider='meta' and connection.status in ('active','degraded')
        and authority.enabled and authority.readiness_state in ('active','degraded')) then
    raise exception 'active Meta authority required' using errcode='42501'; end if;
  select event.* into strict target_event from public.meta_inbound_events event where event.id=target_job.event_id;
  select conversation.* into strict target_conversation from public.meta_conversations conversation where conversation.id=target_event.conversation_id;
  select binding.* into strict target_asset from public.meta_asset_bindings binding
    where binding.id=target_event.asset_binding_id and binding.state='selected';
  select identity.* into strict target_identity from public.meta_external_identities identity where identity.id=target_event.external_identity_id;
  select exact.* into strict exact_identity from connector_private.meta_event_identities exact where exact.event_id=target_event.id;
  select payload.* into target_payload from connector_private.connector_payload_envelopes payload
  where payload.id=target_event.content_payload_ref and payload.workspace_id=target_job.workspace_id
    and payload.connection_id=target_job.connection_id and payload.payload_kind='meta-inbound-message'
    and payload.schema_version='meta-inbound-message.v1' and payload.canonical_hash=target_event.content_hash
    and payload.destroyed_at is null;
  if not found then raise exception 'Meta content envelope unavailable' using errcode='P0002'; end if;
  return jsonb_build_object('job',to_jsonb(target_job),'event',to_jsonb(target_event),
    'conversation',to_jsonb(target_conversation),'asset',to_jsonb(target_asset),
    'externalIdentity',to_jsonb(target_identity),'providerIdentity',jsonb_build_object(
      'assetId',exact_identity.asset_id,'senderId',exact_identity.sender_id,
      'recipientId',exact_identity.recipient_id,'messageId',exact_identity.message_id),
    'payloadEnvelope',connector_private.meta_payload_json(target_payload));
end;
$$;

create or replace function public.apply_meta_normalized_enquiry(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_normalized_email text,
  target_normalized_phone text,target_identity_evidence_hash text,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.meta_normalization_jobs%rowtype; target_event public.meta_inbound_events%rowtype;
 target_identity public.meta_external_identities%rowtype; target_conversation public.meta_conversations%rowtype;
 target_contact public.contacts%rowtype; target_incomplete public.incomplete_records%rowtype;
 target_activity public.activity_events%rowtype; target_authority public.meta_connection_authorities%rowtype;
 target_receipt public.connector_receipt_events%rowtype; matched_ids uuid[]; active_ids uuid[]; archived_count integer;
 target_review_reason text; outcome text;
begin
  if target_identity_evidence_hash !~ '^[0-9a-f]{64}$'
     or (target_normalized_email is not null and (target_normalized_email<>public.normalize_contact_email(target_normalized_email)
       or not public.is_valid_contact_email(target_normalized_email)))
     or (target_normalized_phone is not null and (target_normalized_phone<>public.normalize_contact_phone(target_normalized_phone)
       or not public.is_valid_contact_phone(target_normalized_phone))) then
    raise exception 'invalid Meta normalized identity evidence' using errcode='22023'; end if;
  select job.* into target_job from public.meta_normalization_jobs job where job.id=target_job_id for update;
  if not found then raise exception 'Meta normalization job not found' using errcode='P0002'; end if;
  if target_job.state='succeeded' and target_job.fencing_token=target_fencing_token then
    select event.* into strict target_event from public.meta_inbound_events event where event.id=target_job.event_id;
    return jsonb_build_object('job',to_jsonb(target_job),'event',to_jsonb(target_event),'outcome',target_event.state,'noOp',true);
  end if;
  if target_job.state<>'executing' or target_job.lease_owner<>target_worker_id
     or target_job.fencing_token<>target_fencing_token or target_job.lease_expires_at<=target_occurred_at then
    raise exception 'stale Meta normalization lease' using errcode='40001'; end if;
  select event.* into strict target_event from public.meta_inbound_events event where event.id=target_job.event_id for update;
  select identity.* into strict target_identity from public.meta_external_identities identity
  where identity.id=target_event.external_identity_id for update;
  select conversation.* into strict target_conversation from public.meta_conversations conversation
  where conversation.id=target_event.conversation_id for update;
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_job.connection_id and authority.enabled and authority.readiness_state in ('active','degraded');
  if target_identity.contact_id is not null then
    select contact.* into target_contact from public.contacts contact
    where contact.id=target_identity.contact_id and contact.workspace_id=target_job.workspace_id;
    if target_contact.archived_at is not null then target_review_reason:='linked_contact_archived'; end if;
  else
    select array_agg(distinct point.contact_id order by point.contact_id),
      array_agg(distinct point.contact_id order by point.contact_id) filter(where contact.archived_at is null),
      count(distinct point.contact_id) filter(where contact.archived_at is not null)
      into matched_ids,active_ids,archived_count
    from public.contact_points point join public.contacts contact
      on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
    where point.workspace_id=target_job.workspace_id and point.archived_at is null
      and ((target_normalized_email is not null and point.type='email' and point.normalized_value=target_normalized_email)
        or (target_normalized_phone is not null and point.type='phone' and point.normalized_value=target_normalized_phone));
    if cardinality(active_ids)=1 and coalesce(cardinality(matched_ids),0)=1 then
      select contact.* into strict target_contact from public.contacts contact where contact.id=active_ids[1];
    elsif coalesce(cardinality(matched_ids),0)=0 then target_review_reason:='no_canonical_match';
    elsif coalesce(archived_count,0)>0 and coalesce(cardinality(active_ids),0)=0 then target_review_reason:='archived_match';
    else target_review_reason:='ambiguous_or_conflicting_match'; end if;
  end if;
  if target_review_reason is null and target_contact.id is not null then
    update public.meta_external_identities set contact_id=target_contact.id,linked_at=target_occurred_at,
      linked_by_membership_id=null,updated_at=target_occurred_at where id=target_identity.id returning * into target_identity;
    update public.meta_conversations set contact_id=target_contact.id,updated_at=target_occurred_at
      where id=target_conversation.id returning * into target_conversation;
    insert into public.activity_events(
      workspace_id,type,contact_id,actor_membership_id,occurred_at,idempotency_key
    ) values (
      target_job.workspace_id,'contact-updated',target_contact.id,target_authority.created_by_membership_id,
      target_occurred_at,'meta-enquiry:'||target_event.event_key_hash
    ) on conflict(workspace_id,idempotency_key) do nothing returning * into target_activity;
    if target_activity.id is null then
      select activity.* into strict target_activity
      from public.activity_events activity
      where activity.workspace_id=target_job.workspace_id
        and activity.idempotency_key='meta-enquiry:'||target_event.event_key_hash;
    end if;
    update public.meta_inbound_events set state='linked',activity_event_id=target_activity.id,
      normalized_at=target_occurred_at,updated_at=target_occurred_at where id=target_event.id returning * into target_event;
    outcome:='linked';
  else
    insert into public.incomplete_records(
      workspace_id,source,external_id,candidate,validation_reasons,status,intake_idempotency_key,
      intake_request_hash,created_at,updated_at
    ) values (
      target_job.workspace_id,'meta-business-message',target_event.event_key_hash,'{}'::jsonb,
      jsonb_build_array(jsonb_build_object('field','identity','code',target_review_reason,
        'message','Verified Meta business message requires human identity review')),
      'pending','meta-enquiry:'||target_event.event_key_hash,target_identity_evidence_hash,
      target_occurred_at,target_occurred_at
    ) on conflict(workspace_id,intake_idempotency_key) where intake_idempotency_key is not null
      do update set updated_at=excluded.updated_at returning * into target_incomplete;
    insert into public.activity_events(
      workspace_id,type,incomplete_record_id,actor_membership_id,occurred_at,idempotency_key
    ) values (
      target_job.workspace_id,'incomplete-record-received',target_incomplete.id,
      target_authority.created_by_membership_id,target_occurred_at,'meta-review:'||target_event.event_key_hash
    ) on conflict(workspace_id,idempotency_key) do nothing returning * into target_activity;
    if target_activity.id is null then
      select activity.* into strict target_activity
      from public.activity_events activity
      where activity.workspace_id=target_job.workspace_id
        and activity.idempotency_key='meta-review:'||target_event.event_key_hash;
    end if;
    update public.meta_inbound_events set state='review',review_reason=target_review_reason,
      incomplete_record_id=target_incomplete.id,activity_event_id=target_activity.id,
      normalized_at=target_occurred_at,updated_at=target_occurred_at
    where id=target_event.id returning * into target_event;
    outcome:='review';
  end if;
  update public.meta_normalization_jobs set state='succeeded',lease_owner=null,lease_expires_at=null,
    completed_at=target_occurred_at,updated_at=target_occurred_at where id=target_job.id returning * into target_job;
  insert into public.connector_receipt_events(
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,provider_request_hash,
    redacted_metadata,occurred_at
  ) values (
    target_job.workspace_id,target_job.connection_id,'meta',case when outcome='linked' then 'sync.applied'::public.connector_receipt_event_type
      else 'sync.reviewed'::public.connector_receipt_event_type end,
    'meta.normalized:'||target_event.event_key_hash,target_event.correlation_id,target_identity_evidence_hash,
    jsonb_build_object('eventId',target_event.id,'assetBindingId',target_event.asset_binding_id,
      'senderKeyHash',target_identity.sender_key_hash,'outcome',outcome,'reviewReason',target_review_reason,
      'inboundOnly',true),target_occurred_at
  ) on conflict(workspace_id,event_key) do nothing returning * into target_receipt;
  if target_receipt.id is null then
    select receipt.* into strict target_receipt
    from public.connector_receipt_events receipt
    where receipt.workspace_id=target_job.workspace_id
      and receipt.event_key='meta.normalized:'||target_event.event_key_hash;
  end if;
  return jsonb_build_object('job',to_jsonb(target_job),'event',to_jsonb(target_event),
    'conversation',to_jsonb(target_conversation),'externalIdentity',to_jsonb(target_identity),
    'contact',case when target_contact.id is null then null else to_jsonb(target_contact) end,
    'reviewRecord',case when target_incomplete.id is null then null else to_jsonb(target_incomplete) end,
    'activity',to_jsonb(target_activity),'receipt',to_jsonb(target_receipt),'outcome',outcome,'noOp',false);
end;
$$;

create or replace function public.transition_meta_normalization_job(
  target_job_id uuid,target_worker_id uuid,target_fencing_token bigint,target_outcome text,
  target_error_category text,target_next_attempt_at timestamptz,target_now timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_job public.meta_normalization_jobs%rowtype; next_state public.meta_normalization_job_state;
begin
  if target_outcome not in ('retry','failed') or target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$' then
    raise exception 'invalid Meta normalization transition' using errcode='22023'; end if;
  select job.* into target_job from public.meta_normalization_jobs job where job.id=target_job_id for update;
  if not found then raise exception 'Meta normalization job not found' using errcode='P0002'; end if;
  if target_job.state<>'executing' or target_job.lease_owner<>target_worker_id
     or target_job.fencing_token<>target_fencing_token or target_job.lease_expires_at<=target_now then
    raise exception 'stale Meta normalization lease' using errcode='40001'; end if;
  if target_outcome='retry' and target_job.attempt_count<target_job.max_attempts then
    if target_next_attempt_at is null or target_next_attempt_at<=target_now then
      raise exception 'future Meta retry schedule required' using errcode='23514'; end if;
    next_state:='retry_wait';
  else next_state:='failed'; end if;
  update public.meta_normalization_jobs set state=next_state,
    scheduled_at=case when next_state='retry_wait' then target_next_attempt_at else scheduled_at end,
    lease_owner=null,lease_expires_at=null,last_error_category=target_error_category,
    completed_at=case when next_state='failed' then target_now else null end,updated_at=target_now
  where id=target_job.id returning * into target_job;
  -- Exhaustion is an operational failure, not an identity-review result.  The
  -- event remains accepted so it cannot violate the review quarantine invariant
  -- (review rows require an incomplete_record_id) or misstate human triage.
  update public.meta_inbound_events set state='accepted',review_reason=null,
    updated_at=target_now where id=target_job.event_id;
  return jsonb_build_object('job',to_jsonb(target_job),'noOp',false);
end;
$$;

create or replace function public.resolve_meta_enquiry_review(
  target_event_id uuid,target_contact_id uuid,target_actor_membership_id uuid,
  target_idempotency_key text,target_correlation_id uuid,target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.workspace_members%rowtype; target_event public.meta_inbound_events%rowtype;
 target_contact public.contacts%rowtype; target_identity public.meta_external_identities%rowtype;
 target_conversation public.meta_conversations%rowtype; converted jsonb;
begin
  select event.* into target_event from public.meta_inbound_events event where event.id=target_event_id for update;
  if not found then raise exception 'Meta review event not found' using errcode='P0002'; end if;
  actor:=public.connector_current_membership(target_event.workspace_id,false);
  if actor.id<>target_actor_membership_id then raise exception 'Meta review actor binding failed' using errcode='42501'; end if;
  select contact.* into target_contact from public.contacts contact
  where contact.id=target_contact_id and contact.workspace_id=target_event.workspace_id and contact.archived_at is null;
  if not found then raise exception 'active review contact required' using errcode='P0002'; end if;
  if target_event.state='linked' then
    select identity.* into strict target_identity from public.meta_external_identities identity where identity.id=target_event.external_identity_id;
    if target_identity.contact_id<>target_contact_id then raise exception 'Meta review replay conflicts' using errcode='23505'; end if;
    return jsonb_build_object('event',to_jsonb(target_event),'externalIdentity',to_jsonb(target_identity),'noOp',true);
  end if;
  if target_event.state<>'review' or target_event.incomplete_record_id is null then
    raise exception 'pending Meta review required' using errcode='23514'; end if;
  converted:=public.convert_incomplete_record(target_event.incomplete_record_id,'{}'::jsonb,
    jsonb_build_object('action','unchanged','matchedContactId',target_contact.id),target_idempotency_key,
    actor.id,target_occurred_at);
  select identity.* into strict target_identity from public.meta_external_identities identity
  where identity.id=target_event.external_identity_id for update;
  if target_identity.contact_id is not null and target_identity.contact_id<>target_contact.id then
    raise exception 'Meta sender identity already links another contact' using errcode='23505'; end if;
  update public.meta_external_identities set contact_id=target_contact.id,linked_by_membership_id=actor.id,
    linked_at=target_occurred_at,updated_at=target_occurred_at where id=target_identity.id returning * into target_identity;
  update public.meta_conversations set contact_id=target_contact.id,updated_at=target_occurred_at
    where id=target_event.conversation_id returning * into target_conversation;
  update public.meta_inbound_events set state='linked',review_reason=null,normalized_at=target_occurred_at,
    correlation_id=target_correlation_id,updated_at=target_occurred_at where id=target_event.id returning * into target_event;
  return jsonb_build_object('event',to_jsonb(target_event),'externalIdentity',to_jsonb(target_identity),
    'conversation',to_jsonb(target_conversation),'conversion',converted,'noOp',false);
end;
$$;

create or replace function public.read_meta_connection_state(target_connection_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_connection public.connector_connections%rowtype; target_authority public.meta_connection_authorities%rowtype;
 assets jsonb; review_count integer; queued_count integer;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.provider='meta';
  if not found or not public.has_workspace_access(target_connection.workspace_id) then
    raise exception 'Meta connection not found or unauthorized' using errcode='42501'; end if;
  select authority.* into strict target_authority from public.meta_connection_authorities authority
  where authority.connection_id=target_connection.id;
  select coalesce(jsonb_agg(to_jsonb(binding) order by binding.state,binding.channel,binding.display_label),'[]'::jsonb)
    into assets from public.meta_asset_bindings binding where binding.connection_id=target_connection.id;
  select count(*) into review_count from public.meta_inbound_events event
    where event.connection_id=target_connection.id and event.state='review';
  select count(*) into queued_count from public.meta_normalization_jobs job
    where job.connection_id=target_connection.id and job.state in ('queued','leased','executing','retry_wait');
  return jsonb_build_object('connection',to_jsonb(target_connection),'authority',to_jsonb(target_authority),
    'assets',assets,'reviewBacklog',review_count,'normalizationBacklog',queued_count,
    'inboundOnly',true,'leadAdsSupported',false,'outboundMessagingSupported',false,
    'reconciliationSupported',false);
end;
$$;

create or replace function public.purge_expired_meta_content(target_now timestamptz,target_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; refs jsonb:='[]'::jsonb; purged integer:=0;
begin
  if target_limit not between 1 and 500 then raise exception 'invalid Meta retention batch' using errcode='22023'; end if;
  for candidate in select event.id,event.content_payload_ref from public.meta_inbound_events event
    join public.meta_connection_authorities authority on authority.connection_id=event.connection_id
    where event.content_payload_ref is not null and event.received_at+make_interval(days=>authority.retention_days)<=target_now
      and event.state<>'content_purged' order by event.received_at,event.id for update of event skip locked limit target_limit
  loop
    update connector_private.connector_payload_envelopes set ciphertext=null,nonce=null,auth_tag=null,
      wrapped_dek=null,wrap_nonce=null,wrap_auth_tag=null,destroyed_at=target_now,updated_at=target_now
    where id=candidate.content_payload_ref and destroyed_at is null;
    update public.meta_inbound_events set state='content_purged',updated_at=target_now where id=candidate.id;
    purged:=purged+1; refs:=refs||jsonb_build_array(candidate.content_payload_ref);
  end loop;
  return jsonb_build_object('count',purged,'payloadRefs',refs);
end;
$$;

create or replace function public.sync_meta_authority_on_connection_state()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='meta' and new.status is distinct from old.status then
    if new.status in ('revoking','disconnected','disconnected_unconfirmed') then
      update public.meta_connection_authorities set enabled=false,
        readiness_state=case when new.status='revoking' then 'reauthorization_required'::public.meta_readiness_state
          else 'disconnected'::public.meta_readiness_state end,updated_at=new.updated_at where connection_id=new.id;
      update public.meta_normalization_jobs set state='cancelled',lease_owner=null,lease_expires_at=null,
        completed_at=new.updated_at,last_error_category='connection_disabled',updated_at=new.updated_at
      where connection_id=new.id and state in ('queued','leased','retry_wait');
      if new.status in ('disconnected','disconnected_unconfirmed') then
        update connector_private.meta_webhook_authorities set revoked_at=coalesce(revoked_at,new.updated_at),
          updated_at=new.updated_at where connection_id=new.id;
        update public.meta_asset_bindings set state='removed',removed_at=coalesce(removed_at,new.updated_at),
          updated_at=new.updated_at where connection_id=new.id and state<>'removed';
      end if;
    elsif new.status='reauthorization_required' then
      update public.meta_connection_authorities set enabled=false,readiness_state='reauthorization_required',
        updated_at=new.updated_at where connection_id=new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger connector_connections_sync_meta_authority
  after update of status on public.connector_connections
  for each row execute function public.sync_meta_authority_on_connection_state();

-- Function grants -----------------------------------------------------------

revoke all on function public.begin_meta_oauth(uuid,uuid,public.meta_login_mode,text,text,text,timestamptz,text[],uuid,text,text,text,text,jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.consume_meta_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.finalize_meta_oauth(uuid,uuid,uuid,uuid,text,text[],boolean,text,boolean,text,integer,jsonb,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_meta_asset_discovery_authority(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.replace_meta_eligible_assets(uuid,text,text,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.select_meta_assets(uuid,text,text[],integer,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.bind_meta_webhook_authority(uuid,text,integer,jsonb,integer,jsonb,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_meta_webhook_authority(text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.confirm_meta_webhook_challenge(text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.register_meta_webhook_delivery_encrypted(text,text,text,text,boolean,jsonb,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_meta_normalization_jobs(uuid,integer,integer,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.start_meta_normalization_attempt(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_meta_normalization_authority(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.apply_meta_normalized_enquiry(uuid,uuid,bigint,text,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.transition_meta_normalization_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_meta_connection_state(uuid) from public,anon,authenticated,service_role;
revoke all on function public.purge_expired_meta_content(timestamptz,integer) from public,anon,authenticated,service_role;
revoke all on function public.sync_meta_authority_on_connection_state() from public,anon,authenticated,service_role;

grant execute on function public.begin_meta_oauth(uuid,uuid,public.meta_login_mode,text,text,text,timestamptz,text[],uuid,text,text,text,text,jsonb,timestamptz,timestamptz) to authenticated;
grant execute on function public.select_meta_assets(uuid,text,text[],integer,text,uuid,timestamptz) to authenticated;
grant execute on function public.resolve_meta_enquiry_review(uuid,uuid,uuid,text,uuid,timestamptz) to authenticated;
grant execute on function public.read_meta_connection_state(uuid) to authenticated;

grant execute on function public.consume_meta_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.finalize_meta_oauth(uuid,uuid,uuid,uuid,text,text[],boolean,text,boolean,text,integer,jsonb,uuid,timestamptz) to service_role;
grant execute on function public.read_meta_asset_discovery_authority(uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.replace_meta_eligible_assets(uuid,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.bind_meta_webhook_authority(uuid,text,integer,jsonb,integer,jsonb,text,uuid,timestamptz) to service_role;
grant execute on function public.read_meta_webhook_authority(text,timestamptz) to service_role;
grant execute on function public.confirm_meta_webhook_challenge(text,text,timestamptz) to service_role;
grant execute on function public.register_meta_webhook_delivery_encrypted(text,text,text,text,boolean,jsonb,timestamptz,uuid) to service_role;
grant execute on function public.claim_meta_normalization_jobs(uuid,integer,integer,timestamptz) to service_role;
grant execute on function public.start_meta_normalization_attempt(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.read_meta_normalization_authority(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.apply_meta_normalized_enquiry(uuid,uuid,bigint,text,text,text,timestamptz) to service_role;
grant execute on function public.transition_meta_normalization_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.purge_expired_meta_content(timestamptz,integer) to service_role;

comment on table public.meta_connection_authorities is
  'Story 4.4 redacted Meta version, scope, external review and inbound-only readiness authority; no version default exists.';
comment on function public.register_meta_webhook_delivery_encrypted(text,text,text,text,boolean,jsonb,timestamptz,uuid) is
  'Service-only post-verification atomic ingress; invalid signature/version/asset aborts with zero payload/job mutation.';
comment on function public.read_meta_connection_state(uuid) is
  'Member-redacted Meta state; explicitly declares inbound-only, no Lead Ads/outbound and no invented reconciliation API.';

commit;
