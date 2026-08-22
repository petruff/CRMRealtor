-- Omnix — Mailchimp selected-audience and subscription authority
-- Story 4.1 T1: workspace-scoped redacted audience/member metadata, atomic
-- OAuth seams, canonical unsubscribe enforcement, loop evidence and private
-- selected-audience checkpoints. Provider HTTP operations remain outside SQL.
--
-- Forward-only. PostgreSQL enum labels cannot be removed safely; receipt
-- labels are committed before the transactional schema phase. See rollback.

alter type public.connector_receipt_event_type add value if not exists 'oauth.started';
alter type public.connector_receipt_event_type add value if not exists 'oauth.completed';
alter type public.connector_receipt_event_type add value if not exists 'audience.selected';
alter type public.connector_receipt_event_type add value if not exists 'audience.replaced';
alter type public.connector_receipt_event_type add value if not exists 'sync.applied';
alter type public.connector_receipt_event_type add value if not exists 'sync.reviewed';

begin;

create table public.mailchimp_audience_bindings (
  id                          uuid primary key default gen_random_uuid(),
  workspace_id                uuid not null references public.workspaces (id) on delete restrict,
  connection_id               uuid not null,
  account_id_hash             text not null,
  data_center                 text not null,
  audience_external_id        text not null,
  audience_name               text not null,
  mapping_version             integer not null default 1,
  baseline_required           boolean not null default true,
  webhook_registration_required boolean not null default true,
  selected_by_membership_id   uuid not null,
  selection_correlation_id    uuid not null,
  selected_at                 timestamptz not null,
  replaced_at                 timestamptz,
  replaced_by_membership_id   uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint mailchimp_audience_bindings_id_workspace_unique unique (id, workspace_id),
  constraint mailchimp_audience_bindings_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_audience_bindings_selector_workspace_fk
    foreign key (selected_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint mailchimp_audience_bindings_replacer_workspace_fk
    foreign key (replaced_by_membership_id, workspace_id)
    references public.workspace_members (id, workspace_id) on delete restrict,
  constraint mailchimp_audience_bindings_account_hash check (account_id_hash ~ '^[0-9a-f]{64}$'),
  constraint mailchimp_audience_bindings_data_center check (data_center ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(data_center) <= 32),
  constraint mailchimp_audience_bindings_external_id check (
    length(btrim(audience_external_id)) between 1 and 128
    and audience_external_id !~ '[@[:cntrl:]]'
  ),
  constraint mailchimp_audience_bindings_name check (
    length(btrim(audience_name)) between 1 and 160 and audience_name !~ '[[:cntrl:]]'
  ),
  constraint mailchimp_audience_bindings_mapping_version check (mapping_version > 0),
  constraint mailchimp_audience_bindings_replacement check (
    (replaced_at is null and replaced_by_membership_id is null)
    or (replaced_at is not null and replaced_by_membership_id is not null and replaced_at >= selected_at)
  )
);

create unique index mailchimp_one_selected_audience_per_connection_idx
  on public.mailchimp_audience_bindings (connection_id)
  where replaced_at is null;
create index mailchimp_audience_bindings_workspace_selected_idx
  on public.mailchimp_audience_bindings (workspace_id, selected_at desc, id);

alter table public.contact_points
  add constraint contact_points_id_workspace_contact_unique
  unique (id, workspace_id, contact_id);

create table public.mailchimp_member_links (
  id                         uuid primary key default gen_random_uuid(),
  workspace_id               uuid not null references public.workspaces (id) on delete restrict,
  connection_id              uuid not null,
  binding_id                 uuid not null,
  contact_id                 uuid not null,
  contact_point_id           uuid not null,
  subscriber_hash            text not null,
  member_external_id         text not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint mailchimp_member_links_id_workspace_unique unique (id, workspace_id),
  constraint mailchimp_member_links_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_member_links_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_member_links_contact_point_workspace_fk
    foreign key (contact_point_id, workspace_id, contact_id)
    references public.contact_points (id, workspace_id, contact_id) on delete restrict,
  constraint mailchimp_member_links_binding_subscriber_unique unique (binding_id, subscriber_hash),
  constraint mailchimp_member_links_binding_member_unique unique (binding_id, member_external_id),
  constraint mailchimp_member_links_subscriber_hash check (subscriber_hash ~ '^[0-9a-f]{32}$'),
  constraint mailchimp_member_links_external_id check (
    length(btrim(member_external_id)) between 1 and 128
    and member_external_id !~ '[@[:cntrl:]]'
  )
);

create index mailchimp_member_links_workspace_contact_idx
  on public.mailchimp_member_links (workspace_id, contact_id, binding_id);

create table public.mailchimp_subscription_authority (
  id                            uuid primary key default gen_random_uuid(),
  workspace_id                  uuid not null references public.workspaces (id) on delete restrict,
  connection_id                 uuid not null,
  binding_id                    uuid not null,
  member_link_id                uuid not null,
  provider_status               text not null,
  provider_unsubscribed_at      timestamptz,
  resubscribe_requires_consent  boolean not null default false,
  last_provider_event_id_hash   text not null,
  last_occurred_at              timestamptz not null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint mailchimp_subscription_authority_id_workspace_unique unique (id, workspace_id),
  constraint mailchimp_subscription_authority_member_unique unique (member_link_id),
  constraint mailchimp_subscription_authority_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_subscription_authority_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_subscription_authority_member_workspace_fk
    foreign key (member_link_id, workspace_id)
    references public.mailchimp_member_links (id, workspace_id) on delete restrict,
  constraint mailchimp_subscription_authority_status check (
    provider_status in ('subscribed','unsubscribed','pending','cleaned','transactional','archived')
  ),
  constraint mailchimp_subscription_authority_event_hash check (
    last_provider_event_id_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint mailchimp_subscription_authority_unsubscribe check (
    (provider_status in ('unsubscribed','cleaned')
      and provider_unsubscribed_at is not null and resubscribe_requires_consent)
    or provider_status not in ('unsubscribed','cleaned')
  )
);

create table public.mailchimp_sync_evidence (
  id                        uuid primary key default gen_random_uuid(),
  workspace_id              uuid not null references public.workspaces (id) on delete restrict,
  connection_id             uuid not null,
  binding_id                uuid not null,
  member_link_id            uuid,
  contact_point_id          uuid,
  origin                    text not null,
  source_key_hash           text not null,
  provider_event_id_hash    text,
  source_job_id             uuid,
  correlation_id            uuid not null,
  outcome                   text not null,
  requested_status          text,
  applied_email_subscribed  boolean,
  occurred_at               timestamptz not null,
  created_at                timestamptz not null default now(),

  constraint mailchimp_sync_evidence_id_workspace_unique unique (id, workspace_id),
  constraint mailchimp_sync_evidence_origin_source_unique unique (connection_id, origin, source_key_hash),
  constraint mailchimp_sync_evidence_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_sync_evidence_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_sync_evidence_member_workspace_fk
    foreign key (member_link_id, workspace_id)
    references public.mailchimp_member_links (id, workspace_id) on delete restrict,
  constraint mailchimp_sync_evidence_point_workspace_fk
    foreign key (contact_point_id, workspace_id)
    references public.contact_points (id, workspace_id) on delete restrict,
  constraint mailchimp_sync_evidence_job_workspace_fk
    foreign key (source_job_id, workspace_id)
    references public.connector_jobs (id, workspace_id) on delete restrict,
  constraint mailchimp_sync_evidence_origin check (
    origin in ('mailchimp-webhook','outbound-job','reconciliation')
  ),
  constraint mailchimp_sync_evidence_hashes check (
    source_key_hash ~ '^[0-9a-f]{64}$'
    and (provider_event_id_hash is null or provider_event_id_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint mailchimp_sync_evidence_outcome check (
    outcome in ('applied','no-op','review','echo-suppressed','blocked-unsubscribe-authority')
  ),
  constraint mailchimp_sync_evidence_status check (
    requested_status is null or requested_status in ('subscribed','unsubscribed','pending','cleaned','transactional','archived')
  )
);

create index mailchimp_sync_evidence_workspace_occurred_idx
  on public.mailchimp_sync_evidence (workspace_id, occurred_at desc, id);
create index mailchimp_sync_evidence_member_occurred_idx
  on public.mailchimp_sync_evidence (member_link_id, occurred_at desc)
  where member_link_id is not null;

create table public.mailchimp_webhook_jobs (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete restrict,
  connection_id         uuid not null,
  binding_id            uuid not null,
  delivery_id           uuid not null,
  payload_ref           uuid not null,
  payload_hash          text not null,
  state                 text not null default 'queued',
  attempt_count         integer not null default 0,
  max_attempts          integer not null default 5,
  scheduled_at          timestamptz not null,
  lease_owner           uuid,
  lease_expires_at      timestamptz,
  fencing_token         bigint not null default 0,
  last_error_category   text,
  correlation_id        uuid not null,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint mailchimp_webhook_jobs_id_workspace_unique unique (id, workspace_id),
  constraint mailchimp_webhook_jobs_delivery_unique unique (delivery_id),
  constraint mailchimp_webhook_jobs_connection_workspace_fk
    foreign key (connection_id, workspace_id)
    references public.connector_connections (id, workspace_id) on delete restrict,
  constraint mailchimp_webhook_jobs_binding_workspace_fk
    foreign key (binding_id, workspace_id)
    references public.mailchimp_audience_bindings (id, workspace_id) on delete restrict,
  constraint mailchimp_webhook_jobs_delivery_workspace_fk
    foreign key (delivery_id, workspace_id)
    references public.connector_webhook_deliveries (id, workspace_id) on delete restrict,
  constraint mailchimp_webhook_jobs_payload_workspace_fk
    foreign key (payload_ref, workspace_id)
    references connector_private.connector_payload_envelopes (id, workspace_id) on delete restrict,
  constraint mailchimp_webhook_jobs_payload_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint mailchimp_webhook_jobs_state check (
    state in ('queued','leased','executing','retry_wait','succeeded','review')
  ),
  constraint mailchimp_webhook_jobs_attempts check (
    attempt_count between 0 and max_attempts and max_attempts between 1 and 20
  ),
  constraint mailchimp_webhook_jobs_fence check (fencing_token >= 0),
  constraint mailchimp_webhook_jobs_error check (
    last_error_category is null or last_error_category ~ '^[a-z][a-z0-9_.-]{1,79}$'
  ),
  constraint mailchimp_webhook_jobs_lease check (
    (state in ('leased','executing') and lease_owner is not null and lease_expires_at is not null)
    or (state not in ('leased','executing') and lease_owner is null and lease_expires_at is null)
  ),
  constraint mailchimp_webhook_jobs_terminal check (
    (state in ('succeeded','review') and completed_at is not null)
    or (state not in ('succeeded','review') and completed_at is null)
  )
);

create index mailchimp_webhook_jobs_due_idx
  on public.mailchimp_webhook_jobs (scheduled_at,created_at,id)
  where state in ('queued','retry_wait');
create index mailchimp_webhook_jobs_workspace_state_idx
  on public.mailchimp_webhook_jobs (workspace_id,state,scheduled_at);
create index mailchimp_webhook_jobs_expired_lease_idx
  on public.mailchimp_webhook_jobs (lease_expires_at,id)
  where lease_owner is not null;

-- Mutation guards --------------------------------------------------------

create or replace function public.prepare_mailchimp_audience_binding_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.connection_id <> old.connection_id or new.account_id_hash <> old.account_id_hash
     or new.data_center <> old.data_center or new.audience_external_id <> old.audience_external_id
     or new.audience_name <> old.audience_name or new.mapping_version <> old.mapping_version
     or new.selected_by_membership_id <> old.selected_by_membership_id
     or new.selection_correlation_id <> old.selection_correlation_id
     or new.selected_at <> old.selected_at or new.created_at <> old.created_at then
    raise exception 'Mailchimp audience binding identity is immutable' using errcode = '55000';
  end if;
  if new.replaced_at is distinct from old.replaced_at
     or new.replaced_by_membership_id is distinct from old.replaced_by_membership_id then
    if old.replaced_at is not null
       or new.replaced_at is null or new.replaced_by_membership_id is null then
      raise exception 'Mailchimp audience replacement is append-only' using errcode = '55000';
    end if;
  elsif (old.baseline_required and not new.baseline_required)
     or (old.webhook_registration_required and not new.webhook_registration_required) then
    if (not old.baseline_required and new.baseline_required)
       or (not old.webhook_registration_required and new.webhook_registration_required)
       or (new.baseline_required and new.webhook_registration_required) then
      raise exception 'Mailchimp audience readiness update made no progress' using errcode = '55000';
    end if;
  else
    raise exception 'Mailchimp audience readiness and history are append-only' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_mailchimp_webhook_job_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id<>old.id or new.workspace_id<>old.workspace_id
     or new.connection_id<>old.connection_id or new.binding_id<>old.binding_id
     or new.delivery_id<>old.delivery_id or new.payload_ref<>old.payload_ref
     or new.payload_hash<>old.payload_hash or new.max_attempts<>old.max_attempts
     or new.correlation_id<>old.correlation_id or new.created_at<>old.created_at
     or new.fencing_token<old.fencing_token or new.attempt_count<old.attempt_count then
    raise exception 'Mailchimp webhook job authority is immutable' using errcode='55000';
  end if;
  if new.state<>old.state and not (
    (old.state in ('queued','retry_wait') and new.state='leased')
    or (old.state='leased' and new.state in ('executing','retry_wait','review'))
    or (old.state='executing' and new.state in ('succeeded','retry_wait','review'))
    or (old.state in ('queued','retry_wait') and new.state='review')
  ) then
    raise exception 'invalid Mailchimp webhook job transition: % -> %',old.state,new.state
      using errcode='23514';
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

create trigger mailchimp_webhook_jobs_prepare_update
before update on public.mailchimp_webhook_jobs
for each row execute function public.prepare_mailchimp_webhook_job_update();

create or replace function public.prepare_mailchimp_member_link_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.connection_id <> old.connection_id or new.binding_id <> old.binding_id
     or new.contact_id <> old.contact_id or new.contact_point_id <> old.contact_point_id
     or new.subscriber_hash <> old.subscriber_hash or new.member_external_id <> old.member_external_id
     or new.created_at <> old.created_at then
    raise exception 'Mailchimp member link identity is immutable' using errcode = '55000';
  end if;
  new.updated_at := now(); return new;
end;
$$;

create or replace function public.prepare_mailchimp_subscription_authority_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.workspace_id <> old.workspace_id
     or new.connection_id <> old.connection_id or new.binding_id <> old.binding_id
     or new.member_link_id <> old.member_link_id or new.created_at <> old.created_at then
    raise exception 'Mailchimp subscription authority binding is immutable' using errcode = '55000';
  end if;
  if old.resubscribe_requires_consent and not new.resubscribe_requires_consent
     and coalesce(current_setting('omnix.mailchimp_explicit_resubscribe', true), '') <> 'on' then
    raise exception 'Mailchimp unsubscribe authority requires explicit governed consent'
      using errcode = '42501';
  end if;
  new.updated_at := now(); return new;
end;
$$;

revoke all on function public.prepare_mailchimp_audience_binding_update() from public,anon,authenticated,service_role;
revoke all on function public.prepare_mailchimp_member_link_update() from public,anon,authenticated,service_role;
revoke all on function public.prepare_mailchimp_subscription_authority_update() from public,anon,authenticated,service_role;
revoke all on function public.prepare_mailchimp_webhook_job_update() from public,anon,authenticated,service_role;

create trigger mailchimp_audience_bindings_prepare_update before update on public.mailchimp_audience_bindings
  for each row execute function public.prepare_mailchimp_audience_binding_update();
create trigger mailchimp_audience_bindings_guard_delete before delete on public.mailchimp_audience_bindings
  for each row execute function public.guard_connector_append_only();
create trigger mailchimp_member_links_prepare_update before update on public.mailchimp_member_links
  for each row execute function public.prepare_mailchimp_member_link_update();
create trigger mailchimp_member_links_guard_delete before delete on public.mailchimp_member_links
  for each row execute function public.guard_connector_append_only();
create trigger mailchimp_subscription_authority_prepare_update before update on public.mailchimp_subscription_authority
  for each row execute function public.prepare_mailchimp_subscription_authority_update();
create trigger mailchimp_subscription_authority_guard_delete before delete on public.mailchimp_subscription_authority
  for each row execute function public.guard_connector_append_only();
create trigger mailchimp_sync_evidence_guard_mutation before update or delete on public.mailchimp_sync_evidence
  for each row execute function public.guard_connector_append_only();
create trigger mailchimp_webhook_jobs_guard_delete before delete on public.mailchimp_webhook_jobs
  for each row execute function public.guard_connector_append_only();

-- RLS and least privilege ------------------------------------------------

alter table public.mailchimp_audience_bindings enable row level security;
alter table public.mailchimp_audience_bindings force row level security;
alter table public.mailchimp_member_links enable row level security;
alter table public.mailchimp_member_links force row level security;
alter table public.mailchimp_subscription_authority enable row level security;
alter table public.mailchimp_subscription_authority force row level security;
alter table public.mailchimp_sync_evidence enable row level security;
alter table public.mailchimp_sync_evidence force row level security;
alter table public.mailchimp_webhook_jobs enable row level security;
alter table public.mailchimp_webhook_jobs force row level security;

create policy mailchimp_audience_bindings_member_select on public.mailchimp_audience_bindings
  for select to authenticated using (public.has_workspace_access(workspace_id));
create policy mailchimp_member_links_member_select on public.mailchimp_member_links
  for select to authenticated using (public.has_workspace_access(workspace_id));
create policy mailchimp_subscription_authority_member_select on public.mailchimp_subscription_authority
  for select to authenticated using (public.has_workspace_access(workspace_id));
create policy mailchimp_sync_evidence_member_select on public.mailchimp_sync_evidence
  for select to authenticated using (public.has_workspace_access(workspace_id));
create policy mailchimp_webhook_jobs_member_select on public.mailchimp_webhook_jobs
  for select to authenticated using (public.has_workspace_access(workspace_id));

revoke all on table public.mailchimp_audience_bindings from anon, authenticated, service_role;
revoke all on table public.mailchimp_member_links from anon, authenticated, service_role;
revoke all on table public.mailchimp_subscription_authority from anon, authenticated, service_role;
revoke all on table public.mailchimp_sync_evidence from anon, authenticated, service_role;
revoke all on table public.mailchimp_webhook_jobs from anon, authenticated, service_role;
grant select on table public.mailchimp_audience_bindings to authenticated, service_role;
grant select on table public.mailchimp_member_links to authenticated, service_role;
grant select on table public.mailchimp_subscription_authority to authenticated, service_role;
grant select on table public.mailchimp_sync_evidence to authenticated, service_role;
grant select on table public.mailchimp_webhook_jobs to authenticated, service_role;

-- Atomic Mailchimp OAuth seams ------------------------------------------

create or replace function public.begin_mailchimp_oauth(
  target_connection_id uuid,
  target_workspace_id uuid,
  target_display_label text,
  target_correlation_id uuid,
  target_state_hash text,
  target_requested_scope_bundle text,
  target_requested_scopes text[],
  target_session_binding_hash text,
  target_redirect_uri text,
  target_safe_return_path text,
  target_pkce_ciphertext bytea,
  target_pkce_nonce bytea,
  target_pkce_auth_tag bytea,
  target_pkce_wrapped_dek bytea,
  target_pkce_wrap_nonce bytea,
  target_pkce_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_expires_at timestamptz,
  target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  target_transaction connector_private.connector_oauth_transactions%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  no_op boolean := false;
begin
  actor := public.connector_current_membership(target_workspace_id, true);
  if target_connection_id is null or target_correlation_id is null
     or target_display_label is null or length(btrim(target_display_label)) not between 1 and 120
     or target_state_hash !~ '^[0-9a-f]{64}$'
     or target_session_binding_hash !~ '^[0-9a-f]{64}$'
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_requested_scope_bundle <> 'mailchimp.audience-sync.v1'
     or target_requested_scopes is distinct from array['audience.sync','audience.reconcile']::text[]
     or target_occurred_at is null or target_expires_at <= target_occurred_at
     or target_expires_at > target_occurred_at + interval '15 minutes' then
    raise exception 'invalid Mailchimp OAuth start request' using errcode = '22023';
  end if;

  select connection.* into target_connection
  from public.connector_connections connection where connection.id = target_connection_id
  for update;
  if found then
    select transaction_row.* into target_transaction
    from connector_private.connector_oauth_transactions transaction_row
    where transaction_row.connection_id = target_connection_id
      and transaction_row.state_hash = target_state_hash;
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id = target_workspace_id
      and receipt.event_key = 'oauth.started:' || target_connection_id::text;
    if target_connection.workspace_id <> target_workspace_id
       or target_connection.provider <> 'mailchimp'
       or target_transaction.id is null or target_receipt.id is null then
      raise exception 'Mailchimp OAuth connection ID replay conflicts' using errcode = '23505';
    end if;
    no_op := true;
  else
    insert into public.connector_connections (
      id, workspace_id, provider, display_label, status, granted_scopes,
      remote_identity_summary, created_by_membership_id
    ) values (
      target_connection_id, target_workspace_id, 'mailchimp', btrim(target_display_label),
      'authorizing', '{}', '{}'::jsonb, actor.id
    ) returning * into target_connection;

    insert into connector_private.connector_oauth_transactions (
      workspace_id, connection_id, provider, state_hash,
      requested_scope_bundle, requested_scopes, actor_user_id, membership_id,
      session_binding_hash, redirect_uri, safe_return_path,
      pkce_ciphertext, pkce_nonce, pkce_auth_tag, pkce_wrapped_dek,
      pkce_wrap_nonce, pkce_wrap_auth_tag, kek_version, aad_hash,
      expires_at, created_at
    ) values (
      target_workspace_id, target_connection_id, 'mailchimp', target_state_hash,
      target_requested_scope_bundle, target_requested_scopes, auth.uid(), actor.id,
      target_session_binding_hash, target_redirect_uri, target_safe_return_path,
      target_pkce_ciphertext, target_pkce_nonce, target_pkce_auth_tag,
      target_pkce_wrapped_dek, target_pkce_wrap_nonce, target_pkce_wrap_auth_tag,
      target_kek_version, target_aad_hash, target_expires_at, target_occurred_at
    ) returning * into target_transaction;

    insert into public.connector_receipt_events (
      workspace_id, connection_id, provider, event_type, event_key,
      correlation_id, redacted_metadata, occurred_at
    ) values (
      target_workspace_id, target_connection_id, 'mailchimp', 'oauth.started',
      'oauth.started:' || target_connection_id::text, target_correlation_id,
      jsonb_build_object('scopeBundle', target_requested_scope_bundle,
        'actorMembershipId', actor.id), target_occurred_at
    ) returning * into target_receipt;
  end if;

  return jsonb_build_object(
    'connection', to_jsonb(target_connection),
    'oauthTransaction', jsonb_build_object(
      'transactionId', target_transaction.id,
      'workspaceId', target_transaction.workspace_id,
      'connectionId', target_transaction.connection_id,
      'provider', target_transaction.provider,
      'requestedScopeBundle', target_transaction.requested_scope_bundle,
      'requestedScopes', target_transaction.requested_scopes,
      'safeReturnPath', target_transaction.safe_return_path,
      'expiresAt', target_transaction.expires_at,
      'consumedAt', target_transaction.consumed_at
    ),
    'receipt', to_jsonb(target_receipt), 'noOp', no_op
  );
end;
$$;

create or replace function public.finalize_mailchimp_oauth(
  target_connection_id uuid,
  target_provider_account_key_hash text,
  target_granted_scopes text[],
  target_remote_identity_summary jsonb,
  target_ciphertext bytea,
  target_nonce bytea,
  target_auth_tag bytea,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_occurred_at timestamptz,
  target_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_connection public.connector_connections%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
begin
  if target_provider_account_key_hash !~ '^[0-9a-f]{64}$'
     or target_granted_scopes is distinct from array['audience.sync','audience.reconcile']::text[]
     or target_remote_identity_summary is null
     or jsonb_typeof(target_remote_identity_summary) <> 'object'
     or not (target_remote_identity_summary - array['accountIdHash','accountName','dataCenter']) = '{}'::jsonb
     or target_remote_identity_summary->>'accountIdHash' <> target_provider_account_key_hash
     or target_remote_identity_summary->>'dataCenter' !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or length(coalesce(target_remote_identity_summary->>'accountName','')) not between 1 and 160
     or target_aad_hash !~ '^[0-9a-f]{64}$'
     or target_occurred_at is null or target_correlation_id is null then
    raise exception 'invalid Mailchimp OAuth completion request' using errcode = '22023';
  end if;

  select connection.* into target_connection from public.connector_connections connection
  where connection.id = target_connection_id for update;
  if not found or target_connection.provider <> 'mailchimp' then
    raise exception 'Mailchimp connection not found' using errcode = 'P0002';
  end if;

  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id = target_connection.workspace_id
    and receipt.event_key = 'oauth.completed:' || target_connection.id::text;
  if target_connection.status = 'active' and found then
    select secret.* into strict target_secret from connector_private.connector_connection_secrets secret
    where secret.connection_id = target_connection.id and secret.secret_type = 'mailchimp-access-token';
    return jsonb_build_object('connection',to_jsonb(target_connection),
      'receipt',to_jsonb(target_receipt),'secret',jsonb_build_object(
        'secretId',target_secret.id,'connectionId',target_secret.connection_id,
        'secretType',target_secret.secret_type,'secretVersion',target_secret.secret_version,
        'kekVersion',target_secret.kek_version,'destroyedAt',target_secret.destroyed_at),'noOp',true);
  end if;
  if target_connection.status <> 'authorizing' then
    raise exception 'Mailchimp connection is not authorizing' using errcode = '23514';
  end if;
  if not exists (
    select 1 from connector_private.connector_oauth_transactions transaction_row
    where transaction_row.connection_id = target_connection.id
      and transaction_row.workspace_id = target_connection.workspace_id
      and transaction_row.provider = 'mailchimp'
      and transaction_row.consumed_at is not null
  ) then
    raise exception 'consumed Mailchimp OAuth transaction required' using errcode = '42501';
  end if;

  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id = target_connection.id and secret.secret_type = 'mailchimp-access-token'
  for update;
  if found then
    update connector_private.connector_connection_secrets set
      secret_version=secret_version+1,ciphertext=target_ciphertext,nonce=target_nonce,
      auth_tag=target_auth_tag,wrapped_dek=target_wrapped_dek,wrap_nonce=target_wrap_nonce,
      wrap_auth_tag=target_wrap_auth_tag,kek_version=target_kek_version,
      aad_hash=target_aad_hash,refreshed_at=target_occurred_at,destroyed_at=null,
      updated_at=target_occurred_at
    where id=target_secret.id returning * into target_secret;
  else
    insert into connector_private.connector_connection_secrets (
      workspace_id,connection_id,secret_type,ciphertext,nonce,auth_tag,
      wrapped_dek,wrap_nonce,wrap_auth_tag,kek_version,aad_hash,refreshed_at
    ) values (
      target_connection.workspace_id,target_connection.id,'mailchimp-access-token',
      target_ciphertext,target_nonce,target_auth_tag,target_wrapped_dek,
      target_wrap_nonce,target_wrap_auth_tag,target_kek_version,target_aad_hash,target_occurred_at
    ) returning * into target_secret;
  end if;

  update public.connector_connections set status='active',
    provider_account_key_hash=target_provider_account_key_hash,
    granted_scopes=target_granted_scopes,
    remote_identity_summary=target_remote_identity_summary,
    last_probe_at=target_occurred_at,last_error_category=null
  where id=target_connection.id returning * into target_connection;

  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    redacted_metadata,occurred_at
  ) values (
    target_connection.workspace_id,target_connection.id,'mailchimp','oauth.completed',
    'oauth.completed:'||target_connection.id::text,target_correlation_id,
    jsonb_build_object('accountIdHash',target_provider_account_key_hash,
      'dataCenter',target_remote_identity_summary->>'dataCenter',
      'grantedScopes',target_granted_scopes),target_occurred_at
  ) returning * into target_receipt;

  return jsonb_build_object('connection',to_jsonb(target_connection),
    'receipt',to_jsonb(target_receipt),'secret',jsonb_build_object(
      'secretId',target_secret.id,'connectionId',target_secret.connection_id,
      'secretType',target_secret.secret_type,'secretVersion',target_secret.secret_version,
      'kekVersion',target_secret.kek_version,'destroyedAt',target_secret.destroyed_at),'noOp',false);
end;
$$;

-- Selected audience authority -------------------------------------------

create or replace function public.select_mailchimp_audience(
  target_connection_id uuid,
  target_account_id_hash text,
  target_data_center text,
  target_audience_external_id text,
  target_audience_name text,
  target_mapping_version integer,
  target_correlation_id uuid,
  target_selected_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.workspace_members%rowtype;
  target_connection public.connector_connections%rowtype;
  prior_binding public.mailchimp_audience_bindings%rowtype;
  selected_binding public.mailchimp_audience_bindings%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  receipt_type public.connector_receipt_event_type;
  invalidated_cursors integer := 0;
  invalidated_webhook_jobs integer := 0;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id for update;
  if not found or target_connection.provider<>'mailchimp' then
    raise exception 'Mailchimp connection not found' using errcode='P0002';
  end if;
  actor:=public.connector_current_membership(target_connection.workspace_id,true);
  if target_connection.status not in ('active','degraded')
     or target_account_id_hash is distinct from target_connection.provider_account_key_hash
     or target_data_center !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or target_audience_external_id is null or length(btrim(target_audience_external_id)) not between 1 and 128
     or target_audience_external_id ~ '[@[:cntrl:]]'
     or target_audience_name is null or length(btrim(target_audience_name)) not between 1 and 160
     or target_mapping_version < 1 or target_correlation_id is null or target_selected_at is null then
    raise exception 'invalid Mailchimp audience selection' using errcode='22023';
  end if;
  select binding.* into prior_binding from public.mailchimp_audience_bindings binding
  where binding.connection_id=target_connection.id and binding.replaced_at is null for update;
  if found and prior_binding.audience_external_id=target_audience_external_id
     and prior_binding.audience_name=btrim(target_audience_name)
     and prior_binding.mapping_version=target_mapping_version then
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=prior_binding.workspace_id
      and receipt.event_key='audience.selected:'||prior_binding.id::text;
    return jsonb_build_object('binding',to_jsonb(prior_binding),'replacedBinding',null,
      'receipt',to_jsonb(target_receipt),'invalidatedCursors',0,
      'invalidatedWebhookJobs',0,'noOp',true);
  end if;
  if prior_binding.id is not null then
    update public.mailchimp_audience_bindings set replaced_at=target_selected_at,
      replaced_by_membership_id=actor.id where id=prior_binding.id returning * into prior_binding;
    receipt_type:='audience.replaced';
  else receipt_type:='audience.selected'; end if;
  insert into public.mailchimp_audience_bindings (
    workspace_id,connection_id,account_id_hash,data_center,audience_external_id,
    audience_name,mapping_version,selected_by_membership_id,
    selection_correlation_id,selected_at
  ) values (
    target_connection.workspace_id,target_connection.id,target_account_id_hash,
    lower(target_data_center),btrim(target_audience_external_id),btrim(target_audience_name),
    target_mapping_version,actor.id,target_correlation_id,target_selected_at
  ) returning * into selected_binding;
  delete from connector_private.connector_sync_cursors cursor_row
  where cursor_row.connection_id=target_connection.id
    and cursor_row.stream_key like 'mailchimp.%';
  get diagnostics invalidated_cursors=row_count;
  update public.mailchimp_webhook_jobs webhook_job set
    state='review',lease_owner=null,lease_expires_at=null,
    last_error_category='audience-replaced',completed_at=target_selected_at
  where webhook_job.connection_id=target_connection.id
    and webhook_job.binding_id is distinct from selected_binding.id
    and webhook_job.state in ('queued','leased','executing','retry_wait');
  get diagnostics invalidated_webhook_jobs=row_count;
  update public.connector_connections set remote_identity_summary=remote_identity_summary||jsonb_build_object(
    'dataCenter',lower(target_data_center),'selectedAudienceId',selected_binding.audience_external_id,
    'selectedAudienceName',selected_binding.audience_name,'mappingVersion',selected_binding.mapping_version)
  where id=target_connection.id;
  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    redacted_metadata,occurred_at
  ) values (
    selected_binding.workspace_id,selected_binding.connection_id,'mailchimp',receipt_type,
    'audience.selected:'||selected_binding.id::text,target_correlation_id,
    jsonb_build_object('audienceId',selected_binding.audience_external_id,
      'audienceName',selected_binding.audience_name,'mappingVersion',selected_binding.mapping_version,
      'replacedBindingId',prior_binding.id),target_selected_at
  ) returning * into target_receipt;
  return jsonb_build_object('binding',to_jsonb(selected_binding),
    'replacedBinding',case when prior_binding.id is null then null else to_jsonb(prior_binding) end,
    'receipt',to_jsonb(target_receipt),'invalidatedCursors',invalidated_cursors,
    'invalidatedWebhookJobs',invalidated_webhook_jobs,'noOp',false);
end;
$$;

create or replace function public.link_mailchimp_member(
  target_binding_id uuid,
  target_contact_point_id uuid,
  target_subscriber_hash text,
  target_member_external_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_point public.contact_points%rowtype;
  target_link public.mailchimp_member_links%rowtype;
  expected_hash text;
begin
  select binding.* into target_binding from public.mailchimp_audience_bindings binding
  where binding.id=target_binding_id and binding.replaced_at is null;
  if not found then raise exception 'selected Mailchimp audience not found' using errcode='P0002'; end if;
  select point.* into target_point from public.contact_points point
  join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
  where point.id=target_contact_point_id and point.workspace_id=target_binding.workspace_id
    and point.type='email' and point.archived_at is null and contact.archived_at is null;
  if not found then raise exception 'active canonical email point not found' using errcode='P0002'; end if;
  expected_hash:=encode(extensions.digest(pg_catalog.convert_to(target_point.normalized_value,'UTF8'),'md5'),'hex');
  if target_subscriber_hash<>expected_hash
     or target_member_external_id is null or length(btrim(target_member_external_id)) not between 1 and 128
     or target_member_external_id ~ '[@[:cntrl:]]' then
    raise exception 'Mailchimp member identity binding is invalid' using errcode='23514';
  end if;
  select link.* into target_link from public.mailchimp_member_links link
  where link.binding_id=target_binding.id
    and (link.subscriber_hash=target_subscriber_hash or link.member_external_id=target_member_external_id)
  for update;
  if found then
    if target_link.contact_point_id<>target_point.id
       or target_link.subscriber_hash<>target_subscriber_hash
       or target_link.member_external_id<>target_member_external_id then
      raise exception 'Mailchimp member identity conflicts with another canonical email'
        using errcode='23505';
    end if;
    return jsonb_build_object('memberLink',to_jsonb(target_link),'noOp',true);
  end if;
  insert into public.mailchimp_member_links (
    workspace_id,connection_id,binding_id,contact_id,contact_point_id,
    subscriber_hash,member_external_id
  ) values (
    target_binding.workspace_id,target_binding.connection_id,target_binding.id,
    target_point.contact_id,target_point.id,target_subscriber_hash,btrim(target_member_external_id)
  ) returning * into target_link;
  return jsonb_build_object('memberLink',to_jsonb(target_link),'noOp',false);
end;
$$;

create or replace function public.apply_mailchimp_inbound_subscription_event(
  target_connection_id uuid,
  target_audience_external_id text,
  target_delivery_id uuid,
  target_member_external_id text,
  target_subscriber_hash text,
  target_normalized_email text,
  target_subscription_status text,
  target_provider_event_id_hash text,
  target_originating_operation_key_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_delivery public.connector_webhook_deliveries%rowtype;
  target_point public.contact_points%rowtype;
  target_link public.mailchimp_member_links%rowtype;
  target_authority public.mailchimp_subscription_authority%rowtype;
  target_evidence public.mailchimp_sync_evidence%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  actor_membership_id uuid;
  normalized_email text;
  expected_subscriber_hash text;
  active_matches integer;
  archived_matches integer;
  prior_subscribed boolean;
  applied_subscribed boolean;
  resolved_outcome text := 'applied';
  review_reason text;
  receipt_type public.connector_receipt_event_type := 'sync.applied'::public.connector_receipt_event_type;
begin
  if target_provider_event_id_hash !~ '^[0-9a-f]{64}$'
     or target_subscriber_hash !~ '^[0-9a-f]{32}$'
     or (target_originating_operation_key_hash is not null
       and target_originating_operation_key_hash !~ '^[0-9a-f]{64}$')
     or target_subscription_status not in ('subscribed','unsubscribed','pending','cleaned','transactional','archived')
     or target_correlation_id is null or target_occurred_at is null then
    raise exception 'invalid Mailchimp inbound subscription event' using errcode='22023';
  end if;
  normalized_email:=public.normalize_contact_email(target_normalized_email);
  expected_subscriber_hash:=encode(extensions.digest(pg_catalog.convert_to(normalized_email,'UTF8'),'md5'),'hex');
  if normalized_email is null or expected_subscriber_hash<>target_subscriber_hash then
    raise exception 'Mailchimp subscriber hash does not bind the canonical email' using errcode='23514';
  end if;

  select binding.* into target_binding from public.mailchimp_audience_bindings binding
  where binding.connection_id=target_connection_id and binding.replaced_at is null;
  if not found then raise exception 'selected Mailchimp audience not found' using errcode='P0002'; end if;
  select delivery.* into target_delivery from public.connector_webhook_deliveries delivery
  where delivery.id=target_delivery_id and delivery.connection_id=target_binding.connection_id
    and delivery.workspace_id=target_binding.workspace_id and delivery.provider='mailchimp'
    and delivery.outcome='accepted' and delivery.signature_valid and delivery.timestamp_valid
  for update;
  if not found then raise exception 'verified Mailchimp webhook delivery required' using errcode='42501'; end if;

  select evidence.* into target_evidence from public.mailchimp_sync_evidence evidence
  where evidence.connection_id=target_connection_id and evidence.origin='mailchimp-webhook'
    and evidence.source_key_hash=target_provider_event_id_hash;
  if found then
    select receipt.* into target_receipt from public.connector_receipt_events receipt
    where receipt.workspace_id=target_evidence.workspace_id
      and receipt.event_key='mailchimp.inbound:'||target_provider_event_id_hash;
    return jsonb_build_object('outcome',target_evidence.outcome,
      'evidence',to_jsonb(target_evidence),'receipt',to_jsonb(target_receipt),'noOp',true);
  end if;

  if target_binding.audience_external_id<>target_audience_external_id then
    resolved_outcome:='review'; review_reason:='wrong-audience';
  end if;

  if review_reason is null and target_binding.baseline_required then
    resolved_outcome:='review'; review_reason:='baseline-required';
  end if;

  if review_reason is null and target_originating_operation_key_hash is not null and exists (
    select 1 from public.mailchimp_sync_evidence evidence
    where evidence.connection_id=target_connection_id and evidence.origin='outbound-job'
      and evidence.source_key_hash=target_originating_operation_key_hash
      and evidence.outcome='applied'
  ) then
    resolved_outcome:='echo-suppressed'; review_reason:='exact-outbound-echo';
  end if;

  if review_reason is null then
    select count(*)::integer,
      (min(point.id::text))::uuid,(min(point.contact_id::text))::uuid
      into active_matches,target_point.id,target_point.contact_id
    from public.contact_points point
    join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
    where point.workspace_id=target_binding.workspace_id and point.type='email'
      and point.normalized_value=normalized_email
      and point.archived_at is null and contact.archived_at is null;
    select count(*)::integer into archived_matches
    from public.contact_points point
    join public.contacts contact on contact.id=point.contact_id and contact.workspace_id=point.workspace_id
    where point.workspace_id=target_binding.workspace_id and point.type='email'
      and point.normalized_value=normalized_email
      and (point.archived_at is not null or contact.archived_at is not null);
    if active_matches<>1 then
      resolved_outcome:='review';
      review_reason:=case when active_matches>1 then 'ambiguous-email'
        when archived_matches>0 then 'archived-email' else 'no-canonical-match' end;
    else
      select point.* into strict target_point from public.contact_points point
      where point.id=target_point.id and point.workspace_id=target_binding.workspace_id for update;
    end if;
  end if;

  if review_reason is null then
    select link.* into target_link from public.mailchimp_member_links link
    where link.binding_id=target_binding.id
      and (link.subscriber_hash=target_subscriber_hash or link.member_external_id=target_member_external_id)
    for update;
    if found and (target_link.contact_point_id<>target_point.id
      or target_link.subscriber_hash<>target_subscriber_hash
      or target_link.member_external_id<>target_member_external_id) then
      resolved_outcome:='review'; review_reason:='provider-member-conflict'; target_link.id:=null;
    elsif not found then
      insert into public.mailchimp_member_links (
        workspace_id,connection_id,binding_id,contact_id,contact_point_id,
        subscriber_hash,member_external_id
      ) values (
        target_binding.workspace_id,target_binding.connection_id,target_binding.id,
        target_point.contact_id,target_point.id,target_subscriber_hash,btrim(target_member_external_id)
      ) returning * into target_link;
    end if;
  end if;

  if review_reason is null then
    select authority.* into target_authority from public.mailchimp_subscription_authority authority
    where authority.member_link_id=target_link.id for update;
    if found and target_authority.last_occurred_at>target_occurred_at then
      resolved_outcome:='review'; review_reason:='out-of-order-event';
    elsif target_subscription_status='subscribed'
      and target_authority.resubscribe_requires_consent then
      resolved_outcome:='blocked-unsubscribe-authority'; review_reason:='fresh-consent-required';
    else
      prior_subscribed:=target_point.email_subscribed;
      if target_subscription_status='subscribed' then applied_subscribed:=true;
      elsif target_subscription_status in ('unsubscribed','cleaned') then applied_subscribed:=false;
      else applied_subscribed:=prior_subscribed; resolved_outcome:='no-op'; end if;
      if target_subscription_status in ('subscribed','unsubscribed','cleaned') then
        update public.contact_points set email_subscribed=applied_subscribed
        where id=target_point.id returning * into target_point;
      end if;
      insert into public.mailchimp_subscription_authority (
        workspace_id,connection_id,binding_id,member_link_id,provider_status,
        provider_unsubscribed_at,resubscribe_requires_consent,
        last_provider_event_id_hash,last_occurred_at
      ) values (
        target_binding.workspace_id,target_binding.connection_id,target_binding.id,target_link.id,
        target_subscription_status,
        case when target_subscription_status in ('unsubscribed','cleaned') then target_occurred_at end,
        target_subscription_status in ('unsubscribed','cleaned'),target_provider_event_id_hash,target_occurred_at
      ) on conflict (member_link_id) do update set
        provider_status=excluded.provider_status,
        provider_unsubscribed_at=case when excluded.provider_status in ('unsubscribed','cleaned')
          then excluded.provider_unsubscribed_at else mailchimp_subscription_authority.provider_unsubscribed_at end,
        resubscribe_requires_consent=mailchimp_subscription_authority.resubscribe_requires_consent
          or excluded.resubscribe_requires_consent,
        last_provider_event_id_hash=excluded.last_provider_event_id_hash,
        last_occurred_at=excluded.last_occurred_at
      returning * into target_authority;
      if prior_subscribed is distinct from applied_subscribed then
        select membership.id into actor_membership_id from public.workspace_members membership
        where membership.workspace_id=target_binding.workspace_id and membership.status='active'
          and membership.role='owner' order by membership.created_at,membership.id limit 1;
        if actor_membership_id is null then
          raise exception 'active owner required for Mailchimp activity evidence' using errcode='42501';
        end if;
        insert into public.activity_events (
          workspace_id,type,contact_id,actor_membership_id,occurred_at,idempotency_key
        ) values (
          target_binding.workspace_id,'contact-point-updated',target_point.contact_id,
          actor_membership_id,target_occurred_at,
          'mailchimp.subscription:'||target_provider_event_id_hash
        );
      end if;
    end if;
  end if;

  if resolved_outcome in ('review','blocked-unsubscribe-authority') then receipt_type:='sync.reviewed'; end if;
  insert into public.mailchimp_sync_evidence (
    workspace_id,connection_id,binding_id,member_link_id,contact_point_id,
    origin,source_key_hash,provider_event_id_hash,correlation_id,outcome,
    requested_status,applied_email_subscribed,occurred_at
  ) values (
    target_binding.workspace_id,target_binding.connection_id,target_binding.id,target_link.id,
    target_point.id,'mailchimp-webhook',target_provider_event_id_hash,target_provider_event_id_hash,
    target_correlation_id,resolved_outcome,target_subscription_status,applied_subscribed,target_occurred_at
  ) returning * into target_evidence;
  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    provider_status,reconciliation_result,redacted_metadata,occurred_at
  ) values (
    target_binding.workspace_id,target_binding.connection_id,'mailchimp',receipt_type,
    'mailchimp.inbound:'||target_provider_event_id_hash,target_correlation_id,
    target_subscription_status,review_reason,
    jsonb_build_object('audienceId',target_binding.audience_external_id,
      'subscriberHash',target_subscriber_hash,'outcome',resolved_outcome,
      'reviewReason',review_reason,'memberLinkId',target_link.id),target_occurred_at
  ) returning * into target_receipt;
  update public.connector_webhook_deliveries delivery set
    processed_at=coalesce(delivery.processed_at,target_occurred_at),
    redacted_result=coalesce(delivery.redacted_result,'mailchimp-'||resolved_outcome)
  where id=target_delivery.id;
  return jsonb_build_object('outcome',resolved_outcome,'memberLink',case when target_link.id is null then null else to_jsonb(target_link) end,
    'authority',case when target_authority.id is null then null else to_jsonb(target_authority) end,
    'evidence',to_jsonb(target_evidence),'receipt',to_jsonb(target_receipt),'noOp',false);
end;
$$;

create or replace function public.read_mailchimp_job_binding(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target_job public.connector_jobs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
begin
  select job.* into target_job from public.connector_jobs job
  where job.id=target_job_id and job.provider='mailchimp'
    and job.state in ('leased','executing','reconciliation_required')
    and job.lease_owner=target_worker_id and job.fencing_token=target_fencing_token
    and job.lease_expires_at>target_now;
  if not found then raise exception 'active Mailchimp job lease required' using errcode='42501'; end if;
  select binding.* into target_binding from public.mailchimp_audience_bindings binding
  where binding.connection_id=target_job.connection_id
    and binding.workspace_id=target_job.workspace_id and binding.replaced_at is null;
  if not found then raise exception 'selected Mailchimp audience not found' using errcode='P0002'; end if;
  return jsonb_build_object('workspaceId',target_binding.workspace_id,
    'connectionId',target_binding.connection_id,
    'dataCenter',target_binding.data_center,'audienceId',target_binding.audience_external_id,
    'accountIdHash',target_binding.account_id_hash,'mappingVersion',target_binding.mapping_version,
    'baselineRequired',target_binding.baseline_required,
    'webhookRegistrationRequired',target_binding.webhook_registration_required);
end;
$$;

create or replace function public.record_mailchimp_outbound_sync_evidence(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_subscriber_hash text,
  target_source_key_hash text,
  target_requested_status text,
  target_outcome text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_job public.connector_jobs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_link public.mailchimp_member_links%rowtype;
  target_authority public.mailchimp_subscription_authority%rowtype;
  target_evidence public.mailchimp_sync_evidence%rowtype;
  allowed boolean := true;
  persisted_outcome text := target_outcome;
begin
  if target_subscriber_hash !~ '^[0-9a-f]{32}$'
     or target_source_key_hash !~ '^[0-9a-f]{64}$'
     or target_requested_status not in ('subscribed','unsubscribed','pending','cleaned','transactional','archived')
     or target_outcome not in ('applied','no-op','review')
     or target_correlation_id is null or target_occurred_at is null then
    raise exception 'invalid Mailchimp outbound evidence request' using errcode='22023';
  end if;
  select job.* into target_job from public.connector_jobs job
  where job.id=target_job_id and job.provider='mailchimp'
    and job.state in ('executing','reconciliation_required')
    and job.lease_owner=target_worker_id and job.fencing_token=target_fencing_token
    and job.lease_expires_at>target_occurred_at;
  if not found then raise exception 'active Mailchimp job lease required' using errcode='42501'; end if;
  select binding.* into strict target_binding from public.mailchimp_audience_bindings binding
  where binding.connection_id=target_job.connection_id
    and binding.workspace_id=target_job.workspace_id and binding.replaced_at is null;
  select link.* into target_link from public.mailchimp_member_links link
  where link.binding_id=target_binding.id and link.subscriber_hash=target_subscriber_hash;
  if found then
    select authority.* into target_authority from public.mailchimp_subscription_authority authority
    where authority.member_link_id=target_link.id;
  end if;
  if target_requested_status='subscribed' and target_authority.resubscribe_requires_consent then
    allowed:=false; persisted_outcome:='blocked-unsubscribe-authority';
  end if;
  select evidence.* into target_evidence from public.mailchimp_sync_evidence evidence
  where evidence.connection_id=target_job.connection_id and evidence.origin='outbound-job'
    and evidence.source_key_hash=target_source_key_hash;
  if found then
    if target_evidence.source_job_id<>target_job.id
       or target_evidence.requested_status<>target_requested_status
       or target_evidence.outcome<>persisted_outcome then
      raise exception 'Mailchimp outbound evidence replay conflicts' using errcode='23505';
    end if;
    return jsonb_build_object('allowed',allowed,'evidence',to_jsonb(target_evidence),'noOp',true);
  end if;
  insert into public.mailchimp_sync_evidence (
    workspace_id,connection_id,binding_id,member_link_id,contact_point_id,
    origin,source_key_hash,source_job_id,correlation_id,outcome,
    requested_status,occurred_at
  ) values (
    target_job.workspace_id,target_job.connection_id,target_binding.id,target_link.id,
    target_link.contact_point_id,'outbound-job',target_source_key_hash,target_job.id,
    target_correlation_id,persisted_outcome,target_requested_status,target_occurred_at
  ) returning * into target_evidence;
  return jsonb_build_object('allowed',allowed,'evidence',to_jsonb(target_evidence),'noOp',false);
end;
$$;

create or replace function public.store_mailchimp_sync_checkpoint(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_expected_cursor_version integer,
  target_ciphertext bytea,
  target_nonce bytea,
  target_auth_tag bytea,
  target_wrapped_dek bytea,
  target_wrap_nonce bytea,
  target_wrap_auth_tag bytea,
  target_kek_version text,
  target_aad_hash text,
  target_expires_at timestamptz,
  target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_job public.connector_jobs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_cursor connector_private.connector_sync_cursors%rowtype;
  target_stream_key text;
begin
  select job.* into target_job from public.connector_jobs job
  where job.id=target_job_id and job.provider='mailchimp'
    and job.state in ('leased','executing','reconciliation_required')
    and job.lease_owner=target_worker_id and job.fencing_token=target_fencing_token
    and job.lease_expires_at>target_now;
  if not found then raise exception 'active Mailchimp job lease required' using errcode='42501'; end if;
  select binding.* into strict target_binding from public.mailchimp_audience_bindings binding
  where binding.connection_id=target_job.connection_id
    and binding.workspace_id=target_job.workspace_id and binding.replaced_at is null;
  target_stream_key:='mailchimp.'||substr(encode(extensions.digest(
    pg_catalog.convert_to(target_binding.audience_external_id,'UTF8'),'sha256'),'hex'),1,32);
  select cursor_row.* into target_cursor from connector_private.connector_sync_cursors cursor_row
  where cursor_row.connection_id=target_job.connection_id and cursor_row.stream_key=target_stream_key for update;
  if found then
    if target_expected_cursor_version is null or target_cursor.cursor_version<>target_expected_cursor_version then
      raise exception 'Mailchimp checkpoint version conflict' using errcode='40001';
    end if;
    update connector_private.connector_sync_cursors set cursor_version=cursor_version+1,
      ciphertext=target_ciphertext,nonce=target_nonce,auth_tag=target_auth_tag,
      wrapped_dek=target_wrapped_dek,wrap_nonce=target_wrap_nonce,
      wrap_auth_tag=target_wrap_auth_tag,kek_version=target_kek_version,
      aad_hash=target_aad_hash,expires_at=target_expires_at,updated_at=target_now
    where id=target_cursor.id returning * into target_cursor;
  else
    if target_expected_cursor_version is not null then
      raise exception 'Mailchimp checkpoint does not exist for expected version' using errcode='40001';
    end if;
    insert into connector_private.connector_sync_cursors (
      workspace_id,connection_id,stream_key,ciphertext,nonce,auth_tag,wrapped_dek,
      wrap_nonce,wrap_auth_tag,kek_version,aad_hash,expires_at,updated_at
    ) values (
      target_job.workspace_id,target_job.connection_id,target_stream_key,target_ciphertext,
      target_nonce,target_auth_tag,target_wrapped_dek,target_wrap_nonce,target_wrap_auth_tag,
      target_kek_version,target_aad_hash,target_expires_at,target_now
    ) returning * into target_cursor;
  end if;
  return jsonb_build_object('cursorId',target_cursor.id,'connectionId',target_cursor.connection_id,
    'streamKey',target_cursor.stream_key,'cursorVersion',target_cursor.cursor_version,
    'kekVersion',target_cursor.kek_version,'expiresAt',target_cursor.expires_at);
end;
$$;

create or replace function public.read_mailchimp_sync_checkpoint(
  target_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target_job public.connector_jobs%rowtype;
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_cursor connector_private.connector_sync_cursors%rowtype;
  target_stream_key text;
begin
  select job.* into target_job from public.connector_jobs job
  where job.id=target_job_id and job.provider='mailchimp'
    and job.state in ('leased','executing','reconciliation_required')
    and job.lease_owner=target_worker_id and job.fencing_token=target_fencing_token
    and job.lease_expires_at>target_now;
  if not found then raise exception 'active Mailchimp job lease required' using errcode='42501'; end if;
  select binding.* into strict target_binding from public.mailchimp_audience_bindings binding
  where binding.connection_id=target_job.connection_id
    and binding.workspace_id=target_job.workspace_id and binding.replaced_at is null;
  target_stream_key:='mailchimp.'||substr(encode(extensions.digest(
    pg_catalog.convert_to(target_binding.audience_external_id,'UTF8'),'sha256'),'hex'),1,32);
  select cursor_row.* into target_cursor from connector_private.connector_sync_cursors cursor_row
  where cursor_row.connection_id=target_job.connection_id and cursor_row.stream_key=target_stream_key;
  if not found then return jsonb_build_object('checkpoint',null); end if;
  return jsonb_build_object('checkpoint',jsonb_build_object(
    'cursorId',target_cursor.id,'connectionId',target_cursor.connection_id,
    'streamKey',target_cursor.stream_key,'cursorVersion',target_cursor.cursor_version,
    'ciphertext',encode(target_cursor.ciphertext,'base64'),'nonce',encode(target_cursor.nonce,'base64'),
    'authTag',encode(target_cursor.auth_tag,'base64'),'wrappedDek',encode(target_cursor.wrapped_dek,'base64'),
    'wrapNonce',encode(target_cursor.wrap_nonce,'base64'),'wrapAuthTag',encode(target_cursor.wrap_auth_tag,'base64'),
    'kekVersion',target_cursor.kek_version,'aadHash',target_cursor.aad_hash,
    'expiresAt',target_cursor.expires_at));
end;
$$;

-- Owner bootstrap and service-only credential/readiness seams ------------

create or replace function public.ensure_mailchimp_sync_policy(
  target_workspace_id uuid,
  target_correlation_id uuid,
  target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.workspace_members%rowtype;
  target_policy public.connector_automation_policies%rowtype;
  expected_constraints constant jsonb := '{"provider":"mailchimp","requiresActiveSelectedAudience":true,"mappingVersion":1}'::jsonb;
  expected_compliance constant jsonb := '{"unsubscribeAuthority":"provider","noAutomaticResubscribe":true,"rawEmailInReceipts":false}'::jsonb;
  expected_limits constant jsonb := '{"maxBatchSize":500,"maxAttempts":5,"minimumDelayMs":250,"initialBaselineRequired":true}'::jsonb;
begin
  actor:=public.connector_current_membership(target_workspace_id,true);
  if target_correlation_id is null or target_occurred_at is null then
    raise exception 'invalid Mailchimp sync policy request' using errcode='22023';
  end if;
  select policy.* into target_policy from public.connector_automation_policies policy
  where policy.workspace_id=target_workspace_id and policy.action_type='audience.sync'
  order by policy.version desc limit 1;
  if found then
    if target_policy.version<>1 or target_policy.approval_mode<>'owner_required'
       or target_policy.allowlisted_actions is distinct from array['audience.sync']::text[]
       or target_policy.target_constraints<>expected_constraints
       or target_policy.compliance_requirements<>expected_compliance
       or target_policy.execution_limits<>expected_limits then
      raise exception 'existing audience.sync policy conflicts with canonical Mailchimp policy'
        using errcode='23505';
    end if;
    return jsonb_build_object('policy',to_jsonb(target_policy),'noOp',true);
  end if;
  insert into public.connector_automation_policies (
    workspace_id,action_type,version,approval_mode,allowlisted_actions,
    target_constraints,compliance_requirements,execution_limits,
    created_by_membership_id,correlation_id,created_at
  ) values (
    target_workspace_id,'audience.sync',1,'owner_required',array['audience.sync'],
    expected_constraints,expected_compliance,expected_limits,
    actor.id,target_correlation_id,target_occurred_at
  ) returning * into target_policy;
  return jsonb_build_object('policy',to_jsonb(target_policy),'noOp',false);
end;
$$;

create or replace function public.read_mailchimp_access_token(
  target_workspace_id uuid,
  target_connection_id uuid,
  target_authenticated_user_id uuid,
  target_membership_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  target_connection public.connector_connections%rowtype;
  target_secret connector_private.connector_connection_secrets%rowtype;
begin
  select connection.* into target_connection from public.connector_connections connection
  where connection.id=target_connection_id and connection.workspace_id=target_workspace_id
    and connection.provider='mailchimp' and connection.status in ('active','degraded','reauthorization_required');
  if not found then raise exception 'available Mailchimp connection not found' using errcode='P0002'; end if;
  if not exists (
    select 1 from public.workspace_members membership
    where membership.id=target_membership_id and membership.workspace_id=target_workspace_id
      and membership.user_id=target_authenticated_user_id
      and membership.role='owner' and membership.status='active'
  ) then
    raise exception 'active owner authority required for Mailchimp token read' using errcode='42501';
  end if;
  select secret.* into target_secret from connector_private.connector_connection_secrets secret
  where secret.connection_id=target_connection.id and secret.workspace_id=target_workspace_id
    and secret.secret_type='mailchimp-access-token' and secret.destroyed_at is null;
  if not found then raise exception 'active Mailchimp access token not found' using errcode='P0002'; end if;
  return jsonb_build_object(
    'workspaceId',target_workspace_id,'connectionId',target_connection.id,
    'provider','mailchimp','providerAccountKeyHash',target_connection.provider_account_key_hash,
    'grantedScopes',target_connection.granted_scopes,
    'secret',jsonb_build_object(
      'secretId',target_secret.id,'secretType',target_secret.secret_type,
      'secretVersion',target_secret.secret_version,
      'ciphertext',encode(target_secret.ciphertext,'base64'),
      'nonce',encode(target_secret.nonce,'base64'),'authTag',encode(target_secret.auth_tag,'base64'),
      'wrappedDek',encode(target_secret.wrapped_dek,'base64'),
      'wrapNonce',encode(target_secret.wrap_nonce,'base64'),
      'wrapAuthTag',encode(target_secret.wrap_auth_tag,'base64'),
      'kekVersion',target_secret.kek_version,'aadHash',target_secret.aad_hash,
      'expiresAt',target_secret.expires_at));
end;
$$;

create or replace function public.complete_mailchimp_audience_baseline(
  target_connection_id uuid,
  target_binding_id uuid,
  target_provider_request_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_binding public.mailchimp_audience_bindings%rowtype; target_receipt public.connector_receipt_events%rowtype; was_required boolean;
begin
  if target_provider_request_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null or target_occurred_at is null then
    raise exception 'invalid Mailchimp baseline completion evidence' using errcode='22023';
  end if;
  select binding.* into target_binding from public.mailchimp_audience_bindings binding
  where binding.id=target_binding_id and binding.connection_id=target_connection_id
    and binding.replaced_at is null for update;
  if not found then raise exception 'active Mailchimp audience binding not found' using errcode='P0002'; end if;
  was_required:=target_binding.baseline_required;
  if was_required then
    update public.mailchimp_audience_bindings set baseline_required=false
    where id=target_binding.id returning * into target_binding;
  end if;
  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id=target_binding.workspace_id
    and receipt.event_key='mailchimp.baseline.completed:'||target_binding.id::text;
  if target_receipt.id is null then
    insert into public.connector_receipt_events (
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      provider_request_hash,redacted_metadata,occurred_at
    ) values (
      target_binding.workspace_id,target_binding.connection_id,'mailchimp','sync.applied',
      'mailchimp.baseline.completed:'||target_binding.id::text,target_correlation_id,
      target_provider_request_hash,jsonb_build_object('bindingId',target_binding.id,
        'audienceId',target_binding.audience_external_id,'mappingVersion',target_binding.mapping_version),
      target_occurred_at
    ) returning * into target_receipt;
  end if;
  return jsonb_build_object('binding',to_jsonb(target_binding),'receipt',to_jsonb(target_receipt),'noOp',not was_required);
end;
$$;

create or replace function public.confirm_mailchimp_webhook_registration(
  target_connection_id uuid,
  target_binding_id uuid,
  target_provider_request_hash text,
  target_correlation_id uuid,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_binding public.mailchimp_audience_bindings%rowtype; target_receipt public.connector_receipt_events%rowtype; was_required boolean;
begin
  if target_provider_request_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null or target_occurred_at is null then
    raise exception 'invalid Mailchimp webhook registration evidence' using errcode='22023';
  end if;
  select binding.* into target_binding from public.mailchimp_audience_bindings binding
  where binding.id=target_binding_id and binding.connection_id=target_connection_id
    and binding.replaced_at is null for update;
  if not found then raise exception 'active Mailchimp audience binding not found' using errcode='P0002'; end if;
  was_required:=target_binding.webhook_registration_required;
  if was_required then
    update public.mailchimp_audience_bindings set webhook_registration_required=false
    where id=target_binding.id returning * into target_binding;
  end if;
  select receipt.* into target_receipt from public.connector_receipt_events receipt
  where receipt.workspace_id=target_binding.workspace_id
    and receipt.event_key='mailchimp.webhook.registered:'||target_binding.id::text;
  if target_receipt.id is null then
    insert into public.connector_receipt_events (
      workspace_id,connection_id,provider,event_type,event_key,correlation_id,
      provider_request_hash,redacted_metadata,occurred_at
    ) values (
      target_binding.workspace_id,target_binding.connection_id,'mailchimp','sync.applied',
      'mailchimp.webhook.registered:'||target_binding.id::text,target_correlation_id,
      target_provider_request_hash,jsonb_build_object('bindingId',target_binding.id,
        'audienceId',target_binding.audience_external_id),target_occurred_at
    ) returning * into target_receipt;
  end if;
  return jsonb_build_object('binding',to_jsonb(target_binding),'receipt',to_jsonb(target_receipt),'noOp',not was_required);
end;
$$;

-- Fast webhook registration and durable asynchronous processing ----------

create or replace function public.register_mailchimp_webhook_event(
  target_connection_id uuid,
  target_audience_external_id text,
  target_replay_key_hash text,
  target_raw_body_hash text,
  target_signature_valid boolean,
  target_timestamp_valid boolean,
  target_payload_ref uuid,
  target_payload_hash text,
  target_correlation_id uuid,
  target_received_at timestamptz,
  target_max_attempts integer default 5
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_binding public.mailchimp_audience_bindings%rowtype;
  target_payload connector_private.connector_payload_envelopes%rowtype;
  target_delivery public.connector_webhook_deliveries%rowtype;
  target_job public.mailchimp_webhook_jobs%rowtype;
  target_receipt public.connector_receipt_events%rowtype;
  accepted boolean;
begin
  if target_replay_key_hash !~ '^[0-9a-f]{64}$' or target_raw_body_hash !~ '^[0-9a-f]{64}$'
     or target_payload_hash !~ '^[0-9a-f]{64}$' or target_correlation_id is null
     or target_received_at is null or target_max_attempts not between 1 and 20 then
    raise exception 'invalid Mailchimp webhook registration' using errcode='22023';
  end if;
  select binding.* into target_binding from public.mailchimp_audience_bindings binding
  join public.connector_connections connection on connection.id=binding.connection_id
    and connection.workspace_id=binding.workspace_id
  where binding.connection_id=target_connection_id and binding.replaced_at is null
    and binding.audience_external_id=target_audience_external_id
    and connection.provider='mailchimp' and connection.status in ('active','degraded');
  if not found then raise exception 'active selected Mailchimp audience not found' using errcode='P0002'; end if;
  select payload.* into target_payload from connector_private.connector_payload_envelopes payload
  where payload.id=target_payload_ref and payload.workspace_id=target_binding.workspace_id
    and payload.connection_id=target_binding.connection_id and payload.payload_kind='mailchimp.webhook'
    and payload.canonical_hash=target_payload_hash and payload.destroyed_at is null;
  if not found then raise exception 'Mailchimp webhook payload envelope binding mismatch' using errcode='23503'; end if;

  select delivery.* into target_delivery from public.connector_webhook_deliveries delivery
  where delivery.connection_id=target_connection_id and delivery.replay_key_hash=target_replay_key_hash
  for update;
  if found then
    select webhook_job.* into target_job from public.mailchimp_webhook_jobs webhook_job
    where webhook_job.delivery_id=target_delivery.id;
    if target_delivery.raw_body_hash<>target_raw_body_hash
       or target_delivery.correlation_id<>target_correlation_id
       or (target_delivery.outcome='accepted' and (target_job.id is null
          or target_job.payload_ref<>target_payload_ref or target_job.payload_hash<>target_payload_hash
          or target_job.binding_id<>target_binding.id)) then
      raise exception 'Mailchimp webhook replay conflicts' using errcode='23505';
    end if;
    return jsonb_build_object('delivery',to_jsonb(target_delivery),
      'webhookJob',case when target_job.id is null then null else to_jsonb(target_job) end,
      'accepted',target_delivery.outcome='accepted','noOp',true);
  end if;

  accepted:=target_signature_valid and target_timestamp_valid;
  insert into public.connector_webhook_deliveries (
    workspace_id,connection_id,provider,replay_key_hash,raw_body_hash,
    signature_valid,timestamp_valid,outcome,correlation_id,received_at,redacted_result
  ) values (
    target_binding.workspace_id,target_binding.connection_id,'mailchimp',target_replay_key_hash,
    target_raw_body_hash,target_signature_valid,target_timestamp_valid,
    case when accepted then 'accepted' else 'rejected' end,
    target_correlation_id,target_received_at,case when accepted then 'queued' else 'verification-rejected' end
  ) returning * into target_delivery;
  insert into public.connector_receipt_events (
    workspace_id,connection_id,provider,event_type,event_key,correlation_id,
    error_category,redacted_metadata,occurred_at
  ) values (
    target_binding.workspace_id,target_binding.connection_id,'mailchimp',
    case when accepted then 'webhook.accepted'::public.connector_receipt_event_type
      else 'webhook.rejected'::public.connector_receipt_event_type end,
    (case when accepted then 'webhook.accepted:' else 'webhook.rejected:' end)||target_delivery.id::text,
    target_correlation_id,case when accepted then null else 'webhook_verification_failed' end,
    jsonb_build_object('deliveryId',target_delivery.id,'bindingId',target_binding.id,
      'signatureValid',target_signature_valid,'timestampValid',target_timestamp_valid),target_received_at
  ) returning * into target_receipt;
  if accepted then
    insert into public.mailchimp_webhook_jobs (
      workspace_id,connection_id,binding_id,delivery_id,payload_ref,payload_hash,
      state,max_attempts,scheduled_at,correlation_id
    ) values (
      target_binding.workspace_id,target_binding.connection_id,target_binding.id,target_delivery.id,
      target_payload.id,target_payload.canonical_hash,'queued',target_max_attempts,target_received_at,target_correlation_id
    ) returning * into target_job;
  end if;
  return jsonb_build_object('delivery',to_jsonb(target_delivery),
    'webhookJob',case when target_job.id is null then null else to_jsonb(target_job) end,
    'receipt',to_jsonb(target_receipt),'accepted',accepted,'noOp',false);
end;
$$;

create or replace function public.claim_mailchimp_webhook_jobs(
  target_worker_id uuid,
  target_batch_size integer default 10,
  target_lease_seconds integer default 90,
  target_now timestamptz default clock_timestamp()
)
returns setof public.mailchimp_webhook_jobs language plpgsql security definer set search_path = '' as $$
declare candidate record; claimed public.mailchimp_webhook_jobs%rowtype;
begin
  if target_worker_id is null or target_batch_size not between 1 and 25
     or target_lease_seconds not between 15 and 900 or target_now is null then
    raise exception 'invalid Mailchimp webhook claim' using errcode='22023';
  end if;
  update public.mailchimp_webhook_jobs set state='retry_wait',lease_owner=null,lease_expires_at=null,
    scheduled_at=target_now,last_error_category='lease_expired'
  where state in ('leased','executing') and lease_expires_at<=target_now
    and attempt_count<max_attempts;
  update public.mailchimp_webhook_jobs set state='review',lease_owner=null,lease_expires_at=null,
    last_error_category='lease_expired',completed_at=target_now
  where state in ('leased','executing') and lease_expires_at<=target_now
    and attempt_count>=max_attempts;
  for candidate in
    select webhook_job.id from public.mailchimp_webhook_jobs webhook_job
    join public.mailchimp_audience_bindings binding on binding.id=webhook_job.binding_id
      and binding.workspace_id=webhook_job.workspace_id
    join public.connector_connections connection on connection.id=webhook_job.connection_id
      and connection.workspace_id=webhook_job.workspace_id
    where webhook_job.state in ('queued','retry_wait') and webhook_job.scheduled_at<=target_now
      and webhook_job.attempt_count<webhook_job.max_attempts
      and binding.replaced_at is null and not binding.baseline_required
      and not binding.webhook_registration_required
      and connection.status in ('active','degraded')
    order by webhook_job.scheduled_at,webhook_job.created_at,webhook_job.id
    for update of webhook_job skip locked limit target_batch_size
  loop
    update public.mailchimp_webhook_jobs set state='leased',lease_owner=target_worker_id,
      lease_expires_at=target_now+make_interval(secs=>target_lease_seconds),fencing_token=fencing_token+1
    where id=candidate.id returning * into claimed;
    return next claimed;
  end loop;
  return;
end;
$$;

create or replace function public.start_mailchimp_webhook_job(
  target_webhook_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_started_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_job public.mailchimp_webhook_jobs%rowtype;
begin
  select webhook_job.* into target_job from public.mailchimp_webhook_jobs webhook_job
  where webhook_job.id=target_webhook_job_id for update;
  if not found then raise exception 'Mailchimp webhook job not found' using errcode='P0002'; end if;
  if target_job.state<>'leased' or target_job.lease_owner<>target_worker_id
     or target_job.fencing_token<>target_fencing_token or target_job.lease_expires_at<=target_started_at
     or target_job.attempt_count>=target_job.max_attempts then
    raise exception 'stale or exhausted Mailchimp webhook lease' using errcode='40001';
  end if;
  update public.mailchimp_webhook_jobs set state='executing',attempt_count=attempt_count+1,
    started_at=coalesce(started_at,target_started_at)
  where id=target_job.id returning * into target_job;
  return jsonb_build_object('webhookJob',to_jsonb(target_job));
end;
$$;

create or replace function public.read_claimed_mailchimp_webhook_payload(
  target_webhook_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_now timestamptz default clock_timestamp()
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare target_job public.mailchimp_webhook_jobs%rowtype; target_payload connector_private.connector_payload_envelopes%rowtype; target_binding public.mailchimp_audience_bindings%rowtype;
begin
  select webhook_job.* into target_job from public.mailchimp_webhook_jobs webhook_job
  where webhook_job.id=target_webhook_job_id and webhook_job.state in ('leased','executing')
    and webhook_job.lease_owner=target_worker_id and webhook_job.fencing_token=target_fencing_token
    and webhook_job.lease_expires_at>target_now;
  if not found then raise exception 'active Mailchimp webhook lease required' using errcode='42501'; end if;
  select binding.* into strict target_binding from public.mailchimp_audience_bindings binding
  where binding.id=target_job.binding_id and binding.replaced_at is null;
  select payload.* into strict target_payload from connector_private.connector_payload_envelopes payload
  where payload.id=target_job.payload_ref and payload.workspace_id=target_job.workspace_id
    and payload.connection_id=target_job.connection_id and payload.canonical_hash=target_job.payload_hash
    and payload.payload_kind='mailchimp.webhook' and payload.destroyed_at is null;
  return jsonb_build_object('webhookJobId',target_job.id,'workspaceId',target_job.workspace_id,
    'connectionId',target_job.connection_id,'bindingId',target_binding.id,
    'audienceId',target_binding.audience_external_id,'mappingVersion',target_binding.mapping_version,
    'deliveryId',target_job.delivery_id,'payload',jsonb_build_object(
      'payloadRef',target_payload.id,'payloadKind',target_payload.payload_kind,
      'schemaVersion',target_payload.schema_version,'canonicalHash',target_payload.canonical_hash,
      'ciphertext',encode(target_payload.ciphertext,'base64'),'nonce',encode(target_payload.nonce,'base64'),
      'authTag',encode(target_payload.auth_tag,'base64'),'wrappedDek',encode(target_payload.wrapped_dek,'base64'),
      'wrapNonce',encode(target_payload.wrap_nonce,'base64'),'wrapAuthTag',encode(target_payload.wrap_auth_tag,'base64'),
      'kekVersion',target_payload.kek_version,'aadHash',target_payload.aad_hash,
      'envelopeVersion',target_payload.envelope_version));
end;
$$;

create or replace function public.apply_claimed_mailchimp_inbound_subscription_event(
  target_webhook_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_member_external_id text,
  target_subscriber_hash text,
  target_normalized_email text,
  target_subscription_status text,
  target_provider_event_id_hash text,
  target_originating_operation_key_hash text,
  target_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_job public.mailchimp_webhook_jobs%rowtype; target_binding public.mailchimp_audience_bindings%rowtype;
begin
  select webhook_job.* into target_job from public.mailchimp_webhook_jobs webhook_job
  where webhook_job.id=target_webhook_job_id and webhook_job.state='executing'
    and webhook_job.lease_owner=target_worker_id and webhook_job.fencing_token=target_fencing_token
    and webhook_job.lease_expires_at>target_occurred_at;
  if not found then raise exception 'executing Mailchimp webhook lease required' using errcode='42501'; end if;
  select binding.* into strict target_binding from public.mailchimp_audience_bindings binding
  where binding.id=target_job.binding_id and binding.replaced_at is null;
  return public.apply_mailchimp_inbound_subscription_event(
    target_job.connection_id,target_binding.audience_external_id,target_job.delivery_id,
    target_member_external_id,target_subscriber_hash,target_normalized_email,
    target_subscription_status,target_provider_event_id_hash,
    target_originating_operation_key_hash,target_job.correlation_id,target_occurred_at);
end;
$$;

create or replace function public.transition_mailchimp_webhook_job(
  target_webhook_job_id uuid,
  target_worker_id uuid,
  target_fencing_token bigint,
  target_outcome text,
  target_error_category text,
  target_retry_at timestamptz,
  target_occurred_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_job public.mailchimp_webhook_jobs%rowtype; next_state text;
begin
  if target_outcome not in ('succeeded','retry','review') or target_occurred_at is null
     or (target_error_category is not null and target_error_category !~ '^[a-z][a-z0-9_.-]{1,79}$')
     or (target_outcome='retry' and target_retry_at is null) then
    raise exception 'invalid Mailchimp webhook transition' using errcode='22023';
  end if;
  select webhook_job.* into target_job from public.mailchimp_webhook_jobs webhook_job
  where webhook_job.id=target_webhook_job_id for update;
  if not found then raise exception 'Mailchimp webhook job not found' using errcode='P0002'; end if;
  if target_job.state<>'executing' or target_job.lease_owner<>target_worker_id
     or target_job.fencing_token<>target_fencing_token or target_job.lease_expires_at<=target_occurred_at then
    raise exception 'stale Mailchimp webhook transition' using errcode='40001';
  end if;
  if target_outcome='succeeded' and not exists (
    select 1 from public.connector_webhook_deliveries delivery
    where delivery.id=target_job.delivery_id and delivery.processed_at is not null
  ) then
    raise exception 'Mailchimp webhook success requires processed delivery evidence' using errcode='23514';
  end if;
  if target_outcome='retry' and target_job.attempt_count<target_job.max_attempts then next_state:='retry_wait';
  elsif target_outcome='succeeded' then next_state:='succeeded';
  else next_state:='review'; end if;
  update public.mailchimp_webhook_jobs set state=next_state,lease_owner=null,lease_expires_at=null,
    scheduled_at=case when next_state='retry_wait' then target_retry_at else scheduled_at end,
    last_error_category=target_error_category,
    completed_at=case when next_state in ('succeeded','review') then target_occurred_at end
  where id=target_job.id returning * into target_job;
  return jsonb_build_object('webhookJob',to_jsonb(target_job));
end;
$$;

-- Grants and fail-closed verification -----------------------------------

revoke all on function public.begin_mailchimp_oauth(uuid,uuid,text,uuid,text,text,text[],text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.finalize_mailchimp_oauth(uuid,text,text[],jsonb,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.select_mailchimp_audience(uuid,text,text,text,text,integer,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.link_mailchimp_member(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.apply_mailchimp_inbound_subscription_event(uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_mailchimp_job_binding(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.record_mailchimp_outbound_sync_evidence(uuid,uuid,bigint,text,text,text,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.store_mailchimp_sync_checkpoint(uuid,uuid,bigint,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_mailchimp_sync_checkpoint(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.ensure_mailchimp_sync_policy(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_mailchimp_access_token(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.complete_mailchimp_audience_baseline(uuid,uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.confirm_mailchimp_webhook_registration(uuid,uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.register_mailchimp_webhook_event(uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_mailchimp_webhook_jobs(uuid,integer,integer,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.start_mailchimp_webhook_job(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.read_claimed_mailchimp_webhook_payload(uuid,uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.apply_claimed_mailchimp_inbound_subscription_event(uuid,uuid,bigint,text,text,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.transition_mailchimp_webhook_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;

grant execute on function public.begin_mailchimp_oauth(uuid,uuid,text,uuid,text,text,text[],text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.select_mailchimp_audience(uuid,text,text,text,text,integer,uuid,timestamptz) to authenticated;
grant execute on function public.finalize_mailchimp_oauth(uuid,text,text[],jsonb,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,uuid) to service_role;
grant execute on function public.link_mailchimp_member(uuid,uuid,text,text) to service_role;
grant execute on function public.apply_mailchimp_inbound_subscription_event(uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.read_mailchimp_job_binding(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.record_mailchimp_outbound_sync_evidence(uuid,uuid,bigint,text,text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.store_mailchimp_sync_checkpoint(uuid,uuid,bigint,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.read_mailchimp_sync_checkpoint(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.ensure_mailchimp_sync_policy(uuid,uuid,timestamptz) to authenticated;
grant execute on function public.read_mailchimp_access_token(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.complete_mailchimp_audience_baseline(uuid,uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.confirm_mailchimp_webhook_registration(uuid,uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.register_mailchimp_webhook_event(uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer) to service_role;
grant execute on function public.claim_mailchimp_webhook_jobs(uuid,integer,integer,timestamptz) to service_role;
grant execute on function public.start_mailchimp_webhook_job(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.read_claimed_mailchimp_webhook_payload(uuid,uuid,bigint,timestamptz) to service_role;
grant execute on function public.apply_claimed_mailchimp_inbound_subscription_event(uuid,uuid,bigint,text,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.transition_mailchimp_webhook_job(uuid,uuid,bigint,text,text,timestamptz,timestamptz) to service_role;

do $$
declare target_table text;
begin
  foreach target_table in array array['mailchimp_audience_bindings','mailchimp_member_links','mailchimp_subscription_authority','mailchimp_sync_evidence','mailchimp_webhook_jobs'] loop
    if not exists (select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=target_table
        and relation.relrowsecurity and relation.relforcerowsecurity) then
      raise exception 'Mailchimp table % must force RLS',target_table;
    end if;
    if has_table_privilege('authenticated','public.'||target_table,'INSERT')
       or has_table_privilege('authenticated','public.'||target_table,'UPDATE')
       or has_table_privilege('authenticated','public.'||target_table,'DELETE') then
      raise exception 'authenticated has direct Mailchimp mutation on %',target_table;
    end if;
  end loop;
end;
$$;

comment on table public.mailchimp_audience_bindings is 'Redacted historical Mailchimp audience selection; exactly one active audience per connection.';
comment on table public.mailchimp_member_links is 'Provider member/subscriber hashes bound to one canonical workspace email point; raw email is not duplicated.';
comment on table public.mailchimp_subscription_authority is 'Current provider subscription authority; unsubscribe locks block ordinary automatic resubscription.';
comment on table public.mailchimp_sync_evidence is 'Append-only redacted origin/loop/idempotency evidence without raw email or provider bodies.';
comment on table public.mailchimp_webhook_jobs is 'Durable encrypted-payload Mailchimp webhook queue with bounded claims, leases, fencing, retries and review terminal state.';
comment on function public.apply_mailchimp_inbound_subscription_event(uuid,text,uuid,text,text,text,text,text,text,uuid,timestamptz) is 'Service-only atomic verified inbound identity/subscription application. Ambiguous, archived and out-of-order events record review with no contact mutation.';
comment on function public.read_mailchimp_job_binding(uuid,uuid,bigint,timestamptz) is 'Lease/fence-bound selected audience metadata used to prevent payload-selected data center or audience routing.';
comment on function public.read_mailchimp_access_token(uuid,uuid,uuid,uuid) is 'Service-only encrypted Mailchimp token read bound to an explicitly authenticated active owner identity and membership.';
comment on function public.register_mailchimp_webhook_event(uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer) is 'Fast verified Mailchimp delivery registration and durable queue enqueue; raw provider bodies remain encrypted in connector_private.';

commit;
