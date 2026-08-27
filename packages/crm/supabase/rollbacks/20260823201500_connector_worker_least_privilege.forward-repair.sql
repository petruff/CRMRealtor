-- Forward repair for Story 3.29 containment. This idempotently restores the
-- service-only connector execution boundary without changing CRM data.

begin;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

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

do $$
declare
  protected_function regprocedure;
  protected_functions regprocedure[] := array[
    'public.record_connector_connection_state(uuid,connector_connection_status,text,text[],jsonb,timestamptz,text,uuid)'::regprocedure,
    'public.store_connector_payload_envelope(uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text)'::regprocedure,
    'public.store_connector_connection_secret(uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz,timestamptz)'::regprocedure,
    'public.destroy_connector_connection_secret(uuid,text,integer,timestamptz)'::regprocedure,
    'public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)'::regprocedure,
    'public.consume_connector_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure,
    'public.store_connector_sync_cursor(uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamptz)'::regprocedure,
    'public.bind_connector_webhook_endpoint(uuid,text)'::regprocedure,
    'public.resolve_connector_webhook_endpoint(text,text)'::regprocedure,
    'public.claim_connector_jobs(uuid,integer,integer,timestamptz)'::regprocedure,
    'public.start_connector_job_attempt(uuid,uuid,bigint,timestamptz)'::regprocedure,
    'public.claim_connector_reconciliation_jobs(uuid,integer,integer,timestamptz)'::regprocedure,
    'public.transition_connector_job(uuid,uuid,bigint,connector_job_state,connector_receipt_event_type,text,text,text,text,text,timestamptz,jsonb,timestamptz)'::regprocedure,
    'public.sweep_expired_connector_job_leases(integer,timestamptz)'::regprocedure,
    'public.read_connector_job_payload_envelope(uuid,uuid,bigint,timestamptz)'::regprocedure,
    'public.read_connector_job_secret_envelope(uuid,uuid,bigint,text,timestamptz)'::regprocedure,
    'public.register_connector_webhook_delivery(uuid,text,text,boolean,boolean,timestamptz,uuid,text)'::regprocedure,
    'public.mark_connector_webhook_delivery_processed(uuid,timestamptz,text)'::regprocedure
  ];
begin
  foreach protected_function in array protected_functions loop
    if has_function_privilege('public', protected_function, 'EXECUTE')
       or has_function_privilege('anon', protected_function, 'EXECUTE')
       or has_function_privilege('authenticated', protected_function, 'EXECUTE')
       or not has_function_privilege('service_role', protected_function, 'EXECUTE') then
      raise exception 'forward repair did not restore service-only execution for %', protected_function;
    end if;
  end loop;
end;
$$;

commit;
