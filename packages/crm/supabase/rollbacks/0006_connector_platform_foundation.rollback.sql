-- Omnix Story 3.5 manual rollback — PRE-WRITE WINDOW ONLY.
--
-- This rollback destroys connector metadata, encrypted envelopes, approvals,
-- jobs and receipts. It refuses to run after any connector row exists. After
-- writes begin, disable enqueue/providers and use PITR or a separately approved
-- forward reconciliation migration instead.

begin;

do $$
begin
  if exists (select 1 from public.connector_connections limit 1)
     or exists (select 1 from public.connector_automation_policies limit 1)
     or exists (select 1 from public.connector_action_intents limit 1)
     or exists (select 1 from public.connector_approval_events limit 1)
     or exists (select 1 from public.connector_jobs limit 1)
     or exists (select 1 from public.connector_receipt_events limit 1)
     or exists (select 1 from public.connector_webhook_deliveries limit 1)
     or exists (select 1 from connector_private.connector_connection_secrets limit 1)
     or exists (select 1 from connector_private.connector_oauth_transactions limit 1)
     or exists (select 1 from connector_private.connector_payload_envelopes limit 1)
     or exists (select 1 from connector_private.connector_sync_cursors limit 1)
     or exists (select 1 from connector_private.connector_webhook_bindings limit 1) then
    raise exception '0006 rollback is restricted to the pre-write window; use PITR/forward reconciliation';
  end if;
end;
$$;

drop function if exists public.mark_connector_webhook_delivery_processed(uuid, timestamptz, text);
drop function if exists public.register_connector_webhook_delivery(uuid, text, text, boolean, boolean, timestamptz, uuid, text);
drop function if exists public.read_connector_job_secret_envelope(uuid, uuid, bigint, text, timestamptz);
drop function if exists public.read_connector_job_payload_envelope(uuid, uuid, bigint, timestamptz);
drop function if exists public.retry_connector_job(uuid, uuid, timestamptz);
drop function if exists public.cancel_connector_job(uuid, uuid, timestamptz);
drop function if exists public.sweep_expired_connector_job_leases(integer, timestamptz);
drop function if exists public.transition_connector_job(
  uuid, uuid, bigint, connector_job_state, connector_receipt_event_type,
  text, text, text, text, text, timestamptz, jsonb, timestamptz
);
drop function if exists public.claim_connector_reconciliation_jobs(uuid, integer, integer, timestamptz);
drop function if exists public.start_connector_job_attempt(uuid, uuid, bigint, timestamptz);
drop function if exists public.claim_connector_jobs(uuid, integer, integer, timestamptz);
drop function if exists public.resolve_connector_webhook_endpoint(text, text);
drop function if exists public.bind_connector_webhook_endpoint(uuid, text);
drop function if exists public.store_connector_sync_cursor(
  uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea,
  text, text, timestamptz
);
drop function if exists public.consume_connector_oauth_transaction(
  text, uuid, uuid, uuid, text, text, timestamptz
);
drop function if exists public.create_connector_oauth_transaction(
  uuid, uuid, text, text, text, text[], uuid, uuid, text, text, text,
  bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz
);
drop function if exists public.destroy_connector_connection_secret(uuid, text, integer, timestamptz);
drop function if exists public.store_connector_connection_secret(
  uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea,
  text, text, timestamptz, timestamptz
);
drop function if exists public.store_connector_payload_envelope(
  uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text
);
drop function if exists public.record_connector_connection_state(
  uuid, connector_connection_status, text, text[], jsonb, timestamptz, text, uuid
);
drop function if exists public.approve_and_enqueue_connector_action(
  uuid, integer, text, text, uuid, timestamptz, integer
);
drop function if exists public.reject_connector_action_intent(uuid, integer, text, text, uuid);
drop function if exists public.revise_connector_action_intent(
  uuid, integer, text, uuid, text, uuid, integer, jsonb, uuid
);
drop function if exists public.create_connector_action_intent(
  uuid, text, text, uuid, text, uuid, integer, jsonb, uuid
);
drop function if exists public.create_connector_automation_policy(
  uuid, text, text[], jsonb, jsonb, jsonb, uuid
);
drop function if exists public.request_connector_disconnect(uuid, uuid);
drop function if exists public.create_connector_connection(uuid, text, text, uuid);

drop function if exists public.connector_current_membership(uuid, boolean);

drop table if exists public.connector_receipt_events;
drop table if exists public.connector_webhook_deliveries;
drop table if exists public.connector_jobs;
drop table if exists public.connector_approval_events;
drop table if exists public.connector_action_intent_versions;
drop table if exists public.connector_action_intents;
drop table if exists public.connector_automation_policies;

drop function if exists public.prepare_connector_receipt_insert();
drop function if exists public.prepare_connector_job_update();
drop function if exists public.prepare_connector_action_intent_update();
drop function if exists public.guard_connector_append_only();

drop table if exists connector_private.connector_connection_secrets;
drop table if exists connector_private.connector_oauth_transactions;
drop table if exists connector_private.connector_sync_cursors;
drop table if exists connector_private.connector_webhook_bindings;
drop table if exists connector_private.connector_payload_envelopes;

drop table if exists public.connector_connections;
drop function if exists public.prepare_connector_connection_update();
drop schema if exists connector_private;

drop type if exists connector_approval_mode;
drop type if exists connector_receipt_event_type;
drop type if exists connector_job_state;
drop type if exists connector_approval_decision;
drop type if exists connector_action_intent_state;
drop type if exists connector_connection_status;

commit;
