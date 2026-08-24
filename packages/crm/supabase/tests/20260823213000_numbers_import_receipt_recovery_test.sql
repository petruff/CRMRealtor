begin;
select plan(11);

select has_function(
  'public','prepare_data_import_run',
  array['uuid','uuid','text','text','text','text','integer','uuid','timestamp with time zone'],
  'authenticated import receipt preflight exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.prepare_data_import_run(uuid,uuid,text,text,text,text,integer,uuid,timestamptz)',
    'execute'
  ),
  'authenticated workspace members can preflight an import receipt'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.prepare_data_import_run(uuid,uuid,text,text,text,text,integer,uuid,timestamptz)',
    'execute'
  ),
  'anonymous callers cannot preflight import receipts'
);

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '11000000-0000-4000-8000-000000000031',
  'authenticated','authenticated','receipt-recovery@omnix.test','',now(),'{}','{}',now(),now()
);
insert into public.workspaces(id,name)
values ('21000000-0000-4000-8000-000000000031','Receipt recovery');
insert into public.workspace_members(id,workspace_id,user_id,role,status)
values (
  '31000000-0000-4000-8000-000000000031',
  '21000000-0000-4000-8000-000000000031',
  '11000000-0000-4000-8000-000000000031','owner','active'
);
insert into public.contacts(
  id,owner_id,workspace_id,first_name,last_name,lead_type,relationship,
  intent,source,pipeline_stage,created_at,updated_at
) values
(
  '41000000-0000-4000-8000-000000000031',
  '11000000-0000-4000-8000-000000000031',
  '21000000-0000-4000-8000-000000000031',
  'Created','Contact','warm','lead','unknown','other','new',now(),now()
),
(
  '41000000-0000-4000-8000-000000000032',
  '11000000-0000-4000-8000-000000000031',
  '21000000-0000-4000-8000-000000000031',
  'Updated','Contact','hot','active-client','buyer','referral','active',now(),now()
);

select set_config('omnix.actor_user_id','11000000-0000-4000-8000-000000000031',true);
set constraints all immediate;
set constraints all deferred;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000031',true);

select is(
  public.prepare_data_import_run(
    '21000000-0000-4000-8000-000000000031',
    '31000000-0000-4000-8000-000000000031',
    'spreadsheet','numbers',repeat('a',64),'ui:'||repeat('a',64),2,
    '51000000-0000-4000-8000-000000000031',now()
  )->>'state',
  'ready',
  'a new Numbers file is accepted before mutation'
);

reset role;
insert into public.contact_intake_receipts(
  owner_id,workspace_id,idempotency_key,request_hash,status_code,response_json,created_at
) values
(
  '11000000-0000-4000-8000-000000000031',
  '21000000-0000-4000-8000-000000000031',
  'import-group:'||encode(extensions.digest(convert_to('ui:'||repeat('a',64),'UTF8'),'sha256'),'hex')||':1:'||repeat('b',16),
  repeat('b',64),200,
  jsonb_build_object('contactId','41000000-0000-4000-8000-000000000031','action','create','notesAdded',false,'noOp',false),
  now()-interval '1 minute'
),
(
  '11000000-0000-4000-8000-000000000031',
  '21000000-0000-4000-8000-000000000031',
  'import-group:'||encode(extensions.digest(convert_to('ui:'||repeat('a',64),'UTF8'),'sha256'),'hex')||':2:'||repeat('c',16),
  repeat('c',64),200,
  jsonb_build_object('contactId','41000000-0000-4000-8000-000000000032','action','update','notesAdded',true,'noOp',false),
  now()
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000031',true);

select throws_ok(
  $$select public.prepare_data_import_run(
    '21000000-0000-4000-8000-000000000031',
    '31000000-0000-4000-8000-000000000031',
    'spreadsheet','numbers',repeat('a',64),'ui:'||repeat('a',64),2,
    '51000000-0000-4000-8000-000000000032',now()
  )$$,
  'P0001',null,
  'receipt rows without matching contact-imported evidence fail closed'
);

reset role;
insert into public.activity_events(
  workspace_id,type,contact_id,actor_membership_id,occurred_at,idempotency_key
) values
(
  '21000000-0000-4000-8000-000000000031','contact-imported',
  '41000000-0000-4000-8000-000000000031',
  '31000000-0000-4000-8000-000000000031',now()-interval '1 minute',
  'import:'||encode(extensions.digest(convert_to('ui:'||repeat('a',64),'UTF8'),'sha256'),'hex')||':imported:1'
),
(
  '21000000-0000-4000-8000-000000000031','contact-imported',
  '41000000-0000-4000-8000-000000000032',
  '31000000-0000-4000-8000-000000000031',now(),
  'import:'||encode(extensions.digest(convert_to('ui:'||repeat('a',64),'UTF8'),'sha256'),'hex')||':imported:2'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000031',true);

select is(
  public.prepare_data_import_run(
    '21000000-0000-4000-8000-000000000031',
    '31000000-0000-4000-8000-000000000031',
    'spreadsheet','numbers',repeat('a',64),'ui:'||repeat('a',64),2,
    '51000000-0000-4000-8000-000000000032',now()
  )->>'state',
  'recovered',
  'an exact completed import is recovered from atomic row evidence'
);
select is(
  (select created_count from public.data_import_runs
    where workspace_id='21000000-0000-4000-8000-000000000031'),
  1,
  'recovery preserves the original created count'
);
select is(
  (select updated_count from public.data_import_runs
    where workspace_id='21000000-0000-4000-8000-000000000031'),
  1,
  'recovery preserves the original updated count'
);
select is(
  (select count(*)::integer from public.data_import_row_outcomes
    where workspace_id='21000000-0000-4000-8000-000000000031'),
  2,
  'recovery records each original row exactly once'
);
select is(
  public.prepare_data_import_run(
    '21000000-0000-4000-8000-000000000031',
    '31000000-0000-4000-8000-000000000031',
    'spreadsheet','numbers',repeat('a',64),'ui:'||repeat('a',64),2,
    '51000000-0000-4000-8000-000000000033',now()
  )->>'state',
  'recorded',
  'an exact replay reads the recovered immutable receipt without mutation'
);
select throws_ok(
  $$select public.prepare_data_import_run(
    '21000000-0000-4000-8000-000000000031',
    '31000000-0000-4000-8000-000000000031',
    'spreadsheet','numbers',repeat('d',64),'ui:'||repeat('a',64),2,
    '51000000-0000-4000-8000-000000000034',now()
  )$$,
  '23505',null,
  'a divergent replay fails closed'
);

select * from finish();
rollback;
