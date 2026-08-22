-- Manual rollback for 0014_google_connector_authority.sql.
-- PRE-WRITE ONLY. Once Google OAuth, a draft, provider resource, cursor,
-- task sync or receipt exists, preserve the authority graph and use PITR or a
-- reviewed forward migration.

begin;

do $$
begin
  if exists(select 1 from public.connector_connections where provider='google')
     or exists(select 1 from connector_private.connector_oauth_transactions where provider='google')
     or exists(select 1 from connector_private.connector_connection_secrets
       where secret_type in ('google-access-token','google-refresh-token'))
     or exists(select 1 from connector_private.connector_sync_cursors
       where stream_key in ('google.gmail-history','google.calendar-events'))
     or exists(select 1 from public.google_connection_capabilities)
     or exists(select 1 from public.google_oauth_completions)
     or exists(select 1 from public.google_sync_health)
     or exists(select 1 from public.google_calendar_task_states)
     or exists(select 1 from public.google_gmail_metadata_reviews)
     or exists(select 1 from public.google_email_drafts)
     or exists(select 1 from public.google_email_draft_versions)
     or exists(select 1 from connector_private.google_gmail_resources)
     or exists(select 1 from connector_private.google_calendar_resources)
     or exists(select 1 from connector_private.google_calendar_task_resources)
     or exists(select 1 from connector_private.google_gmail_watch_resources)
     or exists(select 1 from public.connector_receipt_events where provider='google')
     or exists(select 1 from public.activity_events
       where type::text in ('email-metadata-linked','email-sent')) then
    raise exception '0014 rollback refused after Google authority/evidence writes; use PITR or a reviewed forward migration'
      using errcode='55000';
  end if;
end;
$$;

drop trigger if exists connector_connections_google_disconnect_state on public.connector_connections;
drop function if exists public.prepare_google_disconnect_state();

drop function if exists public.bind_google_gmail_metadata_resource(
  uuid,uuid,bigint,text,text,text,text,text,text[],timestamptz,text,timestamptz
);
drop function if exists public.bind_google_gmail_send_resource(
  uuid,uuid,bigint,text,text,text,timestamptz
);
drop function if exists public.record_google_calendar_task_conflict(
  uuid,uuid,bigint,uuid,integer,text,text,timestamptz,timestamptz
);
drop function if exists public.bind_google_task_event_resource(
  uuid,uuid,bigint,uuid,integer,text,text,text,timestamptz,timestamptz
);
drop function if exists public.bind_google_calendar_resource(
  uuid,uuid,bigint,text,text,text,timestamptz
);
drop function if exists public.bind_google_gmail_watch_resource(
  uuid,uuid,bigint,text,text,timestamptz,timestamptz
);
drop function if exists public.mark_google_sync_cursor_expired(
  uuid,uuid,bigint,text,integer,text,timestamptz
);
drop function if exists public.commit_google_sync_checkpoint(
  uuid,uuid,bigint,text,integer,jsonb,text,boolean,timestamptz,timestamptz
);
drop function if exists public.refresh_google_job_access_token(
  uuid,uuid,bigint,integer,jsonb,timestamptz
);
drop function if exists public.read_google_job_authority(uuid,uuid,bigint,timestamptz);
drop function if exists public.prepare_google_gmail_send_intent(uuid,integer,text,uuid,timestamptz);
drop function if exists public.archive_google_email_draft(uuid,integer,uuid,timestamptz);
drop function if exists public.edit_google_email_draft(uuid,integer,text,text,jsonb,uuid,timestamptz);
drop function if exists public.create_google_email_draft(uuid,uuid,uuid,uuid,text,text,text,jsonb,uuid,timestamptz);
drop function if exists public.read_google_connection_capability_state(uuid);
drop function if exists public.finalize_google_oauth(
  uuid,uuid,uuid,uuid,text,text,text[],integer,jsonb,integer,jsonb,uuid,timestamptz
);
drop function if exists public.consume_google_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz);
drop function if exists public.begin_google_oauth(
  uuid,uuid,text,uuid,text,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,
  text,text,timestamptz,timestamptz
);

drop table if exists connector_private.google_gmail_watch_resources;
drop table if exists connector_private.google_calendar_task_resources;
drop table if exists connector_private.google_calendar_resources;
drop table if exists connector_private.google_gmail_resources;
drop table if exists public.google_email_draft_versions;
drop table if exists public.google_email_drafts;
drop table if exists public.google_gmail_metadata_reviews;
drop table if exists public.google_calendar_task_states;
drop table if exists public.google_sync_health;
drop table if exists public.google_oauth_completions;
drop table if exists public.google_connection_capabilities;

drop function if exists connector_private.store_google_draft_payload(uuid,uuid,integer,text,jsonb,timestamptz);
drop function if exists connector_private.upsert_google_secret(uuid,text,integer,jsonb,timestamptz);
drop function if exists connector_private.google_authorized_job(uuid,uuid,bigint,timestamptz);
drop function if exists connector_private.ensure_google_action_policies(uuid,uuid,text[],uuid,timestamptz);
drop function if exists connector_private.google_stream_for_action(text);
drop function if exists connector_private.google_bundle_for_action(text);
drop function if exists connector_private.google_bundle_scopes(text);

drop trigger if exists zz_tasks_google_version on public.tasks;
drop function if exists public.prepare_google_task_version();
alter table public.tasks drop constraint if exists tasks_task_version_positive;
alter table public.tasks drop column if exists task_version;

alter table public.activity_events drop constraint activity_events_target_shape;
alter table public.activity_events add constraint activity_events_target_shape check (
  (type in (
    'contact-created','contact-updated','contact-imported','note-added','touch-recorded',
    'contact-archived','contact-restored','contact-point-added','contact-point-updated',
    'contact-point-archived','contact-point-restored','relationship-updated','assignment-updated'
  ) and contact_id is not null and task_id is null and incomplete_record_id is null)
  or (type in ('household-updated','custom-field-updated')
    and task_id is null and incomplete_record_id is null)
  or (type='incomplete-record-converted' and contact_id is not null
    and task_id is null and incomplete_record_id is not null)
  or (type::text='incomplete-record-received' and contact_id is null
    and task_id is null and incomplete_record_id is not null)
  or (type in ('task-created','task-completed','task-archived')
    and task_id is not null and incomplete_record_id is null)
);

commit;

-- Deliberately retained enum labels: email-metadata-linked, email-sent,
-- oauth.token-refreshed and gmail.send-linked. PostgreSQL enum value removal
-- is not a safe rollback operation.
