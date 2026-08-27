-- Story 3.29 — make the connector execution plane service-only.
-- Existing client-facing connector RPCs keep their intentional authenticated
-- grants. Internal worker, envelope and webhook authority never does.

begin;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- Core browser reads/writes were previously relying on hosted-project ACL
-- defaults that are not reproduced by a clean local project. Declare the
-- repository contract explicitly while RLS remains the row authority.
revoke delete on table public.contacts from public, anon, authenticated;
grant select, insert, update on table public.contacts to authenticated;
grant select on table public.contacts to service_role;
grant select on table public.incomplete_records to service_role;
grant select on table public.activity_events to service_role;
grant select, insert on table public.contact_external_links to authenticated;
grant select, insert, update, delete on table public.contact_intake_receipts to authenticated;
grant select, insert on table public.mailers to authenticated;
grant select, insert, update, delete on table public.mailer_sends to authenticated;

grant execute on function public.is_valid_contact_phone(text) to authenticated, service_role;
grant execute on function public.is_valid_contact_email(text) to authenticated, service_role;
grant execute on function public.is_valid_rich_buyer_criteria(jsonb) to authenticated, service_role;
grant execute on function public.is_valid_rich_seller_criteria(jsonb) to authenticated, service_role;

revoke all on function public.record_connector_connection_state(uuid, connector_connection_status, text, text[], jsonb, timestamptz, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.store_connector_payload_envelope(uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text) from public, anon, authenticated, service_role;
revoke all on function public.store_connector_connection_secret(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.destroy_connector_connection_secret(uuid, text, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.create_connector_oauth_transaction(uuid, uuid, text, text, text, text[], uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.consume_connector_oauth_transaction(text, uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.store_connector_sync_cursor(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.bind_connector_webhook_endpoint(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_connector_webhook_endpoint(text, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.start_connector_job_attempt(uuid, uuid, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.claim_connector_reconciliation_jobs(uuid, integer, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.transition_connector_job(uuid, uuid, bigint, connector_job_state, connector_receipt_event_type, text, text, text, text, text, timestamptz, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.sweep_expired_connector_job_leases(integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.read_connector_job_payload_envelope(uuid, uuid, bigint, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.read_connector_job_secret_envelope(uuid, uuid, bigint, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.register_connector_webhook_delivery(uuid, text, text, boolean, boolean, timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_connector_webhook_delivery_processed(uuid, timestamptz, text) from public, anon, authenticated, service_role;

grant execute on function public.record_connector_connection_state(uuid, connector_connection_status, text, text[], jsonb, timestamptz, text, uuid) to service_role;
grant execute on function public.store_connector_payload_envelope(uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text) to service_role;
grant execute on function public.store_connector_connection_secret(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.destroy_connector_connection_secret(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.create_connector_oauth_transaction(uuid, uuid, text, text, text, text[], uuid, uuid, text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) to service_role;
grant execute on function public.consume_connector_oauth_transaction(text, uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.store_connector_sync_cursor(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz) to service_role;
grant execute on function public.bind_connector_webhook_endpoint(uuid, text) to service_role;
grant execute on function public.resolve_connector_webhook_endpoint(text, text) to service_role;
grant execute on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.start_connector_job_attempt(uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function public.claim_connector_reconciliation_jobs(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.transition_connector_job(uuid, uuid, bigint, connector_job_state, connector_receipt_event_type, text, text, text, text, text, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.sweep_expired_connector_job_leases(integer, timestamptz) to service_role;
grant execute on function public.read_connector_job_payload_envelope(uuid, uuid, bigint, timestamptz) to service_role;
grant execute on function public.read_connector_job_secret_envelope(uuid, uuid, bigint, text, timestamptz) to service_role;
grant execute on function public.register_connector_webhook_delivery(uuid, text, text, boolean, boolean, timestamptz, uuid, text) to service_role;
grant execute on function public.mark_connector_webhook_delivery_processed(uuid, timestamptz, text) to service_role;

comment on function public.claim_connector_jobs(uuid, integer, integer, timestamptz) is
  'Service-only worker lease authority. End-user roles must never receive EXECUTE.';
comment on function public.store_connector_connection_secret(uuid, text, integer, bytea, bytea, bytea, bytea, bytea, bytea, text, text, timestamptz, timestamptz) is
  'Service-only encrypted connector secret writer. End-user roles must never receive EXECUTE.';
comment on function public.read_connector_job_secret_envelope(uuid, uuid, bigint, text, timestamptz) is
  'Service-only leased-job secret reader. End-user roles must never receive EXECUTE.';

comment on table public.contacts is
  'Workspace-scoped CRM contacts. Authenticated CRUD is limited to SELECT/INSERT/UPDATE and enforced by RLS; permanent delete remains unavailable.';

commit;
