begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select ok(
  not has_table_privilege('authenticated', 'public.incomplete_records', 'INSERT'),
  'authenticated cannot insert incomplete records directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.incomplete_records', 'UPDATE'),
  'authenticated has no table-wide incomplete-record update'
);

select ok(
  not has_table_privilege('authenticated', 'public.incomplete_records', 'DELETE'),
  'authenticated cannot hard-delete incomplete records'
);
select ok(
  not has_table_privilege('anon', 'public.incomplete_records', 'INSERT')
    and not has_table_privilege('anon', 'public.incomplete_records', 'UPDATE')
    and not has_table_privilege('anon', 'public.incomplete_records', 'DELETE'),
  'anonymous clients cannot mutate incomplete records'
);
select ok(
  not has_table_privilege('authenticated', 'public.notes', 'UPDATE'),
  'authenticated cannot update notes directly'
);
select ok(
  not has_table_privilege('anon', 'public.notes', 'UPDATE'),
  'anonymous clients cannot update notes directly'
);

select ok(has_table_privilege('authenticated', 'public.incomplete_records', 'SELECT'), 'incomplete record reads remain available');
select ok(
  has_column_privilege('authenticated', 'public.incomplete_records', 'status', 'UPDATE')
    and has_column_privilege('authenticated', 'public.incomplete_records', 'archived_at', 'UPDATE')
    and has_column_privilege('authenticated', 'public.incomplete_records', 'archived_by_membership_id', 'UPDATE')
    and has_column_privilege('authenticated', 'public.incomplete_records', 'archive_reason', 'UPDATE')
    and has_column_privilege('authenticated', 'public.incomplete_records', 'updated_at', 'UPDATE'),
  'authenticated retains only incomplete archive/restore lifecycle updates'
);
select ok(
  not has_column_privilege('authenticated', 'public.incomplete_records', 'candidate', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.incomplete_records', 'validation_reasons', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.incomplete_records', 'intake_request_hash', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.incomplete_records', 'conversion_request_hash', 'UPDATE'),
  'incomplete candidate and idempotency evidence cannot be updated directly'
);
select ok(has_table_privilege('authenticated', 'public.notes', 'SELECT'), 'note reads remain available');
select ok(has_table_privilege('authenticated', 'public.notes', 'INSERT'), 'note creation remains available');

select ok(
  has_function_privilege('authenticated', 'public.create_incomplete_record(uuid,text,text,jsonb,jsonb,text,uuid)', 'EXECUTE'),
  'controlled incomplete-record creation remains executable'
);
select ok(
  has_function_privilege('authenticated', 'public.convert_incomplete_record(uuid,jsonb,jsonb,text,uuid,timestamptz)', 'EXECUTE'),
  'controlled incomplete-record conversion remains executable'
);
select ok(
  has_function_privilege('authenticated', 'public.archive_contact_note(uuid,text,uuid,timestamptz)', 'EXECUTE'),
  'controlled note archive remains executable'
);
select ok(
  has_function_privilege('authenticated', 'public.restore_contact_note(uuid,uuid,timestamptz)', 'EXECUTE'),
  'controlled note restore remains executable'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.create_incomplete_record(uuid,text,text,jsonb,jsonb,text,uuid)'::regprocedure),
  'incomplete-record creation retains definer authority'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.convert_incomplete_record(uuid,jsonb,jsonb,text,uuid,timestamptz)'::regprocedure),
  'incomplete-record conversion retains definer authority'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.archive_contact_note(uuid,text,uuid,timestamptz)'::regprocedure),
  'note archive retains definer authority'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.restore_contact_note(uuid,uuid,timestamptz)'::regprocedure),
  'note restore retains definer authority'
);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '1b000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','least-privilege-owner@omnix.test','',now(),
  '{}','{}',now(),now()
);
insert into public.workspaces(id,name) values (
  '2b000000-0000-4000-8000-000000000001','Least privilege workspace'
);
select set_config('omnix.actor_user_id','1b000000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status) values (
  '3b000000-0000-4000-8000-000000000001',
  '2b000000-0000-4000-8000-000000000001',
  '1b000000-0000-4000-8000-000000000001','owner','active'
);
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-000000000001',true);

select lives_ok(
  $$select public.create_incomplete_record(
    '2b000000-0000-4000-8000-000000000001','qa-audit',null,
    '{"firstName":"Archive"}'::jsonb,
    '[{"field":"name","code":"review","message":"Review required"}]'::jsonb,
    'least-privilege-archive','3b000000-0000-4000-8000-000000000001'
  )$$,
  'guarded create RPC still performs legitimate intake'
);
select throws_ok(
  $$insert into public.incomplete_records(
      workspace_id,source,candidate,validation_reasons
    ) values (
      '2b000000-0000-4000-8000-000000000001','direct-bypass',
      '{"firstName":"Bypass"}'::jsonb,
      '[{"field":"name","code":"review","message":"Review required"}]'::jsonb
    )$$,
  '42501',null,'direct incomplete-record intake is denied'
);
select throws_ok(
  $$update public.incomplete_records
    set candidate='{"firstName":"Tampered"}'::jsonb
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'$$,
  '42501',null,'pending candidate evidence cannot be mutated directly'
);
select throws_ok(
  $$update public.incomplete_records
    set validation_reasons='["rewritten"]'::jsonb
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'$$,
  '42501',null,'pending validation evidence cannot be mutated directly'
);
select lives_ok(
  $$update public.incomplete_records
    set status='archived', archived_at='2026-08-26T04:00:00Z',
        archived_by_membership_id='3b000000-0000-4000-8000-000000000001',
        archive_reason='Reviewed by owner'
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'$$,
  'narrow direct archive lifecycle remains available'
);
select is(
  (select status::text from public.incomplete_records
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'),
  'archived','archive lifecycle persisted through the narrow grant'
);
select throws_ok(
  $$update public.incomplete_records
    set archived_at='2026-08-26T05:00:00Z',
        archived_by_membership_id='3b000000-0000-4000-8000-000000000099',
        archive_reason='Rewritten evidence'
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'$$,
  '23514','incomplete record archive evidence is immutable',
  'authenticated cannot rewrite archive evidence after transition'
);
select is(
  (select concat_ws('|',archived_at::text,archived_by_membership_id::text,archive_reason)
   from public.incomplete_records
   where workspace_id='2b000000-0000-4000-8000-000000000001'
     and intake_idempotency_key='least-privilege-archive'),
  '2026-08-26 04:00:00+00|3b000000-0000-4000-8000-000000000001|Reviewed by owner',
  'failed rewrite leaves original archive evidence intact'
);
select throws_ok(
  $$update public.incomplete_records
    set candidate='{"firstName":"Post-archive tamper"}'::jsonb
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'$$,
  '42501',null,'authenticated cannot rewrite archived candidate evidence directly'
);
select lives_ok(
  $$update public.incomplete_records
    set status='pending', archived_at=null, archived_by_membership_id=null,
        archive_reason=null, updated_at='2026-08-26T04:01:00Z'
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'$$,
  'narrow direct restore lifecycle remains available'
);
select is(
  (select status::text from public.incomplete_records
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-archive'),
  'pending','restore lifecycle returns the same record to pending'
);
select lives_ok(
  $$select public.create_incomplete_record(
    '2b000000-0000-4000-8000-000000000001','qa-audit',null,
    '{"firstName":"Ada","lastName":"Lovelace","email":"ada-lp@example.test","tags":["buyer"]}'::jsonb,
    '[{"field":"name","code":"review","message":"Review required"}]'::jsonb,
    'least-privilege-convert',
    '3b000000-0000-4000-8000-000000000001'
  )$$,
  'guarded conversion fixture intake succeeds'
);
select lives_ok(
  $$select public.convert_incomplete_record(
    (select id from public.incomplete_records
      where workspace_id='2b000000-0000-4000-8000-000000000001'
        and intake_idempotency_key='least-privilege-convert'),
    '{"firstName":"Ada","lastName":"Lovelace","email":"ada-lp@example.test","tags":["buyer"]}'::jsonb,
    '{
      "action":"create",
      "contactInput":{
        "firstName":"Ada","lastName":"Lovelace","email":"ada-lp@example.test",
        "leadType":"warm","relationship":"lead","intent":"unknown",
        "source":"other","pipelineStage":"new","tags":["buyer"],
        "emailSubscribed":false,"touchDateOverridden":false
      },
      "changes":["firstName","lastName","email","leadType","relationship","intent",
        "source","pipelineStage","tags","emailSubscribed","touchDateOverridden"]
    }'::jsonb,
    'least-privilege-conversion-command',
    '3b000000-0000-4000-8000-000000000001','2026-08-26T04:02:00Z'
  )$$,
  'guarded convert RPC retains full internal mutation authority'
);
select is(
  (select status::text from public.incomplete_records
    where workspace_id='2b000000-0000-4000-8000-000000000001'
      and intake_idempotency_key='least-privilege-convert'),
  'converted','RPC conversion persists despite direct evidence-column denial'
);

select * from finish();
rollback;
