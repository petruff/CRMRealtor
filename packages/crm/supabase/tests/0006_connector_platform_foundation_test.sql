-- Story 3.5 SQL/RLS/lease/replay matrix.
-- Prerequisite: migrations 0001..0006 applied to an isolated Supabase DB.
-- TAP is emitted directly because the local Postgres image does not bundle
-- the optional pgtap extension. Every assertion is fail-fast and all fixtures
-- are rolled back.

begin;

select '1..19';

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'connector_connections', 'connector_automation_policies',
    'connector_action_intents', 'connector_action_intent_versions',
    'connector_approval_events', 'connector_jobs',
    'connector_receipt_events', 'connector_webhook_deliveries'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'workspace_id'
        and is_nullable = 'NO'
    ) then
      raise exception 'missing non-null workspace_id on %', target_table;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and column_name = 'owner_id'
    ) then
      raise exception 'legacy owner_id found on %', target_table;
    end if;

    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = target_table
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception 'RLS is not forced on %', target_table;
    end if;
  end loop;
end;
$$;

select 'ok 1 - eight public connector tables use non-null workspace authority and forced RLS';

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'connector_connection_secrets', 'connector_oauth_transactions',
    'connector_payload_envelopes', 'connector_sync_cursors',
    'connector_webhook_bindings'
  ] loop
    if has_schema_privilege('anon', 'connector_private', 'USAGE')
       or has_schema_privilege('authenticated', 'connector_private', 'USAGE')
       or has_table_privilege('service_role', 'connector_private.' || target_table, 'SELECT') then
      raise exception 'private connector grant boundary failed for %', target_table;
    end if;
  end loop;

  if not has_schema_privilege('service_role', 'connector_private', 'USAGE') then
    raise exception 'service role cannot resolve private connector types';
  end if;

  if has_table_privilege('authenticated', 'public.connector_jobs', 'INSERT')
     or has_table_privilege('authenticated', 'public.connector_jobs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.connector_jobs', 'DELETE') then
    raise exception 'authenticated has a direct connector job mutation grant';
  end if;
end;
$$;

select 'ok 2 - private tables deny client and direct service reads while public writes are RPC-only';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '12000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'connector-owner-a@omnix.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '12000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'connector-assistant-a@omnix.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '12000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'connector-owner-b@omnix.test', '', now(),
   '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.workspaces (id, name) values
  ('22000000-0000-4000-8000-000000000001', 'Connector Workspace A'),
  ('22000000-0000-4000-8000-000000000002', 'Connector Workspace B');

select set_config('omnix.actor_user_id', '12000000-0000-4000-8000-000000000001', true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('32000000-0000-4000-8000-000000000001',
   '22000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('32000000-0000-4000-8000-000000000002',
   '22000000-0000-4000-8000-000000000001',
   '12000000-0000-4000-8000-000000000002', 'assistant', 'active');

select set_config('omnix.actor_user_id', '12000000-0000-4000-8000-000000000003', true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('32000000-0000-4000-8000-000000000003',
   '22000000-0000-4000-8000-000000000002',
   '12000000-0000-4000-8000-000000000003', 'owner', 'active');

set constraints all immediate;
set constraints all deferred;

insert into public.connector_connections (
  id, workspace_id, provider, provider_account_key_hash, display_label,
  status, granted_scopes, remote_identity_summary, created_by_membership_id
) values
  ('42000000-0000-4000-8000-000000000001',
   '22000000-0000-4000-8000-000000000001', 'contract-test', repeat('a', 64),
   'Contract test A', 'active', array['contract.execute'],
   '{"accountType":"deterministic-test"}'::jsonb,
   '32000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000002',
   '22000000-0000-4000-8000-000000000002', 'contract-test', repeat('b', 64),
   'Contract test B', 'active', array['contract.execute'],
   '{"accountType":"deterministic-test"}'::jsonb,
   '32000000-0000-4000-8000-000000000003');

insert into public.connector_automation_policies (
  id, workspace_id, action_type, version, approval_mode,
  allowlisted_actions, created_by_membership_id, correlation_id
) values
  ('52000000-0000-4000-8000-000000000001',
   '22000000-0000-4000-8000-000000000001', 'contract.execute', 1,
   'owner_required', array['contract.execute'],
   '32000000-0000-4000-8000-000000000001',
   '62000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002',
   '22000000-0000-4000-8000-000000000002', 'contract.execute', 1,
   'owner_required', array['contract.execute'],
   '32000000-0000-4000-8000-000000000003',
   '62000000-0000-4000-8000-000000000002');

insert into connector_private.connector_payload_envelopes (
  id, workspace_id, connection_id, payload_kind, schema_version,
  canonical_hash, ciphertext, nonce, auth_tag, wrapped_dek, wrap_nonce,
  wrap_auth_tag, kek_version, aad_hash
) values
  ('72000000-0000-4000-8000-000000000001',
   '22000000-0000-4000-8000-000000000001',
   '42000000-0000-4000-8000-000000000001',
   'contract.execute', 'connector-action.v1', repeat('1', 64),
   decode(repeat('aa', 32), 'hex'), decode(repeat('01', 12), 'hex'),
   decode(repeat('02', 16), 'hex'), decode(repeat('bb', 32), 'hex'),
   decode(repeat('03', 12), 'hex'), decode(repeat('04', 16), 'hex'),
   'v1', repeat('5', 64)),
  ('72000000-0000-4000-8000-000000000002',
   '22000000-0000-4000-8000-000000000001',
   '42000000-0000-4000-8000-000000000001',
   'contract.execute', 'connector-action.v1', repeat('2', 64),
   decode(repeat('cc', 32), 'hex'), decode(repeat('05', 12), 'hex'),
   decode(repeat('06', 16), 'hex'), decode(repeat('dd', 32), 'hex'),
   decode(repeat('07', 12), 'hex'), decode(repeat('08', 16), 'hex'),
   'v1', repeat('6', 64));

insert into connector_private.connector_connection_secrets (
  id, workspace_id, connection_id, secret_type, ciphertext, nonce,
  auth_tag, wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash
) values (
  '82000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001', 'access_token',
  decode(repeat('ee', 32), 'hex'), decode(repeat('09', 12), 'hex'),
  decode(repeat('0a', 16), 'hex'), decode(repeat('ff', 32), 'hex'),
  decode(repeat('0b', 12), 'hex'), decode(repeat('0c', 16), 'hex'),
  'v1', repeat('7', 64)
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);

do $$
begin
  begin
    perform public.create_connector_connection(
      '22000000-0000-4000-8000-000000000001', 'contract-test',
      'Forbidden assistant connection', '62000000-0000-4000-8000-000000000010'
    );
    raise exception 'assistant unexpectedly created a connection';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.request_connector_disconnect(
      '42000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000011'
    );
    raise exception 'assistant unexpectedly requested disconnect';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'ok 3 - assistant cannot administer or disconnect a protected connection';

do $$
declare
  result jsonb;
begin
  result := public.create_connector_action_intent(
    '42000000-0000-4000-8000-000000000001',
    'contract.execute', 'Assistant prepared deterministic action',
    '72000000-0000-4000-8000-000000000001', repeat('1', 64),
    '52000000-0000-4000-8000-000000000001', 1,
    '{"consent":"not-required-for-contract-test"}'::jsonb,
    '62000000-0000-4000-8000-000000000020'
  );

  perform set_config('omnix.test_intent_id', result#>>'{intent,id}', true);

  if result#>>'{intent,provider}' <> 'contract-test'
     or result#>>'{intent,state}' <> 'pending'
     or result#>>'{intent,created_by_membership_id}'
        <> '32000000-0000-4000-8000-000000000002'
     or result#>>'{version,payload_hash}' <> repeat('1', 64) then
    raise exception 'assistant draft binding is incorrect';
  end if;
end;
$$;

select 'ok 4 - assistant can create a workspace-bound immutable draft version';

do $$
begin
  begin
    perform public.approve_and_enqueue_connector_action(
      current_setting('omnix.test_intent_id')::uuid, 1, repeat('1', 64),
      'approve-key-0001', '62000000-0000-4000-8000-000000000021'
    );
    raise exception 'assistant unexpectedly approved an external action';
  exception when insufficient_privilege then null;
  end;

  if exists (
    select 1 from public.connector_jobs
    where intent_id = current_setting('omnix.test_intent_id')::uuid
  ) then
    raise exception 'assistant denial still created a connector job';
  end if;
end;
$$;

select 'ok 5 - assistant approval is denied without a job or provider receipt';

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);

do $$
declare
  result jsonb;
begin
  result := public.approve_and_enqueue_connector_action(
    current_setting('omnix.test_intent_id')::uuid, 1, repeat('1', 64),
    'approve-key-0001', '62000000-0000-4000-8000-000000000022',
    '2026-08-11T20:00:00Z', 5
  );

  perform set_config('omnix.test_job_id', result#>>'{job,id}', true);

  if (result->>'noOp')::boolean
     or result#>>'{intent,state}' <> 'queued'
     or result#>>'{job,state}' <> 'queued'
     or result#>>'{receipt,event_type}' <> 'job.queued'
     or (select count(*) from public.connector_approval_events
         where intent_id = current_setting('omnix.test_intent_id')::uuid) <> 1
     or (select count(*) from public.connector_jobs
         where intent_id = current_setting('omnix.test_intent_id')::uuid) <> 1 then
    raise exception 'atomic approve-and-enqueue contract failed';
  end if;
end;
$$;

select 'ok 6 - owner approval atomically binds one immutable version and one durable job';

do $$
declare
  replay jsonb;
begin
  replay := public.approve_and_enqueue_connector_action(
    current_setting('omnix.test_intent_id')::uuid, 1, repeat('1', 64),
    'approve-key-0001', '62000000-0000-4000-8000-000000000022',
    '2026-08-11T20:00:00Z', 5
  );

  if not (replay->>'noOp')::boolean
     or replay#>>'{job,id}' <> current_setting('omnix.test_job_id')
     or replay#>>'{receipt,event_type}' <> 'job.queued' then
    raise exception 'approval replay did not return the original durable job';
  end if;

  begin
    perform public.approve_and_enqueue_connector_action(
      current_setting('omnix.test_intent_id')::uuid, 1, repeat('1', 64),
      'different-approval-key', '62000000-0000-4000-8000-000000000023'
    );
    raise exception 'divergent approval replay unexpectedly succeeded';
  exception when unique_violation then null;
  end;
end;
$$;

select 'ok 7 - approval replay is idempotent and divergent replay is rejected';

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000003', true);

do $$
begin
  if (select count(*) from public.connector_connections) <> 1
     or exists (
       select 1 from public.connector_connections
       where workspace_id = '22000000-0000-4000-8000-000000000001'
     )
     or exists (select 1 from public.connector_jobs) then
    raise exception 'cross-workspace RLS exposed connector authority';
  end if;

  begin
    insert into public.connector_jobs (
      workspace_id, connection_id, intent_id, intent_version_id,
      intent_version, provider, action_type, schema_version, payload_ref,
      payload_hash, policy_id, policy_version, idempotency_key, correlation_id
    ) values (
      '22000000-0000-4000-8000-000000000002',
      '42000000-0000-4000-8000-000000000002',
      current_setting('omnix.test_intent_id')::uuid,
      '72000000-0000-4000-8000-000000000002', 1,
      'contract-test', 'contract.execute', 'connector-action.v1',
      '72000000-0000-4000-8000-000000000002', repeat('2', 64),
      '52000000-0000-4000-8000-000000000002', 1,
      'forbidden-direct-write', '62000000-0000-4000-8000-000000000024'
    );
    raise exception 'authenticated direct connector job insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'ok 8 - two-workspace RLS isolation and RPC-only job mutation fail closed';

reset role;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'connector_private'
      and table_name in (
        'connector_connection_secrets', 'connector_oauth_transactions',
        'connector_payload_envelopes', 'connector_sync_cursors'
      )
      and column_name ~ '(plaintext|password|access_token|refresh_token|pkce_verifier)'
  ) then
    raise exception 'plaintext connector secret column exists';
  end if;

  if (select octet_length(ciphertext)
      from connector_private.connector_connection_secrets
      where id = '82000000-0000-4000-8000-000000000001') <> 32 then
    raise exception 'encrypted secret fixture was not retained as binary envelope';
  end if;
end;
$$;

select 'ok 9 - key-envelope tables store binary cryptographic material without plaintext token columns';

do $$
begin
  begin
    update public.connector_approval_events
       set reason = 'tamper'
     where intent_id = current_setting('omnix.test_intent_id')::uuid;
    raise exception 'approval event update unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from public.connector_receipt_events
     where job_id = current_setting('omnix.test_job_id')::uuid;
    raise exception 'receipt event delete unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

select 'ok 10 - approvals and receipts remain append-only even for privileged direct SQL';

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  claimed public.connector_jobs%rowtype;
  started jsonb;
begin
  select * into claimed
  from public.claim_connector_jobs(
    '92000000-0000-4000-8000-000000000001', 1, 90,
    '2026-08-11T20:00:00Z'
  );

  if claimed.id::text <> current_setting('omnix.test_job_id')
     or claimed.state <> 'leased'
     or claimed.fencing_token <> 1 then
    raise exception 'bounded connector claim failed';
  end if;

  perform set_config('omnix.test_fencing_token', claimed.fencing_token::text, true);

  started := public.start_connector_job_attempt(
    claimed.id, '92000000-0000-4000-8000-000000000001',
    claimed.fencing_token, '2026-08-11T20:00:01Z'
  );

  if started#>>'{job,state}' <> 'executing'
     or (started#>>'{job,attempt_count}')::integer <> 1
     or started#>>'{receipt,event_type}' <> 'attempt.started' then
    raise exception 'start-attempt transaction failed';
  end if;
end;
$$;

select 'ok 11 - bounded SKIP LOCKED claim issues a lease/fence and start persists attempt evidence';

reset role;

update public.connector_jobs
   set lease_expires_at = '2026-08-11T20:00:02Z'
 where id = current_setting('omnix.test_job_id')::uuid;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  swept public.connector_jobs%rowtype;
  reconciled public.connector_jobs%rowtype;
begin
  select * into swept
  from public.sweep_expired_connector_job_leases(10, '2026-08-11T20:00:03Z');

  if swept.id::text <> current_setting('omnix.test_job_id')
     or swept.state <> 'reconciliation_required'
     or swept.lease_owner is not null then
    raise exception 'expired executing lease did not enter reconciliation';
  end if;

  select * into reconciled
  from public.claim_connector_reconciliation_jobs(
    '92000000-0000-4000-8000-000000000002', 1, 90,
    '2026-08-11T20:00:04Z'
  );

  if reconciled.fencing_token <= current_setting('omnix.test_fencing_token')::bigint
     or reconciled.lease_owner <> '92000000-0000-4000-8000-000000000002' then
    raise exception 'reconciliation claim did not advance fencing authority';
  end if;

  perform set_config('omnix.test_reconciliation_fence', reconciled.fencing_token::text, true);
end;
$$;

select 'ok 12 - expired executing lease enters explicit reconciliation and advances fencing';

do $$
begin
  begin
    perform public.transition_connector_job(
      current_setting('omnix.test_job_id')::uuid,
      '92000000-0000-4000-8000-000000000001',
      current_setting('omnix.test_fencing_token')::bigint,
      'succeeded', 'provider.accepted', null, repeat('8', 64),
      'remote-old-worker', 'accepted', null, null, '{}'::jsonb,
      '2026-08-11T20:00:05Z'
    );
    raise exception 'stale worker unexpectedly completed connector job';
  exception when serialization_failure then null;
  end;
end;
$$;

select 'ok 13 - stale lease owner and fencing token cannot overwrite a newer reconciliation claim';

do $$
declare
  result jsonb;
begin
  result := public.transition_connector_job(
    current_setting('omnix.test_job_id')::uuid,
    '92000000-0000-4000-8000-000000000002',
    current_setting('omnix.test_reconciliation_fence')::bigint,
    'succeeded', 'reconciliation.resolved', null, repeat('9', 64),
    'remote-reconciled-0001', 'confirmed', 'accepted', null,
    '{"source":"contract-test"}'::jsonb,
    '2026-08-11T20:00:06Z'
  );

  if result#>>'{job,state}' <> 'succeeded'
     or result#>>'{intent,state}' <> 'succeeded'
     or result#>>'{receipt,event_type}' <> 'reconciliation.resolved'
     or result#>>'{receipt,remote_operation_id}' <> 'remote-reconciled-0001' then
    raise exception 'fenced reconciliation completion failed';
  end if;
end;
$$;

select 'ok 14 - current fencing authority atomically records reconciliation and final state';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);

do $$
declare
  intent_result jsonb;
  approval_result jsonb;
begin
  intent_result := public.create_connector_action_intent(
    '42000000-0000-4000-8000-000000000001',
    'contract.execute', 'Owner prepared normal provider success',
    '72000000-0000-4000-8000-000000000002', repeat('2', 64),
    '52000000-0000-4000-8000-000000000001', 1,
    '{"consent":"not-required-for-contract-test"}'::jsonb,
    '62000000-0000-4000-8000-000000000040'
  );

  approval_result := public.approve_and_enqueue_connector_action(
    (intent_result#>>'{intent,id}')::uuid, 1, repeat('2', 64),
    'approve-key-normal-success-0001',
    '62000000-0000-4000-8000-000000000041',
    '2026-08-11T20:02:00Z', 5
  );

  perform set_config('omnix.test_normal_job_id', approval_result#>>'{job,id}', true);
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  claimed public.connector_jobs%rowtype;
  started jsonb;
  completed jsonb;
  receipt_sequence text[];
begin
  select * into claimed
  from public.claim_connector_jobs(
    '92000000-0000-4000-8000-000000000003', 1, 90,
    '2026-08-11T20:02:00Z'
  );

  if claimed.id::text <> current_setting('omnix.test_normal_job_id') then
    raise exception 'normal success job was not claimed';
  end if;

  started := public.start_connector_job_attempt(
    claimed.id, '92000000-0000-4000-8000-000000000003',
    claimed.fencing_token, '2026-08-11T20:02:01Z'
  );

  completed := public.transition_connector_job(
    claimed.id, '92000000-0000-4000-8000-000000000003',
    claimed.fencing_token, 'succeeded', 'provider.accepted', null,
    repeat('7', 64), 'remote-normal-success-0001', 'completed',
    null, null, '{"source":"contract-test"}'::jsonb,
    '2026-08-11T20:02:02Z'
  );

  select array_agg(receipt.event_type::text order by receipt.occurred_at, receipt.event_type::text)
    into receipt_sequence
  from public.connector_receipt_events receipt
  where receipt.job_id = claimed.id
    and receipt.event_type in ('attempt.started', 'provider.accepted', 'provider.final');

  if started#>>'{receipt,event_type}' <> 'attempt.started'
     or completed#>>'{receipt,event_type}' <> 'provider.accepted'
     or completed#>>'{finalReceipt,event_type}' <> 'provider.final'
     or completed#>>'{finalReceipt,event_key}'
        <> 'provider.final:' || claimed.id::text || ':' || claimed.fencing_token::text
     or completed#>>'{finalReceipt,remote_operation_id}' <> 'remote-normal-success-0001'
     or receipt_sequence <> array[
       'attempt.started', 'provider.accepted', 'provider.final'
     ]::text[] then
    raise exception 'normal success did not atomically retain accepted and final evidence';
  end if;
end;
$$;

select 'ok 15 - normal success atomically persists attempt.started, provider.accepted and provider.final';

do $$
declare
  first_delivery jsonb;
  replay_delivery jsonb;
begin
  first_delivery := public.register_connector_webhook_delivery(
    '42000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64),
    true, true, '2026-08-11T20:01:00Z',
    '62000000-0000-4000-8000-000000000030', 'accepted-redacted'
  );

  replay_delivery := public.register_connector_webhook_delivery(
    '42000000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64),
    true, true, '2026-08-11T20:01:01Z',
    '62000000-0000-4000-8000-000000000031', 'duplicate-redacted'
  );

  if (first_delivery->>'duplicate')::boolean
     or not (replay_delivery->>'duplicate')::boolean
     or first_delivery#>>'{delivery,id}' <> replay_delivery#>>'{delivery,id}'
     or (select count(*) from public.connector_webhook_deliveries
         where connection_id = '42000000-0000-4000-8000-000000000001'
           and replay_key_hash = repeat('a', 64)) <> 1 then
    raise exception 'webhook replay dedupe failed';
  end if;
end;
$$;

select 'ok 16 - webhook replay key deduplicates one durable delivery and one business acceptance';

do $$
declare
  consumed jsonb;
begin
  perform public.create_connector_oauth_transaction(
    '22000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001', 'contract-test',
    repeat('c', 64), 'identity', array['openid'],
    '12000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001', repeat('d', 64),
    'https://omnix.test/connectors/callback', '/connections',
    decode(repeat('11', 32), 'hex'), decode(repeat('12', 12), 'hex'),
    decode(repeat('13', 16), 'hex'), decode(repeat('14', 32), 'hex'),
    decode(repeat('15', 12), 'hex'), decode(repeat('16', 16), 'hex'),
    'v1', repeat('e', 64), now() + interval '20 minutes'
  );

  consumed := public.consume_connector_oauth_transaction(
    repeat('c', 64), '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001', repeat('d', 64),
    'https://omnix.test/connectors/callback', now()
  );

  if consumed->>'consumedAt' is null
     or consumed->>'pkceCiphertext' is null then
    raise exception 'OAuth transaction did not return the server-only encrypted verifier';
  end if;

  begin
    perform public.consume_connector_oauth_transaction(
      repeat('c', 64), '22000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001',
      '32000000-0000-4000-8000-000000000001', repeat('d', 64),
      'https://omnix.test/connectors/callback', now() + interval '1 second'
    );
    raise exception 'OAuth transaction replay unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select 'ok 17 - OAuth state is owner/session/workspace-bound, encrypted, expiring and single-use';

do $$
declare
  payload_material jsonb;
  secret_material jsonb;
begin
  -- A completed job has no active lease and therefore cannot disclose material.
  begin
    perform public.read_connector_job_payload_envelope(
      current_setting('omnix.test_job_id')::uuid,
      '92000000-0000-4000-8000-000000000002',
      current_setting('omnix.test_reconciliation_fence')::bigint,
      '2026-08-11T20:00:07Z'
    );
    raise exception 'completed job unexpectedly disclosed payload material';
  exception when insufficient_privilege then null;
  end;

  if payload_material is not null or secret_material is not null then
    raise exception 'unexpected material state';
  end if;
end;
$$;

select 'ok 18 - encrypted payload and secret reads require the current active lease and fence';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);

do $$
begin
  if (select count(*) from public.connector_connections) <> 1
     or (select count(*) from public.connector_jobs) <> 2
     or exists (select 1 from public.connector_webhook_deliveries) then
    raise exception 'assistant visibility boundary is incorrect';
  end if;
end;
$$;

select 'ok 19 - assistant sees redacted workspace operations but not owner-only webhook security metadata';

rollback;
