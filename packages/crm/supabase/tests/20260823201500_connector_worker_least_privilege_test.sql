begin;
select plan(6);

create temporary table expected_service_functions(signature text primary key) on commit drop;
insert into expected_service_functions(signature) values
  ('public.record_connector_connection_state(uuid,public.connector_connection_status,text,text[],jsonb,timestamp with time zone,text,uuid)'),
  ('public.store_connector_payload_envelope(uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text)'),
  ('public.store_connector_connection_secret(uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamp with time zone,timestamp with time zone)'),
  ('public.destroy_connector_connection_secret(uuid,text,integer,timestamp with time zone)'),
  ('public.create_connector_oauth_transaction(uuid,uuid,text,text,text,text[],uuid,uuid,text,text,text,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamp with time zone)'),
  ('public.consume_connector_oauth_transaction(text,uuid,uuid,uuid,text,text,timestamp with time zone)'),
  ('public.store_connector_sync_cursor(uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,timestamp with time zone)'),
  ('public.bind_connector_webhook_endpoint(uuid,text)'),
  ('public.resolve_connector_webhook_endpoint(text,text)'),
  ('public.claim_connector_jobs(uuid,integer,integer,timestamp with time zone)'),
  ('public.start_connector_job_attempt(uuid,uuid,bigint,timestamp with time zone)'),
  ('public.claim_connector_reconciliation_jobs(uuid,integer,integer,timestamp with time zone)'),
  ('public.transition_connector_job(uuid,uuid,bigint,public.connector_job_state,public.connector_receipt_event_type,text,text,text,text,text,timestamp with time zone,jsonb,timestamp with time zone)'),
  ('public.sweep_expired_connector_job_leases(integer,timestamp with time zone)'),
  ('public.read_connector_job_payload_envelope(uuid,uuid,bigint,timestamp with time zone)'),
  ('public.read_connector_job_secret_envelope(uuid,uuid,bigint,text,timestamp with time zone)'),
  ('public.register_connector_webhook_delivery(uuid,text,text,boolean,boolean,timestamp with time zone,uuid,text)'),
  ('public.mark_connector_webhook_delivery_processed(uuid,timestamp with time zone,text)');

select is(
  (select count(*)::integer from expected_service_functions where has_function_privilege('anon', signature, 'EXECUTE')),
  0,
  'anonymous clients cannot execute connector worker authority'
);

select is(
  (select count(*)::integer from expected_service_functions where has_function_privilege('authenticated', signature, 'EXECUTE')),
  0,
  'authenticated clients cannot execute connector worker authority'
);

select is(
  (select count(*)::integer from expected_service_functions where has_function_privilege('service_role', signature, 'EXECUTE')),
  (select count(*)::integer from expected_service_functions),
  'service role retains every required connector worker function'
);

select is(
  (
    select count(*)::integer
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) acl
    where defaults.defaclobjtype = 'f'
      and defaults.defaclnamespace = 'public'::regnamespace
      and defaults.defaclrole = current_user::regrole
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
  ),
  0,
  'future public-schema functions are not executable by end-user roles by default'
);

select ok(
  has_table_privilege('authenticated', 'public.contacts', 'SELECT')
    and has_table_privilege('authenticated', 'public.contacts', 'INSERT')
    and has_table_privilege('authenticated', 'public.contacts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.contacts', 'DELETE')
    and not has_table_privilege('anon', 'public.contacts', 'DELETE')
    and not has_table_privilege('public', 'public.contacts', 'DELETE'),
  'authenticated contact repository has read/write but no permanent-delete authority'
);

select ok(
  has_table_privilege('authenticated', 'public.contact_external_links', 'SELECT')
    and has_table_privilege('authenticated', 'public.contact_external_links', 'INSERT')
    and has_table_privilege('authenticated', 'public.mailers', 'SELECT')
    and has_table_privilege('authenticated', 'public.mailer_sends', 'DELETE'),
  'authenticated import and mailer repositories have their explicit minimum table contract'
);

select * from finish();
rollback;
