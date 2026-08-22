-- Story 3.5 durable live-disconnect security/lease/cryptoshred matrix.
-- Prerequisite: migrations 0001..0009 on an isolated local Supabase DB.
-- TAP is emitted directly; all fixtures roll back.

begin;

select '1..16';

do $$
declare target_function text;
begin
  if not exists (
    select 1 from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'connector_revocation_jobs'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'revocation jobs do not force RLS'; end if;

  if has_table_privilege('authenticated', 'public.connector_revocation_jobs', 'INSERT')
     or has_table_privilege('authenticated', 'public.connector_revocation_jobs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.connector_revocation_jobs', 'DELETE') then
    raise exception 'authenticated has direct revocation job mutation';
  end if;

  foreach target_function in array array[
    'claim_connector_revocation_jobs(uuid,integer,integer,timestamp with time zone)',
    'start_connector_revocation_attempt(uuid,uuid,bigint,timestamp with time zone)',
    'read_connector_revocation_secret_envelope(uuid,uuid,bigint,text,timestamp with time zone)',
    'transition_connector_revocation_job(uuid,uuid,bigint,text,text,timestamp with time zone,jsonb,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', 'public.' || target_function, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || target_function, 'EXECUTE')
       or not has_function_privilege('service_role', 'public.' || target_function, 'EXECUTE') then
      raise exception 'revocation RPC grant mismatch: %', target_function;
    end if;
  end loop;
end;
$$;
select 'ok 1 - durable revocation table forces RLS and worker RPCs are service-only';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','14000000-0000-4000-8000-000000000001','authenticated','authenticated','disconnect-owner-a@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','14000000-0000-4000-8000-000000000002','authenticated','authenticated','disconnect-assistant-a@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','14000000-0000-4000-8000-000000000003','authenticated','authenticated','disconnect-owner-b@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name) values
  ('24000000-0000-4000-8000-000000000001','Disconnect workspace A'),
  ('24000000-0000-4000-8000-000000000002','Disconnect workspace B');

select set_config('omnix.actor_user_id','14000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('34000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','owner','active'),
  ('34000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','14000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('34000000-0000-4000-8000-000000000003','24000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into public.connector_connections (
  id, workspace_id, provider, provider_account_key_hash, display_label,
  status, granted_scopes, remote_identity_summary, created_by_membership_id
) values
  ('44000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','contract-test',repeat('a',64),'Confirmed revoke','active',array['contract.execute'],'{"accountType":"test"}','34000000-0000-4000-8000-000000000001'),
  ('44000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','contract-test',repeat('b',64),'Unconfirmed revoke','active',array['contract.execute'],'{"accountType":"test"}','34000000-0000-4000-8000-000000000001'),
  ('44000000-0000-4000-8000-000000000003','24000000-0000-4000-8000-000000000002','contract-test',repeat('c',64),'Other workspace','active',array['contract.execute'],'{"accountType":"test"}','34000000-0000-4000-8000-000000000003');

insert into public.connector_automation_policies (
  id, workspace_id, action_type, version, approval_mode,
  allowlisted_actions, created_by_membership_id, correlation_id
) values (
  '54000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
  'contract.execute',1,'owner_required',array['contract.execute'],
  '34000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001'
);

insert into connector_private.connector_payload_envelopes (
  id, workspace_id, connection_id, payload_kind, schema_version,
  canonical_hash, ciphertext, nonce, auth_tag, wrapped_dek, wrap_nonce,
  wrap_auth_tag, kek_version, aad_hash
) values
  ('74000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','contract.execute','connector-action.v1',repeat('1',64),decode(repeat('a1',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),decode(repeat('b1',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),'v1',repeat('5',64)),
  ('74000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000002','contract.execute','connector-action.v1',repeat('2',64),decode(repeat('a2',32),'hex'),decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),decode(repeat('b2',32),'hex'),decode(repeat('07',12),'hex'),decode(repeat('08',16),'hex'),'v1',repeat('6',64));

insert into connector_private.connector_connection_secrets (
  id, workspace_id, connection_id, secret_type, ciphertext, nonce, auth_tag,
  wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash
) values
  ('84000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','access_token',decode(repeat('c1',32),'hex'),decode(repeat('09',12),'hex'),decode(repeat('0a',16),'hex'),decode(repeat('d1',32),'hex'),decode(repeat('0b',12),'hex'),decode(repeat('0c',16),'hex'),'v1',repeat('7',64)),
  ('84000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000002','access_token',decode(repeat('c2',32),'hex'),decode(repeat('0d',12),'hex'),decode(repeat('0e',16),'hex'),decode(repeat('d2',32),'hex'),decode(repeat('0f',12),'hex'),decode(repeat('10',16),'hex'),'v1',repeat('8',64));

insert into connector_private.connector_oauth_transactions (
  id, workspace_id, connection_id, provider, state_hash, requested_scope_bundle,
  requested_scopes, actor_user_id, membership_id, session_binding_hash,
  redirect_uri, safe_return_path, pkce_ciphertext, pkce_nonce, pkce_auth_tag,
  pkce_wrapped_dek, pkce_wrap_nonce, pkce_wrap_auth_tag, kek_version, aad_hash,
  expires_at, created_at
) values
  ('94000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','contract-test',repeat('9',64),'contract.oauth',array['contract.execute'],'14000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',repeat('a',64),'https://omnix.test/callback','/connections',decode(repeat('e1',32),'hex'),decode(repeat('11',12),'hex'),decode(repeat('12',16),'hex'),decode(repeat('f1',32),'hex'),decode(repeat('13',12),'hex'),decode(repeat('14',16),'hex'),'v1',repeat('b',64),'2026-08-13T00:00:00Z','2026-08-11T00:00:00Z'),
  ('94000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000002','contract-test',repeat('c',64),'contract.oauth',array['contract.execute'],'14000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',repeat('d',64),'https://omnix.test/callback','/connections',decode(repeat('e2',32),'hex'),decode(repeat('15',12),'hex'),decode(repeat('16',16),'hex'),decode(repeat('f2',32),'hex'),decode(repeat('17',12),'hex'),decode(repeat('18',16),'hex'),'v1',repeat('e',64),'2026-08-13T00:00:00Z','2026-08-11T00:00:00Z');

insert into connector_private.connector_sync_cursors (
  id, workspace_id, connection_id, stream_key, ciphertext, nonce, auth_tag,
  wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash
) values
  ('a4000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','primary',decode(repeat('21',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('23',16),'hex'),decode(repeat('24',32),'hex'),decode(repeat('25',12),'hex'),decode(repeat('26',16),'hex'),'v1',repeat('f',64)),
  ('a4000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000002','primary',decode(repeat('31',32),'hex'),decode(repeat('32',12),'hex'),decode(repeat('33',16),'hex'),decode(repeat('34',32),'hex'),decode(repeat('35',12),'hex'),decode(repeat('36',16),'hex'),'v1',repeat('0',64));

-- Prepare one ordinary queued job so confirmed disconnect can prove that
-- pending provider work is blocked and then cancelled.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000001',true);
do $$
declare intent_result jsonb; job_result jsonb;
begin
  intent_result := public.create_connector_action_intent(
    '44000000-0000-4000-8000-000000000001','contract.execute','Pending before revoke',
    '74000000-0000-4000-8000-000000000001',repeat('1',64),
    '54000000-0000-4000-8000-000000000001',1,'{}','64000000-0000-4000-8000-000000000010'
  );
  job_result := public.approve_and_enqueue_connector_action(
    (intent_result#>>'{intent,id}')::uuid,1,repeat('1',64),
    'disconnect-pending-job','64000000-0000-4000-8000-000000000011',
    '2026-08-11T20:00:00Z',5
  );
  perform set_config('omnix.disconnect_normal_job_id',job_result#>>'{job,id}',true);
end;
$$;

select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000002',true);
do $$
begin
  begin
    perform public.request_connector_disconnect('44000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000020');
    raise exception 'assistant unexpectedly requested revocation';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.connector_revocation_jobs) then
    raise exception 'assistant denial created a durable job';
  end if;
end;
$$;
select 'ok 2 - assistant disconnect is denied atomically';

select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000003',true);
do $$
begin
  begin
    perform public.request_connector_disconnect('44000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000021');
    raise exception 'cross-workspace owner unexpectedly requested revocation';
  exception when insufficient_privilege then null; end;
end;
$$;
select 'ok 3 - cross-workspace owner cannot request revocation';

select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000001',true);
do $$
declare result jsonb;
begin
  result := public.request_connector_disconnect('44000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000022');
  perform set_config('omnix.confirmed_revocation_job_id',result#>>'{revocationJob,id}',true);
  if (result->>'noOp')::boolean
     or result#>>'{connection,status}' <> 'revoking'
     or result#>>'{revocationJob,state}' <> 'queued'
     or result#>>'{receipt,event_type}' <> 'revocation.requested'
     or result#>>'{receipt,provider}' <> 'contract-test'
     or result#>>'{receipt,redacted_metadata,provider}' <> 'contract-test' then
    raise exception 'atomic disconnect contract is incomplete: %',result;
  end if;
end;
$$;
select 'ok 4 - owner request fixes live defect with revoking state, durable job and provider-bound receipt';

do $$
declare replay jsonb;
begin
  replay := public.request_connector_disconnect('44000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000099');
  if not (replay->>'noOp')::boolean
     or replay#>>'{revocationJob,id}' <> current_setting('omnix.confirmed_revocation_job_id')
     or replay#>>'{receipt,event_key}' <> 'revocation.requested:' || current_setting('omnix.confirmed_revocation_job_id')
     or (select count(*) from public.connector_revocation_jobs where connection_id='44000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'disconnect replay diverged';
  end if;
end;
$$;
select 'ok 5 - disconnect replay returns the original receipt and one durable job';

do $$
declare result jsonb;
begin
  result := public.request_connector_disconnect('44000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000023');
  perform set_config('omnix.unconfirmed_revocation_job_id',result#>>'{revocationJob,id}',true);
  begin
    update public.connector_revocation_jobs set scheduled_at=now() where id=(result#>>'{revocationJob,id}')::uuid;
    raise exception 'authenticated directly updated revocation job';
  exception when insufficient_privilege then null; end;
end;
$$;
select 'ok 6 - authenticated clients cannot directly mutate revocation scheduling';

reset role;
update public.connector_revocation_jobs
   set scheduled_at='2026-08-11T20:00:00Z'
 where id=current_setting('omnix.confirmed_revocation_job_id')::uuid;
update public.connector_revocation_jobs
   set scheduled_at='2026-08-11T22:00:00Z'
 where id=current_setting('omnix.unconfirmed_revocation_job_id')::uuid;

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);

do $$
declare count_jobs integer;
begin
  select count(*) into count_jobs from public.claim_connector_jobs('b4000000-0000-4000-8000-000000000001',25,90,'2026-08-11T20:00:00Z');
  if count_jobs <> 0 then raise exception 'normal provider job claimed after revoking'; end if;
  begin
    perform public.record_connector_connection_state('44000000-0000-4000-8000-000000000001','disconnected',repeat('a',64),null,null,null,null,'64000000-0000-4000-8000-000000000024');
    raise exception 'generic state RPC manufactured disconnect';
  exception when insufficient_privilege then null; end;
end;
$$;
select 'ok 7 - revoking blocks ordinary claims and generic state RPC cannot confirm disconnect';

do $$
declare first_claim jsonb; second_claim jsonb;
begin
  first_claim := public.claim_connector_revocation_jobs('b4000000-0000-4000-8000-000000000001',1,90,'2026-08-11T20:00:00Z');
  second_claim := public.claim_connector_revocation_jobs('b4000000-0000-4000-8000-000000000002',1,90,'2026-08-11T20:00:01Z');
  if (first_claim->>'count')::integer <> 1
     or first_claim#>>'{jobs,0,id}' <> current_setting('omnix.confirmed_revocation_job_id')
     or first_claim#>>'{jobs,0,connection,provider}' <> 'contract-test'
     or first_claim#>>'{jobs,0,connection,status}' <> 'revoking'
     or (second_claim->>'count')::integer <> 0 then
    raise exception 'bounded two-worker claim failed: % / %',first_claim,second_claim;
  end if;
end;
$$;
select 'ok 8 - bounded claim returns redacted connection metadata and excludes a second worker';

do $$
declare started jsonb; envelope jsonb;
begin
  started := public.start_connector_revocation_attempt(current_setting('omnix.confirmed_revocation_job_id')::uuid,'b4000000-0000-4000-8000-000000000001',1,'2026-08-11T20:00:02Z');
  envelope := public.read_connector_revocation_secret_envelope(current_setting('omnix.confirmed_revocation_job_id')::uuid,'b4000000-0000-4000-8000-000000000001',1,'access_token','2026-08-11T20:00:03Z');
  if started#>>'{revocationJob,state}' <> 'executing'
     or started#>>'{receipt,event_type}' <> 'attempt.started'
     or started#>>'{receipt,provider}' <> 'contract-test'
     or envelope->>'secretType' <> 'access_token'
     or envelope ? 'plaintext' or envelope ? 'accessToken' then
    raise exception 'attempt/envelope contract failed';
  end if;
end;
$$;
select 'ok 9 - fenced start appends provider receipt and envelope read returns encrypted material only';

do $$
declare result jsonb;
begin
  result := public.transition_connector_revocation_job(current_setting('omnix.confirmed_revocation_job_id')::uuid,'b4000000-0000-4000-8000-000000000001',1,'retry','provider_timeout','2026-08-11T20:05:00Z','{"reasonCode":"timeout"}','2026-08-11T20:00:04Z');
  if result#>>'{revocationJob,state}' <> 'retry_wait'
     or result#>>'{connection,status}' <> 'revoking'
     or result#>>'{receipt,event_type}' <> 'job.retry-scheduled' then
    raise exception 'retry did not preserve recoverable state';
  end if;
end;
$$;
reset role;
do $$ begin
  if (select destroyed_at is not null from connector_private.connector_connection_secrets where id='84000000-0000-4000-8000-000000000001') then
    raise exception 'retry destroyed recoverable credential';
  end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select 'ok 10 - retry schedules a future attempt while preserving credentials';

do $$
declare claim jsonb;
begin
  claim := public.claim_connector_revocation_jobs('b4000000-0000-4000-8000-000000000002',1,90,'2026-08-11T20:05:00Z');
  if claim#>>'{jobs,0,fencingToken}' <> '2' then raise exception 'reclaim did not advance fence'; end if;
  begin
    perform public.start_connector_revocation_attempt(current_setting('omnix.confirmed_revocation_job_id')::uuid,'b4000000-0000-4000-8000-000000000001',1,'2026-08-11T20:05:01Z');
    raise exception 'stale worker started reclaimed job';
  exception when serialization_failure then null; end;
  perform public.start_connector_revocation_attempt(current_setting('omnix.confirmed_revocation_job_id')::uuid,'b4000000-0000-4000-8000-000000000002',2,'2026-08-11T20:05:01Z');
end;
$$;
select 'ok 11 - retry reclaim increments fencing and rejects the stale worker';

do $$
begin
  begin
    perform public.transition_connector_revocation_job(current_setting('omnix.confirmed_revocation_job_id')::uuid,'b4000000-0000-4000-8000-000000000002',2,'confirmed',null,null,'{}','2026-08-11T20:05:02Z');
    raise exception 'confirmation without evidence succeeded';
  exception when check_violation then null; end;
end;
$$;
select 'ok 12 - confirmed disconnect fails closed without provider or no-endpoint evidence';

do $$
declare result jsonb;
begin
  result := public.transition_connector_revocation_job(current_setting('omnix.confirmed_revocation_job_id')::uuid,'b4000000-0000-4000-8000-000000000002',2,'confirmed',null,null,'{"confirmationKind":"provider-confirmed","providerRequestHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","providerStatus":"revoked"}','2026-08-11T20:05:03Z');
  if result#>>'{revocationJob,state}' <> 'succeeded'
     or result#>>'{connection,status}' <> 'disconnected'
     or result#>>'{receipt,event_type}' <> 'revocation.completed'
     or result#>>'{receipt,redacted_metadata,confirmed}' <> 'true'
     or (select state <> 'cancelled' from public.connector_jobs where id=current_setting('omnix.disconnect_normal_job_id')::uuid) then
    raise exception 'confirmed cryptoshred transaction incomplete: %',result;
  end if;
end;
$$;
reset role;
do $$ begin
  if not (select destroyed_at is not null and ciphertext is null and wrapped_dek is null from connector_private.connector_connection_secrets where id='84000000-0000-4000-8000-000000000001')
     or not (select destroyed_at is not null and ciphertext is null and wrapped_dek is null from connector_private.connector_payload_envelopes where id='74000000-0000-4000-8000-000000000001')
     or exists (select 1 from connector_private.connector_oauth_transactions where connection_id='44000000-0000-4000-8000-000000000001')
     or exists (select 1 from connector_private.connector_sync_cursors where connection_id='44000000-0000-4000-8000-000000000001') then
    raise exception 'confirmed cryptoshred private state incomplete';
  end if;
end $$;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select 'ok 13 - confirmed provider evidence atomically disconnects, cryptoshreds and cancels queued work';

do $$
declare
  claim jsonb;
  second_claim jsonb;
  unknown_result jsonb;
  job_id uuid := current_setting('omnix.unconfirmed_revocation_job_id')::uuid;
  result jsonb;
begin
  claim := public.claim_connector_revocation_jobs('b4000000-0000-4000-8000-000000000003',1,90,'2026-08-11T22:00:00Z');
  perform public.start_connector_revocation_attempt(job_id,'b4000000-0000-4000-8000-000000000003',(claim#>>'{jobs,0,fencingToken}')::bigint,'2026-08-11T22:00:01Z');
  unknown_result := public.transition_connector_revocation_job(job_id,'b4000000-0000-4000-8000-000000000003',(claim#>>'{jobs,0,fencingToken}')::bigint,'unknown','provider_timeout','2026-08-11T22:05:00Z','{"reasonCode":"ambiguous-timeout"}','2026-08-11T22:00:02Z');
  if unknown_result#>>'{revocationJob,state}' <> 'retry_wait'
     or unknown_result#>>'{receipt,event_type}' <> 'provider.unknown' then
    raise exception 'unknown result did not schedule a bounded retry';
  end if;
  second_claim := public.claim_connector_revocation_jobs('b4000000-0000-4000-8000-000000000003',1,90,'2026-08-11T22:05:00Z');
  perform public.start_connector_revocation_attempt(job_id,'b4000000-0000-4000-8000-000000000003',(second_claim#>>'{jobs,0,fencingToken}')::bigint,'2026-08-11T22:05:01Z');
  result := public.transition_connector_revocation_job(job_id,'b4000000-0000-4000-8000-000000000003',(second_claim#>>'{jobs,0,fencingToken}')::bigint,'terminal','provider_revocation_denied',null,'{"reasonCode":"manual-provider-action-required"}','2026-08-11T22:05:02Z');
  if result#>>'{revocationJob,state}' <> 'disconnected_unconfirmed'
     or result#>>'{connection,status}' <> 'disconnected_unconfirmed'
     or result#>>'{receipt,redacted_metadata,confirmed}' <> 'false' then
    raise exception 'unconfirmed terminal path lost recovery material: %',result;
  end if;
end;
$$;
reset role;
do $$ begin
  if not (select destroyed_at is null and ciphertext is not null and wrapped_dek is not null from connector_private.connector_connection_secrets where id='84000000-0000-4000-8000-000000000002')
     or not exists (select 1 from connector_private.connector_oauth_transactions where connection_id='44000000-0000-4000-8000-000000000002')
     or not exists (select 1 from connector_private.connector_sync_cursors where connection_id='44000000-0000-4000-8000-000000000002') then
    raise exception 'unconfirmed terminal path lost private recovery material';
  end if;
end $$;
select 'ok 14 - unknown schedules retry; terminal uncertainty remains honest and preserves recovery material';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000003',true);
do $$
begin
  if exists (select 1 from public.connector_revocation_jobs where workspace_id='24000000-0000-4000-8000-000000000001')
     or (select count(*) from public.connector_revocation_jobs) <> 0 then
    raise exception 'cross-workspace revocation job exposed by RLS';
  end if;
end;
$$;
select 'ok 15 - revocation job reads remain workspace-isolated';

reset role;
do $$
begin
  begin
    delete from public.connector_revocation_jobs where id=current_setting('omnix.confirmed_revocation_job_id')::uuid;
    raise exception 'revocation job delete unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then null; end;
  if (select count(*) from public.connector_receipt_events where event_key like 'revocation.completed:%') <> 2 then
    raise exception 'terminal receipt count is not replay-safe';
  end if;
end;
$$;
select 'ok 16 - revocation jobs are non-deletable and terminal receipts are singular';

rollback;
