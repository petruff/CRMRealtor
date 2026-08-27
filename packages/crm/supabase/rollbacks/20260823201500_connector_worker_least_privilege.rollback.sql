-- Emergency compatibility rollback for Story 3.29.
-- WARNING: this restores the pre-hardening end-user execution posture. Use
-- only after an explicit incident decision; a database restore is preferred.

begin;

alter default privileges in schema public
  grant execute on functions to public;

-- Core table grants are declarative compatibility contracts and may predate
-- this migration in hosted environments. They are intentionally retained by
-- this compensating rollback; use the verified pre-release dump for exact ACL
-- restoration when those grants also need to be reverted.

grant execute on function public.record_connector_connection_state(uuid, connector_connection_status, text, text[], jsonb, timestamptz, text, uuid) to public, anon, authenticated;
grant execute on function public.store_connector_payload_envelope(uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text) to public, anon, authenticated;
grant execute on function public.store_connector_connection_secret(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz, timestamptz) to public, anon, authenticated;
grant execute on function public.destroy_connector_connection_secret(uuid, text, integer, timestamptz) to public, anon, authenticated;
grant execute on function public.create_connector_oauth_transaction(uuid, uuid, text, text, text, text[], uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) to public, anon, authenticated;
grant execute on function public.consume_connector_oauth_transaction(text, uuid, uuid, uuid, text, text, timestamptz) to public, anon, authenticated;
grant execute on function public.store_connector_sync_cursor(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) to public, anon, authenticated;
grant execute on function public.bind_connector_webhook_endpoint(uuid, text) to public, anon, authenticated;
grant execute on function public.resolve_connector_webhook_endpoint(text, text) to public, anon, authenticated;
grant execute on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) to public, anon, authenticated;
grant execute on function public.start_connector_job_attempt(uuid, uuid, bigint, timestamptz) to public, anon, authenticated;
grant execute on function public.claim_connector_reconciliation_jobs(uuid, integer, integer, timestamptz) to public, anon, authenticated;
grant execute on function public.transition_connector_job(uuid, uuid, bigint, connector_job_state, connector_receipt_event_type, text, text, text, text, text, timestamptz, jsonb, timestamptz) to public, anon, authenticated;
grant execute on function public.sweep_expired_connector_job_leases(integer, timestamptz) to public, anon, authenticated;
grant execute on function public.read_connector_job_payload_envelope(uuid, uuid, bigint, timestamptz) to public, anon, authenticated;
grant execute on function public.read_connector_job_secret_envelope(uuid, uuid, bigint, text, timestamptz) to public, anon, authenticated;
grant execute on function public.register_connector_webhook_delivery(uuid, text, text, boolean, boolean, timestamptz, uuid, text) to public, anon, authenticated;
grant execute on function public.mark_connector_webhook_delivery_processed(uuid, timestamptz, text) to public, anon, authenticated;

commit;
