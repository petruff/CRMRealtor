begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select col_default_is('public','contacts','email_subscribed','false',
  'new contacts default to no inferred email consent');
select col_default_is('public','contact_points','email_subscribed','false',
  'new email contact points default to no inferred consent');
select is(
  public.incomplete_candidate_contact_input('{"firstName":"No Consent"}'::jsonb)->>'emailSubscribed',
  'false','quarantined/webhook conversion defaults to no consent'
);
select ok(not has_table_privilege('authenticated','public.contact_intake_receipts','INSERT'),
  'authenticated cannot insert receipt evidence directly');
select ok(not has_table_privilege('authenticated','public.contact_intake_receipts','UPDATE'),
  'authenticated cannot update receipt evidence directly');
select ok(not has_table_privilege('authenticated','public.contact_intake_receipts','DELETE'),
  'authenticated cannot delete receipt evidence directly');
select ok(not has_table_privilege('authenticated','public.contact_intake_receipts','TRUNCATE'),
  'authenticated cannot truncate receipt evidence directly');
select ok(has_table_privilege('authenticated','public.contact_intake_receipt_transition_events','SELECT'),
  'workspace members can read controlled transition evidence through RLS');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '19110000-0000-4000-8000-000000000011','authenticated','authenticated',
  'import-owner-611@omnix.test','',now(),'{}','{}',now(),now()
);
insert into public.workspaces(id,name)
values ('29110000-0000-4000-8000-000000000011','Import integrity');
select set_config('omnix.actor_user_id','19110000-0000-4000-8000-000000000011',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status)
values (
  '39110000-0000-4000-8000-000000000011',
  '29110000-0000-4000-8000-000000000011',
  '19110000-0000-4000-8000-000000000011','owner','active'
);
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19110000-0000-4000-8000-000000000011',true);
select is(
  public.begin_contact_intake_receipt(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',
    'receipt-placeholder-611',repeat('a',64),
    '59110000-0000-4000-8000-000000000011','2026-08-25T12:00:00Z'
  )->>'state','pending','placeholder is created only through the governed RPC'
);
select throws_ok(
  $$update public.contact_intake_receipts set status_code=200
    where idempotency_key=concat('receipt-','placeholder-611')$$,
  '42501',null,'authenticated direct placeholder transition is denied'
);
select is(
  public.finalize_contact_intake_receipt(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',
    'receipt-placeholder-611',repeat('a',64),200,
    '{"contactId":"49110000-0000-4000-8000-000000000011","action":"unchanged","notesAdded":false,"noOp":false}'::jsonb,
    '59110000-0000-4000-8000-000000000012','2026-08-25T12:00:01Z'
  )->>'state','terminal','controlled RPC finalizes the placeholder once'
);
select is(
  (select count(*)::integer from public.contact_intake_receipt_transition_events
    where receipt_id=(select id from public.contact_intake_receipts
      where idempotency_key=concat('receipt-','placeholder-611'))),
  2,'placeholder creation and terminal finalization are both audited'
);
select ok((public.finalize_contact_intake_receipt(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',
    'receipt-placeholder-611',repeat('a',64),200,
    '{"contactId":"49110000-0000-4000-8000-000000000011","action":"unchanged","notesAdded":false,"noOp":false}'::jsonb,
    '59110000-0000-4000-8000-000000000013','2026-08-25T12:00:02Z'
  )->>'noOp')::boolean,'exact terminal replay is a no-op');
select throws_ok(
  $$select public.finalize_contact_intake_receipt(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',
    'receipt-placeholder-611',repeat('a',64),409,
    '{"error":"different"}'::jsonb,
    '59110000-0000-4000-8000-000000000014',now())$$,
  '23505',null,'divergent terminal replay fails closed'
);

reset role;
select throws_ok(
  $$truncate table public.contact_intake_receipts cascade$$,
  '55000','evidence tables cannot be truncated',
  'statement trigger prevents privileged receipt truncation'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19110000-0000-4000-8000-000000000011',true);

select is(
  (public.apply_contact_import_group(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',
    'dnc-import-group-611',repeat('b',64),
    jsonb_build_object(
      'action','create',
      'contact',jsonb_build_object(
        'firstName','DNC','lastName','Contact','email','dnc-611@example.com',
        'leadType','warm','relationship','lead','intent','unknown','source','other',
        'pipelineStage','new','tags','[]'::jsonb,'emailSubscribed',true
      ),
      'activityIdempotencyKey','import:dnc-import-group-611',
      'sourceProfile',jsonb_build_object(
        'provider','controlled-test','schemaVersion','controlled-test.v1',
        'facts',jsonb_build_array(jsonb_build_object(
          'key','do-not-contact','label','Do not contact','category','consent',
          'valueType','boolean','value',true,'sourceRowNumber',1
        ))
      )
    ),'2026-08-25T12:01:00Z'
  )->>'action'),
  'create','DNC import creates the contact atomically'
);
select ok(not (select email_subscribed from public.contacts where email='dnc-611@example.com'),
  'DNC source fact overrides a positive imported consent flag');
select is((select value_json from public.contact_import_source_facts
    where source_key='do-not-contact'),'true'::jsonb,
  'original typed DNC evidence is retained');

select is(
  (public.apply_contact_import_group(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',
    'missing-consent-611',repeat('c',64),
    jsonb_build_object(
      'action','create','contact',jsonb_build_object(
        'firstName','Missing','lastName','Consent','email','missing-611@example.com',
        'leadType','warm','relationship','lead','intent','unknown','source','other',
        'pipelineStage','new','tags','[]'::jsonb
      ),'activityIdempotencyKey','import:missing-consent-611'
    ),'2026-08-25T12:02:00Z'
  )->>'action'),
  'create','missing-consent import remains valid'
);
select ok(not (select email_subscribed from public.contacts where email='missing-611@example.com'),
  'missing import consent defaults to false');
select throws_ok(
  $$select public.apply_contact_import_group(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',
    'identity-race-611',repeat('d',64),
    jsonb_build_object(
      'action','create','contact',jsonb_build_object(
        'firstName','Duplicate','lastName','Identity','email','missing-611@example.com',
        'leadType','warm','relationship','lead','intent','unknown','source','other',
        'pipelineStage','new','tags','[]'::jsonb
      ),'activityIdempotencyKey','import:identity-race-611'
    ),now())$$,
  '40001',null,'serialized stale create plan cannot duplicate an active identity'
);
select ok(
  pg_get_functiondef('public.apply_contact_import_group(uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure)
    ilike '%pg_advisory_xact_lock%',
  'import write boundary takes transaction-scoped identity locks'
);

select lives_ok(
  $$select public.record_data_import_run(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',null,null,
    'controlled-test','csv',repeat('e',64),'terminal-run-611','succeeded',
    '{"total":0,"created":0,"updated":0,"unchanged":0,"rejected":0,"quarantined":0,"failed":0}'::jsonb,
    '[]'::jsonb,'2026-08-25T12:03:00Z','2026-08-25T12:03:01Z',
    '59110000-0000-4000-8000-000000000015')$$,
  'terminal import summary is recorded atomically'
);
select lives_ok(
  $$select public.record_data_import_run(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',null,null,
    'controlled-test','csv',repeat('e',64),'terminal-run-611','succeeded',
    '{"total":0,"created":0,"updated":0,"unchanged":0,"rejected":0,"quarantined":0,"failed":0}'::jsonb,
    '[]'::jsonb,'2026-08-25T12:03:00Z','2026-08-25T12:03:01Z',
    '59110000-0000-4000-8000-000000000015')$$,
  'exact terminal summary replay is a no-op'
);
select throws_ok(
  $$select public.record_data_import_run(
    '29110000-0000-4000-8000-000000000011',
    '39110000-0000-4000-8000-000000000011',null,null,
    'controlled-test','csv',repeat('e',64),'terminal-run-611','partial',
    '{"total":0,"created":0,"updated":0,"unchanged":0,"rejected":0,"quarantined":0,"failed":0}'::jsonb,
    '[]'::jsonb,'2026-08-25T12:03:00Z','2026-08-25T12:03:01Z',
    '59110000-0000-4000-8000-000000000015')$$,
  '23505',null,'divergent terminal summary replay is rejected'
);
select ok(
  not has_table_privilege('authenticated','public.data_import_runs','UPDATE')
  and not has_table_privilege('authenticated','public.data_import_runs','DELETE')
  and not has_table_privilege('authenticated','public.data_import_runs','TRUNCATE'),
  'authenticated cannot mutate or truncate terminal import summaries'
);
select ok(
  not has_table_privilege('authenticated','public.contact_import_source_facts','UPDATE')
  and not has_table_privilege('authenticated','public.contact_import_source_facts','DELETE')
  and not has_table_privilege('authenticated','public.contact_import_source_facts','TRUNCATE'),
  'authenticated cannot mutate or truncate source-fact evidence'
);
select ok(
  not has_table_privilege('authenticated','public.activity_events','UPDATE')
  and not has_table_privilege('authenticated','public.activity_events','DELETE')
  and not has_table_privilege('authenticated','public.activity_events','TRUNCATE'),
  'authenticated cannot mutate or truncate activity evidence'
);

select * from finish();
rollback;
