-- Story 3.5 KEK rewrap SQL/security/CAS matrix.
-- Prerequisite: migrations 0001..0008 applied to an isolated Supabase DB.
-- All fixtures and rewraps roll back.

begin;

select '1..14';

do $$
declare target_function text;
begin
  if not exists (
    select 1 from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'connector_private'
      and relation.relname = 'connector_rewrap_claims'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'rewrap claims do not force RLS'; end if;

  if has_table_privilege('anon', 'connector_private.connector_rewrap_claims', 'SELECT')
     or has_table_privilege('authenticated', 'connector_private.connector_rewrap_claims', 'SELECT')
     or has_table_privilege('service_role', 'connector_private.connector_rewrap_claims', 'SELECT') then
    raise exception 'private rewrap claim table has a direct read grant';
  end if;

  foreach target_function in array array[
    'list_connector_kek_version_counts(timestamp with time zone)',
    'claim_connector_kek_rewrap_candidates(uuid,text,text,integer,integer,timestamp with time zone)',
    'cas_rewrap_connector_envelope(uuid,uuid,bigint,bytea,bytea,bytea,text,text,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', 'public.' || target_function, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || target_function, 'EXECUTE')
       or not has_function_privilege('service_role', 'public.' || target_function, 'EXECUTE') then
      raise exception 'rewrap function privilege mismatch: %', target_function;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'list_connector_kek_version_counts',
        'claim_connector_kek_rewrap_candidates',
        'cas_rewrap_connector_envelope'
      )
      and (not procedure.prosecdef
        or not coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""'])
  ) then raise exception 'rewrap RPC lacks security-definer empty search path'; end if;
end;
$$;
select 'ok 1 - private claim state and all rewrap RPC grants fail closed';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','13000000-0000-4000-8000-000000000001',
   'authenticated','authenticated','rewrap-owner-a@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','13000000-0000-4000-8000-000000000002',
   'authenticated','authenticated','rewrap-owner-b@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name) values
  ('23000000-0000-4000-8000-000000000001','Rewrap workspace A'),
  ('23000000-0000-4000-8000-000000000002','Rewrap workspace B');

select set_config('omnix.actor_user_id','13000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('33000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
   '13000000-0000-4000-8000-000000000001','owner','active');
select set_config('omnix.actor_user_id','13000000-0000-4000-8000-000000000002',true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('33000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000002',
   '13000000-0000-4000-8000-000000000002','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into public.connector_connections (
  id, workspace_id, provider, provider_account_key_hash, display_label,
  status, granted_scopes, remote_identity_summary, created_by_membership_id
) values
  ('43000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
   'contract-test',repeat('a',64),'Rewrap A','active',array['contract.execute'],
   '{"accountType":"deterministic-test"}','33000000-0000-4000-8000-000000000001'),
  ('43000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000002',
   'contract-test',repeat('b',64),'Rewrap B','active',array['contract.execute'],
   '{"accountType":"deterministic-test"}','33000000-0000-4000-8000-000000000002');

insert into connector_private.connector_payload_envelopes (
  id, workspace_id, connection_id, payload_kind, schema_version,
  canonical_hash, ciphertext, nonce, auth_tag, wrapped_dek, wrap_nonce,
  wrap_auth_tag, kek_version, aad_hash
) values
  ('73000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
   '43000000-0000-4000-8000-000000000001','contract.execute','connector-action.v1',repeat('1',64),
   decode(repeat('a1',32),'hex'),decode(repeat('01',12),'hex'),decode(repeat('02',16),'hex'),
   decode(repeat('b1',32),'hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
   'payload-old',repeat('5',64)),
  ('73000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000002',
   '43000000-0000-4000-8000-000000000002','contract.execute','connector-action.v1',repeat('2',64),
   decode(repeat('a2',32),'hex'),decode(repeat('05',12),'hex'),decode(repeat('06',16),'hex'),
   decode(repeat('b2',32),'hex'),decode(repeat('07',12),'hex'),decode(repeat('08',16),'hex'),
   'other-workspace-old',repeat('6',64));

insert into connector_private.connector_connection_secrets (
  id, workspace_id, connection_id, secret_type, ciphertext, nonce, auth_tag,
  wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash
) values (
  '83000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
  '43000000-0000-4000-8000-000000000001','access_token',
  decode(repeat('c1',32),'hex'),decode(repeat('09',12),'hex'),decode(repeat('0a',16),'hex'),
  decode(repeat('d1',32),'hex'),decode(repeat('0b',12),'hex'),decode(repeat('0c',16),'hex'),
  'secret-old',repeat('7',64)
);

insert into connector_private.connector_oauth_transactions (
  id, workspace_id, connection_id, provider, state_hash,
  requested_scope_bundle, requested_scopes, actor_user_id, membership_id,
  session_binding_hash, redirect_uri, safe_return_path,
  pkce_ciphertext, pkce_nonce, pkce_auth_tag, pkce_wrapped_dek,
  pkce_wrap_nonce, pkce_wrap_auth_tag, kek_version, aad_hash,
  expires_at, consumed_at, created_at
) values
  ('93000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
   '43000000-0000-4000-8000-000000000001','contract-test',repeat('8',64),
   'contract.oauth',array['contract.execute'],'13000000-0000-4000-8000-000000000001',
   '33000000-0000-4000-8000-000000000001',repeat('9',64),'https://omnix.test/callback','/connections',
   decode(repeat('e1',32),'hex'),decode(repeat('0d',12),'hex'),decode(repeat('0e',16),'hex'),
   decode(repeat('f1',32),'hex'),decode(repeat('0f',12),'hex'),decode(repeat('10',16),'hex'),
  'oauth-old',repeat('a',64),'2026-08-12T00:00:00Z',null,'2026-08-11T00:00:00Z'),
  ('93000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000001',
   null,'contract-test',repeat('0',64),
   'contract.oauth',array['contract.execute'],'13000000-0000-4000-8000-000000000001',
   '33000000-0000-4000-8000-000000000001',repeat('1',64),'https://omnix.test/callback','/connections',
   decode(repeat('e3',32),'hex'),decode(repeat('15',12),'hex'),decode(repeat('16',16),'hex'),
   decode(repeat('f3',32),'hex'),decode(repeat('17',12),'hex'),decode(repeat('18',16),'hex'),
   'oauth-null-old',repeat('2',64),'2026-08-12T00:00:00Z',null,'2026-08-11T00:00:00Z'),
  ('93000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001',
   '43000000-0000-4000-8000-000000000001','contract-test',repeat('b',64),
   'contract.oauth',array['contract.execute'],'13000000-0000-4000-8000-000000000001',
   '33000000-0000-4000-8000-000000000001',repeat('c',64),'https://omnix.test/callback','/connections',
   decode(repeat('e2',32),'hex'),decode(repeat('11',12),'hex'),decode(repeat('12',16),'hex'),
   decode(repeat('f2',32),'hex'),decode(repeat('13',12),'hex'),decode(repeat('14',16),'hex'),
   'oauth-old',repeat('d',64),'2026-08-12T00:00:00Z','2026-08-11T09:00:00Z','2026-08-11T00:00:00Z');

insert into connector_private.connector_sync_cursors (
  id, workspace_id, connection_id, stream_key, ciphertext, nonce, auth_tag,
  wrapped_dek, wrap_nonce, wrap_auth_tag, kek_version, aad_hash, expires_at
) values
  ('a3000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001',
   '43000000-0000-4000-8000-000000000001','contact.sync',
   decode(repeat('21',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('23',16),'hex'),
   decode(repeat('24',32),'hex'),decode(repeat('25',12),'hex'),decode(repeat('26',16),'hex'),
   'cursor-old',repeat('e',64),null),
  ('a3000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001',
   '43000000-0000-4000-8000-000000000001','expired.sync',
   decode(repeat('31',32),'hex'),decode(repeat('32',12),'hex'),decode(repeat('33',16),'hex'),
   decode(repeat('34',32),'hex'),decode(repeat('35',12),'hex'),decode(repeat('36',16),'hex'),
   'cursor-old',repeat('f',64),'2026-08-10T00:00:00Z');

set local role service_role;

do $$
declare count_rows jsonb;
begin
  select jsonb_agg(to_jsonb(version_count) order by envelope_kind, kek_version)
    into count_rows
  from public.list_connector_kek_version_counts('2026-08-11T10:00:00Z') version_count;
  if not count_rows @> '[{"envelope_kind":"payload","kek_version":"payload-old","active_count":1},
                         {"envelope_kind":"connection-secret","kek_version":"secret-old","active_count":1},
                         {"envelope_kind":"oauth-pkce","kek_version":"oauth-old","active_count":1},
                         {"envelope_kind":"sync-cursor","kek_version":"cursor-old","active_count":1}]'::jsonb then
    raise exception 'active KEK counts are incomplete: %', count_rows;
  end if;
end;
$$;
select 'ok 2 - version inspection counts active encrypted material and excludes consumed or expired rows';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
do $$ begin
  if has_schema_privilege('authenticated','connector_private','USAGE')
     or has_function_privilege('authenticated',
       'public.list_connector_kek_version_counts(timestamp with time zone)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.claim_connector_kek_rewrap_candidates(uuid,text,text,integer,integer,timestamp with time zone)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.cas_rewrap_connector_envelope(uuid,uuid,bigint,bytea,bytea,bytea,text,text,timestamp with time zone)','EXECUTE') then
    raise exception 'authenticated retained connector KEK rewrap authority';
  end if;
end $$;
select 'ok 3 - browser and authenticated paths cannot inspect or claim KEK material';

reset role;
set local role service_role;
do $$
declare result jsonb; candidate jsonb;
begin
  result:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000001','payload-old','payload-new',1,60,'2026-08-11T10:00:00Z');
  candidate:=result->'candidates'->0;
  if (result->>'count')::int<>1 or candidate is null
     or candidate ? 'ciphertext' or candidate ? 'nonce' or candidate ? 'authTag'
     or not (candidate ?& array['claimId','envelopeKind','envelopeId','workspaceId',
       'connectionId','provider','secretType','recordVersion',
       'sourceKekVersion','targetKekVersion','cryptoVersion','wrappedDek',
       'wrapNonce','wrapAuthTag','aadHash','leaseExpiresAt','fencingToken']) then
    raise exception 'bounded candidate response leaks or omits material: %', result;
  end if;
  perform set_config('omnix.rewrap_payload_claim',candidate->>'claimId',true);
  perform set_config('omnix.rewrap_payload_fence',candidate->>'fencingToken',true);
end $$;
select 'ok 4 - bounded claim returns only wrapper material and redacted authority';

do $$ declare result jsonb;
begin
  result:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000002','payload-old','payload-new',1,60,'2026-08-11T10:00:01Z');
  if (result->>'count')::int<>0 then raise exception 'second worker claimed leased candidate'; end if;
end $$;
select 'ok 5 - concurrent workers cannot claim the same active source envelope';

do $$ begin
  begin
    perform public.cas_rewrap_connector_envelope(
      current_setting('omnix.rewrap_payload_claim')::uuid,
      'b3000000-0000-4000-8000-000000000002',
      current_setting('omnix.rewrap_payload_fence')::bigint,
      decode(repeat('41',32),'hex'),decode(repeat('42',12),'hex'),decode(repeat('43',16),'hex'),
      'payload-new',repeat('5',64),'2026-08-11T10:00:02Z');
    raise exception 'cross-worker CAS unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select 'ok 6 - claim ownership prevents cross-worker and cross-authority mutation';

do $$ declare result jsonb;
begin
  result:=public.cas_rewrap_connector_envelope(
    current_setting('omnix.rewrap_payload_claim')::uuid,
    'b3000000-0000-4000-8000-000000000001',
    current_setting('omnix.rewrap_payload_fence')::bigint,
    decode(repeat('41',32),'hex'),decode(repeat('42',12),'hex'),decode(repeat('43',16),'hex'),
    'payload-new',repeat('5',64),'2026-08-11T10:00:03Z');
  if (result->>'noOp')::boolean or result->>'targetKekVersion'<>'payload-new' then
    raise exception 'payload CAS result invalid';
  end if;
end $$;
reset role;
do $$ begin
  if not exists (
    select 1 from connector_private.connector_payload_envelopes envelope
    where envelope.id='73000000-0000-4000-8000-000000000001'
      and envelope.kek_version='payload-new' and envelope.envelope_version=1
      and envelope.aad_hash=repeat('5',64)
      and envelope.ciphertext=decode(repeat('a1',32),'hex')
      and envelope.nonce=decode(repeat('01',12),'hex')
      and envelope.auth_tag=decode(repeat('02',16),'hex')
      and envelope.wrapped_dek=decode(repeat('41',32),'hex')
  ) then raise exception 'payload data/AAD/version was not preserved'; end if;
end $$;
select 'ok 7 - CAS changes only wrapper/KEK metadata and preserves ciphertext, AAD binding and version';

set local role service_role;
do $$ declare replay jsonb;
begin
  replay:=public.cas_rewrap_connector_envelope(
    current_setting('omnix.rewrap_payload_claim')::uuid,
    'b3000000-0000-4000-8000-000000000001',
    current_setting('omnix.rewrap_payload_fence')::bigint,
    decode(repeat('41',32),'hex'),decode(repeat('42',12),'hex'),decode(repeat('43',16),'hex'),
    'payload-new',repeat('5',64),'2026-08-11T10:00:04Z');
  if not (replay->>'noOp')::boolean then raise exception 'same CAS replay was not a no-op'; end if;
  begin
    perform public.cas_rewrap_connector_envelope(
      current_setting('omnix.rewrap_payload_claim')::uuid,
      'b3000000-0000-4000-8000-000000000001',
      current_setting('omnix.rewrap_payload_fence')::bigint,
      decode(repeat('44',32),'hex'),decode(repeat('42',12),'hex'),decode(repeat('43',16),'hex'),
      'payload-new',repeat('5',64),'2026-08-11T10:00:05Z');
    raise exception 'divergent completed replay unexpectedly succeeded';
  exception when unique_violation then null; end;
end $$;
select 'ok 8 - completed CAS replay is idempotent and divergent wrapper replay fails';

do $$ declare first_claim jsonb; reclaimed jsonb; first_candidate jsonb; second_candidate jsonb;
begin
  first_claim:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000001','secret-old','secret-new',1,30,'2026-08-11T10:01:00Z');
  first_candidate:=first_claim->'candidates'->0;
  reclaimed:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000002','secret-old','secret-new',1,30,'2026-08-11T10:01:31Z');
  second_candidate:=reclaimed->'candidates'->0;
  if second_candidate->>'claimId'<>first_candidate->>'claimId'
     or (second_candidate->>'fencingToken')::bigint<>(first_candidate->>'fencingToken')::bigint+1 then
    raise exception 'expired claim did not reissue one monotonic fence';
  end if;
  begin
    perform public.cas_rewrap_connector_envelope(
      (first_candidate->>'claimId')::uuid,'b3000000-0000-4000-8000-000000000001',
      (first_candidate->>'fencingToken')::bigint,
      decode(repeat('51',32),'hex'),decode(repeat('52',12),'hex'),decode(repeat('53',16),'hex'),
      'secret-new',repeat('7',64),'2026-08-11T10:01:32Z');
    raise exception 'stale worker completed reclaimed envelope';
  exception when serialization_failure then null; when insufficient_privilege then null; end;
  perform set_config('omnix.rewrap_secret_claim',second_candidate->>'claimId',true);
  perform set_config('omnix.rewrap_secret_fence',second_candidate->>'fencingToken',true);
end $$;
select 'ok 9 - expired claims reissue a monotonic fence and stale workers fail';

do $$ begin
  perform public.cas_rewrap_connector_envelope(
    current_setting('omnix.rewrap_secret_claim')::uuid,
    'b3000000-0000-4000-8000-000000000002',
    current_setting('omnix.rewrap_secret_fence')::bigint,
    decode(repeat('51',32),'hex'),decode(repeat('52',12),'hex'),decode(repeat('53',16),'hex'),
    'secret-new',repeat('7',64),'2026-08-11T10:01:33Z');
end $$;
select 'ok 10 - reclaimed connection-secret envelope completes through its new fence';

do $$ declare result jsonb; candidate jsonb;
begin
  result:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000003','oauth-old','oauth-new',1,60,'2026-08-11T10:02:00Z');
  candidate:=result->'candidates'->0;
  if candidate->>'connectionId'<>'43000000-0000-4000-8000-000000000001'
     or candidate->>'provider'<>'contract-test'
     or candidate->>'secretType'<>'oauth-pkce'
     or (candidate->>'recordVersion')::int<>1 then
    raise exception 'OAuth canonical AAD fields are invalid: %', candidate;
  end if;
  perform public.cas_rewrap_connector_envelope(
    (candidate->>'claimId')::uuid,'b3000000-0000-4000-8000-000000000003',
    (candidate->>'fencingToken')::bigint,
    decode(repeat('61',32),'hex'),decode(repeat('62',12),'hex'),decode(repeat('63',16),'hex'),
    'oauth-new',repeat('a',64),'2026-08-11T10:02:01Z');
end $$;
reset role;
do $$ begin
  if not exists (
    select 1 from connector_private.connector_oauth_transactions transaction_row
    where transaction_row.id='93000000-0000-4000-8000-000000000001'
      and transaction_row.kek_version='oauth-new'
      and transaction_row.pkce_ciphertext=decode(repeat('e1',32),'hex')
      and transaction_row.pkce_nonce=decode(repeat('0d',12),'hex')
      and transaction_row.pkce_auth_tag=decode(repeat('0e',16),'hex')
  ) then raise exception 'OAuth PKCE data material changed during rewrap'; end if;
end $$;
select 'ok 11 - active OAuth PKCE rewrap preserves encrypted PKCE data material';

set local role service_role;
do $$ declare result jsonb; candidate jsonb;
begin
  result:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000006','oauth-null-old','oauth-null-new',1,60,'2026-08-11T10:02:10Z');
  candidate:=result->'candidates'->0;
  if candidate->>'connectionId'<>'oauth-transaction-93000000-0000-4000-8000-000000000003'
     or candidate->>'provider'<>'contract-test'
     or candidate->>'secretType'<>'oauth-pkce'
     or (candidate->>'recordVersion')::int<>1 then
    raise exception 'pre-connection OAuth canonical AAD fields are invalid: %', candidate;
  end if;
end $$;

set local role service_role;
do $$ declare result jsonb; candidate jsonb;
begin
  result:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000004','cursor-old','cursor-new',1,60,'2026-08-11T10:03:00Z');
  candidate:=result->'candidates'->0;
  perform set_config('omnix.rewrap_cursor_claim',candidate->>'claimId',true);
  perform set_config('omnix.rewrap_cursor_fence',candidate->>'fencingToken',true);
end $$;
reset role;
update connector_private.connector_sync_cursors set cursor_version=2
where id='a3000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ begin
  begin
    perform public.cas_rewrap_connector_envelope(
      current_setting('omnix.rewrap_cursor_claim')::uuid,
      'b3000000-0000-4000-8000-000000000004',
      current_setting('omnix.rewrap_cursor_fence')::bigint,
      decode(repeat('71',32),'hex'),decode(repeat('72',12),'hex'),decode(repeat('73',16),'hex'),
      'cursor-new',repeat('e',64),'2026-08-11T10:03:01Z');
    raise exception 'cursor version conflict unexpectedly succeeded';
  exception when serialization_failure then null; end;
end $$;
select 'ok 12 - CAS rejects concurrent business-version changes without overwriting cursor state';

do $$ declare result jsonb; candidate jsonb;
begin
  result:=public.claim_connector_kek_rewrap_candidates(
    'b3000000-0000-4000-8000-000000000005','other-workspace-old','other-workspace-new',1,60,'2026-08-11T10:04:00Z');
  candidate:=result->'candidates'->0;
  begin
    perform public.cas_rewrap_connector_envelope(
      (candidate->>'claimId')::uuid,'b3000000-0000-4000-8000-000000000005',
      (candidate->>'fencingToken')::bigint,
      decode(repeat('81',32),'hex'),decode(repeat('82',12),'hex'),decode(repeat('83',16),'hex'),
      'other-workspace-new',repeat('5',64),'2026-08-11T10:04:01Z');
    raise exception 'cross-workspace AAD substitution unexpectedly succeeded';
  exception when unique_violation then null; end;
end $$;
select 'ok 13 - claim-bound workspace/AAD authority rejects caller substitution';

do $$ declare old_payload bigint; new_payload bigint; old_secret bigint; new_secret bigint;
begin
  select coalesce(sum(active_count) filter (where envelope_kind='payload' and kek_version='payload-old'),0),
         coalesce(sum(active_count) filter (where envelope_kind='payload' and kek_version='payload-new'),0),
         coalesce(sum(active_count) filter (where envelope_kind='connection-secret' and kek_version='secret-old'),0),
         coalesce(sum(active_count) filter (where envelope_kind='connection-secret' and kek_version='secret-new'),0)
    into old_payload,new_payload,old_secret,new_secret
  from public.list_connector_kek_version_counts('2026-08-11T10:05:00Z');
  if old_payload<>0 or new_payload<>1 or old_secret<>0 or new_secret<>1 then
    raise exception 'post-rewrap version counts are inconsistent';
  end if;
  begin
    perform public.claim_connector_kek_rewrap_candidates(
      'b3000000-0000-4000-8000-000000000001','same','same',101,10,'2026-08-11T10:05:00Z');
    raise exception 'invalid unbounded claim command unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;
select 'ok 14 - post-rewrap counts converge and invalid or unbounded batches fail closed';

rollback;
