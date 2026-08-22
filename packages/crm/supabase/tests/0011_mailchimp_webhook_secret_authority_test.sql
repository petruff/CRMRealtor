-- Story 4.1 per-connection Mailchimp webhook-secret and baseline matrix.
-- Prerequisite: migrations 0001..0011 applied to an isolated Supabase DB.
-- TAP is emitted directly because the local image need not bundle pgtap.

begin;

select '1..22';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'connector_private'
      and table_name = 'connector_webhook_bindings'
      and column_name = 'remote_webhook_id_hash'
  ) or not exists (
    select 1 from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'mailchimp_sync_evidence'
      and constraint_row.conname = 'mailchimp_sync_evidence_origin'
      and pg_get_constraintdef(constraint_row.oid) like '%baseline-reconciliation%'
  ) then
    raise exception '0011 schema contract is missing';
  end if;
  if has_function_privilege(
      'authenticated',
      'public.bind_mailchimp_webhook_secret(uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,text,timestamptz,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.read_mailchimp_webhook_signing_secret(text,timestamptz)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'public.apply_mailchimp_baseline_member(uuid,text,text,text,text,text,text,uuid,timestamptz)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.register_mailchimp_webhook_event(uuid,text,text,text,boolean,boolean,uuid,text,uuid,timestamptz,integer)',
      'EXECUTE'
    ) or has_table_privilege(
      'service_role',
      'connector_private.connector_connection_secrets',
      'SELECT'
    ) then
    raise exception '0011 RPC grant boundary is unsafe';
  end if;
end;
$$;
select 'ok 1 - 0011 adds only private webhook metadata, baseline origin and service-only RPCs';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000001','authenticated','authenticated','owner-a-0011@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000002','authenticated','authenticated','assistant-a-0011@omnix.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000003','authenticated','authenticated','owner-b-0011@omnix.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name) values
  ('12000000-0000-4000-8000-000000000001','0011 Workspace A'),
  ('12000000-0000-4000-8000-000000000002','0011 Workspace B');

select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('13000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','owner','active'),
  ('13000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','assistant','active');
select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000003',true);
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('13000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003','owner','active');
set constraints all immediate;
set constraints all deferred;

insert into public.connector_connections (
  id, workspace_id, provider, provider_account_key_hash, display_label,
  status, granted_scopes, remote_identity_summary,
  created_by_membership_id, created_at, updated_at
) values
  ('14000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','mailchimp',repeat('a',64),'Mailchimp A','active',array['audience.sync','audience.reconcile'],'{"dataCenter":"us21"}','13000000-0000-4000-8000-000000000001','2026-08-11T14:00:00Z','2026-08-11T14:00:00Z'),
  ('14000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','mailchimp',repeat('b',64),'Mailchimp B','active',array['audience.sync','audience.reconcile'],'{"dataCenter":"us7"}','13000000-0000-4000-8000-000000000003','2026-08-11T14:00:00Z','2026-08-11T14:00:00Z');

insert into public.mailchimp_audience_bindings (
  id, workspace_id, connection_id, account_id_hash, data_center,
  audience_external_id, audience_name, mapping_version,
  selected_by_membership_id, selection_correlation_id, selected_at
) values
  ('15000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001',repeat('a',64),'us21','audience-a','Audience A',1,'13000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','2026-08-11T14:01:00Z'),
  ('15000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000002',repeat('b',64),'us7','audience-b','Audience B',1,'13000000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000002','2026-08-11T14:01:00Z');

insert into public.contacts (
  id, owner_id, workspace_id, first_name, last_name, email,
  email_subscribed, lead_type, relationship, intent, source,
  pipeline_stage, tags, created_at, updated_at
) values
  ('17000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Baseline','Person','baseline.0011@example.com',true,'hot','lead','buyer','website','new','{}','2026-08-11T14:02:00Z','2026-08-11T14:02:00Z'),
  ('17000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Duplicate','One','duplicate.0011@example.com',true,'warm','lead','unknown','other','new','{}','2026-08-11T14:02:01Z','2026-08-11T14:02:01Z'),
  ('17000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Duplicate','Two','duplicate.0011@example.com',true,'warm','lead','unknown','other','new','{}','2026-08-11T14:02:02Z','2026-08-11T14:02:02Z'),
  ('17000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Archived','Person','archived.0011@example.com',true,'nurture','lead','unknown','other','new','{}','2026-08-11T14:02:03Z','2026-08-11T14:02:03Z');

update public.contacts
   set archived_at = '2026-08-11T14:03:00Z',
       archived_by_membership_id = '13000000-0000-4000-8000-000000000001',
       archive_reason = '0011 test'
 where id = '17000000-0000-4000-8000-000000000004';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);

do $$
declare state jsonb;
begin
  state := public.read_mailchimp_webhook_setup_state(
    '14000000-0000-4000-8000-000000000002'
  );
  if state#>>'{workspaceId}' <> '12000000-0000-4000-8000-000000000002'
     or state#>>'{secretVersion}' is not null
     or state#>>'{webhookRegistrationRequired}' <> 'true'
     or state#>>'{endpointBound}' <> 'false'
     or state::text ~* '(endpointkey|ciphertext|wrapped)' then
    raise exception 'pre-bind webhook setup state is not redacted/executable';
  end if;
end;
$$;
select 'ok 2 - setup state exposes only nullable CAS/readiness flags before initial bind';

do $$
declare bound jsonb;
begin
  bound := public.bind_mailchimp_webhook_secret(
    '14000000-0000-4000-8000-000000000001', repeat('1',64), null,
    decode(repeat('aa',32),'hex'), decode(repeat('01',12),'hex'),
    decode(repeat('02',16),'hex'), decode(repeat('bb',32),'hex'),
    decode(repeat('03',12),'hex'), decode(repeat('04',16),'hex'),
    'kek-v1', repeat('2',64), repeat('3',64),
    '2026-08-11T14:04:00Z','16000000-0000-4000-8000-000000000003'
  );
  if (bound->>'noOp')::boolean
     or bound#>>'{secret,secretType}' <> 'mailchimp-webhook-signing-secret'
     or bound#>>'{secret,secretVersion}' <> '1'
     or bound#>>'{audienceBinding,webhook_registration_required}' <> 'false'
     or bound#>>'{endpointBinding,webhookIdHash}' <> repeat('3',64)
     or bound#>>'{receipt,provider}' <> 'mailchimp'
     or bound#>>'{receipt,event_type}' <> 'sync.applied'
     or bound::text ~* '(ciphertext|wrappeddek|authTag)' then
    raise exception 'atomic webhook secret bind contract failed';
  end if;
end;
$$;
select 'ok 3 - service bind atomically stores endpoint/secret, confirms registration and returns redacted metadata';

do $$
declare resolved jsonb;
begin
  resolved := public.read_mailchimp_webhook_signing_secret(
    repeat('1',64),'2026-08-11T14:04:01Z'
  );
  if resolved#>>'{workspaceId}' <> '12000000-0000-4000-8000-000000000001'
     or resolved#>>'{connectionId}' <> '14000000-0000-4000-8000-000000000001'
     or resolved#>>'{audienceBinding,audienceId}' <> 'audience-a'
     or resolved#>>'{endpointBinding,endpointKeyHash}' <> repeat('1',64)
     or resolved#>>'{secret,secretVersion}' <> '1'
     or resolved#>>'{secret,ciphertext}' is null
     or resolved#>>'{secret,wrappedDek}' is null then
    raise exception 'webhook signing envelope resolution failed';
  end if;
end;
$$;
select 'ok 4 - opaque endpoint resolves one active audience and encrypted per-connection envelope';

do $$
declare replay jsonb;
begin
  replay := public.bind_mailchimp_webhook_secret(
    '14000000-0000-4000-8000-000000000001', repeat('1',64), null,
    decode(repeat('aa',32),'hex'), decode(repeat('01',12),'hex'),
    decode(repeat('02',16),'hex'), decode(repeat('bb',32),'hex'),
    decode(repeat('03',12),'hex'), decode(repeat('04',16),'hex'),
    'kek-v1', repeat('2',64), repeat('3',64),
    '2026-08-11T14:04:00Z','16000000-0000-4000-8000-000000000003'
  );
  if not (replay->>'noOp')::boolean
     or replay#>>'{secret,secretVersion}' <> '1' then
    raise exception 'identical webhook bind replay rotated the secret';
  end if;
end;
$$;
select 'ok 5 - identical bind replay is a no-op and does not rotate the envelope';

do $$
declare rotated jsonb; resolved jsonb;
begin
  rotated := public.bind_mailchimp_webhook_secret(
    '14000000-0000-4000-8000-000000000001', repeat('4',64), 1,
    decode(repeat('cc',32),'hex'), decode(repeat('05',12),'hex'),
    decode(repeat('06',16),'hex'), decode(repeat('dd',32),'hex'),
    decode(repeat('07',12),'hex'), decode(repeat('08',16),'hex'),
    'kek-v2', repeat('5',64), repeat('6',64),
    '2026-08-11T14:05:00Z','16000000-0000-4000-8000-000000000004'
  );
  resolved := public.read_mailchimp_webhook_signing_secret(
    repeat('4',64),'2026-08-11T14:05:01Z'
  );
  if (rotated->>'noOp')::boolean
     or rotated#>>'{secret,secretVersion}' <> '2'
     or resolved#>>'{secret,kekVersion}' <> 'kek-v2'
     or resolved#>>'{endpointBinding,webhookIdHash}' <> repeat('6',64) then
    raise exception 'webhook endpoint/secret CAS rotation failed';
  end if;
end;
$$;
select 'ok 6 - replacement rotates the envelope with CAS and moves the opaque endpoint atomically';

do $$
declare state jsonb;
begin
  state := public.read_mailchimp_webhook_setup_state(
    '14000000-0000-4000-8000-000000000001'
  );
  if state#>>'{secretVersion}' <> '2'
     or state#>>'{webhookRegistrationRequired}' <> 'false'
     or state#>>'{endpointBound}' <> 'true'
     or state::text ~* '(endpointkey|ciphertext|wrapped)' then
    raise exception 'post-bind webhook setup state failed';
  end if;
end;
$$;
select 'ok 7 - setup state returns the current CAS version after bind without bearer or envelope';

do $$
begin
  begin
    perform public.read_mailchimp_webhook_signing_secret(
      repeat('1',64),'2026-08-11T14:05:01Z'
    );
    raise exception 'old endpoint still resolved';
  exception when no_data_found then null; end;
  begin
    perform public.bind_mailchimp_webhook_secret(
      '14000000-0000-4000-8000-000000000001', repeat('7',64), 1,
      decode(repeat('ee',32),'hex'), decode(repeat('09',12),'hex'),
      decode(repeat('0a',16),'hex'), decode(repeat('ff',32),'hex'),
      decode(repeat('0b',12),'hex'), decode(repeat('0c',16),'hex'),
      'kek-v3', repeat('8',64), repeat('9',64),
      '2026-08-11T14:06:00Z','16000000-0000-4000-8000-000000000005'
    );
    raise exception 'stale secret version rotated envelope';
  exception when serialization_failure then null; end;
end;
$$;
select 'ok 8 - old endpoint and stale secret version both fail closed';

do $$
begin
  begin
    perform public.bind_mailchimp_webhook_secret(
      '14000000-0000-4000-8000-000000000002', repeat('4',64), null,
      decode(repeat('11',32),'hex'), decode(repeat('12',12),'hex'),
      decode(repeat('13',16),'hex'), decode(repeat('14',32),'hex'),
      decode(repeat('15',12),'hex'), decode(repeat('16',16),'hex'),
      'kek-v1', repeat('a1',32), repeat('a2',32),
      '2026-08-11T14:06:01Z','16000000-0000-4000-8000-000000000006'
    );
    raise exception 'cross-workspace endpoint collision succeeded';
  exception when unique_violation then null; end;
end;
$$;
reset role;
do $$
begin
  if exists (
    select 1 from connector_private.connector_connection_secrets
    where connection_id = '14000000-0000-4000-8000-000000000002'
      and secret_type = 'mailchimp-webhook-signing-secret'
  ) then
    raise exception 'failed cross-workspace bind left a secret behind';
  end if;
end;
$$;
select 'ok 9 - endpoint uniqueness prevents cross-workspace authority and failure is atomic';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
do $$
begin
  if has_schema_privilege('authenticated','connector_private','USAGE')
     or has_function_privilege(
       'authenticated',
       'public.read_mailchimp_webhook_signing_secret(text,timestamptz)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.bind_mailchimp_webhook_secret(uuid,text,integer,bytea,bytea,bytea,bytea,bytea,bytea,text,text,text,timestamptz,uuid)',
       'EXECUTE'
     ) then
    raise exception 'private grant boundary regressed';
  end if;
end;
$$;
select 'ok 10 - browser roles cannot read/bind the secret and service has no direct private-table read';

reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);

do $$
declare result jsonb; subscriber text;
begin
  subscriber := encode(extensions.digest(
    pg_catalog.convert_to('baseline.0011@example.com','UTF8'),'md5'
  ),'hex');
  result := public.apply_mailchimp_baseline_member(
    '14000000-0000-4000-8000-000000000001','audience-a','member-baseline',
    subscriber,'baseline.0011@example.com','unsubscribed',repeat('b1',32),
    '16000000-0000-4000-8000-000000000007','2026-08-11T14:07:00Z'
  );
  if result#>>'{outcome}' <> 'applied'
     or result#>>'{authority,resubscribe_requires_consent}' <> 'true'
     or result#>>'{evidence,origin}' <> 'baseline-reconciliation'
     or result#>>'{receipt,provider}' <> 'mailchimp'
     or result#>>'{receipt,event_type}' <> 'sync.applied'
     or (select email_subscribed from public.contact_points
       where contact_id = '17000000-0000-4000-8000-000000000001'
         and type = 'email') is distinct from false
     or (select email_subscribed from public.contacts
       where id = '17000000-0000-4000-8000-000000000001') is distinct from false
     or not exists (
       select 1 from public.activity_events
       where contact_id = '17000000-0000-4000-8000-000000000001'
         and idempotency_key = 'mailchimp.baseline:' || repeat('b1',32)
     ) then
    raise exception 'baseline unsubscribe authority failed';
  end if;
end;
$$;
select 'ok 11 - baseline unsubscribe updates canonical authority and appends lifecycle/receipt evidence atomically';

do $$
declare replay jsonb; subscriber text;
begin
  subscriber := encode(extensions.digest(
    pg_catalog.convert_to('baseline.0011@example.com','UTF8'),'md5'
  ),'hex');
  replay := public.apply_mailchimp_baseline_member(
    '14000000-0000-4000-8000-000000000001','audience-a','member-baseline',
    subscriber,'baseline.0011@example.com','unsubscribed',repeat('b1',32),
    '16000000-0000-4000-8000-000000000007','2026-08-11T14:07:00Z'
  );
  if not (replay->>'noOp')::boolean
     or replay#>>'{outcome}' <> 'applied'
     or (select count(*) from public.mailchimp_sync_evidence
       where origin = 'baseline-reconciliation'
         and source_key_hash = repeat('b1',32)) <> 1 then
    raise exception 'baseline replay was not idempotent';
  end if;
end;
$$;
select 'ok 12 - baseline item replay is idempotent without synthetic webhook delivery';

do $$
declare result jsonb; subscriber text;
begin
  subscriber := encode(extensions.digest(
    pg_catalog.convert_to('baseline.0011@example.com','UTF8'),'md5'
  ),'hex');
  result := public.apply_mailchimp_baseline_member(
    '14000000-0000-4000-8000-000000000001','audience-a','member-baseline',
    subscriber,'baseline.0011@example.com','subscribed',repeat('b2',32),
    '16000000-0000-4000-8000-000000000008','2026-08-11T14:08:00Z'
  );
  if result#>>'{outcome}' <> 'blocked-unsubscribe-authority'
     or result#>>'{receipt,event_type}' <> 'sync.reviewed'
     or (select email_subscribed from public.contact_points
       where contact_id = '17000000-0000-4000-8000-000000000001'
         and type = 'email') is distinct from false then
    raise exception 'baseline automatically reversed provider unsubscribe';
  end if;
end;
$$;
select 'ok 13 - later baseline subscribe cannot reverse durable provider unsubscribe authority';

do $$
declare result jsonb; subscriber text;
begin
  subscriber := encode(extensions.digest(
    pg_catalog.convert_to('duplicate.0011@example.com','UTF8'),'md5'
  ),'hex');
  result := public.apply_mailchimp_baseline_member(
    '14000000-0000-4000-8000-000000000001','audience-a','member-duplicate',
    subscriber,'duplicate.0011@example.com','unsubscribed',repeat('b3',32),
    '16000000-0000-4000-8000-000000000009','2026-08-11T14:09:00Z'
  );
  if result#>>'{outcome}' <> 'review'
     or result#>>'{receipt,reconciliation_result}' <> 'ambiguous-email'
     or result#>>'{memberLink}' is not null then
    raise exception 'ambiguous baseline identity did not fail closed';
  end if;
end;
$$;
select 'ok 14 - ambiguous baseline identity records review and mutates no contact/link';

do $$
declare result jsonb; subscriber text;
begin
  subscriber := encode(extensions.digest(
    pg_catalog.convert_to('archived.0011@example.com','UTF8'),'md5'
  ),'hex');
  result := public.apply_mailchimp_baseline_member(
    '14000000-0000-4000-8000-000000000001','audience-a','member-archived',
    subscriber,'archived.0011@example.com','unsubscribed',repeat('b4',32),
    '16000000-0000-4000-8000-000000000010','2026-08-11T14:10:00Z'
  );
  if result#>>'{outcome}' <> 'review'
     or result#>>'{receipt,reconciliation_result}' <> 'archived-email'
     or result#>>'{memberLink}' is not null then
    raise exception 'archived baseline identity did not fail closed';
  end if;
end;
$$;
select 'ok 15 - archived baseline identity records review without restore or mutation';

do $$
declare result jsonb; subscriber text;
begin
  subscriber := encode(extensions.digest(
    pg_catalog.convert_to('baseline.0011@example.com','UTF8'),'md5'
  ),'hex');
  result := public.apply_mailchimp_baseline_member(
    '14000000-0000-4000-8000-000000000001','wrong-audience','member-wrong',
    subscriber,'baseline.0011@example.com','unsubscribed',repeat('b5',32),
    '16000000-0000-4000-8000-000000000011','2026-08-11T14:11:00Z'
  );
  if result#>>'{outcome}' <> 'review'
     or result#>>'{receipt,reconciliation_result}' <> 'wrong-audience'
     or result#>>'{memberLink}' is not null then
    raise exception 'wrong-audience baseline item did not fail closed';
  end if;
end;
$$;
select 'ok 16 - caller cannot redirect baseline application to another audience';

do $$
begin
  if exists (
    select 1 from public.mailchimp_sync_evidence evidence
    where evidence.origin = 'baseline-reconciliation'
      and to_jsonb(evidence)::text ~* 'example.com'
  ) or exists (
    select 1 from public.connector_receipt_events receipt
    where receipt.connection_id = '14000000-0000-4000-8000-000000000001'
      and receipt.event_key like 'mailchimp.baseline.item:%'
      and to_jsonb(receipt)::text ~* 'example.com'
  ) or exists (
    select 1 from information_schema.columns
    where table_schema = 'connector_private'
      and table_name = 'connector_webhook_bindings'
      and column_name in ('endpoint_key','webhook_id','signing_secret')
  ) then
    raise exception 'plaintext email, endpoint or signing secret leaked to evidence/schema';
  end if;
end;
$$;
select 'ok 17 - public evidence remains hash/ID-only and private metadata stores no plaintext endpoint or secret';

do $$
declare registered jsonb;
begin
  registered := public.register_mailchimp_webhook_event_encrypted(
    '14000000-0000-4000-8000-000000000001','audience-a',
    repeat('c1',32),repeat('c2',32),true,true,repeat('c3',32),
    decode(repeat('21',32),'hex'),decode(repeat('22',12),'hex'),
    decode(repeat('23',16),'hex'),decode(repeat('24',32),'hex'),
    decode(repeat('25',12),'hex'),decode(repeat('26',16),'hex'),
    'kek-v1',repeat('c4',32),'16000000-0000-4000-8000-000000000013',
    '2026-08-11T14:11:01Z',3
  );
  if not (registered->>'accepted')::boolean
     or (registered->>'noOp')::boolean
     or registered#>>'{webhookJob,state}' <> 'queued'
     or registered#>>'{payload,payloadHash}' <> repeat('c3',32)
     or registered#>>'{receipt,event_type}' <> 'webhook.accepted'
     or registered::text ~* '(ciphertext|wrappedDek|authTag)' then
    raise exception 'atomic accepted webhook ingress failed';
  end if;
  perform set_config('omnix.test_atomic_payload_ref',registered#>>'{payload,payloadRef}',true);
end;
$$;
select 'ok 18 - accepted webhook atomically persists one encrypted payload, receipt and durable job';

do $$
declare replay jsonb;
begin
  replay := public.register_mailchimp_webhook_event_encrypted(
    '14000000-0000-4000-8000-000000000001','audience-a',
    repeat('c1',32),repeat('c2',32),false,false,repeat('c3',32),
    decode(repeat('31',32),'hex'),decode(repeat('32',12),'hex'),
    decode(repeat('33',16),'hex'),decode(repeat('34',32),'hex'),
    decode(repeat('35',12),'hex'),decode(repeat('36',16),'hex'),
    'ignored-on-replay',repeat('c5',32),
    '16000000-0000-4000-8000-000000000014','2026-08-11T14:11:02Z',7
  );
  if not (replay->>'accepted')::boolean
     or not (replay->>'noOp')::boolean
     or replay#>>'{webhookJob,state}' <> 'queued'
     or replay#>>'{receipt,event_type}' <> 'webhook.accepted'
     or replay#>>'{payload,payloadRef}' <> current_setting('omnix.test_atomic_payload_ref') then
    raise exception 'legitimate webhook replay allocated another envelope';
  end if;
end;
$$;
reset role;
do $$ begin
  if (select count(*) from connector_private.connector_payload_envelopes
      where connection_id='14000000-0000-4000-8000-000000000001'
        and payload_kind='mailchimp.webhook') <> 1 then
    raise exception 'legitimate replay left an orphan payload';
  end if;
end $$;
select 'ok 19 - duplicate body/payload accepts a new server correlation without allocating an orphan envelope';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  begin
    perform public.register_mailchimp_webhook_event_encrypted(
      '14000000-0000-4000-8000-000000000001','audience-a',
      repeat('c1',32),repeat('d2',32),true,true,repeat('d3',32),
      decode(repeat('41',32),'hex'),decode(repeat('42',12),'hex'),
      decode(repeat('43',16),'hex'),decode(repeat('44',32),'hex'),
      decode(repeat('45',12),'hex'),decode(repeat('46',16),'hex'),
      'kek-v1',repeat('d4',32),gen_random_uuid(),'2026-08-11T14:11:03Z',3
    );
    raise exception 'divergent webhook replay succeeded';
  exception when unique_violation then null; end;
end;
$$;
reset role;
do $$ begin
  if (select count(*) from connector_private.connector_payload_envelopes
      where connection_id='14000000-0000-4000-8000-000000000001'
        and payload_kind='mailchimp.webhook') <> 1 then
    raise exception 'divergent replay left an orphan payload';
  end if;
end $$;
select 'ok 20 - divergent replay conflicts before payload persistence and leaves no orphan';

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
declare rejected jsonb;
begin
  rejected := public.register_mailchimp_webhook_event_encrypted(
    '14000000-0000-4000-8000-000000000001','audience-a',
    repeat('e1',32),repeat('e2',32),false,true,repeat('e3',32),
    decode(repeat('51',32),'hex'),decode(repeat('52',12),'hex'),
    decode(repeat('53',16),'hex'),decode(repeat('54',32),'hex'),
    decode(repeat('55',12),'hex'),decode(repeat('56',16),'hex'),
    'kek-v1',repeat('e4',32),gen_random_uuid(),'2026-08-11T14:11:04Z',3
  );
  if (rejected->>'accepted')::boolean
     or rejected#>>'{webhookJob}' is not null
     or rejected#>>'{payload}' is not null
     or rejected#>>'{receipt,event_type}' <> 'webhook.rejected' then
    raise exception 'rejected webhook persisted provider payload';
  end if;
end;
$$;
reset role;
do $$ begin
  if (select count(*) from connector_private.connector_payload_envelopes
      where connection_id='14000000-0000-4000-8000-000000000001'
        and payload_kind='mailchimp.webhook') <> 1 then
    raise exception 'rejected webhook persisted provider payload';
  end if;
end $$;
select 'ok 21 - rejected webhook records only redacted evidence and persists no raw-body envelope';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select public.request_connector_disconnect(
  '14000000-0000-4000-8000-000000000001',
  '16000000-0000-4000-8000-000000000012'
);
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  begin
    perform public.read_mailchimp_webhook_signing_secret(
      repeat('4',64),'2026-08-11T14:12:01Z'
    );
    raise exception 'revoking connection still resolved webhook secret';
  exception when no_data_found then null; end;
end;
$$;
reset role;
do $$
begin
  if not exists (
    select 1 from connector_private.connector_connection_secrets
    where connection_id = '14000000-0000-4000-8000-000000000001'
      and secret_type = 'mailchimp-webhook-signing-secret'
      and destroyed_at is null
  ) then
    raise exception 'revocation request destroyed recovery material before provider result';
  end if;
end;
$$;
select 'ok 22 - revocation request immediately blocks webhook reads while preserving recovery material until confirmed';

rollback;
