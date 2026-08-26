begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

select has_function(
  'public','apply_contact_import_plan',
  array[
    'uuid','uuid','text','text','text','text','text','jsonb','uuid','integer',
    'timestamp with time zone','timestamp with time zone','uuid'
  ],
  'complete ordered import plan RPC exists'
);
select function_privs_are(
  'public','apply_contact_import_plan',
  array[
    'uuid','uuid','text','text','text','text','text','jsonb','uuid','integer',
    'timestamp with time zone','timestamp with time zone','uuid'
  ],
  'authenticated',array['EXECUTE'],
  'authenticated receives only RPC execution authority'
);
select function_privs_are(
  'public','apply_contact_import_plan',
  array[
    'uuid','uuid','text','text','text','text','text','jsonb','uuid','integer',
    'timestamp with time zone','timestamp with time zone','uuid'
  ],
  'anon',array[]::text[],
  'anonymous callers cannot execute an import plan'
);
select ok(
  pg_get_functiondef(
    'public.apply_contact_import_plan(uuid,uuid,text,text,text,text,text,jsonb,uuid,integer,timestamptz,timestamptz,uuid)'::regprocedure
  ) ilike '%pg_advisory_xact_lock%order by key%',
  'the write boundary locks all identities in deterministic order'
);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '19123000-0000-4000-8000-000000000001','authenticated','authenticated',
  'atomic-plan-owner@omnix.test','',now(),'{}','{}',now(),now()
);
insert into public.workspaces(id,name)
values ('29123000-0000-4000-8000-000000000001','Atomic import plan');
select set_config('omnix.actor_user_id','19123000-0000-4000-8000-000000000001',true);
insert into public.workspace_members(id,workspace_id,user_id,role,status)
values (
  '39123000-0000-4000-8000-000000000001',
  '29123000-0000-4000-8000-000000000001',
  '19123000-0000-4000-8000-000000000001','owner','active'
);
set constraints all immediate;
set constraints all deferred;

create temporary table atomic_plan_result(result jsonb,ordered_plan jsonb) on commit drop;
grant select,insert,update on atomic_plan_result to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19123000-0000-4000-8000-000000000001',true);

insert into atomic_plan_result(ordered_plan)
values (jsonb_build_array(
    jsonb_build_object(
      'rowNumber',1,'kind','apply',
      'groupIdempotencyKey','atomic-plan-group-001','requestHash',repeat('c',64),
      'errorCode','qualification-review,manual-pipeline-stage-protected',
      'plan',jsonb_build_object(
        'action','create',
        'contact',jsonb_build_object(
          'firstName','Atomic','lastName','DNC','email','atomic-dnc@example.com',
          'leadType','warm','relationship','lead','intent','unknown','source','other',
          'pipelineStage','new','tags',jsonb_build_array('DNC'),'emailSubscribed',true
        ),
        'sourceProfile',jsonb_build_object(
          'provider','controlled-test','schemaVersion','controlled-test.v1',
          'facts',jsonb_build_array(jsonb_build_object(
            'key','do-not-contact','label','Do not contact','category','consent',
            'valueType','boolean','value',true,'sourceRowNumber',1
          ))
        ),
        'activityIdempotencyKey','import:atomic-plan-success:1'
      )
    ),
    jsonb_build_object(
      'rowNumber',2,'kind','alias','targetRowNumber',1
    ),
    jsonb_build_object(
      'rowNumber',3,'kind','quarantine','source','controlled-test',
      'externalId','quarantine-003',
      'candidate',jsonb_build_object(
        'email','quarantine-dnc@example.com','tags',jsonb_build_array('DNC'),
        'emailSubscribed',true
      ),
      'reasons',jsonb_build_array(jsonb_build_object(
        'field','name','code','required','message','Name is required'
      )),
      'intakeIdempotencyKey','import:atomic-plan:incomplete:3',
      'errorCode','validation-rejected'
    ),
    jsonb_build_object(
      'rowNumber',4,'kind','reject','errorCode','ambiguous-identity'
    )
  ));
update atomic_plan_result set result=public.apply_contact_import_plan(
  '29123000-0000-4000-8000-000000000001',
  '39123000-0000-4000-8000-000000000001',
  'ui:atomic-plan-success-001',repeat('a',64),
  'controlled-test','csv',repeat('b',64),ordered_plan,
  null,null,'2026-08-25T12:30:00Z','2026-08-25T12:30:01Z',
  '59123000-0000-4000-8000-000000000001'
);

select is((select result->>'state' from atomic_plan_result),'recorded',
  'the complete plan returns the TypeScript terminal state');
select is((select (result#>>'{counts,total}')::integer from atomic_plan_result),4,
  'the aggregate counts every ordered source row');
select is((select result#>'{counts}' from atomic_plan_result),
  '{"total":4,"created":1,"updated":0,"unchanged":1,"rejected":1,"quarantined":1,"failed":0,"notesAdded":0}'::jsonb,
  'the RPC returns the exact bounded aggregate count vocabulary consumed by TypeScript');
select is((select jsonb_array_length(result->'rowOutcomes') from atomic_plan_result),4,
  'the RPC returns one ordered outcome for every plan row');
select is(
  (select result#>>'{rowOutcomes,0,errorCode}' from atomic_plan_result),
  'qualification-review,manual-pipeline-stage-protected',
  'multiple TypeScript dispositions survive immutable receipt persistence'
);
select is(
  (select result#>>'{rowOutcomes,0,contactId}' from atomic_plan_result),
  (select result#>>'{rowOutcomes,1,contactId}' from atomic_plan_result),
  'an ordered alias resolves only to an earlier applied group'
);
select ok(not (select email_subscribed from public.contacts where email='atomic-dnc@example.com'),
  'DNC overrides positive consent in an applied group');
select is(
  (select candidate->>'emailSubscribed' from public.incomplete_records
    where intake_idempotency_key='import:atomic-plan:incomplete:3'),
  'false','DNC quarantine evidence cannot carry positive email consent'
);
select is((select count(*)::integer from public.data_import_runs
    where idempotency_key='ui:atomic-plan-success-001'),1,
  'one immutable terminal aggregate run is recorded');
select is((select count(*)::integer from public.data_import_row_outcomes outcome
    join public.data_import_runs run on run.id=outcome.import_run_id
    where run.idempotency_key='ui:atomic-plan-success-001'),4,
  'all terminal row evidence is recorded with the aggregate');
select is(
  (select response_json from public.contact_intake_receipts
    where workspace_id='29123000-0000-4000-8000-000000000001'
      and idempotency_key='ui:atomic-plan-success-001'),
  (select result from atomic_plan_result),
  'the exact returned result is the durable terminal aggregate receipt'
);

select ok((public.apply_contact_import_plan(
  '29123000-0000-4000-8000-000000000001',
  '39123000-0000-4000-8000-000000000001',
  'ui:atomic-plan-success-001',repeat('a',64),
  'controlled-test','csv',repeat('b',64),
  (select ordered_plan from atomic_plan_result),null,null,
  '2026-08-25T12:30:00Z','2026-08-25T12:30:01Z',
  '59123000-0000-4000-8000-000000000001'
)->>'noOp')::boolean,
  'an exact aggregate replay is a no-op and returns original evidence');
select is((select count(*)::integer from public.contacts where email='atomic-dnc@example.com'),1,
  'aggregate replay does not duplicate a contact');
select throws_ok(
  $$select public.apply_contact_import_plan(
    '29123000-0000-4000-8000-000000000001',
    '39123000-0000-4000-8000-000000000001',
    'ui:atomic-plan-success-001',repeat('d',64),
    'controlled-test','csv',repeat('b',64),'[]'::jsonb,null,null,
    '2026-08-25T12:30:00Z','2026-08-25T12:30:01Z',
    '59123000-0000-4000-8000-000000000001')$$,
  '23505',null,'divergent aggregate replay fails closed');
select throws_ok(
  $$select public.apply_contact_import_plan(
    '29123000-0000-4000-8000-000000000001',
    '39123000-0000-4000-8000-000000000001',
    'ui:atomic-plan-success-001',repeat('a',64),
    'controlled-test','csv',repeat('b',64),
    (select ordered_plan || jsonb_build_array(jsonb_build_object(
      'rowNumber',5,'kind','reject','errorCode','validation-rejected'
    )) from atomic_plan_result),null,null,
    '2026-08-25T12:30:00Z','2026-08-25T12:30:01Z',
    '59123000-0000-4000-8000-000000000001')$$,
  '23505',null,'same-hash divergent ordered-plan replay fails closed');

select throws_ok(
  $$select public.apply_contact_import_plan(
    '29123000-0000-4000-8000-000000000001',
    '39123000-0000-4000-8000-000000000001',
    'ui:atomic-plan-row-failure',repeat('e',64),
    'controlled-test','csv',repeat('f',64),
    jsonb_build_array(
      jsonb_build_object(
        'rowNumber',1,'kind','apply','groupIdempotencyKey','row-failure-group-001',
        'requestHash',repeat('1',64),'plan',jsonb_build_object(
          'action','create','contact',jsonb_build_object(
            'firstName','Must','lastName','Rollback','email','row-failure@example.com',
            'leadType','warm','relationship','lead','intent','unknown','source','other',
            'pipelineStage','new','tags','[]'::jsonb
          ),'activityIdempotencyKey','import:row-failure:1'
        )
      ),
      jsonb_build_object(
        'rowNumber',2,'kind','apply','groupIdempotencyKey','row-failure-group-002',
        'requestHash',repeat('2',64),'plan','{}'::jsonb
      )
    ),null,null,'2026-08-25T12:31:00Z','2026-08-25T12:31:01Z',
    '59123000-0000-4000-8000-000000000002')$$,
  'P0002',null,'a later row failure aborts the complete plan');
select is((select count(*)::integer from public.contacts where email='row-failure@example.com'),0,
  'a later row failure rolls back earlier contact mutations');
select is((select count(*)::integer from public.contact_intake_receipts
    where idempotency_key in ('row-failure-group-001','ui:atomic-plan-row-failure')),0,
  'a later row failure rolls back group and aggregate receipts');
select is((select count(*)::integer from public.data_import_runs
    where idempotency_key='ui:atomic-plan-row-failure'),0,
  'a later row failure leaves no terminal aggregate run');

reset role;
insert into public.workspaces(id,name)
values ('29123000-0000-4000-8000-000000000002','Receipt conflict fixture');
insert into public.contact_intake_receipts(
  owner_id,workspace_id,idempotency_key,request_hash,status_code,response_json,created_at
) values (
  '19123000-0000-4000-8000-000000000001',
  '29123000-0000-4000-8000-000000000002',
  'ui:atomic-plan-receipt-failure',repeat('9',64),200,
  '{"state":"fixture"}'::jsonb,'2026-08-25T12:31:30Z'
);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','19123000-0000-4000-8000-000000000001',true);

select throws_ok(
  $$select public.apply_contact_import_plan(
    '29123000-0000-4000-8000-000000000001',
    '39123000-0000-4000-8000-000000000001',
    'ui:atomic-plan-receipt-failure',repeat('a',64),
    'controlled-test','csv',repeat('b',64),
    jsonb_build_array(jsonb_build_object(
      'rowNumber',1,'kind','apply','groupIdempotencyKey','receipt-failure-group-001',
      'requestHash',repeat('c',64),'plan',jsonb_build_object(
        'action','create','contact',jsonb_build_object(
          'firstName','Receipt','lastName','Rollback','email','receipt-failure@example.com',
          'leadType','warm','relationship','lead','intent','unknown','source','other',
          'pipelineStage','new','tags','[]'::jsonb
        ),'activityIdempotencyKey','import:receipt-failure:1'
      )
    )),null,null,'2026-08-25T12:31:30Z','2026-08-25T12:31:31Z',
    '59123000-0000-4000-8000-000000000005')$$,
  '23505',null,'terminal aggregate receipt failure aborts the complete plan');
select is((select count(*)::integer from public.contacts
    where email='receipt-failure@example.com'),0,
  'terminal receipt failure rolls back contact mutations');
select is((select count(*)::integer from public.contact_intake_receipts
    where workspace_id='29123000-0000-4000-8000-000000000001'
      and idempotency_key='receipt-failure-group-001'),0,
  'terminal receipt failure rolls back group evidence');
select is((select count(*)::integer from public.data_import_runs
    where idempotency_key='ui:atomic-plan-receipt-failure'),0,
  'terminal receipt failure rolls back aggregate run evidence');

select throws_ok(
  $$select public.apply_contact_import_plan(
    '29123000-0000-4000-8000-000000000001',
    '39123000-0000-4000-8000-000000000001',
    'ui:atomic-plan-identity-conflict',repeat('3',64),
    'controlled-test','csv',repeat('4',64),
    jsonb_build_array(
      jsonb_build_object(
        'rowNumber',1,'kind','apply','groupIdempotencyKey','identity-plan-group-001',
        'requestHash',repeat('5',64),'plan',jsonb_build_object(
          'action','create','contact',jsonb_build_object(
            'firstName','Identity','lastName','One','email','same-plan@example.com',
            'leadType','warm','relationship','lead','intent','unknown','source','other',
            'pipelineStage','new','tags','[]'::jsonb
          ),'activityIdempotencyKey','import:identity-plan:1'
        )
      ),
      jsonb_build_object(
        'rowNumber',2,'kind','apply','groupIdempotencyKey','identity-plan-group-002',
        'requestHash',repeat('6',64),'plan',jsonb_build_object(
          'action','create','contact',jsonb_build_object(
            'firstName','Identity','lastName','Two','email','same-plan@example.com',
            'leadType','warm','relationship','lead','intent','unknown','source','other',
            'pipelineStage','new','tags','[]'::jsonb
          ),'activityIdempotencyKey','import:identity-plan:2'
        )
      )
    ),null,null,'2026-08-25T12:32:00Z','2026-08-25T12:32:01Z',
    '59123000-0000-4000-8000-000000000003')$$,
  '40001',null,'two create groups sharing an identity fail under the serialized boundary');
select is((select count(*)::integer from public.contacts where email='same-plan@example.com'),0,
  'identity conflict rolls back every group in the plan');

select throws_ok(
  $$select public.apply_contact_import_plan(
    '29123000-0000-4000-8000-000000000001',
    '39123000-0000-4000-8000-000000000001',
    'ui:atomic-plan-too-large',repeat('7',64),
    'controlled-test','csv',repeat('8',64),
    (select jsonb_agg(jsonb_build_object(
      'rowNumber',n,'kind','reject','errorCode','validation-rejected'
    ) order by n) from generate_series(1,5001) n),
    null,null,'2026-08-25T12:33:00Z','2026-08-25T12:33:01Z',
    '59123000-0000-4000-8000-000000000004')$$,
  '23514',null,'the existing 5000-row import bound is enforced');

reset role;
select ok(
  not has_table_privilege('authenticated','public.data_import_runs','UPDATE')
  and not has_table_privilege('authenticated','public.data_import_runs','DELETE')
  and not has_table_privilege('authenticated','public.data_import_runs','TRUNCATE'),
  'terminal aggregate evidence remains append-only for authenticated callers'
);

select * from finish();
rollback;
